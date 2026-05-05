"""
GET /api/churn — Predicción de riesgo de churn por CODIGO_VENDEDOR.
Entrena LogisticRegression en datos históricos (año-1 → etiqueta de churn en año).
Si datos insuficientes, usa scoring heurístico (recencia + tendencia + frecuencia).
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

router = APIRouter(prefix="/api/churn", tags=["Churn"])
logger = logging.getLogger(__name__)


def _fetch_features(cfg, ano: int, excl_pvta: bool) -> pd.DataFrame:
    cond = "UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%'" if excl_pvta else "1=1"
    sql = f"""
        WITH cur AS (
            SELECT
                CODIGO_VENDEDOR,
                COALESCE(SUM(VENTAS_NETAS), 0)          AS ventas_cur,
                COUNT(DISTINCT PERIODO_FISCAL)            AS meses_cur,
                MAX(PERIODO_FISCAL)                       AS last_mes_cur
            FROM {cfg.T('FACT_VENTAS')}
            WHERE ANO_FISCAL = {ano} AND {cond}
            GROUP BY CODIGO_VENDEDOR
        ),
        prev AS (
            SELECT
                CODIGO_VENDEDOR,
                COALESCE(SUM(VENTAS_NETAS), 0)          AS ventas_prev,
                COUNT(DISTINCT PERIODO_FISCAL)            AS meses_prev
            FROM {cfg.T('FACT_VENTAS')}
            WHERE ANO_FISCAL = {ano - 1} AND {cond}
            GROUP BY CODIGO_VENDEDOR
        )
        SELECT
            COALESCE(c.CODIGO_VENDEDOR, p.CODIGO_VENDEDOR)  AS vendedor,
            COALESCE(c.ventas_cur, 0)                        AS ventas_cur,
            COALESCE(c.meses_cur, 0)                         AS meses_cur,
            COALESCE(c.last_mes_cur, 0)                      AS last_mes,
            COALESCE(p.ventas_prev, 0)                       AS ventas_prev,
            COALESCE(p.meses_prev, 0)                        AS meses_prev
        FROM cur c
        FULL OUTER JOIN prev p ON c.CODIGO_VENDEDOR = p.CODIGO_VENDEDOR
        WHERE COALESCE(p.ventas_prev, 0) > 0
    """
    df = connector.query(sql)
    df.columns = [c.lower() for c in df.columns]
    for col in ["ventas_cur", "meses_cur", "last_mes", "ventas_prev", "meses_prev"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def _score_heuristic(df: pd.DataFrame, ref_mes: int) -> pd.Series:
    """Calcula prob. de churn 0-1 usando reglas ponderadas."""
    recencia   = (ref_mes - df["last_mes"]).clip(lower=0) / ref_mes
    tendencia  = (1 - (df["ventas_cur"] / df["ventas_prev"].replace(0, float("nan"))).fillna(0).clip(0, 3)) / 2
    inactividad = 1 - (df["meses_cur"] / ref_mes).clip(0, 1)
    score = (recencia * 0.40 + tendencia * 0.35 + inactividad * 0.25).clip(0, 1)
    return score


@router.get("")
def get_churn(
    ano: int = Query(default_factory=lambda: date.today().year),
    excl_pvta: bool = Query(True),
    top_n: int = Query(200, ge=10, le=1000),
):
    cfg = get_settings()
    today = date.today()
    ref_mes = today.month if ano == today.year else 12
    key = f"churn:{ano}:{excl_pvta}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    try:
        df = _fetch_features(cfg, ano, excl_pvta)
    except Exception as exc:
        logger.error("Churn fetch error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"ano": ano, "data": [], "metodo": "sin_datos"}

    # churn label: was active last year, has < 2 active months this year
    df["churn_real"] = ((df["ventas_prev"] > 0) & (df["meses_cur"] < 2)).astype(int)

    metodo = "heuristic"
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler

        features = ["ventas_prev", "meses_prev", "ventas_cur", "meses_cur", "last_mes"]
        X = df[features].values
        y = df["churn_real"].values

        if y.sum() >= 5 and (y == 0).sum() >= 5:
            scaler = StandardScaler()
            X_sc   = scaler.fit_transform(X)
            model  = LogisticRegression(max_iter=300, C=1.0)
            model.fit(X_sc, y)
            prob_churn = model.predict_proba(X_sc)[:, 1]
            metodo = "logistic_regression"
        else:
            prob_churn = _score_heuristic(df, ref_mes).values
    except Exception as exc:
        logger.warning("LR failed (%s), using heuristic", exc)
        prob_churn = _score_heuristic(df, ref_mes).values

    df["prob_churn"] = np.clip(prob_churn, 0, 1)
    df["riesgo"] = pd.cut(
        df["prob_churn"],
        bins=[-0.001, 0.35, 0.65, 1.001],
        labels=["Bajo", "Medio", "Alto"],
    ).astype(str)

    df = df.sort_values("prob_churn", ascending=False).head(top_n)

    variacion = (df["ventas_cur"] / df["ventas_prev"].replace(0, float("nan")) - 1).fillna(None)

    records = []
    for i, (_, r) in enumerate(df.iterrows()):
        var = variacion.iloc[i]
        records.append({
            "vendedor":       str(r["vendedor"]),
            "ventas_cur":     round(float(r["ventas_cur"]), 2),
            "ventas_prev":    round(float(r["ventas_prev"]), 2),
            "meses_cur":      int(r["meses_cur"]),
            "meses_prev":     int(r["meses_prev"]),
            "last_mes":       int(r["last_mes"]),
            "variacion_yoy":  round(float(var) * 100, 1) if pd.notna(var) else None,
            "prob_churn":     round(float(r["prob_churn"]) * 100, 1),
            "riesgo":         r["riesgo"],
        })

    risk_counts = df["riesgo"].value_counts().to_dict()
    result = {
        "ano": ano, "ref_mes": ref_mes, "metodo": metodo,
        "resumen": {
            "Alto":  risk_counts.get("Alto",  0),
            "Medio": risk_counts.get("Medio", 0),
            "Bajo":  risk_counts.get("Bajo",  0),
        },
        "data": records,
    }
    cache.set(key, result)
    return result
