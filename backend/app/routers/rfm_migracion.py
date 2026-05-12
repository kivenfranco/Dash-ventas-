"""
GET /api/rfm-migracion — Análisis de migración de segmentos RFM entre períodos.

Calcula el segmento RFM de cada cliente en el período actual (ano, mes)
y en el mismo período del año anterior (ano-1, mes), luego construye la
matriz de transición entre segmentos.

Scoring: NTILE(5) en SQL para R, F, M dentro de cada período.
  R: recencia    — 5-NTILE(5 ORDER BY MAX(PERIODO_FISCAL))  → menor recencia gap = score alto
  F: frecuencia  — NTILE(5) ORDER BY COUNT(DISTINCT PERIODO_FISCAL)
  M: monetario   — NTILE(5) ORDER BY SUM(VENTAS_NETAS)

Segmentos (8): Campeón, Cliente Leal, Potencial Leal, Cliente Reciente,
               En Riesgo, Necesita Atención, Hibernando, Perdido
"""

import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/rfm-migracion", tags=["RFM Migración"])
logger = logging.getLogger(__name__)

# Canonical segment order (best → worst)
_SEGMENT_ORDER = [
    "Campeón",
    "Cliente Leal",
    "Potencial Leal",
    "Cliente Reciente",
    "En Riesgo",
    "Necesita Atención",
    "Hibernando",
    "Perdido",
]

_SEGMENT_RANK = {s: i for i, s in enumerate(_SEGMENT_ORDER)}

# Special synthetic segments used only in migration context
_NUEVO            = "Nuevo"
_PERDIDO_INACTIVO = "Perdido (Inactivo)"


def _segmento(r: int, f: int, m: int) -> str:
    """Map (score_r, score_f, score_m) ∈ [1,5]³ to a named segment."""
    if r >= 4 and f >= 4 and m >= 4:
        return "Campeón"
    if f >= 4 and m >= 4:
        return "Cliente Leal"
    if r >= 4 and f >= 2:
        return "Potencial Leal"
    if r >= 3 and f >= 1:
        return "Cliente Reciente"
    if r <= 2 and f >= 3:
        return "En Riesgo"
    if r <= 2 and f >= 2:
        return "Necesita Atención"
    if r == 1 and f == 1:
        return "Perdido"
    return "Hibernando"


def _period_rfm_sql(
    cfg,
    ano: int,
    mes: Optional[int],
    excl_pvta: bool,
    top_n: int,
    joins: list,
    where_clause: str,
) -> str:
    """
    Return a SQL CTE fragment that computes RFM scores for all clients
    within the given period using SQL-level NTILE(5).
    """
    # ref_mes is the ceiling month used to compute recency gap
    ref_mes = mes if mes else (date.today().month if ano == date.today().year else 12)

    join_str = "\n".join(joins)

    sql = f"""
        WITH base_{ano} AS (
            SELECT
                fv.NUMERO_CLIENTE,
                COALESCE(SUM(fv.VENTAS_NETAS), 0)           AS ventas_netas,
                COUNT(DISTINCT fv.PERIODO_FISCAL)            AS meses_activos,
                MAX(fv.PERIODO_FISCAL)                       AS ultimo_mes,
                {ref_mes} - MAX(fv.PERIODO_FISCAL)           AS recencia_gap
            FROM {cfg.T('FACT_VENTAS')} fv
            {join_str}
            WHERE fv.ANO_FISCAL = {ano}
              AND {where_clause}
            GROUP BY fv.NUMERO_CLIENTE
        ),
        scores_{ano} AS (
            SELECT
                NUMERO_CLIENTE,
                ventas_netas,
                meses_activos,
                ultimo_mes,
                recencia_gap,
                -- R: smaller gap = higher score → invert via (6 - NTILE)
                6 - NTILE(5) OVER (ORDER BY recencia_gap ASC)  AS score_r,
                NTILE(5) OVER (ORDER BY meses_activos ASC)     AS score_f,
                NTILE(5) OVER (ORDER BY ventas_netas ASC)      AS score_m
            FROM base_{ano}
        )
        SELECT
            NUMERO_CLIENTE,
            ventas_netas,
            meses_activos,
            ultimo_mes,
            recencia_gap,
            score_r,
            score_f,
            score_m
        FROM scores_{ano}
        ORDER BY ventas_netas DESC
        LIMIT {top_n}
    """
    return sql


