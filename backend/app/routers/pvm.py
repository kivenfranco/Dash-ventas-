"""
GET /api/pvm — Descomposición Precio-Volumen-Mix (PVM).

Compara el período actual (ano, mes) vs el mismo período del año anterior.
Para cada valor de la dimensión seleccionada calcula:
  - efecto_precio  = (precio_cur - precio_prev) * cantidad_prev
  - efecto_volumen = precio_prev * (cantidad_cur - cantidad_prev)
  - efecto_mix     = delta_total - efecto_precio - efecto_volumen  (residual: entrada/salida de grupos)
  - delta_total    = ventas_cur - ventas_prev
"""

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/pvm", tags=["PVM"])
logger = logging.getLogger(__name__)

_GROUP_BY_OPTIONS = {
    "linea_negocio":     ("dgp", "LINEA_NEGOCIO"),
    "grupo_comercial":   ("dgc", "NOMBRE_GRUPO"),
    "region":            ("dd",  "DESCRIPCION_REGION"),
    "tipo_fabricacion":  ("dgc", "TIPO_FABRICACION"),
}

# Joins required by each group_by dimension
_GROUP_BY_JOINS = {
    "linea_negocio":    ["grupo_producto"],
    "grupo_comercial":  ["grupo_producto", "grupo_comercial"],
    "region":           ["domicilio"],
    "tipo_fabricacion": ["grupo_producto", "grupo_comercial"],
}


def _parse_csv(value: Optional[str]) -> list:
    if not value:
        return []
    return [v.strip() for v in value.split(',') if v.strip()]


def _multi_cond(col: str, value: Optional[str]) -> tuple[Optional[str], list]:
    items = _parse_csv(value)
    if not items:
        return None, []
    if len(items) == 1:
        return f"{col} = %s", [items[0]]
    ph = ', '.join(['%s'] * len(items))
    return f"{col} IN ({ph})", items


def _build_period_query(
    cfg,
    ano: int,
    mes: Optional[int],
    mes_fin: Optional[int],
    region: Optional[str],
    vendedor: Optional[str],
    grupo_comercial: Optional[str],
    planta: Optional[str],
    group_by: str,
) -> tuple[str, list]:
    """
    Build a parameterized SELECT for a single fiscal period.
    Returns (sql, params).
    """
    alias, col = _GROUP_BY_OPTIONS[group_by]
    required_joins = _GROUP_BY_JOINS[group_by]

    # Determine which joins are needed: start from group_by requirement,
    # then add filter-driven joins.
    need_domicilio    = "domicilio"    in required_joins or bool(region)
    need_grp_producto = "grupo_producto" in required_joins or bool(grupo_comercial) or bool(planta)
    need_grp_comercial = "grupo_comercial" in required_joins or bool(grupo_comercial)

    joins = []
    if need_domicilio:
        joins.append(
            f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd"
            f" ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
        )
    if need_grp_producto:
        joins.append(
            f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp"
            f" ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"
        )
    if need_grp_comercial:
        joins.append(
            f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc"
            f" ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO"
        )

    cond: list[str] = []
    params: list = []

    cond.append("fv.ANO_FISCAL = %s")
    params.append(ano)

    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s")
        params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s")
        params.append(mes)

    # PVTA exclusion — always applied
    cond.append(
        "(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)"
    )

    # Optional filters
    if region:
        c, p = _multi_cond("dd.DESCRIPCION_REGION", region)
        if c:
            cond.append(c)
            params.extend(p)

    if vendedor:
        c, p = _multi_cond("fv.CODIGO_VENDEDOR", vendedor)
        if c:
            cond.append(c)
            params.extend(p)

    if grupo_comercial:
        c, p = _multi_cond("dgc.NOMBRE_GRUPO", grupo_comercial)
        if c:
            cond.append(c)
            params.extend(p)

    if planta:
        c, p = _multi_cond("dgp.LINEA_NEGOCIO", planta)
        if c:
            cond.append(c)
            params.extend(p)

    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(cond)

    sql = f"""
        SELECT
            COALESCE({alias}.{col}, '(Sin clasificar)') AS dimension,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)           AS ventas,
            COALESCE(SUM(fv.CANTIDAD), 0)               AS cantidad
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        GROUP BY COALESCE({alias}.{col}, '(Sin clasificar)')
    """
    return sql, params


def _safe_div(a, b):
    try:
        return float(a) / float(b) if b and float(b) != 0 else float(a)
    except Exception:
        return 0.0


