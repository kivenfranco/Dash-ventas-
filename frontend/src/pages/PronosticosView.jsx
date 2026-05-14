import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, BarChart,
  Legend,
} from 'recharts'
import {
  TrendingUp, Download, RefreshCw, Info, ChevronDown, ChevronUp,
  BarChart2, AlertTriangle, CheckCircle2, Target,
} from 'lucide-react'
import { ChartDownloadButton } from '../components/charts/ChartDownloadButton'
import * as XLSX from 'xlsx'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP as fmtCOPShared, fmtPct as fmtPctShared, pctColor as pctColorShared, MONTH_NAMES, MONTH_FULL } from '../utils/format'

// ── Constants ────────────────────────────────────────────────────────────────

const MESES_CORTO = MONTH_NAMES
const MESES_LARGO = MONTH_FULL

const MODELOS = [
  { value: 'auto', label: 'Auto', desc: 'Selecciona automáticamente el modelo con menor error en validación cruzada por ventana deslizante' },
  { value: 'wma',  label: 'Promedio Ponderado (WMA)', desc: 'Promedio móvil exponencial, da más peso a periodos recientes. Ideal para series sin estacionalidad clara.' },
  { value: 'hw',   label: 'Holt-Winters',            desc: 'Suavización exponencial triple: capta tendencia + estacionalidad mensual. Requiere ≥ 12 meses.' },
  { value: 'lr',   label: 'Regresión Lineal',        desc: 'Proyección sobre la línea de tendencia histórica. Bueno cuando el crecimiento es constante.' },
]

const HORIZONTES = [3, 6, 12]
const HOY        = new Date()
const MESES_HASTA_DIC = 12 - HOY.getMonth() - 1  // meses completos restantes del año (excl. mes actual en curso)
const MODELO_LABELS = { wma: 'WMA', hw: 'Holt-Winters', lr: 'Reg. Lineal', auto: 'Auto' }

// ── Formatters ───────────────────────────────────────────────────────────────

// Usa el formateador del proyecto: MM para miles de millones, M para millones
const fmtCOP = (v) => fmtCOPShared(v, 2)
const fmtCOPc = (v) => fmtCOPShared(v, 1)   // 1 decimal para espacios reducidos

const fmtPct = (v) => {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

const fmtPeriodo = (p, long = false) => {
  const [y, m] = p.split('-')
  return long ? `${MESES_LARGO[+m]} ${y}` : `${MESES_CORTO[+m]} ${y.slice(2)}`
}

// Formateador del eje Y — muestra en millones sin símbolo de peso para no saturar
const fmtYAxis = (v) => {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}MM`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v}`
}

const pctColor = pctColorShared

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = 'text-slate-100', icon: Icon, badge, onClick }) {
  return (
    <div
      className={`bg-surface-800 rounded-xl border border-surface-700 p-4 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-brand-500/40 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={14} className="text-slate-600" />}
        {badge && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-slate-400">{badge}</span>}
      </div>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

function ModeloBadge({ modelo }) {
  const colors = {
    wma: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    hw:  'bg-violet-500/20 text-violet-300 border-violet-500/30',
    lr:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colors[modelo] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
      {MODELO_LABELS[modelo] ?? modelo}
    </span>
  )
}

function ProgressBar({ pct, color = 'bg-brand-500' }) {
  const w = Math.min(100, Math.max(0, pct ?? 0))
  return (
    <div className="w-full bg-surface-700 rounded-full h-2 mt-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${w}%` }} />
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const hasForecast = payload.some((p) => p.dataKey === 'forecast')
  const ciLo = payload.find((p) => p.dataKey === 'ci_lower')?.value
  const ciHi = payload.find((p) => p.dataKey === 'ci_upper')?.value
  const pointData  = payload[0]?.payload
  const isCurrent  = pointData?.es_mes_actual

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl p-3 shadow-xl text-xs space-y-1.5 min-w-[200px]">
      <p className="font-semibold text-slate-200 border-b border-surface-600 pb-1.5 mb-1 flex items-center gap-1.5">
        {label}
        {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">en curso</span>}
      </p>
      {isCurrent && pointData?.ventas_real_mtd != null && (
        <div className="flex justify-between gap-4 text-slate-400">
          <span className="font-medium">Real acumulado</span>
          <span className="font-semibold">{fmtCOPc(pointData.ventas_real_mtd)}</span>
        </div>
      )}
      {payload.map((p) => {
        if (['ci_upper', 'ci_lower'].includes(p.dataKey)) return null
        const lbl = p.dataKey === 'ventas_netas' ? 'Ventas reales'
          : p.dataKey === 'forecast' ? (isCurrent ? 'Pronóstico mes completo' : 'Pronóstico') : null
        if (!lbl) return null
        return (
          <div key={p.dataKey} className="flex justify-between gap-4">
            <span style={{ color: p.color }} className="font-medium">{lbl}</span>
            <span className="text-slate-200 font-semibold">{fmtCOPc(p.value)}</span>
          </div>
        )
      })}
      {hasForecast && ciLo != null && ciHi != null && (
        <div className="text-slate-400 text-[11px] pt-1 border-t border-surface-600/50">
          IC 95%: {fmtCOPc(ciLo)} – {fmtCOPc(ciHi)}
        </div>
      )}
    </div>
  )
}

