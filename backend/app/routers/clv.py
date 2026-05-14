"""
GET /api/clv — Customer Lifetime Value estimado por cliente.

Metodología mejorada:
- Churn probability derivada de recencia (quintil RFM), tendencia YoY y meses activos.
- Expected lifetime = 1 / churn_prob (techo 10 años).
- CLV = avg_annual_value × lifetime × retention_multiplier
  retention_multiplier = min(1.5, 1.0 + tenure_years × 0.05)
- Campos por cliente: churn_prob, lifetime_estimado_anos, clv_base, clv_con_retencion.
- Segmentos Platinum/Gold/Silver/Bronze por percentiles del CLV.
"""
import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from ..deps import vendedor_override

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/clv", tags=["CLV"])
logger = logging.getLogger(__name__)


def _quintile(series: pd.Series, ascending: bool = True) -> pd.Series:
    labels = [1, 2, 3, 4, 5] if ascending else [5, 4, 3, 2, 1]
    try:
        return pd.qcut(series.rank(method="first"), q=5, labels=labels).astype(int)
    except Exception:
        ranked = series.rank(method="dense", pct=True)
        return ((ranked * 4.99).astype(int) + 1).clip(1, 5)


def _churn_probability(score_r: float, yoy_trend: float, meses_activo: float) -> float:
    recencia_component  = (5.0 - float(score_r)) * 0.1375
    trend_capped        = float(np.clip(yoy_trend, 0.0, 2.0))
    tendencia_component = (1.0 - trend_capped / 2.0) * 0.30
    actividad_component = max(0.0, 1.0 - float(meses_activo) / 12.0) * 0.20
    base = 0.05 + recencia_component + tendencia_component + actividad_component
    return float(np.clip(base, 0.05, 0.95))


def _retention_multiplier(tenure_years: float) -> float:
    return min(1.5, 1.0 + float(tenure_years) * 0.05)


def _segmento_clv(clv: float, q25: float, q50: float, q75: float) -> str:
    if clv > q75:  return "Platinum"
    if clv > q50:  return "Gold"
    if clv > q25:  return "Silver"
    return "Bronze"


