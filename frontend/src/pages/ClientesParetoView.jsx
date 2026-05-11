import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, MONTH_NAMES } from '../utils/format'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Users, MapPin, User, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { exportToExcel } from '../utils/exportExcel'

const PARETO_PAGE = 50

const GROUP_BY_OPTIONS = [
  { key: 'region',   label: 'Región',   icon: MapPin },
  { key: 'vendedor', label: 'Vendedor', icon: User   },
]

function ParetoTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-52">
        <p className="text-slate-200 font-semibold mb-2">Clientes: {label}</p>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">% Clientes</span>
          <span className="font-medium text-brand-300">{payload[0].payload.pct_clientes}%</span>
        </div>
        <div className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">% Facturación</span>
          <span className="font-medium text-brand-300">{payload[0].value}%</span>
        </div>
      </div>
    )
  }
  return null
}

export function ClientesParetoView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const [groupBy, setGroupBy]             = useState('region')
  const [selectedDimension, setSelectedDimension] = useState('Todos')
  const [page, setPage]                   = useState(0)

  // Fetch available dimensions (regions or vendors) for the dropdown
  const { data: dimensionsData, loading: dimensionsLoading } = useData(
    () => api.getDimensions(groupBy),
    [groupBy, refreshKey]
  )

  // Derive global region/vendedor as CSV strings for the API
  const _region  = filters._regiones?.length  ? filters._regiones.join(',')  : (filters.region  || null)
  const _vendedor = filters._vendedores?.length ? filters._vendedores.join(',') : (filters.vendedor || null)

  // Fetch Pareto data
  const { data: paretoData, loading: paretoLoading, error: paretoError } = useData(
    () => api.getClientesPareto(
      filters.ano, filters.mes, groupBy,
      selectedDimension === 'Todos' ? null : selectedDimension,
      filters.mes_fin,
      filters.excl_pvta,
      filters.excl_exportacion,
      _region,
      _vendedor,
    ),
    [filters.ano, filters.mes, filters.mes_fin, filters.excl_pvta, filters.excl_exportacion,
     _region, _vendedor, groupBy, selectedDimension, refreshKey]
  )

  const clients = paretoData?.clients || []
  const paretoChartData = paretoData?.pareto_chart_data || []
  const totalSales = paretoData?.total_sales || 0
  const pareto80Count = paretoData?.pareto_80_count || 0
  const pareto80PctClients = paretoData?.pareto_80_pct_clients || 0

  const totalPages = Math.max(1, Math.ceil(clients.length / PARETO_PAGE))
  const pageClients = clients.slice(page * PARETO_PAGE, (page + 1) * PARETO_PAGE)

  const handleExport = () => {
    if (!clients.length) return
    const exportCols = [
      { key: 'nombre', header: 'Cliente' },
      { key: 'numero_cliente', header: 'Código Cliente' },
      { key: 'ventas', header: 'Ventas Netas' },
      { key: 'pct_total', header: '% Total' },
      { key: 'pct_acumulado', header: '% Acumulado' },
    ]
    exportToExcel(clients, exportCols, `ClientesPareto_${groupBy}_${selectedDimension}_${filters.ano}_${filters.mes}`)
  }

  const currentDimensionLabel = GROUP_BY_OPTIONS.find(opt => opt.key === groupBy)?.label || 'Dimensión';
  const dimensionOptions = dimensionsData?.dimensions || [];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Análisis Pareto de Clientes</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Identifica los clientes clave que generan el 80% de las ventas por {currentDimensionLabel}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Agrupar por:</span>
          <div className="flex gap-1 bg-surface-700 p-1 rounded-lg">
            {GROUP_BY_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => { setGroupBy(option.key); setSelectedDimension('Todos'); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  groupBy === option.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <option.icon size={12} className="inline-block mr-1" /> {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-slate-400">Seleccionar {currentDimensionLabel}:</span>
          <select
            value={selectedDimension}
            onChange={(e) => setSelectedDimension(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1"
            disabled={dimensionsLoading}
          >
            <option value="Todos">Todos</option>
            {dimensionOptions.map((dim) => (
              <option key={dim.id} value={dim.id}>{dim.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error display */}
      {paretoError && (
        <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">
          {paretoError}
        </div>
      )}

      {/* Pareto Chart */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-1">Curva de Pareto</h2>
        <p className="text-xs text-slate-500 mb-4">
          {pareto80Count > 0
            ? `Solo ${pareto80Count} clientes (${pareto80PctClients}%) generan el 80% de la facturación.`
            : 'Cargando datos de Pareto...'}
        </p>
        <div className={`h-64 ${paretoLoading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={paretoChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="paretoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="pct_clientes" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `${v}%`} label={{ value: '% clientes', position: 'insideBottom', fill: '#6b7280', fontSize: 10, dy: 6 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<ParetoTooltip />} />
              <Area dataKey="pct_ventas" name="% facturación" stroke="#6366f1" fill="url(#paretoGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Clients Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-200">
            Clientes por {currentDimensionLabel} ({clients.length} registros)
          </h2>
          <div className="flex items-center gap-2">
            {clients.length > 0 && (
              <>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
                  <ChevronRight size={14} />
                </button>
                <button onClick={handleExport} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors ml-1">
                  <Download size={13} /> Excel
                </button>
              </>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2">#</th>
                <th className="pb-2">Cliente</th>
                <th className="pb-2 text-right">Ventas Netas</th>
                <th className="pb-2 text-right">% Total</th>
                <th className="pb-2 text-right">% Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {paretoLoading
                ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={5}><div className="animate-pulse h-4 my-1.5 bg-surface-700 rounded" /></td></tr>)
                : pageClients.map((c, i) => (
                    <tr key={i} className="border-b border-surface-700/30">
                      <td className="py-1.5 text-slate-500">{page * PARETO_PAGE + i + 1}</td>
                      <td className="py-1.5 text-slate-100 max-w-[200px] truncate font-medium">{c.nombre}</td>
                      <td className="py-1.5 text-right text-brand-300">{fmtCOP(c.ventas)}</td>
                      <td className="py-1.5 text-right text-slate-300">{fmtPct(c.pct_total, 1)}</td>
                      <td className="py-1.5 text-right text-slate-300">{fmtPct(c.pct_acumulado, 1)}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}