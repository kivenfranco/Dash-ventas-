"""
POST /api/agente — Agente conversacional BI via Google Gemini.
Recibe preguntas en lenguaje natural, genera SQL y responde con datos de Snowflake.
"""
import json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/agente", tags=["Agente"])
logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

SCHEMA_CONTEXT = """Eres un asistente de Business Intelligence para ALICO S.A., empresa industrial colombiana.
Analizas datos de ventas en Snowflake y respondes preguntas en español, de forma clara y directa.

## Esquema (base de datos: GOLD)

### GOLD.VENTAS.FACT_VENTAS — tabla de hechos principal
- ANO_FISCAL (NUMBER): año fiscal (ej: 2024, 2025)
- PERIODO_FISCAL (NUMBER): mes 1-12
- CODIGO_VENDEDOR (VARCHAR): código vendedor
- DOMICILIO_KEY (NUMBER): FK → DIM_DOMICILIO
- CODIGO_PRODUCTO (VARCHAR): FK → DIM_PARTE y DIM_GRUPO_PRODUCTO
- CODIGO_CLIENTE (VARCHAR): FK → DIM_CLIENTE
- VENTAS_NETAS (FLOAT): ventas en COP
- VENTAS_DOLARES (FLOAT): ventas en USD
- CANTIDAD (FLOAT): unidades

### GOLD.MAESTROS.DIM_DOMICILIO
- DOMICILIO_KEY, DESCRIPCION_REGION, CIUDAD, DEPARTAMENTO

### GOLD.MAESTROS.DIM_VENDEDOR
- CODIGO_VENDEDOR (PK), NOMBRE

### GOLD.MAESTROS.DIM_CLIENTE
- CODIGO_CLIENTE (PK), NOMBRE_CLIENTE, TIPO_CLIENTE, ESTADO

### GOLD.MAESTROS.DIM_PARTE — atributos del producto
- CODIGO_PRODUCTO (PK), DESCRIPCION, ES_STOCK (BOOLEAN),
  ESTRUCTURA, DISPOSITIVO, TIPO_PRODUCTO, TIPO_FABRICACION

### GOLD.MAESTROS.DIM_GRUPO_PRODUCTO
- CODIGO_PRODUCTO (PK), PLANTA, CODIGO_GRUPO_COMERCIAL, LINEA_NEGOCIO

### GOLD.MAESTROS.DIM_GRUPO_COMERCIAL
- CODIGO_GRUPO (PK), NOMBRE_GRUPO, TIPO_FABRICACION

### GOLD.VENTAS.PP_REGION_PLANTA_GRUPO — presupuesto por región
- ANO, MES_NUM, REGION, PLANTA, GRUPO_COMERCIAL, PP_VALOR_MES (presupuesto COP), PP_CANTIDAD_MES

### GOLD.VENTAS.PP_VENDEDOR_VALOR — presupuesto valor por vendedor
- ANO, MES_NUM, VENDEDOR, REGION, PLANTA, GRUPO_COMERCIAL, PP_VALOR_MES

### GOLD.VENTAS.PP_VENDEDOR_CANTIDAD — presupuesto cantidad por vendedor
- ANO, MES_NUM, VENDEDOR, PP_CANTIDAD_MES

## Reglas SQL (Snowflake)
1. Usa UPPER() para comparar texto: UPPER(col) = 'VALOR'
2. Exportaciones: UPPER(dd.DESCRIPCION_REGION) LIKE '%EXPORTACION%'
3. Vendedores PVTA (punto de venta): UPPER(CODIGO_VENDEDOR) LIKE 'PVTA%'
4. Boolean: CASE WHEN dp.ES_STOCK THEN 'Stock' ELSE 'No Stock' END
5. Limita con LIMIT 50 máximo
6. Año actual: 2025. Año anterior: 2024
7. Siempre usa alias de tabla para evitar ambigüedades
8. YoY: (actual/anterior - 1) * 100

Responde SIEMPRE en español. Sé conciso y útil."""

TOOLS = [
    {
        "function_declarations": [
            {
                "name": "ejecutar_sql",
                "description": "Ejecuta SQL en Snowflake para obtener datos de ventas, clientes, productos, vendedores, regiones y presupuestos.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "sql": {
                            "type": "STRING",
                            "description": "Consulta SQL válida para Snowflake GOLD database",
                        },
                        "descripcion": {
                            "type": "STRING",
                            "description": "Qué busca esta consulta (1 línea)",
                        },
                    },
                    "required": ["sql", "descripcion"],
                },
            }
        ]
    }
]


