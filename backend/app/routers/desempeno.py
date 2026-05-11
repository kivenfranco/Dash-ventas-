"""
GET /api/desempeno — Ficha de desempeño integral para una dimensión específica.
Soporta: vendedor, region, cliente, grupo_comercial.
Devuelve KPIs, tendencia 24 meses, top clientes, top grupos y alertas.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/desempeno", tags=["Desempeno"])
logger = logging.getLogger(__name__)

_VALID_DIMS = "^(vendedor|region|cliente|grupo_comercial)$"


def _sanitize(obj):
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


@router.get("")
def get_desempeno(
    dimension_type: str = Query(..., pattern=_VALID_DIMS),
    dimension_value: str = Query(...),
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
):
    cfg = get_settings()
    key = f"desempeno:{dimension_type}:{dimension_value}:{ano}:{mes}"
    cached = cache.get(key)
    if cached:
        return cached

    # ── Base WHERE conditions (integers safe in f-strings) ────────────────────
    base_cond = f"fv.ANO_FISCAL = {ano}"
    mes_cond = f" AND fv.PERIODO_FISCAL = {mes}" if mes else ""

    # ── Dimension-specific JOIN and filter ────────────────────────────────────
    # Note: DIM_GRUPO_PRODUCTO (dgp) and DIM_GRUPO_COMERCIAL (dgc) are always
    # joined for top-groups queries. For grupo_comercial dimension, these same
    # aliases are reused for the filter — no duplicate join needed.
    joins_dim = ""
    dim_filter = ""
    dim_search_param = dimension_value  # may be modified for name-based client search

    if dimension_type == "vendedor":
        joins_dim = ""
        dim_filter = "AND fv.CODIGO_VENDEDOR = %s"

    elif dimension_type == "region":
        joins_dim = (
            f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd"
            f"  ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
        )
        dim_filter = "AND dd.DESCRIPCION_REGION = %s"

    elif dimension_type == "cliente":
        joins_dim = ""
        try:
            int(dimension_value)
            dim_filter = "AND fv.NUMERO_CLIENTE = %s"
        except ValueError:
            # Non-numeric value: search by client name using a subquery
            dim_filter = (
                f"AND fv.NUMERO_CLIENTE IN ("
                f"SELECT NUMERO_CLIENTE FROM {cfg.TM('DIM_CLIENTE')} "
                f"WHERE UPPER(NOMBRE) LIKE UPPER(%s))"
            )
            dim_search_param = f"%{dimension_value}%"

    elif dimension_type == "grupo_comercial":
        # dgp / dgc joins are shared with the always-on joins below
        joins_dim = ""
        dim_filter = "AND dgc.NOMBRE_GRUPO = %s"

    # Always-on joins for top_grupos (use same dgp/dgc aliases)
    joins_groups = (
        f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp"
        f"  ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"
        f" LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc"
        f"  ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO"
    )

    # For region, DIM_DOMICILIO is already in joins_dim; avoid duplicate
    # For all other dims, joins_dim is separate from joins_groups
    if dimension_type == "region":
        # joins_dim has DIM_DOMICILIO; joins_groups has dgp/dgc
        all_joins = f"{joins_dim} {joins_groups}"
    else:
        # joins_dim is empty (vendedor, cliente) or empty (grupo_comercial uses dgp/dgc from joins_groups)
        all_joins = f"{joins_dim} {joins_groups}"

    params = [dim_search_param]

    try:
        # ── KPI current year ─────────────────────────────────────────────────
        sql_kpi = f"""
            SELECT
                COALESCE(SUM(fv.VENTAS_NETAS), 0)        AS ventas_netas,
                COUNT(DISTINCT fv.NUMERO_CLIENTE)         AS num_clientes,
                COUNT(DISTINCT fv.CODIGO_PRODUCTO)        AS num_productos,
                COUNT(DISTINCT fv.PERIODO_FISCAL)         AS meses_activos
            FROM {cfg.T('FACT_VENTAS')} fv
            {all_joins}
            WHERE {base_cond}{mes_cond}
              {dim_filter}
        """
        df_kpi = connector.query(sql_kpi, params)
        df_kpi.columns = [c.lower() for c in df_kpi.columns]

        if df_kpi.empty:
            ventas_netas = 0.0
            num_clientes = 0
            num_productos = 0
            meses_activos = 0
        else:
            r = df_kpi.iloc[0]
            ventas_netas  = float(r.get("ventas_netas")  or 0)
            num_clientes  = int(r.get("num_clientes")    or 0)
            num_productos = int(r.get("num_productos")   or 0)
            meses_activos = int(r.get("meses_activos")   or 0)

        # ── KPI prior year (YoY) ─────────────────────────────────────────────
        base_cond_ant = f"fv.ANO_FISCAL = {ano - 1}"
        sql_ant = f"""
            SELECT
                COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas
            FROM {cfg.T('FACT_VENTAS')} fv
            {all_joins}
            WHERE {base_cond_ant}{mes_cond}
              {dim_filter}
        """
        df_ant = connector.query(sql_ant, params)
        df_ant.columns = [c.lower() for c in df_ant.columns]

        ventas_ant = float(df_ant.iloc[0].get("ventas_netas") or 0) if not df_ant.empty else 0.0

        var_yoy_pct = round((ventas_netas / ventas_ant - 1) * 100, 2) if ventas_ant > 0 else None

        # ── Tendencia 24 meses (ano-1 and ano, without mes filter) ───────────
        # Years are integers → safe in f-string. dimension_value still uses %s.
        sql_tendencia = f"""
            SELECT
                fv.ANO_FISCAL    AS ano,
                fv.PERIODO_FISCAL AS mes,
                COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas
            FROM {cfg.T('FACT_VENTAS')} fv
            {all_joins}
            WHERE fv.ANO_FISCAL IN ({ano - 1}, {ano})
              {dim_filter}
            GROUP BY 1, 2
            ORDER BY 1, 2
        """
        df_tend = connector.query(sql_tendencia, params)
        df_tend.columns = [c.lower() for c in df_tend.columns]

        tendencia = []
        if not df_tend.empty:
            for _, row in df_tend.iterrows():
                periodo = f"{int(row['ano'])}-{str(int(row['mes'])).zfill(2)}"
                tendencia.append({
                    "periodo": periodo,
                    "ventas": round(float(row["ventas"] or 0), 2),
                })

        # ── Top grupos ────────────────────────────────────────────────────────
        sql_top_grupos = f"""
            SELECT
                COALESCE(dgc.NOMBRE_GRUPO, dgp.LINEA_NEGOCIO, fv.CODIGO_PRODUCTO) AS grupo,
                COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas
            FROM {cfg.T('FACT_VENTAS')} fv
            {all_joins}
            WHERE {base_cond}{mes_cond}
              {dim_filter}
            GROUP BY 1
            ORDER BY ventas DESC
            LIMIT 10
        """
        df_grupos = connector.query(sql_top_grupos, params)
        df_grupos.columns = [c.lower() for c in df_grupos.columns]

        top_grupos = []
        if not df_grupos.empty:
            for _, row in df_grupos.iterrows():
                top_grupos.append({
                    "nombre": str(row.get("grupo") or "—"),
                    "ventas": round(float(row.get("ventas") or 0), 2),
                })

        # ── Top clientes (not applicable when dimension_type == 'cliente') ────
        top_clientes = []
        if dimension_type in ("vendedor", "region", "grupo_comercial"):
            sql_top_clientes = f"""
                SELECT
                    fv.NUMERO_CLIENTE,
                    COALESCE(dc.NOMBRE, TO_VARCHAR(fv.NUMERO_CLIENTE)) AS nombre,
                    COALESCE(SUM(fv.VENTAS_NETAS), 0)      AS ventas
                FROM {cfg.T('FACT_VENTAS')} fv
                {all_joins}
                LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
                WHERE {base_cond}{mes_cond}
                  {dim_filter}
                GROUP BY fv.NUMERO_CLIENTE, dc.NOMBRE
                ORDER BY ventas DESC
                LIMIT 10
            """
            df_clientes = connector.query(sql_top_clientes, params)
            df_clientes.columns = [c.lower() for c in df_clientes.columns]

            if not df_clientes.empty:
                for _, row in df_clientes.iterrows():
                    top_clientes.append({
                        "numero": str(row.get("numero_cliente") or "—"),
                        "nombre": str(row.get("nombre") or row.get("numero_cliente") or "—"),
                        "ventas": round(float(row.get("ventas") or 0), 2),
                    })

        # ── Top vendedores (not applicable when dimension_type == 'vendedor') ─
        top_vendedores = []
        if dimension_type in ("region", "cliente", "grupo_comercial"):
            sql_top_vendedores = f"""
                SELECT
                    fv.CODIGO_VENDEDOR,
                    COALESCE(dv.NOMBRE, fv.CODIGO_VENDEDOR) AS nombre,
                    COALESCE(SUM(fv.VENTAS_NETAS), 0)       AS ventas
                FROM {cfg.T('FACT_VENTAS')} fv
                {all_joins}
                LEFT JOIN {cfg.TM('DIM_VENDEDOR')} dv ON fv.CODIGO_VENDEDOR = dv.CODIGO_VENDEDOR
                WHERE {base_cond}{mes_cond}
                  {dim_filter}
                GROUP BY fv.CODIGO_VENDEDOR, dv.NOMBRE
                ORDER BY ventas DESC
                LIMIT 10
            """
            df_vendedores = connector.query(sql_top_vendedores, params)
            df_vendedores.columns = [c.lower() for c in df_vendedores.columns]

            if not df_vendedores.empty:
                for _, row in df_vendedores.iterrows():
                    top_vendedores.append({
                        "codigo": str(row.get("codigo_vendedor") or "—"),
                        "nombre": str(row.get("nombre") or row.get("codigo_vendedor") or "—"),
                        "ventas": round(float(row.get("ventas") or 0), 2),
                    })

        # ── Display label ─────────────────────────────────────────────────────
        dimension_label = dimension_value  # default: use the raw value as label

        if dimension_type == "vendedor":
            sql_label = f"""
                SELECT MAX(dv.NOMBRE) AS label
                FROM {cfg.TM('DIM_VENDEDOR')} dv
                WHERE dv.CODIGO_VENDEDOR = %s
            """
            df_label = connector.query(sql_label, [dimension_value])
            df_label.columns = [c.lower() for c in df_label.columns]
            if not df_label.empty and df_label.iloc[0].get("label"):
                dimension_label = str(df_label.iloc[0]["label"])

        elif dimension_type == "cliente":
            try:
                int(dimension_value)
                sql_label = f"""
                    SELECT MAX(dc.NOMBRE) AS label
                    FROM {cfg.TM('DIM_CLIENTE')} dc
                    WHERE dc.NUMERO_CLIENTE = %s
                """
                df_label = connector.query(sql_label, [dimension_value])
            except ValueError:
                sql_label = f"""
                    SELECT MAX(dc.NOMBRE) AS label
                    FROM {cfg.TM('DIM_CLIENTE')} dc
                    WHERE UPPER(dc.NOMBRE) LIKE UPPER(%s)
                """
                df_label = connector.query(sql_label, [f"%{dimension_value}%"])
            df_label.columns = [c.lower() for c in df_label.columns]
            if not df_label.empty and df_label.iloc[0].get("label"):
                dimension_label = str(df_label.iloc[0]["label"])

        # For region and grupo_comercial, dimension_value IS the label — no query needed.

    except Exception as exc:
        logger.error("Desempeno error [%s=%s]: %s", dimension_type, dimension_value, exc)
        raise HTTPException(status_code=503, detail=str(exc))

    result = {
        "dimension_type":  dimension_type,
        "dimension_value": dimension_value,
        "dimension_label": dimension_label,
        "ano":             ano,
        "mes":             mes,
        "kpis": {
            "ventas_netas":  round(ventas_netas, 2),
            "ventas_ant":    round(ventas_ant, 2),
            "var_yoy_pct":   var_yoy_pct,
            "num_clientes":  num_clientes,
            "num_productos": num_productos,
            "meses_activos": meses_activos,
        },
        "tendencia":       tendencia,
        "top_grupos":      top_grupos,
        "top_clientes":    top_clientes,
        "top_vendedores":  top_vendedores,
    }

    cache.set(key, result)
    return _sanitize(result)
