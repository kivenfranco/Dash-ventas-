import logging
from datetime import date
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api", tags=["Clientes Pareto"])
logger = logging.getLogger(__name__)

@router.get("/dimensions")
def get_dimensions(
    group_by: str = Query(..., description="Dimension to group by: 'region' or 'vendedor'")
) -> Dict[str, List[Dict]]:
    """
    Returns a list of available dimensions (regions or vendors) for filtering.
    """
    cfg = get_settings()
    cache_key = f"dimensions:{group_by}"
    cached_data = cache.get(cache_key)
    if cached_data:
        return cached_data

    if group_by == 'region':
        sql = f"""
            SELECT DISTINCT DESCRIPCION_REGION AS id, DESCRIPCION_REGION AS name
            FROM {cfg.TM('DIM_DOMICILIO')}
            WHERE DESCRIPCION_REGION IS NOT NULL
            ORDER BY name
        """
    elif group_by == 'vendedor':
        sql = f"""
            SELECT DISTINCT CODIGO_VENDEDOR AS id, NOMBRE AS name
            FROM {cfg.TM('DIM_VENDEDOR')}
            WHERE NOMBRE IS NOT NULL
            ORDER BY name
        """
    else:
        raise HTTPException(status_code=400, detail="Invalid group_by parameter. Must be 'region' or 'vendedor'.")

    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]
        dimensions = df.to_dict(orient="records")
        result = {"dimensions": dimensions}
        cache.set(cache_key, result)
        return result
    except Exception as exc:
        logger.error(f"Error fetching dimensions for {group_by}: {exc}")
        raise HTTPException(status_code=500, detail=f"Error fetching dimensions: {exc}")


