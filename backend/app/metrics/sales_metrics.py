"""
Sales metrics library.
Each function receives:
  df      — DataFrame already filtered by date range and dimensions
  cfg     — Settings instance (column aliases)
  filters — dict of active filter values (for reference / sub-filtering)
"""

import logging

import numpy as np
import pandas as pd

from .registry import metric_registry

logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────────────

def _safe_div(a, b, default=0.0):
    return a / b if b and b != 0 else default


def _pct_change(current, previous):
    if previous is None or previous == 0:
        return None
    return round(((current - previous) / abs(previous)) * 100, 2)


# ── metrics ──────────────────────────────────────────────────────────────────

@metric_registry.register(
    name="ventas_totales",
    label="Ventas Totales",
    description="Suma del monto de ventas en el periodo seleccionado",
)
def ventas_totales(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    value = float(df[cfg.COL_AMOUNT].sum()) if cfg.COL_AMOUNT in df.columns else 0.0
    return {"value": round(value, 2), "format": "currency", "unit": "MXN"}


@metric_registry.register(
    name="num_transacciones",
    label="Número de Transacciones",
    description="Cantidad de registros / ventas en el periodo",
)
def num_transacciones(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    return {"value": int(len(df)), "format": "integer"}


@metric_registry.register(
    name="ticket_promedio",
    label="Ticket Promedio",
    description="Monto promedio por transacción",
)
def ticket_promedio(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    if cfg.COL_AMOUNT not in df.columns or len(df) == 0:
        return {"value": 0.0, "format": "currency"}
    value = float(df[cfg.COL_AMOUNT].mean())
    return {"value": round(value, 2), "format": "currency", "unit": "MXN"}


@metric_registry.register(
    name="unidades_vendidas",
    label="Unidades Vendidas",
    description="Suma de cantidad vendida en el periodo",
)
def unidades_vendidas(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    if cfg.COL_QUANTITY not in df.columns:
        return {"value": None, "format": "integer", "note": "COL_QUANTITY not found"}
    value = int(df[cfg.COL_QUANTITY].sum())
    return {"value": value, "format": "integer"}


@metric_registry.register(
    name="clientes_unicos",
    label="Clientes Únicos",
    description="Número de clientes distintos en el periodo",
)
def clientes_unicos(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    if cfg.COL_CUSTOMER not in df.columns:
        return {"value": None, "format": "integer", "note": "COL_CUSTOMER not found"}
    return {"value": int(df[cfg.COL_CUSTOMER].nunique()), "format": "integer"}


@metric_registry.register(
    name="top_categoria",
    label="Categoría Top",
    description="Categoría con mayor volumen de ventas",
)
def top_categoria(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    if cfg.COL_CATEGORY not in df.columns or cfg.COL_AMOUNT not in df.columns:
        return {"value": None, "format": "text"}
    top = df.groupby(cfg.COL_CATEGORY)[cfg.COL_AMOUNT].sum().idxmax()
    return {"value": str(top), "format": "text"}


@metric_registry.register(
    name="top_region",
    label="Región Top",
    description="Región con mayor volumen de ventas",
)
def top_region(df: pd.DataFrame, *, cfg, filters: dict) -> dict:
    if cfg.COL_REGION not in df.columns or cfg.COL_AMOUNT not in df.columns:
        return {"value": None, "format": "text"}
    top = df.groupby(cfg.COL_REGION)[cfg.COL_AMOUNT].sum().idxmax()
    return {"value": str(top), "format": "text"}
