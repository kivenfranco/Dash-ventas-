"""
/api/comercializacion — Ventas de la línea Comercialización estandarizadas en metros.
Usa FACT_VENTAS.CANTIDAD + DIM_PARTE.UNIDAD_MEDIDA para convertir a metros.
"""
import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector
from .factores_com import load_factores

router = APIRouter(prefix="/api/comercializacion", tags=["Comercializacion"])
logger = logging.getLogger(__name__)

LINEA = "COMERCIALIZACION"

_FACTOR: dict[str, float] = {
    "M":     1.0,
    "TBX33": 33.0,
    "TBX25": 25.0,
    "TBX27": 27.0,
    "PIE":   0.3048,
}

def _to_factor(uom) -> Optional[float]:
    if not uom or pd.isna(uom):
        return None
    u = str(uom).strip().upper()
    if u in _FACTOR:
        return _FACTOR[u]
    if u.startswith("TBX"):
        try:
            return float(u[3:])
        except ValueError:
            pass
    return None

def _safe_float(v) -> Optional[float]:
    """Pandas scalar → Python float, None for NaN/None."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    f = float(v)
    return None if (f != f) else f  # NaN check

def _ppm(ventas, metros) -> Optional[float]:
    if metros and metros > 0 and not (metros != metros):  # metros != metros → NaN
        return round(ventas / metros, 2)
    return None

def _n(v) -> Optional[float]:
    """Numpy/pandas scalar → Python float, None for NaN/None."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    f = float(v)
    return None if f != f else f  # f != f is True only for NaN

def _sanitize(obj):
    """Recursively replace NaN floats with None for JSON safety."""
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj




def _build_sql(cfg, anos: list[int], mes=None, mes_fin=None, mes_max=None, excl_mes_actual=False):
    if len(anos) == 1:
        ano_cond = "fv.ANO_FISCAL = %s"
        params: list = [anos[0], LINEA]
    else:
        placeholders = ", ".join(["%s"] * len(anos))
        ano_cond = f"fv.ANO_FISCAL IN ({placeholders})"
        params = list(anos) + [LINEA]

    cond = [ano_cond, "dgp.LINEA_NEGOCIO = %s"]

    if mes and mes_fin and mes_fin > mes:
        cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s")
        params.extend([mes, mes_fin])
    elif mes:
        cond.append("fv.PERIODO_FISCAL = %s")
        params.append(mes)
    elif mes_max:
        cond.append("fv.PERIODO_FISCAL <= %s")
        params.append(mes_max)

    if excl_mes_actual:
        today = date.today()
        cond.append("NOT (fv.ANO_FISCAL = %s AND fv.PERIODO_FISCAL = %s)")
        params.extend([today.year, today.month])

    where = "WHERE " + " AND ".join(cond)
    sql = f"""
        SELECT
            fv.ANO_FISCAL                                   AS ano,
            fv.PERIODO_FISCAL                               AS mes,
            fv.CODIGO_PRODUCTO                              AS codigo_producto,
            fv.CODIGO_PRODUCTO                              AS producto,
            COALESCE(fv.UNIDAD_MEDIDA_VENTA, 'SIN_UOM')    AS uom,
            COALESCE(SUM(fv.CANTIDAD),     0)               AS cantidad,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)               AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO
        {where}
        GROUP BY 1, 2, 3, 4, 5
        ORDER BY 1, 2, ventas_netas DESC
    """
    return sql, params


def _apply_conversion(df: pd.DataFrame, custom_factors: dict | None = None) -> pd.DataFrame:
    df = df.copy()
    custom_factors = custom_factors or {}

    def _get_factor(row):
        f = _to_factor(row["uom"])
        if f is not None:
            return f
        entry = custom_factors.get(str(row.get("codigo_producto", "")))
        return float(entry["factor"]) if entry else None

    df["factor"] = df.apply(_get_factor, axis=1)
    df["metros"] = df.apply(
        lambda r: float(r["cantidad"]) * r["factor"] if pd.notna(r["factor"]) else None,
        axis=1,
    )
    return df


def _to_monthly(df: pd.DataFrame) -> list[dict]:
    monthly: dict[tuple, dict] = {}
    for _, r in df.iterrows():
        k = (int(r["ano"]), int(r["mes"]))
        if k not in monthly:
            monthly[k] = {"ano": k[0], "mes": k[1], "ventas_netas": 0.0, "metros": 0.0}
        monthly[k]["ventas_netas"] += _n(r["ventas_netas"]) or 0.0
        mt = _n(r["metros"])
        if mt is not None:
            monthly[k]["metros"] += mt

    result = []
    for (a, m), v in sorted(monthly.items()):
        vn, mt = v["ventas_netas"], v["metros"]
        result.append({
            "periodo":          f"{a}-{m:02d}",
            "ano":              a,
            "mes":              m,
            "ventas_netas":     round(vn, 2),
            "metros":           round(mt, 2),
            "precio_por_metro": _ppm(vn, mt),
        })
    return result


