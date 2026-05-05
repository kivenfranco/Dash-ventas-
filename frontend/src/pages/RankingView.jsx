import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, Download, RefreshCw, Trophy } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP, pctColor, MONTH_NAMES } from '../utils/format'

const GROUP_OPTIONS = [
  { value: 'descripcion',   label: 'Producto'          },
  { value: 'estructura',    label: 'Estructura'         },
  { value: 'linea_negocio', label: 'Línea de Negocio'  },
  { value: 'dispositivo',   label: 'Dispositivo'        },
  { value: 'tipo_producto', label: 'Tipo de Producto'   },
]

const TOP_OPTIONS = [10, 20, 30, 50]

const DeltaBadge = ({ delta }) => {
  if (delta == null) return <span className="text-xs text-slate-500">Nuevo</span>
  if (delta > 0)  return <span className="flex items-center gap-0.5 text-xs text-emerald-400"><TrendingUp size={11} />+{delta}</span>
  if (delta < 0)  return <span className="flex items-center gap-0.5 text-xs text-red-400"><TrendingDown size={11} />{delta}</span>
  return <span className="flex items-center gap-0.5 text-xs text-slate-500"><Minus size={11} />—</span>
}

const COLORS = ['#f59e0b', '#94a3b8', '#cd7f32', '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#ec4899', '#a855f7']

export function RankingView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [groupBy, setGroupBy]   = useState('descripcion')
  const [topN, setTopN]         = useState(20)
  const [mes, setMes]           = useState(null)
  const [tab, setTab]           = useState('tabla')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.ranking(filters.ano, mes || filters.mes, groupBy, topN)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters.ano, filters.mes, mes, groupBy, topN, refreshKey])

  useEffect(() => { load() }, [load])

  const rows = data?.data || []

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Posición': r.rank_actual, [groupBy]: r.dimension,
      'Ventas Actuales': r.ventas_netas, 'Ventas Mes Ant.': r.ventas_ant,
      'Var. %': r.variacion_pct, 'Pos. Anterior': r.rank_anterior, 'Delta Ranking': r.rank_delta,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking')
    XLSX.writeFile(wb, `ranking-${groupBy}-${filters.ano}${mes ? `-${MONTH_NAMES[mes]}` : ''}.xlsx`)
  }

  const chartData = rows.slice(0, 15).map((r) => ({
    name: r.dimension.length > 20 ? r.dimension.slice(0, 18) + '…' : r.dimension,
    ventas: r.ventas_netas,
    ventas_ant: r.ventas_ant,
  }))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={20} className="text-amber-400" />
          <h1 className="text-lg font-semibold text-slate-100">Ranking Dinámico de Productos</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportXlsx} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <Download size={12} /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Agrupar por</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Top</span>
          <select value={topN} onChange={(e) => setTopN(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {TOP_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Mes</span>
          <select value={mes || ''} onChange={(e) => setMes(e.target.value ? +e.target.value : null)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            <option value="">— del filtro —</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{MONTH_NAMES[i + 1]}</option>
            ))}
          </select>
        </div>
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            {data.mes && `${MONTH_NAMES[data.mes]} ${data.ano}`} vs {MONTH_NAMES[data.mes_anterior]} {data.ano_anterior}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {[['tabla', 'Tabla'], ['chart', 'Gráfico']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${tab === v ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {error && <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Cargando…
        </div>
      )}

      {data && tab === 'tabla' && (
        <div className="bg-surface-800 rounded-2xl border border-surface-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-900/60 border-b border-surface-700">
                <tr>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400 uppercase tracking-wide w-12">Pos.</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400 uppercase tracking-wide w-16">Δ Rank</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
                    {GROUP_OPTIONS.find((o) => o.value === groupBy)?.label}
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Ventas Mes</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Mes Anterior</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Var. %</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400 uppercase tracking-wide">Pos. Ant.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dimension} className="border-t border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                    <td className="px-3 py-2 text-center">
                      <span className={`text-sm font-bold ${r.rank_actual <= 3 ? ['text-amber-400', 'text-slate-400', 'text-amber-700'][r.rank_actual - 1] : 'text-slate-400'}`}>
                        {r.rank_actual}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center"><DeltaBadge delta={r.rank_delta} /></td>
                    <td className="px-3 py-2 text-xs text-slate-200 max-w-[200px] truncate">{r.dimension}</td>
                    <td className="px-3 py-2 text-xs text-slate-300 text-right">{fmtCOP(r.ventas_netas)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 text-right">{fmtCOP(r.ventas_ant)}</td>
                    <td className={`px-3 py-2 text-xs font-medium text-right ${pctColor(r.variacion_pct)}`}>
                      {r.variacion_pct != null ? `${r.variacion_pct > 0 ? '+' : ''}${r.variacion_pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 text-center">{r.rank_anterior ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && tab === 'chart' && (
        <div className="bg-surface-800 rounded-2xl border border-surface-700 p-4">
          <p className="text-xs text-slate-400 mb-3">Top 15 — Ventas del mes actual vs mes anterior</p>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 120, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#cbd5e1' }} width={120} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#f1f5f9', fontSize: 11 }}
                formatter={(v, name) => [fmtCOP(v), name === 'ventas' ? 'Mes actual' : 'Mes anterior']}
              />
              <Bar dataKey="ventas_ant" fill="#334155" radius={[0, 2, 2, 0]} name="ventas_ant" />
              <Bar dataKey="ventas" radius={[0, 4, 4, 0]} name="ventas">
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
