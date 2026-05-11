"""
Scheduler — tres jobs:
  1. daily_refresh    : flush de caché diario (REFRESH_HOUR:REFRESH_MINUTE)
  2. alertas_lunes    : envío de alertas de clientes a vendedores todos los lunes a las 8:00 AM
  3. anomalias_diario : detección de anomalías YoY y envío de alerta si supera umbral
"""

import logging
from datetime import date, datetime
from typing import Optional

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


def _anomalias_job() -> None:
    """
    Detección diaria de anomalías YoY en ventas globales.
    Si la caída supera ANOMALIA_UMBRAL_PCT (default -15%), envía email de alerta al equipo BI.
    """
    from ..services.email_service import send_email, load_contacts
    cfg = get_settings()

    if not cfg.ALERTAS_ENABLED:
        return

    hoy = date.today()
    ano = hoy.year
    mes: Optional[int] = hoy.month

    logger.info("Anomalías diarias: verificando YoY — %s", hoy.isoformat())

    try:
        sql = f"""
            WITH cur AS (
                SELECT COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
                FROM {cfg.T('FACT_VENTAS')} fv
                WHERE fv.ANO_FISCAL = {ano} AND fv.PERIODO_FISCAL = {mes}
            ),
            ant AS (
                SELECT COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant
                FROM {cfg.T('FACT_VENTAS')} fv
                WHERE fv.ANO_FISCAL = {ano - 1} AND fv.PERIODO_FISCAL = {mes}
            )
            SELECT cur.vn, ant.vn_ant,
                   CASE WHEN ant.vn_ant > 0
                        THEN ROUND((cur.vn - ant.vn_ant) / ant.vn_ant * 100, 1)
                        ELSE NULL END AS yoy_pct
            FROM cur, ant
        """
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
        if df.empty:
            logger.info("Anomalías diarias: sin datos para %d/%d", mes, ano)
            return

        row = df.iloc[0]
        yoy_pct = float(row["yoy_pct"]) if row["yoy_pct"] is not None else None
        vn_cur  = float(row["vn"])
        vn_ant  = float(row["vn_ant"])

        umbral = cfg.ANOMALIA_UMBRAL_PCT
        if yoy_pct is None or yoy_pct >= umbral:
            logger.info("Anomalías diarias: YoY=%s%% — dentro del umbral (%s%%), sin alerta",
                        yoy_pct, umbral)
            return

        logger.warning("Anomalía detectada: YoY=%s%% para %d/%d — enviando alerta", yoy_pct, mes, ano)

        contacts  = load_contacts()
        gerencia  = contacts.get("gerencia", {})
        bi_email  = gerencia.get("bi", {}).get("email", "")
        if not bi_email:
            logger.warning("Anomalías: no hay email BI configurado en contacts.json")
            return

        def _fmt(v: float) -> str:
            a = abs(v)
            if a >= 1e9:  return f"${a/1e9:.1f}MM"
            if a >= 1e6:  return f"${a/1e6:.1f}M"
            if a >= 1e3:  return f"${a/1e3:.0f}K"
            return f"${a:.0f}"

        meses_es = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
        mes_label = meses_es[mes - 1] if 1 <= mes <= 12 else str(mes)

        html = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#450a0a,#7f1d1d);padding:24px 28px;">
      <p style="margin:0;color:#fca5a5;font-size:11px;letter-spacing:2px;text-transform:uppercase;">ALICO SAS BIC · Alerta Automática</p>
      <h1 style="margin:8px 0 4px;color:#fee2e2;font-size:20px;font-weight:800;">🚨 Anomalía de Ventas Detectada</h1>
      <p style="margin:0;color:#fca5a5;font-size:13px;">{mes_label} {ano} vs {mes_label} {ano - 1}</p>
    </div>
    <div style="padding:24px 28px;">
      <table width="100%" style="border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:12px;background:#1e293b;border-radius:8px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">Ventas {ano}</p>
            <p style="margin:4px 0 0;color:#e2e8f0;font-size:22px;font-weight:700;">{_fmt(vn_cur)}</p>
          </td>
          <td width="16"></td>
          <td style="padding:12px;background:#1e293b;border-radius:8px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">Ventas {ano - 1}</p>
            <p style="margin:4px 0 0;color:#64748b;font-size:22px;font-weight:700;">{_fmt(vn_ant)}</p>
          </td>
          <td width="16"></td>
          <td style="padding:12px;background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;text-align:center;">
            <p style="margin:0;color:#fca5a5;font-size:11px;">Variación YoY</p>
            <p style="margin:4px 0 0;color:#f87171;font-size:22px;font-weight:700;">{yoy_pct:+.1f}%</p>
          </td>
        </tr>
      </table>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;">
        La caída supera el umbral configurado de <strong style="color:#fca5a5;">{umbral}%</strong>.
        Revisa el dashboard BI para identificar las causas: regiones, vendedores o grupos comerciales afectados.
      </p>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #1f2937;">
      <p style="color:#374151;font-size:11px;margin:0;">
        Generado automáticamente por BI Ventas ALICO · {hoy.strftime('%d/%m/%Y')}
      </p>
    </div>
  </div>
</body>
</html>"""

        subject = f"🚨 Alerta Ventas — {mes_label} {ano}: YoY {yoy_pct:+.1f}%"
        send_email(bi_email, [], subject, html)
        logger.info("Alerta de anomalía enviada a %s", bi_email)

    except Exception as exc:
        logger.error("Anomalías diarias: error inesperado — %s", exc)


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
    _scheduler.add_job(
        _anomalias_job,
        trigger=CronTrigger(hour=7, minute=30),
        id="anomalias_diario",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "Scheduler started — refresh %02d:%02d COL · alertas lunes 08:00 COL · anomalías 07:30 COL",
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
