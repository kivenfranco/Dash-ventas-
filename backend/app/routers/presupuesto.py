"""
GET /api/presupuesto — Análisis presupuesto vs ventas reales por dimensión.

PP granular (PP_REGION_PLANTA_GRUPO):  region, planta, grupo_comercial, linea_negocio.
PP vendedor (PP_VENDEDOR_VALOR):        mercado, unidad_medida_venta.
PP total    (PP_VENDEDOR_VALOR sum):    tipo_fabricacion, tipo_cliente (sin desglose).
Solo hay PP para el año 2026; años anteriores solo muestran ventas + YoY.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/presupuesto", tags=["Presupuesto"])
logger = logging.getLogger(__name__)

PP_AÑO = 2026

# Per-dimension PP from PP_REGION_PLANTA_GRUPO (PRESUPUESTO_MES)
_GRANULAR = {"region", "planta", "grupo_comercial", "linea_negocio"}

# Per-dimension PP from PP_VENDEDOR_VALOR (PP_VALOR_MES)
_VENDEDOR_PP_DIMS = {"mercado", "unidad_medida_venta"}

# Column name in PP_VENDEDOR_VALOR for each _VENDEDOR_PP_DIMS dimension
_PP_VENDEDOR_COL = {
    "mercado":            "MERCADO",
    "unidad_medida_venta": "UNIDAD_MEDIDA",
}

_VALID = (
    r"^(region|planta|grupo_comercial|mercado|linea_negocio"
    r"|tipo_fabricacion|unidad_medida_venta|tipo_cliente)$"
)


def _dim_cfg(cfg, group_by: str):
    """Returns (dim_col, joins_list) for the sales fact query."""
    return {
        "region": (
            "dd.DESCRIPCION_REGION",
            [f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"],
        ),
        "planta": (
            "dgp.PLANTA",
            [f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"],
        ),
        "grupo_comercial": (
            "dgc.NOMBRE_GRUPO",
            [
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO",
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO",
            ],
        ),
        "mercado": (
            "COALESCE(vm.MERCADO, 'Exportación')",
            [f"LEFT JOIN (SELECT VENDEDOR, MERCADO FROM (SELECT VENDEDOR, MERCADO, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) vm ON fv.CODIGO_VENDEDOR = vm.VENDEDOR"],
        ),
        "linea_negocio": (
            "dgp.LINEA_NEGOCIO",
            [f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"],
        ),
        "tipo_fabricacion": (
            "dgc.TIPO_FABRICACION",
            [
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO",
                f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO",
            ],
        ),
        "unidad_medida_venta": ("fv.UNIDAD_MEDIDA_VENTA", []),
        "tipo_cliente": (
            "dc.TIPO_CLIENTE",
            [f"LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE"],
        ),
    }[group_by]


def _fact_query(cfg, dim_col, dim_joins, ano, mes, mes_max,
                region, vendedor, grupo_comercial, planta,
                excl_exportacion, excl_pvta, top_n, mes_fin=None):
    joins = list(dim_joins)
    cond, params = [f"{dim_col} IS NOT NULL", "fv.ANO_FISCAL = %s"], [ano]

    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    elif mes_max:
        cond.append("fv.PERIODO_FISCAL <= %s"); params.append(mes_max)

    if region:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if grupo_comercial:
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if not any("DIM_GRUPO_COMERCIAL" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
        cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
    if planta:
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        cond.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    seen, uniq = set(), []
    for j in joins:
        if j not in seen:
            seen.add(j); uniq.append(j)

    limit = f"LIMIT {top_n}" if top_n else ""
    sql = f"""
        SELECT {dim_col} AS dimension,
               COALESCE(SUM(fv.VENTAS_NETAS),   0) AS ventas_netas,
               COALESCE(SUM(fv.VENTAS_DOLARES), 0) AS ventas_dolares,
               COALESCE(SUM(fv.CANTIDAD),       0) AS cantidad
        FROM {cfg.T('FACT_VENTAS')} fv
        {' '.join(uniq)}
        WHERE {' AND '.join(cond)}
        GROUP BY 1
        ORDER BY 2 DESC
        {limit}
    """
    return sql, params


def _pp_granular(cfg, group_by, ano, mes, region, grupo_comercial, planta, excl_exportacion=False, mes_fin=None):
    """Per-dim PP from PP_REGION_PLANTA_GRUPO (region, planta, grupo_comercial, linea_negocio)."""
    col = {
        "region": "REGION", "planta": "PLANTA",
        "grupo_comercial": "GRUPO_COMERCIAL", "linea_negocio": "LINEA_NEGOCIO",
    }[group_by]
    cond, params = ["ANO = %s"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("MES_NUM = %s"); params.append(mes)
    if region and group_by != "region":
        cond.append("REGION = %s"); params.append(region)
    if grupo_comercial and group_by != "grupo_comercial":
        cond.append("GRUPO_COMERCIAL = %s"); params.append(grupo_comercial)
    if planta and group_by != "planta":
        cond.append("PLANTA = %s"); params.append(planta)
    if excl_exportacion:
        cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")

    sql = f"""
        SELECT {col} AS dimension, COALESCE(SUM(PRESUPUESTO_MES), 0) AS presupuesto
        FROM {cfg.T('PP_REGION_PLANTA_GRUPO')}
        WHERE {' AND '.join(cond)}
        GROUP BY 1
    """
    df = connector.query(sql, params)
    if df.empty:
        return {}
    df.columns = [c.lower() for c in df.columns]
    return {str(r.dimension): float(r.presupuesto) for _, r in df.iterrows()}


def _pp_vendedor_dim(cfg, pp_col, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion=False, excl_pvta=False, mes_fin=None):
    """Per-dim PP from PP_VENDEDOR_VALOR (mercado, unidad_medida)."""
    cond, params = ["ANO = %s", f"{pp_col} IS NOT NULL"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("MES_NUM = %s"); params.append(mes)
    if region:
        cond.append("REGION = %s"); params.append(region)
    if vendedor:
        cond.append("VENDEDOR = %s"); params.append(vendedor)
    if grupo_comercial:
        cond.append("GRUPO_COMERCIAL = %s"); params.append(grupo_comercial)
    if planta:
        cond.append("PLANTA = %s"); params.append(planta)
    if excl_exportacion:
        cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
    if excl_pvta:
        cond.append("UPPER(VENDEDOR) NOT LIKE 'PVTA%%'")

    sql = f"""
        SELECT {pp_col} AS dimension, COALESCE(SUM(PP_VALOR_MES), 0) AS presupuesto
        FROM {cfg.T('PP_VENDEDOR_VALOR')}
        WHERE {' AND '.join(cond)}
        GROUP BY 1
    """
    df = connector.query(sql, params)
    if df.empty:
        return {}
    df.columns = [c.lower() for c in df.columns]
    return {str(r.dimension): float(r.presupuesto) for _, r in df.iterrows()}


def _pp_vendedor_total(cfg, ano, mes, vendedor, excl_exportacion=False, excl_pvta=False, mes_fin=None):
    """Total PP from PP_VENDEDOR_VALOR (for dims without per-dim breakdown)."""
    cond, params = ["ANO = %s"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("MES_NUM = %s"); params.append(mes)
    if vendedor:
        cond.append("VENDEDOR = %s"); params.append(vendedor)
    if excl_exportacion:
        cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
    if excl_pvta:
        cond.append("UPPER(VENDEDOR) NOT LIKE 'PVTA%%'")
    sql = f"""
        SELECT COALESCE(SUM(PP_VALOR_MES), 0) AS total_pp
        FROM {cfg.T('PP_VENDEDOR_VALOR')}
        WHERE {' AND '.join(cond)}
    """
    df = connector.query(sql, params)
    return float(df.iloc[0]["TOTAL_PP"]) if not df.empty else 0.0


def _working_days(cfg, ano, mes, mes_fin=None):
    cond, params = ["ANO = %s"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("MES_NUM = %s"); params.append(mes)
    today = date.today().isoformat()
    sql = f"""
        SELECT COALESCE(SUM(DIA_HABIL), 0) AS dias_mes,
               COALESCE(SUM(CASE WHEN FECHA <= '{today}' THEN DIA_HABIL ELSE 0 END), 0) AS dias_trans
        FROM {cfg.TM('DIM_TIEMPO')}
        WHERE {' AND '.join(cond)}
    """
    df = connector.query(sql, params)
    if df.empty:
        return 0, 0
    r = df.iloc[0]
    return int(r["DIAS_MES"]), int(r["DIAS_TRANS"])


def _organico(cfg, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, mes_fin=None):
    """Ventas orgánicas vs inorgánicas según DIM_ESTADO_CLIENTE.ESTADO_CLIENTE."""
    joins = [f"LEFT JOIN {cfg.T('DIM_ESTADO_CLIENTE')} dec ON fv.ID_CLIENTE = dec.ID_CLIENTE"]
    cond, params = ["fv.ANO_FISCAL = %s"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    sql = f"""
        SELECT
            CASE WHEN UPPER(COALESCE(dec.ESTADO_CLIENTE,'')) = 'NUEVO' THEN 'Inorgánica' ELSE 'Orgánica' END AS tipo,
            COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        {' '.join(joins)}
        WHERE {' AND '.join(cond)}
        GROUP BY 1
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        result = {"organica": 0.0, "inorganica": 0.0}
        for _, r in df.iterrows():
            key = "inorganica" if str(r.tipo) == "Inorgánica" else "organica"
            result[key] = round(float(r.ventas_netas or 0), 2)
        return result
    except Exception as exc:
        logger.warning("Organic/inorganic query failed: %s", exc)
        return {"organica": None, "inorganica": None}


