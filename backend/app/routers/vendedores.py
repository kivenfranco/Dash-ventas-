"""
GET /api/vendedores — Performance completa por vendedor.
Combina FACT_VENTAS (real) + PP_VENDEDOR_VALOR + PP_VENDEDOR_CANTIDAD.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from ..deps import vendedor_override

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/vendedores", tags=["Vendedores"])
logger = logging.getLogger(__name__)


def _safe_pct(a, b):
    try:
        return round((a / b - 1) * 100, 2) if b and b != 0 else None
    except Exception:
        return None


@router.get("")
def get_vendedores(
    request: Request,
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    planta: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    forced = vendedor_override(request)
    if forced:
        vendedor = forced

    cfg = get_settings()
    key = f"vend:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{planta}:{grupo_comercial}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    # --- dim filters for FACT_VENTAS joins ---
    joins, cond, params = [], [], []
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if grupo_comercial or planta:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if grupo_comercial:
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
            cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
        if planta:
            cond.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    join_str = " ".join(joins)

    # When viewing full year of current year, compare same YTD period in prior year
    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None

    def _where(ano_val, mes_val, extra_cond, mes_max=None, mfin=None):
        c = ["fv.ANO_FISCAL = %s"]
        p = [ano_val]
        if mes_val and mfin and mfin > mes_val:
            c.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); p.extend([mes_val, mfin])
        elif mes_val:
            c.append("fv.PERIODO_FISCAL = %s"); p.append(mes_val)
        elif mes_max:
            c.append("fv.PERIODO_FISCAL <= %s"); p.append(mes_max)
        c += extra_cond
        return "WHERE " + " AND ".join(c), p + params

    # Current period
    w_cur, p_cur = _where(ano, mes, cond, mfin=mes_fin)
    sql_cur = f"""
        SELECT fv.CODIGO_VENDEDOR,
               COALESCE(SUM(fv.VENTAS_NETAS),0)  AS ventas_netas,
               COALESCE(SUM(fv.VENTAS_DOLARES),0) AS ventas_dolares,
               COALESCE(SUM(fv.CANTIDAD),0)       AS cantidad
        FROM {cfg.T('FACT_VENTAS')} fv {join_str} {w_cur}
        GROUP BY 1
    """

    # Previous year same period (capped at same YTD month for full-year view)
    ano_ant = ano - 1
    w_ant, p_ant = _where(ano_ant, mes, cond, mes_max=ytd_cap, mfin=mes_fin)
    sql_ant = f"""
        SELECT fv.CODIGO_VENDEDOR,
               COALESCE(SUM(fv.VENTAS_NETAS),0) AS ventas_netas_ant
        FROM {cfg.T('FACT_VENTAS')} fv {join_str} {w_ant}
        GROUP BY 1
    """

    # Previous month (only for single-month, skip for ranges)
    if mes and not (mes_fin and mes_fin > mes):
        mes_ant = mes - 1 if mes > 1 else 12
        ano_mes_ant = ano if mes > 1 else ano - 1
        w_mom, p_mom = _where(ano_mes_ant, mes_ant, cond)
        sql_mom = f"""
            SELECT fv.CODIGO_VENDEDOR,
                   COALESCE(SUM(fv.VENTAS_NETAS),0) AS ventas_mes_ant
            FROM {cfg.T('FACT_VENTAS')} fv {join_str} {w_mom}
            GROUP BY 1
        """
    else:
        sql_mom = None

    # PP Valor por vendedor
    pp_cond = ["ANO = %s"]
    pp_params = [ano]
    if mes and mes_fin and mes_fin > mes:
        pp_cond.append("MES_NUM BETWEEN %s AND %s"); pp_params.extend([mes, mes_fin])
    elif mes:
        pp_cond.append("MES_NUM = %s"); pp_params.append(mes)
    if region:
        pp_cond.append("REGION = %s"); pp_params.append(region)
    if planta:
        pp_cond.append("PLANTA = %s"); pp_params.append(planta)
    if grupo_comercial:
        pp_cond.append("GRUPO_COMERCIAL = %s"); pp_params.append(grupo_comercial)

    sql_pp_val = f"""
        SELECT VENDEDOR, COALESCE(SUM(PP_VALOR_MES),0) AS pp_valor
        FROM {cfg.T('PP_VENDEDOR_VALOR')}
        WHERE {' AND '.join(pp_cond)}
        GROUP BY 1
    """
    sql_pp_can = f"""
        SELECT VENDEDOR, COALESCE(SUM(PP_CANTIDAD_MES),0) AS pp_cantidad
        FROM {cfg.T('PP_VENDEDOR_CANTIDAD')}
        WHERE {' AND '.join(pp_cond)}
        GROUP BY 1
    """

    # DIM_VENDEDOR for names
    sql_dim = f"SELECT CODIGO_VENDEDOR, NOMBRE FROM {cfg.TM('DIM_VENDEDOR')}"

    try:
        df_cur  = connector.query(sql_cur, p_cur)
        df_ant  = connector.query(sql_ant, p_ant)
        df_ppv  = connector.query(sql_pp_val, pp_params)
        df_ppc  = connector.query(sql_pp_can, pp_params)
        df_dim  = connector.query(sql_dim)
        df_mom  = connector.query(sql_mom, p_mom) if sql_mom else None
    except Exception as exc:
        logger.error("Vendedores error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    for df in [df_cur, df_ant, df_ppv, df_ppc, df_dim] + ([df_mom] if df_mom is not None else []):
        df.columns = [c.lower() for c in df.columns]

    # Merge all on codigo_vendedor
    import pandas as pd
    df = df_cur.merge(df_dim, on="codigo_vendedor", how="left")
    df = df.merge(df_ant, on="codigo_vendedor", how="left")
    if df_mom is not None:
        df = df.merge(df_mom, on="codigo_vendedor", how="left")
    else:
        df["ventas_mes_ant"] = None

    # PP tables use VENDEDOR (= CODIGO_VENDEDOR)
    df_ppv = df_ppv.rename(columns={"vendedor": "codigo_vendedor"})
    df_ppc = df_ppc.rename(columns={"vendedor": "codigo_vendedor"})
    df = df.merge(df_ppv, on="codigo_vendedor", how="left")
    df = df.merge(df_ppc, on="codigo_vendedor", how="left")

    for col in ["ventas_netas_ant", "ventas_mes_ant", "pp_valor", "pp_cantidad"]:
        if col in df.columns:
            df[col] = df[col].fillna(0)

    df = df.sort_values("ventas_netas", ascending=False)

    import math
    records = []
    for _, r in df.iterrows():
        vn       = float(r.ventas_netas or 0)
        vn_ant   = float(r.ventas_netas_ant or 0)
        vn_mom   = float(r.ventas_mes_ant) if r.ventas_mes_ant is not None else None
        pp_v     = float(r.pp_valor or 0)
        pp_c     = float(r.pp_cantidad or 0)

        nombre_raw = r.get("nombre")
        nombre = (str(nombre_raw) if nombre_raw and not (isinstance(nombre_raw, float) and math.isnan(nombre_raw)) else None) or str(r.codigo_vendedor or "")

        records.append({
            "codigo_vendedor":  str(r.codigo_vendedor or ""),
            "nombre":           nombre,
            "ventas_netas":     round(vn, 2),
            "ventas_dolares":   round(float(r.ventas_dolares or 0), 2),
            "cantidad":         round(float(r.cantidad or 0), 2),
            "ventas_netas_ant": round(vn_ant, 2),
            "ventas_mes_ant":   round(vn_mom, 2) if vn_mom is not None else None,
            "variacion_yoy_pct": _safe_pct(vn, vn_ant),
            "variacion_mom_pct": _safe_pct(vn, vn_mom) if vn_mom is not None else None,
            "pp_valor":         round(pp_v, 2),
            "pp_cantidad":      round(pp_c, 2),
            "cump_pp_valor_pct":    round((vn / pp_v) * 100, 2) if pp_v > 0 else None,
            "cump_pp_cantidad_pct": round((float(r.cantidad or 0) / pp_c) * 100, 2) if pp_c > 0 else None,
        })

    result = {"ano": ano, "mes": mes, "data": records}
    cache.set(key, result)
    return result
