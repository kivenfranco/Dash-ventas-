"""
GET /api/rfm — Segmentación RFM de CODIGO_VENDEDOR.
R: recencia  — meses desde última compra (1=bueno→5)
F: frecuencia — meses activos en el período (5=bueno)
M: monetario  — ventas netas totales (5=bueno)
Puntuación 1-5 por quintiles. Segmento derivado de combinación RFM.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/rfm", tags=["RFM"])
logger = logging.getLogger(__name__)


def _quintile(series: pd.Series, ascending: bool = True) -> pd.Series:
    """Quintil 1-5. ascending=True: mayor valor → mayor score."""
    labels = [1, 2, 3, 4, 5] if ascending else [5, 4, 3, 2, 1]
    try:
        return pd.qcut(series.rank(method="first"), q=5, labels=labels).astype(int)
    except Exception:
        ranked = series.rank(method="dense", pct=True)
        return ((ranked * 4.99).astype(int) + 1).clip(1, 5)


def _segmento(r: int, f: int, m: int) -> str:
    if r >= 4 and f >= 4 and m >= 4:
        return "Campeón"
    if f >= 4 and m >= 4:
        return "Cliente Leal"
    if r >= 4 and f >= 2:
        return "Potencial Leal"
    if r >= 3 and f >= 1:
        return "Cliente Reciente"
    if r <= 2 and f >= 3:
        return "En Riesgo"
    if r <= 2 and f >= 2:
        return "Necesita Atención"
    if r == 1 and f == 1:
        return "Perdido"
    return "Hibernando"


_SEGMENT_ORDER = [
    "Campeón", "Cliente Leal", "Potencial Leal", "Cliente Reciente",
    "En Riesgo", "Necesita Atención", "Hibernando", "Perdido",
]


@router.get("")
def get_rfm(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    excl_pvta: bool = Query(True),
    top_n: int = Query(500, ge=10, le=2000),
):
    cfg = get_settings()
    key = f"rfm_seg:{ano}:{mes}:{excl_pvta}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    mes_max = today.month if (not mes and ano == today.year) else None

    conds: list = ["fv.ANO_FISCAL = %s"]
    params: list = [ano]
    if mes:
        conds.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    elif mes_max:
        conds.append("fv.PERIODO_FISCAL <= %s"); params.append(mes_max)
    if excl_pvta:
        conds.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    sql = f"""
        SELECT
            fv.CODIGO_VENDEDOR                       AS vendedor,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)         AS ventas_netas,
            COUNT(DISTINCT fv.PERIODO_FISCAL)          AS meses_activos,
            MAX(fv.PERIODO_FISCAL)                     AS ultimo_mes
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {' AND '.join(conds)}
        GROUP BY 1
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("RFM error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"ano": ano, "mes": mes, "data": [], "resumen": {s: 0 for s in _SEGMENT_ORDER}}

    ref_mes = mes or mes_max or 12
    df["ventas_netas"]  = pd.to_numeric(df["ventas_netas"],  errors="coerce").fillna(0)
    df["meses_activos"] = pd.to_numeric(df["meses_activos"], errors="coerce").fillna(0)
    df["ultimo_mes"]    = pd.to_numeric(df["ultimo_mes"],    errors="coerce").fillna(0)
    df["recencia_gap"]  = (ref_mes - df["ultimo_mes"]).clip(lower=0)

    df["score_r"] = _quintile(df["recencia_gap"],  ascending=False)
    df["score_f"] = _quintile(df["meses_activos"], ascending=True)
    df["score_m"] = _quintile(df["ventas_netas"],  ascending=True)
    df["score_rfm"] = df["score_r"] + df["score_f"] + df["score_m"]
    df["segmento"]  = df.apply(
        lambda r: _segmento(int(r["score_r"]), int(r["score_f"]), int(r["score_m"])), axis=1
    )

    segment_counts = df["segmento"].value_counts().to_dict()

    records = [
        {
            "vendedor":      str(r["vendedor"] or "—"),
            "ventas_netas":  round(float(r["ventas_netas"]), 2),
            "meses_activos": int(r["meses_activos"]),
            "ultimo_mes":    int(r["ultimo_mes"]),
            "recencia_gap":  int(r["recencia_gap"]),
            "score_r":       int(r["score_r"]),
            "score_f":       int(r["score_f"]),
            "score_m":       int(r["score_m"]),
            "score_rfm":     int(r["score_rfm"]),
            "segmento":      r["segmento"],
        }
        for _, r in df.iterrows()
    ]

    result = {
        "ano": ano, "mes": mes, "data": records,
        "resumen": {s: segment_counts.get(s, 0) for s in _SEGMENT_ORDER},
    }
    cache.set(key, result)
    return result
