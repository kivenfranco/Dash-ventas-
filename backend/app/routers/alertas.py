"""
GET /api/alertas — Clientes con caída de consumo + inactivos + RFM + tendencia 6 meses.
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

router = APIRouter(prefix="/api/alertas", tags=["Alertas"])
logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _s(v, fb=""):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return fb
    return str(v) if v else fb


def _slope(values):
    """Linear regression slope for an ordered list of values."""
    n = len(values)
    if n < 2:
        return 0.0
    xm = (n - 1) / 2.0
    ym = sum(values) / n
    num = sum((i - xm) * (y - ym) for i, y in enumerate(values))
    den = sum((i - xm) ** 2 for i in range(n))
    return num / den if den else 0.0


def _ref_date_sql(ano: int, mes: Optional[int]) -> str:
    """SQL literal for the last day of the selected period (used instead of CURRENT_DATE)."""
    mes_r = mes or 12
    last_day = calendar.monthrange(ano, mes_r)[1]
    return f"'{ano}-{mes_r:02d}-{last_day:02d}'::DATE"


def _apply_filters(cfg, joins, cond, params, *,
                   region, vendedor, mercado, cliente,
                   grupo_comercial, planta, es_stock,
                   excl_exportacion, excl_pvta):
    """Append JOINs/conditions/params for common dimension filters."""
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        # Excludes all PVTA* vendors AND PBOGOTA (point-of-sale codes)
        cond.append("((UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' AND UPPER(fv.CODIGO_VENDEDOR) != 'PBOGOTA') OR fv.CODIGO_VENDEDOR IS NULL)")
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if cliente:
        # Search by client name (partial, case-insensitive)
        joins.append(f"LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc_filt ON fv.NUMERO_CLIENTE = dc_filt.NUMERO_CLIENTE")
        cond.append("UPPER(dc_filt.NOMBRE) LIKE UPPER('%%' || %s || '%%')"); params.append(cliente)
    if mercado:
        joins.append(
            f"LEFT JOIN (SELECT VENDEDOR, MERCADO FROM "
            f"(SELECT VENDEDOR, MERCADO, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn "
            f"FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) vm ON fv.CODIGO_VENDEDOR = vm.VENDEDOR"
        )
        cond.append("vm.MERCADO = %s"); params.append(mercado)
    if grupo_comercial or planta:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if grupo_comercial:
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
            cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
        if planta:
            cond.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)
    if es_stock is not None:
        dp_sub = (
            f"(SELECT CODIGO_PRODUCTO, ES_STOCK FROM {cfg.TM('DIM_PARTE')} "
            f"QUALIFY ROW_NUMBER() OVER (PARTITION BY CODIGO_PRODUCTO ORDER BY CODIGO_PRODUCTO) = 1)"
        )
        joins.append(f"INNER JOIN {dp_sub} dp_s ON fv.CODIGO_PRODUCTO = dp_s.CODIGO_PRODUCTO")
        cond.append("dp_s.ES_STOCK = %s"); params.append(es_stock == "Stock")


# ── /inactivos ────────────────────────────────────────────────────────────────

@router.get("/inactivos")
def get_inactivos(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    meses_inactivo: int = Query(3, ge=1, le=24),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    mercado: Optional[str] = None,
    cliente: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    es_stock: Optional[str] = Query(None, pattern="^(Stock|No Stock)$"),
    top_n: int = Query(150, ge=1, le=500),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    """Clientes que no han comprado en {meses_inactivo} meses desde la fecha de referencia."""
    cfg = get_settings()
    key = f"inact:{ano}:{mes}:{meses_inactivo}:{region}:{vendedor}:{mercado}:{cliente}:{grupo_comercial}:{planta}:{es_stock}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    ref_date = _ref_date_sql(ano, mes)

    joins, cond, params = [], [], []
    _apply_filters(cfg, joins, cond, params,
                   region=region, vendedor=vendedor, mercado=mercado, cliente=cliente,
                   grupo_comercial=grupo_comercial, planta=planta, es_stock=es_stock,
                   excl_exportacion=excl_exportacion, excl_pvta=excl_pvta)

    join_str   = " ".join(joins)
    extra_cond = (" AND " + " AND ".join(cond)) if cond else ""

    sql = f"""
        WITH base AS (
            SELECT
                fv.NUMERO_CLIENTE,
                MAX(fv.ID_CLIENTE)            AS id_cliente,
                MAX(fv.CODIGO_VENDEDOR)       AS codigo_vendedor,
                MAX(fv.FECHA_FACTURA)         AS ultima_compra,
                DATEDIFF('day', MAX(fv.FECHA_FACTURA), {ref_date}) AS dias_sin_compra,
                SUM(CASE WHEN fv.ANO_FISCAL >= {ano} - 1
                         THEN fv.VENTAS_NETAS ELSE 0 END)          AS ventas_12m,
                SUM(fv.VENTAS_NETAS)                               AS ventas_historico,
                COUNT(DISTINCT fv.NUMERO_FACTURA)                  AS num_facturas
            FROM {cfg.T('FACT_VENTAS')} fv
            {join_str}
            WHERE 1=1 {extra_cond}
            GROUP BY fv.NUMERO_CLIENTE
            HAVING MAX(fv.FECHA_FACTURA) < DATEADD('month', -{meses_inactivo}, {ref_date})
               AND SUM(fv.VENTAS_NETAS) > 0
        )
        SELECT b.*,
               dc.NOMBRE, dc.TIPO_CLIENTE,
               dv.NOMBRE AS nombre_vendedor,
               dec.ESTADO_CLIENTE
        FROM base b
        LEFT JOIN (SELECT NUMERO_CLIENTE, NOMBRE, TIPO_CLIENTE FROM {cfg.TM('DIM_CLIENTE')} QUALIFY ROW_NUMBER() OVER (PARTITION BY NUMERO_CLIENTE ORDER BY NUMERO_CLIENTE) = 1) dc ON b.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
        LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv  ON b.codigo_vendedor = dv.CODIGO_VENDEDOR
        LEFT JOIN (SELECT ID_CLIENTE, ESTADO_CLIENTE FROM {cfg.T('DIM_ESTADO_CLIENTE')} QUALIFY ROW_NUMBER() OVER (PARTITION BY ID_CLIENTE ORDER BY ID_CLIENTE) = 1) dec ON dec.ID_CLIENTE = b.id_cliente
        ORDER BY ventas_historico DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Inactivos error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    records = []
    for _, r in df.iterrows():
        dias = int(r.get("dias_sin_compra") or 0)
        clasificacion = "perdido" if dias > 180 else "riesgo_alto" if dias > 90 else "riesgo"
        records.append({
            "numero_cliente":  _s(r.get("numero_cliente")),
            "nombre":          _s(r.get("nombre"), _s(r.get("numero_cliente"))),
            "tipo_cliente":    _s(r.get("tipo_cliente")),
            "estado_cliente":  _s(r.get("estado_cliente")),
            "vendedor":        _s(r.get("codigo_vendedor")),
            "nombre_vendedor": _s(r.get("nombre_vendedor")),
            "ultima_compra":   str(r["ultima_compra"]) if r.get("ultima_compra") else None,
            "dias_sin_compra": dias,
            "ventas_12m":      round(float(r.get("ventas_12m") or 0), 2),
            "ventas_historico":round(float(r.get("ventas_historico") or 0), 2),
            "num_facturas":    int(r.get("num_facturas") or 0),
            "clasificacion":   clasificacion,
        })

    result = {
        "meses_inactivo": meses_inactivo,
        "total":       len(records),
        "perdidos":    sum(1 for r in records if r["clasificacion"] == "perdido"),
        "riesgo_alto": sum(1 for r in records if r["clasificacion"] == "riesgo_alto"),
        "riesgo":      sum(1 for r in records if r["clasificacion"] == "riesgo"),
        "data": records,
    }
    cache.set(key, result)
    return result


