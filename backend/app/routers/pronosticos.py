"""
GET /api/pronosticos — Pronósticos de ventas con WMA, Holt-Winters, Regresión Lineal y Auto.
Incluye balance del mes actual (real vs. proyectado) y comparativas mes a mes.
"""
import calendar
import logging
from datetime import date
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..database.cache import cache
from ..database.snowflake_connector import connector

router = APIRouter(prefix="/api/pronosticos", tags=["Pronosticos"])
logger = logging.getLogger(__name__)


# ── Outlier removal ──────────────────────────────────────────────────────────

def _remove_outliers(series: np.ndarray) -> np.ndarray:
    if len(series) < 6:
        return series
    q1, q3 = np.percentile(series, 25), np.percentile(series, 75)
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    median = np.median(series)
    return np.where((series < lo) | (series > hi), median, series)


# ── Statistical models ───────────────────────────────────────────────────────

def _wma_forecast(series: np.ndarray, steps: int, window: int = 12) -> tuple[np.ndarray, np.ndarray]:
    n = len(series)
    w = min(window, n)
    alpha = 0.3
    weights = np.array([alpha * (1 - alpha) ** i for i in range(w)])[::-1]
    weights /= weights.sum()

    preds_in = []
    for i in range(w, n):
        preds_in.append(float(np.dot(weights, series[i - w: i])))
    residuals = series[w:] - np.array(preds_in) if preds_in else np.array([0.0])

    history = list(series)
    forecasts = []
    for _ in range(steps):
        seg = np.array(history[-w:])
        forecasts.append(float(np.dot(weights, seg)))
        history.append(forecasts[-1])
    return np.array(forecasts), residuals


def _lr_forecast(series: np.ndarray, steps: int) -> tuple[np.ndarray, np.ndarray, float]:
    x = np.arange(len(series), dtype=float)
    coeffs = np.polyfit(x, series, 1)
    fitted = np.polyval(coeffs, x)
    residuals = series - fitted
    ss_tot = np.sum((series - series.mean()) ** 2)
    r2 = max(0.0, float(1 - np.sum(residuals ** 2) / ss_tot)) if ss_tot > 0 else 0.0
    future_x = np.arange(len(series), len(series) + steps, dtype=float)
    return np.polyval(coeffs, future_x), residuals, r2


def _hw_forecast(series: np.ndarray, steps: int) -> tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """Triple exponential smoothing for ≥24 months; Holt double (trend only) for 4-23 months.
    Seasonal HW requires at least 2 full seasonal cycles (24 months for monthly data)."""
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        n = len(series)
        if n >= 24:
            # Triple: trend + annual seasonality
            model = ExponentialSmoothing(
                series, trend="add", seasonal="add",
                seasonal_periods=12, initialization_method="estimated",
            )
        elif n >= 4:
            # Double: trend only — not enough data for annual seasonal estimation
            model = ExponentialSmoothing(series, trend="add", initialization_method="estimated")
        else:
            return None, None
        fitted = model.fit(optimized=True)
        return np.array(fitted.forecast(steps)), np.array(series - fitted.fittedvalues)
    except Exception as exc:
        logger.warning("HW failed: %s", exc)
        return None, None


def _build_ci(forecasts: np.ndarray, residuals: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    margin_base = float(1.96 * np.std(residuals)) if len(residuals) >= 3 else float(np.abs(forecasts).mean()) * 0.15
    margins = margin_base * np.sqrt(np.arange(1, len(forecasts) + 1))
    return forecasts - margins, forecasts + margins


def _mape(actual: np.ndarray, pred: np.ndarray) -> float:
    mask = actual != 0
    return float(np.mean(np.abs((actual[mask] - pred[mask]) / actual[mask])) * 100) if mask.any() else 9999.0


def _mae(actual: np.ndarray, pred: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - pred)))


def _rmse(actual: np.ndarray, pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((actual - pred) ** 2)))


# ── Sliding-window cross-validation ─────────────────────────────────────────

