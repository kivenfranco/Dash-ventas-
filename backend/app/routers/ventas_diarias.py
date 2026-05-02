"""
GET /api/ventas-diarias — Ventas por día de factura (FECHA_FACTURA).
"""
import logging
import math
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/ventas-diarias", tags=["Ventas Diarias"])
logger = logging.getLogger(__name__)


@router.get("")
def get_ventas_diarias(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
    limit: int = Query(90, ge=1, le=365),
):
    cfg = get_settings()
    key = f"vd:{ano}:{mes}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}:{limit}"
    cached = cache.get(key)
    if cached:
        return cached

    joins, cond, params = [], [], []

    cond.append("YEAR(fv.FECHA_FACTURA) = %s"); params.append(ano)
    if mes:
        cond.append("MONTH(fv.FECHA_FACTURA) = %s"); params.append(mes)

    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
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

    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            CAST(fv.FECHA_FACTURA AS DATE)        AS fecha,
            COALESCE(SUM(fv.VENTAS_NETAS),   0)   AS ventas_netas,
            COALESCE(SUM(fv.VENTAS_DOLARES), 0)   AS ventas_dolares,
            COALESCE(SUM(fv.CANTIDAD),       0)   AS cantidad,
            COUNT(*)                              AS num_transacciones,
            COUNT(DISTINCT fv.CODIGO_VENDEDOR)    AS num_vendedores
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT {limit}
    """

    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        df = df.sort_values("fecha", ascending=False)
    except Exception as exc:
        logger.error("Ventas diarias error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # Calculate day-over-day change
    df_sorted = df.sort_values("fecha", ascending=True).reset_index(drop=True)
    df_sorted["ventas_ant"] = df_sorted["ventas_netas"].shift(1)
    df_sorted["var_dia_pct"] = df_sorted.apply(
        lambda r: round((r.ventas_netas / r.ventas_ant - 1) * 100, 3) if r.ventas_ant and r.ventas_ant > 0 else None,
        axis=1,
    )
    df_sorted = df_sorted.sort_values("fecha", ascending=False)

    records = []
    for _, r in df_sorted.iterrows():
        records.append({
            "fecha":            str(r.fecha),
            "ventas_netas":     round(float(r.ventas_netas or 0), 2),
            "ventas_dolares":   round(float(r.ventas_dolares or 0), 2),
            "cantidad":         round(float(r.cantidad or 0), 2),
            "num_transacciones": int(r.num_transacciones or 0),
            "num_vendedores":   int(r.num_vendedores or 0),
            "var_dia_pct":      None if (r.var_dia_pct is None or (isinstance(r.var_dia_pct, float) and math.isnan(r.var_dia_pct))) else r.var_dia_pct,
        })

    result = {"ano": ano, "mes": mes, "data": records}
    cache.set(key, result)
    return result


# Códigos fijos de puntos de venta
_PVTA_CALI = "PVTACALI"
_PVTA_NORT = "PVTANORT"
_PVTA_BOG  = "PBOGOTA"
# Todo PVTA* que NO sea CALI ni NORT → agrupa en PVTA MEDELLIN


@router.get("/pvta")
def get_ventas_diarias_pvta(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    limit: int = Query(120, ge=1, le=366),
):
    cfg = get_settings()
    key = f"vd_pvta:{ano}:{mes}:{mes_fin}:{limit}"
    cached = cache.get(key)
    if cached:
        return cached

    cond, params = [], []
    cond.append("YEAR(fv.FECHA_FACTURA) = %s"); params.append(ano)
    if mes and mes_fin and mes_fin > mes:
        cond.append("MONTH(fv.FECHA_FACTURA) BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("MONTH(fv.FECHA_FACTURA) = %s"); params.append(mes)
    cond.append("(UPPER(fv.CODIGO_VENDEDOR) LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR = %s)"); params.append(_PVTA_BOG)

    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            CAST(fv.FECHA_FACTURA AS DATE) AS fecha,
            COALESCE(SUM(CASE WHEN fv.CODIGO_VENDEDOR = %s THEN fv.VENTAS_NETAS END), 0) AS pvta_cali,
            COALESCE(SUM(CASE WHEN fv.CODIGO_VENDEDOR = %s THEN fv.VENTAS_NETAS END), 0) AS pvtanorte,
            COALESCE(SUM(CASE WHEN fv.CODIGO_VENDEDOR = %s THEN fv.VENTAS_NETAS END), 0) AS pbogota,
            COALESCE(SUM(CASE
                WHEN UPPER(fv.CODIGO_VENDEDOR) LIKE 'PVTA%%'
                 AND fv.CODIGO_VENDEDOR NOT IN (%s, %s)
                THEN fv.VENTAS_NETAS END), 0) AS pvta_medellin
        FROM {cfg.T('FACT_VENTAS')} fv
        {where_str}
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT {limit}
    """
    case_params = [_PVTA_CALI, _PVTA_NORT, _PVTA_BOG, _PVTA_CALI, _PVTA_NORT]

    try:
        df = connector.query(sql, case_params + params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Ventas diarias PVTA error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    records = []
    for _, r in df.iterrows():
        cali  = round(float(r.pvta_cali      or 0), 0)
        nort  = round(float(r.pvtanorte      or 0), 0)
        bog   = round(float(r.pbogota        or 0), 0)
        mede  = round(float(r.pvta_medellin  or 0), 0)
        records.append({
            "fecha":         str(r.fecha),
            "pvta_medellin": mede,
            "pvta_cali":     cali,
            "pvtanorte":     nort,
            "pbogota":       bog,
            "total":         mede + cali + nort + bog,
        })

    result = {"ano": ano, "mes": mes, "data": records}
    cache.set(key, result)
    return result