@router.get("")
def get_rfm_migracion(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    excl_pvta: bool = Query(True),
    top_n: int = Query(500, ge=10, le=5000),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    mercado: Optional[str] = None,
    cliente: Optional[str] = None,
    excl_exportacion: bool = False,
):
    cfg = get_settings()
    ano_prev = ano - 1

    # Build filters
    joins = []
    conds = ["1=1"]

    if mes:
        conds.append(f"fv.PERIODO_FISCAL <= {mes}")
    elif ano == date.today().year:
        conds.append(f"fv.PERIODO_FISCAL <= {date.today().month}")

    if excl_pvta:
        conds.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%' OR fv.CODIGO_VENDEDOR IS NULL)")

    if region:
        regs = [r.strip() for r in region.split(",") if r.strip()]
        if regs:
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
            in_vals = ", ".join([f"'{r.upper()}'" for r in regs])
            conds.append(f"UPPER(dd.DESCRIPCION_REGION) IN ({in_vals})")

    if vendedor:
        vends = [v.strip() for v in vendedor.split(",") if v.strip()]
        if vends:
            in_vals = ", ".join([f"'{v}'" for v in vends])
            conds.append(f"fv.CODIGO_VENDEDOR IN ({in_vals})")

    if grupo_comercial or planta:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if grupo_comercial:
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
            gps = [g.strip() for g in grupo_comercial.split(",") if g.strip()]
            in_vals = ", ".join([f"'{g.upper()}'" for g in gps])
            conds.append(f"UPPER(dgc.NOMBRE_GRUPO) IN ({in_vals})")
        if planta:
            pls = [p.strip() for p in planta.split(",") if p.strip()]
            in_vals = ", ".join([f"'{p.upper()}'" for p in pls])
            conds.append(f"UPPER(dgp.LINEA_NEGOCIO) IN ({in_vals})")

    if mercado:
        joins.append(
            f"LEFT JOIN (SELECT VENDEDOR, MERCADO FROM "
            f"(SELECT VENDEDOR, MERCADO, ROW_NUMBER() OVER (PARTITION BY VENDEDOR ORDER BY ANO DESC, MES_NUM DESC) AS rn "
            f"FROM {cfg.T('PP_VENDEDOR_VALOR')}) t WHERE t.rn = 1) vm ON fv.CODIGO_VENDEDOR = vm.VENDEDOR"
        )
        mers = [m.strip() for m in mercado.split(",") if m.strip()]
        in_vals = ", ".join([f"'{m}'" for m in mers])
        conds.append(f"vm.MERCADO IN ({in_vals})")

    if cliente:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc_filt ON fv.NUMERO_CLIENTE = dc_filt.NUMERO_CLIENTE")
        conds.append(f"UPPER(dc_filt.NOMBRE) LIKE UPPER('%{cliente}%')")

    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        conds.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%EXPORTACION%' OR dd.DESCRIPCION_REGION IS NULL)")

    where_clause = " AND ".join(conds)

    cache_key = f"rfm_migracion:{ano}:{mes}:{excl_pvta}:{top_n}:{where_clause}"
    if (hit := cache.get(cache_key)):
        return hit

    sql_cur  = _period_rfm_sql(cfg, ano,      mes, excl_pvta, top_n, joins, where_clause)
    sql_prev = _period_rfm_sql(cfg, ano_prev, mes, excl_pvta, top_n, joins, where_clause)

    # Also fetch client names for top_caidas / top_mejoras
    sql_names = f"""
        SELECT NUMERO_CLIENTE, NOMBRE AS nombre_cliente
        FROM {cfg.TM('DIM_CLIENTE')}
        LIMIT 50000
    """

    try:
        df_cur   = connector.query(sql_cur)
        df_prev  = connector.query(sql_prev)
        df_names = connector.query(sql_names)
    except Exception as exc:
        logger.error("RFM migración query error: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))

    # Normalize columns
    df_cur.columns   = [c.lower() for c in df_cur.columns]
    df_prev.columns  = [c.lower() for c in df_prev.columns]
    df_names.columns = [c.lower() for c in df_names.columns]

    # Compute segment labels
    def assign_segments(df: pd.DataFrame, suffix: str) -> pd.DataFrame:
        if df.empty:
            return df
        for col in ("ventas_netas", "meses_activos", "score_r", "score_f", "score_m"):
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        df[f"segmento_{suffix}"] = df.apply(
            lambda r: _segmento(int(r["score_r"]), int(r["score_f"]), int(r["score_m"])),
            axis=1,
        )
        return df

    df_cur  = assign_segments(df_cur.copy(),  "actual")
    df_prev = assign_segments(df_prev.copy(), "prev")

    # Build name lookup
    name_map: dict = {}
    for _, row in df_names.iterrows():
        k = str(row.get("numero_cliente") or "").strip()
        if k:
            name_map[k] = str(row.get("nombre_cliente") or k)

    # ── Full outer join on NUMERO_CLIENTE ─────────────────────────────────────
    if df_cur.empty and df_prev.empty:
        empty_result = {
            "ano": ano, "ano_prev": ano_prev,
            "matriz": [],
            "resumen": {
                "total_clientes_cur": 0, "total_clientes_prev": 0,
                "nuevos": 0, "recuperados": 0, "perdidos": 0,
                "sin_cambio": 0, "mejoraron": 0, "empeoraron": 0,
            },
            "top_caidas": [],
            "top_mejoras": [],
        }
        cache.set(cache_key, empty_result)
        return empty_result

    # Select only needed columns before merge to avoid clashes
    cols_cur  = ["numero_cliente", "ventas_netas", "segmento_actual"]
    cols_prev = ["numero_cliente", "ventas_netas", "segmento_prev"]

    left  = df_cur[cols_cur].rename(columns={"ventas_netas": "ventas_cur"})  if not df_cur.empty  else pd.DataFrame(columns=cols_cur).rename(columns={"ventas_netas": "ventas_cur"})
    right = df_prev[cols_prev].rename(columns={"ventas_netas": "ventas_prev"}) if not df_prev.empty else pd.DataFrame(columns=cols_prev).rename(columns={"ventas_netas": "ventas_prev"})

    merged = pd.merge(
        left, right,
        on="numero_cliente",
        how="outer",
    )

    # Fill synthetic segments for clients present in only one period
    merged["segmento_actual"] = merged["segmento_actual"].fillna(_PERDIDO_INACTIVO)
    merged["segmento_prev"]   = merged["segmento_prev"].fillna(_NUEVO)
    merged["ventas_cur"]      = pd.to_numeric(merged["ventas_cur"],  errors="coerce").fillna(0)
    merged["ventas_prev"]     = pd.to_numeric(merged["ventas_prev"], errors="coerce").fillna(0)
    merged["numero_cliente"]  = merged["numero_cliente"].astype(str)

    # ── Transition matrix ─────────────────────────────────────────────────────
    matriz_agg = (
        merged.groupby(["segmento_prev", "segmento_actual"], as_index=False)
        .agg(clientes=("numero_cliente", "count"), ventas_cur=("ventas_cur", "sum"))
    )

    matriz = [
        {
            "segmento_prev":   str(row["segmento_prev"]),
            "segmento_actual": str(row["segmento_actual"]),
            "clientes":        int(row["clientes"]),
            "ventas_cur":      round(float(row["ventas_cur"]), 2),
        }
        for _, row in matriz_agg.iterrows()
    ]

    # Sort matrix by segment order (prev then actual)
    all_segments_ordered = [_NUEVO] + _SEGMENT_ORDER + [_PERDIDO_INACTIVO]
    seg_rank_ext = {s: i for i, s in enumerate(all_segments_ordered)}
    matriz.sort(
        key=lambda x: (
            seg_rank_ext.get(x["segmento_prev"], 99),
            seg_rank_ext.get(x["segmento_actual"], 99),
        )
    )

    # ── Resumen counters ──────────────────────────────────────────────────────
    total_clientes_cur  = int((merged["segmento_actual"] != _PERDIDO_INACTIVO).sum())
    total_clientes_prev = int((merged["segmento_prev"]   != _NUEVO).sum())

    nuevos     = int((merged["segmento_prev"]   == _NUEVO).sum())
    perdidos   = int((merged["segmento_actual"] == _PERDIDO_INACTIVO).sum())

    # Clients in both periods
    both = merged[
        (merged["segmento_prev"]   != _NUEVO) &
        (merged["segmento_actual"] != _PERDIDO_INACTIVO)
    ].copy()

    both["rank_prev"]   = both["segmento_prev"].map(lambda s: _SEGMENT_RANK.get(s, 99))
    both["rank_actual"] = both["segmento_actual"].map(lambda s: _SEGMENT_RANK.get(s, 99))

    sin_cambio  = int((both["rank_prev"] == both["rank_actual"]).sum())
    mejoraron   = int((both["rank_actual"] < both["rank_prev"]).sum())   # lower rank = better
    empeoraron  = int((both["rank_actual"] > both["rank_prev"]).sum())

    # "Recuperados": were in a bad segment (En Riesgo, Necesita Atención, Hibernando, Perdido)
    # and moved to a better one
    bad_segments = {"En Riesgo", "Necesita Atención", "Hibernando", "Perdido"}
    recuperados = int(
        both[
            both["segmento_prev"].isin(bad_segments) &
            (both["rank_actual"] < both["rank_prev"])
        ].shape[0]
    )

    # ── Top caídas / mejoras ──────────────────────────────────────────────────
    both["delta_rank"] = both["rank_actual"] - both["rank_prev"]

    def _build_top(subset: pd.DataFrame, n: int = 10) -> list:
        records = []
        for _, row in subset.head(n).iterrows():
            nc = str(row["numero_cliente"])
            records.append({
                "numero_cliente":  nc,
                "nombre_cliente":  name_map.get(nc, nc),
                "segmento_prev":   row["segmento_prev"],
                "segmento_actual": row["segmento_actual"],
                "ventas_cur":      round(float(row["ventas_cur"]),  2),
                "ventas_prev":     round(float(row["ventas_prev"]), 2),
            })
        return records

    top_caidas  = _build_top(both.sort_values("delta_rank", ascending=False))  # worst drops first
    top_mejoras = _build_top(both.sort_values("delta_rank", ascending=True))   # best gains first

    result = {
        "ano":      ano,
        "ano_prev": ano_prev,
        "mes":      mes,
        "matriz":   matriz,
        "resumen": {
            "total_clientes_cur":  total_clientes_cur,
            "total_clientes_prev": total_clientes_prev,
            "nuevos":              nuevos,
            "recuperados":         recuperados,
            "perdidos":            perdidos,
            "sin_cambio":          sin_cambio,
            "mejoraron":           mejoraron,
            "empeoraron":          empeoraron,
        },
        "top_caidas":  top_caidas,
        "top_mejoras": top_mejoras,
    }

    cache.set(cache_key, result)
    return result
