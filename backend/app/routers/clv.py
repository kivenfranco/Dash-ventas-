"""
GET /api/clv — Customer Lifetime Value estimado por CODIGO_VENDEDOR.
CLV = avg_annual_value × lifespan_factor
lifespan_factor: ≥3 años→5x, ≥2→3x, ≥1→1.5x, <1→1x
Segmentos: Platinum / Gold / Silver / Bronze (cuartiles de CLV).
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/clv", tags=["CLV"])
logger = logging.getLogger(__name__)


def _lifespan(anos: float) -> float:
    if anos >= 3:
        return 5.0
    if anos >= 2:
        return 3.0
    if anos >= 1:
        return 1.5
    return 1.0


@router.get("")
def get_clv(
    ano: int = Query(default_factory=lambda: date.today().year),
    excl_pvta: bool = Query(True),
    top_n: int = Query(200, ge=10, le=1000),
):
    cfg = get_settings()
    key = f"clv:{ano}:{excl_pvta}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    conds: list = ["CODIGO_VENDEDOR IS NOT NULL"]
    if excl_pvta:
        conds.append("UPPER(CODIGO_VENDEDOR) NOT LIKE 'PVTA%'")
    where = " AND ".join(conds)

    sql = f"""
        WITH ann AS (
            SELECT
                CODIGO_VENDEDOR,
                ANO_FISCAL,
                COALESCE(SUM(VENTAS_NETAS), 0) AS ventas_ano
            FROM {cfg.T('FACT_VENTAS')}
            WHERE {where} AND ANO_FISCAL <= {ano}
            GROUP BY CODIGO_VENDEDOR, ANO_FISCAL
        )
        SELECT
            CODIGO_VENDEDOR                                          AS vendedor,
            COUNT(DISTINCT ANO_FISCAL)                               AS anos_activos,
            MIN(ANO_FISCAL)                                          AS primer_ano,
            MAX(ANO_FISCAL)                                          AS ultimo_ano,
            SUM(CASE WHEN ANO_FISCAL = {ano} THEN ventas_ano ELSE 0 END) AS ventas_ano_actual,
            SUM(ventas_ano) / NULLIF(COUNT(DISTINCT ANO_FISCAL), 0) AS avg_annual_value
        FROM ann
        GROUP BY CODIGO_VENDEDOR
        ORDER BY ventas_ano_actual DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("CLV error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    for col in ["anos_activos", "avg_annual_value", "ventas_ano_actual"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["lifespan_factor"] = df["anos_activos"].apply(_lifespan)
    df["clv_estimado"]    = (df["avg_annual_value"] * df["lifespan_factor"]).round(2)

    q25, q50, q75 = df["clv_estimado"].quantile([0.25, 0.50, 0.75])

    def _seg(clv: float) -> str:
        if clv > q75:   return "Platinum"
        if clv > q50:   return "Gold"
        if clv > q25:   return "Silver"
        return "Bronze"

    df["segmento"] = df["clv_estimado"].apply(_seg)

    records = [
        {
            "vendedor":          str(r["vendedor"]),
            "anos_activos":      int(r["anos_activos"]),
            "primer_ano":        int(r.get("primer_ano") or 0),
            "ultimo_ano":        int(r.get("ultimo_ano") or 0),
            "ventas_ano_actual": round(float(r["ventas_ano_actual"]), 2),
            "avg_annual_value":  round(float(r["avg_annual_value"]), 2),
            "lifespan_factor":   float(r["lifespan_factor"]),
            "clv_estimado":      round(float(r["clv_estimado"]), 2),
            "segmento":          r["segmento"],
        }
        for _, r in df.iterrows()
    ]

    result = {
        "ano": ano,
        "data": records,
        "resumen": {
            "total_clv":    round(float(df["clv_estimado"].sum()), 2),
            "avg_clv":      round(float(df["clv_estimado"].mean()), 2),
            "por_segmento": df["segmento"].value_counts().to_dict(),
        },
    }
    cache.set(key, result)
    return result