class MensajeIn(BaseModel):
    pregunta: str
    historial: list[dict] = []
    ano: Optional[int] = None
    mes: Optional[int] = None


async def _call_gemini(contents: list[dict], api_key: str, max_tokens: int = 2048) -> dict:
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            f"{GEMINI_URL}?key={api_key}",
            json={
                "system_instruction": {"parts": [{"text": SCHEMA_CONTEXT}]},
                "contents": contents,
                "tools": TOOLS,
                "tool_config": {"function_calling_config": {"mode": "AUTO"}},
                "generation_config": {"max_output_tokens": max_tokens},
            },
        )
        if resp.status_code != 200:
            logger.error("Gemini error %s: %s", resp.status_code, resp.text[:500])
            if resp.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="Cuota de la API de IA agotada. Espera unos minutos e intenta de nuevo.",
                )
            raise HTTPException(status_code=502, detail=f"Error API IA: {resp.text[:300]}")
        return resp.json()


def _execute_sql(sql: str) -> dict:
    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
        total = len(df)
        df = df.head(50)
        rows = []
        for _, row in df.iterrows():
            cleaned = []
            for v in row:
                try:
                    import math
                    if isinstance(v, float) and math.isnan(v):
                        cleaned.append(None)
                    else:
                        cleaned.append(v)
                except Exception:
                    cleaned.append(str(v) if v is not None else None)
            rows.append(cleaned)
        return {
            "columns": list(df.columns),
            "rows": rows,
            "total_rows": total,
            "error": None,
        }
    except Exception as exc:
        logger.error("SQL error: %s | SQL: %.200s", exc, sql)
        return {"columns": [], "rows": [], "total_rows": 0, "error": str(exc)}


def _extract_text(parts: list) -> str:
    return " ".join(p.get("text", "") for p in parts if "text" in p).strip()


def _extract_fn_call(parts: list) -> Optional[dict]:
    for p in parts:
        if "functionCall" in p:
            return p["functionCall"]
    return None


@router.post("")
async def consultar_agente(body: MensajeIn):
    cfg = get_settings()
    if not cfg.GOOGLE_AI_KEY:
        raise HTTPException(status_code=503, detail="GOOGLE_AI_KEY no configurada en .env")

    pregunta = body.pregunta
    if body.ano:
        pregunta += f" [Contexto: año {body.ano}"
        if body.mes:
            pregunta += f", mes {body.mes}"
        pregunta += "]"

    # Build contents from history + current question
    contents: list[dict] = []
    for h in body.historial:
        role = h.get("role", "user")
        # Map assistant → model for Gemini
        gemini_role = "model" if role == "assistant" else "user"
        contents.append({"role": gemini_role, "parts": [{"text": h.get("content", "")}]})
    contents.append({"role": "user", "parts": [{"text": pregunta}]})

    sql_ejecutado = None
    sql_descripcion = None
    result_data = None

    response = await _call_gemini(contents, cfg.GOOGLE_AI_KEY)

    candidates = response.get("candidates", [])
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini no retornó candidatos")

    candidate = candidates[0]
    resp_parts = candidate.get("content", {}).get("parts", [])
    fn_call = _extract_fn_call(resp_parts)

    if fn_call:
        sql_ejecutado = fn_call.get("args", {}).get("sql", "")
        sql_descripcion = fn_call.get("args", {}).get("descripcion", "")
        result_data = _execute_sql(sql_ejecutado)

        if result_data["error"]:
            fn_response_content = {"error": result_data["error"]}
        else:
            fn_response_content = {
                "columnas": result_data["columns"],
                "filas": result_data["rows"][:20],
                "total_filas": result_data["total_rows"],
            }

        # Add model's function call turn
        contents.append({"role": "model", "parts": [{"functionCall": {"name": fn_call["name"], "args": fn_call.get("args", {})}}]})
        # Add function response turn
        contents.append({
            "role": "user",
            "parts": [{
                "functionResponse": {
                    "name": fn_call["name"],
                    "response": fn_response_content,
                }
            }],
        })

        response = await _call_gemini(contents, cfg.GOOGLE_AI_KEY, max_tokens=1024)
        candidates = response.get("candidates", [])
        if candidates:
            resp_parts = candidates[0].get("content", {}).get("parts", [])

    answer = _extract_text(resp_parts)
    if not answer:
        answer = "No pude generar una respuesta. Intenta reformular la pregunta."

    return {
        "respuesta": answer,
        "sql": sql_ejecutado,
        "sql_descripcion": sql_descripcion,
        "datos": result_data,
        "uso": response.get("usageMetadata"),
    }
