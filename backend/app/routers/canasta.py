"""
GET /api/canasta — Análisis de canasta: productos comprados juntos (co-ocurrencia).
Para cada par de productos, calcula soporte, confianza y lift.
La canasta es (CODIGO_VENDEDOR, ANO_FISCAL, PERIODO_FISCAL).
"""
import logging
from collections import Counter, defaultdict
from datetime import date
from itertools import combinations
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/canasta", tags=["Canasta"])
logger = logging.getLogger(__name__)


@router.get("")
def get_canasta(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(30, ge=5, le=100),
    min_soporte: float = Query(0.02, ge=0.005, le=0.5),
    excl_pvta: bool = Query(True),
):
    cfg = get_settings()
    today = date.today()
    mes_actual = mes or today.month

    key = f"canasta:{ano}:{mes_actual}:{top_n}:{min_soporte}:{excl_pvta}"
    if (hit := cache.get(key)):
        return hit

    pvta_cond = ""
    if excl_pvta:
        pvta_cond = "AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)"

    dp_sub = (
        f"(SELECT CODIGO_PRODUCTO, DESCRIPCION FROM {cfg.TM('DIM_PARTE')} "
        f"QUALIFY ROW_NUMBER() OVER (PARTITION BY CODIGO_PRODUCTO "
        f"ORDER BY DESCRIPCION NULLS LAST, CODIGO_PRODUCTO) = 1)"
    )

    sql = f"""
        SELECT
            CONCAT(COALESCE(fv.CODIGO_VENDEDOR, 'ANONIMO'), '|',
                   fv.ANO_FISCAL, '|', fv.PERIODO_FISCAL)     AS basket_id,
            fv.CODIGO_PRODUCTO                                  AS codigo,
            COALESCE(dp.DESCRIPCION, fv.CODIGO_PRODUCTO)        AS descripcion
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {dp_sub} dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO
        WHERE fv.ANO_FISCAL = {ano}
          AND fv.PERIODO_FISCAL <= {mes_actual}
          {pvta_cond}
        GROUP BY 1, 2, 3
        HAVING SUM(fv.VENTAS_NETAS) > 0
    """

    try:
        df = connector.query(sql, [])
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Canasta error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        result = {"ano": ano, "mes": mes_actual, "n_canastas": 0, "n_productos": 0, "data": []}
        cache.set(key, result)
        return result

    # Build baskets: basket_id → dict {codigo: descripcion} (deduplicates same product)
    raw: dict = defaultdict(dict)
    for _, row in df.iterrows():
        raw[str(row["basket_id"])][str(row["codigo"])] = str(row["descripcion"])

    # Keep only baskets with 2+ distinct products
    baskets = {bid: list(prods.items()) for bid, prods in raw.items() if len(prods) >= 2}
    n_baskets = len(baskets)

    if n_baskets < 5:
        result = {"ano": ano, "mes": mes_actual, "n_canastas": n_baskets, "n_productos": 0, "data": []}
        cache.set(key, result)
        return result

    item_count: Counter = Counter()
    pair_count: Counter = Counter()
    item_names: dict = {}

    for items in baskets.values():
        codes = [c for c, _ in items]
        for c, d in items:
            item_names[c] = d
        for c in codes:
            item_count[c] += 1
        for a, b in combinations(sorted(codes), 2):
            pair_count[(a, b)] += 1

    records = []
    for (a, b), co in pair_count.items():
        soporte = co / n_baskets
        if soporte < min_soporte:
            continue
        sup_a = item_count[a] / n_baskets
        sup_b = item_count[b] / n_baskets
        lift = soporte / (sup_a * sup_b) if sup_a > 0 and sup_b > 0 else 0.0

        records.append({
            "producto_a":       item_names.get(a, a),
            "codigo_a":         a,
            "producto_b":       item_names.get(b, b),
            "codigo_b":         b,
            "co_ocurrencias":   int(co),
            "soporte_pct":      round(soporte * 100, 2),
            "confianza_ab_pct": round(co / item_count[a] * 100, 2),
            "confianza_ba_pct": round(co / item_count[b] * 100, 2),
            "lift":             round(lift, 3),
        })

    records.sort(key=lambda x: -x["lift"])

    result = {
        "ano":        ano,
        "mes":        mes_actual,
        "n_canastas": n_baskets,
        "n_productos": len(item_count),
        "data":       records[:top_n],
    }
    cache.set(key, result)
    return result