def _auto_select(series: np.ndarray) -> str:
    n = len(series)
    if n < 8:
        return "wma"
    # For long series: keep train ≥ 24 so HW can use annual seasonality (requires 2 full cycles)
    raw_test = max(3, n // 5)
    test_size = min(raw_test, n - 24) if n > 24 else raw_test
    test_size = max(3, test_size)
    train, test = series[:-test_size], series[-test_size:]
    scores: dict[str, float] = {}
    try:
        wf, _ = _wma_forecast(train, test_size)
        scores["wma"] = _mape(test, wf)
    except Exception:
        pass
    try:
        lf, _, _ = _lr_forecast(train, test_size)
        scores["lr"] = _mape(test, lf)
    except Exception:
        pass
    try:
        hf, _ = _hw_forecast(train, test_size)
        if hf is not None:
            scores["hw"] = _mape(test, hf)
    except Exception:
        pass
    if not scores:
        return "wma"
    best      = min(scores, key=scores.get)
    best_mape = scores[best]
    # For long series (≥24 months) prefer HW when it's within 40% of the best model:
    # HW captures trend + seasonality giving meaningful month-to-month variation vs
    # WMA's flat forecast. The 40% tolerance is worth the occasional small accuracy trade-off.
    if n >= 24 and "hw" in scores and scores["hw"] <= best_mape * 1.40:
        return "hw"
    return best


def _sliding_window_metrics(series: np.ndarray, modelo: str) -> dict:
    """Compute avg metrics across multiple sliding windows for confidence reporting."""
    n = len(series)
    if n < 10:
        return {}
    window_size = max(8, n - 6)
    maes, mapes, rmses = [], [], []
    for start in range(0, n - window_size - 2):
        train = series[start: start + window_size]
        test = series[start + window_size: start + window_size + 3]
        if len(test) < 2:
            continue
        try:
            if modelo == "wma":
                pf, _ = _wma_forecast(train, len(test))
            elif modelo == "hw":
                pf, _ = _hw_forecast(train, len(test))
                if pf is None:
                    continue
            else:
                pf, _, _ = _lr_forecast(train, len(test))
            maes.append(_mae(test, pf))
            mapes.append(_mape(test, pf))
            rmses.append(_rmse(test, pf))
        except Exception:
            pass
    if not maes:
        return {}
    return {
        "mae_cv": round(float(np.mean(maes)), 0),
        "mape_cv": round(float(np.mean(mapes)), 2),
        "rmse_cv": round(float(np.mean(rmses)), 0),
        "ventanas_evaluadas": len(maes),
    }


# ── SQL filter builder ───────────────────────────────────────────────────────

def _build_filters(cfg, region, vendedor, grupo_comercial, planta, linea_negocio, es_stock, excl_exportacion, excl_pvta):
    joins, conds, params = [], [], []

    if region:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        conds.append("dd.DESCRIPCION_REGION = %s"); params.append(region)

    if vendedor:
        conds.append("fv.CODIGO_VENDEDOR = %s"); params.append(vendedor)

    needs_gp = grupo_comercial or linea_negocio or planta
    if needs_gp:
        joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_PRODUCTO')} dgp ON fv.CODIGO_PRODUCTO = dgp.CODIGO_PRODUCTO")
        if grupo_comercial:
            joins.append(f"LEFT JOIN {cfg.TM('DIM_GRUPO_COMERCIAL')} dgc ON dgp.CODIGO_GRUPO_COMERCIAL = dgc.CODIGO_GRUPO")
            conds.append("dgc.NOMBRE_GRUPO = %s"); params.append(grupo_comercial)
        if linea_negocio:
            conds.append("dgp.LINEA_NEGOCIO = %s"); params.append(linea_negocio)
        elif planta:
            conds.append("dgp.LINEA_NEGOCIO = %s"); params.append(planta)

    if es_stock in ("stock", "no_stock"):
        joins.append(f"LEFT JOIN {cfg.TM('DIM_PARTE')} dp ON fv.CODIGO_PRODUCTO = dp.CODIGO_PRODUCTO")
        conds.append("dp.ES_STOCK = TRUE" if es_stock == "stock" else "dp.ES_STOCK = FALSE")

    if excl_exportacion:
        if not any("DIM_DOMICILIO" in j for j in joins):
            joins.append(f"LEFT JOIN {cfg.TM('DIM_DOMICILIO')} dd ON fv.DOMICILIO_KEY = dd.DOMICILIO_KEY")
        conds.append("(UPPER(dd.DESCRIPCION_REGION) NOT LIKE '%%EXPORTACION%%' OR dd.DESCRIPCION_REGION IS NULL)")

    if excl_pvta:
        conds.append("(UPPER(fv.CODIGO_VENDEDOR) NOT LIKE 'PVTA%%' OR fv.CODIGO_VENDEDOR IS NULL)")

    join_str = " ".join(joins)
    where_ext = (" AND " + " AND ".join(conds)) if conds else ""
    return join_str, where_ext, params


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.get("")
def get_pronosticos(
    vendedor: Optional[str] = None,
    region: Optional[str] = None,
    grupo_comercial: Optional[str] = None,
    planta: Optional[str] = None,
    linea_negocio: Optional[str] = None,
    es_stock: Optional[str] = Query(None),
    excl_exportacion: bool = Query(False),
    excl_pvta: bool = Query(False),
    modelo: str = Query("auto"),
    meses_pronostico: int = Query(3),
    excl_outliers: bool = Query(False),
):
    cfg = get_settings()
    cache_key = (
        f"pron:{vendedor}:{region}:{grupo_comercial}:{planta}:{linea_negocio}:"
        f"{es_stock}:{excl_exportacion}:{excl_pvta}:{modelo}:{meses_pronostico}:{excl_outliers}"
    )
    cached = cache.get(cache_key)
    if cached:
        return cached

    join_str, where_ext, dim_params = _build_filters(
        cfg, region, vendedor, grupo_comercial, planta, linea_negocio, es_stock, excl_exportacion, excl_pvta
    )

    today = date.today()
    current_year = today.year
    current_month = today.month
    years = [current_year - 2, current_year - 1, current_year]
    year_ph = ",".join(["%s"] * len(years))

    # ── Historical monthly series ─────────────────────────────────────────────
    hist_sql = f"""
        SELECT fv.ANO_FISCAL, fv.PERIODO_FISCAL,
               COALESCE(SUM(fv.VENTAS_NETAS), 0) AS ventas_netas,
               COALESCE(SUM(fv.CANTIDAD), 0)     AS cantidad
        FROM {cfg.T('FACT_VENTAS')} fv
        {join_str}
        WHERE fv.ANO_FISCAL IN ({year_ph}) {where_ext}
        GROUP BY 1, 2
        ORDER BY 1, 2
    """

    # ── Presupuesto mensual ───────────────────────────────────────────────────
    pp_cond, pp_params = ["ANO IN ({})".format(year_ph)], list(years)
    if region:          pp_cond.append("REGION = %s");          pp_params.append(region)
    if grupo_comercial: pp_cond.append("GRUPO_COMERCIAL = %s"); pp_params.append(grupo_comercial)
    if planta:          pp_cond.append("PLANTA = %s");          pp_params.append(planta)
    if excl_exportacion: pp_cond.append("UPPER(REGION) NOT LIKE '%%EXPORTACION%%'")
    pp_sql = f"""
        SELECT ANO, MES_NUM, COALESCE(SUM(PRESUPUESTO_MES), 0) AS pp
        FROM {cfg.T('PP_REGION_PLANTA_GRUPO')}
        WHERE {' AND '.join(pp_cond)}
        GROUP BY 1, 2
    """

    try:
        df = connector.query(hist_sql, years + dim_params)
        try:
            df_pp = connector.query(pp_sql, pp_params)
            df_pp.columns = [c.lower() for c in df_pp.columns]
            pp_lookup = {(int(r["ano"]), int(r["mes_num"])): float(r["pp"]) for _, r in df_pp.iterrows()}
        except Exception:
            pp_lookup = {}
    except Exception as exc:
        logger.error("Pronosticos error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))

    df.columns = [c.lower() for c in df.columns]
    df = df.sort_values(["ano_fiscal", "periodo_fiscal"])

    # Build historico with month-over-month comparison
    raw_ventas = []
    for _, row in df.iterrows():
        raw_ventas.append({
            "ano": int(row["ano_fiscal"]),
            "mes": int(row["periodo_fiscal"]),
            "ventas_netas": round(float(row["ventas_netas"]), 2),
            "cantidad": round(float(row["cantidad"]), 2),
        })

    historico = []
    vals = [r["ventas_netas"] for r in raw_ventas]
    avg_12 = float(np.mean(vals[-12:])) if len(vals) >= 12 else (float(np.mean(vals)) if vals else 0)

    for i, r in enumerate(raw_ventas):
        prev_vn = raw_ventas[i - 1]["ventas_netas"] if i > 0 else None
        var_mes_ant = None
        if prev_vn is not None and prev_vn != 0:
            var_mes_ant = round((r["ventas_netas"] - prev_vn) / abs(prev_vn) * 100, 2)
        vs_promedio = None
        if avg_12 != 0:
            vs_promedio = round((r["ventas_netas"] - avg_12) / abs(avg_12) * 100, 2)
        pp_mes = pp_lookup.get((r["ano"], r["mes"]), None)

        historico.append({
            "periodo": f"{r['ano']}-{r['mes']:02d}",
            "ano": r["ano"],
            "mes": r["mes"],
            "ventas_netas": r["ventas_netas"],
            "cantidad": r["cantidad"],
            "var_mes_ant_pct": var_mes_ant,
            "vs_promedio_pct": vs_promedio,
            "presupuesto": round(pp_mes, 2) if pp_mes is not None else None,
            "vs_pp_pct": round((r["ventas_netas"] - pp_mes) / abs(pp_mes) * 100, 2) if pp_mes else None,
        })

    if len(historico) < 4:
        result = {"historico": historico, "pronostico": [], "modelo_usado": None, "metricas": {}, "balance_mes": None}
        cache.set(cache_key, result)
        return result

    # Separate current month from training series (partial month skews forecast)
    last = historico[-1]
    is_current_month = (last["ano"] == current_year and last["mes"] == current_month)
    train_historico = historico[:-1] if is_current_month else historico
    series_full = np.array([h["ventas_netas"] for h in train_historico])

    if excl_outliers:
        series_full = _remove_outliers(series_full)

    if len(series_full) < 4:
        result = {"historico": historico, "pronostico": [], "modelo_usado": None, "metricas": {}, "balance_mes": None}
        cache.set(cache_key, result)
        return result

    # ── Model selection ───────────────────────────────────────────────────────
    modelo_final = _auto_select(series_full) if modelo == "auto" else modelo
    r2 = None

    if modelo_final == "hw":
        forecasts_arr, residuals = _hw_forecast(series_full, meses_pronostico + (1 if is_current_month else 0))
        if forecasts_arr is None:
            modelo_final = "wma"
            forecasts_arr, residuals = _wma_forecast(series_full, meses_pronostico + (1 if is_current_month else 0))
    elif modelo_final == "lr":
        forecasts_arr, residuals, r2 = _lr_forecast(series_full, meses_pronostico + (1 if is_current_month else 0))
    else:
        forecasts_arr, residuals = _wma_forecast(series_full, meses_pronostico + (1 if is_current_month else 0))

    forecasts_arr = np.maximum(forecasts_arr, 0)
    ci_lower, ci_upper = _build_ci(forecasts_arr, residuals)
    ci_lower = np.maximum(ci_lower, 0)

    # ── Balance del mes actual ────────────────────────────────────────────────
    balance_mes = None

    if is_current_month:
        real_mtd = last["ventas_netas"]
        forecast_mes = float(forecasts_arr[0])
        ci_lo_mes = float(ci_lower[0])
        ci_hi_mes = float(ci_upper[0])

        days_elapsed = today.day
        days_total = calendar.monthrange(current_year, current_month)[1]
        extrapol_factor = days_total / days_elapsed if days_elapsed > 0 else 1
        ventas_extrapoladas = round(real_mtd * extrapol_factor, 2)

        cobertura_pct = round(real_mtd / forecast_mes * 100, 1) if forecast_mes > 0 else None
        pp_mes_actual = pp_lookup.get((current_year, current_month))

        balance_mes = {
            "ano": current_year,
            "mes": current_month,
            "dias_transcurridos": days_elapsed,
            "dias_mes": days_total,
            "pct_mes_transcurrido": round(days_elapsed / days_total * 100, 1),
            "ventas_real_mtd": round(real_mtd, 2),
            "ventas_extrapoladas": ventas_extrapoladas,
            "pronostico_estadistico": round(forecast_mes, 2),
            "ci_lower": round(ci_lo_mes, 2),
            "ci_upper": round(ci_hi_mes, 2),
            "cobertura_pct": cobertura_pct,
            "estimado_restante": round(max(0, forecast_mes - real_mtd), 2),
            "proyectado_total": round(forecast_mes, 2),
            "presupuesto": round(pp_mes_actual, 2) if pp_mes_actual else None,
            "vs_pp_pct": round((forecast_mes - pp_mes_actual) / abs(pp_mes_actual) * 100, 2) if pp_mes_actual else None,
        }

    # ── Build forecast periods ────────────────────────────────────────────────
    # When is_current_month: index 0 = current month full forecast, 1..N = future months.
    # The partial current-month entry is removed from historico and becomes the first
    # pronostico entry (es_mes_actual=True) so the chart shows it as a forecast, not a
    # misleading tiny historical bar.
    base_ano = last["ano"] if is_current_month else historico[-1]["ano"]
    base_mes = last["mes"] if is_current_month else historico[-1]["mes"]

    pronostico = []

    if is_current_month:
        f0   = float(forecasts_arr[0])
        lo0  = float(ci_lower[0])
        hi0  = float(ci_upper[0])
        prev_full = train_historico[-1]["ventas_netas"] if train_historico else None
        var0 = round((f0 - prev_full) / abs(prev_full) * 100, 2) if prev_full else None
        pp0  = pp_lookup.get((current_year, current_month))
        pronostico.append({
            "periodo": f"{current_year}-{current_month:02d}",
            "ano": current_year,
            "mes": current_month,
            "forecast": round(f0, 2),
            "ci_lower": round(lo0, 2),
            "ci_upper": round(hi0, 2),
            "ci_amplitud": round(hi0 - lo0, 2),
            "var_vs_mes_ant_pct": var0,
            "vs_promedio_historico_pct": round((f0 - avg_12) / abs(avg_12) * 100, 2) if avg_12 != 0 else None,
            "presupuesto": round(pp0, 2) if pp0 else None,
            "vs_pp_pct": round((f0 - pp0) / abs(pp0) * 100, 2) if pp0 else None,
            "es_mes_actual": True,
            "ventas_real_mtd": round(last["ventas_netas"], 2),
        })

    for i in range(meses_pronostico):
        idx = (1 if is_current_month else 0) + i
        f   = float(forecasts_arr[idx])
        lo  = float(ci_lower[idx])
        hi  = float(ci_upper[idx])

        mes = base_mes + i + 1
        ano = base_ano
        while mes > 12:
            mes -= 12
            ano += 1

        prev_actual = pronostico[-1]["forecast"] if pronostico else historico[-1]["ventas_netas"]
        var_vs_prev = round((f - prev_actual) / abs(prev_actual) * 100, 2) if prev_actual != 0 else None
        pp = pp_lookup.get((ano, mes))

        pronostico.append({
            "periodo": f"{ano}-{mes:02d}",
            "ano": ano,
            "mes": mes,
            "forecast": round(f, 2),
            "ci_lower": round(lo, 2),
            "ci_upper": round(hi, 2),
            "ci_amplitud": round(hi - lo, 2),
            "var_vs_mes_ant_pct": var_vs_prev,
            "vs_promedio_historico_pct": round((f - avg_12) / abs(avg_12) * 100, 2) if avg_12 != 0 else None,
            "presupuesto": round(pp, 2) if pp else None,
            "vs_pp_pct": round((f - pp) / abs(pp) * 100, 2) if pp else None,
            "es_mes_actual": False,
        })

    # ── Validation metrics ────────────────────────────────────────────────────
    n = len(series_full)
    test_n = min(6, max(2, n // 5))
    metricas: dict = {}
    if test_n >= 2 and n - test_n >= 4:
        train_s, test_s = series_full[: n - test_n], series_full[n - test_n:]
        try:
            if modelo_final == "hw":
                vp, _ = _hw_forecast(train_s, test_n)
                val_pred = vp if vp is not None else np.zeros(test_n)
            elif modelo_final == "lr":
                val_pred, _, r2 = _lr_forecast(train_s, test_n)
            else:
                val_pred, _ = _wma_forecast(train_s, test_n)

            metricas = {
                "mae": round(_mae(test_s, val_pred), 0),
                "mape": round(_mape(test_s, val_pred), 2),
                "rmse": round(_rmse(test_s, val_pred), 0),
            }
            if r2 is not None:
                metricas["r2"] = round(r2, 4)

            # Sliding window metrics
            sw = _sliding_window_metrics(series_full, modelo_final)
            if sw:
                metricas["cv"] = sw
        except Exception as exc:
            logger.warning("Metrics error: %s", exc)

    promedio_historico = round(avg_12, 2)

    # Partial current month is already in pronostico[0] and balance_mes — exclude from historico
    historico_resp = historico[:-1] if is_current_month else historico

    result = {
        "historico": historico_resp,
        "pronostico": pronostico,
        "modelo_usado": modelo_final,
        "modelo_solicitado": modelo,
        "metricas": metricas,
        "balance_mes": balance_mes,
        "promedio_mensual_12m": promedio_historico,
        "excl_outliers_aplicado": excl_outliers,
    }
    cache.set(cache_key, result)
    return result