// ── Balance del mes section ──────────────────────────────────────────────────

function BalanceMes({ balance }) {
  if (!balance) return null
  const { ventas_real_mtd, pronostico_estadistico, cobertura_pct,
          estimado_restante, proyectado_total, presupuesto,
          dias_transcurridos, dias_mes, pct_mes_transcurrido,
          ventas_extrapoladas, ci_lower, ci_upper, mes, ano } = balance

  const coverageColor = cobertura_pct >= 80 ? 'text-emerald-400' : cobertura_pct >= 50 ? 'text-amber-400' : 'text-red-400'
  const barColor = cobertura_pct >= 80 ? 'bg-emerald-500' : cobertura_pct >= 50 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="bg-surface-800 rounded-xl border border-brand-500/20 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Target size={15} className="text-brand-400" />
            Balance del mes actual — {MESES_LARGO[mes]} {ano}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Día {dias_transcurridos} de {dias_mes} ({pct_mes_transcurrido}% del mes transcurrido)
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Proyectado total</span>
          <div className="text-xl font-bold text-brand-300">{fmtCOPc(proyectado_total)}</div>
        </div>
      </div>

      {/* Cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-surface-700/50 rounded-lg p-3">
          <span className="text-xs text-slate-500">Ventas reales (acumulado)</span>
          <div className="text-lg font-bold text-slate-100 mt-0.5">{fmtCOPc(ventas_real_mtd)}</div>
          <div className="text-xs text-slate-500">A hoy (facturas cerradas)</div>
        </div>
        <div className="bg-surface-700/50 rounded-lg p-3">
          <span className="text-xs text-slate-500">Estimado restante</span>
          <div className="text-lg font-bold text-amber-300 mt-0.5">{fmtCOPc(estimado_restante)}</div>
          <div className="text-xs text-slate-500">IC: {fmtCOPc(ci_lower)} – {fmtCOPc(ci_upper)}</div>
        </div>
        <div className="bg-surface-700/50 rounded-lg p-3">
          <span className="text-xs text-slate-500">Pronóstico estadístico mes</span>
          <div className="text-lg font-bold text-sky-300 mt-0.5">{fmtCOPc(pronostico_estadistico)}</div>
          <div className="text-xs text-slate-500">Extrapolado lineal: {fmtCOPc(ventas_extrapoladas)}</div>
        </div>
        <div className="bg-surface-700/50 rounded-lg p-3">
          <span className="text-xs text-slate-500">Cobertura del pronóstico</span>
          <div className={`text-lg font-bold mt-0.5 ${coverageColor}`}>
            {cobertura_pct != null ? `${cobertura_pct.toFixed(1)}%` : '—'}
          </div>
          {presupuesto && (
            <div className="text-xs text-slate-500">PP: {fmtCOPc(presupuesto)}</div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Avance real vs pronóstico</span>
          <span className={coverageColor}>{cobertura_pct != null ? `${cobertura_pct.toFixed(1)}%` : '—'}</span>
        </div>
        <ProgressBar pct={cobertura_pct} color={barColor} />
        <div className="flex justify-between text-[11px] text-slate-600 mt-1">
          <span>$0</span>
          <span>{fmtCOPc(pronostico_estadistico)} (pronóstico)</span>
        </div>
      </div>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export function PronosticosView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [modelo, setModelo]         = useState('auto')
  const [horizonte, setHorizonte]   = useState(MESES_HASTA_DIC > 0 ? MESES_HASTA_DIC : 12)
  const [esStock, setEsStock]       = useState('')
  const [exclOutliers, setExclOut]  = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const [data, setData]     = useState(null)
  const [loading, setLoad]  = useState(false)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    setLoad(true); setError(null)
    try {
      const params = {
        modelo, meses_pronostico: horizonte,
        ...(filters.region          && { region: filters.region }),
        ...(filters.vendedor        && { vendedor: filters.vendedor }),
        ...(filters.grupo_comercial && { grupo_comercial: filters.grupo_comercial }),
        ...(filters.planta          && { planta: filters.planta }),
        ...(esStock                 && { es_stock: esStock }),
        ...(filters.excl_exportacion && { excl_exportacion: true }),
        ...(filters.excl_pvta       && { excl_pvta: true }),
        ...(exclOutliers            && { excl_outliers: true }),
      }
      setData(await api.pronosticos(params))
    } catch (e) {
      setError(e?.response?.data?.detail ?? 'Error cargando pronóstico')
    } finally {
      setLoad(false)
    }
  }, [modelo, horizonte, esStock, exclOutliers, filters, refreshKey])

  useEffect(() => { load() }, [load])

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = (() => {
    if (!data) return []
    const hist = data.historico.map((h) => ({
      label: fmtPeriodo(h.periodo),
      periodo: h.periodo,
      ventas_netas: h.ventas_netas,
    }))
    const fore = data.pronostico.map((p) => ({
      label: fmtPeriodo(p.periodo),
      periodo: p.periodo,
      forecast: p.forecast,
      ci_lower: p.ci_lower,
      ci_upper: p.ci_upper,
      es_mes_actual: p.es_mes_actual,
      ventas_real_mtd: p.ventas_real_mtd,
    }))
    return [...hist, ...fore]
  })()

  // Last COMPLETE historical period (partial current month excluded from historico)
  const lastHistLabel = data?.historico?.length ? fmtPeriodo(data.historico.at(-1).periodo) : null

  // ── Excel export ───────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()

    const histRows = data.historico.map((h) => ({
      Periodo: h.periodo, Mes: MESES_LARGO[h.mes], Año: h.ano,
      'Ventas Netas (COP)': h.ventas_netas,
      Cantidad: h.cantidad,
      'Var. Mes Ant. (%)': h.var_mes_ant_pct,
      'Vs Promedio 12m (%)': h.vs_promedio_pct,
      Presupuesto: h.presupuesto,
      'Vs PP (%)': h.vs_pp_pct,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histRows), 'Histórico')

    const foreRows = data.pronostico.map((p) => ({
      Periodo: p.periodo, Mes: MESES_LARGO[p.mes], Año: p.ano,
      'Pronóstico (COP)': p.forecast,
      'IC Inferior': p.ci_lower, 'IC Superior': p.ci_upper,
      'Amplitud IC': p.ci_amplitud,
      'Var. Mes Ant. (%)': p.var_vs_mes_ant_pct,
      'Vs Promedio Hist. (%)': p.vs_promedio_historico_pct,
      Presupuesto: p.presupuesto, 'Vs PP (%)': p.vs_pp_pct,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(foreRows), 'Pronóstico')

    if (data.balance_mes) {
      const b = data.balance_mes
      const balRows = [
        { Campo: 'Mes', Valor: `${MESES_LARGO[b.mes]} ${b.ano}` },
        { Campo: 'Días transcurridos', Valor: b.dias_transcurridos },
        { Campo: 'Ventas reales MTD', Valor: b.ventas_real_mtd },
        { Campo: 'Estimado extrapolado', Valor: b.ventas_extrapoladas },
        { Campo: 'Pronóstico estadístico', Valor: b.pronostico_estadistico },
        { Campo: 'IC Inferior', Valor: b.ci_lower },
        { Campo: 'IC Superior', Valor: b.ci_upper },
        { Campo: 'Cobertura (%)', Valor: b.cobertura_pct },
        { Campo: 'Estimado restante', Valor: b.estimado_restante },
        { Campo: 'Proyectado total', Valor: b.proyectado_total },
        { Campo: 'Presupuesto', Valor: b.presupuesto },
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(balRows), 'Balance Mes Actual')
    }

    const meta = [
      { Campo: 'Modelo usado', Valor: data.modelo_usado },
      { Campo: 'MAE', Valor: data.metricas?.mae },
      { Campo: 'MAPE (%)', Valor: data.metricas?.mape },
      { Campo: 'RMSE', Valor: data.metricas?.rmse },
      { Campo: 'R²', Valor: data.metricas?.r2 ?? '—' },
      { Campo: 'MAE Ventana Deslizante', Valor: data.metricas?.cv?.mae_cv },
      { Campo: 'MAPE Ventana Deslizante (%)', Valor: data.metricas?.cv?.mape_cv },
      { Campo: 'Ventanas evaluadas', Valor: data.metricas?.cv?.ventanas_evaluadas },
      { Campo: 'Outliers excluidos', Valor: data.excl_outliers_aplicado ? 'Sí' : 'No' },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Métricas')

    XLSX.writeFile(wb, `pronostico-${data.pronostico[0]?.periodo ?? 'ventas'}.xlsx`)
  }

  const { metricas = {}, modelo_usado, balance_mes, promedio_mensual_12m, backtesting = [] } = data ?? {}
  // Exclude current partial month from total (it belongs to balance_mes)
  const totalPronosticado = data?.pronostico?.filter((p) => !p.es_mes_actual).reduce((s, p) => s + p.forecast, 0) ?? 0

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp size={20} className="text-brand-400" />
            Pronósticos de Ventas
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Proyección estadística con validación cruzada por ventana deslizante · últimos 3 años de historia
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          {data?.pronostico?.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-xs bg-brand-600/20 text-brand-300 border border-brand-500/30 hover:bg-brand-600/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download size={13} /> Exportar Excel
            </button>
          )}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
          >
            {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Controls */}
      {showFilters && (
        <div className="bg-surface-800 rounded-xl border border-surface-700 p-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">

            {/* Modelo */}
            <div className="flex flex-col gap-1.5 min-w-[220px]">
              <label className="text-xs text-slate-400 font-medium">Modelo estadístico</label>
              <div className="relative">
                <select
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  className="w-full bg-surface-700 border border-surface-600 text-slate-200 text-sm rounded-lg px-3 py-2 pr-8 appearance-none focus:outline-none focus:border-brand-500"
                >
                  {MODELOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Horizonte */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Horizonte de pronóstico</label>
              <div className="flex gap-1 flex-wrap">
                {HORIZONTES.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHorizonte(h)}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                      horizonte === h
                        ? 'bg-brand-600/20 text-brand-300 border-brand-500/30'
                        : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-200'
                    }`}
                  >
                    {h} meses
                  </button>
                ))}
                {MESES_HASTA_DIC > 0 && (
                  <button
                    onClick={() => setHorizonte(MESES_HASTA_DIC)}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                      horizonte === MESES_HASTA_DIC && ![3,6,12].includes(MESES_HASTA_DIC)
                        ? 'bg-brand-600/20 text-brand-300 border-brand-500/30'
                        : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-200'
                    }`}
                  >
                    Hasta dic. ({MESES_HASTA_DIC}m)
                  </button>
                )}
              </div>
            </div>

            {/* Stock */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Tipo producto</label>
              <div className="flex gap-1">
                {[['', 'Todos'], ['stock', 'Solo Stock'], ['no_stock', 'No Stock']].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setEsStock(v)}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                      esStock === v
                        ? 'bg-brand-600/20 text-brand-300 border-brand-500/30'
                        : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Outliers */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Opciones</label>
              <button
                onClick={() => setExclOut((s) => !s)}
                className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition-colors ${
                  exclOutliers
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-200'
                }`}
              >
                <AlertTriangle size={12} />
                Excluir outliers
              </button>
            </div>
          </div>

          {/* Model description */}
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-surface-700/40 rounded-lg px-3 py-2">
            <Info size={12} className="mt-0.5 shrink-0 text-brand-400" />
            <span>{MODELOS.find((m) => m.value === modelo)?.desc}</span>
            {modelo_usado && modelo === 'auto' && (
              <span className="ml-auto shrink-0 flex items-center gap-1">
                Seleccionado: <ModeloBadge modelo={modelo_usado} />
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="h-48 flex items-center justify-center">
          <RefreshCw size={28} className="animate-spin text-brand-400" />
        </div>
      )}

      {data && (
        <>
          {/* Balance del mes actual */}
          <BalanceMes balance={balance_mes} />

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Modelo usado"
              value={modelo_usado ? (MODELO_LABELS[modelo_usado] ?? modelo_usado) : '—'}
              sub={modelo === 'auto' ? 'Selección automática por CV' : 'Forzado por usuario'}
              color="text-brand-300"
              icon={BarChart2}
            />
            <KpiCard
              label="MAPE (validación)"
              value={metricas.mape != null ? `${metricas.mape.toFixed(1)}%` : '—'}
              sub={`MAE: ${fmtCOPc(metricas.mae)}`}
              color={metricas.mape < 10 ? 'text-emerald-400' : metricas.mape < 20 ? 'text-amber-400' : 'text-red-400'}
              icon={Target}
            />
            <KpiCard
              label="MAPE ventana deslizante"
              value={metricas.cv?.mape_cv != null ? `${metricas.cv.mape_cv.toFixed(1)}%` : '—'}
              sub={`${metricas.cv?.ventanas_evaluadas ?? 0} ventanas evaluadas`}
              color={metricas.cv?.mape_cv < 10 ? 'text-emerald-400' : metricas.cv?.mape_cv < 20 ? 'text-amber-400' : 'text-red-400'}
              icon={TrendingUp}
            />
            <KpiCard
              label={horizonte === MESES_HASTA_DIC && ![3,6,12].includes(MESES_HASTA_DIC) ? `Total resto ${HOY.getFullYear()}` : `Total próx. ${horizonte} meses`}
              value={totalPronosticado > 0 ? fmtCOPc(totalPronosticado) : '—'}
              sub={`Prom. hist. 12m: ${fmtCOPc(promedio_mensual_12m)}`}
              color="text-amber-300"
              icon={CheckCircle2}
            />
          </div>

          {/* Backtesting — accuracy vs actuals */}
          {backtesting.length > 0 && (
            <ChartDownloadButton filename="backtesting-precision.png" className="bg-surface-800 rounded-xl border border-surface-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    Precisión del modelo — Real vs Predicho
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Últimos {backtesting.length} meses usados como validación · MAPE:{' '}
                    <span className={`font-semibold ${metricas.mape < 10 ? 'text-emerald-400' : metricas.mape < 20 ? 'text-amber-400' : 'text-red-400'}`}>
                      {metricas.mape != null ? `${metricas.mape.toFixed(1)}%` : '—'}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-brand-500/70" /> Real</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-amber-400/70" /> Predicho</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={backtesting.map(b => ({ ...b, label: fmtPeriodo(b.periodo) }))} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtYAxis} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={68} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const real = payload.find(p => p.dataKey === 'actual')?.value
                      const pred = payload.find(p => p.dataKey === 'predicho')?.value
                      const errPct = payload[0]?.payload?.error_pct
                      return (
                        <div className="bg-surface-800 border border-surface-600 rounded-xl p-3 shadow-xl text-xs space-y-1 min-w-[180px]">
                          <p className="font-semibold text-slate-200 border-b border-surface-600 pb-1 mb-1">{label}</p>
                          <div className="flex justify-between gap-4">
                            <span className="text-brand-300">Real</span>
                            <span className="font-semibold text-slate-100">{fmtCOPc(real)}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-amber-300">Predicho</span>
                            <span className="font-semibold text-slate-100">{fmtCOPc(pred)}</span>
                          </div>
                          {errPct != null && (
                            <div className="flex justify-between gap-4 pt-1 border-t border-surface-600/50">
                              <span className="text-slate-400">Error abs.</span>
                              <span className={`font-semibold ${errPct < 10 ? 'text-emerald-400' : errPct < 20 ? 'text-amber-400' : 'text-red-400'}`}>{errPct.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="actual"   fill="#3b82f6" fillOpacity={0.75} radius={[3,3,0,0]} maxBarSize={28} isAnimationActive={false} />
                  <Bar dataKey="predicho" fill="#f59e0b" fillOpacity={0.75} radius={[3,3,0,0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              {/* Error per period */}
              <div className="flex flex-wrap gap-2 mt-3">
                {backtesting.map(b => (
                  <div key={b.periodo} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-700/50 text-xs">
                    <span className="text-slate-400">{fmtPeriodo(b.periodo)}</span>
                    <span className={`font-semibold ${b.error_pct != null && b.error_pct < 10 ? 'text-emerald-400' : b.error_pct < 20 ? 'text-amber-400' : 'text-red-400'}`}>
                      {b.error_pct != null ? `${b.error_pct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </ChartDownloadButton>
          )}

          {/* Chart */}
          <ChartDownloadButton filename="pronostico-ventas.png" className="bg-surface-800 rounded-xl border border-surface-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-200">Serie histórica y proyección mes a mes</h2>
                {modelo_usado && <ModeloBadge modelo={modelo_usado} />}
                {exclOutliers && (
                  <span className="text-xs text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={11} /> Outliers excluidos
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-brand-500/60" /> Histórico
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-0.5 bg-amber-400" /> Pronóstico
                </span>
                {data?.pronostico?.some((p) => p.es_mes_actual) && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full border-2 border-amber-400 bg-transparent" /> Mes en curso
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-amber-400/20 border border-amber-400/20" /> IC 95%
                </span>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false} tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={fmtYAxis}
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false} tickLine={false} width={72}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* CI band */}
                <Area dataKey="ci_upper" stroke="none" fill="#f59e0b" fillOpacity={0.15}
                  legendType="none" connectNulls={false} isAnimationActive={false} />
                <Area dataKey="ci_lower" stroke="none" fill="#0f172a" fillOpacity={1}
                  legendType="none" connectNulls={false} isAnimationActive={false} />

                {/* Historical bars */}
                <Bar dataKey="ventas_netas" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                  {chartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.ventas_netas != null ? '#3b82f6' : 'transparent'}
                      fillOpacity={entry.ventas_netas != null ? 0.7 : 0}
                    />
                  ))}
                </Bar>

                {/* Forecast line — hollow dot for current partial month */}
                <Line
                  dataKey="forecast" stroke="#f59e0b" strokeWidth={2.5}
                  dot={(props) => {
                    const { cx, cy, payload, key } = props
                    if (payload?.es_mes_actual)
                      return <circle key={key} cx={cx} cy={cy} r={5} fill="#0f172a" stroke="#f59e0b" strokeWidth={2} />
                    return <circle key={key} cx={cx} cy={cy} r={4} fill="#f59e0b" strokeWidth={0} />
                  }}
                  activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false}
                />

                {/* Divider */}
                {lastHistLabel && (
                  <ReferenceLine
                    x={lastHistLabel} stroke="#334155" strokeDasharray="4 3"
                    label={{ value: 'Actual', fill: '#475569', fontSize: 10, position: 'insideTopRight' }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartDownloadButton>

          {/* Forecast table — mes a mes */}
          {data.pronostico.length > 0 && (
            <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-surface-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Detalle pronóstico mes a mes</h2>
                <span className="text-xs text-slate-500">
                  Prom. hist. 12m: {fmtCOP(promedio_mensual_12m)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-700 text-slate-500">
                      <th className="text-left px-5 py-2.5 font-medium">Período</th>
                      <th className="text-right px-4 py-2.5 font-medium">Pronóstico</th>
                      <th className="text-right px-4 py-2.5 font-medium">Mín. (IC)</th>
                      <th className="text-right px-4 py-2.5 font-medium">Máx. (IC)</th>
                      <th className="text-right px-4 py-2.5 font-medium">Vs mes ant.</th>
                      <th className="text-right px-4 py-2.5 font-medium">Vs prom. 12m</th>
                      {data.pronostico.some((p) => p.presupuesto) && (
                        <th className="text-right px-4 py-2.5 font-medium">Vs PP</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.pronostico.map((p) => (
                      <tr key={p.periodo} className={`border-b border-surface-700/40 hover:bg-surface-700/30 transition-colors ${p.es_mes_actual ? 'bg-amber-500/5' : ''}`}>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2 text-slate-200 font-medium">
                            {fmtPeriodo(p.periodo, true)}
                            {p.es_mes_actual && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-normal whitespace-nowrap">
                                en curso
                              </span>
                            )}
                          </div>
                          {p.es_mes_actual && p.ventas_real_mtd != null && (
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Real acumulado: {fmtCOP(p.ventas_real_mtd)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-amber-300">{fmtCOP(p.forecast)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400">{fmtCOP(p.ci_lower)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400">{fmtCOP(p.ci_upper)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${pctColor(p.var_vs_mes_ant_pct)}`}>
                          {fmtPct(p.var_vs_mes_ant_pct)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${pctColor(p.vs_promedio_historico_pct)}`}>
                          {fmtPct(p.vs_promedio_historico_pct)}
                        </td>
                        {data.pronostico.some((p) => p.presupuesto) && (
                          <td className={`px-4 py-2.5 text-right font-medium ${pctColor(p.vs_pp_pct)}`}>
                            {p.presupuesto ? fmtPct(p.vs_pp_pct) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Historical detail — mes a mes */}
          <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
            <details>
              <summary className="px-5 py-3 border-b border-surface-700 cursor-pointer flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">Histórico mes a mes</span>
                <span className="text-xs text-slate-500">{data.historico.length} períodos · click para expandir</span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-700 text-slate-500">
                      <th className="text-left px-5 py-2.5 font-medium">Período</th>
                      <th className="text-right px-4 py-2.5 font-medium">Ventas Netas</th>
                      <th className="text-right px-4 py-2.5 font-medium">Cantidad</th>
                      <th className="text-right px-4 py-2.5 font-medium">Vs mes ant.</th>
                      <th className="text-right px-4 py-2.5 font-medium">Vs prom. 12m</th>
                      {data.historico.some((h) => h.presupuesto) && (
                        <>
                          <th className="text-right px-4 py-2.5 font-medium">Presupuesto</th>
                          <th className="text-right px-4 py-2.5 font-medium">Vs PP</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.historico].reverse().map((h) => (
                      <tr key={h.periodo} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                        <td className="px-5 py-2 text-slate-300 font-medium">{fmtPeriodo(h.periodo, true)}</td>
                        <td className="px-4 py-2 text-right text-slate-200 font-semibold">{fmtCOPc(h.ventas_netas)}</td>
                        <td className="px-4 py-2 text-right text-slate-400">{h.cantidad?.toLocaleString('es-CO') ?? '—'}</td>
                        <td className={`px-4 py-2 text-right font-medium ${pctColor(h.var_mes_ant_pct)}`}>
                          {fmtPct(h.var_mes_ant_pct)}
                        </td>
                        <td className={`px-4 py-2 text-right font-medium ${pctColor(h.vs_promedio_pct)}`}>
                          {fmtPct(h.vs_promedio_pct)}
                        </td>
                        {data.historico.some((h) => h.presupuesto) && (
                          <>
                            <td className="px-4 py-2 text-right text-slate-400">{h.presupuesto ? fmtCOPc(h.presupuesto) : '—'}</td>
                            <td className={`px-4 py-2 text-right font-medium ${pctColor(h.vs_pp_pct)}`}>
                              {h.vs_pp_pct != null ? fmtPct(h.vs_pp_pct) : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </>
      )}
    </div>
  )
}
