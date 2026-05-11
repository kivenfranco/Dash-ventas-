"""
GET /api/riesgo-cliente — Score de riesgo unificado por cliente.

Combina tres señales ponderadas:
  1. Churn score  (40 %): recencia + tendencia ventas + inactividad mensual
  2. YoY decline  (35 %): caída de ventas vs año anterior
  3. CLV weight   (25 %): amplificador — clientes de mayor valor histórico
                          tienen mayor urgencia cuando presentan riesgo

risk_score 0–100 (100 = máximo riesgo).
Nivel: Alto (≥65), Medio (≥35), Bajo (<35).
"""
import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/riesgo-cliente", tags=["Riesgo Cliente"])
logger = logging.getLogger(__name__)


@router.get("")
def get_riesgo_cliente(
    ano: int = Query(default_factory=lambda: date.today().year),
    excl_pvta: bool = Query(True),
    top_n: int = Query(200, ge=10, le=1000),
):
    cfg = get_settings()
    today = date.today()
    ref_mes = today.month if ano == today.year else 12

    cache_key = f"riesgo_cliente:{ano}:{excl_pvta}:{top_n}"
    if (hit := cache.get(cache_key)):
        return hit

    cond = "(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else "1=1"

    sql = f"""
        WITH cur AS (
            SELECT
                fv.NUMERO_CLIENTE,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)          AS ventas_cur,
                COUNT(DISTINCT fv.PERIODO_FISCAL)            AS meses_cur,
                MAX(fv.PERIODO_FISCAL)                       AS last_mes_cur,
                COUNT(DISTINCT fv.CODIGO_PRODUCTO)           AS diversidad_productos
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano} AND {cond}
            GROUP BY fv.NUMERO_CLIENTE
        ),
        prev AS (
            SELECT
                fv.NUMERO_CLIENTE,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)          AS ventas_prev,
                COUNT(DISTINCT fv.PERIODO_FISCAL)            AS meses_prev
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano - 1} AND {cond}
            GROUP BY fv.NUMERO_CLIENTE
        ),
        hist AS (
            SELECT
                fv.NUMERO_CLIENTE,
                SUM(fv.VENTAS_NETAS)                        AS ventas_total,
                COUNT(DISTINCT fv.ANO_FISCAL)               AS anos_activos
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL <= {ano} AND {cond}
            GROUP BY fv.NUMERO_CLIENTE
        )
        SELECT
            COALESCE(c.NUMERO_CLIENTE, p.NUMERO_CLIENTE)   AS numero_cliente,
            COALESCE(c.ventas_cur,               0)        AS ventas_cur,
            COALESCE(c.meses_cur,                0)        AS meses_cur,
            COALESCE(c.last_mes_cur,             0)        AS last_mes,
            COALESCE(c.diversidad_productos,     0)        AS diversidad_productos,
            COALESCE(p.ventas_prev,              0)        AS ventas_prev,
            COALESCE(p.meses_prev,               0)        AS meses_prev,
            COALESCE(h.ventas_total,             0)        AS ventas_total,
            COALESCE(h.anos_activos,             0)        AS anos_activos
        FROM cur c
        FULL OUTER JOIN prev  p ON c.NUMERO_CLIENTE = p.NUMERO_CLIENTE
        LEFT  JOIN hist       h ON COALESCE(c.NUMERO_CLIENTE, p.NUMERO_CLIENTE) = h.NUMERO_CLIENTE
        WHERE COALESCE(p.ventas_prev, 0) > 0
    """

    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Riesgo cliente error: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"ano": ano, "ref_mes": ref_mes, "resumen": {"Alto": 0, "Medio": 0, "Bajo": 0}, "data": []}

    for col in ["ventas_cur", "ventas_prev", "ventas_total",
                "meses_cur", "meses_prev", "last_mes",
                "diversidad_productos", "anos_activos"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Merge client names
    try:
        df_dim = connector.query(f"SELECT NUMERO_CLIENTE, ID_CLIENTE, NOMBRE FROM {cfg.TM('DIM_CLIENTE')}")
        df_dim.columns = [c.lower() for c in df_dim.columns]
        df = df.merge(df_dim, on="numero_cliente", how="left")
    except Exception:
        df["nombre"]     = None
        df["id_cliente"] = None

    # ── Signal 1: Churn score ─────────────────────────────────────────────────
    recencia    = (ref_mes - df["last_mes"]).clip(lower=0) / max(ref_mes, 1)
    inactividad = 1 - (df["meses_cur"] / max(ref_mes, 1)).clip(0, 1)
    tendencia   = (
        1 - (df["ventas_cur"] / df["ventas_prev"].replace(0, np.nan))
        .fillna(0).clip(0, 3) / 3
    )
    churn_score = (recencia * 0.40 + tendencia * 0.35 + inactividad * 0.25).clip(0, 1)

    # ── Signal 2: YoY decline score ───────────────────────────────────────────
    yoy_ratio = (
        df["ventas_cur"] / df["ventas_prev"].replace(0, np.nan)
    ).fillna(0).clip(0, 3)
    yoy_score = (1 - yoy_ratio / 3).clip(0, 1)

    # ── Signal 3: CLV importance (amplifier) ──────────────────────────────────
    lifespan    = df["anos_activos"].apply(lambda a: min(1.5, 1.0 + float(a) * 0.05))
    clv_raw     = (df["ventas_total"] * lifespan).clip(lower=0)
    clv_max     = float(clv_raw.max()) if clv_raw.max() > 0 else 1.0
    clv_weight  = (clv_raw / clv_max).clip(0, 1)

    # ── Unified risk score ─────────────────────────────────────────────────────
    base  = churn_score * 0.40 + yoy_score * 0.35 + (1 - clv_weight) * 0.25
    raw   = base * (1 + clv_weight * 0.5)
    raw_max = float(raw.max()) if raw.max() > 0 else 1.0
    risk_score = (raw / raw_max * 100).clip(0, 100)

    df["risk_score"]  = risk_score.round(1)
    df["churn_score"] = (churn_score * 100).round(1)
    df["yoy_score"]   = (yoy_score * 100).round(1)
    df["clv_weight"]  = (clv_weight * 100).round(1)

    df["nivel"] = pd.cut(
        df["risk_score"],
        bins=[-0.001, 35, 65, 100.001],
        labels=["Bajo", "Medio", "Alto"],
    ).astype(str)

    df = df.sort_values("risk_score", ascending=False).head(top_n)

    variacion = df["ventas_cur"] / df["ventas_prev"].replace(0, np.nan) - 1

    records = []
    for i, (_, r) in enumerate(df.iterrows()):
        var = variacion.iloc[i]
        records.append({
            "numero_cliente":     str(r["numero_cliente"]),
            "id_cliente":         str(r["id_cliente"]) if pd.notna(r.get("id_cliente")) else None,
            "nombre_cliente":     str(r.get("nombre") or r["numero_cliente"]),
            "ventas_cur":         round(float(r["ventas_cur"]), 2),
            "ventas_prev":        round(float(r["ventas_prev"]), 2),
            "ventas_total":       round(float(r["ventas_total"]), 2),
            "meses_cur":          int(r["meses_cur"]),
            "last_mes":           int(r["last_mes"]),
            "diversidad_productos": int(r["diversidad_productos"]),
            "anos_activos":       int(r["anos_activos"]),
            "variacion_yoy":      round(float(var) * 100, 1) if pd.notna(var) else None,
            "risk_score":         float(r["risk_score"]),
            "churn_score":        float(r["churn_score"]),
            "yoy_score":          float(r["yoy_score"]),
            "clv_weight":         float(r["clv_weight"]),
            "nivel":              r["nivel"],
        })

    nivel_counts = df["nivel"].value_counts().to_dict()
    result = {
        "ano":     ano,
        "ref_mes": ref_mes,
        "resumen": {
            "Alto":  nivel_counts.get("Alto",  0),
            "Medio": nivel_counts.get("Medio", 0),
            "Bajo":  nivel_counts.get("Bajo",  0),
        },
        "data": records,
    }

    cache.set(cache_key, result)
    return result
