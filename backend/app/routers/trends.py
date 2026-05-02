"""
GET /api/trends — Serie mensual (año completo).
FACT_VENTAS (VENTAS) + DIM_TIEMPO (MAESTROS) + PP_REGION_PLANTA_GRUPO (VENTAS)
"""

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/trends", tags=["Trends"])
logger = logging.getLogger(__name__)


@router.get("")
def get_trends(
    ano: int = Query(default_factory=lambda: date.today().year),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = f"trends:{ano}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    # Build dimension joins & conditions
    dim_joins, dim_cond, dim_params = [], [], []
    if region:
        dim_joins.append(
            f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
        )
        dim_cond.append("dd.DESCRIPCION_REGION = %s"); dim_params.append(region)
    if vendedor:
        dim_cond.append("fv.CODIGO_VENDEDOR = %s"); dim_params.append(vendedor)
    if grupo_comercial or planta:
        dim_joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if grupo_comercial:
            dim_joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
            dim_cond.append("dgc.NOMBRE_GRUPO = %s"); dim_params.append(grupo_comercial)
        if planta:
            dim_cond.append("dgp.LINEA_NEGOCIO = %s"); dim_params.append(planta)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in dim_joins):
            dim_joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        dim_cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        dim_cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    join_str = " ".join(dim_joins)
    extra_where = (" AND " + " AND ".join(dim_cond)) if dim_cond else ""

    _mes_case = (
        "CASE fv.PERIODO_FISCAL "
        "WHEN 1 THEN 'Ene' WHEN 2 THEN 'Feb' WHEN 3 THEN 'Mar' WHEN 4 THEN 'Abr' "
        "WHEN 5 THEN 'May' WHEN 6 THEN 'Jun' WHEN 7 THEN 'Jul' WHEN 8 THEN 'Ago' "
        "WHEN 9 THEN 'Sep' WHEN 10 THEN 'Oct' WHEN 11 THEN 'Nov' WHEN 12 THEN 'Dic' "
        "END"
    )

    # ── Current year facts ────────────────────────────────────────────────────
    fact_sql = f"""
        SELECT
            fv.PERIODO_FISCAL                   AS mes_num,
            {_mes_case}                         AS mes_nombre,
            COALESCE(SUM(fv.VENTAS_NETAS),  0)  AS ventas_netas,
            COALESCE(SUM(fv.VENTAS_DOLARES),0)  AS ventas_dolares,
            COALESCE(SUM(fv.CANTIDAD),      0)  AS cantidad
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        WHERE fv.ANO_FISCAL = %s {extra_where}
        GROUP BY 1, 2
        ORDER BY 1
    """

    # ── Previous year (same dimensions, same months only) ────────────────────
    prev_sql = f"""
        SELECT
            fv.PERIODO_FISCAL                   AS mes_num,
            COALESCE(SUM(fv.VENTAS_NETAS),  0)  AS ventas_netas_ant
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        WHERE fv.ANO_FISCAL = %s {extra_where}
        GROUP BY 1
        ORDER BY 1
    """
    # This is already month-level — the merge on mes_num ensures we only compare matching months

    # ── PP by month ───────────────────────────────────────────────────────────
    pp_cond, pp_params = ["ANO = %s"], [ano]
    if region:          pp_cond.append("REGION = %s");         pp_params.append(region)
    if grupo_comercial: pp_cond.append("GRUPO_COMERCIAL = %s"); pp_params.append(grupo_comercial)
    if planta:          pp_cond.append("PLANTA = %s");         pp_params.append(planta)
    if excl_exportacion: pp_cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
    pp_sql = f"""
        SELECT MES_NUM AS mes_num, COALESCE(SUM(PRESUPUESTO_MES),0) AS pp_mes
        FROM {cfg.T('PP_REGION_PLANTA_GRUPO')}
        WHERE {' AND '.join(pp_cond)}
        GROUP BY 1 ORDER BY 1
    """

    try:
        df_f  = connector.query(fact_sql, [ano] + dim_params)
        df_p  = connector.query(prev_sql, [ano - 1] + dim_params)
        df_pp = connector.query(pp_sql, pp_params)
    except Exception as exc:
        logger.error("Trends error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df_f.columns  = [c.lower() for c in df_f.columns]
    df_p.columns  = [c.lower() for c in df_p.columns]
    df_pp.columns = [c.lower() for c in df_pp.columns]

    merged = df_f.merge(df_p,  on="mes_num", how="left") \
                 .merge(df_pp, on="mes_num", how="left")
    merged["pp_mes"]          = merged["pp_mes"].fillna(0)
    merged["ventas_netas_ant"] = merged["ventas_netas_ant"].fillna(0)
    merged["variacion_yoy_pct"] = merged.apply(
        lambda r: round(((r.ventas_netas - r.ventas_netas_ant) / abs(r.ventas_netas_ant)) * 100, 2)
        if r.ventas_netas_ant != 0 else None, axis=1
    )
    merged["diferencia_yoy"] = merged["ventas_netas"] - merged["ventas_netas_ant"]

    response = {"ano": ano, "series": merged.to_dict(orient="records")}
    cache.set(key, response)
    return response