@router.get("/clientes-pareto")
def get_clientes_pareto(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    group_by: str = Query(..., description="Dimension to group by: 'region' or 'vendedor'"),
    dimension: Optional[str] = Query(None, description="Specific dimension value to filter by (e.g., 'CENTRO', 'V001')"),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
    region: Optional[str] = Query(None, description="Global region filter (CSV)"),
    vendedor: Optional[str] = Query(None, description="Global vendedor filter (CSV)"),
):
    """
    Retrieves Pareto analysis data for clients based on selected grouping (region or salesperson).
    """
    cfg = get_settings()
    cache_key = f"clientes_pareto:{ano}:{mes}:{mes_fin}:{group_by}:{dimension}:{excl_exportacion}:{excl_pvta}:{region}:{vendedor}"
    cached_data = cache.get(cache_key)
    if cached_data:
        return cached_data

    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None

    if mes and mes_fin and mes_fin > mes:
        mes_cond = f"fv.PERIODO_FISCAL BETWEEN {mes} AND {mes_fin}"
    elif mes:
        mes_cond = f"fv.PERIODO_FISCAL = {mes}"
    elif ytd_cap:
        mes_cond = f"fv.PERIODO_FISCAL <= {ytd_cap}"
    else:
        mes_cond = "1=1"

    # Base WHERE clauses
    where_clauses = [
        f"fv.ANO_FISCAL = {ano}",
        mes_cond,
        "fv.VENTAS_NETAS > 0"
    ]

    # Add PVTA exclusion
    if excl_pvta:
        where_clauses.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' AND UPPER(fv.CODIGO_VENDEDOR) != 'PBOGOTA' OR fv.CODIGO_VENDEDOR IS NULL)")

    # Add Exportation exclusion + DIM_DOMICILIO join when needed
    join_dim_domicilio = ""
    if excl_exportacion or (group_by == 'region' and dimension) or region:
        join_dim_domicilio = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
        if excl_exportacion:
            where_clauses.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")

    # Add local dimension-specific filter (Pareto's own selector)
    if dimension:
        if group_by == 'region':
            where_clauses.append(f"UPPER(dd.DESCRIPCION_REGION) = UPPER('{dimension}')")
        elif group_by == 'vendedor':
            where_clauses.append(f"UPPER(fv.CODIGO_VENDEDOR) = UPPER('{dimension}')")

    # Apply global region filter (from top-nav global filters, CSV-separated)
    if region:
        region_vals = [r.strip() for r in region.split(',') if r.strip()]
        if len(region_vals) == 1:
            where_clauses.append(f"UPPER(dd.DESCRIPCION_REGION) = UPPER('{region_vals[0]}')")
        elif region_vals:
            region_in = ', '.join(f"UPPER('{r}')" for r in region_vals)
            where_clauses.append(f"UPPER(dd.DESCRIPCION_REGION) IN ({region_in})")

    # Apply global vendedor filter (from top-nav global filters, CSV-separated)
    if vendedor:
        vend_vals = [v.strip() for v in vendedor.split(',') if v.strip()]
        if len(vend_vals) == 1:
            where_clauses.append(f"UPPER(fv.CODIGO_VENDEDOR) = UPPER('{vend_vals[0]}')")
        elif vend_vals:
            vend_in = ', '.join(f"UPPER('{v}')" for v in vend_vals)
            where_clauses.append(f"UPPER(fv.CODIGO_VENDEDOR) IN ({vend_in})")

    where_str = " AND ".join(where_clauses)

    sql = f"""
        WITH ClientSales AS (
            SELECT
                fv.NUMERO_CLIENTE,
                dc.NOMBRE AS NOMBRE_CLIENTE,
                SUM(fv.VENTAS_NETAS) AS VENTAS
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
            {join_dim_domicilio}
            WHERE {where_str}
            GROUP BY 1, 2
            HAVING VENTAS > 0
        ),
        RankedSales AS (
            SELECT
                NUMERO_CLIENTE,
                NOMBRE_CLIENTE,
                VENTAS,
                SUM(VENTAS) OVER (ORDER BY VENTAS DESC) AS CUM_VENTAS,
                SUM(VENTAS) OVER () AS TOTAL_VENTAS,
                ROW_NUMBER() OVER (ORDER BY VENTAS DESC) AS RN
            FROM ClientSales
        )
        SELECT
            NUMERO_CLIENTE,
            NOMBRE_CLIENTE,
            VENTAS,
            CUM_VENTAS,
            TOTAL_VENTAS,
            (VENTAS / TOTAL_VENTAS) * 100 AS PCT_TOTAL,
            (CUM_VENTAS / TOTAL_VENTAS) * 100 AS PCT_ACUMULADO,
            RN
        FROM RankedSales
        ORDER BY RN
    """

    try:
        df = connector.query(sql)
        df.columns = [c.lower() for c in df.columns]

        clients_data = []
        pareto_chart_data = []
        total_sales = 0
        pareto_80_count = 0
        pareto_80_pct_clients = 0

        if not df.empty:
            total_sales = float(df["total_ventas"].iloc[0])
            total_clients_in_scope = len(df)

            for _, row in df.iterrows():
                client = {
                    "numero_cliente": str(row["numero_cliente"]),
                    "nombre": str(row["nombre_cliente"] or row["numero_cliente"]),
                    "ventas": float(row["ventas"]),
                    "pct_total": float(row["pct_total"]),
                    "pct_acumulado": float(row["pct_acumulado"]),
                }
                clients_data.append(client)

                # For Pareto chart
                pct_clients_for_chart = round((row["rn"] / total_clients_in_scope) * 100, 1)
                pareto_chart_data.append({
                    "pct_clientes": pct_clients_for_chart,
                    "pct_ventas": round(float(row["pct_acumulado"]), 1),
                })

                if pareto_80_count == 0 and float(row["pct_acumulado"]) >= 80:
                    pareto_80_count = int(row["rn"])
                    pareto_80_pct_clients = pct_clients_for_chart

        result = {
            "clients": clients_data,
            "pareto_chart_data": pareto_chart_data,
            "total_sales": total_sales,
            "pareto_80_count": pareto_80_count,
            "pareto_80_pct_clients": pareto_80_pct_clients,
        }
        cache.set(cache_key, result)
        return result

    except Exception as exc:
        logger.error(f"Error fetching Pareto data: {exc}")
        raise HTTPException(status_code=500, detail=f"Error fetching Pareto data: {exc}")