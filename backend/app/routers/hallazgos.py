"""
GET /api/hallazgos — Auto-computed business insights.
Runs in parallel over KPIs, segments, vendedores, alertas data.
"""
import logging
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

    # ── Build reusable WHERE/JOIN pieces ─────────────────────────────────────
    excl_joins, excl_cond = [], []
    if excl_exportacion:
        excl_joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        excl_cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
    if excl_pvta:
        excl_cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    join_str  = " ".join(excl_joins)
    extra_cond = (" AND " + " AND ".join(excl_cond)) if excl_cond else ""

    def _period_where(ano_v, mes_v, cap=None):
        c = [f"fv.ANO_FISCAL = {ano_v}"]
        if mes_v:
            c.append(f"fv.PERIODO_FISCAL = {mes_v}")
        elif cap:
            c.append(f"fv.PERIODO_FISCAL <= {cap}")
        return "WHERE " + " AND ".join(c) + extra_cond

    w_cur = _period_where(ano, mes)
    w_ant = _period_where(ano - 1, mes, cap=ytd_cap)

    try:
        # ── 1. Global totals current vs previous ──────────────────────────────
        sql_tot = f"""
            SELECT
                SUM(CASE WHEN fv.ANO_FISCAL = {ano} {(' AND fv.PERIODO_FISCAL = ' + str(mes)) if mes else (' AND fv.PERIODO_FISCAL <= ' + str(ytd_cap)) if ytd_cap else ''} THEN fv.VENTAS_NETAS ELSE 0 END) AS vn_cur,
                SUM(CASE WHEN fv.ANO_FISCAL = {ano - 1} {(' AND fv.PERIODO_FISCAL = ' + str(mes)) if mes else (' AND fv.PERIODO_FISCAL <= ' + str(ytd_cap)) if ytd_cap else ''} THEN fv.VENTAS_NETAS ELSE 0 END) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv {join_str}
            WHERE fv.ANO_FISCAL IN ({ano}, {ano - 1}) {extra_cond}
        """
        df_tot = connector.query(sql_tot)
        df_tot.columns = [c.lower() for c in df_tot.columns]
        vn_cur = float(df_tot.iloc[0]["vn_cur"] or 0)
        vn_ant = float(df_tot.iloc[0]["vn_ant"] or 0)
        yoy_global = _safe_pct(vn_cur, vn_ant)

        # ── 2. Top/bottom regions ─────────────────────────────────────────────
        reg_join = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
        if excl_exportacion:
            reg_join_str = join_str  # already has dd join
        else:
            reg_join_str = reg_join + (" " + join_str if join_str else "")

        sql_reg = f"""
            SELECT dd.DESCRIPCION_REGION AS region,
                   SUM(CASE WHEN fv.ANO_FISCAL = {ano} {(' AND fv.PERIODO_FISCAL = ' + str(mes)) if mes else (' AND fv.PERIODO_FISCAL <= ' + str(ytd_cap)) if ytd_cap else ''} THEN fv.VENTAS_NETAS ELSE 0 END) AS vn_cur,
                   SUM(CASE WHEN fv.ANO_FISCAL = {ano - 1} {(' AND fv.PERIODO_FISCAL = ' + str(mes)) if mes else (' AND fv.PERIODO_FISCAL <= ' + str(ytd_cap)) if ytd_cap else ''} THEN fv.VENTAS_NETAS ELSE 0 END) AS vn_ant
            FROM {cfg.T('FACT_VENTAS')} fv
            {reg_join_str if not excl_exportacion else join_str}
            LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd2 ON fv.DOMICILIO_KEY = dd2.DOMICILIO_KEY
            WHERE fv.ANO_FISCAL IN ({ano}, {ano - 1})
              AND dd2.DESCRIPCION_REGION IS NOT NULL
              {(' AND dd2.DESCRIPCION_REGION != \'ZONA EXPORTACIONES\'' if excl_exportacion else '')}
              {(' AND (fv.CODIGO_VENDEDOR NOT LIKE \'PVTA%\' OR fv.CODIGO_VENDEDOR IS NULL)' if excl_pvta else '')}
            GROUP BY 1
            HAVING vn_cur > 0
            ORDER BY vn_cur DESC
        """

        # Simpler region query
        reg_excl = []
        reg_excl.append("dd.DESCRIPCION_REGION IS NOT NULL")
        if excl_exportacion:
            reg_excl.append("dd.DESCRIPCION_REGION != 'ZONA EXPORTACIONES'")
        if excl_pvta:
            reg_excl.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

        reg_excl_str = " AND ".join(reg_excl)
        mes_cond_cur = (f"fv.PERIODO_FISCAL = {mes}" if mes else (f"fv.PERIODO_FISCAL <= {ytd_cap}" if ytd_cap else "1=1"))
        mes_cond_ant = (f"fv.PERIODO_FISCAL = {mes}" if mes else (f"fv.PERIODO_FISCAL <= {ytd_cap}" if ytd_cap else "1=1"))

        sql_reg2 = f"""
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
        df_reg = connector.query(sql_reg2)
        df_reg.columns = [c.lower() for c in df_reg.columns]
        df_reg["yoy"] = df_reg.apply(lambda r: _safe_pct(float(r.vn_cur), float(r.vn_ant)), axis=1)

        # ── 3. Vendedor cumplimiento vs PP ────────────────────────────────────
        pvta_cond = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        sql_vend = f"""
            SELECT fv.CODIGO_VENDEDOR,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas
            FROM {cfg.T('FACT_VENTAS')} fv
            WHERE fv.ANO_FISCAL = {ano}
              {"AND fv.PERIODO_FISCAL = " + str(mes) if mes else ("AND fv.PERIODO_FISCAL <= " + str(ytd_cap) if ytd_cap else "")}
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
        sql_dim_v = f"SELECT CODIGO_VENDEDOR, NOMBRE FROM {cfg.TM('DIM_VENDEDOR')}"

        df_vend = connector.query(sql_vend)
        df_pp   = connector.query(sql_pp)
        df_dv   = connector.query(sql_dim_v)
        df_vend.columns = [c.lower() for c in df_vend.columns]
        df_pp.columns   = [c.lower() for c in df_pp.columns]
        df_dv.columns   = [c.lower() for c in df_dv.columns]
        df_pp = df_pp.rename(columns={"vendedor": "codigo_vendedor"})
        df_vend = df_vend.merge(df_pp, on="codigo_vendedor", how="left")
        df_vend = df_vend.merge(df_dv, on="codigo_vendedor", how="left")
        df_vend["pp_valor"] = df_vend["pp_valor"].fillna(0)
        df_vend["cump"] = df_vend.apply(
            lambda r: round(float(r.ventas_netas) / float(r.pp_valor) * 100, 1) if float(r.pp_valor) > 0 else None, axis=1
        )
        df_vend_pp = df_vend[df_vend["pp_valor"] > 0].sort_values("cump", ascending=False)

        # ── 4. Stock vs No-Stock ──────────────────────────────────────────────
        pvta_cond2 = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        exportacion_cond2 = " AND (UPPER(dd2.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd2.DESCRIPCION_REGION IS NULL)" if excl_exportacion else ""
        excl_join2 = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd2 ON fv.DOMICILIO_KEY = dd2.DOMICILIO_KEY" if excl_exportacion else ""
        sql_stock = f"""
            SELECT
                CASE WHEN dp.ES_STOCK = TRUE THEN 'Stock' ELSE 'No Stock' END AS categoria,
                COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas,
                COUNT(DISTINCT fv.NUMERO_CLIENTE) AS num_clientes
            FROM {cfg.T('FACT_VENTAS')} fv
            LEFT JOIN {cfg.TM('DIM_PARTE')} dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO
            {excl_join2}
            WHERE fv.ANO_FISCAL = {ano}
              {"AND fv.PERIODO_FISCAL = " + str(mes) if mes else ("AND fv.PERIODO_FISCAL <= " + str(ytd_cap) if ytd_cap else "")}
              {pvta_cond2}
              {exportacion_cond2}
            GROUP BY 1
        """
        df_stock = connector.query(sql_stock)
        df_stock.columns = [c.lower() for c in df_stock.columns]

        # ── 5. Alertas clientes count ─────────────────────────────────────────
        umbral = -20.0
        pvta_alert = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
        export_alert = " AND (UPPER(dda.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dda.DESCRIPCION_REGION IS NULL)" if excl_exportacion else ""
        join_alert = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dda ON fv.DOMICILIO_KEY = dda.DOMICILIO_KEY" if excl_exportacion else ""

        sql_alert = f"""
            WITH cur AS (
                SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
                FROM {cfg.T('FACT_VENTAS')} fv {join_alert}
                WHERE fv.ANO_FISCAL = {ano}
                  {"AND fv.PERIODO_FISCAL = " + str(mes) if mes else ("AND fv.PERIODO_FISCAL <= " + str(ytd_cap) if ytd_cap else "")}
                  {pvta_alert} {export_alert}
                GROUP BY 1
            ),
            ant AS (
                SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant
                FROM {cfg.T('FACT_VENTAS')} fv {join_alert}
                WHERE fv.ANO_FISCAL = {ano - 1}
                  {"AND fv.PERIODO_FISCAL = " + str(mes) if mes else ("AND fv.PERIODO_FISCAL <= " + str(ytd_cap) if ytd_cap else "")}
                  {pvta_alert} {export_alert}
                GROUP BY 1
            )
            SELECT COUNT(*) AS n_alertas
            FROM cur JOIN ant ON cur.NUMERO_CLIENTE = ant.NUMERO_CLIENTE
            WHERE ant.vn_ant > 0
              AND ((cur.vn - ant.vn_ant) / ABS(ant.vn_ant) * 100) <= {umbral}
        """
        df_alert = connector.query(sql_alert)
        df_alert.columns = [c.lower() for c in df_alert.columns]
        n_alertas = int(df_alert.iloc[0]["n_alertas"] or 0)

    except Exception as exc:
        logger.error("Hallazgos error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # ── Compose insights ─────────────────────────────────────────────────────
    insights = []

    # Global YoY
    if yoy_global is not None:
        tipo = "positivo" if yoy_global >= 0 else "alerta"
        insights.append({
            "categoria": tipo,
            "titulo": f"Ventas {_pct_label(yoy_global)} vs año anterior",
            "descripcion": f"Las ventas {'crecieron' if yoy_global >= 0 else 'cayeron'} {abs(yoy_global):.1f}% respecto al mismo período de {ano - 1}.",
            "valor": yoy_global,
            "icono": "trending_up" if yoy_global >= 0 else "trending_down",
        })

    # Best and worst region by YoY
    if not df_reg.empty:
        df_reg_sorted = df_reg.dropna(subset=["yoy"]).sort_values("yoy", ascending=False)
        if not df_reg_sorted.empty:
            best_reg = df_reg_sorted.iloc[0]
            insights.append({
                "categoria": "positivo",
                "titulo": f"Mejor región: {best_reg['region']}",
                "descripcion": f"Creció {_pct_label(best_reg['yoy'])} vs {ano - 1}, liderando el crecimiento.",
                "valor": best_reg["yoy"],
                "icono": "star",
            })
            worst_reg = df_reg_sorted.iloc[-1]
            if worst_reg["yoy"] < -10:
                insights.append({
                    "categoria": "alerta",
                    "titulo": f"Región en declive: {worst_reg['region']}",
                    "descripcion": f"Cayó {_pct_label(worst_reg['yoy'])} vs {ano - 1}. Requiere atención.",
                    "valor": worst_reg["yoy"],
                    "icono": "warning",
                })

    # Vendedor cumplimiento
    if not df_vend_pp.empty:
        best_v = df_vend_pp.iloc[0]
        worst_v = df_vend_pp.iloc[-1]
        import math
        nombre_best = (str(best_v.get("nombre")) if best_v.get("nombre") and not (isinstance(best_v.get("nombre"), float) and math.isnan(best_v.get("nombre"))) else None) or str(best_v["codigo_vendedor"])
        nombre_worst = (str(worst_v.get("nombre")) if worst_v.get("nombre") and not (isinstance(worst_v.get("nombre"), float) and math.isnan(worst_v.get("nombre"))) else None) or str(worst_v["codigo_vendedor"])
        if best_v["cump"] is not None:
            insights.append({
                "categoria": "positivo",
                "titulo": f"Mejor cumplimiento: {nombre_best}",
                "descripcion": f"Alcanzó {best_v['cump']:.0f}% de su presupuesto de valor.",
                "valor": best_v["cump"],
                "icono": "emoji_events",
            })
        if worst_v["cump"] is not None and worst_v["cump"] < 70:
            insights.append({
                "categoria": "alerta",
                "titulo": f"Bajo cumplimiento: {nombre_worst}",
                "descripcion": f"Solo alcanzó {worst_v['cump']:.0f}% de su presupuesto. Necesita seguimiento.",
                "valor": worst_v["cump"],
                "icono": "person_alert",
            })

    # Stock vs No-Stock
    if not df_stock.empty:
        stock_row = df_stock[df_stock["categoria"] == "Stock"]
        nostock_row = df_stock[df_stock["categoria"] == "No Stock"]
        if not stock_row.empty and not nostock_row.empty:
            vn_s  = float(stock_row.iloc[0]["ventas_netas"])
            vn_ns = float(nostock_row.iloc[0]["ventas_netas"])
            total_s = vn_s + vn_ns
            pct_stock = round(vn_s / total_s * 100, 1) if total_s > 0 else 0
            insights.append({
                "categoria": "tendencia",
                "titulo": f"Productos de stock: {pct_stock:.0f}% de ventas",
                "descripcion": f"Los productos de stock representan {pct_stock:.1f}% del total de ventas ({ano}).",
                "valor": pct_stock,
                "icono": "inventory",
            })

    # Alertas clientes
    if n_alertas > 0:
        nivel = "critica" if n_alertas >= 20 else "alerta"
        insights.append({
            "categoria": nivel,
            "titulo": f"{n_alertas} clientes con caída >20% YoY",
            "descripcion": f"Se detectaron {n_alertas} clientes con reducción significativa de consumo respecto a {ano - 1}.",
            "valor": n_alertas,
            "icono": "person_remove",
        })
    else:
        insights.append({
            "categoria": "positivo",
            "titulo": "Sin alertas críticas de clientes",
            "descripcion": f"No hay clientes con caída mayor al 20% vs {ano - 1}.",
            "valor": 0,
            "icono": "check_circle",
        })

    # ── Region breakdown for chart ─────────────────────────────────────────
    regiones_data = []
    for _, r in df_reg.iterrows():
        regiones_data.append({
            "region": str(r.region or ""),
            "ventas_netas": round(float(r.vn_cur or 0), 2),
            "ventas_netas_ant": round(float(r.vn_ant or 0), 2),
            "variacion_yoy_pct": r.yoy,
        })

    # ── Vendedores cumplimiento for chart ──────────────────────────────────
    import math
    vendedores_data = []
    for _, r in df_vend_pp.iterrows():
        n_raw = r.get("nombre")
        n = (str(n_raw) if n_raw and not (isinstance(n_raw, float) and math.isnan(n_raw)) else None) or str(r.codigo_vendedor)
        vendedores_data.append({
            "nombre": n,
            "ventas_netas": round(float(r.ventas_netas or 0), 2),
            "pp_valor": round(float(r.pp_valor or 0), 2),
            "cump_pct": r.cump,
        })

    result = {
        "ano": ano, "mes": mes,
        "insights": insights,
        "regiones": regiones_data,
        "vendedores": vendedores_data,
        "stock_vs_nostock": df_stock.to_dict(orient="records") if not df_stock.empty else [],
        "n_alertas_clientes": n_alertas,
        "variacion_yoy_global": yoy_global,
    }
    cache.set(key, result)
    return result
