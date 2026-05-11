"""
Servicio de correo — alertas semanales de clientes por vendedor.
Usa smtplib con STARTTLS (Office 365 / smtp.office365.com:587).
"""
import json
import logging
import smtplib
from datetime import date, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from ..config import get_settings
from ..database.snowflake_connector import connector

logger = logging.getLogger(__name__)

_BASE = Path(__file__).parent.parent.parent  # backend/
_CONTACTS_FILE   = _BASE / "contacts.json"
_VEND_MAP_FILE   = _BASE / "vendedor_map.json"


# ── Helpers de carga ──────────────────────────────────────────────────────────

def load_contacts() -> dict:
    with open(_CONTACTS_FILE, encoding="utf-8") as f:
        return json.load(f)


def load_vendedor_map() -> dict:
    """CODIGO_VENDEDOR → {email, director_email, nombre_asesor}"""
    if not _VEND_MAP_FILE.exists():
        return {}
    with open(_VEND_MAP_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_vendedor_map(data: dict) -> None:
    with open(_VEND_MAP_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Resolución de director por región ────────────────────────────────────────

def _director_for_region(region: str, directores: list[dict]) -> Optional[str]:
    region_up = (region or "").upper()
    for d in directores:
        for zona in d.get("zonas", []):
            if zona in region_up:
                return d["email"]
    return None


# ── Consultas Snowflake ───────────────────────────────────────────────────────

def _query_vendedores_con_alertas(ano: int, mes: Optional[int]) -> list[dict]:
    """Retorna lista de {codigo_vendedor, nombre, region_principal} con clientes en alerta."""
    cfg = get_settings()
    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None
    mes_cond_cur = f"fv.PERIODO_FISCAL = {mes}" if mes else (f"fv.PERIODO_FISCAL <= {ytd_cap}" if ytd_cap else "1=1")
    mes_cond_ant = mes_cond_cur

    sql = f"""
        WITH cur AS (
            SELECT fv.CODIGO_VENDEDOR, fv.NUMERO_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano} AND {mes_cond_cur}
            GROUP BY 1, 2
        ),
        ant AS (
            SELECT fv.CODIGO_VENDEDOR, fv.NUMERO_CLIENTE,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano - 1} AND {mes_cond_ant}
            GROUP BY 1, 2
        )
        SELECT DISTINCT c.CODIGO_VENDEDOR
        FROM cur c
        JOIN ant a ON c.CODIGO_VENDEDOR = a.CODIGO_VENDEDOR AND c.NUMERO_CLIENTE = a.NUMERO_CLIENTE
        WHERE a.vn_ant > 0
          AND ((c.vn - a.vn_ant) / ABS(a.vn_ant) * 100) <= -20
    """
    df = connector.query(sql)
    df.columns = [c.lower() for c in df.columns]
    codigos = df["codigo_vendedor"].tolist() if not df.empty else []

    # Obtener nombre + región principal de cada vendedor con alertas
    result = []
    for cod in codigos:
        sql_info = f"""
            WITH vr AS (
                SELECT fv.CODIGO_VENDEDOR,
                       dd.DESCRIPCION_REGION,
                       COUNT(*) AS freq
                FROM {cfg.T('FACT_VENTAS')} fv
                LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY
                WHERE fv.CODIGO_VENDEDOR = '{cod}'
                  AND fv.ANO_FISCAL = {ano}
                  AND dd.DESCRIPCION_REGION IS NOT NULL
                GROUP BY fv.CODIGO_VENDEDOR, dd.DESCRIPCION_REGION
                QUALIFY ROW_NUMBER() OVER (PARTITION BY fv.CODIGO_VENDEDOR ORDER BY freq DESC) = 1
            )
            SELECT MAX(dv.NOMBRE) AS nombre, vr.DESCRIPCION_REGION AS region_principal
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
            LEFT JOIN vr ON fv.CODIGO_VENDEDOR = vr.CODIGO_VENDEDOR
            WHERE fv.CODIGO_VENDEDOR = '{cod}' AND fv.ANO_FISCAL = {ano}
            GROUP BY vr.DESCRIPCION_REGION
            LIMIT 1
        """
        try:
            df_info = connector.query(sql_info)
            df_info.columns = [c.lower() for c in df_info.columns]
            nombre  = str(df_info.iloc[0]["nombre"]) if not df_info.empty else cod
            region  = str(df_info.iloc[0]["region_principal"]) if not df_info.empty else ""
        except Exception:
            nombre, region = cod, ""
        result.append({"codigo_vendedor": cod, "nombre": nombre, "region": region})
    return result


def _clientes_en_caida(codigo_vendedor: str, ano: int, mes: Optional[int]) -> list[dict]:
    """Clientes del vendedor con caída >20% YoY."""
    cfg = get_settings()
    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None
    mes_cond_cur = f"fv.PERIODO_FISCAL = {mes}" if mes else (f"fv.PERIODO_FISCAL <= {ytd_cap}" if ytd_cap else "1=1")
    mes_cond_ant = mes_cond_cur

    sql = f"""
        WITH cur AS (
            SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn,
                   MAX(dc.NOMBRE) AS nombre_cliente
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
            WHERE fv.ANO_FISCAL = {ano} AND {mes_cond_cur}
              AND UPPER(fv.CODIGO_VENDEDOR) = UPPER('{codigo_vendedor}')
            GROUP BY 1
        ),
        ant AS (
            SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano - 1} AND {mes_cond_ant}
              AND UPPER(fv.CODIGO_VENDEDOR) = UPPER('{codigo_vendedor}')
            GROUP BY 1
        )
        SELECT c.NUMERO_CLIENTE,
               c.nombre_cliente,
               c.vn,
               a.vn_ant,
               ROUND((c.vn - a.vn_ant) / ABS(a.vn_ant) * 100, 1) AS yoy_pct
        FROM cur c
        JOIN ant a ON c.NUMERO_CLIENTE = a.NUMERO_CLIENTE
        WHERE a.vn_ant > 0
          AND ((c.vn - a.vn_ant) / ABS(a.vn_ant) * 100) <= -20
        ORDER BY yoy_pct ASC
        LIMIT 30
    """
    df = connector.query(sql)
    df.columns = [c.lower() for c in df.columns]
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "numero_cliente": str(r["numero_cliente"]),
            "nombre":    str(r["nombre_cliente"] or r["numero_cliente"]),
            "vn_actual": float(r["vn"]),
            "vn_ant":    float(r["vn_ant"]),
            "yoy_pct":   float(r["yoy_pct"]),
        })
    return rows


