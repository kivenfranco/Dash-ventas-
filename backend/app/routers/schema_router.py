"""
GET /api/schema — Descubrimiento del modelo de datos.
"""

import logging
from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/schema", tags=["Schema"])
logger = logging.getLogger(__name__)


def _columns(cfg, database: str, schema: str, table: str):
    sql = """
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_CATALOG = %s AND TABLE_SCHEMA = %s AND TABLE_NAME = %s
        ORDER BY ORDINAL_POSITION
    """
    return connector.query(sql, [database.upper(), schema.upper(), table.upper()])


@router.get("")
def get_schema():
    cfg = get_settings()
    key = "schema:all"
    hit = cache.get(key)
    if hit:
        return hit

    ventas_tables   = ["FACT_VENTAS", "DIM_ESTADO_CLIENTE", "PP_REGION_PLANTA_GRUPO",
                       "PP_VENDEDOR_CANTIDAD", "PP_VENDEDOR_VALOR", "DIM_VENDEDOR_PP"]
    maestros_tables = ["DIM_CLIENTE", "DIM_DOMICILIO", "DIM_TERRITORIO", "DIM_REGION",
                       "DIM_TIEMPO", "DIM_VENDEDOR", "DIM_GRUPO_PRODUCTO",
                       "DIM_GRUPO_COMERCIAL", "DIM_PARTE", "DIM_MERCADO"]

    result = {"database": cfg.SNOWFLAKE_DATABASE, "schemas": {}}

    for schema, tables in [(cfg.SNOWFLAKE_SCHEMA, ventas_tables),
                           (cfg.SNOWFLAKE_SCHEMA_MAESTROS, maestros_tables)]:
        result["schemas"][schema] = {}
        for t in tables:
            try:
                df = _columns(cfg, cfg.SNOWFLAKE_DATABASE, schema, t)
                result["schemas"][schema][t] = df.to_dict(orient="records")
            except Exception as exc:
                logger.warning("Could not describe %s.%s: %s", schema, t, exc)
                result["schemas"][schema][t] = []

    cache.set(key, result)
    return result
