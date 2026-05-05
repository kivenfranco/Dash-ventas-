"""
GET /api/search?q=texto&tipo=all|vendedores|productos|estructuras
Búsqueda global rápida sobre catálogos maestros.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/search", tags=["Search"])
logger = logging.getLogger(__name__)

_VALID_TIPO = {"all", "vendedores", "productos", "estructuras"}


@router.get("")
def search(
    q: str = Query(..., min_length=2, max_length=100),
    tipo: str = Query("all"),
    limit: int = Query(20, ge=1, le=100),
):
    if tipo not in _VALID_TIPO:
        tipo = "all"

    cfg  = get_settings()
    term = q.strip().upper()
    results: list = []

    try:
        if tipo in ("all", "vendedores"):
            sql = f"""
                SELECT DISTINCT
                    dv.CODIGO_VENDEDOR AS id,
                    dv.NOMBRE          AS label,
                    'vendedor'         AS tipo
                FROM {cfg.TM('DIM_VENDEDOR')} dv
                WHERE UPPER(dv.NOMBRE) LIKE %s
                   OR UPPER(dv.CODIGO_VENDEDOR) LIKE %s
                LIMIT {limit}
            """
            df = connector.query(sql, [f"%{term}%", f"%{term}%"])
            df.columns = [c.lower() for c in df.columns]
            results += df.to_dict("records")

        if tipo in ("all", "productos"):
            sql = f"""
                SELECT DISTINCT
                    dp.CODIGO_PRODUCTO  AS id,
                    dp.DESCRIPCION      AS label,
                    'producto'          AS tipo
                FROM {cfg.TM('DIM_PARTE')} dp
                WHERE UPPER(dp.DESCRIPCION) LIKE %s
                   OR UPPER(dp.CODIGO_PRODUCTO) LIKE %s
                LIMIT {limit}
            """
            df = connector.query(sql, [f"%{term}%", f"%{term}%"])
            df.columns = [c.lower() for c in df.columns]
            results += df.to_dict("records")

        if tipo in ("all", "estructuras"):
            sql = f"""
                SELECT DISTINCT
                    dp.ESTRUCTURA AS id,
                    dp.ESTRUCTURA AS label,
                    'estructura'  AS tipo
                FROM {cfg.TM('DIM_PARTE')} dp
                WHERE UPPER(dp.ESTRUCTURA) LIKE %s
                  AND dp.ESTRUCTURA IS NOT NULL
                LIMIT {limit}
            """
            df = connector.query(sql, [f"%{term}%"])
            df.columns = [c.lower() for c in df.columns]
            results += df.to_dict("records")

    except Exception as exc:
        logger.error("Search error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # Deduplicate and cap
    seen: set = set()
    deduped = []
    for r in results:
        key = (r.get("tipo"), str(r.get("id", "")))
        if key not in seen:
            seen.add(key)
            deduped.append(r)
        if len(deduped) >= limit:
            break

    return {"q": q, "tipo": tipo, "total": len(deduped), "results": deduped}