def _clientes_inactivos(codigo_vendedor: str, meses: int = 3) -> list[dict]:
    """Clientes del vendedor sin compras en los últimos `meses` meses."""
    cfg = get_settings()
    sql = f"""
        WITH hist AS (
            SELECT fv.NUMERO_CLIENTE,
                   MAX(fv.FECHA_FACTURA) AS ultima_compra,
                   SUM(fv.VENTAS_NETAS)  AS ventas_historico,
                   MAX(dc.NOMBRE)        AS nombre_cliente
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
            WHERE UPPER(fv.CODIGO_VENDEDOR) = UPPER('{codigo_vendedor}')
              AND fv.VENTAS_NETAS > 0
            GROUP BY 1
            HAVING MAX(fv.FECHA_FACTURA) < DATEADD('month', -{meses}, CURRENT_DATE())
        )
        SELECT NUMERO_CLIENTE, nombre_cliente, ultima_compra, ventas_historico
        FROM hist
        WHERE ventas_historico > 3000000
        ORDER BY ventas_historico DESC
        LIMIT 20
    """
    df = connector.query(sql)
    df.columns = [c.lower() for c in df.columns]
    rows = []
    for _, r in df.iterrows():
        ultima = r["ultima_compra"]
        if hasattr(ultima, "strftime"):
            ultima_str = ultima.strftime("%d/%m/%Y")
        else:
            ultima_str = str(ultima)
        rows.append({
            "numero_cliente":  str(r["numero_cliente"]),
            "nombre":          str(r["nombre_cliente"] or r["numero_cliente"]),
            "ultima_compra":   ultima_str,
            "ventas_historico": float(r["ventas_historico"]),
        })
    return rows


# ── Formato COP corto ──────────────────────────────────────────────────────────

def _fmt(v: float) -> str:
    a = abs(v)
    if a >= 1_000_000_000:
        return f"${a/1_000_000_000:.1f}MM"
    if a >= 1_000_000:
        return f"${a/1_000_000:.1f}M"
    if a >= 1_000:
        return f"${a/1_000:.0f}K"
    return f"${a:.0f}"


# ── Construcción del HTML del correo ──────────────────────────────────────────

