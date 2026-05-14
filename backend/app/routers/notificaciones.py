"""
GET  /api/notificaciones/vendedores     — lista vendedores del DB + estado mapeo
POST /api/notificaciones/mapeo          — guarda CODIGO_VENDEDOR → email/director
POST /api/notificaciones/enviar         — dispara envío inmediato (manual)
POST /api/notificaciones/enviar/{cod}   — envía solo a un vendedor
GET  /api/notificaciones/preview/{cod}  — devuelve HTML preview sin enviar
GET  /api/notificaciones/contactos      — lista de contactos del CSV
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..config import get_settings
from ..database.snowflake_connector import connector
from ..services.email_service import (
    load_contacts,
    load_vendedor_map,
    save_vendedor_map,
    enviar_alertas_semana,
    _clientes_en_caida,
    _clientes_inactivos,
    _build_html,
    _director_for_region,
)

router = APIRouter(prefix="/api/notificaciones", tags=["Notificaciones"])
logger = logging.getLogger(__name__)


# ── Schemas ────────────────────────────────────────────────────────────────────

class MapeoItem(BaseModel):
    codigo_vendedor: str
    email: str
    nombre_asesor: str
    director_email: Optional[str] = None
    region: Optional[str] = None


class EnviarRequest(BaseModel):
    ano: Optional[int] = None
    mes: Optional[int] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/contactos")
def get_contactos():
    """Devuelve lista de contactos (nombre + email) para usar en selects del frontend."""
    contacts = load_contacts()
    asesores = contacts.get("asesores", [])
    return {
        "contactos": [
            {"nombre": a["nombre"], "email": a["email"], "cargo": a.get("cargo", "")}
            for a in asesores
        ],
        "directores": contacts.get("directores", []),
        "gerencia": contacts.get("gerencia", {}),
    }


@router.get("/vendedores")
def get_vendedores(ano: int = Query(default_factory=lambda: date.today().year)):
    """Lista todos los CODIGO_VENDEDOR activos del DB con nombre y estado de mapeo."""
    cfg = get_settings()
    sql = f"""
        WITH vd AS (
            SELECT fv.CODIGO_VENDEDOR,
                   MAX(dv.NOMBRE)        AS nombre,
                   SUM(fv.VENTAS_NETAS)  AS ventas_totales
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
            WHERE fv.ANO_FISCAL = {ano}
              AND UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%'
              AND UPPER(fv.CODIGO_VENDEDOR) != 'PBOGOTA'
            GROUP BY fv.CODIGO_VENDEDOR
        ),
        vr AS (
            SELECT fv.CODIGO_VENDEDOR,
                   dd.DESCRIPCION_REGION,
                   COUNT(*) AS freq
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY
            WHERE fv.ANO_FISCAL = {ano}
              AND dd.DESCRIPCION_REGION IS NOT NULL
            GROUP BY fv.CODIGO_VENDEDOR, dd.DESCRIPCION_REGION
            QUALIFY ROW_NUMBER() OVER (PARTITION BY fv.CODIGO_VENDEDOR ORDER BY freq DESC) = 1
        )
        SELECT vd.CODIGO_VENDEDOR,
               vd.nombre,
               vd.ventas_totales,
               vr.DESCRIPCION_REGION AS region_principal
        FROM vd
        LEFT JOIN vr ON vd.CODIGO_VENDEDOR = vr.CODIGO_VENDEDOR
        ORDER BY ventas_totales DESC
    """
    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    vend_map  = load_vendedor_map()
    contacts  = load_contacts()
    directores = contacts.get("directores", [])

    result = []
    for _, r in df.iterrows():
        cod = str(r["codigo_vendedor"])
        mapeado = vend_map.get(cod)
        region  = str(r.get("region_principal") or "")
        director_auto = _director_for_region(region, directores)
        result.append({
            "codigo_vendedor":  cod,
            "nombre":           str(r.get("nombre") or cod),
            "ventas_totales":   round(float(r.get("ventas_totales") or 0), 0),
            "region_principal": region,
            "director_sugerido": director_auto,
            "mapeado":    mapeado is not None,
            "email":           mapeado.get("email")          if mapeado else None,
            "nombre_asesor":   mapeado.get("nombre_asesor")  if mapeado else None,
            "director_email":  mapeado.get("director_email") if mapeado else director_auto,
        })
    return {"vendedores": result, "total": len(result)}


@router.post("/mapeo")
def guardar_mapeo(items: list[MapeoItem]):
    """Guarda o actualiza el mapeo CODIGO_VENDEDOR → contacto."""
    vend_map = load_vendedor_map()
    for item in items:
        vend_map[item.codigo_vendedor] = {
            "email":          item.email,
            "nombre_asesor":  item.nombre_asesor,
            "director_email": item.director_email,
            "region":         item.region,
        }
    save_vendedor_map(vend_map)
    return {"status": "ok", "guardados": len(items)}


@router.delete("/mapeo/{codigo_vendedor}")
def eliminar_mapeo(codigo_vendedor: str):
    vend_map = load_vendedor_map()
    if codigo_vendedor not in vend_map:
        raise HTTPException(status_code=404, detail="Vendedor no mapeado")
    del vend_map[codigo_vendedor]
    save_vendedor_map(vend_map)
    return {"status": "ok"}


@router.post("/enviar")
def enviar_todas(req: EnviarRequest):
    """Dispara el envío de alertas a todos los vendedores mapeados."""
    try:
        resultado = enviar_alertas_semana(ano=req.ano, mes=req.mes)
        return resultado
    except Exception as exc:
        logger.error("Error en envío masivo: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/enviar/{codigo_vendedor}")
def enviar_uno(codigo_vendedor: str, req: EnviarRequest):
    """Envía la alerta solo a un vendedor específico."""
    try:
        resultado = enviar_alertas_semana(
            ano=req.ano, mes=req.mes, solo_codigo=codigo_vendedor
        )
        return resultado
    except Exception as exc:
        logger.error("Error enviando a %s: %s", codigo_vendedor, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/preview/{codigo_vendedor}", response_class=HTMLResponse)
def preview_email(
    codigo_vendedor: str,
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None),
):
    """Devuelve el HTML del email sin enviarlo (para previsualizar en el frontend)."""
    vend_map = load_vendedor_map()
    info = vend_map.get(codigo_vendedor)
    nombre_asesor = (info.get("nombre_asesor") if info else None) or codigo_vendedor
    try:
        caida     = _clientes_en_caida(codigo_vendedor, ano, mes)
        inactivos = _clientes_inactivos(codigo_vendedor, meses=3)
        html = _build_html(nombre_asesor, caida, inactivos, ano, mes)
        return HTMLResponse(content=html)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/config")
def get_config():
    """Devuelve configuración SMTP (sin password) y estado del sistema."""
    cfg = get_settings()
    return {
        "smtp_host":          cfg.SMTP_HOST,
        "smtp_port":          cfg.SMTP_PORT,
        "smtp_user":          cfg.SMTP_USER,
        "smtp_from_name":     cfg.SMTP_FROM_NAME,
        "alertas_enabled":    cfg.ALERTAS_ENABLED,
        "smtp_configurado":   bool(cfg.SMTP_USER and cfg.SMTP_PASSWORD),
        "teams_configurado":  bool(cfg.TEAMS_WEBHOOK_URL),
        "whatsapp_configurado": bool(cfg.WHATSAPP_TOKEN and cfg.WHATSAPP_PHONE_ID),
    }


class EmailTestBody(BaseModel):
    destinatario: Optional[str] = None


class TeamsTestBody(BaseModel):
    mensaje: Optional[str] = None


class WhatsAppTestBody(BaseModel):
    numero: str
    mensaje: Optional[str] = None


@router.post("/email-test")
async def enviar_email_test(body: EmailTestBody):
    """Envía un email de prueba al destinatario (por defecto SMTP_USER)."""
    from ..services.email_service import send_email
    cfg = get_settings()
    if not cfg.SMTP_USER or not cfg.SMTP_PASSWORD:
        raise HTTPException(status_code=400, detail="SMTP_USER y SMTP_PASSWORD no configurados en .env")
    to = body.destinatario or cfg.SMTP_USER
    html = """<div style="font-family:Arial,sans-serif;padding:24px;background:#0d1117;color:#e2e8f0;border-radius:8px;">
      <h2 style="color:#818cf8;">✅ BI Ventas — Prueba de correo</h2>
      <p>Si ves este mensaje, el envío de emails está funcionando correctamente.</p>
      <p style="color:#64748b;font-size:12px;">Enviado desde el sistema BI Ventas ALICO SAS BIC.</p>
    </div>"""
    try:
        send_email(to, [], "BI Ventas — Prueba de correo ✅", html)
        return {"status": "ok", "mensaje": f"Email de prueba enviado a {to}."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error al enviar email: {exc}")


@router.post("/teams-test")
async def enviar_teams_test(body: TeamsTestBody):
    """Envía un mensaje de prueba al webhook de Teams."""
    import httpx
    cfg = get_settings()
    if not cfg.TEAMS_WEBHOOK_URL:
        raise HTTPException(status_code=400, detail="TEAMS_WEBHOOK_URL no configurado.")
    payload = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": "BI Ventas — Prueba",
        "themeColor": "0076D7",
        "title": "BI Ventas · Prueba de notificación",
        "text": body.mensaje or "✅ Conexión con Microsoft Teams funcionando correctamente.",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(cfg.TEAMS_WEBHOOK_URL, json=payload)
            resp.raise_for_status()
        return {"status": "ok", "mensaje": "Mensaje enviado a Teams."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error al enviar a Teams: {exc}")


@router.post("/whatsapp-test")
async def enviar_whatsapp_test(body: WhatsAppTestBody):
    """Envía un mensaje de prueba vía WhatsApp Business API."""
    import httpx
    cfg = get_settings()
    if not cfg.WHATSAPP_TOKEN or not cfg.WHATSAPP_PHONE_ID:
        raise HTTPException(status_code=400, detail="WHATSAPP_TOKEN / WHATSAPP_PHONE_ID no configurados.")
    url = f"https://graph.facebook.com/v19.0/{cfg.WHATSAPP_PHONE_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": body.numero,
        "type": "text",
        "text": {"body": body.mensaje or "✅ BI Ventas — prueba de WhatsApp."},
    }
    headers = {"Authorization": f"Bearer {cfg.WHATSAPP_TOKEN}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
        return {"status": "ok", "mensaje": f"Mensaje enviado a {body.numero}."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error al enviar WhatsApp: {exc}")
