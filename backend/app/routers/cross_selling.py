"""
GET /api/cross-selling              — reglas de asociación globales (top lift) por cliente
GET /api/cross-selling/{numero_cliente}   — recomendaciones para un cliente específico
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


def _build_rules(cfg, ano: int, mes: Optional[int], top_n: int, min_soporte: float, mes_fin: Optional[int] = None):
    """Devuelve DataFrame con reglas antecedente→consecuente y métricas lift."""
    where_parts: list = [f"fv.ANO_FISCAL = {ano}"]
    if mes and mes_fin and mes_fin > mes:
        where_parts.append(f"fv.PERIODO_FISCAL BETWEEN {mes} AND {mes_fin}")
    elif mes:
        where_parts.append(f"fv.PERIODO_FISCAL = {mes}")
    where_clause = " AND ".join(where_parts)

    sql = f"""
        SELECT
            fv.NUMERO_CLIENTE || '-' || fv.NUMERO_FACTURA                             AS basket_id,
            fv.CODIGO_PRODUCTO                                                         AS codigo,
            COALESCE(dp.DESCRIPCION, dgc.NOMBRE_GRUPO, dgp.LINEA_NEGOCIO,
                     fv.CODIGO_PRODUCTO)                                              AS descripcion
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO
        LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO
        LEFT JOIN (
            SELECT CODIGO_PRODUCTO, DESCRIPCION
            FROM {cfg.TM('DIM_PARTE')}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CODIGO_PRODUCTO ORDER BY CODIGO_PRODUCTO) = 1
        ) dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO
        WHERE {where_clause}
    """
    df = connector.query(sql)
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
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(50, ge=5, le=200),
    min_soporte: float = Query(0.02, ge=0.005, le=0.5),
):
    cfg = get_settings()
    key = f"cs_rules:{ano}:{mes}:{mes_fin}:{top_n}:{min_soporte}"
    if (hit := cache.get(key)):
        return hit
    try:
        df = _build_rules(cfg, ano, mes, top_n, min_soporte, mes_fin)
    except Exception as exc:
        logger.error("Cross-selling rules error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    result = {"ano": ano, "mes": mes, "mes_fin": mes_fin, "data": df.to_dict("records") if not df.empty else []}
    cache.set(key, result)
    return result


@router.get("/{numero_cliente}")
def get_recs_for_cliente(
    numero_cliente: str,
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    top_n: int = Query(10, ge=1, le=50),
    min_soporte: float = Query(0.02, ge=0.005, le=0.5),
):
    """Recomienda productos no comprados por el cliente basados en lift."""
    cfg = get_settings()
    key = f"cs_cliente:{numero_cliente}:{ano}:{mes}:{mes_fin}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    # Products the client HAS bought
    try:
        cli_num = int(numero_cliente)
        cli_filter = f"fv.NUMERO_CLIENTE = {cli_num}"
    except ValueError:
        cli_filter = f"UPPER(dc.NOMBRE_CLIENTE) LIKE '%%{numero_cliente.upper()}%%'"

    where_parts: list = [f"fv.ANO_FISCAL = {ano}", cli_filter]
    if mes and mes_fin and mes_fin > mes:
        where_parts.append(f"fv.PERIODO_FISCAL BETWEEN {mes} AND {mes_fin}")
    elif mes:
        where_parts.append(f"fv.PERIODO_FISCAL = {mes}")
    where_clause = " AND ".join(where_parts)

    sql_owns = f"""
        SELECT DISTINCT fv.CODIGO_PRODUCTO, fv.NUMERO_CLIENTE,
               dc.NOMBRE_CLIENTE
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
        WHERE {where_clause}
    """
    try:
        df_owns = connector.query(sql_owns)
        df_owns.columns = [c.lower() for c in df_owns.columns]
        owned = set(df_owns["codigo_producto"].astype(str).tolist())
        nombre_cliente = df_owns["nombre_cliente"].iloc[0] if not df_owns.empty and "nombre_cliente" in df_owns.columns else numero_cliente
        num_cliente = str(df_owns["numero_cliente"].iloc[0]) if not df_owns.empty else numero_cliente
        # Use lower soporte to find more matches for specific clients
        rules_df = _build_rules(cfg, ano, mes, 2000, min(min_soporte, 0.005), mes_fin)
    except Exception as exc:
        logger.error("Cross-selling cliente error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if rules_df.empty or not owned:
        return {"cliente": numero_cliente, "nombre_cliente": numero_cliente, "recomendaciones": [], "productos_actuales": 0}

    # Find rules where antecedent is owned and consequent is NOT owned
    recs = (
        rules_df[
            rules_df["antecedente"].isin(owned) & ~rules_df["consecuente"].isin(owned)
        ]
        .drop_duplicates("consecuente")
        .head(top_n)
    )

    result = {
        "cliente": num_cliente,
        "nombre_cliente": str(nombre_cliente) if nombre_cliente else numero_cliente,
        "productos_actuales": len(owned),
        "recomendaciones": recs.to_dict("records"),
    }
    cache.set(key, result)
    return result
