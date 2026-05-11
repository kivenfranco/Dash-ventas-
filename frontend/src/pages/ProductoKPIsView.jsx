import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Download, Search, Package } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const COLORS = ['#6366f1','#8b5cf6','#3b82f6','#06b6d4','#10b981','#f59e0b','#f97316','#ec4899','#94a3b8','#64748b','#22c55e','#a78bfa']

const fmt = (v) => {
  if (!v) return '$0'
  if (v >= 1e9) return `$${(v/1e9).toFixed(1)}MM`
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v}`
}

const pctColor = (v) => v == null ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-red-400'

const DIM_OPTIONS = [
  { value: 'grupo_comercial',   label: 'Grupo Comercial'     },
  { value: 'linea_negocio',     label: 'Línea de Negocio'    },
  { value: 'tipo_fabricacion',  label: 'Tipo Fabricación'    },
  { value: 'descripcion',       label: 'Producto (SKU)'      },
]

const PAGE = 50

export function ProductoKPIsView() {
  const { refreshKey }          = useOutletContext()
  const { filters }             = useFilters()
  const [dimBy, setDimBy]       = useState('grupo_comercial')
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('ventas_netas')
  const [sortAsc, setSortAsc]   = useState(false)
  const [page, setPage]         = useState(0)

  useEffect(() => {
    setLoading(true); setError('')
    api.atributos(filters, dimBy, 200)
      .then(d => setRows(d?.data || []))
      .catch(e => setError(e?.response?.data?.detail || 'Error al cargar'))
      .finally(() => setLoading(false))
    setPage(0)
  }, [filters, dimBy, refreshKey])

  const filtered = rows
    .filter(r => !search || (r.dimension || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0
      return sortAsc ? va - vb : vb - va
    })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const pageRows   = filtered.slice(page * PAGE, (page + 1) * PAGE)
  const top12      = filtered.slice(0, 12)

  const totalVentas = rows.reduce((s, r) => s + (r.ventas_netas || 0), 0)

  const sort = (key) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
    setPage(0)
  }

  const Th = ({ k, children }) => (
    <th
      onClick={() => sort(k)}
      className="pb-2 text-right cursor-pointer hover:text-slate-100 select-none transition-colors"
    >
      {children} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
      'Dimensión': r.dimension,
      'Ventas': r.ventas_netas,
      'Participación %': r.participacion_pct,
      'Clientes': r.num_clientes,
      'YoY %': r.variacion_yoy_pct,
      'Año Anterior': r.ventas_netas_ant,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, `kpis-producto-${dimBy}-${filters.ano}.xlsx`)
  }

  const dimLabel = DIM_OPTIONS.find(d => d.value === dimBy)?.label || dimBy

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">KPIs por Producto</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Ventas, participación y variación YoY por {dimLabel} — {filters.ano}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex gap-1 flex-wrap">
          {DIM_OPTIONS.map(d => (
            <button key={d.value} onClick={() => { setDimBy(d.value); setSearch(''); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                dimBy === d.value ? 'bg-brand-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-100 border border-surface-600'
              }`}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Buscar…"
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded-lg pl-7 pr-3 py-1.5 w-44 focus:outline-none focus:border-brand-500 placeholder-slate-500"
          />
        </div>
        {filtered.length > 0 && (
          <button onClick={exportXlsx}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <Download size={13} /> Excel
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Bar chart top 12 */}
      {!loading && top12.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Top {top12.length} por Ventas — {dimLabel}</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top12} layout="vertical" margin={{ top: 0, right: 80, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1f2937" />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} tickFormatter={fmt} />
                <YAxis type="category" dataKey="dimension" tick={{ fill: '#94a3b8', fontSize: 9 }} width={130} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={v => [fmt(v), 'Ventas']}
                />
                <Bar dataKey="ventas_netas" radius={[0, 4, 4, 0]}>
                  {top12.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700">
          <span className="text-xs text-slate-400">{filtered.length} elementos · Total: {fmt(totalVentas)}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">‹</button>
            <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">›</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-700 text-slate-400">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">{dimLabel}</th>
                <Th k="ventas_netas"><span className="px-4">Ventas</span></Th>
                <Th k="participacion_pct"><span className="px-3">Part %</span></Th>
                <Th k="num_clientes"><span className="px-3">Clientes</span></Th>
                <Th k="variacion_yoy_pct"><span className="px-3">YoY</span></Th>
                <th className="text-right px-4 py-3 text-slate-400">Año Ant.</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_, i) => (
                    <tr key={i}><td colSpan={7}><div className="animate-pulse h-7 my-1 mx-4 bg-surface-700 rounded" /></td></tr>
                  ))
                : pageRows.map((r, i) => (
                    <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                      <td className="px-4 py-2.5 text-slate-500">{page * PAGE + i + 1}</td>
                      <td className="px-4 py-2.5 text-slate-200 max-w-xs truncate font-medium">{r.dimension || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-brand-300 font-semibold">{fmt(r.ventas_netas)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-400">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(r.participacion_pct || 0, 100)}%` }} />
                          </div>
                          {(r.participacion_pct || 0).toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{r.num_clientes?.toLocaleString() ?? '—'}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold ${pctColor(r.variacion_yoy_pct)}`}>
                        {r.variacion_yoy_pct != null ? `${r.variacion_yoy_pct > 0 ? '+' : ''}${r.variacion_yoy_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{fmt(r.ventas_netas_ant)}</td>
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
