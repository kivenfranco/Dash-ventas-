"""
GET /api/alertas — Clientes con caída de consumo + inactivos + RFM.
"""
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


@router.get("/inactivos")
def get_inactivos(
    meses_inactivo: int = Query(3, ge=1, le=24, description="Meses sin compra para clasificar inactivo"),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    top_n: int = Query(100, ge=1, le=500),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    """Clientes que tenían historial de compra pero no han comprado en {meses_inactivo} meses."""
    cfg = get_settings()
    key = f"inact:{meses_inactivo}:{region}:{vendedor}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    joins, cond, params = [], [], []
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)

    join_str   = " ".join(joins)
    extra_cond = (" AND " + " AND ".join(cond)) if cond else ""

    sql = f"""
        WITH base AS (
            SELECT
                fv.NUMERO_CLIENTE,
                MAX(fv.ID_CLIENTE)            AS id_cliente,
                fv.CODIGO_VENDEDOR,
                MAX(fv.FECHA_FACTURA)         AS ultima_compra,
                DATEDIFF('day', MAX(fv.FECHA_FACTURA), CURRENT_DATE()) AS dias_sin_compra,
                SUM(CASE WHEN fv.ANO_FISCAL >= YEAR(CURRENT_DATE()) - 1
                         THEN fv.VENTAS_NETAS ELSE 0 END)              AS ventas_12m,
                SUM(fv.VENTAS_NETAS)                                   AS ventas_historico,
                COUNT(DISTINCT fv.NUMERO_FACTURA)                      AS num_facturas
            FROM {cfg.T('FACT_VENTAS')} fv
            {join_str}
            WHERE 1=1 {extra_cond}
            GROUP BY 1, 3
            HAVING MAX(fv.FECHA_FACTURA) < DATEADD('month', -{meses_inactivo}, CURRENT_DATE())
               AND SUM(fv.VENTAS_NETAS) > 0
        )
        SELECT b.*,
               dc.NOMBRE, dc.TIPO_CLIENTE,
               dv.NOMBRE AS nombre_vendedor,
               dec.ESTADO_CLIENTE
        FROM base b
        LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON b.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
        LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON b.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
        LEFT JOIN {cfg.T('DIM_ESTADO_CLIENTE')} dec ON dec.ID_CLIENTE = b.id_cliente
        ORDER BY dias_sin_compra DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Inactivos error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    def _s(v, fb=""):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return fb
        return str(v)

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
        "total": len(records),
        "perdidos":    sum(1 for r in records if r["clasificacion"] == "perdido"),
        "riesgo_alto": sum(1 for r in records if r["clasificacion"] == "riesgo_alto"),
        "riesgo":      sum(1 for r in records if r["clasificacion"] == "riesgo"),
        "data": records,
    }
    cache.set(key, result)
    return result


@router.get("/rfm")
def get_rfm(
    ano: int = Query(default_factory=lambda: date.today().year),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    excl_pvta: bool = Query(True),
    excl_exportacion: bool = Query(False),
    top_n: int = Query(200, ge=10, le=1000),
):
    """Segmentación RFM — Recencia, Frecuencia, Monto."""
    cfg = get_settings()
    key = f"rfm:{ano}:{region}:{vendedor}:{excl_pvta}:{excl_exportacion}"
    cached = cache.get(key)
    if cached:
        return cached

    joins, cond, params = [], ["fv.ANO_FISCAL >= %s"], [ano - 1]
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("dd.DESCRIPCION_REGION = %s"); params.append(region)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)

    join_str = " ".join(joins)
    where    = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            fv.NUMERO_CLIENTE,
            fv.CODIGO_VENDEDOR,
            DATEDIFF('day', MAX(fv.FECHA_FACTURA), CURRENT_DATE()) AS recencia,
            COUNT(DISTINCT fv.NUMERO_FACTURA)                       AS frecuencia,
            SUM(fv.VENTAS_NETAS)                                    AS monto,
            MAX(fv.FECHA_FACTURA)                                   AS ultima_compra
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where}
        GROUP BY 1, 2
        HAVING SUM(fv.VENTAS_NETAS) > 0
        ORDER BY monto DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        df_dim  = connector.query(f"SELECT NUMERO_CLIENTE, NOMBRE FROM {cfg.TM('DIM_CLIENTE')}")
        df_dim.columns = [c.lower() for c in df_dim.columns]
        df      = df.merge(df_dim, on="numero_cliente", how="left")
    except Exception as exc:
        logger.error("RFM error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # Score R, F, M in quintiles (1-5)
    import pandas as pd

    def _quintile(series, ascending=True):
        try:
            labels = [1, 2, 3, 4, 5] if ascending else [5, 4, 3, 2, 1]
            return pd.qcut(series, q=5, labels=labels, duplicates="drop").astype(float)
        except Exception:
            return pd.Series([3.0] * len(series), index=series.index)

    df["r_score"] = _quintile(df["recencia"],  ascending=False)   # menor recencia = mejor
    df["f_score"] = _quintile(df["frecuencia"], ascending=True)
    df["m_score"] = _quintile(df["monto"],       ascending=True)
    df["rfm_score"] = df["r_score"] + df["f_score"] + df["m_score"]

    def _segment(row):
        r, f, m = row["r_score"], row["f_score"], row["m_score"]
        score = row["rfm_score"]
        if r >= 4 and f >= 4 and m >= 4:   return "Campeón"
        if r >= 3 and f >= 3 and m >= 3:   return "Leal"
        if r >= 4 and f <= 2:               return "Nuevo"
        if r <= 2 and f >= 4:               return "En Riesgo"
        if r == 1 and f >= 4:               return "No Perder"
        if r <= 2 and f <= 2:               return "Perdido"
        if r >= 3 and m >= 4:              return "Potencial"
        return "Regular"

    df["segmento"] = df.apply(_segment, axis=1)

    def _s(v, fb=""):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return fb
        return str(v)

    records = []
    for _, r in df.iterrows():
        records.append({
            "numero_cliente": _s(r.get("numero_cliente")),
            "nombre":         _s(r.get("nombre"), _s(r.get("numero_cliente"))),
            "vendedor":       _s(r.get("codigo_vendedor")),
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

    # Segment summary
    from collections import Counter
    seg_counts = Counter(r["segmento"] for r in records)

    result = {
        "ano": ano,
        "total_clientes": len(records),
        "segmentos": dict(seg_counts),
        "data": records,
    }
    cache.set(key, result)
    return result


@router.get("/clientes")
def get_alertas_clientes(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    umbral_yoy: float = Query(-20.0, description="Caída YoY% mínima para alertar"),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    top_n: int = Query(50, ge=1, le=200),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True, description="Excluir puntos de venta (PVTA*)"),
):
    cfg = get_settings()
    key = f"alertas:{ano}:{mes}:{umbral_yoy}:{region}:{vendedor}:{top_n}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    base_joins = []
    base_cond  = []
    base_params = []

    if region:
        base_joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        base_cond.append("dd.DESCRIPCION_REGION = %s")
        base_params.append(region)
    if vendedor:
        base_cond.append("fv.CODIGO_VENDEDOR = %s")
        base_params.append(vendedor)
    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in base_joins):
            base_joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        base_cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        base_cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    join_str = " ".join(base_joins)
    extra_where = (" AND " + " AND ".join(base_cond)) if base_cond else ""

    # When no month selected, cap both years at same YTD month to avoid comparing partial vs full year
    mes_cap = mes
    if not mes:
        try:
            df_cap = connector.query(
                f"SELECT MAX(PERIODO_FISCAL) AS max_mes FROM {cfg.T('FACT_VENTAS')} WHERE ANO_FISCAL = %s",
                [ano]
            )
            mes_cap = int(df_cap["MAX_MES"].iloc[0]) if not df_cap.empty else None
        except Exception:
            mes_cap = None

    # Subquery: current period per client
    cur_where = f"fv.ANO_FISCAL = %s"
    cur_params = [ano] + base_params
    if mes:
        cur_where += " AND fv.PERIODO_FISCAL = %s"
        cur_params.append(mes)
    elif mes_cap:
        cur_where += " AND fv.PERIODO_FISCAL <= %s"
        cur_params.append(mes_cap)

    # Subquery: previous year same period per client
    ano_ant = ano - 1
    ant_where = f"fv.ANO_FISCAL = %s"
    ant_params = [ano_ant] + base_params
    if mes:
        ant_where += " AND fv.PERIODO_FISCAL = %s"
        ant_params.append(mes)
    elif mes_cap:
        ant_where += " AND fv.PERIODO_FISCAL <= %s"
        ant_params.append(mes_cap)

    # Previous month
    mes_ant_params = None
    mom_sql = ""
    if mes:
        mes_ant = mes - 1 if mes > 1 else 12
        ano_mes_ant = ano if mes > 1 else ano - 1
        mom_where = "fv.ANO_FISCAL = %s AND fv.PERIODO_FISCAL = %s"
        mes_ant_params = [ano_mes_ant, mes_ant] + base_params

    try:
        sql_cur = f"""
            SELECT fv.NUMERO_CLIENTE, fv.ID_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS),0)  AS ventas_netas,
                   COALESCE(SUM(fv.CANTIDAD),0)       AS cantidad
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE {cur_where} {extra_where}
            GROUP BY 1, 2
        """
        sql_ant = f"""
            SELECT fv.NUMERO_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS),0)  AS ventas_netas_ant,
                   COALESCE(SUM(fv.CANTIDAD),0)       AS cantidad_ant
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE {ant_where} {extra_where}
            GROUP BY 1
        """
        sql_dim = f"""
            SELECT NUMERO_CLIENTE, NOMBRE, TIPO_CLIENTE, CODIGO_VENDEDOR
            FROM {cfg.TM('DIM_CLIENTE')}
        """
        sql_estado = f"""
            SELECT ID_CLIENTE, ESTADO_CLIENTE, NOMBRE AS nombre_cliente
            FROM {cfg.T('DIM_ESTADO_CLIENTE')}
        """
        sql_vend = f"SELECT CODIGO_VENDEDOR, NOMBRE AS nombre_vendedor FROM {cfg.TM('DIM_VENDEDOR')}"

        df_cur   = connector.query(sql_cur, cur_params)
        df_ant   = connector.query(sql_ant, ant_params)
        df_dim   = connector.query(sql_dim)
        df_estado = connector.query(sql_estado)
        df_vend  = connector.query(sql_vend)

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
        logger.error("Alertas error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    import pandas as pd
    import math

    def _str(v, fallback=""):
        if v is None: return fallback
        if isinstance(v, float) and math.isnan(v): return fallback
        return str(v) if v else fallback

    for df in [df_cur, df_ant, df_dim, df_estado, df_vend] + ([df_mom] if df_mom is not None else []):
        df.columns = [c.lower() for c in df.columns]

    # Merge
    merged = df_cur.merge(df_ant, on="numero_cliente", how="inner")
    merged = merged.merge(df_dim[["numero_cliente","nombre","tipo_cliente","codigo_vendedor"]], on="numero_cliente", how="left")
    merged = merged.merge(df_estado[["id_cliente","estado_cliente"]], on="id_cliente", how="left")
    merged = merged.merge(df_vend, on="codigo_vendedor", how="left")
    if df_mom is not None:
        merged = merged.merge(df_mom, on="numero_cliente", how="left")
        merged["ventas_mes_ant"] = merged["ventas_mes_ant"].fillna(0)

    # Compute YoY variation
    merged = merged[merged["ventas_netas_ant"] > 0].copy()
    merged["variacion_yoy_pct"] = ((merged["ventas_netas"] - merged["ventas_netas_ant"]) / merged["ventas_netas_ant"].abs() * 100).round(2)

    # Filter by threshold
    alertas = merged[merged["variacion_yoy_pct"] <= umbral_yoy].copy()
    alertas = alertas.sort_values("variacion_yoy_pct", ascending=True).head(top_n)

    def _sev(pct):
        if pct <= -50: return "critica"
        if pct <= -30: return "alta"
        return "media"

    records = []
    for _, r in alertas.iterrows():
        vn  = float(r.ventas_netas or 0)
        van = float(r.ventas_netas_ant or 0)
        mom = float(r.ventas_mes_ant) if "ventas_mes_ant" in r and r.ventas_mes_ant is not None else None
        records.append({
            "numero_cliente":   _str(r.numero_cliente),
            "nombre":           _str(r.get("nombre"), _str(r.numero_cliente)),
            "tipo_cliente":     _str(r.get("tipo_cliente")),
            "estado_cliente":   _str(r.get("estado_cliente")),
            "vendedor":         _str(r.get("codigo_vendedor")),
            "nombre_vendedor":  _str(r.get("nombre_vendedor")),
            "ventas_netas":     round(vn, 2),
            "ventas_netas_ant": round(van, 2),
            "ventas_mes_ant":   round(mom, 2) if mom is not None else None,
            "cantidad":         round(float(r.cantidad or 0), 2),
            "cantidad_ant":     round(float(r.cantidad_ant or 0), 2),
            "variacion_yoy_pct": float(r.variacion_yoy_pct),
            "severidad":        _sev(float(r.variacion_yoy_pct)),
        })

    # Summary
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
