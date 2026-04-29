"""
GET /api/detail — Detalle transaccional enriquecido con todas las dimensiones.
"""

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/detail", tags=["Detail"])
logger = logging.getLogger(__name__)


@router.get("")
def get_detail(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    sort_by: str = Query("date_desc"),
):
    cfg = get_settings()
    order_map = {
        "date_desc":   "fv.FECHA_FACTURA DESC",
        "date_asc":    "fv.FECHA_FACTURA ASC",
        "amount_desc": "fv.VENTAS_NETAS DESC",
        "amount_asc":  "fv.VENTAS_NETAS ASC",
    }
    order_clause = order_map.get(sort_by, "fv.FECHA_FACTURA DESC")
    offset = (page - 1) * page_size

    joins = [
        f"LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE",
        f"LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR",
        f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY",
        f"LEFT JOIN {cfg.TM('DIM_TERRITORIO')} dter ON dd.TERRITORIYID = dter.ID_TERRITORIO",
        f"LEFT JOIN {cfg.TM('DIM_PARTE')} dp ON fv.NUMERO_PARTE = dp.NUMERO_PARTE",
        f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO",
        f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO",
    ]

    cond: list[str] = ["fv.ANO_FISCAL = %s"]
    params: list = [ano]

    if mes:
        cond.append("fv.PERIODO_FISCAL = %s"); params.append(mes)
    if region:
        cond.append("dter.DESCRIPCION_REGION = %s"); params.append(region)
    if vendedor:
        cond.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)
    if grupo_comercial:
        cond.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
    if planta:
        cond.append("dgp.PLANTA = %s"); params.append(planta)

    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(cond)

    count_sql = f"SELECT COUNT(*) AS total FROM {cfg.T('FACT_VENTAS')} fv {join_str} {where_str}"
    data_sql  = f"""
        SELECT
            fv.FECHA_FACTURA,
            fv.NUMERO_FACTURA,
            fv.NUMERO_LEGAL,
            dc.NOMBRE                AS CLIENTE,
            dc.TIPO_CLIENTE,
            dv.NOMBRE                AS VENDEDOR,
            dter.DESCRIPCION_REGION  AS REGION,
            dp.DESCRIPCION           AS PRODUCTO,
            dp.NUMERO_PARTE,
            dgp.PLANTA,
            dgc.NOMBRE_GRUPO         AS GRUPO_COMERCIAL,
            fv.VENTAS_NETAS,
            fv.VENTAS_DOLARES,
            fv.CANTIDAD,
            fv.UNIDAD_MEDIDA_VENTA
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        ORDER BY {order_clause}
        LIMIT {page_size} OFFSET {offset}
    """

    try:
        total_df = connector.query(count_sql, params)
        data_df  = connector.query(data_sql,  params)
    except Exception as exc:
        logger.error("Detail error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    total = int(total_df.iloc[0, 0]) if not total_df.empty else 0
    return {
        "pagination": {"page": page, "page_size": page_size,
                       "total": total, "total_pages": -(-total // page_size)},
        "data": data_df.to_dict(orient="records"),
    }
