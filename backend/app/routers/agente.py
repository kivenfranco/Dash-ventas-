"""
POST /api/agente — Agente conversacional BI via Claude (Anthropic).
Recibe preguntas en lenguaje natural, genera SQL y responde con datos de Snowflake.
"""
import json
import logging
import math
from typing import Optional

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/agente", tags=["Agente"])
logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"

SCHEMA_CONTEXT = """Eres un asistente de Business Intelligence para ALICO SAS BIC, empresa industrial colombiana.
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
        "name": "ejecutar_sql",
        "description": "Ejecuta SQL en Snowflake para obtener datos de ventas, clientes, productos, vendedores, regiones y presupuestos.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "Consulta SQL válida para Snowflake GOLD database",
                },
                "descripcion": {
                    "type": "string",
                    "description": "Qué busca esta consulta (1 línea)",
                },
            },
            "required": ["sql", "descripcion"],
        },
    }
]


class MensajeIn(BaseModel):
    pregunta: str
    historial: list[dict] = []
    ano: Optional[int] = None
    mes: Optional[int] = None


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


@router.post("")
async def consultar_agente(body: MensajeIn):
    cfg = get_settings()
    if not cfg.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY no configurada en .env")

    pregunta = body.pregunta
    if body.ano:
        pregunta += f" [Contexto: año {body.ano}"
        if body.mes:
            pregunta += f", mes {body.mes}"
        pregunta += "]"

    messages: list[dict] = []
    for h in body.historial:
        role = h.get("role", "user")
        # Normalize: frontend may send "model" (Gemini legacy) → "assistant"
        if role == "model":
            role = "assistant"
        messages.append({"role": role, "content": h.get("content", "")})
    messages.append({"role": "user", "content": pregunta})

    client = anthropic.AsyncAnthropic(api_key=cfg.ANTHROPIC_API_KEY)

    sql_ejecutado = None
    sql_descripcion = None
    result_data = None

    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SCHEMA_CONTEXT,
            messages=messages,
            tools=TOOLS,
        )
    except anthropic.APIStatusError as exc:
        logger.error("Claude API error %s: %s", exc.status_code, exc.message)
        if exc.status_code == 529:
            raise HTTPException(status_code=429, detail="API de IA sobrecargada. Intenta en un momento.")
        raise HTTPException(status_code=502, detail=f"Error API IA: {exc.message[:300]}")

    # Handle tool use
    if response.stop_reason == "tool_use":
        tool_block = next((b for b in response.content if b.type == "tool_use"), None)

        if tool_block:
            sql_ejecutado = tool_block.input.get("sql", "")
            sql_descripcion = tool_block.input.get("descripcion", "")
            result_data = _execute_sql(sql_ejecutado)

            if result_data["error"]:
                tool_result_content = json.dumps({"error": result_data["error"]})
            else:
                tool_result_content = json.dumps({
                    "columnas": result_data["columns"],
                    "filas": result_data["rows"][:20],
                    "total_filas": result_data["total_rows"],
                })

            # Append assistant turn (with tool_use block) and tool result
            messages.append({"role": "assistant", "content": response.content})
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_block.id,
                    "content": tool_result_content,
                }],
            })

            try:
                response = await client.messages.create(
                    model=MODEL,
                    max_tokens=1024,
                    system=SCHEMA_CONTEXT,
                    messages=messages,
                    tools=TOOLS,
                )
            except anthropic.APIStatusError as exc:
                logger.error("Claude API error (2nd call) %s: %s", exc.status_code, exc.message)
                raise HTTPException(status_code=502, detail=f"Error API IA: {exc.message[:300]}")

    answer = ""
    for block in response.content:
        if hasattr(block, "text"):
            answer += block.text
    answer = answer.strip()

    if not answer:
        answer = "No pude generar una respuesta. Intenta reformular la pregunta."

    usage = None
    if response.usage:
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }

    return {
        "respuesta": answer,
        "sql": sql_ejecutado,
        "sql_descripcion": sql_descripcion,
        "datos": result_data,
        "uso": usage,
    }
