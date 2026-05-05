"""
GET /api/cohort — Análisis de cohortes de retención de clientes.
Para cada mes de primera compra, calcula % de clientes activos en meses posteriores.
"""
import logging
from datetime import date

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/cohort", tags=["Cohort"])
logger = logging.getLogger(__name__)


def _sanitize(obj):
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


@router.get("")
def get_cohort(
    ano_inicio: int = Query(default_factory=lambda: date.today().year - 1),
    meses: int = Query(12, ge=3, le=24),
    excl_pvta: bool = Query(True),
):
    cfg = get_settings()
    key = f"cohort:{ano_inicio}:{meses}:{excl_pvta}"
    if (hit := cache.get(key)):
        return hit

    today = date.today()
    ano_fin = today.year

    pvta_cond = ""
    if excl_pvta:
        pvta_cond = "AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)"

    sql = f"""
        SELECT
            fv.CODIGO_VENDEDOR          AS cliente,
            fv.ANO_FISCAL               AS ano,
            fv.PERIODO_FISCAL           AS mes,
            SUM(fv.VENTAS_NETAS)        AS ventas
        FROM {cfg.T('FACT_VENTAS')} fv
        WHERE fv.ANO_FISCAL IN ({ano_inicio}, {ano_fin})
          AND NOT (fv.ANO_FISCAL = {ano_fin} AND fv.PERIODO_FISCAL > {today.month})
          {pvta_cond}
        GROUP BY 1, 2, 3
        HAVING ventas > 0
    """

    try:
        df = connector.query(sql, [])
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Cohort error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df["ano"]     = pd.to_numeric(df["ano"],  errors="coerce")
    df["mes"]     = pd.to_numeric(df["mes"],  errors="coerce")
    df["mes_abs"] = df["ano"] * 12 + df["mes"]

    # Primera compra por cliente
    first = df.groupby("cliente")["mes_abs"].min().reset_index()
    first.columns = ["cliente", "cohort_mes_abs"]

    df = df.merge(first, on="cliente")
    df["offset"] = df["mes_abs"] - df["cohort_mes_abs"]
    df = df[df["offset"].between(0, meses)]

    # Nombre del cohort
    def _periodo(mes_abs):
        a = int(mes_abs) // 12
        m = int(mes_abs) % 12
        if m == 0:
            m = 12; a -= 1
        return a, m

    cohort_groups = df.groupby("cohort_mes_abs")
    cohorts = []
    for cohort_abs, grp in sorted(cohort_groups):
        ano_c, mes_c = _periodo(cohort_abs)
        n_inicial = grp[grp["offset"] == 0]["cliente"].nunique()
        if n_inicial == 0:
            continue

        retention = []
        for offset in range(meses + 1):
            activos = grp[grp["offset"] == offset]["cliente"].nunique()
            retention.append({
                "offset_mes":    offset,
                "n_activos":     int(activos),
                "pct_retencion": round(activos / n_inicial * 100, 1),
            })

        cohorts.append({
            "cohort_periodo":   f"{ano_c}-{mes_c:02d}",
            "cohort_ano":       ano_c,
            "cohort_mes":       mes_c,
            "n_clientes_inicial": int(n_inicial),
            "retention":        retention,
        })

    result = _sanitize({"ano_inicio": ano_inicio, "meses": meses, "cohorts": cohorts[-12:]})
    cache.set(key, result)
    return result
