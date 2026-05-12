"""
GET /api/elasticidad — Modelo de Elasticidad de Precios (Fase 2)
Utiliza regresión log-log (ln(Q) = b0 + b1*ln(P)) con scikit-learn
para determinar la sensibilidad al precio de cada línea o grupo.
"""

import logging
import numpy as np
import pandas as pd
from typing import Optional
from datetime import date
from sklearn.linear_model import LinearRegression

from fastapi import APIRouter, HTTPException, Query
from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/elasticidad", tags=["Machine Learning"])
logger = logging.getLogger(__name__)

@router.get("")
def get_elasticidad(
    ano: int = Query(default_factory=lambda: date.today().year),
    planta: Optional[str] = None,
    region: Optional[str] = None
):
    """
    Calcula la elasticidad precio de la demanda por familia de producto
    usando histórico de 2 años agrupado por mes/semana.
    """
    cfg = get_settings()
    key = f"elasticidad:{ano}:{planta}:{region}"
    if cached := cache.get(key):
        return cached

    joins, conds, params = [], [], []
    
    # Agregamos DIM_GRUPO_PRODUCTO siempre para agrupar por familia
    joins.append(f"JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
    
    if planta:
        conds.append("dgp.LINEA_NEGOCIO = %s")
        params.append(planta)
        
    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        conds.append("dd.DESCRIPCION_REGION = %s")
        params.append(region)

    join_str = " ".join(joins)
    where_str = ("AND " + " AND ".join(conds)) if conds else ""
    
    # Extraemos ventas semanales de los últimos 2 años
    # Filtramos ventas con cantidad > 0 y ventas_netas > 0
    sql = f"""
    SELECT 
        dgp.FAMILIA AS familia,
        DATE_TRUNC('week', fv.FECHA_FACTURA) AS semana,
        SUM(fv.VENTAS_NETAS) AS ventas,
        SUM(fv.CANTIDAD) AS cantidad
    FROM {cfg.T('FACT_VENTAS')} fv
    {join_str}
    WHERE fv.FECHA_FACTURA >= DATEADD('year', -2, CURRENT_DATE())
      AND fv.CANTIDAD > 0 AND fv.VENTAS_NETAS > 0
      {where_str}
    GROUP BY 1, 2
    HAVING SUM(fv.CANTIDAD) > 0
    """

    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Error en elasticidad: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {"data": []}

    # Calculamos precio implícito P = Ventas / Cantidad
    df["precio"] = df["ventas"] / df["cantidad"]

    results = []
    # Agrupamos por familia para calcular la elasticidad
    for familia, group in df.groupby("familia"):
        # Necesitamos al menos 10 puntos de datos (semanas) para una regresión confiable
        if len(group) < 10:
            continue
            
        # Filtramos outliers de precio usando IQR
        Q1 = group["precio"].quantile(0.25)
        Q3 = group["precio"].quantile(0.75)
        IQR = Q3 - Q1
        g_clean = group[(group["precio"] >= Q1 - 1.5*IQR) & (group["precio"] <= Q3 + 1.5*IQR)]
        
        if len(g_clean) < 10:
            continue

        # Log-Log Regression: ln(Q) = b0 + b1*ln(P)
        # b1 es la elasticidad precio de la demanda
        X = np.log(g_clean["precio"].values).reshape(-1, 1)
        y = np.log(g_clean["cantidad"].values)
        
        try:
            model = LinearRegression()
            model.fit(X, y)
            elasticidad = float(model.coef_[0])
            r2 = float(model.score(X, y))
            
            # Clasificación del producto
            if elasticidad < -1.5:
                tipo = "Muy Elástico (Sensible)"
            elif elasticidad < -1.0:
                tipo = "Elástico"
            elif elasticidad < -0.5:
                tipo = "Inelástico"
            else:
                tipo = "Muy Inelástico (Rígido)"
                
            results.append({
                "familia": familia,
                "elasticidad": round(elasticidad, 3),
                "r2_confiabilidad": round(r2, 3),
                "tipo": tipo,
                "volumen_promedio": round(float(g_clean["cantidad"].mean()), 2),
                "precio_promedio": round(float(g_clean["precio"].mean()), 2)
            })
        except Exception:
            continue
            
    # Ordenamos de los más sensibles a los menos sensibles
    results.sort(key=lambda x: x["elasticidad"])
    
    payload = {"ano": ano, "data": results}
    cache.set(key, payload)
    return payload
