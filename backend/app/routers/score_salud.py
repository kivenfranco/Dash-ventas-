"""
GET /api/score-salud — Score de salud 0-100 por vendedor/cliente.
Combina monetario (40%) + recencia (30%) + tendencia YoY (30%).
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

router = APIRouter(prefix="/api/score-salud", tags=["ScoreSalud"])
logger = logging.getLogger(__name__)


def _sanitize(obj):
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


def _prank(series: pd.Series) -> pd.Series:
    """Percentile rank normalizado a 0-100."""
    return series.rank(pct=True) * 100


@router.get("")
def get_score(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(100, ge=10, le=500),
    excl_pvta: bool = Query(True),
):
    cfg = get_settings()
    key = f"score:{ano}:{mes}:{top_n}:{excl_pvta}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    mes_max = today.month if (not mes and ano == today.year) else None

    cond_cur = ["fv.ANO_FISCAL = %s"]
    params_cur: list = [ano]
    if mes:
        cond_cur.append("fv.PERIODO_FISCAL = %s"); params_cur.append(mes)
    elif mes_max:
        cond_cur.append("fv.PERIODO_FISCAL <= %s"); params_cur.append(mes_max)
    if excl_pvta:
        cond_cur.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    cond_ant = ["fv.ANO_FISCAL = %s"]
    params_ant: list = [ano - 1]
    if mes:
        cond_ant.append("fv.PERIODO_FISCAL = %s"); params_ant.append(mes)
    elif mes_max:
        cond_ant.append("fv.PERIODO_FISCAL <= %s"); params_ant.append(mes_max)
    if excl_pvta:
        cond_ant.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    sql_cur = f"""
        SELECT
            fv.CODIGO_VENDEDOR                     AS vendedor,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)       AS ventas_netas,
            COUNT(DISTINCT fv.PERIODO_FISCAL)        AS meses_activos,
            MAX(fv.PERIODO_FISCAL)                   AS ultimo_mes,
            COUNT(DISTINCT fv.CODIGO_PRODUCTO)       AS num_productos
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {' AND '.join(cond_cur)}
        GROUP BY 1
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    sql_ant = f"""
        SELECT fv.CODIGO_VENDEDOR AS vendedor, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_ant
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {' AND '.join(cond_ant)}
        GROUP BY 1
    """

    try:
        df     = connector.query(sql_cur, params_cur)
        df_ant = connector.query(sql_ant, params_ant)
        df.columns     = [c.lower() for c in df.columns]
        df_ant.columns = [c.lower() for c in df_ant.columns]
    except Exception as exc:
        logger.error("Score salud error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df = df.merge(df_ant, on="vendedor", how="left")
    df["ventas_ant"] = pd.to_numeric(df["ventas_ant"], errors="coerce").fillna(0)
    df["ventas_netas"] = pd.to_numeric(df["ventas_netas"], errors="coerce").fillna(0)
    df["meses_activos"] = pd.to_numeric(df["meses_activos"], errors="coerce").fillna(0)
    df["ultimo_mes"] = pd.to_numeric(df["ultimo_mes"], errors="coerce").fillna(0)

    max_mes = mes or mes_max or 12
    df["recencia"] = max_mes - df["ultimo_mes"]  # 0=activo este mes, mayor=más inactivo

    # Componentes 0-100
    df["score_monetario"]  = _prank(df["ventas_netas"])
    df["score_recencia"]   = 100 - _prank(df["recencia"])  # menos meses = mejor
    df["score_frecuencia"] = _prank(df["meses_activos"])

    df["variacion_yoy"] = df.apply(
        lambda r: ((r["ventas_netas"] / r["ventas_ant"]) - 1) * 100 if r["ventas_ant"] > 0 else None,
        axis=1,
    )
    df["score_tendencia"] = _prank(df["variacion_yoy"].fillna(df["variacion_yoy"].median()))

    df["score_salud"] = (
        df["score_monetario"]  * 0.40 +
        df["score_recencia"]   * 0.30 +
        df["score_tendencia"]  * 0.30
    ).round(1)

    records = []
    for _, r in df.iterrows():
        records.append({
            "vendedor":        str(r["vendedor"] or "—"),
            "ventas_netas":    round(float(r["ventas_netas"]), 2),
            "ventas_ant":      round(float(r["ventas_ant"]), 2),
            "meses_activos":   int(r["meses_activos"]),
            "ultimo_mes":      int(r["ultimo_mes"]),
            "num_productos":   int(r.get("num_productos", 0)),
            "variacion_yoy_pct": round(float(r["variacion_yoy"]), 2) if pd.notna(r["variacion_yoy"]) else None,
            "score_salud":     round(float(r["score_salud"]), 1),
            "score_monetario": round(float(r["score_monetario"]), 1),
            "score_recencia":  round(float(r["score_recencia"]), 1),
            "score_tendencia": round(float(r["score_tendencia"]), 1),
        })

    result = _sanitize({"ano": ano, "mes": mes, "data": records})
    cache.set(key, result)
    return result
