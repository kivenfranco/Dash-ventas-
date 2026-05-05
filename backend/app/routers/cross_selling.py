"""
GET /api/cross-selling              — reglas de asociación globales (top lift)
GET /api/cross-selling/{vendedor}   — recomendaciones para un CODIGO_VENDEDOR específico
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/cross-selling", tags=["CrossSelling"])
logger = logging.getLogger(__name__)


def _build_rules(cfg, ano: int, mes: Optional[int], top_n: int, min_soporte: float):
    """Devuelve DataFrame con reglas antecedente→consecuente y métricas lift."""
    conds: list = ["fv.ANO_FISCAL = %s"]
    params: list = [ano]
    if mes:
        conds.append("fv.PERIODO_FISCAL = %s"); params.append(mes)

    sql = f"""
        SELECT
            fv.NUMERO_DOCUMENTO                                      AS basket_id,
            fv.CODIGO_PRODUCTO                                       AS codigo,
            dp.DESCRIPCION                                           AS descripcion
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN (
            SELECT CODIGO_PRODUCTO, MAX(DESCRIPCION) AS DESCRIPCION
            FROM {cfg.TM('DIM_PARTE')}
            GROUP BY CODIGO_PRODUCTO
        ) dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO
        WHERE {' AND '.join(conds)} AND fv.NUMERO_DOCUMENTO IS NOT NULL
    """
    df = connector.query(sql, params)
    df.columns = [c.lower() for c in df.columns]

    from collections import defaultdict
    raw: dict = defaultdict(dict)
    for _, row in df.iterrows():
        raw[str(row["basket_id"])][str(row["codigo"])] = str(row["descripcion"] or row["codigo"])

    baskets = {bid: list(prods.items()) for bid, prods in raw.items() if len(prods) >= 2}
    n = len(baskets)
    if n == 0:
        return pd.DataFrame()

    # Item frequency
    item_freq: dict = defaultdict(int)
    pair_freq: dict = defaultdict(int)
    for items in baskets.values():
        codes = [c for c, _ in items]
        for c in codes:
            item_freq[c] += 1
        for i in range(len(codes)):
            for j in range(len(codes)):
                if i != j:
                    pair_freq[(codes[i], codes[j])] += 1

    desc_map = {str(row["codigo"]): str(row["descripcion"] or row["codigo"]) for _, row in df.iterrows()}

    rules = []
    for (a, b), co in pair_freq.items():
        soporte = co / n
        if soporte < min_soporte:
            continue
        conf_ab  = co / item_freq[a] if item_freq[a] else 0
        conf_ba  = co / item_freq[b] if item_freq[b] else 0
        lift     = (conf_ab / (item_freq[b] / n)) if item_freq[b] else 0
        rules.append({
            "antecedente":      a,
            "desc_ante":        desc_map.get(a, a),
            "consecuente":      b,
            "desc_cons":        desc_map.get(b, b),
            "soporte":          round(soporte, 4),
            "confianza":        round(conf_ab, 4),
            "confianza_inv":    round(conf_ba, 4),
            "lift":             round(lift, 3),
        })

    rules_df = pd.DataFrame(rules).sort_values("lift", ascending=False).head(top_n)
    return rules_df


@router.get("")
def get_rules(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(50, ge=5, le=200),
    min_soporte: float = Query(0.02, ge=0.005, le=0.5),
):
    cfg = get_settings()
    key = f"cs_rules:{ano}:{mes}:{top_n}:{min_soporte}"
    if (hit := cache.get(key)):
        return hit
    try:
        df = _build_rules(cfg, ano, mes, top_n, min_soporte)
    except Exception as exc:
        logger.error("Cross-selling rules error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    result = {"ano": ano, "mes": mes, "data": df.to_dict("records") if not df.empty else []}
    cache.set(key, result)
    return result


@router.get("/{codigo_vendedor}")
def get_recs_for_vendedor(
    codigo_vendedor: str,
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(10, ge=1, le=50),
    min_soporte: float = Query(0.02, ge=0.005, le=0.5),
):
    """Recomienda productos no comprados por el vendedor basados en lift."""
    cfg = get_settings()
    key = f"cs_vend:{codigo_vendedor}:{ano}:{mes}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    # Products the vendor HAS bought
    conds: list = ["fv.ANO_FISCAL = %s", "fv.CODIGO_VENDEDOR = %s"]
    params: list = [ano, codigo_vendedor]
    if mes:
        conds.append("fv.PERIODO_FISCAL = %s"); params.append(mes)

    sql_owns = f"""
        SELECT DISTINCT fv.CODIGO_PRODUCTO
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {' AND '.join(conds)}
    """
    try:
        df_owns = connector.query(sql_owns, params)
        df_owns.columns = [c.lower() for c in df_owns.columns]
        owned = set(df_owns["codigo_producto"].astype(str).tolist())
        rules_df = _build_rules(cfg, ano, mes, 500, min_soporte)
    except Exception as exc:
        logger.error("Cross-selling vendor error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if rules_df.empty or not owned:
        return {"vendedor": codigo_vendedor, "recomendaciones": []}

    # Find rules where antecedent is owned and consequent is NOT owned
    recs = (
        rules_df[
            rules_df["antecedente"].isin(owned) & ~rules_df["consecuente"].isin(owned)
        ]
        .drop_duplicates("consecuente")
        .head(top_n)
    )

    result = {
        "vendedor": codigo_vendedor,
        "productos_actuales": len(owned),
        "recomendaciones": recs.to_dict("records"),
    }
    cache.set(key, result)
    return result
