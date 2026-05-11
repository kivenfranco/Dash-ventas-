"""
GET/POST /api/presupuesto-manual — metas de presupuesto ingresadas manualmente desde la UI.
Se almacenan en backend/app/data/presupuesto_manual.json.
Estructura: { "ano_mes": { "global": 0, "por_dimension": {} } }
"""
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/presupuesto-manual", tags=["Presupuesto Manual"])

_DATA_FILE = Path(__file__).parent.parent / "data" / "presupuesto_manual.json"


def _load() -> dict:
    if not _DATA_FILE.exists():
        return {}
    try:
        return json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(data: dict) -> None:
    _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    _DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class MetaEntry(BaseModel):
    ano: int
    mes: Optional[int] = None
    monto: float
    dimension_key: Optional[str] = None
    dimension_valor: Optional[str] = None
    nota: Optional[str] = None


@router.get("")
def get_metas(ano: int, mes: Optional[int] = None):
    data = _load()
    key = f"{ano}-{mes or 'anual'}"
    return {"ano": ano, "mes": mes, "metas": data.get(key, {})}


@router.post("")
def upsert_meta(entry: MetaEntry):
    data = _load()
    key = f"{entry.ano}-{entry.mes or 'anual'}"
    if key not in data:
        data[key] = {"global": None, "por_dimension": {}, "nota": ""}

    if entry.dimension_key and entry.dimension_valor:
        dim_key = f"{entry.dimension_key}:{entry.dimension_valor}"
        data[key]["por_dimension"][dim_key] = entry.monto
    else:
        data[key]["global"] = entry.monto

    if entry.nota:
        data[key]["nota"] = entry.nota

    try:
        _save(data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error guardando meta: {exc}")

    return {"status": "ok", "key": key, "metas": data[key]}


@router.delete("")
def delete_meta(ano: int, mes: Optional[int] = None, dimension_key: Optional[str] = None, dimension_valor: Optional[str] = None):
    data = _load()
    key = f"{ano}-{mes or 'anual'}"
    if key not in data:
        return {"status": "ok", "message": "No existe"}

    if dimension_key and dimension_valor:
        dim_key = f"{dimension_key}:{dimension_valor}"
        data[key]["por_dimension"].pop(dim_key, None)
    else:
        data.pop(key, None)

    _save(data)
    return {"status": "ok"}
