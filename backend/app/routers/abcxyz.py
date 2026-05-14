"""
GET /api/abcxyz — Clasificación ABC/XYZ de clientes.
ABC: % acumulado de ventas — A ≤80 %, B ≤95 %, C resto
XYZ: coeficiente de variación mensual de compras — X <0.5, Y <1.0, Z ≥1.0
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

router = APIRouter(prefix="/api/abcxyz", tags=["ABCXYZ"])
logger = logging.getLogger(__name__)


@router.get("")
def get_abcxyz(
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
    key = f"abcxyz_cli:{ano}:{mes}:{mes_fin}:{excl_pvta}:{vendedor}:{top_n}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    mes_max = today.month if (not mes and ano == today.year) else None

    where_parts: list = [f"fv.ANO_FISCAL = {ano}", "fv.NUMERO_CLIENTE IS NOT NULL"]
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

    sql_monthly = f"""
        SELECT
            fv.NUMERO_CLIENTE,
            fv.PERIODO_FISCAL                          AS mes,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)          AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE {where_clause}
        GROUP BY fv.NUMERO_CLIENTE, fv.PERIODO_FISCAL
    """
    try:
        df_m = connector.query(sql_monthly)
        df_m.columns = [c.lower() for c in df_m.columns]
    except Exception as exc:
        logger.error("ABC/XYZ error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df_m.empty:
        return {"ano": ano, "mes": mes, "mes_fin": mes_fin, "data": [], "resumen": {}}

    df_m["ventas_netas"] = pd.to_numeric(df_m["ventas_netas"], errors="coerce").fillna(0)

    # Total per client → ABC
    df_tot = (
        df_m.groupby("numero_cliente")["ventas_netas"]
        .sum()
        .reset_index()
        .sort_values("ventas_netas", ascending=False)
        .head(top_n)
    )
    total_ventas = df_tot["ventas_netas"].sum()
    df_tot["cum_pct"] = (df_tot["ventas_netas"].cumsum() / total_ventas * 100) if total_ventas else 0
    df_tot["abc"] = "C"
    df_tot.loc[df_tot["cum_pct"].shift(fill_value=0) < 80, "abc"] = "A"
    df_tot.loc[
        (df_tot["cum_pct"].shift(fill_value=0) >= 80) & (df_tot["cum_pct"].shift(fill_value=0) < 95),
        "abc",
    ] = "B"

    # Coefficient of variation (regularidad de compra) → XYZ
    # Requires ≥2 months of data to be meaningful
    n_meses = df_m["mes"].nunique()
    if n_meses >= 2:
        agg = df_m.groupby("numero_cliente")["ventas_netas"].agg(["std", "mean"])
        agg["cv"] = (agg["std"] / agg["mean"].replace(0, float("inf"))).fillna(0)
        agg = agg[["cv"]].reset_index()
    else:
        # Single month: XYZ not computable — mark all as null
        agg = df_tot[["numero_cliente"]].copy()
        agg["cv"] = None

    df = df_tot.merge(agg, on="numero_cliente", how="left")

    # Fetch names only for clients in top_n (not full table scan)
    top_ids = df["numero_cliente"].tolist()
    id_list = ",".join([f"'{x}'" for x in top_ids[:2000]])
    sql_names = f"""
        SELECT NUMERO_CLIENTE, MAX(NOMBRE) AS nombre
        FROM {cfg.TM('DIM_CLIENTE')}
        WHERE NUMERO_CLIENTE IN ({id_list})
        GROUP BY NUMERO_CLIENTE
    """
    try:
        df_n = connector.query(sql_names)
        df_n.columns = [c.lower() for c in df_n.columns]
    except Exception:
        df_n = pd.DataFrame(columns=["numero_cliente", "nombre"])

    xyz_valid = n_meses >= 2
    if xyz_valid:
        df["cv"] = pd.to_numeric(df["cv"], errors="coerce").fillna(0)
        df["xyz"] = "Z"
        df.loc[df["cv"] < 0.5,  "xyz"] = "X"
        df.loc[(df["cv"] >= 0.5) & (df["cv"] < 1.0), "xyz"] = "Y"
        df["clase"] = df["abc"] + df["xyz"]
    else:
        df["cv"] = None
        df["xyz"] = "-"
        df["clase"] = df["abc"]

    df = df.merge(df_n, on="numero_cliente", how="left")

    records = [
        {
            "numero_cliente": str(r["numero_cliente"]),
            "nombre_cliente": str(r.get("nombre") or r["numero_cliente"]),
            "ventas_netas":   round(float(r["ventas_netas"]), 2),
            "cum_pct":        round(float(r["cum_pct"]), 2),
            "abc":            r["abc"],
            "cv":             round(float(r["cv"]), 3) if r["cv"] is not None and pd.notna(r["cv"]) else None,
            "xyz":            r["xyz"],
            "clase":          r["clase"],
        }
        for _, r in df.iterrows()
    ]

    result = {
        "ano": ano, "mes": mes, "mes_fin": mes_fin,
        "xyz_valido": xyz_valid,
        "n_meses": int(n_meses),
        "data": records,
        "resumen": df["clase"].value_counts().to_dict(),
    }
    cache.set(key, result)
    return result
