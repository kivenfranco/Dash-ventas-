"""
GET /api/anomalias-auto — Detector estadístico de anomalías en ventas (z-score).
Compara el mes actual con el histórico de 24 meses y detecta picos/caídas.
"""
import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/anomalias-auto", tags=["AnomalíasAuto"])
logger = logging.getLogger(__name__)

_VALID_GROUPS = "^(linea_negocio|vendedor|estructura|tipo_producto)$"

_DIM_SQL = {
    "linea_negocio": ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",
                      "LEFT JOIN {dgp} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"),
    "vendedor":      ("COALESCE(fv.CODIGO_VENDEDOR, 'Sin Vendedor')", ""),
    "estructura":    ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",
                      "LEFT JOIN {dgp} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"),
    "tipo_producto": ("COALESCE(dgp.LINEA_NEGOCIO, 'Sin Clasificar')",
                      "LEFT JOIN {dgp} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"),
}


def _sanitize(obj):
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


@router.get("")
def get_anomalias(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    group_by: str = Query("linea_negocio", pattern=_VALID_GROUPS),
    umbral_z: float = Query(1.5, ge=0.5, le=3.0),
):
    cfg = get_settings()
    today = date.today()
    mes_actual = mes or today.month

    key = f"anom:{ano}:{mes_actual}:{group_by}:{umbral_z}"
    if (hit := cache.get(key)):
        return hit

    dim_col, join_tmpl = _DIM_SQL[group_by]
    joins = join_tmpl.format(
        dgp=cfg.TM("DIM_GRUPO_PRODUCTO"),
    )

    anos = [ano - 1, ano]
    ano_placeholders = ", ".join(["%s"] * len(anos))
    params: list = anos + [mes_actual]

    sql = f"""
        SELECT
            {dim_col}                              AS dimension,
            fv.ANO_FISCAL                          AS ano,
            fv.PERIODO_FISCAL                      AS mes,
            COALESCE(SUM(fv.VENTAS_NETAS), 0)       AS ventas_netas
        FROM {cfg.T('FACT_VENTAS')} fv
        {joins}
        WHERE fv.ANO_FISCAL IN ({ano_placeholders})
          AND NOT (fv.ANO_FISCAL = {ano} AND fv.PERIODO_FISCAL > %s)
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
    """

    try:
        df = connector.query(sql, params)
        df.columns = [c.lower() for c in df.columns]
    except Exception as exc:
        logger.error("Anomalias auto error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df["ventas_netas"] = pd.to_numeric(df["ventas_netas"], errors="coerce").fillna(0)
    df["mes_key"] = df["ano"].astype(str) + "-" + df["mes"].astype(str).str.zfill(2)

    results = []
    for dim, grp in df.groupby("dimension"):
        grp = grp.sort_values(["ano", "mes"])
        hist = grp[~((grp["ano"] == ano) & (grp["mes"] == mes_actual))]
        cur  = grp[(grp["ano"] == ano) & (grp["mes"] == mes_actual)]

        if len(hist) < 4 or cur.empty:
            continue

        vals   = hist["ventas_netas"].values.astype(float)
        media  = float(np.mean(vals))
        std    = float(np.std(vals))
        v_cur  = float(cur["ventas_netas"].iloc[0])

        z = (v_cur - media) / std if std > 0 else 0.0

        if abs(z) < umbral_z:
            continue

        tipo = "pico" if z > 0 else "caida"
        var_pct = round((v_cur / media - 1) * 100, 2) if media > 0 else None

        historico = [
            {"periodo": r["mes_key"], "ano": int(r["ano"]), "mes": int(r["mes"]), "ventas_netas": round(float(r["ventas_netas"]), 2)}
            for _, r in grp.iterrows()
        ]

        results.append({
            "dimension":        str(dim),
            "mes_actual":       round(v_cur, 2),
            "media_historica":  round(media, 2),
            "std_historica":    round(std, 2),
            "z_score":          round(z, 2),
            "tipo_anomalia":    tipo,
            "variacion_pct":    var_pct,
            "historico":        historico,
        })

    results.sort(key=lambda x: -abs(x["z_score"]))
    result = _sanitize({"ano": ano, "mes": mes_actual, "group_by": group_by, "umbral_z": umbral_z, "data": results})
    cache.set(key, result)
    return result