def _build_html(nombre_asesor: str, caida: list[dict], inactivos: list[dict],
                ano: int, mes: Optional[int]) -> str:
    periodo = f"mes {mes}/{ano}" if mes else f"acumulado {ano}"
    fecha_envio = datetime.now().strftime("%d/%m/%Y")

    def _row_caida(r: dict, i: int) -> str:
        bg = "#1a1f2e" if i % 2 == 0 else "#141926"
        pct = r["yoy_pct"]
        pct_color = "#f87171" if pct < -50 else "#fb923c"
        return f"""
        <tr style="background:{bg};">
          <td style="padding:8px 12px;color:#e2e8f0;font-size:13px;">{r['nombre']}</td>
          <td style="padding:8px 12px;text-align:right;color:#818cf8;font-size:13px;">{_fmt(r['vn_actual'])}</td>
          <td style="padding:8px 12px;text-align:right;color:#64748b;font-size:13px;">{_fmt(r['vn_ant'])}</td>
          <td style="padding:8px 12px;text-align:right;color:{pct_color};font-weight:700;font-size:13px;">{pct:+.1f}%</td>
        </tr>"""

    def _row_inactivo(r: dict, i: int) -> str:
        bg = "#1a1f2e" if i % 2 == 0 else "#141926"
        return f"""
        <tr style="background:{bg};">
          <td style="padding:8px 12px;color:#e2e8f0;font-size:13px;">{r['nombre']}</td>
          <td style="padding:8px 12px;text-align:center;color:#f59e0b;font-size:13px;">{r['ultima_compra']}</td>
          <td style="padding:8px 12px;text-align:right;color:#818cf8;font-size:13px;">{_fmt(r['ventas_historico'])}</td>
        </tr>"""

    seccion_caida = ""
    if caida:
        filas = "".join(_row_caida(r, i) for i, r in enumerate(caida))
        seccion_caida = f"""
        <h3 style="color:#fb923c;font-size:15px;margin:24px 0 8px;">
          ⚠️ Clientes con caída &gt;20% vs año anterior ({len(caida)})
        </h3>
        <p style="color:#64748b;font-size:12px;margin:0 0 12px;">
          Estos clientes compraban más el año pasado. Contáctalos esta semana.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#1e293b;">
              <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;">Cliente</th>
              <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-size:12px;font-weight:600;">Ventas {ano}</th>
              <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-size:12px;font-weight:600;">Ventas {ano-1}</th>
              <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-size:12px;font-weight:600;">Var YoY</th>
            </tr>
          </thead>
          <tbody>{filas}</tbody>
        </table>"""

    seccion_inactivos = ""
    if inactivos:
        filas = "".join(_row_inactivo(r, i) for i, r in enumerate(inactivos))
        seccion_inactivos = f"""
        <h3 style="color:#f87171;font-size:15px;margin:28px 0 8px;">
          🔴 Clientes inactivos +3 meses con historial relevante ({len(inactivos)})
        </h3>
        <p style="color:#64748b;font-size:12px;margin:0 0 12px;">
          Sin compras en los últimos 3 meses. Facturación histórica &gt; $3M.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#1e293b;">
              <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;">Cliente</th>
              <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">Última Compra</th>
              <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-size:12px;font-weight:600;">Historial Total</th>
            </tr>
          </thead>
          <tbody>{filas}</tbody>
        </table>"""

    if not caida and not inactivos:
        cuerpo = """
        <div style="background:#0f3d2b;border:1px solid #16a34a;border-radius:8px;padding:20px;text-align:center;margin:24px 0;">
          <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0;">✅ ¡Sin alertas esta semana!</p>
          <p style="color:#86efac;font-size:13px;margin:8px 0 0;">
            Todos tus clientes están activos y con buen desempeño.
          </p>
        </div>"""
    else:
        cuerpo = seccion_caida + seccion_inactivos

    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:24px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1f2937;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e1b4b 0%,#172554 100%);padding:28px 32px;">
            <p style="margin:0;color:#818cf8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
              ALICO SAS BIC · Centro de Inteligencia de Negocio
            </p>
            <h1 style="margin:8px 0 4px;color:#e0e7ff;font-size:22px;font-weight:800;">
              📊 Reporte Semanal de Alertas
            </h1>
            <p style="margin:0;color:#a5b4fc;font-size:13px;">
              {nombre_asesor} · Período: {periodo} · Enviado: {fecha_envio}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px 8px;">
            <p style="color:#94a3b8;font-size:14px;margin:0 0 4px;">
              Hola <strong style="color:#e2e8f0;">{nombre_asesor}</strong>,
            </p>
            <p style="color:#64748b;font-size:13px;margin:4px 0 0;line-height:1.6;">
              A continuación el resumen de tus clientes que requieren atención prioritaria esta semana.
              Por favor revisa y haz seguimiento antes del próximo reporte.
            </p>
            {cuerpo}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px;">
            <hr style="border:none;border-top:1px solid #1f2937;margin:0 0 16px;">
            <p style="color:#374151;font-size:11px;margin:0;line-height:1.6;">
              Este reporte es generado automáticamente por el sistema BI Ventas de ALICO SAS BIC.<br>
              Datos con corte al {fecha_envio}. Para consultas contacta a
              <a href="mailto:kfranco@alico-sa.com" style="color:#6366f1;">kfranco@alico-sa.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ── Envío SMTP ────────────────────────────────────────────────────────────────