@router.get("")
def get_clv(
    request: Request,
    ano: int = Query(default_factory=lambda: date.today().year),
    excl_pvta: bool = Query(True),
    vendedor: Optional[str] = None,
    top_n: int = Query(200, ge=10, le=1000),
):
    forced = vendedor_override(request)
    if forced:
        vendedor = forced

    cfg = get_settings()
    today = date.today()
    ref_mes = today.month if ano == today.year else 12

    key = f"clv:{ano}:{excl_pvta}:{vendedor}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    pvta_fv  = "(UPPER(fv.CODIGO_VENDEDOR)  NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR  IS NULL)"
    pvta_fv2 = "(UPPER(fv2.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv2.CODIGO_VENDEDOR IS NULL)"

    base_where = "fv.NUMERO_CLIENTE IS NOT NULL"
    if excl_pvta:
        base_where += f" AND {pvta_fv}"
    if vendedor:
        ven_safe = str(vendedor).replace("'", "''")
        base_where += f" AND fv.CODIGO_VENDEDOR = '{ven_safe}'"
    inner_fv2 = pvta_fv2 if excl_pvta else "1=1"
    if vendedor:
        inner_fv2 += f" AND fv2.CODIGO_VENDEDOR = '{ven_safe}'"

    sql = f"""
        WITH ann AS (
            SELECT
                fv.NUMERO_CLIENTE,
                fv.ANO_FISCAL,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)   AS ventas_ano,
                COUNT(DISTINCT fv.PERIODO_FISCAL)    AS meses_ano
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE {base_where} AND fv.ANO_FISCAL <= {ano}
            GROUP BY fv.NUMERO_CLIENTE, fv.ANO_FISCAL
        ),
        prev_year AS (
            SELECT NUMERO_CLIENTE, ventas_ano AS ventas_prev
            FROM ann WHERE ANO_FISCAL = {ano} - 1
        ),
        last_mes_cte AS (
            SELECT fv2.NUMERO_CLIENTE, MAX(fv2.PERIODO_FISCAL) AS ultimo_mes
            FROM {cfg.T('FACT_VENTAS')} fv2
            WHERE fv2.ANO_FISCAL = {ano} AND {inner_fv2}
            GROUP BY fv2.NUMERO_CLIENTE
        ),
        agg AS (
            SELECT
                ann.NUMERO_CLIENTE,
                MAX(dc.ID_CLIENTE)                                                    AS id_cliente,
                MAX(dc.NOMBRE)                                                        AS nombre_cliente,
                COUNT(DISTINCT ann.ANO_FISCAL)                                        AS anos_activos,
                MIN(ann.ANO_FISCAL)                                                   AS primer_ano,
                MAX(ann.ANO_FISCAL)                                                   AS ultimo_ano,
                SUM(CASE WHEN ann.ANO_FISCAL = {ano} THEN ann.ventas_ano ELSE 0 END) AS ventas_ano_actual,
                MAX(CASE WHEN ann.ANO_FISCAL = {ano} THEN ann.meses_ano  ELSE 0 END) AS meses_activo_cur,
                SUM(ann.ventas_ano) / NULLIF(COUNT(DISTINCT ann.ANO_FISCAL), 0)       AS avg_annual_value
            FROM ann
            LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON ann.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
            GROUP BY ann.NUMERO_CLIENTE
        )
        SELECT
            a.*,
            COALESCE(lm.ultimo_mes,  0) AS ultimo_mes,
            COALESCE(py.ventas_prev, 0) AS ventas_prev_safe
        FROM agg a
        LEFT JOIN last_mes_cte lm ON a.NUMERO_CLIENTE = lm.NUMERO_CLIENTE
        LEFT JOIN prev_year    py ON a.NUMERO_CLIENTE = py.NUMERO_CLIENTE
        ORDER BY ventas_ano_actual DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("CLV error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"ano": ano, "data": [], "resumen": {}}

    for col in ["anos_activos", "avg_annual_value", "ventas_ano_actual",
                "meses_activo_cur", "ultimo_mes", "ventas_prev_safe",
                "primer_ano", "ultimo_ano"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Recencia score (quintil 1-5; 5 = compró más recientemente)
    df["recencia_gap"] = (ref_mes - df["ultimo_mes"]).clip(lower=0)
    if df["recencia_gap"].nunique() > 1:
        df["score_r"] = _quintile(df["recencia_gap"], ascending=False)
    else:
        df["score_r"] = 3

    # Tendencia YoY
    df["yoy_trend"] = (
        df["ventas_ano_actual"] / df["ventas_prev_safe"].replace(0, np.nan)
    ).fillna(0.0).clip(0.0, 3.0)

    # Churn y lifetime
    df["churn_prob"] = df.apply(
        lambda r: _churn_probability(float(r["score_r"]), float(r["yoy_trend"]), float(r["meses_activo_cur"])),
        axis=1,
    )
    df["lifetime_estimado_anos"] = (1.0 / df["churn_prob"]).clip(upper=10.0).round(2)

    # Antigüedad y retención
    df["tenure_years"]         = (ano - df["primer_ano"]).clip(lower=0)
    df["retention_multiplier"] = df["tenure_years"].apply(_retention_multiplier)

    # CLV
    df["clv_base"]          = (df["avg_annual_value"] * df["lifetime_estimado_anos"]).round(2)
    df["clv_con_retencion"] = (df["clv_base"] * df["retention_multiplier"]).round(2)
    df["clv_estimado"]      = df["clv_con_retencion"]

    q25, q50, q75 = df["clv_estimado"].quantile([0.25, 0.50, 0.75])
    df["segmento"] = df["clv_estimado"].apply(lambda v: _segmento_clv(v, q25, q50, q75))

    records = [
        {
            "numero_cliente":         str(r["numero_cliente"]),
            "id_cliente":             str(r["id_cliente"]) if pd.notna(r.get("id_cliente")) else None,
            "nombre_cliente":         str(r.get("nombre_cliente") or r["numero_cliente"]),
            "anos_activos":           int(r["anos_activos"]),
            "primer_ano":             int(r.get("primer_ano") or 0),
            "ultimo_ano":             int(r.get("ultimo_ano") or 0),
            "ventas_ano_actual":      round(float(r["ventas_ano_actual"]), 2),
            "avg_annual_value":       round(float(r["avg_annual_value"]), 2),
            "churn_prob":             round(float(r["churn_prob"]) * 100, 1),
            "lifetime_estimado_anos": round(float(r["lifetime_estimado_anos"]), 2),
            "clv_base":               round(float(r["clv_base"]), 2),
            "clv_con_retencion":      round(float(r["clv_con_retencion"]), 2),
            # Backward compat aliases
            "lifespan_factor":        round(float(r["lifetime_estimado_anos"]), 2),
            "clv_estimado":           round(float(r["clv_estimado"]), 2),
            "segmento":               r["segmento"],
        }
        for _, r in df.iterrows()
    ]

    total_ventas    = df["ventas_ano_actual"].sum()
    churn_ponderado = (
        float((df["churn_prob"] * df["ventas_ano_actual"]).sum() / total_ventas)
        if total_ventas > 0 else float(df["churn_prob"].mean())
    )

    result = {
        "ano": ano,
        "data": records,
        "resumen": {
            "total_clv":                     round(float(df["clv_estimado"].sum()), 2),
            "avg_clv":                       round(float(df["clv_estimado"].mean()), 2),
            "clv_promedio":                  round(float(df["clv_estimado"].mean()), 2),
            "lifetime_promedio":             round(float(df["lifetime_estimado_anos"].mean()), 2),
            "churn_prob_promedio_ponderado": round(churn_ponderado * 100, 1),
            "por_segmento":                  df["segmento"].value_counts().to_dict(),
        },
    }
    cache.set(key, result)
    return result
