"""
GET /api/clientes — Clasificación dinámica de clientes desde FACT_VENTAS.
No depende de DIM_ESTADO_CLIENTE. La clasificación varía según el período filtrado.

  NUEVO       — Primera compra (dentro del contexto del filtro) cae en el período seleccionado
  RECUPERADO  — Compró en el período Y su última compra previa fue hace ≥ 12 meses
  ACTIVO      — Última compra hace < 4 meses desde el fin del período
  SEGUIMIENTO — Última compra hace 4–7 meses
  RIESGO      — Última compra hace 8–11 meses
  PERDIDO     — Última compra hace ≥ 12 meses
"""
import calendar
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


def _ref_dates(ano: int, mes: Optional[int], mes_fin: Optional[int]) -> dict:
    mes_r  = mes_fin if mes_fin else (mes if mes else 12)
    mes_s  = mes if mes else 1
    ld     = calendar.monthrange(ano,     mes_r)[1]
    ld_ant = calendar.monthrange(ano - 1, mes_r)[1]
    return {
        "ref":        f"'{ano}-{mes_r:02d}-{ld:02d}'::DATE",
        "pstart":     f"'{ano}-{mes_s:02d}-01'::DATE",
        "pstart_ant": f"'{ano-1}-{mes_s:02d}-01'::DATE",
        "pend_ant":   f"'{ano-1}-{mes_r:02d}-{ld_ant:02d}'::DATE",
    }


