"""
GET /api/oportunidades — KPIs estratégicos y acciones de impacto inmediato.
Concentración de ingresos, retención, pareto, $ en riesgo, $ recuperable.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/oportunidades", tags=["Oportunidades"])
logger = logging.getLogger(__name__)


@router.get("")
def get_oportunidades(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(True),
):
    cfg = get_settings()
    key = f"oport:{ano}:{mes}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached

    today = date.today()
    ytd_cap = today.month if (not mes and ano == today.year) else None

    pvta_cond  = " AND (UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' AND UPPER(fv.CODIGO_VENDEDOR) != 'PBOGOTA' OR fv.CODIGO_VENDEDOR IS NULL)" if excl_pvta else ""
    exp_join   = f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY" if excl_exportacion else ""
    exp_cond   = " AND (UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)" if excl_exportacion else ""

    def _mes_where(ano_v):
        c = f"fv.ANO_FISCAL = {ano_v}"
        if mes:
            c += f" AND fv.PERIODO_FISCAL = {mes}"
        elif ytd_cap:
            c += f" AND fv.PERIODO_FISCAL <= {ytd_cap}"
        return c

    try:
        # ── 1. Concentración de ingresos — top clientes ────────────────────────
        sql_concentracion = f"""
            SELECT fv.NUMERO_CLIENTE,
                   dc.NOMBRE,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
            FROM {cfg.T('FACT_VENTAS')} fv
            {exp_join}
            LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
            WHERE {_mes_where(ano)} {pvta_cond} {exp_cond}
            GROUP BY 1, 2
            HAVING vn > 0
            ORDER BY vn DESC
            LIMIT 200
        """
        df_conc = connector.query(sql_concentracion)
        df_conc.columns = [c.lower() for c in df_conc.columns]
        total_vn = float(df_conc["vn"].sum()) if not df_conc.empty else 0

        # Pareto: how many clients drive 80% of revenue
        pareto_80 = 0
        pareto_data = []
        cumsum = 0.0
        for i, (_, r) in enumerate(df_conc.iterrows()):
            cumsum += float(r["vn"])
            pct_cli  = round((i + 1) / len(df_conc) * 100, 1)
            pct_vtas = round(cumsum / total_vn * 100, 1) if total_vn > 0 else 0
            if pct_vtas <= 90:
                pareto_data.append({"n_clientes": i + 1, "pct_clientes": pct_cli, "pct_ventas": pct_vtas})
            if pct_vtas <= 80 and pareto_80 == 0 and pct_vtas >= 80:
                pareto_80 = i + 1
            elif pct_vtas >= 80 and pareto_80 == 0:
                pareto_80 = i + 1

        top5  = df_conc.head(5)
        top10 = df_conc.head(10)
        pct_top5  = round(float(top5["vn"].sum()) / total_vn * 100, 1) if total_vn > 0 else 0
        pct_top10 = round(float(top10["vn"].sum()) / total_vn * 100, 1) if total_vn > 0 else 0
        n_total_clientes = len(df_conc)

        top5_list = []
        for _, r in top5.iterrows():
            top5_list.append({
                "nombre": str(r.get("nombre") or r["numero_cliente"]),
                "ventas": round(float(r["vn"]), 0),
                "pct": round(float(r["vn"]) / total_vn * 100, 1) if total_vn > 0 else 0,
            })

        # ── 2. Retención real (% clientes año pasado que compraron este año) ──
        sql_retencion = f"""
            WITH cur AS (
                SELECT DISTINCT fv.NUMERO_CLIENTE
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                WHERE {_mes_where(ano)} AND fv.VENTAS_NETAS > 0 {pvta_cond} {exp_cond}
            ),
            ant AS (
                SELECT DISTINCT fv.NUMERO_CLIENTE
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                WHERE {_mes_where(ano - 1)} AND fv.VENTAS_NETAS > 0 {pvta_cond} {exp_cond}
            )
            SELECT
                COUNT(ant.NUMERO_CLIENTE)                                 AS n_ant,
                COUNT(cur.NUMERO_CLIENTE)                                 AS n_retenidos,
                COUNT(DISTINCT cur.NUMERO_CLIENTE)                        AS n_cur_total
            FROM ant
            LEFT JOIN cur ON ant.NUMERO_CLIENTE = cur.NUMERO_CLIENTE
        """
        df_ret = connector.query(sql_retencion)
        df_ret.columns = [c.lower() for c in df_ret.columns]
        n_ant      = int(df_ret.iloc[0]["n_ant"] or 0)
        n_retenidos = int(df_ret.iloc[0]["n_retenidos"] or 0)
        n_cur_total = int(df_ret.iloc[0]["n_cur_total"] or 0)
        retencion_pct = round(n_retenidos / n_ant * 100, 1) if n_ant > 0 else None
        clientes_perdidos = n_ant - n_retenidos

        # ── 3. Clientes nuevos (compraron este año, no en años anteriores) ────
        sql_nuevos = f"""
            WITH cur AS (
                SELECT fv.NUMERO_CLIENTE,
                       COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn,
                       dc.NOMBRE
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                LEFT JOIN {cfg.TM('DIM_CLIENTE')} dc ON fv.NUMERO_CLIENTE = dc.NUMERO_CLIENTE
                WHERE {_mes_where(ano)} AND fv.VENTAS_NETAS > 0 {pvta_cond} {exp_cond}
                GROUP BY 1, 3
            ),
            hist AS (
                SELECT DISTINCT NUMERO_CLIENTE
                FROM {cfg.T('FACT_VENTAS')}
                WHERE ANO_FISCAL < {ano}
            )
            SELECT COUNT(*) AS n_nuevos, COALESCE(SUM(cur.vn), 0) AS vn_nuevos
            FROM cur
            LEFT JOIN hist ON cur.NUMERO_CLIENTE = hist.NUMERO_CLIENTE
            WHERE hist.NUMERO_CLIENTE IS NULL
        """
        df_nv = connector.query(sql_nuevos)
        df_nv.columns = [c.lower() for c in df_nv.columns]
        n_nuevos   = int(df_nv.iloc[0]["n_nuevos"] or 0)
        vn_nuevos  = float(df_nv.iloc[0]["vn_nuevos"] or 0)

        # ── 4. $ Recuperable — inactivos con historial alto (3+ meses) ────────
        sql_recup = f"""
            WITH hist AS (
                SELECT fv.NUMERO_CLIENTE,
                       MAX(fv.FECHA_FACTURA)  AS ultima_compra,
                       SUM(fv.VENTAS_NETAS)   AS ventas_historico
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                WHERE fv.VENTAS_NETAS > 0 {pvta_cond} {exp_cond}
                GROUP BY 1
                HAVING MAX(fv.FECHA_FACTURA) < DATEADD('month', -3, CURRENT_DATE())
                   AND SUM(fv.VENTAS_NETAS) > 5000000
            )
            SELECT COUNT(*) AS n_inactivos,
                   COALESCE(SUM(ventas_historico), 0) AS vn_recuperable
            FROM hist
        """
        df_rec = connector.query(sql_recup)
        df_rec.columns = [c.lower() for c in df_rec.columns]
        n_inactivos   = int(df_rec.iloc[0]["n_inactivos"] or 0)
        vn_recuperable = float(df_rec.iloc[0]["vn_recuperable"] or 0)

        # ── 5. $ en riesgo — clientes con caída >20% YoY ─────────────────────
        sql_riesgo = f"""
            WITH cur AS (
                SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                WHERE {_mes_where(ano)} {pvta_cond} {exp_cond}
                GROUP BY 1
            ),
            ant AS (
                SELECT fv.NUMERO_CLIENTE, COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_ant
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                WHERE {_mes_where(ano - 1)} {pvta_cond} {exp_cond}
                GROUP BY 1
            )
            SELECT
                COUNT(*) AS n_riesgo,
                COALESCE(SUM(ant.vn_ant), 0) AS monto_en_riesgo
            FROM cur JOIN ant ON cur.NUMERO_CLIENTE = ant.NUMERO_CLIENTE
            WHERE ant.vn_ant > 0
              AND ((cur.vn - ant.vn_ant) / ABS(ant.vn_ant) * 100) <= -20
        """
        df_risk = connector.query(sql_riesgo)
        df_risk.columns = [c.lower() for c in df_risk.columns]
        n_riesgo       = int(df_risk.iloc[0]["n_riesgo"] or 0)
        monto_en_riesgo = float(df_risk.iloc[0]["monto_en_riesgo"] or 0)

        # ── 6. Cross-sell: clientes comprando de 1 sola línea de negocio ─────
        sql_cross = f"""
            SELECT COUNT(DISTINCT fv.NUMERO_CLIENTE) AS n_mono_linea,
                   COALESCE(SUM(fv.VENTAS_NETAS), 0) AS vn_mono
            FROM (
                SELECT fv.NUMERO_CLIENTE,
                       COUNT(DISTINCT dgp.LINEA_NEGOCIO) AS n_lineas,
                       SUM(fv.VENTAS_NETAS) AS VENTAS_NETAS
                FROM {cfg.T('FACT_VENTAS')} fv {exp_join}
                LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO
                WHERE {_mes_where(ano)} AND fv.VENTAS_NETAS > 0
                  AND dgp.LINEA_NEGOCIO IS NOT NULL
                  {pvta_cond} {exp_cond}
                GROUP BY 1
                HAVING COUNT(DISTINCT dgp.LINEA_NEGOCIO) = 1
            ) fv
        """
        df_cross = connector.query(sql_cross)
        df_cross.columns = [c.lower() for c in df_cross.columns]
        n_mono_linea = int(df_cross.iloc[0]["n_mono_linea"] or 0)
        vn_mono      = float(df_cross.iloc[0]["vn_mono"] or 0)
        pct_mono     = round(n_mono_linea / n_total_clientes * 100, 1) if n_total_clientes > 0 else 0

    except Exception as exc:
        logger.error("Oportunidades error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    # ── Armar acciones prioritarias ───────────────────────────────────────────
    acciones = []

    if n_riesgo > 0:
        acciones.append({
            "bucket": "retener",
            "prioridad": 1,
            "titulo": f"{n_riesgo} clientes con caída >20% YoY",
            "descripcion": f"Estos clientes facturaron {_fmt_cop(monto_en_riesgo)} el año pasado. Contactarlos esta semana puede frenar la pérdida.",
            "impacto_cop": round(monto_en_riesgo, 0),
            "impacto_label": _fmt_cop(monto_en_riesgo),
            "n_clientes": n_riesgo,
            "urgencia": "alta",
        })

    if n_inactivos > 0:
        acciones.append({
            "bucket": "recuperar",
            "prioridad": 2,
            "titulo": f"{n_inactivos} clientes inactivos +3 meses con alto historial",
            "descripcion": f"Su facturación histórica acumulada asciende a {_fmt_cop(vn_recuperable)}. Una campaña de reactivación puede recuperar 10-30% de ese valor.",
            "impacto_cop": round(vn_recuperable * 0.15, 0),  # conservative 15% recovery estimate
            "impacto_label": _fmt_cop(vn_recuperable),
            "n_clientes": n_inactivos,
            "urgencia": "media",
        })

    if n_nuevos > 0:
        acciones.append({
            "bucket": "crecer",
            "prioridad": 3,
            "titulo": f"{n_nuevos} clientes nuevos — consolidar relación",
            "descripcion": f"Facturaron {_fmt_cop(vn_nuevos)} en su primer año. Asignarles un asesor fijo y definir mínimo de pedido recurrente duplica la tasa de retención.",
            "impacto_cop": round(vn_nuevos, 0),
            "impacto_label": _fmt_cop(vn_nuevos),
            "n_clientes": n_nuevos,
            "urgencia": "media",
        })

    if n_mono_linea > 0 and pct_mono > 20:
        acciones.append({
            "bucket": "crecer",
            "prioridad": 4,
            "titulo": f"{n_mono_linea} clientes compran de 1 sola línea ({pct_mono:.0f}% del total)",
            "descripcion": f"Ofrecerles productos de otras líneas puede aumentar el ticket promedio 20-40% sin costo de adquisición. Facturan {_fmt_cop(vn_mono)} actualmente.",
            "impacto_cop": round(vn_mono * 0.25, 0),
            "impacto_label": _fmt_cop(vn_mono),
            "n_clientes": n_mono_linea,
            "urgencia": "baja",
        })

    acciones.sort(key=lambda a: -a["impacto_cop"])

    result = {
        "ano": ano, "mes": mes,
        "concentracion": {
            "pct_top5":  pct_top5,
            "pct_top10": pct_top10,
            "top5": top5_list,
            "n_total_clientes": n_total_clientes,
            "pareto_80_n": pareto_80,
            "riesgo_concentracion": "alto" if pct_top5 > 50 else "medio" if pct_top5 > 30 else "bajo",
        },
        "retencion": {
            "pct":             retencion_pct,
            "n_retenidos":     n_retenidos,
            "n_ant":           n_ant,
            "n_cur":           n_cur_total,
            "clientes_perdidos": clientes_perdidos,
            "nuevos":          n_nuevos,
            "vn_nuevos":       round(vn_nuevos, 0),
        },
        "riesgo": {
            "n_clientes":     n_riesgo,
            "monto_en_riesgo": round(monto_en_riesgo, 0),
        },
        "recuperacion": {
            "n_inactivos":     n_inactivos,
            "vn_recuperable":  round(vn_recuperable, 0),
        },
        "cross_sell": {
            "n_mono_linea": n_mono_linea,
            "pct_mono":     pct_mono,
            "vn_mono":      round(vn_mono, 0),
        },
        "pareto_data": pareto_data[:30],  # enough for chart
        "acciones": acciones,
        "total_vn": round(total_vn, 0),
    }
    cache.set(key, result)
    return result


def _fmt_cop(v):
    a = abs(v)
    if a >= 1_000_000_000:
        return f"${a/1_000_000_000:.1f}MM"
    if a >= 1_000_000:
        return f"${a/1_000_000:.0f}M"
    if a >= 1_000:
        return f"${a/1_000:.0f}K"
    return f"${a:.0f}"
