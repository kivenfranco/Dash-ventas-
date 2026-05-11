"""
GET /api/churn — Predicción de tasa de abandono por cliente.

Mejoras sobre la versión anterior:
- Nuevas features SQL: diversidad_productos, pausa_maxima_meses,
  meses_activo ratio, ratio_actividad.
- Logistic Regression con features ampliadas (class_weight='balanced').
- Fallback heurístico recalibrado: recencia 35 %, tendencia 25 %,
  tendencia_actividad 20 %, inactividad 15 %, diversidad 5 %.
- Nuevo campo lead_time_alerta: 'Inmediato', 'Corto plazo',
  'Mediano plazo', 'Largo plazo'.
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
    cond = "(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else "1=1"

    sql = f"""
        WITH cur AS (
            SELECT
                fv.NUMERO_CLIENTE,
                MAX(fv.ID_CLIENTE)                                              AS id_cliente,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)                               AS ventas_cur,
                COUNT(DISTINCT fv.PERIODO_FISCAL)                               AS meses_cur,
                MAX(fv.PERIODO_FISCAL)                                          AS last_mes_cur,
                COUNT(DISTINCT fv.CODIGO_PRODUCTO)                              AS diversidad_productos
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano} AND {cond}
            GROUP BY fv.NUMERO_CLIENTE
        ),
        prev AS (
            SELECT
                fv.NUMERO_CLIENTE,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)                               AS ventas_prev,
                COUNT(DISTINCT fv.PERIODO_FISCAL)                               AS meses_prev
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano} - 1 AND {cond}
            GROUP BY fv.NUMERO_CLIENTE
        ),
        month_idx AS (
            SELECT
                fv.NUMERO_CLIENTE,
                fv.ANO_FISCAL * 12 + fv.PERIODO_FISCAL AS mes_global
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL IN ({ano}, {ano} - 1) AND {cond}
            GROUP BY fv.NUMERO_CLIENTE, fv.ANO_FISCAL, fv.PERIODO_FISCAL
        ),
        gaps_raw AS (
            SELECT
                NUMERO_CLIENTE,
                mes_global - LAG(mes_global) OVER (
                    PARTITION BY NUMERO_CLIENTE ORDER BY mes_global
                ) AS gap_meses
            FROM month_idx
        ),
        gaps AS (
            SELECT NUMERO_CLIENTE, MAX(gap_meses) AS pausa_maxima_meses
            FROM gaps_raw
            GROUP BY NUMERO_CLIENTE
        )
        SELECT
            COALESCE(c.NUMERO_CLIENTE, p.NUMERO_CLIENTE)    AS numero_cliente,
            COALESCE(c.id_cliente,     NULL)                AS id_cliente,
            COALESCE(c.ventas_cur,     0)                   AS ventas_cur,
            COALESCE(c.meses_cur,      0)                   AS meses_cur,
            COALESCE(c.last_mes_cur,   0)                   AS last_mes,
            COALESCE(p.ventas_prev,    0)                   AS ventas_prev,
            COALESCE(p.meses_prev,     0)                   AS meses_prev,
            COALESCE(c.diversidad_productos,    0)          AS diversidad_productos,
            COALESCE(g.pausa_maxima_meses,      0)          AS pausa_maxima_meses,
            COALESCE(c.meses_cur,               0)          AS meses_activo_cur,
            COALESCE(p.meses_prev,              0)          AS meses_activo_prev
        FROM cur c
        FULL OUTER JOIN prev  p ON c.NUMERO_CLIENTE = p.NUMERO_CLIENTE
        LEFT  JOIN gaps       g ON COALESCE(c.NUMERO_CLIENTE, p.NUMERO_CLIENTE) = g.NUMERO_CLIENTE
        WHERE COALESCE(p.ventas_prev, 0) > 0
    """
    df = connector.query(sql)
    df.columns = [c.lower() for c in df.columns]

    for col in ["ventas_cur", "meses_cur", "last_mes", "ventas_prev", "meses_prev",
                "diversidad_productos", "pausa_maxima_meses",
                "meses_activo_cur", "meses_activo_prev"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["ratio_actividad"] = (
        df["meses_activo_cur"] / df["meses_activo_prev"].replace(0, np.nan)
    ).fillna(0.0).clip(0.0, 3.0)

    return df


def _score_heuristic(df: pd.DataFrame, ref_mes: int) -> pd.Series:
    recencia    = (ref_mes - df["last_mes"]).clip(lower=0) / max(ref_mes, 1)
    tendencia   = (
        1 - (df["ventas_cur"] / df["ventas_prev"].replace(0, np.nan)).fillna(0).clip(0, 3) / 3
    )
    tend_activ  = (1 - df["ratio_actividad"].clip(0, 1))
    inactividad = 1 - (df["meses_cur"] / max(ref_mes, 1)).clip(0, 1)

    max_div = df["diversidad_productos"].max()
    if max_div > 0:
        div_riesgo = 1 - (df["diversidad_productos"] / max_div).clip(0, 1)
    else:
        div_riesgo = pd.Series(0.0, index=df.index)

    return (
        recencia    * 0.35
        + tendencia   * 0.25
        + tend_activ  * 0.20
        + inactividad * 0.15
        + div_riesgo  * 0.05
    ).clip(0, 1)


def _lead_time_alerta(prob_churn: float, last_mes: int, ref_mes: int) -> str:
    meses_inactivo = max(0, ref_mes - last_mes)
    if prob_churn > 0.65 and meses_inactivo >= 3:
        return "Inmediato"
    if prob_churn > 0.50 or meses_inactivo >= 2:
        return "Corto plazo"
    if prob_churn > 0.35 or meses_inactivo >= 1:
        return "Mediano plazo"
    return "Largo plazo"


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

    try:
        df_dim = connector.query(
            f"SELECT NUMERO_CLIENTE, ID_CLIENTE, NOMBRE FROM {cfg.TM('DIM_CLIENTE')}"
        )
        df_dim.columns = [c.lower() for c in df_dim.columns]
        df = df.merge(df_dim, on="numero_cliente", how="left")
    except Exception:
        df["nombre"] = None

    df["churn_real"] = ((df["ventas_prev"] > 0) & (df["meses_cur"] < 2)).astype(int)

    metodo = "heuristic"
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler

        base_features  = ["ventas_prev", "meses_prev", "ventas_cur", "meses_cur", "last_mes"]
        extra_features = ["diversidad_productos", "pausa_maxima_meses", "ratio_actividad"]
        available = [f for f in extra_features if f in df.columns and df[f].notna().any()]
        features   = base_features + available

        X = df[features].fillna(0).values
        y = df["churn_real"].values

        if y.sum() >= 5 and (y == 0).sum() >= 5:
            scaler = StandardScaler()
            X_sc   = scaler.fit_transform(X)
            model  = LogisticRegression(max_iter=400, C=1.0, class_weight="balanced")
            model.fit(X_sc, y)
            prob_churn = model.predict_proba(X_sc)[:, 1]
            metodo = "logistic_regression"
            logger.info("Churn LR trained on %d samples, %d features", len(y), len(features))
        else:
            logger.info("Churn: insufficient label diversity, using heuristic")
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

    df["lead_time_alerta"] = df.apply(
        lambda r: _lead_time_alerta(float(r["prob_churn"]), int(r["last_mes"]), ref_mes),
        axis=1,
    )

    df = df.sort_values("prob_churn", ascending=False).head(top_n)

    variacion = df["ventas_cur"] / df["ventas_prev"].replace(0, np.nan) - 1

    records = []
    for i, (_, r) in enumerate(df.iterrows()):
        var = variacion.iloc[i]
        records.append({
            "numero_cliente":       str(r["numero_cliente"]),
            "id_cliente":           str(r["id_cliente"]) if pd.notna(r.get("id_cliente")) else None,
            "nombre_cliente":       str(r.get("nombre") or r["numero_cliente"]),
            "ventas_cur":           round(float(r["ventas_cur"]), 2),
            "ventas_prev":          round(float(r["ventas_prev"]), 2),
            "meses_cur":            int(r["meses_cur"]),
            "meses_prev":           int(r["meses_prev"]),
            "last_mes":             int(r["last_mes"]),
            "variacion_yoy":        round(float(var) * 100, 1) if pd.notna(var) else None,
            "prob_churn":           round(float(r["prob_churn"]) * 100, 1),
            "riesgo":               r["riesgo"],
            "lead_time_alerta":     r["lead_time_alerta"],
            "diversidad_productos": int(r.get("diversidad_productos", 0)),
            "meses_activo_cur":     int(r.get("meses_activo_cur", 0)),
            "meses_activo_prev":    int(r.get("meses_activo_prev", 0)),
            "ratio_actividad":      round(float(r.get("ratio_actividad", 0)), 2),
            "pausa_maxima_meses":   int(r.get("pausa_maxima_meses", 0)),
        })

    risk_counts = df["riesgo"].value_counts().to_dict()
    lead_counts = df["lead_time_alerta"].value_counts().to_dict()

    result = {
        "ano": ano, "ref_mes": ref_mes, "metodo": metodo,
        "resumen": {
            "Alto":  risk_counts.get("Alto",  0),
            "Medio": risk_counts.get("Medio", 0),
            "Bajo":  risk_counts.get("Bajo",  0),
        },
        "lead_time_resumen": {
            "Inmediato":     lead_counts.get("Inmediato",     0),
            "Corto plazo":   lead_counts.get("Corto plazo",   0),
            "Mediano plazo": lead_counts.get("Mediano plazo", 0),
            "Largo plazo":   lead_counts.get("Largo plazo",   0),
        },
        "data": records,
    }
    cache.set(key, result)
    return result