def _dim_filters(cfg, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, excl_ecommerce=False):
    joins, cond, params = [], [], []
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
        cond.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        joins.append(
            f"LEFT JOIN (SELECT VENDEDOR, MERCADO FROM "
            f"(SELECT VENDEDOR, MERCADO, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn "
            f"FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) vm_excl ON fv.CODIGO_VENDEDOR = vm_excl.VENDEDOR"
        )
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' AND UPPER(COALESCE(vm_excl.MERCADO, '')) NOT LIKE '%%EXPORTACION%%')")

    if excl_pvta:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv_pvta ON fv.CODIGO_VENDEDOR = dv_pvta.CODIGO_VENDEDOR")
        cond.append("""(
            (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%'
             AND UPPER(fv.CODIGO_VENDEDOR) NOT IN ('PBOGOTA', 'PTVAPAST', 'PBOGMONTE', 'PBOG')
             AND UPPER(COALESCE(dv_pvta.NOMBRE, '')) NOT LIKE '%%PUNTO DE VENTA%%'
            ) OR fv.CODIGO_VENDEDOR IS NULL
        )""")

    if excl_ecommerce:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv_ecm ON fv.CODIGO_VENDEDOR = dv_ecm.CODIGO_VENDEDOR")
        cond.append("(UPPER(COALESCE(dv_ecm.NOMBRE, '')) NOT LIKE '%%ECOMMERCE%%' AND UPPER(COALESCE(dv_ecm.NOMBRE, '')) NOT LIKE '%%E-COMMERCE%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    seen, uniq = set(), []
    for j in joins:
        if j not in seen:
            seen.add(j); uniq.append(j)
    return uniq, cond, params


def _make_cte(cfg, rd: dict, joins: list, cond: list) -> str:
    join_str  = " ".join(joins)
    dim_where = ("AND " + " AND ".join(cond)) if cond else ""
    ref = rd["ref"]; ps = rd["pstart"]; psa = rd["pstart_ant"]; pea = rd["pend_ant"]
    return f"""
WITH hist AS (
    SELECT fv.NUMERO_CLIENTE, fv.FECHA_FACTURA, fv.VENTAS_NETAS,
           fv.CODIGO_VENDEDOR, fv.NUMERO_FACTURA
    FROM {cfg.T('FACT_VENTAS')} fv
    {join_str}
    WHERE fv.FECHA_FACTURA <= {ref}
      AND fv.FECHA_FACTURA >= DATEADD('year', -5, {ref})
      {dim_where}
),
per_client AS (
    SELECT
        NUMERO_CLIENTE,
        MIN(FECHA_FACTURA)                                                              AS primera_compra,
        MAX(FECHA_FACTURA)                                                              AS ultima_compra,
        MAX(CASE WHEN FECHA_FACTURA >= {ps}  THEN FECHA_FACTURA END)                   AS ultima_en_periodo,
        MAX(CASE WHEN FECHA_FACTURA <  {ps}  THEN FECHA_FACTURA END)                   AS ultima_antes_periodo,
        COALESCE(SUM(CASE WHEN FECHA_FACTURA >= {ps}  THEN VENTAS_NETAS END), 0)       AS vn_periodo,
        COALESCE(SUM(CASE WHEN FECHA_FACTURA >= {psa} AND FECHA_FACTURA <= {pea}
                          THEN VENTAS_NETAS END), 0)                                   AS vn_ant,
        COALESCE(SUM(VENTAS_NETAS), 0)                                                 AS vn_historico,
        COUNT(DISTINCT CASE WHEN FECHA_FACTURA >= {ps} THEN NUMERO_FACTURA END)        AS facturas_periodo,
        MAX_BY(CODIGO_VENDEDOR, FECHA_FACTURA)                                         AS ultimo_vendedor
    FROM hist
    GROUP BY NUMERO_CLIENTE
),
classified AS (
    SELECT
        pc.*,
        DATEDIFF('month', ultima_compra, {ref}) AS meses_sin_compra,
        CASE
            WHEN primera_compra  >= {ps}                                               THEN 'NUEVO'
            WHEN ultima_en_periodo  IS NOT NULL
                 AND ultima_antes_periodo IS NOT NULL
                 AND DATEDIFF('month', ultima_antes_periodo, {ps}) >= 12               THEN 'RECUPERADO'
            WHEN DATEDIFF('month', ultima_compra, {ref}) <  4                          THEN 'ACTIVO'
            WHEN DATEDIFF('month', ultima_compra, {ref}) <  8                          THEN 'SEGUIMIENTO'
            WHEN DATEDIFF('month', ultima_compra, {ref}) < 12                          THEN 'RIESGO'
            ELSE 'PERDIDO'
        END AS estado
    FROM per_client pc
)
"""


@router.get("/estados")
def get_clientes_estados(
    ano: int              = Query(default_factory=lambda: date.today().year),
    mes: Optional[int]    = Query(None, ge=1, le=12),
    mes_fin: Optional[int]= Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str]= None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool        = Query(False),
    excl_ecommerce: bool   = Query(False),
    excl_sin_vendedor: bool= Query(False),
    excl_grandes: bool     = Query(False),
):
    """Clasificación dinámica de clientes según historial de compras y período filtrado."""
    cfg = get_settings()
    key = f"cli_est2:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}:{excl_ecommerce}:{excl_sin_vendedor}:{excl_grandes}"
    if cached := cache.get(key):
        return cached

    rd    = _ref_dates(ano, mes, mes_fin)
    joins, cond, params = _dim_filters(cfg, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, excl_ecommerce)
    cte   = _make_cte(cfg, rd, joins, cond)

    extras = []
    if excl_sin_vendedor:
        extras.append("ultimo_vendedor IS NOT NULL")
    if excl_grandes:
        extras.append("vn_periodo < 1000000")
    extra_where = ("AND " + " AND ".join(extras)) if extras else ""

    sql = cte + f"""
        SELECT
            estado,
            COUNT(*)                AS cnt,
            COALESCE(SUM(vn_periodo), 0) AS ventas_netas
        FROM classified
        WHERE TRUE {extra_where}
        GROUP BY estado
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
        "total_clientes":        total,
        "clientes_activos":      estados.get("ACTIVO",      {}).get("cnt", 0),
        "clientes_nuevos":       estados.get("NUEVO",       {}).get("cnt", 0),
        "clientes_perdidos":     estados.get("PERDIDO",     {}).get("cnt", 0),
        "clientes_riesgo":       estados.get("RIESGO",      {}).get("cnt", 0),
        "clientes_seguimiento":  estados.get("SEGUIMIENTO", {}).get("cnt", 0),
        "clientes_recuperados":  estados.get("RECUPERADO",  {}).get("cnt", 0),
        "detalle": [
            {"estado": k, "cnt": v["cnt"], "ventas_netas": v["ventas_netas"]}
            for k, v in sorted(estados.items(), key=lambda x: -x[1]["cnt"])
        ],
    }
    cache.set(key, result)
    return result


@router.get("/lista")
def get_clientes_lista(
    ano: int              = Query(default_factory=lambda: date.today().year),
    mes: Optional[int]    = Query(None, ge=1, le=12),
    mes_fin: Optional[int]= Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str]= None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool        = Query(False),
    excl_ecommerce: bool   = Query(False),
    excl_sin_vendedor: bool= Query(False),
    excl_grandes: bool     = Query(False),
    estado: Optional[str]  = Query(None),
    top_n: int             = Query(150, ge=1, le=500),
):
    """Lista de clientes con clasificación dinámica, última compra y métricas del período."""
    cfg = get_settings()
    key = f"cli_lst2:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}:{excl_ecommerce}:{excl_sin_vendedor}:{excl_grandes}:{estado}:{top_n}"
    if cached := cache.get(key):
        return cached

    rd    = _ref_dates(ano, mes, mes_fin)
    joins, cond, params = _dim_filters(cfg, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, excl_ecommerce)
    cte   = _make_cte(cfg, rd, joins, cond)

    outer_params = list(params)
    where_parts = []
    if estado:
        where_parts.append("UPPER(c.estado) = %s")
        outer_params.append(estado.upper())
    if excl_sin_vendedor:
        where_parts.append("c.ultimo_vendedor IS NOT NULL")
    if excl_ecommerce:
        where_parts.append("(UPPER(COALESCE(dv.NOMBRE, '')) NOT LIKE '%%ECOMMERCE%%' AND UPPER(COALESCE(dv.NOMBRE, '')) NOT LIKE '%%E-COMMERCE%%')")
    if excl_grandes:
        where_parts.append("c.vn_periodo < 1000000")
    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sql = cte + f"""
        SELECT
            c.NUMERO_CLIENTE,
            c.estado,
            c.primera_compra,
            c.ultima_compra,
            c.meses_sin_compra,
            c.vn_periodo,
            c.vn_ant,
            c.vn_historico,
            c.facturas_periodo,
            c.ultimo_vendedor,
            dc.NOMBRE           AS nombre_cliente,
            dc.TIPO_CLIENTE,
            dv.NOMBRE           AS nombre_vendedor
        FROM classified c
        LEFT JOIN {cfg.TM('DIM_CLIENTE')}  dc ON c.NUMERO_CLIENTE  = dc.NUMERO_CLIENTE
        LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON c.ultimo_vendedor  = dv.CODIGO_VENDEDOR
        {where_clause}
        ORDER BY c.vn_periodo DESC, c.vn_historico DESC
        LIMIT {top_n}
    """

    try:
        df = connector.query(sql, outer_params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Clientes lista error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    def _s(v, fb=""):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return fb
        return str(v)

    def _pct(a, b):
        return round((a / b - 1) * 100, 2) if b and b != 0 else None

    def _date(v):
        if v is None:
            return None
        try:
            return str(v)[:10]
        except Exception:
            return None

    records = []
    for _, r in df.iterrows():
        vn  = float(r.vn_periodo  or 0)
        va  = float(r.vn_ant      or 0)
        vh  = float(r.vn_historico or 0)
        records.append({
            "numero_cliente":   _s(r.numero_cliente),
            "nombre":           _s(r.get("nombre_cliente"), _s(r.numero_cliente)),
            "tipo_cliente":     _s(r.get("tipo_cliente")),
            "estado":           _s(r.get("estado")),
            "vendedor":         _s(r.get("ultimo_vendedor")),
            "nombre_vendedor":  _s(r.get("nombre_vendedor")),
            "ventas_netas":     round(vn, 2),
            "ventas_netas_ant": round(va, 2),
            "ventas_historico": round(vh, 2),
            "variacion_yoy":    _pct(vn, va),
            "num_facturas":     int(r.get("facturas_periodo") or 0),
            "primera_compra":   _date(r.get("primera_compra")),
            "ultima_compra":    _date(r.get("ultima_compra")),
            "meses_sin_compra": int(r.get("meses_sin_compra") or 0),
        })

    result = {"ano": ano, "mes": mes, "estado": estado, "total": len(records), "data": records}
    cache.set(key, result)
    return result


def _ecm_cond(alias: str) -> str:
    return (
        f"AND UPPER(COALESCE({alias}.NOMBRE,'')) NOT LIKE '%%ECOMMERCE%%' "
        f"AND UPPER(COALESCE({alias}.NOMBRE,'')) NOT LIKE '%%E-COMMERCE%%'"
    )


def _bkd_vend_where(excl_sin_vendedor: bool, excl_ecommerce: bool, excl_grandes: bool = False) -> str:
    parts = []
    if excl_sin_vendedor:
        parts.append("AND c.ultimo_vendedor IS NOT NULL")
    if excl_ecommerce:
        parts.append(_ecm_cond("dv"))
    if excl_grandes:
        parts.append("AND c.vn_periodo < 1000000")
    return " ".join(parts)


def _bkd_reg_join(cfg, excl_sin_vendedor: bool, excl_ecommerce: bool) -> str:
    if excl_sin_vendedor or excl_ecommerce:
        return f"LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv2 ON c.ultimo_vendedor = dv2.CODIGO_VENDEDOR"
    return ""


def _bkd_reg_where(excl_sin_vendedor: bool, excl_ecommerce: bool, excl_grandes: bool = False) -> str:
    parts = []
    if excl_sin_vendedor:
        parts.append("AND c.ultimo_vendedor IS NOT NULL")
    if excl_ecommerce:
        parts.append(_ecm_cond("dv2"))
    if excl_grandes:
        parts.append("AND c.vn_periodo < 1000000")
    return " ".join(parts)


@router.get("/breakdown")
def get_clientes_breakdown(
    ano: int              = Query(default_factory=lambda: date.today().year),
    mes: Optional[int]    = Query(None, ge=1, le=12),
    mes_fin: Optional[int]= Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str]= None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool        = Query(False),
    excl_ecommerce: bool   = Query(False),
    excl_sin_vendedor: bool= Query(False),
    excl_grandes: bool     = Query(False),
):
    """Distribución de estados de clientes agrupada por vendedor y por región."""
    cfg = get_settings()
    key = f"cli_bkd:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{excl_exportacion}:{excl_pvta}:{excl_ecommerce}:{excl_sin_vendedor}:{excl_grandes}"
    if cached := cache.get(key):
        return cached

    rd    = _ref_dates(ano, mes, mes_fin)
    joins, cond, params = _dim_filters(cfg, region, vendedor, grupo_comercial, planta, excl_exportacion, excl_pvta, excl_ecommerce)

    dom_join = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
    if not any("DIM_DOMICILIO" in j for j in joins):
        joins = [dom_join] + list(joins)

    join_str  = " ".join(joins)
    dim_where = ("AND " + " AND ".join(cond)) if cond else ""
    ref = rd["ref"]; ps = rd["pstart"]

    sql = f"""
    WITH hist AS (
        SELECT fv.NUMERO_CLIENTE, fv.FECHA_FACTURA, fv.VENTAS_NETAS,
               fv.CODIGO_VENDEDOR, dd.DESCRIPCION_REGION
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        WHERE fv.FECHA_FACTURA <= {ref}
          AND fv.FECHA_FACTURA >= DATEADD('year', -5, {ref})
          {dim_where}
    ),
    per_client AS (
        SELECT
            NUMERO_CLIENTE,
            MIN(FECHA_FACTURA)                                                          AS primera_compra,
            MAX(FECHA_FACTURA)                                                          AS ultima_compra,
            MAX(CASE WHEN FECHA_FACTURA >= {ps} THEN FECHA_FACTURA END)                AS ultima_en_periodo,
            MAX(CASE WHEN FECHA_FACTURA <  {ps} THEN FECHA_FACTURA END)                AS ultima_antes_periodo,
            COALESCE(SUM(CASE WHEN FECHA_FACTURA >= {ps} THEN VENTAS_NETAS END), 0)   AS vn_periodo,
            MAX_BY(CODIGO_VENDEDOR,    FECHA_FACTURA)                                  AS ultimo_vendedor,
            MAX_BY(DESCRIPCION_REGION, FECHA_FACTURA)                                  AS ultima_region
        FROM hist
        GROUP BY NUMERO_CLIENTE
    ),
    classified AS (
        SELECT pc.*,
            CASE
                WHEN primera_compra >= {ps}                                                THEN 'NUEVO'
                WHEN ultima_en_periodo IS NOT NULL AND ultima_antes_periodo IS NOT NULL
                     AND DATEDIFF('month', ultima_antes_periodo, {ps}) >= 12               THEN 'RECUPERADO'
                WHEN DATEDIFF('month', ultima_compra, {ref}) <  4                          THEN 'ACTIVO'
                WHEN DATEDIFF('month', ultima_compra, {ref}) <  8                          THEN 'SEGUIMIENTO'
                WHEN DATEDIFF('month', ultima_compra, {ref}) < 12                          THEN 'RIESGO'
                ELSE 'PERDIDO'
            END AS estado
        FROM per_client pc
    )
    SELECT 'vendedor' AS dim,
           COALESCE(dv.NOMBRE, c.ultimo_vendedor, '—') AS nombre,
           c.estado, COUNT(*) AS cnt
    FROM classified c
    LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON c.ultimo_vendedor = dv.CODIGO_VENDEDOR
    WHERE TRUE
    {_bkd_vend_where(excl_sin_vendedor, excl_ecommerce, excl_grandes)}
    GROUP BY 1, 2, 3

    UNION ALL

    SELECT 'region' AS dim,
           COALESCE(c.ultima_region, '—') AS nombre,
           c.estado, COUNT(*) AS cnt
    FROM classified c
    {_bkd_reg_join(cfg, excl_sin_vendedor, excl_ecommerce)}
    WHERE TRUE
    {_bkd_reg_where(excl_sin_vendedor, excl_ecommerce, excl_grandes)}
    GROUP BY 1, 2, 3
    """

    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Clientes breakdown error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    ESTADOS = ['ACTIVO', 'NUEVO', 'RECUPERADO', 'SEGUIMIENTO', 'RIESGO', 'PERDIDO']

    def pivot(subset, max_items=15):
        grouped: dict = {}
        for _, r in subset.iterrows():
            nombre = str(r.nombre or "—")
            est    = str(r.estado or "").upper()
            cnt    = int(r.cnt or 0)
            if nombre not in grouped:
                grouped[nombre] = {e: 0 for e in ESTADOS}
                grouped[nombre]["total"] = 0
            grouped[nombre][est] = grouped[nombre].get(est, 0) + cnt
            grouped[nombre]["total"] += cnt
        items = [{"nombre": k, **v} for k, v in grouped.items()]
        items.sort(key=lambda x: -x["total"])
        return items[:max_items]

    result = {
        "by_vendedor": pivot(df[df["dim"] == "vendedor"]),
        "by_region":   pivot(df[df["dim"] == "region"]),
    }
    cache.set(key, result)
    return result
