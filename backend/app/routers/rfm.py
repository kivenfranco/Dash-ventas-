"""
GET /api/rfm — Segmentación RFM por cliente.
R: recencia  — meses desde última compra (1=bueno→5)
F: frecuencia — meses activos en el período (5=bueno)
M: monetario  — ventas netas totales (5=bueno)
Puntuación 1-5 por quintiles. Segmento derivado de combinación RFM.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from ..deps import vendedor_override

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
    request: Request,
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    excl_pvta: bool = Query(True),
    vendedor: Optional[str] = None,
    top_n: int = Query(500, ge=10, le=2000),
):
    forced = vendedor_override(request)
    if forced:
        vendedor = forced

    cfg = get_settings()
    key = f"rfm_seg:{ano}:{mes}:{mes_fin}:{excl_pvta}:{vendedor}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    mes_max = today.month if (not mes and ano == today.year) else None

    where_parts: list = [f"fv.ANO_FISCAL = {ano}"]
    if mes and mes_fin and mes_fin > mes:
        where_parts.append(f"fv.PERIODO_FISCAL BETWEEN {mes} AND {mes_fin}")
    elif mes:
        where_parts.append(f"fv.PERIODO_FISCAL = {mes}")
    elif mes_max:
        where_parts.append(f"fv.PERIODO_FISCAL <= {mes_max}")
    
    if excl_pvta:
        where_parts.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")
    if vendedor:
        ven_safe = str(vendedor).replace("'", "''")
        where_parts.append(f"fv.CODIGO_VENDEDOR = '{ven_safe}'")

    where_clause = " AND ".join(where_parts)

    sql = f"""
        SELECT
            fv.NUMERO_CLIENTE                                         AS numero_cliente,
            MAX(fv.ID_CLIENTE)                                        AS id_cliente,
            COALESCE(MAX(dc.NOMBRE), TO_VARCHAR(fv.NUMERO_CLIENTE))   AS nombre_cliente,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)                          AS ventas_netas,
            COUNT(DISTINCT fv.PERIODO_FISCAL)          AS meses_activos,
            MAX(fv.PERIODO_FISCAL)                     AS ultimo_mes
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
        WHERE {where_clause}
        GROUP BY fv.NUMERO_CLIENTE
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("RFM error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"ano": ano, "mes": mes, "data": [], "resumen": {s: 0 for s in _SEGMENT_ORDER}}

    ref_mes = mes_fin or mes or mes_max or 12
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
            "numero_cliente": str(r["numero_cliente"] or "—"),
            "id_cliente":     str(r["id_cliente"]) if pd.notna(r.get("id_cliente")) else None,
            "nombre_cliente": str(r.get("nombre_cliente") or r["numero_cliente"]),
            "ventas_netas":   round(float(r["ventas_netas"]), 2),
            "meses_activos":  int(r["meses_activos"]),
            "ultimo_mes":     int(r["ultimo_mes"]),
            "recencia_gap":   int(r["recencia_gap"]),
            "score_r":        int(r["score_r"]),
            "score_f":        int(r["score_f"]),
            "score_m":        int(r["score_m"]),
            "score_rfm":      int(r["score_rfm"]),
            "segmento":       r["segmento"],
        }
        for _, r in df.iterrows()
    ]

    result = {
        "ano": ano, "mes": mes, "mes_fin": mes_fin, "data": records,
        "resumen": {s: segment_counts.get(s, 0) for s in _SEGMENT_ORDER},
    }
    cache.set(key, result)
    return result
