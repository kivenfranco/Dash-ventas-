"""
GET /api/segments — Ventas agrupadas por dimensión con comparación YoY/MoM.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/segments", tags=["Segments"])
logger = logging.getLogger(__name__)

_VALID_GROUPS = "^(region|vendedor|grupo_comercial|tipo_fabricacion|tipo_cliente|linea_negocio|unidad_medida_venta|descripcion_parte|mercado|organico)$"


def _build_sql(cfg, group_by, ano, mes, region, vendedor, grupo_comercial, planta, top_n, mes_max=None, excl_exportacion=False, excl_pvta=False, mes_fin=None):
    DIM_MAP = {
        "region": (
            "dd.DESCRIPCION_REGION",
            [f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"],
        ),
        "vendedor": (
            "dv.NOMBRE",
            [f"LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR"],
        ),
        "grupo_comercial": (
            "dgc.NOMBRE_GRUPO",
            [
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO",
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO",
            ],
        ),
        "tipo_fabricacion": (
            "dgc.TIPO_FABRICACION",
            [
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO",
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO",
            ],
        ),
        "tipo_cliente": (
            "dc.TIPO_CLIENTE",
            [f"LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE"],
        ),
        "linea_negocio": (
            "dgp.LINEA_NEGOCIO",
            [f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"],
        ),
        "unidad_medida_venta": (
            "UPPER(TRIM(fv.UNIDAD_MEDIDA_VENTA))",
            [],
        ),
        "descripcion_parte": (
            "dp.DESCRIPCION",
            [f"LEFT JOIN (SELECT CODIGO_PRODUCTO, DESCRIPCION FROM {cfg.TM('DIM_PARTE')} QUALIFY ROW_NUMBER() OVER (PARTITION BY CODIGO_PRODUCTO ORDER BY CODIGO_PRODUCTO) = 1) dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO"],
        ),
        "mercado": (
            "COALESCE(vm.MERCADO, 'Exportación')",
            [f"LEFT JOIN (SELECT VENDEDOR, MERCADO FROM (SELECT VENDEDOR, MERCADO, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) vm ON fv.CODIGO_VENDEDOR = vm.VENDEDOR"],
        ),
        "organico": (
            "COALESCE(ppv.TIPO_VENTA, 'Organico')",
            [f"LEFT JOIN (SELECT VENDEDOR, TIPO_VENTA FROM (SELECT VENDEDOR, TIPO_VENTA, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) ppv ON fv.CODIGO_VENDEDOR = ppv.VENDEDOR"],
        ),
    }

    dim_col, joins = DIM_MAP[group_by]
    joins = list(joins)
    cond  = ["fv.ANO_FISCAL = %s", f"{dim_col} IS NOT NULL"]
    params: list = [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    elif mes_max:
        cond.append("fv.PERIODO_FISCAL <= %s"); params.append(mes_max)

    if region and group_by != "region":
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor and group_by != "vendedor":
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if grupo_comercial and group_by not in ("grupo_comercial", "planta", "linea_negocio"):
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if not any("DIM_GRUPO_COMERCIAL" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
        cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
    if excl_exportacion:
        if group_by != "region" and not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    seen, uniq = set(), []
    for j in joins:
        if j not in seen:
            seen.add(j); uniq.append(j)

    join_str  = " ".join(uniq)
    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            {dim_col}                              AS dimension,
            COALESCE(SUM(fv.VENTAS_NETAS),   0)   AS ventas_netas,
            COALESCE(SUM(fv.VENTAS_DOLARES), 0)   AS ventas_dolares,
            COALESCE(SUM(fv.CANTIDAD),       0)   AS cantidad,
            COUNT(DISTINCT fv.NUMERO_CLIENTE)     AS num_clientes,
            COUNT(*)                              AS num_transacciones,
            COALESCE(AVG(fv.VENTAS_NETAS),   0)   AS ticket_promedio
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        GROUP BY 1
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    return sql, params, dim_col, uniq


@router.get("")
def get_segments(
    group_by: str = Query("region", pattern=_VALID_GROUPS),
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    top_n: int = Query(15, ge=1, le=50),
    compare: bool = Query(True, description="Include YoY/MoM comparison"),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = f"seg:{group_by}:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{top_n}:{compare}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    kw = dict(excl_exportacion=excl_exportacion, excl_pvta=excl_pvta)
    df_pp = df_pp_cant = None

    try:
        sql, params, dim_col, uniq = _build_sql(cfg, group_by, ano, mes, region, vendedor, grupo_comercial, planta, top_n, mes_fin=mes_fin, **kw)
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]

        # For full-year view of current year, cap previous year at same YTD month
        today = date.today()
        ytd_cap = today.month if (not mes and ano == today.year) else None

        df_ant = df_mom = None
        if compare:
            sql_ant, p_ant, _, _ = _build_sql(cfg, group_by, ano - 1, mes, region, vendedor, grupo_comercial, planta, 9999, mes_max=ytd_cap, mes_fin=mes_fin, **kw)
            df_ant = connector.query(sql_ant, p_ant)
            df_ant.columns = [c.lower() for c in df_ant.columns]
            df_ant = df_ant.rename(columns={"ventas_netas": "ventas_netas_ant", "cantidad": "cantidad_ant"})

            if mes and not mes_fin:
                mes_ant = mes - 1 if mes > 1 else 12
                ano_mom = ano if mes > 1 else ano - 1
                sql_mom, p_mom, _, _ = _build_sql(cfg, group_by, ano_mom, mes_ant, region, vendedor, grupo_comercial, planta, 9999, **kw)
                df_mom = connector.query(sql_mom, p_mom)
                df_mom.columns = [c.lower() for c in df_mom.columns]
                df_mom = df_mom.rename(columns={"ventas_netas": "ventas_mes_ant"})

        # ── PP por dimensión ──────────────────────────────────────────────────
        def _pp_base_cond():
            c, p = ["ANO = %s"], [ano]
            if mes and mes_fin and mes_fin > mes:
                c.append("MES_NUM BETWEEN %s AND %s"); p.extend([mes, mes_fin])
            elif mes:
                c.append("MES_NUM = %s"); p.append(mes)
            return c, p

        if group_by in ("linea_negocio", "grupo_comercial", "region"):
            col = {"linea_negocio": "LINEA_NEGOCIO", "grupo_comercial": "GRUPO_COMERCIAL", "region": "REGION"}[group_by]
            c, p = _pp_base_cond()
            if region and group_by != "region":
                c.append("REGION = %s"); p.append(region)
            if planta:
                c.append("PLANTA = %s"); p.append(planta)
            if grupo_comercial and group_by != "grupo_comercial":
                c.append("GRUPO_COMERCIAL = %s"); p.append(grupo_comercial)
            if excl_exportacion:
                c.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
            sql_pp = f"SELECT {col} AS dimension, COALESCE(SUM(PRESUPUESTO_MES),0) AS presupuesto FROM {cfg.T('PP_REGION_PLANTA_GRUPO')} WHERE {' AND '.join(c)} GROUP BY 1"
            logger.info(f"DEBUG BUDGET SQL: {sql_pp} | Params: {p}")
            df_pp = connector.query(sql_pp, p)
            logger.info(f"DEBUG BUDGET ROWS: {len(df_pp)}")
            if not df_pp.empty:
                df_pp.columns = [c2.lower() for c2 in df_pp.columns]

        elif group_by in ("unidad_medida_venta", "mercado", "organico"):
            pp_dim_col = {"unidad_medida_venta": "UNIDAD_MEDIDA", "mercado": "MERCADO", "organico": "TIPO_VENTA"}[group_by]
            c, p = _pp_base_cond()
            if region:
                c.append("REGION = %s"); p.append(region)
            if planta:
                c.append("PLANTA = %s"); p.append(planta)
            if grupo_comercial:
                c.append("GRUPO_COMERCIAL = %s"); p.append(grupo_comercial)
            if excl_exportacion:
                c.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
            if excl_pvta:
                c.append("UPPER(VENDEDOR) NOT LIKE 'PVTA%%'")
            wh = " AND ".join(c)
            df_pp = connector.query(
                f"SELECT {pp_dim_col} AS dimension, COALESCE(SUM(PP_VALOR_MES),0) AS presupuesto "
                f"FROM {cfg.T('PP_VENDEDOR_VALOR')} WHERE {wh} GROUP BY 1", p
            )
            if not df_pp.empty:
                df_pp.columns = [c2.lower() for c2 in df_pp.columns]
            if group_by == "unidad_medida_venta":
                df_pp_cant = connector.query(
                    f"SELECT UNIDAD_MEDIDA AS dimension, COALESCE(SUM(PP_CANTIDAD_MES),0) AS presupuesto_cantidad "
                    f"FROM {cfg.T('PP_VENDEDOR_CANTIDAD')} WHERE {wh} GROUP BY 1", p
                )
                if not df_pp_cant.empty:
                    df_pp_cant.columns = [c2.lower() for c2 in df_pp_cant.columns]

    except Exception as exc:
        logger.error("Segments error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # Pre-process dimension strings to avoid merge failures due to spaces
    df["dimension"] = df["dimension"].astype(str).str.strip().str.upper()
    if df_ant is not None:
        df_ant["dimension"] = df_ant["dimension"].astype(str).str.strip().str.upper()
        df = df.merge(df_ant[["dimension", "ventas_netas_ant"]], on="dimension", how="left")
        df["ventas_netas_ant"] = df["ventas_netas_ant"].fillna(0)
    
    if df_mom is not None:
        df_mom["dimension"] = df_mom["dimension"].astype(str).str.strip().str.upper()
        df = df.merge(df_mom[["dimension", "ventas_mes_ant"]], on="dimension", how="left")
        df["ventas_mes_ant"] = df["ventas_mes_ant"].fillna(0)

    # Merge PP data
    if df_pp is not None and not df_pp.empty:
        df_pp["dimension"] = df_pp["dimension"].astype(str).str.strip().str.upper()
        df = df.merge(df_pp, on="dimension", how="left")
        df["presupuesto"] = df["presupuesto"].fillna(0)
    if df_pp_cant is not None and not df_pp_cant.empty:
        df_pp_cant["dimension"] = df_pp_cant["dimension"].astype(str).str.strip().str.upper()
        df = df.merge(df_pp_cant, on="dimension", how="left")
        df["presupuesto_cantidad"] = df["presupuesto_cantidad"].fillna(0)

    has_pp      = "presupuesto" in df.columns
    has_pp_cant = "presupuesto_cantidad" in df.columns

    total = float(df["ventas_netas"].sum()) or 1.0
    records = []
    for _, r in df.iterrows():
        vn     = float(r.ventas_netas or 0)
        vn_ant = float(r.get("ventas_netas_ant") or 0) if "ventas_netas_ant" in r else None
        vn_mom = float(r.get("ventas_mes_ant") or 0) if "ventas_mes_ant" in r else None

        def _pct(a, b):
            return round((a / b - 1) * 100, 2) if b and b != 0 else None

        rec = {
            "dimension":         str(r.dimension or ""),
            "ventas_netas":      round(vn, 2),
            "ventas_dolares":    round(float(r.ventas_dolares or 0), 2),
            "cantidad":          round(float(r.cantidad or 0), 2),
            "num_clientes":      int(r.num_clientes or 0),
            "num_transacciones": int(r.num_transacciones or 0),
            "ticket_promedio":   round(float(r.ticket_promedio or 0), 2),
            "participacion_pct": round((vn / total) * 100, 2),
        }
        if vn_ant is not None:
            rec["ventas_netas_ant"]   = round(vn_ant, 2)
            rec["variacion_yoy_pct"]  = _pct(vn, vn_ant)
        if vn_mom is not None:
            rec["ventas_mes_ant"]     = round(vn_mom, 2)
            rec["variacion_mom_pct"]  = _pct(vn, vn_mom)
        if has_pp:
            pp = float(r.get("presupuesto") or 0)
            rec["presupuesto"]  = round(pp, 2)
            rec["cump_pp_pct"]  = round((vn / pp) * 100, 2) if pp > 0 else None
        if has_pp_cant:
            pp_c = float(r.get("presupuesto_cantidad") or 0)
            cant = float(r.cantidad or 0)
            rec["presupuesto_cantidad"]    = round(pp_c, 2)
            rec["cump_pp_cantidad_pct"]    = round((cant / pp_c) * 100, 2) if pp_c > 0 else None
        records.append(rec)

    result = {"group_by": group_by, "ano": ano, "mes": mes, "data": records}
    cache.set(key, result)
    return result
