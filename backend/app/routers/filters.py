"""
GET /api/filters/*  — Valores para poblar los filtros del dashboard.
"""

import logging
from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/filters", tags=["Filters"])
logger = logging.getLogger(__name__)


def _fetch(cache_key: str, sql: str, col: str) -> list:
    hit = cache.get(cache_key)
    if hit:
        return hit
    try:
        df = connector.query(sql)
        vals = df[col].dropna().tolist()
    except Exception as exc:
        logger.error("filter %s failed: %s", cache_key, exc)
        raise HTTPException(status_code=503, detail=str(exc))
    cache.set(cache_key, vals)
    return vals


@router.get("/anos")
def get_anos():
    cfg = get_settings()
    sql = f"SELECT DISTINCT ANO FROM {cfg.TM('DIM_TIEMPO')} WHERE ANO IS NOT NULL ORDER BY ANO DESC"
    return {"anos": _fetch("f:anos", sql, "ANO")}


@router.get("/meses")
def get_meses():
    cfg = get_settings()
    hit = cache.get("f:meses")
    if hit:
        return {"meses": hit}
    try:
        df = connector.query(
            f"SELECT DISTINCT MES_NUM, MES_NOMBRE FROM {cfg.TM('DIM_TIEMPO')} WHERE MES_NUM IS NOT NULL ORDER BY MES_NUM"
        )
        meses = df.to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    cache.set("f:meses", meses)
    return {"meses": meses}


@router.get("/regiones")
def get_regiones():
    cfg = get_settings()
    sql = f"SELECT DISTINCT DESCRIPCION_REGION FROM {cfg.TM('DIM_DOMICILIO')} WHERE DESCRIPCION_REGION IS NOT NULL ORDER BY 1"
    return {"regiones": _fetch("f:regiones", sql, "DESCRIPCION_REGION")}


@router.get("/lineas")
def get_lineas():
    cfg = get_settings()
    sql = f"SELECT DISTINCT LINEA_NEGOCIO FROM {cfg.TM('DIM_GRUPO_PRODUCTO')} WHERE LINEA_NEGOCIO IS NOT NULL ORDER BY 1"
    return {"lineas": _fetch("f:lineas", sql, "LINEA_NEGOCIO")}


@router.get("/vendedores")
def get_vendedores():
    cfg = get_settings()
    hit = cache.get("f:vendedores")
    if hit:
        return {"vendedores": hit}
    try:
        df = connector.query(f"""
            SELECT DISTINCT fv.CODIGO_VENDEDOR,
                   COALESCE(dv.NOMBRE, fv.CODIGO_VENDEDOR) AS NOMBRE
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
            WHERE fv.CODIGO_VENDEDOR IS NOT NULL
            ORDER BY NOMBRE
        """)
        vends = df.to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    cache.set("f:vendedores", vends)
    return {"vendedores": vends}


@router.get("/grupos-comerciales")
def get_grupos():
    cfg = get_settings()
    sql = f"SELECT DISTINCT NOMBRE_GRUPO FROM {cfg.TM('DIM_GRUPO_COMERCIAL')} WHERE NOMBRE_GRUPO IS NOT NULL ORDER BY 1"
    return {"grupos_comerciales": _fetch("f:gc", sql, "NOMBRE_GRUPO")}


@router.get("/plantas")
def get_plantas():
    cfg = get_settings()
    sql = f"SELECT DISTINCT PLANTA FROM {cfg.TM('DIM_GRUPO_PRODUCTO')} WHERE PLANTA IS NOT NULL ORDER BY 1"
    return {"plantas": _fetch("f:plantas", sql, "PLANTA")}


@router.get("/mercados")
def get_mercados():
    cfg = get_settings()
    sql = f"SELECT DISTINCT MERCADO FROM {cfg.TM('DIM_MERCADO')} WHERE MERCADO IS NOT NULL ORDER BY 1"
    return {"mercados": _fetch("f:mercados", sql, "MERCADO")}


@router.get("/clientes")
def get_clientes():
    """Return client list (NUMERO_CLIENTE + NOMBRE) for searchable dropdown."""
    cfg = get_settings()
    hit = cache.get("f:clientes")
    if hit:
        return {"clientes": hit}
    try:
        df = connector.query(f"""
            SELECT dc.NUMERO_CLIENTE, dc.NOMBRE
            FROM {cfg.TM('DIM_CLIENTE')} dc
            WHERE dc.NOMBRE IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY dc.NUMERO_CLIENTE ORDER BY dc.NUMERO_CLIENTE) = 1
            ORDER BY dc.NOMBRE
        """)
        clientes = df.to_dict(orient="records")
    except Exception as exc:
        logger.error("filter clientes failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))
    cache.set("f:clientes", clientes)
    return {"clientes": clientes}
