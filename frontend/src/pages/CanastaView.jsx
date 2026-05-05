import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw, ShoppingCart, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { MONTH_NAMES } from '../utils/format'

const liftColor = (v) => {
  if (v == null) return 'text-slate-400'
  if (v >= 5) return 'text-emerald-300'
  if (v >= 2) return 'text-brand-300'
  if (v >= 1) return 'text-slate-300'
  return 'text-slate-500'
}

const liftBg = (v) => {
  if (v == null) return ''
  if (v >= 5) return 'bg-emerald-900/30 border-emerald-700/40'
  if (v >= 2) return 'bg-brand-900/30 border-brand-700/40'
  return ''
}

const TOP_OPTIONS = [15, 30, 50, 100]

export function CanastaView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [topN, setTopN]           = useState(30)
  const [minSoporte, setMinSoporte] = useState(0.02)
  const [exclPvta, setExclPvta]   = useState(true)
  const [search, setSearch]       = useState('')
  const [tab, setTab]             = useState('tabla')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.canasta(filters.ano, filters.mes, topN, minSoporte, exclPvta)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters.ano, filters.mes, topN, minSoporte, exclPvta, refreshKey])

  useEffect(() => { load() }, [load])

  const rows = (data?.data || []).filter((r) =>
    !search || r.producto_a.toLowerCase().includes(search.toLowerCase()) || r.producto_b.toLowerCase().includes(search.toLowerCase())
  )

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Producto A': r.producto_a, 'Código A': r.codigo_a,
      'Producto B': r.producto_b, 'Código B': r.codigo_b,
      'Co-ocurrencias': r.co_ocurrencias,
      'Soporte %': r.soporte_pct,
      'Confianza A→B %': r.confianza_ab_pct,
      'Confianza B→A %': r.confianza_ba_pct,
      'Lift': r.lift,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Canasta')
    XLSX.writeFile(wb, `canasta-${filters.ano}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart size={20} className="text-brand-400" />
          <h1 className="text-lg font-semibold text-slate-100">Análisis de Canasta</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            productos comprados juntos
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportXlsx} disabled={!data} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors disabled:opacity-40">
            <Download size={12} /> Excel
          </button>
        </div>
      </div>

      {/* Concepts explanation */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="p-3 bg-surface-800 rounded-xl border border-surface-700">
          <p className="font-semibold text-slate-200 mb-1">Soporte</p>
          <p className="text-slate-400">% de canastas donde aparece el par. Mide qué tan frecuente es la combinación.</p>
        </div>
        <div className="p-3 bg-surface-800 rounded-xl border border-surface-700">
          <p className="font-semibold text-slate-200 mb-1">Confianza</p>
          <p className="text-slate-400">Dado que se compra A, % de veces que también se compra B. Mide la regla de asociación.</p>
        </div>
        <div className="p-3 bg-surface-800 rounded-xl border border-surface-700">
          <p className="font-semibold text-slate-200 mb-1">Lift</p>
          <p className="text-slate-400">Cuántas veces más probable es la combinación vs. compra independiente. Lift &gt; 1 = asociación positiva.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Top pares</span>
          <select value={topN} onChange={(e) => setTopN(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {TOP_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Soporte mín.</span>
          <select value={minSoporte} onChange={(e) => setMinSoporte(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {[0.005, 0.01, 0.02, 0.05, 0.1].map((v) => (
              <option key={v} value={v}>{(v * 100).toFixed(1)}%</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={exclPvta} onChange={(e) => setExclPvta(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand-500" />
          Excluir PVTA
        </label>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-3 py-1 w-44"
        />
        {data && (
          <span className="text-xs text-slate-500 ml-auto">
            {data.n_canastas.toLocaleString('es-CO')} canastas · {data.n_productos} productos · {rows.length} pares
          </span>
        )}
      </div>

      {error && <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Analizando canastas…
        </div>
      )}

      {data && rows.length === 0 && (
        <div className="p-8 text-center text-slate-500 bg-surface-800 rounded-2xl border border-surface-700">
          <ShoppingCart size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm">No se encontraron pares con soporte ≥ {(minSoporte * 100).toFixed(1)}%.</p>
          <p className="text-xs mt-1">Reduce el soporte mínimo para ver más combinaciones.</p>
        </div>
      )}

      {data && rows.length > 0 && (
        <div className="bg-surface-800 rounded-2xl border border-surface-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-900/60 border-b border-surface-700">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide w-8">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Producto A</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Producto B</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Co-ocurr.</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Soporte</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Conf. A→B</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Conf. B→A</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-slate-400 uppercase tracking-wide">Lift</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-surface-700/50 hover:bg-surface-700/30 transition-colors ${r.lift >= 2 ? liftBg(r.lift) : ''}`}>
                    <td className="px-3 py-2 text-xs text-slate-600">{i + 1}</td>
                    <td className="px-3 py-2 text-xs text-slate-200 max-w-[180px]">
                      <div className="truncate" title={r.producto_a}>{r.producto_a}</div>
                      <div className="text-slate-600 text-[10px]">{r.codigo_a}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200 max-w-[180px]">
                      <div className="truncate" title={r.producto_b}>{r.producto_b}</div>
                      <div className="text-slate-600 text-[10px]">{r.codigo_b}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 text-right">{r.co_ocurrencias.toLocaleString('es-CO')}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 text-right">{r.soporte_pct}%</td>
                    <td className="px-3 py-2 text-xs text-slate-300 text-right">{r.confianza_ab_pct}%</td>
                    <td className="px-3 py-2 text-xs text-slate-300 text-right">{r.confianza_ba_pct}%</td>
                    <td className={`px-3 py-2 text-xs font-bold text-right ${liftColor(r.lift)}`}>{r.lift}×</td>
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
