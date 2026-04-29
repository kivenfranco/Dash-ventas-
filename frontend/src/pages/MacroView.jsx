import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { GlobalFilters } from '../components/filters/GlobalFilters'
import { KPIGrid } from '../components/kpis/KPIGrid'
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart'
import { HeatmapChart } from '../components/charts/HeatmapChart'
import { HorizontalBarChart } from '../components/charts/BarChart'
import { ErrorDisplay } from '../components/common/LoadingSpinner'

const MONTH_NAMES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export function MacroView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const { data: kpis, loading: kpiLoading, error: kpiError, reload } = useData(
    () => api.kpis(filters), [filters, refreshKey]
  )
  const { data: trends, loading: trendLoading } = useData(
    () => api.trends(filters), [filters, refreshKey]
  )
  const { data: byGrupo, loading: gcLoading } = useData(
    () => api.segments(filters, 'grupo_comercial', 8), [filters, refreshKey]
  )

  if (kpiError) return <ErrorDisplay message={kpiError} onRetry={reload} />

  const mesesLabel = filters.mes
    ? `${MONTH_NAMES[filters.mes]} ${filters.ano}`
    : `Año ${filters.ano}`

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Vista Macro</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            KPIs principales · <span className="text-brand-400">{mesesLabel}</span>
          </p>
        </div>
        {kpis && (
          <div className="hidden md:flex items-center gap-4 text-xs text-slate-500">
            <span>
              Ventas <span className="text-emerald-400 font-semibold">
                {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(kpis.ventas_netas)}
              </span>
            </span>
            <span>
              Cump <span className={`font-semibold ${kpis.cump_pct >= 80 ? 'text-emerald-400' : kpis.cump_pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {kpis.cump_pct?.toFixed(1)}%
              </span>
            </span>
          </div>
        )}
      </div>

      <GlobalFilters onRefresh={reload} />

      {/* All KPI metrics — 4 rows */}
      <KPIGrid data={kpis} loading={kpiLoading} />

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card">
          <h2 className="text-sm font-semibold text-slate-300 mb-1">Evolución de Ventas {filters.ano}</h2>
          <p className="section-title mb-4">ventas netas vs presupuesto vs año anterior</p>
          <TimeSeriesChart data={trends?.series || []} loading={trendLoading} />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-1">Top Grupos Comerciales</h2>
          <p className="section-title mb-4">por ventas netas</p>
          <HorizontalBarChart data={byGrupo?.data || []} loading={gcLoading} />
        </div>
      </div>

      {/* Heatmap */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-300 mb-1">Mapa de Calor de Ventas</h2>
        <p className="section-title mb-4">intensidad mensual por año</p>
        <HeatmapChart data={trends?.series || []} loading={trendLoading} />
      </div>
    </div>
  )
}
