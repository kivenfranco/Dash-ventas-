"""
GET /api/estacionalidad — Análisis de estacionalidad de ventas.

Calcula índices de estacionalidad (avg_mes / avg_global) para identificar
meses de alta y baja demanda histórica.
"""
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/estacionalidad", tags=["Estacionalidad"])
logger = logging.getLogger(__name__)

_MES_LABELS = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
               'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']


def _parse_csv(value: Optional[str]) -> list:
    if not value:
        return []
    return [v.strip() for v in value.split(',') if v.strip()]


@router.get("")
def get_estacionalidad(
    ano: int = Query(default_factory=lambda: date.today().year),
    anos_atras: int = Query(4, ge=1, le=10),
    excl_pvta: bool = Query(True),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
):
    cfg = get_settings()
    ano_inicio = ano - anos_atras

    cache_key = f"estacionalidad:{ano}:{anos_atras}:{excl_pvta}:{region}:{vendedor}:{grupo_comercial}:{planta}"
    if (hit := cache.get(cache_key)):
        return hit

    conds: list[str] = [f"fv.ANO_FISCAL BETWEEN {ano_inicio} AND {ano}"]
    params: list = []

    if excl_pvta:
        conds.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    joins: list[str] = []
    reg_list = _parse_csv(region)
    ven_list = _parse_csv(vendedor)
    gc_list  = _parse_csv(grupo_comercial)
    pl_list  = _parse_csv(planta)

    need_domicilio    = bool(reg_list)
    need_grp_producto = bool(gc_list) or bool(pl_list)
    need_grp_comercial = bool(gc_list)

    if need_domicilio:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        ph = ', '.join(['%s'] * len(reg_list))
        conds.append(f"dd.DESCRIPCION_REGION IN ({ph})")
        params.extend(reg_list)

    if need_grp_producto:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")

    if need_grp_comercial:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
        ph = ', '.join(['%s'] * len(gc_list))
        conds.append(f"dgc.NOMBRE_GRUPO IN ({ph})")
        params.extend(gc_list)

    if pl_list:
        ph = ', '.join(['%s'] * len(pl_list))
        conds.append(f"dgp.LINEA_NEGOCIO IN ({ph})")
        params.extend(pl_list)

    if ven_list:
        ph = ', '.join(['%s'] * len(ven_list))
        conds.append(f"fv.CODIGO_VENDEDOR IN ({ph})")
        params.extend(ven_list)

    join_str  = " ".join(joins)
    where_str = "WHERE " + " AND ".join(conds)

    sql = f"""
        SELECT
            fv.ANO_FISCAL     AS ano,
            fv.PERIODO_FISCAL AS mes,
            COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        {where_str}
        GROUP BY fv.ANO_FISCAL, fv.PERIODO_FISCAL
        ORDER BY ano, mes
    """

    try:
        df = connector.query(sql, params if params else None)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Estacionalidad error: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))

    if df.empty:
        return {
            "ano": ano, "ano_inicio": ano_inicio, "anos": [],
            "series": [], "resumen_mes": [], "indices_estacionalidad": [],
            "mejor_mes": None, "peor_mes": None,
        }

    for col in ["ventas"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["ano"] = df["ano"].astype(int)
    df["mes"] = df["mes"].astype(int)

    series = [
        {"ano": int(r["ano"]), "mes": int(r["mes"]), "ventas": round(float(r["ventas"]), 2)}
        for _, r in df.iterrows()
    ]

    # Resumen por mes agregando todos los años
    agg = df.groupby("mes")["ventas"].agg(promedio="mean", maximo="max", minimo="min").reset_index()

    # Mejor año por mes
    best_year_idx = df.loc[df.groupby("mes")["ventas"].idxmax()][["mes", "ano"]].set_index("mes")

    avg_global = float(df["ventas"].mean()) if not df.empty else 1.0

    resumen_mes = []
    indices = []
    for _, row in agg.iterrows():
        m   = int(row["mes"])
        lbl = _MES_LABELS[m] if 1 <= m <= 12 else str(m)
        by  = int(best_year_idx.loc[m, "ano"]) if m in best_year_idx.index else None
        prom = round(float(row["promedio"]), 2)

        resumen_mes.append({
            "mes":       m,
            "label":     lbl,
            "promedio":  prom,
            "max":       round(float(row["maximo"]), 2),
            "min":       round(float(row["minimo"]), 2),
            "mejor_ano": by,
        })
        indices.append({
            "mes":    m,
            "label":  lbl,
            "indice": round(prom / avg_global, 4) if avg_global > 0 else 1.0,
        })

    mejor = max(indices, key=lambda x: x["indice"])
    peor  = min(indices, key=lambda x: x["indice"])

    def _enrich(idx_row):
        rm = next((r for r in resumen_mes if r["mes"] == idx_row["mes"]), {})
        return {**idx_row, "promedio": rm.get("promedio", 0)}

    anos = sorted(int(a) for a in df["ano"].unique())

    result = {
        "ano":                     ano,
        "ano_inicio":              ano_inicio,
        "anos":                    anos,
        "series":                  series,
        "resumen_mes":             resumen_mes,
        "indices_estacionalidad":  indices,
        "mejor_mes":               _enrich(mejor),
        "peor_mes":                _enrich(peor),
    }

    cache.set(cache_key, result)
    return result
