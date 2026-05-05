"""
GET    /api/factores-com         — Lista factores de conversión m→metro por producto.
POST   /api/factores-com         — Guarda o actualiza un factor para un producto.
DELETE /api/factores-com/{code}  — Elimina un factor.

Estos factores se aplican en Comercialización cuando la UOM del producto
no tiene conversión estándar (TB, KG, UND, etc.).
"""
import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/factores-com", tags=["FactoresCom"])
logger = logging.getLogger(__name__)

_DATA_FILE = Path(__file__).parent.parent / "data" / "factores_com.json"


def load_factores() -> dict:
    if _DATA_FILE.exists():
        try:
            return json.loads(_DATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save(data: dict):
    _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    _DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class FactorBody(BaseModel):
    codigo_producto: str
    descripcion: str = ""
    uom: str = ""
    factor: float


@router.get("")
def get_factores():
    return {"factores": load_factores()}


@router.post("")
def save_factor(body: FactorBody):
    if body.factor <= 0:
        raise HTTPException(status_code=422, detail="El factor debe ser mayor a 0")
    data = load_factores()
    data[body.codigo_producto] = {
        "descripcion": body.descripcion,
        "uom":         body.uom,
        "factor":      body.factor,
    }
    _save(data)
    return {"ok": True, "total": len(data)}


@router.delete("/{codigo}")
def delete_factor(codigo: str):
    data = load_factores()
    data.pop(codigo, None)
    _save(data)
    return {"ok": True, "total": len(data)}
