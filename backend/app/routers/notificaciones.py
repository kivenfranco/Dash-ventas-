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
        SELECT fv.CODIGO_VENDEDOR,
               MAX(dv.NOMBRE) AS nombre,
               SUM(fv.VENTAS_NETAS) AS ventas_totales,
               FIRST_VALUE(dd.DESCRIPCION_REGION) OVER (
                   PARTITION BY fv.CODIGO_VENDEDOR
                   ORDER BY COUNT(*) OVER (PARTITION BY fv.CODIGO_VENDEDOR, dd.DESCRIPCION_REGION) DESC
               ) AS region_principal
        FROM {cfg.T('FACT_VENTAS')} fv
        LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
        LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY
        WHERE fv.ANO_FISCAL = {ano}
          AND UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%'
          AND UPPER(fv.CODIGO_VENDEDOR) != 'PBOGOTA'
          AND dd.DESCRIPCION_REGION IS NOT NULL
        GROUP BY fv.CODIGO_VENDEDOR
        QUALIFY ROW_NUMBER() OVER (PARTITION BY fv.CODIGO_VENDEDOR ORDER BY COUNT(*) OVER (PARTITION BY fv.CODIGO_VENDEDOR, dd.DESCRIPCION_REGION) DESC) = 1
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
        "smtp_host":      cfg.SMTP_HOST,
        "smtp_port":      cfg.SMTP_PORT,
        "smtp_user":      cfg.SMTP_USER,
        "smtp_from_name": cfg.SMTP_FROM_NAME,
        "alertas_enabled": cfg.ALERTAS_ENABLED,
        "smtp_configurado": bool(cfg.SMTP_USER and cfg.SMTP_PASSWORD),
    }