@router.get("")
def get_pvm(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    group_by: str = Query("linea_negocio", pattern="^(linea_negocio|grupo_comercial|region|tipo_fabricacion)$"),
):
    if group_by not in _GROUP_BY_OPTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"group_by debe ser uno de: {list(_GROUP_BY_OPTIONS)}",
        )

    cfg = get_settings()
    ano_prev = ano - 1

    # Normalize mes_fin
    _mes_fin = mes_fin if (mes_fin and mes and mes_fin > mes) else None

    cache_key = (
        f"pvm:{ano}:{mes}:{_mes_fin}:{region}:{vendedor}:"
        f"{grupo_comercial}:{planta}:{group_by}"
    )
    if (hit := cache.get(cache_key)):
        return hit

    try:
        sql_cur, params_cur = _build_period_query(
            cfg, ano, mes, _mes_fin, region, vendedor, grupo_comercial, planta, group_by
        )
        sql_prev, params_prev = _build_period_query(
            cfg, ano_prev, mes, _mes_fin, region, vendedor, grupo_comercial, planta, group_by
        )

        df_cur  = connector.query(sql_cur,  params_cur)
        df_prev = connector.query(sql_prev, params_prev)
    except Exception as exc:
        logger.error("PVM query error: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))

    # Normalize column names to lowercase
    df_cur.columns  = [c.lower() for c in df_cur.columns]
    df_prev.columns = [c.lower() for c in df_prev.columns]

    # Build lookup dicts keyed by dimension value
    cur_map: dict = {}
    for _, row in df_cur.iterrows():
        dim = str(row.get("dimension") or "(Sin clasificar)")
        cur_map[dim] = {
            "ventas":   float(row.get("ventas")   or 0),
            "cantidad": float(row.get("cantidad") or 0),
        }

    prev_map: dict = {}
    for _, row in df_prev.iterrows():
        dim = str(row.get("dimension") or "(Sin clasificar)")
        prev_map[dim] = {
            "ventas":   float(row.get("ventas")   or 0),
            "cantidad": float(row.get("cantidad") or 0),
        }

    all_dims = sorted(set(cur_map) | set(prev_map))

    data = []
    total_cur  = 0.0
    total_prev = 0.0
    efecto_precio_total   = 0.0
    efecto_volumen_total  = 0.0
    efecto_mix_total      = 0.0

    for dim in all_dims:
        c = cur_map.get(dim,  {"ventas": 0.0, "cantidad": 0.0})
        p = prev_map.get(dim, {"ventas": 0.0, "cantidad": 0.0})

        ventas_cur   = c["ventas"]
        ventas_prev  = p["ventas"]
        cantidad_cur  = c["cantidad"]
        cantidad_prev = p["cantidad"]

        precio_cur  = _safe_div(ventas_cur,  cantidad_cur)
        precio_prev = _safe_div(ventas_prev, cantidad_prev)

        efecto_precio  = (precio_cur - precio_prev) * cantidad_prev
        efecto_volumen = precio_prev * (cantidad_cur - cantidad_prev)
        delta_total    = ventas_cur - ventas_prev
        efecto_mix     = delta_total - efecto_precio - efecto_volumen

        delta_pct = (
            round((delta_total / abs(ventas_prev)) * 100, 2)
            if ventas_prev != 0 else None
        )

        total_cur  += ventas_cur
        total_prev += ventas_prev
        efecto_precio_total  += efecto_precio
        efecto_volumen_total += efecto_volumen
        efecto_mix_total     += efecto_mix

        data.append({
            "dimension":      dim,
            "ventas_cur":     round(ventas_cur,   2),
            "ventas_prev":    round(ventas_prev,  2),
            "cantidad_cur":   round(cantidad_cur,  2),
            "cantidad_prev":  round(cantidad_prev, 2),
            "precio_cur":     round(precio_cur,   4),
            "precio_prev":    round(precio_prev,  4),
            "efecto_precio":  round(efecto_precio,  2),
            "efecto_volumen": round(efecto_volumen, 2),
            "efecto_mix":     round(efecto_mix,     2),
            "delta_total":    round(delta_total,    2),
            "delta_pct":      delta_pct,
        })

    # Sort by absolute delta descending for relevance
    data.sort(key=lambda x: abs(x["delta_total"]), reverse=True)

    result = {
        "ano":               ano,
        "ano_prev":          ano_prev,
        "mes":               mes,
        "mes_fin":           _mes_fin,
        "group_by":          group_by,
        "total_cur":         round(total_cur,  2),
        "total_prev":        round(total_prev, 2),
        "total_delta":       round(total_cur - total_prev, 2),
        "efecto_precio_total":  round(efecto_precio_total,  2),
        "efecto_volumen_total": round(efecto_volumen_total, 2),
        "efecto_mix_total":     round(efecto_mix_total,     2),
        "data":              data,
    }

    cache.set(cache_key, result)
    return result
