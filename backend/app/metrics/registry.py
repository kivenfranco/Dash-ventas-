"""
Metric Registry — extensible DAX-like metric system.

HOW TO ADD A NEW METRIC
-----------------------
1. Open sales_metrics.py (or create a new file).
2. Decorate your function with @metric_registry.register():

    @metric_registry.register(
        name="mi_metrica",
        label="Mi Métrica",
        description="Explicación breve",
    )
    def mi_metrica(df, *, cfg, filters):
        # df: pre-filtered DataFrame from Snowflake
        # cfg: Settings instance (access column names, table, etc.)
        # filters: dict of active filter values
        return {"value": df[cfg.COL_AMOUNT].sum(), "format": "currency"}

3. Call it via GET /api/kpis?metrics=mi_metrica
"""

import logging
from typing import Any, Callable

import pandas as pd

logger = logging.getLogger(__name__)


class MetricRegistry:
    _instance: "MetricRegistry | None" = None

    def __new__(cls) -> "MetricRegistry":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._metrics: dict[str, dict] = {}
        return cls._instance

    def register(self, name: str, label: str, description: str = "") -> Callable:
        def decorator(func: Callable) -> Callable:
            self._metrics[name] = {"func": func, "label": label, "description": description}
            logger.debug("Metric registered: %s", name)
            return func
        return decorator

    def compute(self, name: str, df: pd.DataFrame, *, cfg: Any, filters: dict) -> dict:
        if name not in self._metrics:
            raise KeyError(f"Metric not found: '{name}'. Available: {self.list()}")
        return self._metrics[name]["func"](df, cfg=cfg, filters=filters)

    def compute_all(self, df: pd.DataFrame, *, cfg: Any, filters: dict) -> dict:
        results = {}
        for name in self._metrics:
            try:
                results[name] = self.compute(name, df, cfg=cfg, filters=filters)
            except Exception as exc:
                logger.warning("Metric '%s' failed: %s", name, exc)
                results[name] = {"value": None, "error": str(exc)}
        return results

    def list(self) -> list[str]:
        return list(self._metrics.keys())

    def catalog(self) -> list[dict]:
        return [
            {"name": k, "label": v["label"], "description": v["description"]}
            for k, v in self._metrics.items()
        ]


metric_registry = MetricRegistry()
