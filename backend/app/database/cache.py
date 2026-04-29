import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TTLCache:
    """Simple in-memory TTL cache for DataFrames and dicts."""

    def __init__(self, ttl_hours: int = 6) -> None:
        self._ttl = ttl_hours * 3600
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        if key not in self._store:
            return None
        value, ts = self._store[key]
        if time.time() - ts > self._ttl:
            del self._store[key]
            logger.debug("Cache expired: %s", key)
            return None
        logger.debug("Cache hit: %s", key)
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (value, time.time())
        logger.debug("Cache set: %s", key)

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)

    def flush(self) -> None:
        count = len(self._store)
        self._store.clear()
        logger.info("Cache flushed (%d entries removed)", count)

    def stats(self) -> dict:
        now = time.time()
        return {
            "total_entries": len(self._store),
            "entries": [
                {"key": k, "age_seconds": round(now - ts)}
                for k, (_, ts) in self._store.items()
            ],
        }


cache = TTLCache()
