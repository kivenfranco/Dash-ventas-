"""
Daily refresh scheduler — runs at REFRESH_HOUR:REFRESH_MINUTE every day.
Flushes all caches so the next API request fetches fresh Snowflake data.
"""

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _refresh_job() -> None:
    logger.info("Scheduled refresh started at %s", datetime.now().isoformat())
    ok = connector.test()
    if not ok:
        logger.error("Snowflake connection failed — refresh aborted")
        return
    cache.flush()
    logger.info("Scheduled refresh completed — cache invalidated")


def start_scheduler() -> None:
    global _scheduler
    cfg = get_settings()
    _scheduler = BackgroundScheduler(timezone="America/Mexico_City")
    _scheduler.add_job(
        _refresh_job,
        trigger=CronTrigger(hour=cfg.REFRESH_HOUR, minute=cfg.REFRESH_MINUTE),
        id="daily_refresh",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "Scheduler started — daily refresh at %02d:%02d MX time",
        cfg.REFRESH_HOUR,
        cfg.REFRESH_MINUTE,
    )


def stop_scheduler() -> None:
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def trigger_manual_refresh() -> dict:
    """Invoke the refresh job immediately (used by the /api/refresh endpoint)."""
    _refresh_job()
    return {"status": "ok", "refreshed_at": datetime.now().isoformat()}