def send_email(to: str, cc: list[str], subject: str, html: str) -> None:
    cfg = get_settings()
    if not cfg.SMTP_USER or not cfg.SMTP_PASSWORD:
        raise ValueError("SMTP_USER y SMTP_PASSWORD no están configurados en .env")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{cfg.SMTP_FROM_NAME} <{cfg.SMTP_USER}>"
    msg["To"]      = to
    if cc:
        msg["Cc"]  = ", ".join(cc)
    msg.attach(MIMEText(html, "html", "utf-8"))

    recipients = [to] + cc
    with smtplib.SMTP(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=30) as s:
        s.ehlo()
        s.starttls()
        s.ehlo()
        s.login(cfg.SMTP_USER, cfg.SMTP_PASSWORD)
        s.sendmail(cfg.SMTP_USER, recipients, msg.as_string())
    logger.info("Email enviado a %s (CC: %s) | %s", to, cc, subject)


# ── Punto de entrada principal ────────────────────────────────────────────────

def enviar_alertas_semana(ano: Optional[int] = None, mes: Optional[int] = None,
                          solo_codigo: Optional[str] = None) -> dict:
    """
    Envía alertas semanales a todos los vendedores mapeados.
    Si solo_codigo está definido, solo envía para ese vendedor.
    Retorna resumen de envíos.
    """
    cfg = get_settings()
    if not cfg.ALERTAS_ENABLED:
        return {"status": "disabled", "enviados": 0}

    hoy = date.today()
    ano  = ano  or hoy.year
    mes  = mes  # None = acumulado anual

    contacts  = load_contacts()
    vend_map  = load_vendedor_map()
    directores = contacts.get("directores", [])
    gerencia   = contacts.get("gerencia", {})

    cc_fijos = [
        gerencia.get("gerente",    {}).get("email", ""),
        gerencia.get("subgerente", {}).get("email", ""),
        gerencia.get("bi",         {}).get("email", ""),
    ]
    cc_fijos = [e for e in cc_fijos if e]

    enviados, errores = [], []

    # Vendedores con mapeo configurado
    targets = {k: v for k, v in vend_map.items()
               if v.get("email") and (solo_codigo is None or k == solo_codigo)}

    if not targets:
        return {"status": "ok", "enviados": 0, "mensaje": "No hay vendedores mapeados aún."}

    for cod, info in targets.items():
        try:
            nombre_asesor = info.get("nombre_asesor") or cod
            email_asesor  = info["email"]
            director_email = info.get("director_email") or _director_for_region(
                info.get("region", ""), directores
            )

            caida     = _clientes_en_caida(cod, ano, mes)
            inactivos = _clientes_inactivos(cod, meses=3)

            # Solo enviar si hay algo que reportar
            if not caida and not inactivos:
                enviados.append({"codigo": cod, "nombre": nombre_asesor, "status": "sin_alertas"})
                continue

            cc = list(cc_fijos)
            if director_email and director_email not in cc:
                cc.append(director_email)
            # No duplicar si asesor == gerencia
            cc = [e for e in cc if e != email_asesor]

            html = _build_html(nombre_asesor, caida, inactivos, ano, mes)
            periodo_label = f"Mes {mes}/{ano}" if mes else f"Año {ano}"
            subject = f"📊 Alertas Comerciales — {periodo_label} | {nombre_asesor}"
            send_email(email_asesor, cc, subject, html)
            enviados.append({
                "codigo": cod, "nombre": nombre_asesor, "status": "enviado",
                "clientes_caida": len(caida), "clientes_inactivos": len(inactivos),
            })
        except Exception as exc:
            logger.error("Error enviando alerta para %s: %s", cod, exc)
            errores.append({"codigo": cod, "error": str(exc)})

    return {
        "status": "ok",
        "enviados": len([e for e in enviados if e.get("status") == "enviado"]),
        "sin_alertas": len([e for e in enviados if e.get("status") == "sin_alertas"]),
        "errores": len(errores),
        "detalle": enviados,
        "detalle_errores": errores,
    }
