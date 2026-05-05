import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { BarChart2, Download, RefreshCw, Heart } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP, pctColor, MONTH_NAMES } from '../utils/format'

const scoreColor = (v) => {
  if (v == null) return 'text-slate-400'
  if (v >= 75) return 'text-emerald-400'
  if (v >= 50) return 'text-yellow-400'
  if (v >= 25) return 'text-orange-400'
  return 'text-red-400'
}

const scoreBg = (v) => {
  if (v == null) return 'bg-slate-600'
  if (v >= 75) return 'bg-emerald-500'
  if (v >= 50) return 'bg-yellow-400'
  if (v >= 25) return 'bg-orange-500'
  return 'bg-red-500'
}

const scoreBadge = (v) => {
  if (v >= 75) return { label: 'Saludable', cls: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50' }
  if (v >= 50) return { label: 'Estable',   cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50' }
  if (v >= 25) return { label: 'En riesgo', cls: 'bg-orange-900/40 text-orange-300 border border-orange-700/50' }
  return       { label: 'Crítico',   cls: 'bg-red-900/40 text-red-300 border border-red-700/50' }
}

const TOP_OPTIONS = [50, 100, 200, 500]

export function ScoreSaludView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [topN, setTopN]       = useState(100)
  const [exclPvta, setExclPvta] = useState(true)
  const [sortCol, setSortCol] = useState('score_salud')
  const [sortAsc, setSortAsc] = useState(false)
  const [search, setSearch]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.scoreSalud(filters.ano, filters.mes, topN, exclPvta)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters.ano, filters.mes, topN, exclPvta, refreshKey])

  useEffect(() => { load() }, [load])

  const rows = (data?.data || [])
    .filter((r) => !search || r.vendedor.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortCol] ?? -Infinity
      const bv = b[sortCol] ?? -Infinity
      return sortAsc ? av - bv : bv - av
    })

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc((p) => !p)
    else { setSortCol(col); setSortAsc(false) }
  }

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Vendedor: r.vendedor, 'Score Salud': r.score_salud,
      Estado: scoreBadge(r.score_salud).label,
      'Ventas Actuales': r.ventas_netas, 'Ventas Año Ant.': r.ventas_ant,
      'Var. YoY %': r.variacion_yoy_pct, 'Meses Activos': r.meses_activos,
      'Último Mes': r.ultimo_mes, '# Productos': r.num_productos,
      'Score Monetario': r.score_monetario, 'Score Recencia': r.score_recencia,
      'Score Tendencia': r.score_tendencia,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Score Salud')
    XLSX.writeFile(wb, `score-salud-${filters.ano}${filters.mes ? `-${MONTH_NAMES[filters.mes]}` : ''}.xlsx`)
  }

  const TH = ({ col, children }) => (
    <th
      onClick={() => handleSort(col)}
      className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-200 whitespace-nowrap select-none"
    >
      {children} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const saludables = rows.filter((r) => r.score_salud >= 75).length
  const estables   = rows.filter((r) => r.score_salud >= 50 && r.score_salud < 75).length
  const riesgo     = rows.filter((r) => r.score_salud >= 25 && r.score_salud < 50).length
  const criticos   = rows.filter((r) => r.score_salud < 25).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart size={20} className="text-rose-400" />
          <h1 className="text-lg font-semibold text-slate-100">Score de Salud del Cliente</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            40% monetario · 30% recencia · 30% tendencia
          </span>
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
          <span className="text-xs text-slate-400">Top</span>
          <select value={topN} onChange={(e) => setTopN(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {TOP_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={exclPvta} onChange={(e) => setExclPvta(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand-500" />
          Excluir PVTA
        </label>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar vendedor…"
          className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-3 py-1 w-44"
        />
        <span className="text-xs text-slate-500 ml-auto">{rows.length} vendedores</span>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Saludable', count: saludables, cls: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/30' },
            { label: 'Estable',   count: estables,   cls: 'text-yellow-400',  bg: 'bg-yellow-900/20 border-yellow-700/30' },
            { label: 'En riesgo', count: riesgo,     cls: 'text-orange-400',  bg: 'bg-orange-900/20 border-orange-700/30' },
            { label: 'Crítico',   count: criticos,   cls: 'text-red-400',     bg: 'bg-red-900/20 border-red-700/30' },
          ].map(({ label, count, cls, bg }) => (
            <div key={label} className={`rounded-xl border p-4 ${bg}`}>
              <div className={`text-2xl font-bold ${cls}`}>{count}</div>
              <div className="text-xs text-slate-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error / Loading */}
      {error && <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Cargando…
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="bg-surface-800 rounded-2xl border border-surface-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-900/60 border-b border-surface-700">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide w-8">#</th>
                  <TH col="vendedor">Vendedor</TH>
                  <TH col="score_salud">Score Salud</TH>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Estado</th>
                  <TH col="ventas_netas">Ventas</TH>
                  <TH col="variacion_yoy_pct">YoY %</TH>
                  <TH col="meses_activos">Meses Activos</TH>
                  <TH col="num_productos"># Productos</TH>
                  <TH col="score_monetario">Monetario</TH>
                  <TH col="score_recencia">Recencia</TH>
                  <TH col="score_tendencia">Tendencia</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const badge = scoreBadge(r.score_salud)
                  return (
                    <tr key={r.vendedor} className="border-t border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                      <td className="px-3 py-2 text-xs text-slate-600">{i + 1}</td>
                      <td className="px-3 py-2 text-xs text-slate-200 font-medium max-w-[140px] truncate">{r.vendedor}</td>
                      <td className="px-3 py-2 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBg(r.score_salud)}`} style={{ width: `${r.score_salud}%` }} />
                          </div>
                          <span className={`text-xs font-bold w-8 text-right ${scoreColor(r.score_salud)}`}>
                            {r.score_salud?.toFixed(0)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-300">{fmtCOP(r.ventas_netas)}</td>
                      <td className={`px-3 py-2 text-xs font-medium ${pctColor(r.variacion_yoy_pct)}`}>
                        {r.variacion_yoy_pct != null ? `${r.variacion_yoy_pct > 0 ? '+' : ''}${r.variacion_yoy_pct?.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400 text-center">{r.meses_activos}</td>
                      <td className="px-3 py-2 text-xs text-slate-400 text-center">{r.num_productos}</td>
                      <td className={`px-3 py-2 text-xs text-right ${scoreColor(r.score_monetario)}`}>{r.score_monetario?.toFixed(0)}</td>
                      <td className={`px-3 py-2 text-xs text-right ${scoreColor(r.score_recencia)}`}>{r.score_recencia?.toFixed(0)}</td>
                      <td className={`px-3 py-2 text-xs text-right ${scoreColor(r.score_tendencia)}`}>{r.score_tendencia?.toFixed(0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