# ── /rfm ──────────────────────────────────────────────────────────────────────

@router.get("/rfm")
def get_rfm(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    mercado: Optional[str] = None,
    cliente: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    es_stock: Optional[str] = Query(None, pattern="^(Stock|No Stock)$"),
    excl_pvta: bool = Query(True),
    excl_exportacion: bool = Query(False),
    top_n: int = Query(300, ge=10, le=1000),
):
    """Segmentación RFM — Recencia, Frecuencia, Monto. Recencia calculada al cierre del período."""
    cfg = get_settings()
    key = f"rfm:{ano}:{mes}:{region}:{vendedor}:{mercado}:{cliente}:{grupo_comercial}:{planta}:{es_stock}:{excl_pvta}:{excl_exportacion}"
    cached = cache.get(key)
    if cached:
        return cached

    ref_date = _ref_date_sql(ano, mes)

    joins, cond, params = [], ["fv.ANO_FISCAL >= %s"], [ano - 1]
    _apply_filters(cfg, joins, cond, params,
                   region=region, vendedor=vendedor, mercado=mercado, cliente=cliente,
                   grupo_comercial=grupo_comercial, planta=planta, es_stock=es_stock,
                   excl_exportacion=excl_exportacion, excl_pvta=excl_pvta)

    join_str = " ".join(joins)
    where    = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            fv.NUMERO_CLIENTE,
            fv.CODIGO_VENDEDOR,
            DATEDIFF('day', MAX(fv.FECHA_FACTURA), {ref_date}) AS recencia,
            COUNT(DISTINCT fv.NUMERO_FACTURA)                   AS frecuencia,
            SUM(fv.VENTAS_NETAS)                                AS monto,
            MAX(fv.FECHA_FACTURA)                               AS ultima_compra
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where}
        GROUP BY 1, 2
        HAVING SUM(fv.VENTAS_NETAS) > 0
        ORDER BY monto DESC
        LIMIT {top_n}
    """
    try:
        df      = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        df_dim  = connector.query(f"SELECT NUMERO_CLIENTE, NOMBRE FROM {cfg.TM('DIM_CLIENTE')}")
        df_dim.columns = [c.lower() for c in df_dim.columns]
        df_vend = connector.query(f"SELECT CODIGO_VENDEDOR, NOMBRE AS nombre_vendedor FROM {cfg.TM('DIM_VENDEDOR')}")
        df_vend.columns = [c.lower() for c in df_vend.columns]
        df = df.merge(df_dim,  on="numero_cliente",  how="left")
        df = df.merge(df_vend, on="codigo_vendedor", how="left")
    except Exception as exc:
        logger.error("RFM error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    import pandas as pd

    def _quintile(series, ascending=True):
        try:
            labels = [1, 2, 3, 4, 5] if ascending else [5, 4, 3, 2, 1]
            return pd.qcut(series, q=5, labels=labels, duplicates="drop").astype(float)
        except Exception:
            return pd.Series([3.0] * len(series), index=series.index)

    df["r_score"]  = _quintile(df["recencia"],  ascending=False)
    df["f_score"]  = _quintile(df["frecuencia"], ascending=True)
    df["m_score"]  = _quintile(df["monto"],      ascending=True)
    df["rfm_score"] = df["r_score"] + df["f_score"] + df["m_score"]

    def _segment(row):
        r, f, m = row["r_score"], row["f_score"], row["m_score"]
        if r >= 4 and f >= 4 and m >= 4: return "Campeón"
        if r >= 3 and f >= 3 and m >= 3: return "Leal"
        if r >= 4 and f <= 2:             return "Nuevo"
        if r <= 2 and f >= 4:             return "En Riesgo"
        if r == 1 and f >= 4:             return "No Perder"
        if r <= 2 and f <= 2:             return "Perdido"
        if r >= 3 and m >= 4:             return "Potencial"
        return "Regular"

    df["segmento"] = df.apply(_segment, axis=1)

    records = []
    for _, r in df.iterrows():
        records.append({
            "numero_cliente": _s(r.get("numero_cliente")),
            "nombre":         _s(r.get("nombre"), _s(r.get("numero_cliente"))),
            "vendedor":       _s(r.get("codigo_vendedor")),
            "nombre_vendedor":_s(r.get("nombre_vendedor")),
            "recencia":       int(r.get("recencia") or 0),
            "frecuencia":     int(r.get("frecuencia") or 0),
            "monto":          round(float(r.get("monto") or 0), 2),
            "ultima_compra":  str(r["ultima_compra"]) if r.get("ultima_compra") else None,
            "r_score":        int(r.r_score),
            "f_score":        int(r.f_score),
            "m_score":        int(r.m_score),
            "rfm_score":      round(float(r.rfm_score), 1),
            "segmento":       str(r.segmento),
        })

    from collections import Counter
    result = {
        "ano": ano,
        "total_clientes": len(records),
        "segmentos": dict(Counter(r["segmento"] for r in records)),
        "data": records,
    }
    cache.set(key, result)
    return result


# ── /clientes (caída YoY) ─────────────────────────────────────────────────────

@router.get("/clientes")
def get_alertas_clientes(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    umbral_yoy: float = Query(-20.0),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    mercado: Optional[str] = None,
    cliente: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    es_stock: Optional[str] = Query(None, pattern="^(Stock|No Stock)$"),
    top_n: int = Query(100, ge=1, le=500),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    cfg = get_settings()
    key = f"alertas:{ano}:{mes}:{mes_fin}:{umbral_yoy}:{region}:{vendedor}:{mercado}:{cliente}:{grupo_comercial}:{planta}:{es_stock}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    base_joins, base_cond, base_params = [], [], []
    _apply_filters(cfg, base_joins, base_cond, base_params,
                   region=region, vendedor=vendedor, mercado=mercado, cliente=cliente,
                   grupo_comercial=grupo_comercial, planta=planta, es_stock=es_stock,
                   excl_exportacion=excl_exportacion, excl_pvta=excl_pvta)

    join_str    = " ".join(base_joins)
    extra_where = (" AND " + " AND ".join(base_cond)) if base_cond else ""

    # Cap both years at same YTD period when no month is selected
    mes_cap = mes
    if not mes:
        try:
            df_cap  = connector.query(
                f"SELECT MAX(PERIODO_FISCAL) AS max_mes FROM {cfg.T('FACT_VENTAS')} WHERE ANO_FISCAL = %s", [ano])
            mes_cap = int(df_cap["MAX_MES"].iloc[0]) if not df_cap.empty else None
        except Exception:
            mes_cap = None

    cur_where  = "fv.ANO_FISCAL = %s"
    cur_params = [ano]
    if mes and mes_fin and mes_fin > mes:
        cur_where += " AND fv.PERIODO_FISCAL BETWEEN %s AND %s"; cur_params.extend([mes, mes_fin])
    elif mes:
        cur_where += " AND fv.PERIODO_FISCAL = %s"; cur_params.append(mes)
    elif mes_cap:
        cur_where += " AND fv.PERIODO_FISCAL <= %s"; cur_params.append(mes_cap)
    cur_params += base_params

    ant_where  = "fv.ANO_FISCAL = %s"
    ant_params = [ano - 1]
    if mes and mes_fin and mes_fin > mes:
        ant_where += " AND fv.PERIODO_FISCAL BETWEEN %s AND %s"; ant_params.extend([mes, mes_fin])
    elif mes:
        ant_where += " AND fv.PERIODO_FISCAL = %s"; ant_params.append(mes)
    elif mes_cap:
        ant_where += " AND fv.PERIODO_FISCAL <= %s"; ant_params.append(mes_cap)
    ant_params += base_params

    mes_ant_params = None
    mom_where = ""
    if mes:
        mes_ant       = mes - 1 if mes > 1 else 12
        ano_mes_ant   = ano if mes > 1 else ano - 1
        mom_where     = "fv.ANO_FISCAL = %s AND fv.PERIODO_FISCAL = %s"
        mes_ant_params = [ano_mes_ant, mes_ant] + base_params

    try:
        sql_cur = f"""
            SELECT fv.NUMERO_CLIENTE, MAX(fv.ID_CLIENTE) AS ID_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS),0) AS ventas_netas,
                   COALESCE(SUM(fv.CANTIDAD),0)     AS cantidad,
                   MAX(fv.FECHA_FACTURA)             AS ultima_compra
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE {cur_where} {extra_where}
            GROUP BY 1
        """
        sql_ant = f"""
            SELECT fv.NUMERO_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS),0) AS ventas_netas_ant,
                   COALESCE(SUM(fv.CANTIDAD),0)     AS cantidad_ant
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE {ant_where} {extra_where}
            GROUP BY 1
        """
        sql_dim    = f"SELECT NUMERO_CLIENTE, NOMBRE, TIPO_CLIENTE, CODIGO_VENDEDOR FROM {cfg.TM('DIM_CLIENTE')} QUALIFY ROW_NUMBER() OVER (PARTITION BY NUMERO_CLIENTE ORDER BY NUMERO_CLIENTE) = 1"
        sql_estado = f"SELECT ID_CLIENTE, ESTADO_CLIENTE FROM {cfg.T('DIM_ESTADO_CLIENTE')} QUALIFY ROW_NUMBER() OVER (PARTITION BY ID_CLIENTE ORDER BY ID_CLIENTE) = 1"
        sql_vend   = f"SELECT CODIGO_VENDEDOR, NOMBRE AS nombre_vendedor FROM {cfg.TM('DIM_VENDEDOR')} QUALIFY ROW_NUMBER() OVER (PARTITION BY CODIGO_VENDEDOR ORDER BY CODIGO_VENDEDOR) = 1"

        df_cur    = connector.query(sql_cur,   cur_params)
        df_ant    = connector.query(sql_ant,   ant_params)
        df_dim    = connector.query(sql_dim)
        df_estado = connector.query(sql_estado)
        df_vend   = connector.query(sql_vend)

        if mes and mes_ant_params:
            sql_mom = f"""
                SELECT fv.NUMERO_CLIENTE,
                       COALESCE(SUM(fv.VENTAS_NETAS),0) AS ventas_mes_ant
                FROM {cfg.T('FACT_VENTAS')} fv {join_str}
                WHERE {mom_where} {extra_where}
                GROUP BY 1
            """
            df_mom = connector.query(sql_mom, mes_ant_params)
        else:
            df_mom = None

    except Exception as exc:
        logger.error("Alertas/clientes error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    import pandas as pd

    for _df in [df_cur, df_ant, df_dim, df_estado, df_vend] + ([df_mom] if df_mom is not None else []):
        _df.columns = [c.lower() for c in _df.columns]

    merged = df_cur.merge(df_ant, on="numero_cliente", how="inner")
    logger.error(f"DEBUG: df_cur {len(df_cur)}, df_ant {len(df_ant)}, merged1 {len(merged)}")
    merged = merged.merge(df_dim[["numero_cliente","nombre","tipo_cliente","codigo_vendedor"]], on="numero_cliente", how="left")
    logger.error(f"DEBUG: df_dim {len(df_dim)}, merged2 {len(merged)}")
    merged = merged.merge(df_estado[["id_cliente","estado_cliente"]], on="id_cliente", how="left")
    logger.error(f"DEBUG: df_estado {len(df_estado)}, merged3 {len(merged)}")
    merged = merged.merge(df_vend, on="codigo_vendedor", how="left")
    logger.error(f"DEBUG: df_vend {len(df_vend)}, merged4 {len(merged)}")
    if df_mom is not None:
        merged = merged.merge(df_mom, on="numero_cliente", how="left")
        merged["ventas_mes_ant"] = merged["ventas_mes_ant"].fillna(0)

    merged = merged[merged["ventas_netas_ant"] > 0].copy()
    merged["variacion_yoy_pct"] = (
        (merged["ventas_netas"] - merged["ventas_netas_ant"]) / merged["ventas_netas_ant"].abs() * 100
    ).round(2)

    alertas_df = merged[merged["variacion_yoy_pct"] <= umbral_yoy].copy()
    alertas_df = alertas_df.sort_values("ventas_netas_ant", ascending=False).head(top_n)

    def _sev(pct):
        if pct <= -50: return "critica"
        if pct <= -30: return "alta"
        return "media"

    records = []
    for _, r in alertas_df.iterrows():
        vn  = float(r.ventas_netas or 0)
        van = float(r.ventas_netas_ant or 0)
        mom = float(r.ventas_mes_ant) if "ventas_mes_ant" in r.index and r.ventas_mes_ant is not None else None
        uc  = str(r.ultima_compra) if r.get("ultima_compra") is not None else None
        records.append({
            "numero_cliente":    _s(r.numero_cliente),
            "nombre":            _s(r.get("nombre"), _s(r.numero_cliente)),
            "tipo_cliente":      _s(r.get("tipo_cliente")),
            "estado_cliente":    _s(r.get("estado_cliente")),
            "vendedor":          _s(r.get("codigo_vendedor")),
            "nombre_vendedor":   _s(r.get("nombre_vendedor")),
            "ventas_netas":      round(vn, 2),
            "ventas_netas_ant":  round(van, 2),
            "ventas_mes_ant":    round(mom, 2) if mom is not None else None,
            "cantidad":          round(float(r.cantidad or 0), 2),
            "cantidad_ant":      round(float(r.cantidad_ant or 0), 2),
            "variacion_yoy_pct": float(r.variacion_yoy_pct),
            "severidad":         _sev(float(r.variacion_yoy_pct)),
            "ultima_compra":     uc,
        })

    n_critica = sum(1 for r in records if r["severidad"] == "critica")
    n_alta    = sum(1 for r in records if r["severidad"] == "alta")
    n_media   = sum(1 for r in records if r["severidad"] == "media")

    result = {
        "ano": ano, "mes": mes, "umbral_yoy": umbral_yoy,
        "resumen": {"total": len(records), "critica": n_critica, "alta": n_alta, "media": n_media},
        "alertas": records,
    }
    cache.set(key, result)
    return result


# ── /tendencia (declining trend) ─────────────────────────────────────────────

@router.get("/tendencia")
def get_tendencia(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    mercado: Optional[str] = None,
    cliente: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    es_stock: Optional[str] = Query(None, pattern="^(Stock|No Stock)$"),
    meses_tendencia: int = Query(6, ge=3, le=12),
    min_meses: int = Query(3, ge=2, le=6, description="Meses mínimos con ventas para incluir cliente"),
    top_n: int = Query(100, ge=1, le=500),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    """Clientes con tendencia de consumo decreciente en los últimos N meses (regresión lineal)."""
    cfg = get_settings()
    key = f"tend:{ano}:{mes}:{region}:{vendedor}:{mercado}:{cliente}:{grupo_comercial}:{planta}:{es_stock}:{meses_tendencia}:{min_meses}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    # Build chronological window of N months ending at (ano, mes_ref)
    mes_ref = mes or date.today().month
    periods = []
    m, a = mes_ref, ano
    for _ in range(meses_tendencia):
        periods.append((a, m))
        m -= 1
        if m == 0:
            m, a = 12, a - 1
    periods.reverse()  # oldest → newest

    period_cond   = "(" + " OR ".join("(fv.ANO_FISCAL = %s AND fv.PERIODO_FISCAL = %s)" for _ in periods) + ")"
    period_params = [v for a_p, m_p in periods for v in (a_p, m_p)]

    joins, cond, params = [], [period_cond], list(period_params)
    _apply_filters(cfg, joins, cond, params,
                   region=region, vendedor=vendedor, mercado=mercado, cliente=cliente,
                   grupo_comercial=grupo_comercial, planta=planta, es_stock=es_stock,
                   excl_exportacion=excl_exportacion, excl_pvta=excl_pvta)

    join_str = " ".join(joins)
    where    = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            fv.NUMERO_CLIENTE,
            fv.CODIGO_VENDEDOR,
            fv.ANO_FISCAL,
            fv.PERIODO_FISCAL,
            SUM(fv.VENTAS_NETAS)  AS ventas_mes,
            MAX(fv.FECHA_FACTURA) AS ultima_fecha
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where}
        GROUP BY 1, 2, 3, 4
        HAVING SUM(fv.VENTAS_NETAS) > 0
    """
    try:
        df      = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        df_dim  = connector.query(f"SELECT NUMERO_CLIENTE, NOMBRE FROM {cfg.TM('DIM_CLIENTE')}")
        df_dim.columns = [c.lower() for c in df_dim.columns]
        df_vend = connector.query(f"SELECT CODIGO_VENDEDOR, NOMBRE AS nombre_vendedor FROM {cfg.TM('DIM_VENDEDOR')}")
        df_vend.columns = [c.lower() for c in df_vend.columns]
    except Exception as exc:
        logger.error("Tendencia error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # Map (ano, mes) → position index 0..N-1
    period_idx    = {(a_p, m_p): i for i, (a_p, m_p) in enumerate(periods)}
    period_labels = [f"{m_p:02d}/{str(a_p)[2:]}" for a_p, m_p in periods]

    dim_map  = {str(r["numero_cliente"]): str(r["nombre"]) for _, r in df_dim.iterrows()}
    vend_map = {str(r["codigo_vendedor"]): str(r["nombre_vendedor"]) for _, r in df_vend.iterrows()}

    records = []
    for num_cli, grp in df.groupby("numero_cliente"):
        vendedor_code = str(grp["codigo_vendedor"].iloc[0])
        ultima = grp["ultima_fecha"].max()

        vals_by_idx = {}
        for _, row in grp.iterrows():
            idx = period_idx.get((int(row["ano_fiscal"]), int(row["periodo_fiscal"])))
            if idx is not None:
                vals_by_idx[idx] = float(row["ventas_mes"])

        series   = [vals_by_idx.get(i, 0.0) for i in range(meses_tendencia)]
        non_zero = sum(1 for v in series if v > 0)

        if non_zero < min_meses:
            continue

        slope_val   = _slope(series)
        avg_mensual = sum(v for v in series if v > 0) / max(non_zero, 1)
        slope_pct   = (slope_val / avg_mensual * 100) if avg_mensual > 0 else 0.0

        if slope_pct >= 0:
            continue  # only declining

        def _sev_tend(pct):
            if pct <= -15: return "critica"
            if pct <= -8:  return "alta"
            return "media"

        records.append({
            "numero_cliente":  _s(num_cli),
            "nombre":          dim_map.get(str(num_cli), _s(num_cli)),
            "nombre_vendedor": vend_map.get(vendedor_code, vendedor_code),
            "mensual":         [round(v, 2) for v in series],
            "slope":           round(slope_val, 2),
            "slope_pct":       round(slope_pct, 2),
            "avg_mensual":     round(avg_mensual, 2),
            "total_periodo":   round(sum(series), 2),
            "ultima_compra":   str(ultima) if ultima is not None else None,
            "num_meses":       non_zero,
            "severidad":       _sev_tend(slope_pct),
        })

    records.sort(key=lambda r: r["slope_pct"])  # most declining first
    records = records[:top_n]

    result = {
        "total":           len(records),
        "meses_tendencia": meses_tendencia,
        "periodos":        period_labels,
        "critica": sum(1 for r in records if r["severidad"] == "critica"),
        "alta":    sum(1 for r in records if r["severidad"] == "alta"),
        "media":   sum(1 for r in records if r["severidad"] == "media"),
        "data": records,
    }
    cache.set(key, result)
    return result