@router.get("")
def get_resumen(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
):
    cfg = get_settings()
    key = f"com:{ano}:{mes}:{mes_fin}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    mes_max = today.month if (not mes and ano == today.year) else None

    try:
        sql, params = _build_sql(cfg, [ano], mes, mes_fin, mes_max)
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
        logger.info("Comercializacion: %d filas", len(df))
    except Exception as exc:
        logger.error("Comercializacion error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df = _apply_conversion(df, load_factores())
    mensual = _to_monthly(df)

    # Por producto
    prod_map: dict[tuple, dict] = {}
    for _, r in df.iterrows():
        k = (str(r["codigo_producto"] or "—"), str(r["uom"]))
        if k not in prod_map:
            prod_map[k] = {
                "codigo_producto": str(r["codigo_producto"] or "—"),
                "producto": str(r["producto"] or "—"), "uom": k[1],
                "factor": _n(r["factor"]),
                "cantidad": 0.0, "metros": 0.0, "ventas_netas": 0.0,
            }
        prod_map[k]["cantidad"]    += _n(r["cantidad"]) or 0.0
        prod_map[k]["ventas_netas"] += _n(r["ventas_netas"]) or 0.0
        mt = _n(r["metros"])
        if mt is not None:
            prod_map[k]["metros"] += mt

    productos = sorted(prod_map.values(), key=lambda x: -x["ventas_netas"])
    for p in productos:
        p["cantidad"]    = round(p["cantidad"], 2)
        p["metros"]      = round(p["metros"], 2)
        p["ventas_netas"] = round(p["ventas_netas"], 2)
        p["precio_por_metro"] = _ppm(p["ventas_netas"], p["metros"])

    # Por UOM
    uom_map: dict[str, dict] = {}
    for _, r in df.iterrows():
        u = str(r["uom"])
        if u not in uom_map:
            uom_map[u] = {
                "uom": u, "factor": _n(r["factor"]),
                "cantidad": 0.0, "metros": 0.0, "ventas_netas": 0.0,
            }
        uom_map[u]["cantidad"]    += _n(r["cantidad"]) or 0.0
        uom_map[u]["ventas_netas"] += _n(r["ventas_netas"]) or 0.0
        mt = _n(r["metros"])
        if mt is not None:
            uom_map[u]["metros"] += mt

    uoms = sorted(uom_map.values(), key=lambda x: -x["ventas_netas"])
    for u in uoms:
        u["cantidad"]    = round(u["cantidad"], 2)
        u["metros"]      = round(u["metros"], 2)
        u["ventas_netas"] = round(u["ventas_netas"], 2)
        u["precio_por_metro"] = _ppm(u["ventas_netas"], u["metros"])

    total_ventas = sum(m["ventas_netas"] for m in mensual)
    total_metros = sum(m["metros"] for m in mensual)
    ventas_conv  = sum(p["ventas_netas"] for p in productos if p["metros"] > 0)

    kpis = {
        "metros_totales":         round(total_metros, 2),
        "ventas_totales":         round(total_ventas, 2),
        "precio_por_metro":       _ppm(total_ventas, total_metros),
        "pct_ventas_convertidas": round(ventas_conv / total_ventas * 100, 1) if total_ventas > 0 else 0,
    }

    result = _sanitize({
        "ano": ano, "mes": mes, "mes_fin": mes_fin,
        "kpis": kpis,
        "mensual": mensual,
        "por_producto": productos[:50],
        "por_uom": uoms,
    })
    cache.set(key, result)
    return result


@router.get("/pronostico")
def get_pronostico(meses: int = Query(8, ge=1, le=12)):
    cfg = get_settings()
    key = f"com:pron:{meses}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()

    try:
        sql, params = _build_sql(cfg, [today.year - 1, today.year], excl_mes_actual=True)
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Comercializacion pronostico error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df = _apply_conversion(df, load_factores())
    df["metros"] = df["metros"].fillna(0)

    historico = _to_monthly(df)

    ventas_arr = np.array([m["ventas_netas"] for m in historico], dtype=float)
    metros_arr = np.array([m["metros"] for m in historico], dtype=float)

    def _wma(arr, steps):
        n = len(arr)
        if n == 0:
            return [0.0] * steps
        w = min(n, 6)
        weights = np.exp(np.linspace(0, 1, w))
        weights /= weights.sum()
        buf = list(arr)
        out = []
        for _ in range(steps):
            f = max(float(np.dot(weights, buf[-w:])), 0.0)
            out.append(f)
            buf.append(f)
        return out

    f_ventas = _wma(ventas_arr, meses)
    f_metros  = _wma(metros_arr, meses)

    cur_mes, cur_ano = today.month, today.year
    pronostico = []
    for i in range(meses):
        cur_mes += 1
        if cur_mes > 12:
            cur_mes = 1
            cur_ano += 1
        mt, vn = f_metros[i], f_ventas[i]
        pronostico.append({
            "periodo":          f"{cur_ano}-{cur_mes:02d}",
            "ano":              cur_ano,
            "mes":              cur_mes,
            "metros":           round(mt, 2),
            "ventas_netas":     round(vn, 2),
            "precio_por_metro": _ppm(vn, mt),
        })

    result = {"historico": historico, "pronostico": pronostico}
    cache.set(key, result)
    return result
