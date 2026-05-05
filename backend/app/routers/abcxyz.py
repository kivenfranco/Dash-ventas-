"""
GET /api/abcxyz — Clasificación ABC/XYZ de productos.
ABC: % acumulado de ventas — A ≤80 %, B ≤95 %, C resto
XYZ: coeficiente de variación mensual — X <0.5, Y <1.0, Z ≥1.0
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/abcxyz", tags=["ABCXYZ"])
logger = logging.getLogger(__name__)


@router.get("")
def get_abcxyz(
    ano: int = Query(default_factory=lambda: date.today().year),
    excl_pvta: bool = Query(True),
    top_n: int = Query(500, ge=10, le=2000),
):
    cfg = get_settings()
    key = f"abcxyz:{ano}:{excl_pvta}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    conds: list = ["fv.ANO_FISCAL = %s"]
    params: list = [ano]
    if excl_pvta:
        conds.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    sql_monthly = f"""
        SELECT
            fv.CODIGO_PRODUCTO,
            fv.PERIODO_FISCAL                          AS mes,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)          AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {' AND '.join(conds)}
        GROUP BY fv.CODIGO_PRODUCTO, fv.PERIODO_FISCAL
    """
    sql_desc = f"""
        SELECT CODIGO_PRODUCTO, MAX(DESCRIPCION) AS descripcion
        FROM {cfg.TM('DIM_PARTE')}
        GROUP BY CODIGO_PRODUCTO
    """
    try:
        df_m = connector.query(sql_monthly, params)
        df_d = connector.query(sql_desc)
        df_m.columns = [c.lower() for c in df_m.columns]
        df_d.columns = [c.lower() for c in df_d.columns]
    except Exception as exc:
        logger.error("ABC/XYZ error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df_m["ventas_netas"] = pd.to_numeric(df_m["ventas_netas"], errors="coerce").fillna(0)

    # Total per product → ABC
    df_tot = (
        df_m.groupby("codigo_producto")["ventas_netas"]
        .sum()
        .reset_index()
        .sort_values("ventas_netas", ascending=False)
        .head(top_n)
    )
    total_ventas = df_tot["ventas_netas"].sum()
    df_tot["cum_pct"] = df_tot["ventas_netas"].cumsum() / total_ventas * 100 if total_ventas else 0
    df_tot["abc"] = "C"
    df_tot.loc[df_tot["cum_pct"].shift(fill_value=0) < 80, "abc"] = "A"
    df_tot.loc[
        (df_tot["cum_pct"].shift(fill_value=0) >= 80) & (df_tot["cum_pct"].shift(fill_value=0) < 95),
        "abc",
    ] = "B"

    # Coefficient of variation → XYZ
    agg = df_m.groupby("codigo_producto")["ventas_netas"].agg(["std", "mean"])
    agg["cv"] = (agg["std"] / agg["mean"].replace(0, float("inf"))).fillna(0)
    agg = agg[["cv"]].reset_index()

    df = df_tot.merge(agg, on="codigo_producto", how="left")
    df["cv"] = pd.to_numeric(df["cv"], errors="coerce").fillna(0)
    df["xyz"] = "Z"
    df.loc[df["cv"] < 0.5,  "xyz"] = "X"
    df.loc[(df["cv"] >= 0.5) & (df["cv"] < 1.0), "xyz"] = "Y"
    df["clase"] = df["abc"] + df["xyz"]
    df = df.merge(df_d, on="codigo_producto", how="left")

    records = [
        {
            "codigo_producto": str(r["codigo_producto"]),
            "descripcion":     str(r.get("descripcion") or r["codigo_producto"]),
            "ventas_netas":    round(float(r["ventas_netas"]), 2),
            "cum_pct":         round(float(r["cum_pct"]), 2),
            "abc":             r["abc"],
            "cv":              round(float(r["cv"]), 3),
            "xyz":             r["xyz"],
            "clase":           r["clase"],
        }
        for _, r in df.iterrows()
    ]

    result = {
        "ano": ano,
        "data": records,
        "resumen": df["clase"].value_counts().to_dict(),
    }
    cache.set(key, result)
    return result
