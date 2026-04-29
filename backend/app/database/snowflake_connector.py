import logging
from contextlib import contextmanager
from typing import Optional

import pandas as pd
import snowflake.connector

from ..config import get_settings

logger = logging.getLogger(__name__)


class SnowflakeConnector:
    """Thread-safe Snowflake connector. Creates a new connection per operation."""

    def _cfg(self):
        # Always fetch fresh (lru_cache handles efficiency)
        return get_settings()

    def _conn_params(self) -> dict:
        cfg = self._cfg()
        return {
            "user":       cfg.SNOWFLAKE_USER,
            "password":   cfg.SNOWFLAKE_PASSWORD,
            "account":    cfg.SNOWFLAKE_ACCOUNT,
            "warehouse":  cfg.SNOWFLAKE_WAREHOUSE,
            "database":   cfg.SNOWFLAKE_DATABASE,
            "schema":     cfg.SNOWFLAKE_SCHEMA,
            "client_session_keep_alive": False,
        }

    @contextmanager
    def connection(self):
        cfg = self._cfg()
        conn = None
        try:
            conn = snowflake.connector.connect(**self._conn_params())
            # Explicitly set warehouse, database, schema at session level
            cur = conn.cursor()
            cur.execute(f"USE WAREHOUSE {cfg.SNOWFLAKE_WAREHOUSE}")
            cur.execute(f"USE DATABASE {cfg.SNOWFLAKE_DATABASE}")
            cur.close()
            logger.debug("Snowflake connection opened (warehouse=%s)", cfg.SNOWFLAKE_WAREHOUSE)
            yield conn
        except snowflake.connector.errors.DatabaseError as exc:
            logger.error("Snowflake connection error: %s", exc)
            raise
        finally:
            if conn and not conn.is_closed():
                conn.close()
                logger.debug("Snowflake connection closed")

    def query(self, sql: str, params: Optional[list] = None) -> pd.DataFrame:
        with self.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(sql, params or [])
                df = cur.fetch_pandas_all()
                logger.debug("Query returned %d rows", len(df))
                return df
            finally:
                cur.close()

    def test(self) -> bool:
        try:
            with self.connection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT CURRENT_WAREHOUSE(), CURRENT_DATABASE()")
                row = cur.fetchone()
                cur.close()
                logger.info("Connected: warehouse=%s db=%s", row[0], row[1])
            return True
        except Exception as exc:
            logger.error("Connection test failed: %s", exc)
            return False


connector = SnowflakeConnector()
