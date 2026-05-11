"""
GET /api/pvta-presupuesto — Presupuesto mensual de valor y cantidad para los
vendedores PVTA (PVTAMEDE, PVTAEJE, PVTACALI, PVTANORT), extraído del archivo
"PP Completo.xlsx" ubicado en la raíz del repositorio.

Estructura del Excel (Hoja1):
  Col 7   → Vendedor (código)
  Col 10-21 → Valor mensual ene-dic  (índices base-0)
  Col 23-34 → Cantidad mensual ene-dic
"""

import logging
from collections import defaultdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/pvta-presupuesto", tags=["PVTA Presupuesto"])
logger = logging.getLogger(__name__)

_PVTA_CODES = {"PVTACALI", "PVTAEJE", "PVTAMEDE", "PVTANORT"}

# Ruta al Excel — relativa a la raíz del repositorio
_EXCEL_PATH = Path(__file__).parent.parent.parent.parent / "PP Completo.xlsx"

# Cache en memoria: {ano: {"valor": {code: {mes: float}}, "cantidad": {code: {mes: float}}}}
_CACHE: dict = {}


def _load_excel(ano: int) -> dict:
    if ano in _CACHE:
        return _CACHE[ano]

    if not _EXCEL_PATH.exists():
        logger.warning("PP Completo.xlsx no encontrado en %s", _EXCEL_PATH)
        _CACHE[ano] = {}
        return {}

    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(_EXCEL_PATH), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception as exc:
        logger.error("Error leyendo PP Completo.xlsx: %s", exc)
        _CACHE[ano] = {}
        return {}

    valor    = defaultdict(lambda: defaultdict(float))
    cantidad = defaultdict(lambda: defaultdict(float))

    for row in rows[1:]:  # omitir encabezado
        code = str(row[7] or "").strip()
        if code not in _PVTA_CODES:
            continue
        for m in range(1, 13):
            val = float(row[9 + m] or 0)   # cols 10-21 → valor mensual
            qty = float(row[22 + m] or 0)  # cols 23-34 → cantidad mensual
            valor[code][m]    += val
            cantidad[code][m] += qty

    result = {
        "valor":    {c: dict(d) for c, d in valor.items()},
        "cantidad": {c: dict(d) for c, d in cantidad.items()},
    }
    _CACHE[ano] = result
    return result


@router.get("")
def get_pvta_presupuesto(
    ano: int = Query(2026),
    mes: Optional[int] = Query(None, ge=1, le=12),
):
    """
    Devuelve el presupuesto de valor y cantidad por vendedor PVTA para el año
    y mes indicados. Si mes=None se devuelve el acumulado anual.
    Solo disponible para el año 2026 (origen: PP Completo.xlsx).
    """
    data = _load_excel(ano)
    if not data:
        # Devuelve ceros en lugar de 503 para no romper la UI
        return {
            "ano": ano, "mes": mes,
            "data": [
                {"dimension": c, "presupuesto": 0.0, "presupuesto_cantidad": 0.0}
                for c in sorted(_PVTA_CODES)
            ],
        }

    records = []
    for code in sorted(_PVTA_CODES):
        if mes:
            v = data["valor"].get(code, {}).get(mes, 0.0)
            q = data["cantidad"].get(code, {}).get(mes, 0.0)
        else:
            v = sum(data["valor"].get(code, {}).values())
            q = sum(data["cantidad"].get(code, {}).values())
        records.append({
            "dimension":             code,
            "presupuesto":           round(v, 2),
            "presupuesto_cantidad":  round(q, 2),
        })

    return {"ano": ano, "mes": mes, "data": records}
