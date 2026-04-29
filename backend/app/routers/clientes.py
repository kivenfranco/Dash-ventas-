"""
GET /api/clientes — Clientes que compraron en el período con su estado y asesor.
Cuenta desde FACT_VENTAS (no desde el snapshot estático de DIM_ESTADO_CLIENTE),
así los filtros como excl_pvta afectan correctamente los totales.
"""
import logging
import math
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/clientes", tags=["Clientes"])
logger = logging.getLogger(__name__)


def _build_filters(cfg, ano, mes, region, vendedor, grupo_comercial, planta,
                   excl_exportacion, excl_pvta, ytd_cap=None, mes_fin=None):
    joins, cond, params = [], ["fv.ANO_FISCAL = %s"], [ano]
    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s"); params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    elif ytd_cap:
        cond.append("fv.PERIODO_FISCAL <= %s"); params.append(ytd_cap)

    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if grupo_comercial:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
        cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
    if planta:
        if not any("DIM_GRUPO_PRODUCTO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        cond.append("dgp.PLANTA = %s"); params.append(planta)
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
    return uniq, cond, params


@router.get("/estados")
def get_clientes_estados(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    """Clientes únicos que compraron en el período, agrupados por ESTADO_CLIENTE."""
    cfg = get_settings()
    key = f"cli_est:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}"
    if cached := cache.get(key):
        return cached

    joins, cond, params = _build_filters(cfg, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, mes_fin=mes_fin)
    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            COALESCE(dec.ESTADO_CLIENTE, 'OTROS') AS estado,
            COUNT(DISTINCT fv.NUMERO_CLIENTE)      AS cnt,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)      AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        LEFT JOIN {cfg.T('DIM_ESTADO_CLIENTE')} dec ON fv.ID_CLIENTE = dec.ID_CLIENTE
        {where_str}
        GROUP BY 1
        ORDER BY cnt DESC
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Clientes estados error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    estados: dict = {}
    total = 0
    for _, r in df.iterrows():
        est = str(r.estado or "").upper()
        cnt = int(r.cnt or 0)
        vn  = round(float(r.ventas_netas or 0), 2)
        total += cnt
        estados[est] = {"cnt": cnt, "ventas_netas": vn}

    result = {
        "total_clientes":      total,
        "clientes_activos":    estados.get("ACTIVO",     {}).get("cnt", 0),
        "clientes_nuevos":     estados.get("NUEVO",      {}).get("cnt", 0),
        "clientes_perdidos":   estados.get("PERDIDO",    {}).get("cnt", 0),
        "clientes_riesgo":     estados.get("RIESGO",     {}).get("cnt", 0),
        "clientes_seguimiento":estados.get("SEGUIMIENTO",{}).get("cnt", 0),
        "detalle": [
            {"estado": k, "cnt": v["cnt"], "ventas_netas": v["ventas_netas"]}
            for k, v in sorted(estados.items(), key=lambda x: -x[1]["cnt"])
        ],
    }
    cache.set(key, result)
    return result


@router.get("/lista")
def get_clientes_lista(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
    estado: Optional[str] = Query(None),
    top_n: int = Query(100, ge=1, le=500),
):
    """Lista de clientes que compraron en el período con estado, asesor y variación YoY."""
    cfg = get_settings()
    key = f"cli_lst:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}:{estado}:{top_n}"
    if cached := cache.get(key):
        return cached

    joins, cond, params = _build_filters(cfg, ano, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, mes_fin=mes_fin)
    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(cond)

    estado_filter = ""
    outer_params = list(params)
    if estado:
        estado_filter = "WHERE UPPER(COALESCE(dec.ESTADO_CLIENTE, '')) = %s"
        outer_params.append(estado.upper())

    sql_cur = f"""
        WITH base AS (
            SELECT
                fv.NUMERO_CLIENTE,
                MAX(fv.ID_CLIENTE)                        AS id_cliente,
                fv.CODIGO_VENDEDOR,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)         AS ventas_netas,
                COALESCE(SUM(fv.CANTIDAD), 0)             AS cantidad,
                COUNT(DISTINCT fv.NUMERO_FACTURA)         AS num_facturas
            FROM {cfg.T('FACT_VENTAS')} fv
            {join_str}
            {where_str}
            GROUP BY fv.NUMERO_CLIENTE, fv.CODIGO_VENDEDOR
        )
        SELECT
            b.NUMERO_CLIENTE,
            b.CODIGO_VENDEDOR,
            b.ventas_netas,
            b.cantidad,
            b.num_facturas,
            dc.NOMBRE,
            dc.TIPO_CLIENTE,
            dv.NOMBRE  AS nombre_vendedor,
            dec.ESTADO_CLIENTE
        FROM base b
        LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc  ON b.NUMERO_CLIENTE  = dc.NUMERO_CLIENTE
        LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv  ON b.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
        LEFT JOIN {cfg.T('DIM_ESTADO_CLIENTE')} dec ON b.id_cliente = dec.ID_CLIENTE
        {estado_filter}
        ORDER BY b.ventas_netas DESC
        LIMIT {top_n}
    """

    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None
    joins_a, cond_a, params_a = _build_filters(cfg, ano - 1, mes, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, ytd_cap, mes_fin=mes_fin)
    sql_ant = f"""
        SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas_ant
        FROM {cfg.T('FACT_VENTAS')} fv
        {' '.join(joins_a)}
        WHERE {' AND '.join(cond_a)}
        GROUP BY fv.NUMERO_CLIENTE
    """

    try:
        df     = connector.query(sql_cur, outer_params)
        df_ant = connector.query(sql_ant, params_a)
        df.columns     = [c.lower() for c in df.columns]
        df_ant.columns = [c.lower() for c in df_ant.columns]
    except Exception as exc:
        logger.error("Clientes lista error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df = df.merge(df_ant, on="numero_cliente", how="left")
    df["ventas_netas_ant"] = df["ventas_netas_ant"].fillna(0)

    def _s(v, fb=""):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return fb
        return str(v)

    def _pct(a, b):
        return round((a / b - 1) * 100, 2) if b and b != 0 else None

    records = []
    for _, r in df.iterrows():
        vn = float(r.ventas_netas or 0)
        va = float(r.ventas_netas_ant or 0)
        records.append({
            "numero_cliente":   _s(r.numero_cliente),
            "nombre":           _s(r.get("nombre"), _s(r.numero_cliente)),
            "tipo_cliente":     _s(r.get("tipo_cliente")),
            "estado":           _s(r.get("estado_cliente")),
            "vendedor":         _s(r.get("codigo_vendedor")),
            "nombre_vendedor":  _s(r.get("nombre_vendedor")),
            "ventas_netas":     round(vn, 2),
            "ventas_netas_ant": round(va, 2),
            "variacion_yoy":    _pct(vn, va),
            "num_facturas":     int(r.get("num_facturas") or 0),
        })

    result = {"ano": ano, "mes": mes, "estado": estado, "total": len(records), "data": records}
    cache.set(key, result)
    return result