@router.get("")
def get_presupuesto(
    group_by: str = Query("region", pattern=_VALID),
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    top_n: int = Query(30, ge=1, le=100),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = (
        f"pp:{group_by}:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}"
        f":{planta}:{top_n}:{excl_exportacion}:{excl_pvta}"
    )
    cached = cache.get(key)
    if cached:
        return cached

    dim_col, dim_joins = _dim_cfg(cfg, group_by)
    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None
    has_pp = (ano == PP_AÑO)
    has_per_dim_pp = group_by in _GRANULAR or group_by in _VENDEDOR_PP_DIMS

    try:
        sql, params = _fact_query(
            cfg, dim_col, dim_joins, ano, mes, None,
            region, vendedor, grupo_comercial, planta,
            excl_exportacion, excl_pvta, top_n, mes_fin=mes_fin,
        )
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]

        sql_ant, params_ant = _fact_query(
            cfg, dim_col, dim_joins, ano - 1, mes, ytd_cap,
            region, vendedor, grupo_comercial, planta,
            excl_exportacion, excl_pvta, None, mes_fin=mes_fin,
        )
        df_ant = connector.query(sql_ant, params_ant)
        if not df_ant.empty:
            df_ant.columns = [c.lower() for c in df_ant.columns]
            df_ant = df_ant.rename(columns={"ventas_netas": "ventas_netas_ant"})

        pp_by_dim: dict = {}
        total_pp = 0.0
        if has_pp:
            if group_by in _GRANULAR:
                pp_by_dim = _pp_granular(cfg, group_by, ano, mes, region, grupo_comercial, planta, excl_exportacion, mes_fin=mes_fin)
            elif group_by in _VENDEDOR_PP_DIMS:
                pp_col = _PP_VENDEDOR_COL[group_by]
                pp_by_dim = _pp_vendedor_dim(cfg, pp_col, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, mes_fin=mes_fin)
            else:
                total_pp = _pp_vendedor_total(cfg, ano, mes, vendedor, excl_exportacion, excl_pvta, mes_fin=mes_fin)

        dias_mes, dias_trans = _working_days(cfg, ano, mes, mes_fin=mes_fin)
        org = _organico(cfg, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, mes_fin=mes_fin)

    except Exception as exc:
        logger.error("Presupuesto error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if not df_ant.empty:
        df = df.merge(df_ant[["dimension", "ventas_netas_ant"]], on="dimension", how="left")
        df["ventas_netas_ant"] = df["ventas_netas_ant"].fillna(0)
    else:
        df["ventas_netas_ant"] = 0

    total_vn = float(df["ventas_netas"].sum()) or 1.0

    def _pct(a, b):
        return round((a / b - 1) * 100, 2) if b and b != 0 else None

    def _safe(a, b):
        return a / b if b and b != 0 else 0.0

    records = []
    for _, r in df.iterrows():
        vn     = float(r.ventas_netas or 0)
        vn_ant = float(r.get("ventas_netas_ant") or 0)
        dim    = str(r.dimension or "")

        pp = pp_by_dim.get(dim) if has_per_dim_pp else None
        debe_ser  = round(pp * _safe(dias_trans, dias_mes), 2) if pp else None
        cump_pp   = round(_safe(vn, pp) * 100, 2)             if pp else None
        cump_debe = round(_safe(vn, debe_ser) * 100, 2)        if debe_ser else None

        records.append({
            "dimension":         dim,
            "ventas_netas":      round(vn, 2),
            "ventas_netas_ant":  round(vn_ant, 2),
            "variacion_yoy_pct": _pct(vn, vn_ant),
            "participacion_pct": round(_safe(vn, total_vn) * 100, 2),
            "presupuesto":       round(pp, 2) if pp is not None else None,
            "debe_ser":          debe_ser,
            "cumplimiento_pct":  cump_pp,
            "cump_debe_ser_pct": cump_debe,
        })

    total_actual = float(df["ventas_netas"].sum())
    total_ant    = float(df["ventas_netas_ant"].sum()) if "ventas_netas_ant" in df else 0

    if has_per_dim_pp and pp_by_dim:
        sum_pp       = sum(pp_by_dim.values())
        sum_debe_ser = round(sum_pp * _safe(dias_trans, dias_mes), 2)
        summary = {
            "presupuesto":       round(sum_pp, 2),
            "debe_ser":          sum_debe_ser,
            "cumplimiento_pct":  round(_safe(total_actual, sum_pp) * 100, 2),
            "cump_debe_ser_pct": round(_safe(total_actual, sum_debe_ser) * 100, 2),
        }
    elif has_pp and total_pp:
        debe_ser_tot = round(total_pp * _safe(dias_trans, dias_mes), 2)
        summary = {
            "presupuesto":       round(total_pp, 2),
            "debe_ser":          debe_ser_tot,
            "cumplimiento_pct":  round(_safe(total_actual, total_pp) * 100, 2),
            "cump_debe_ser_pct": round(_safe(total_actual, debe_ser_tot) * 100, 2),
        }
    else:
        summary = {}

    result = {
        "group_by":                   group_by,
        "ano":                        ano,
        "mes":                        mes,
        "has_pp":                     has_pp and (bool(pp_by_dim) or total_pp > 0),
        "pp_granular":                has_per_dim_pp,
        "dias_habiles_mes":           dias_mes,
        "dias_habiles_transcurridos": dias_trans,
        "ventas_totales":             round(total_actual, 2),
        "ventas_ant_totales":         round(total_ant, 2),
        "variacion_yoy_total":        _pct(total_actual, total_ant),
        "organico":                   org,
        "summary":                    summary,
        "data":                       records,
    }
    cache.set(key, result)
    return result
