"""
GET /api/hallazgos — Auto-computed business insights con impacto económico.
Cada insight incluye impacto_cop (delta absoluto en COP) y peso_pct (% del total).
"""
import logging
import math
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/hallazgos", tags=["Hallazgos"])
logger = logging.getLogger(__name__)


def _safe_pct(a, b):
    try:
        return round((a / b - 1) * 100, 2) if b and b != 0 else None
    except Exception:
        return None


def _pct_label(pct):
    if pct is None:
        return "sin dato"
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.1f}%"


def _cop_label(v):
    """Short COP label: $1.2MM, $450M, $3.2M"""
    if v is None:
        return "—"
    a = abs(v)
    if a >= 1_000_000_000:
        return f"${a/1_000_000_000:.1f}MM"
    if a >= 1_000_000:
        return f"${a/1_000_000:.0f}M"
    if a >= 1_000:
        return f"${a/1_000:.0f}K"
    return f"${a:.0f}"


def _safe_str(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return str(v)


@router.get("")
def get_hallazgos(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = f"hallazgos:{ano}:{mes}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None

    # ── Shared exclusion conditions ───────────────────────────────────────────
    excl_joins, excl_cond = [], []
    if excl_exportacion:
        excl_joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        excl_cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        excl_cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    join_str   = " ".join(excl_joins)
    extra_cond = (" AND " + " AND ".join(excl_cond)) if excl_cond else ""

    mes_cond_cur = (f"fv.PERIODO_FISCAL = {mes}" if mes else (f"fv.PERIODO_FISCAL <= {ytd_cap}" if ytd_cap else "1=1"))
    mes_cond_ant = mes_cond_cur  # same period cap for YoY fairness

    try:
        # ── 1. Global totals ──────────────────────────────────────────────────
        sql_tot = f"""
            SELECT
                COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano} AND {mes_cond_cur} THEN fv.VENTAS_NETAS END), 0) AS vn_cur,
                COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano-1} AND {mes_cond_ant} THEN fv.VENTAS_NETAS END), 0) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE fv.ANO_FISCAL IN ({ano}, {ano-1}) {extra_cond}
        """
        df_tot = connector.query(sql_tot)
        df_tot.columns = [c.lower() for c in df_tot.columns]
        vn_cur = float(df_tot.iloc[0]["vn_cur"] or 0)
        vn_ant = float(df_tot.iloc[0]["vn_ant"] or 0)
        yoy_global  = _safe_pct(vn_cur, vn_ant)
        delta_total = vn_cur - vn_ant  # positive = gained, negative = lost

        # ── 2. Regions ────────────────────────────────────────────────────────
        reg_excl_parts = ["dd.DESCRIPCION_REGION IS NOT NULL"]
        if excl_exportacion:
            reg_excl_parts.append("dd.DESCRIPCION_REGION != 'ZONA EXPORTACIONES'")
        if excl_pvta:
            reg_excl_parts.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")
        reg_excl_str = " AND ".join(reg_excl_parts)

        sql_reg = f"""
            SELECT dd.DESCRIPCION_REGION AS region,
                   COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano} AND {mes_cond_cur} THEN fv.VENTAS_NETAS END), 0) AS vn_cur,
                   COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano-1} AND {mes_cond_ant} THEN fv.VENTAS_NETAS END), 0) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY
            WHERE fv.ANO_FISCAL IN ({ano}, {ano-1})
              AND {reg_excl_str}
            GROUP BY 1
            HAVING vn_cur > 0
            ORDER BY vn_cur DESC
        """
        df_reg = connector.query(sql_reg)
        df_reg.columns = [c.lower() for c in df_reg.columns]
        df_reg["yoy"]   = df_reg.apply(lambda r: _safe_pct(float(r.vn_cur), float(r.vn_ant)), axis=1)
        df_reg["delta"] = df_reg.apply(lambda r: float(r.vn_cur) - float(r.vn_ant), axis=1)
        df_reg["peso"]  = df_reg.apply(lambda r: round(float(r.vn_cur) / vn_cur * 100, 1) if vn_cur > 0 else 0, axis=1)

        # ── 3. Vendedores vs PP ───────────────────────────────────────────────
        pvta_cond = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        sql_vend = f"""
            SELECT fv.CODIGO_VENDEDOR,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano}
              {"AND " + mes_cond_cur if mes_cond_cur != "1=1" else ""}
              {pvta_cond}
            GROUP BY 1
        """
        pp_mes_cond = f"MES_NUM = {mes}" if mes else ("MES_NUM <= " + str(ytd_cap) if ytd_cap else "1=1")
        sql_pp = f"""
            SELECT VENDEDOR, COALESCE(SUM(PP_VALOR_MES), 0) AS pp_valor
            FROM {cfg.T('PP_VENDEDOR_VALOR')}
            WHERE ANO = {ano} AND {pp_mes_cond}
            GROUP BY 1
        """
        df_vend = connector.query(sql_vend)
        df_pp   = connector.query(sql_pp)
        df_dv   = connector.query(f"SELECT CODIGO_VENDEDOR, NOMBRE FROM {cfg.TM('DIM_VENDEDOR')}")
        for _d in [df_vend, df_pp, df_dv]:
            _d.columns = [c.lower() for c in _d.columns]
        df_pp = df_pp.rename(columns={"vendedor": "codigo_vendedor"})
        df_vend = df_vend.merge(df_pp, on="codigo_vendedor", how="left").merge(df_dv, on="codigo_vendedor", how="left")
        df_vend["pp_valor"] = df_vend["pp_valor"].fillna(0)
        df_vend["cump"] = df_vend.apply(
            lambda r: round(float(r.ventas_netas) / float(r.pp_valor) * 100, 1) if float(r.pp_valor) > 0 else None, axis=1
        )
        df_vend["gap_cop"] = df_vend.apply(
            lambda r: float(r.pp_valor) - float(r.ventas_netas) if float(r.pp_valor) > 0 else 0, axis=1
        )
        df_vend_pp = df_vend[df_vend["pp_valor"] > 0].sort_values("cump", ascending=False)

        # ── 4. Stock vs No-Stock con comparación YoY ──────────────────────────
        # Proxy: COMERCIALIZACION line → No Stock, all other lines → Stock
        pvta_cond2 = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        sql_stock = f"""
            SELECT
                CASE WHEN UPPER(COALESCE(dgp.LINEA_NEGOCIO, '')) LIKE '%%COMERCIALIZ%%'
                     THEN 'No Stock' ELSE 'Stock' END AS categoria,
                COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano} AND {mes_cond_cur} THEN fv.VENTAS_NETAS END), 0) AS vn_cur,
                COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano-1} AND {mes_cond_ant} THEN fv.VENTAS_NETAS END), 0) AS vn_ant,
                COUNT(DISTINCT CASE WHEN fv.ANO_FISCAL = {ano} AND {mes_cond_cur} THEN fv.NUMERO_CLIENTE END) AS clientes_cur
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO
            WHERE fv.ANO_FISCAL IN ({ano}, {ano-1})
              {pvta_cond2}
            GROUP BY 1
        """
        df_stock = connector.query(sql_stock)
        df_stock.columns = [c.lower() for c in df_stock.columns]

        # ── 5. Clientes en alerta (caída >-20% YoY) con monto en riesgo ──────
        pvta_alert = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        export_alert = f" AND (UPPER(dda.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dda.DESCRIPCION_REGION IS NULL)" if excl_exportacion else ""
        join_alert = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dda ON fv.DOMICILIO_KEY = dda.DOMICILIO_KEY" if excl_exportacion else ""

        sql_alert = f"""
            WITH cur AS (
                SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
                FROM {cfg.T('FACT_VENTAS')} fv {join_alert}
                WHERE fv.ANO_FISCAL = {ano} AND {mes_cond_cur}
                  {pvta_alert} {export_alert}
                GROUP BY 1
            ),
            ant AS (
                SELECT fv.NUMERO_CLIENTE,
                       COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant,
                       MAX(fv.ID_CLIENTE) AS id_cliente
                FROM {cfg.T('FACT_VENTAS')} fv {join_alert}
                WHERE fv.ANO_FISCAL = {ano-1} AND {mes_cond_ant}
                  {pvta_alert} {export_alert}
                GROUP BY 1
            )
            SELECT
                COUNT(*) AS n_alertas,
                COALESCE(SUM(CASE WHEN ((cur.vn - ant.vn_ant) / ABS(ant.vn_ant) * 100) <= -20 THEN ant.vn_ant END), 0) AS monto_en_riesgo,
                COALESCE(SUM(CASE WHEN ((cur.vn - ant.vn_ant) / ABS(ant.vn_ant) * 100) <= -50 THEN ant.vn_ant END), 0) AS monto_critico
            FROM cur JOIN ant ON cur.NUMERO_CLIENTE = ant.NUMERO_CLIENTE
            WHERE ant.vn_ant > 0
              AND ((cur.vn - ant.vn_ant) / ABS(ant.vn_ant) * 100) <= -20
        """
        df_alert = connector.query(sql_alert)
        df_alert.columns = [c.lower() for c in df_alert.columns]
        n_alertas      = int(df_alert.iloc[0]["n_alertas"] or 0)
        monto_en_riesgo = float(df_alert.iloc[0]["monto_en_riesgo"] or 0)
        monto_critico   = float(df_alert.iloc[0]["monto_critico"] or 0)

        # ── 6. Línea de negocio: mayor absoluto pérdida/ganancia ─────────────
        sql_linea = f"""
            SELECT dgp.LINEA_NEGOCIO AS linea,
                   COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano} AND {mes_cond_cur} THEN fv.VENTAS_NETAS END), 0) AS vn_cur,
                   COALESCE(SUM(CASE WHEN fv.ANO_FISCAL = {ano-1} AND {mes_cond_ant} THEN fv.VENTAS_NETAS END), 0) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO
            WHERE fv.ANO_FISCAL IN ({ano}, {ano-1})
              AND dgp.LINEA_NEGOCIO IS NOT NULL
              {pvta_cond2}
            GROUP BY 1
            HAVING vn_cur > 0
            ORDER BY vn_cur DESC
        """
        df_linea = connector.query(sql_linea)
        df_linea.columns = [c.lower() for c in df_linea.columns]
        df_linea["delta"] = df_linea.apply(lambda r: float(r.vn_cur) - float(r.vn_ant), axis=1)
        df_linea["yoy"]   = df_linea.apply(lambda r: _safe_pct(float(r.vn_cur), float(r.vn_ant)), axis=1)
        df_linea["peso"]  = df_linea.apply(lambda r: round(float(r.vn_cur) / vn_cur * 100, 1) if vn_cur > 0 else 0, axis=1)

    except Exception as exc:
        logger.error("Hallazgos error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # ── Compose insights ──────────────────────────────────────────────────────
    insights = []

    # 1. Global YoY con impacto absoluto
    if yoy_global is not None:
        tipo = "positivo" if yoy_global >= 0 else "alerta"
        insights.append({
            "categoria": tipo,
            "titulo": f"Ventas {_pct_label(yoy_global)} vs año anterior",
            "descripcion": (
                f"Las ventas {'crecieron' if delta_total >= 0 else 'cayeron'} "
                f"{_cop_label(abs(delta_total))} respecto al mismo período de {ano - 1}. "
                f"Total actual: {_cop_label(vn_cur)}."
            ),
            "valor": yoy_global,
            "impacto_cop": round(delta_total, 0),
            "peso_pct": 100.0,
            "icono": "trending_up" if yoy_global >= 0 else "trending_down",
            "accion": None,
        })

    # 2. Regiones: mejor y peor por impacto absoluto (no solo %)
    if not df_reg.empty:
        df_reg_s = df_reg.dropna(subset=["yoy"]).sort_values("yoy", ascending=False)
        if not df_reg_s.empty:
            best_reg = df_reg_s.iloc[0]
            insights.append({
                "categoria": "positivo",
                "titulo": f"Mejor región: {best_reg['region']} ({_pct_label(best_reg['yoy'])})",
                "descripcion": (
                    f"Aporta {_cop_label(float(best_reg['vn_cur']))} ({best_reg['peso']:.0f}% del total) "
                    f"y creció {_cop_label(abs(float(best_reg['delta'])))} vs {ano - 1}."
                ),
                "valor": best_reg["yoy"],
                "impacto_cop": round(float(best_reg["delta"]), 0),
                "peso_pct": float(best_reg["peso"]),
                "icono": "star",
                "accion": None,
            })
            # Región con mayor pérdida absoluta (no la de peor %)
            worst_abs = df_reg.sort_values("delta").iloc[0]
            if float(worst_abs["delta"]) < 0 and worst_abs["yoy"] < -5:
                insights.append({
                    "categoria": "alerta",
                    "titulo": f"Mayor pérdida absoluta: {worst_abs['region']}",
                    "descripcion": (
                        f"Cayó {_cop_label(abs(float(worst_abs['delta'])))} ({_pct_label(worst_abs['yoy'])}) "
                        f"y representa el {worst_abs['peso']:.0f}% de la facturación. "
                        f"Acción: revisar cartera de clientes de esta zona."
                    ),
                    "valor": worst_abs["yoy"],
                    "impacto_cop": round(float(worst_abs["delta"]), 0),
                    "peso_pct": float(worst_abs["peso"]),
                    "icono": "warning",
                    "accion": "Revisar cartera y visitar clientes clave de la región",
                })

    # 3. Línea de negocio con mayor impacto
    if not df_linea.empty:
        best_ln = df_linea.iloc[0]
        worst_ln = df_linea.sort_values("delta").iloc[0]
        insights.append({
            "categoria": "tendencia",
            "titulo": f"Línea líder: {best_ln['linea']} ({best_ln['peso']:.0f}% del total)",
            "descripcion": (
                f"Facturó {_cop_label(float(best_ln['vn_cur']))} con variación "
                f"{_pct_label(best_ln['yoy'])} vs {ano - 1}."
            ),
            "valor": best_ln["yoy"],
            "impacto_cop": round(float(best_ln["delta"]), 0),
            "peso_pct": float(best_ln["peso"]),
            "icono": "inventory",
            "accion": None,
        })
        if float(worst_ln["delta"]) < 0 and worst_ln["linea"] != best_ln["linea"]:
            insights.append({
                "categoria": "alerta",
                "titulo": f"Línea en declive: {worst_ln['linea']}",
                "descripcion": (
                    f"Perdió {_cop_label(abs(float(worst_ln['delta'])))} ({_pct_label(worst_ln['yoy'])}) vs {ano - 1}. "
                    f"Pesa {worst_ln['peso']:.0f}% del total. "
                    f"Acción: identificar clientes que dejaron de comprar en esta línea."
                ),
                "valor": worst_ln["yoy"],
                "impacto_cop": round(float(worst_ln["delta"]), 0),
                "peso_pct": float(worst_ln["peso"]),
                "icono": "warning",
                "accion": "Identificar clientes que dejaron de comprar en esta línea",
            })

    # 4. Vendedores cumplimiento con GAP en $
    if not df_vend_pp.empty:
        best_v  = df_vend_pp.iloc[0]
        worst_v = df_vend_pp.iloc[-1]
        nb = _safe_str(best_v.get("nombre")) or str(best_v["codigo_vendedor"])
        nw = _safe_str(worst_v.get("nombre")) or str(worst_v["codigo_vendedor"])
        if best_v["cump"] is not None:
            insights.append({
                "categoria": "positivo",
                "titulo": f"Top vendedor: {nb} ({best_v['cump']:.0f}% PP)",
                "descripcion": f"Facturó {_cop_label(float(best_v['ventas_netas']))} alcanzando {best_v['cump']:.0f}% de su presupuesto.",
                "valor": best_v["cump"],
                "impacto_cop": round(float(best_v["ventas_netas"]), 0),
                "peso_pct": None,
                "icono": "emoji_events",
                "accion": None,
            })
        if worst_v["cump"] is not None and worst_v["cump"] < 80:
            gap = float(worst_v["gap_cop"])
            insights.append({
                "categoria": "alerta",
                "titulo": f"Bajo cumplimiento: {nw} ({worst_v['cump']:.0f}% PP)",
                "descripcion": (
                    f"Faltan {_cop_label(gap)} para alcanzar el presupuesto "
                    f"({_cop_label(float(worst_v['pp_valor']))} meta). "
                    f"Acción: revisar agenda de visitas y pipeline."
                ),
                "valor": worst_v["cump"],
                "impacto_cop": round(-gap, 0),
                "peso_pct": None,
                "icono": "person_alert",
                "accion": "Revisar pipeline y agendar visitas antes de cierre de mes",
            })

    # 5. $ en riesgo por caída de clientes
    if n_alertas > 0:
        nivel = "critica" if monto_critico > vn_cur * 0.05 else "alerta"
        insights.append({
            "categoria": nivel,
            "titulo": f"{n_alertas} clientes en alerta — {_cop_label(monto_en_riesgo)} en riesgo",
            "descripcion": (
                f"Clientes con caída >20% YoY representaban {_cop_label(monto_en_riesgo)} el año pasado. "
                f"De esos, {_cop_label(monto_critico)} corresponde a clientes con caída >50% (críticos). "
                f"Acción: contactar los 10 de mayor valor esta semana."
            ),
            "valor": n_alertas,
            "impacto_cop": round(-monto_en_riesgo, 0),
            "peso_pct": round(monto_en_riesgo / vn_ant * 100, 1) if vn_ant > 0 else None,
            "icono": "person_remove",
            "accion": "Contactar los 10 clientes críticos de mayor valor histórico esta semana",
        })

    # 6. Stock vs No-Stock con impacto YoY
    if not df_stock.empty:
        stock_r   = df_stock[df_stock["categoria"] == "Stock"]
        nostock_r = df_stock[df_stock["categoria"] == "No Stock"]
        if not stock_r.empty and not nostock_r.empty:
            vn_s  = float(stock_r.iloc[0]["vn_cur"])
            vn_ns = float(nostock_r.iloc[0]["vn_cur"])
            vn_s_ant  = float(stock_r.iloc[0]["vn_ant"])
            vn_ns_ant = float(nostock_r.iloc[0]["vn_ant"])
            total_s   = vn_s + vn_ns
            pct_stock = round(vn_s / total_s * 100, 1) if total_s > 0 else 0
            yoy_ns = _safe_pct(vn_ns, vn_ns_ant)
            cat = "alerta" if (yoy_ns is not None and yoy_ns > 10) else "tendencia"
            insights.append({
                "categoria": cat,
                "titulo": f"No Stock creció {_pct_label(yoy_ns)} — {100-pct_stock:.0f}% de ventas",
                "descripcion": (
                    f"Productos bajo pedido (No Stock) facturaron {_cop_label(vn_ns)} "
                    f"({_pct_label(yoy_ns)} vs año anterior). "
                    f"Si supera el 40%, revisa capacidad operativa y tiempos de entrega."
                ),
                "valor": yoy_ns,
                "impacto_cop": round(vn_ns - vn_ns_ant, 0),
                "peso_pct": round(100 - pct_stock, 1),
                "icono": "inventory",
                "accion": "Revisar capacidad de producción si No Stock > 40% de ventas" if (100 - pct_stock) > 40 else None,
            })

    # ── Sort: critical first, then by abs(impacto_cop) ───────────────────────
    CAT_ORDER = {"critica": 0, "alerta": 1, "positivo": 2, "tendencia": 3, "oportunidad": 4}
    insights.sort(key=lambda x: (CAT_ORDER.get(x["categoria"], 9), -abs(x.get("impacto_cop") or 0)))

    # ── Detailed data for charts ──────────────────────────────────────────────
    regiones_data = []
    for _, r in df_reg.iterrows():
        regiones_data.append({
            "region":           str(r.region or ""),
            "ventas_netas":     round(float(r.vn_cur or 0), 2),
            "ventas_netas_ant": round(float(r.vn_ant or 0), 2),
            "variacion_yoy_pct": r.yoy,
            "delta_cop":        round(float(r.delta or 0), 2),
            "peso_pct":         float(r.peso or 0),
        })

    lineas_data = []
    for _, r in df_linea.iterrows():
        lineas_data.append({
            "linea":            str(r.linea or ""),
            "ventas_netas":     round(float(r.vn_cur or 0), 2),
            "ventas_netas_ant": round(float(r.vn_ant or 0), 2),
            "variacion_yoy_pct": r.yoy,
            "delta_cop":        round(float(r.delta or 0), 2),
            "peso_pct":         float(r.peso or 0),
        })

    vendedores_data = []
    for _, r in df_vend_pp.iterrows():
        n_raw = r.get("nombre")
        n = (_safe_str(n_raw)) or str(r.codigo_vendedor)
        vendedores_data.append({
            "nombre":       n,
            "ventas_netas": round(float(r.ventas_netas or 0), 2),
            "pp_valor":     round(float(r.pp_valor or 0), 2),
            "cump_pct":     r.cump,
            "gap_cop":      round(float(r.gap_cop or 0), 2),
        })

    result = {
        "ano": ano, "mes": mes,
        "insights": insights,
        "regiones": regiones_data,
        "lineas": lineas_data,
        "vendedores": vendedores_data,
        "stock_vs_nostock": df_stock.to_dict(orient="records") if not df_stock.empty else [],
        "n_alertas_clientes": n_alertas,
        "monto_en_riesgo": round(monto_en_riesgo, 0),
        "monto_critico": round(monto_critico, 0),
        "variacion_yoy_global": yoy_global,
        "vn_cur": round(vn_cur, 0),
        "vn_ant": round(vn_ant, 0),
        "delta_total": round(delta_total, 0),
    }
    cache.set(key, result)
    return result
