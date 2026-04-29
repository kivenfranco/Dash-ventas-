import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { GlobalFilters } from '../components/filters/GlobalFilters'
import { HorizontalBarChart } from '../components/charts/BarChart'
import { DonutChart } from '../components/charts/PieChart'
import { ErrorDisplay } from '../components/common/LoadingSpinner'

const MONTH_NAMES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const fmtCurrency = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(v)

const SEGMENTS = [
  { key: 'region',          label: 'Región' },
  { key: 'vendedor',        label: 'Vendedor' },
  { key: 'grupo_comercial', label: 'Grupo Comercial' },
  { key: 'planta',          label: 'Planta' },
  { key: 'tipo_cliente',    label: 'Tipo Cliente' },
]

export function MidView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()
  const [primary, setPrimary]   = useState('region')
  const [secondary, setSecondary] = useState('grupo_comercial')

  const { data: d1, loading: l1, error: e1 } = useData(
    () => api.segments(filters, primary, 12), [filters, refreshKey, primary]
  )
  const { data: d2, loading: l2 } = useData(
    () => api.segments(filters, secondary, 8), [filters, refreshKey, secondary]
  )
  const { data: canal, loading: lCanal } = useData(
    () => api.segments(filters, 'tipo_cliente', 10), [filters, refreshKey]
  )

  if (e1) return <ErrorDisplay message={e1} />

  const meses = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `${filters.ano}`

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Vista Intermedia</h1>
        <p className="text-slate-500 text-sm mt-0.5">Segmentación de ventas · <span className="text-brand-400">{meses}</span></p>
      </div>

      <GlobalFilters />

      {/* Dimension selector toggles */}
      <div className="flex flex-wrap gap-4">
        <div className="card flex items-center gap-3 py-3">
          <span className="text-xs text-slate-400">Vista principal:</span>
          <div className="flex gap-1 bg-surface-700 p-1 rounded-lg">
            {SEGMENTS.map((s) => (
              <button key={s.key} onClick={() => setPrimary(s.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${primary === s.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top row: bar + donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 card">
          <h2 className="text-sm font-semibold text-slate-300 mb-1">
            Ventas por {SEGMENTS.find((s) => s.key === primary)?.label}
          </h2>
          <p className="section-title mb-4">ranking por ventas netas</p>
          <HorizontalBarChart data={d1?.data || []} loading={l1} />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-1">Mix por Tipo Cliente</h2>
          <p className="section-title mb-4">participación en ventas</p>
          <DonutChart data={canal?.data || []} loading={lCanal} />
        </div>
      </div>

      {/* Second segmentation */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">Segmentación Secundaria</h2>
            <p className="section-title">selecciona la dimensión</p>
          </div>
          <div className="flex gap-1 bg-surface-700 p-1 rounded-lg">
            {SEGMENTS.filter((s) => s.key !== primary).map((s) => (
              <button key={s.key} onClick={() => setSecondary(s.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${secondary === s.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <HorizontalBarChart data={d2?.data || []} loading={l2} />
      </div>

      {/* Participation table */}
      {d1?.data?.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">
            Tabla — Ventas por {SEGMENTS.find((s) => s.key === primary)?.label}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-surface-700 text-slate-400">
                  <th className="pb-3 font-medium">#</th>
                  <th className="pb-3 font-medium">{SEGMENTS.find((s) => s.key === primary)?.label}</th>
                  <th className="pb-3 font-medium text-right">Ventas Netas</th>
                  <th className="pb-3 font-medium text-right">Part. %</th>
                  <th className="pb-3 font-medium text-right">Clientes</th>
                  <th className="pb-3 font-medium text-right">Transacciones</th>
                  <th className="pb-3 font-medium text-right">Ticket Prom.</th>
                </tr>
              </thead>
              <tbody>
                {d1.data.map((d, i) => (
                  <tr key={i} className="border-b border-surface-700/40 hover:bg-surface-700/30 transition-colors">
                    <td className="py-3 text-slate-500">{i + 1}</td>
                    <td className="py-3 text-slate-100 font-medium">{d.dimension}</td>
                    <td className="py-3 text-right text-emerald-400 font-medium">{fmtCurrency(d.ventas_netas)}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${d.participacion_pct}%` }} />
                        </div>
                        <span className="text-brand-400 w-10 text-right text-xs">{d.participacion_pct?.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="py-3 text-right text-slate-400">{d.num_clientes?.toLocaleString('es-MX')}</td>
                    <td className="py-3 text-right text-slate-400">{d.num_transacciones?.toLocaleString('es-MX')}</td>
                    <td className="py-3 text-right text-slate-400">{fmtCurrency(d.ticket_promedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
