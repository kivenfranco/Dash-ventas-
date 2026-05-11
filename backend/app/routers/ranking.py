"""
GET /api/ranking — Ranking dinámico de productos/estructuras mes a mes.
Calcula posición actual vs mes anterior y el delta de ranking.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/ranking", tags=["Ranking"])
logger = logging.getLogger(__name__)

_VALID_GROUPS = "^(descripcion|estructura|linea_negocio|dispositivo|tipo_producto)$"

_DIM_MAP = {
    "descripcion":    ("COALESCE(dgc.NOMBRE_GRUPO, dgp.LINEA_NEGOCIO, fv.CODIGO_PRODUCTO)", "grupo_com"),
    "estructura":     ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",                     "grupo"),
    "linea_negocio":  ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",                     "grupo"),
    "dispositivo":    ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",                     "grupo"),
    "tipo_producto":  ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",                     "grupo"),
}


def _query_mes(cfg, dim_col, joins_str, ano, mes, top_n, params_extra=None):
    params: list = [ano, mes] + (params_extra or [])
    sql = f"""
        SELECT {dim_col} AS dimension, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        {joins_str}
        WHERE fv.ANO_FISCAL = %s AND fv.PERIODO_FISCAL = %s
        GROUP BY 1
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    return connector.query(sql, params)


@router.get("")
def get_ranking(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    group_by: str = Query("descripcion", pattern=_VALID_GROUPS),
    top_n: int = Query(30, ge=5, le=100),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    cfg = get_settings()
    today = date.today()
    mes_actual = mes or today.month
    ano_actual = ano

    mes_ant = mes_actual - 1 if mes_actual > 1 else 12
    ano_ant = ano_actual if mes_actual > 1 else ano_actual - 1

    key = f"rank:{ano_actual}:{mes_actual}:{group_by}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    dim_col, dim_src = _DIM_MAP[group_by]

    joins_parts = []
    if dim_src in ("grupo", "grupo_com"):
        joins_parts.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
    if dim_src == "grupo_com":
        joins_parts.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")

    joins_str = " ".join(joins_parts)

    try:
        df_cur = _query_mes(cfg, dim_col, joins_str, ano_actual, mes_actual, top_n * 2)
        df_ant = _query_mes(cfg, dim_col, joins_str, ano_ant, mes_ant, top_n * 2)
        df_cur.columns = [c.lower() for c in df_cur.columns]
        df_ant.columns = [c.lower() for c in df_ant.columns]
    except Exception as exc:
        logger.error("Ranking error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df_cur["rank_actual"]   = range(1, len(df_cur) + 1)
    df_ant["rank_anterior"] = range(1, len(df_ant) + 1)
    df_ant = df_ant.rename(columns={"ventas_netas": "ventas_ant"})

    df = df_cur.head(top_n).merge(df_ant[["dimension", "rank_anterior", "ventas_ant"]], on="dimension", how="left")
    df["rank_anterior"] = pd.to_numeric(df["rank_anterior"], errors="coerce")
    df["ventas_ant"]    = pd.to_numeric(df["ventas_ant"],    errors="coerce").fillna(0)
    df["rank_delta"]    = df.apply(
        lambda r: int(r["rank_anterior"] - r["rank_actual"]) if pd.notna(r["rank_anterior"]) else None, axis=1
    )
    df["variacion_pct"] = df.apply(
        lambda r: round((r["ventas_netas"] / r["ventas_ant"] - 1) * 100, 2) if r["ventas_ant"] > 0 else None, axis=1
    )

    records = []
    for _, r in df.iterrows():
        records.append({
            "dimension":    str(r["dimension"] or "—"),
            "ventas_netas": round(float(r["ventas_netas"]), 2),
            "ventas_ant":   round(float(r["ventas_ant"]), 2),
            "rank_actual":  int(r["rank_actual"]),
            "rank_anterior": int(r["rank_anterior"]) if pd.notna(r["rank_anterior"]) else None,
            "rank_delta":    r["rank_delta"],
            "variacion_pct": r["variacion_pct"],
        })

    total = len(records)
    page  = records[offset: offset + limit]

    result = {
        "ano": ano_actual, "mes": mes_actual,
        "mes_anterior": mes_ant, "ano_anterior": ano_ant,
        "group_by": group_by,
        "total": total, "limit": limit, "offset": offset,
        "data": page,
    }
    cache.set(key, result)
    return result
