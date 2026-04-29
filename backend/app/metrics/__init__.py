from .registry import metric_registry
from . import sales_metrics  # registers all metrics on import

__all__ = ["metric_registry"]
