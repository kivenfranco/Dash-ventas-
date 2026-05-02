"""
GET /api/kpis — Todos los KPIs del modelo BI Ventas.

Schemas Snowflake:
  GOLD.VENTAS:   FACT_VENTAS, DIM_ESTADO_CLIENTE, PP_REGION_PLANTA_GRUPO,
                 PP_VENDEDOR_CANTIDAD, PP_VENDEDOR_VALOR, DIM_VENDEDOR_PP
  GOLD.MAESTROS: DIM_CLIENTE, DIM_DOMICILIO, DIM_TERRITORIO, DIM_REGION,
                 DIM_TIEMPO, DIM_VENDEDOR, DIM_GRUPO_PRODUCTO, DIM_GRUPO_COMERCIAL,
                 DIM_PARTE, DIM_MERCADO
"""

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/kpis", tags=["KPIs"])
logger = logging.getLogger(__name__)


def _safe_div(a, b, default=0.0):
    try:
        return a / b if b and b != 0 else default
    except Exception:
        return default


def _pct_change(current, previous):
    if previous is None or previous == 0:
        return None
    return round(((current - previous) / abs(previous)) * 100, 2)


class KPIEngine:
    def __init__(self, cfg, ano, mes, region, vendedor, grupo_comercial, planta, mercado, excl_exportacion=False, excl_pvta=False, mes_fin=None):
        self.cfg = cfg
        self.ano = ano
        self.mes = mes
        self.mes_fin = mes_fin if (mes_fin and mes_fin != mes and mes_fin > (mes or 0)) else None
        self.region = region
        self.vendedor = vendedor
        self.grupo_comercial = grupo_comercial
        self.planta = planta
        self.mercado = mercado
        self.excl_exportacion = excl_exportacion
        self.excl_pvta = excl_pvta

    # ── JOIN / WHERE builder ──────────────────────────────────────────────────

    def _fact_sql(self, select: str, ano=None, mes=None, mes_max=None, mes_fin=None) -> tuple[str, list]:
        _ano     = ano    if ano    is not None else self.ano
        _mes     = mes    if mes    is not None else self.mes
        _mes_fin = mes_fin if mes_fin is not None else self.mes_fin

        joins, cond, params = [], [], []

        cond.append("fv.ANO_FISCAL = %s")
        params.append(_ano)
        if _mes and _mes_fin and _mes_fin > _mes:
            cond.append("fv.PERIODO_FISCAL BETWEEN %s AND %s")
            params.extend([_mes, _mes_fin])
        elif _mes:
            cond.append("fv.PERIODO_FISCAL = %s")
            params.append(_mes)
        elif mes_max:
            cond.append("fv.PERIODO_FISCAL <= %s")
            params.append(mes_max)

        if self.region:
            joins.append(
                f"LEFT JOIN {self.cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
            )
            cond.append("dd.DESCRIPCION_REGION = %s")
            params.append(self.region)

        if self.vendedor:
            cond.append("fv.CODIGO_VENDEDOR = %s")
            params.append(self.vendedor)

        if self.grupo_comercial or self.planta:
            joins.append(
                f"LEFT JOIN {self.cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO"
            )
            if self.grupo_comercial:
                joins.append(
                    f"LEFT JOIN {self.cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO"
                )
                cond.append("dgc.NOMBRE_GRUPO = %s")
                params.append(self.grupo_comercial)
            if self.planta:
                cond.append("dgp.LINEA_NEGOCIO = %s")
                params.append(self.planta)

        if self.excl_exportacion:
            if not any("DIM_DOMICILIO" in j for j in joins):
                joins.append(f"LEFT JOIN {self.cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
            cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")
        if self.excl_pvta:
            cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

        join_str  = " ".join(joins)
        where_str = "WHERE " + " AND ".join(cond)
        sql = f"SELECT {select} FROM {self.cfg.T('FACT_VENTAS')} fv {join_str} {where_str}"
        return sql, params

    # ── individual queries ────────────────────────────────────────────────────

    def _ventas(self, ano=None, mes=None, mes_max=None) -> tuple[float, float, float]:
        sql, params = self._fact_sql(
            "COALESCE(SUM(fv.VENTAS_NETAS),0) AS vn,"
            "COALESCE(SUM(fv.VENTAS_DOLARES),0) AS vd,"
            "COALESCE(SUM(fv.CANTIDAD),0) AS qt",
            ano=ano, mes=mes, mes_max=mes_max,
        )
        df = connector.query(sql, params)
        if df.empty:
            return 0.0, 0.0, 0.0
        r = df.iloc[0]
        return float(r.get("VN") or 0), float(r.get("VD") or 0), float(r.get("QT") or 0)

    def _pp_region_planta(self, ano=None, mes=None) -> float:
        """PP Region Planta Mes — GOLD.VENTAS.PP_REGION_PLANTA_GRUPO"""
        _ano     = ano or self.ano
        _mes     = mes if mes is not None else self.mes
        _mes_fin = self.mes_fin
        cond, params = ["ANO = %s"], [_ano]
        if _mes and _mes_fin and _mes_fin > _mes:
            cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([_mes, _mes_fin])
        elif _mes:
            cond.append("MES_NUM = %s"); params.append(_mes)
        if self.region:
            cond.append("REGION = %s"); params.append(self.region)
        if self.grupo_comercial:
            cond.append("GRUPO_COMERCIAL = %s"); params.append(self.grupo_comercial)
        if self.planta:
            cond.append("PLANTA = %s"); params.append(self.planta)
        if self.excl_exportacion:
            cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
        where = "WHERE " + " AND ".join(cond)
        sql = f"SELECT COALESCE(SUM(PRESUPUESTO_MES),0) AS pp FROM {self.cfg.T('PP_REGION_PLANTA_GRUPO')} {where}"
        df = connector.query(sql, params)
        return float(df.iloc[0]["PP"]) if not df.empty else 0.0

    def _working_days(self, ano=None, mes=None) -> tuple[int, int]:
        """Dias hábiles mes + transcurridos — GOLD.MAESTROS.DIM_TIEMPO"""
        _ano     = ano or self.ano
        _mes     = mes if mes is not None else self.mes
        _mes_fin = self.mes_fin
        cond, params = ["ANO = %s"], [_ano]
        if _mes and _mes_fin and _mes_fin > _mes:
            cond.append("MES_NUM BETWEEN %s AND %s"); params.extend([_mes, _mes_fin])
        elif _mes:
            cond.append("MES_NUM = %s"); params.append(_mes)
        where = "WHERE " + " AND ".join(cond)
        today = date.today().isoformat()
        sql = f"""
            SELECT
                COALESCE(SUM(DIA_HABIL), 0) AS dias_mes,
                COALESCE(SUM(CASE WHEN FECHA <= '{today}' THEN DIA_HABIL ELSE 0 END), 0) AS dias_trans
            FROM {self.cfg.TM('DIM_TIEMPO')} {where}
        """
        df = connector.query(sql, params)
        if df.empty:
            return 0, 0
        r = df.iloc[0]
        return int(r.get("DIAS_MES") or 0), int(r.get("DIAS_TRANS") or 0)

    def _clientes(self) -> dict:
        """
        Clientes por estado — GOLD.VENTAS.DIM_ESTADO_CLIENTE
        DAX TREATAS + REMOVEFILTERS(fechas) → filtra dims, ignora fecha.
        """
        fact_joins, fact_cond, fact_params = [], [], []
        if self.region:
            fact_joins.append(
                f"LEFT JOIN {self.cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY"
            )
            fact_cond.append("dd.DESCRIPCION_REGION = %s"); fact_params.append(self.region)
        if self.vendedor:
            fact_cond.append("fv.CODIGO_VENDEDOR = %s"); fact_params.append(self.vendedor)
        if self.excl_pvta:
            fact_cond.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")
        if self.excl_exportacion:
            if not any("DIM_DOMICILIO" in j for j in fact_joins):
                fact_joins.append(f"LEFT JOIN {self.cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
            fact_cond.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")

        join_str  = " ".join(fact_joins)
        inner_where = ("WHERE " + " AND ".join(fact_cond)) if fact_cond else ""
        sql = f"""
            SELECT dec.ESTADO_CLIENTE, COUNT(*) AS cnt
            FROM {self.cfg.T('DIM_ESTADO_CLIENTE')} dec
            WHERE dec.ID_CLIENTE IN (
                SELECT DISTINCT fv.ID_CLIENTE
                FROM {self.cfg.T('FACT_VENTAS')} fv
                {join_str} {inner_where}
            )
            GROUP BY dec.ESTADO_CLIENTE
        """
        df = connector.query(sql, fact_params)

        result = dict(total_clientes=0, clientes_activos=0, clientes_nuevos=0,
                      clientes_perdidos=0, clientes_riesgo=0, clientes_seguimiento=0)
        for _, row in df.iterrows():
            estado = str(row.get("ESTADO_CLIENTE") or "").upper()
            cnt    = int(row.get("CNT") or 0)
            result["total_clientes"] += cnt
            key = {"ACTIVO":"clientes_activos","NUEVO":"clientes_nuevos",
                   "PERDIDO":"clientes_perdidos","RIESGO":"clientes_riesgo",
                   "SEGUIMIENTO":"clientes_seguimiento"}.get(estado)
            if key:
                result[key] = cnt
        return result

    # ── main ──────────────────────────────────────────────────────────────────

    def compute(self) -> dict:
        vn, vd, qty       = self._ventas()

        # When viewing full year of current year, compare same YTD period in prior year
        ytd_cap = date.today().month if (not self.mes and self.ano == date.today().year) else None
        vn_ano_ant, _, _  = self._ventas(ano=self.ano - 1, mes=self.mes, mes_max=ytd_cap)

        if self.mes and not self.mes_fin:
            mes_ant     = self.mes - 1 if self.mes > 1 else 12
            ano_mes_ant = self.ano     if self.mes > 1 else self.ano - 1
            vn_mes_ant, _, _ = self._ventas(ano=ano_mes_ant, mes=mes_ant)
        else:
            vn_mes_ant = None

        pp            = self._pp_region_planta()
        dias_mes, dias_trans = self._working_days()

        debe_ser   = pp  * _safe_div(dias_trans, dias_mes)
        proyeccion = vn  * _safe_div(dias_mes, dias_trans)
        cump_pct   = _safe_div(vn, debe_ser)   * 100
        cump_pp    = _safe_div(vn, pp)          * 100

        clientes = self._clientes()

        return {
            "filtros": {"ano": self.ano, "mes": self.mes, "region": self.region,
                        "vendedor": self.vendedor, "grupo_comercial": self.grupo_comercial,
                        "planta": self.planta},
            "ventas_netas":               round(vn, 2),
            "ventas_dolares":             round(vd, 2),
            "cantidad":                   round(qty, 2),
            "pp_region_planta_mes":       round(pp, 2),
            "debe_ser":                   round(debe_ser, 2),
            "cump_pct":                   round(cump_pct, 2),
            "cump_pp_pct":                round(cump_pp, 2),
            "proyeccion":                 round(proyeccion, 2),
            "dias_habiles_mes":           dias_mes,
            "dias_habiles_transcurridos": dias_trans,
            **clientes,
            "venta_ano_anterior":         round(vn_ano_ant, 2),
            "venta_mes_anterior":         round(vn_mes_ant, 2) if vn_mes_ant is not None else None,
            "variacion_yoy_pct":          _pct_change(vn, vn_ano_ant),
            "variacion_mom_pct":          _pct_change(vn, vn_mes_ant) if vn_mes_ant is not None else None,
        }


@router.get("")
def get_kpis(
    ano: int = Query(default_factory=lambda: date.today().year),
    mes: Optional[int] = Query(None, ge=1, le=12),
    mes_fin: Optional[int] = Query(None, ge=1, le=12),
    region: Optional[str] = None,
    vendedor: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    mercado: Optional[str] = None,
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
):
    cfg = get_settings()
    key = f"kpis:{ano}:{mes}:{mes_fin}:{region}:{vendedor}:{grupo_comercial}:{planta}:{mercado}:{excl_exportacion}:{excl_pvta}"
    cached = cache.get(key)
    if cached:
        return cached
    try:
        result = KPIEngine(cfg, ano, mes, region, vendedor, grupo_comercial, planta, mercado, excl_exportacion, excl_pvta, mes_fin=mes_fin).compute()
    except Exception as exc:
        logger.error("KPI error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))
    cache.set(key, result)
    return result
