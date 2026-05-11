"""
GET /api/atributos — Ventas agrupadas por atributos de producto (DIM_PARTE).
group_by: es_stock | estructura | dispositivo | tipo_producto | tipo_fabricacion
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/atributos", tags=["Atributos"])
logger = logging.getLogger(__name__)

_VALID_GROUPS = "^(es_stock|estructura|dispositivo|tipo_producto|tipo_fabricacion|descripcion_parte|linea_negocio|descripcion|grupo_comercial)$"

_DIM_MAP = {
    # (sql_expr, dim_source, filter_nulls)
    "es_stock":         ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",              "grupo_prod",  False),
    "estructura":       ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",              "grupo_prod",  False),
    "dispositivo":      ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",              "grupo_prod",  False),
    "tipo_producto":    ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",              "grupo_prod",  False),
    "tipo_fabricacion": ("dgc.TIPO_FABRICACION",                                       "grupo",       True),
    "descripcion_parte":("fv.CODIGO_PRODUCTO",                                         "ninguno",     True),
    "descripcion":      ("fv.CODIGO_PRODUCTO",                                         "ninguno",     True),
    "linea_negocio":    ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",              "grupo_prod",  False),
    "grupo_comercial":  ("COALESCE(dgc.NOMBRE_GRUPO, 'Sin Clasificar')",               "grupo",       False),
}


def _build_sql(cfg, group_by, ano, mes, region, vendedor, planta, grupo_comercial, mes_max=None, excl_exportacion=False, excl_pvta=False, top_n=20, mes_fin=None):
    dim_col, dim_src, filter_nulls = _DIM_MAP[group_by]

    joins = []
    if dim_src == "grupo_prod":
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
    if dim_src == "grupo":
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
    # dim_src == "ninguno": no join needed (uses fv columns directly)

    cond = ["fv.ANO_FISCAL = %s"]
    if filter_nulls:
        cond.append(f"{dim_col} IS NOT NULL")
    params: list = [ano]

    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    elif mes_max:
        cond.append("fv.PERIODO_FISCAL <= %s"); params.append(mes_max)

    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if planta:
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        cond.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)
    if grupo_comercial:
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if not any("DIM_GRUPO_COMERCIAL" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
        cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)

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

    join_str  = " ".join(uniq)
    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            {dim_col}                              AS dimension,
            COALESCE(SUM(fv.VENTAS_NETAS),   0)   AS ventas_netas,
            COALESCE(SUM(fv.VENTAS_DOLARES), 0)   AS ventas_dolares,
            COALESCE(SUM(fv.CANTIDAD),       0)   AS cantidad,
            COUNT(*)                              AS num_clientes,
            COUNT(DISTINCT fv.CODIGO_PRODUCTO)    AS num_productos
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        GROUP BY 1
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    return sql, params


@router.get("")
def get_atributos(
    group_by: str = Query("es_stock", pattern=_VALID_GROUPS),
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    planta: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    top_n: int = Query(20, ge=1, le=500),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = f"atr:{group_by}:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{planta}:{grupo_comercial}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None
    kw = dict(excl_exportacion=excl_exportacion, excl_pvta=excl_pvta, top_n=top_n)

    try:
        sql_cur, p_cur = _build_sql(cfg, group_by, ano, mes, region, vendedor, planta, grupo_comercial, mes_fin=mes_fin, **kw)
        df = connector.query(sql_cur, p_cur)
        df.columns = [c.lower() for c in df.columns]

        sql_ant, p_ant = _build_sql(cfg, group_by, ano - 1, mes, region, vendedor, planta, grupo_comercial, mes_max=ytd_cap, top_n=9999, mes_fin=mes_fin, **{k: v for k, v in kw.items() if k != 'top_n'})
        df_ant = connector.query(sql_ant, p_ant)
        df_ant.columns = [c.lower() for c in df_ant.columns]
        df_ant = df_ant.rename(columns={"ventas_netas": "ventas_netas_ant", "cantidad": "cantidad_ant"})

        df_mom = None
        if mes and not (mes_fin and mes_fin > mes):
            mes_ant = mes - 1 if mes > 1 else 12
            ano_mom = ano if mes > 1 else ano - 1
            sql_mom, p_mom = _build_sql(cfg, group_by, ano_mom, mes_ant, region, vendedor, planta, grupo_comercial, top_n=9999, **{k: v for k, v in kw.items() if k != 'top_n'})
            df_mom = connector.query(sql_mom, p_mom)
            df_mom.columns = [c.lower() for c in df_mom.columns]
            df_mom = df_mom.rename(columns={"ventas_netas": "ventas_mes_ant"})

    except Exception as exc:
        logger.error("Atributos error: %s | SQL: %.500s", exc, sql_cur if 'sql_cur' in dir() else 'N/A')
        raise HTTPException(status_code=503, detail=str(exc))

    df = df.merge(df_ant[["dimension", "ventas_netas_ant"]], on="dimension", how="left")
    df["ventas_netas_ant"] = df["ventas_netas_ant"].fillna(0)
    if df_mom is not None:
        df = df.merge(df_mom[["dimension", "ventas_mes_ant"]], on="dimension", how="left")
        df["ventas_mes_ant"] = df["ventas_mes_ant"].fillna(0)

    total = float(df["ventas_netas"].sum()) or 1.0

    def _pct(a, b):
        return round((a / b - 1) * 100, 2) if b and b != 0 else None

    records = []
    for _, r in df.iterrows():
        vn     = float(r.ventas_netas or 0)
        vn_ant = float(r.ventas_netas_ant or 0)
        rec = {
            "dimension":       str(r.dimension or ""),
            "ventas_netas":    round(vn, 2),
            "ventas_dolares":  round(float(r.ventas_dolares or 0), 2),
            "cantidad":        round(float(r.cantidad or 0), 2),
            "num_clientes":    int(r.num_clientes or 0),
            "num_productos":   int(r.num_productos or 0),
            "participacion_pct": round((vn / total) * 100, 2),
            "ventas_netas_ant":  round(vn_ant, 2),
            "variacion_yoy_pct": _pct(vn, vn_ant),
        }
        if df_mom is not None:
            vn_mom = float(r.get("ventas_mes_ant") or 0)
            rec["ventas_mes_ant"]    = round(vn_mom, 2)
            rec["variacion_mom_pct"] = _pct(vn, vn_mom)
        records.append(rec)

    result = {"group_by": group_by, "ano": ano, "mes": mes, "data": records}
    cache.set(key, result)
    return result
