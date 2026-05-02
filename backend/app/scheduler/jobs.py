"""
Scheduler — dos jobs:
  1. daily_refresh  : flush de caché diario (REFRESH_HOUR:REFRESH_MINUTE)
  2. alertas_lunes  : envío de alertas de clientes a vendedores todos los lunes a las 8:00 AM
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


def _alertas_job() -> None:
    """Envía alertas semanales de clientes a todos los vendedores mapeados."""
    from ..services.email_service import enviar_alertas_semana
    logger.info("Alertas semanales: iniciando envío — %s", datetime.now().isoformat())
    try:
        resultado = enviar_alertas_semana()
        logger.info(
            "Alertas semanales: %d enviados, %d sin alertas, %d errores",
            resultado.get("enviados", 0),
            resultado.get("sin_alertas", 0),
            resultado.get("errores", 0),
        )
    except Exception as exc:
        logger.error("Alertas semanales: error inesperado — %s", exc)


def start_scheduler() -> None:
    global _scheduler
    cfg = get_settings()
    _scheduler = BackgroundScheduler(timezone="America/Bogota")
    _scheduler.add_job(
        _refresh_job,
        trigger=CronTrigger(hour=cfg.REFRESH_HOUR, minute=cfg.REFRESH_MINUTE),
        id="daily_refresh",
        replace_existing=True,
    )
    _scheduler.add_job(
        _alertas_job,
        trigger=CronTrigger(day_of_week="mon", hour=8, minute=0),
        id="alertas_lunes",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "Scheduler started — refresh %02d:%02d COL · alertas lunes 08:00 COL",
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
