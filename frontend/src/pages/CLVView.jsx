import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const SEG_COLOR = {
  Platinum: '#e2e8f0',
  Gold:     '#fbbf24',
  Silver:   '#94a3b8',
  Bronze:   '#b45309',
}

const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`

export function CLVView() {
  const { refreshKey }          = useOutletContext()
  const { filters }             = useFilters()
  const [data, setData]         = useState([])
  const [resumen, setResumen]   = useState({})
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState('tabla')
  const [segFilter, setSeg]     = useState('Todos')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.clv(filters.ano)
      .then((d) => { setData(d.data || []); setResumen(d.resumen || {}) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar CLV'))
      .finally(() => setLoading(false))
  }, [filters.ano, refreshKey])

  const segs     = ['Todos', 'Platinum', 'Gold', 'Silver', 'Bronze']
  const filtered = segFilter === 'Todos' ? data : data.filter((r) => r.segmento === segFilter)
  const topBar   = data.slice(0, 20)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Customer Lifetime Value</h1>
        <p className="text-xs text-slate-400 mt-0.5">CLV estimado = Promedio Anual × Factor de Longevidad — {filters.ano}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">CLV Total</p>
          <p className="text-lg font-bold text-slate-100 mt-1">{fmt(resumen.total_clv || 0)}</p>
        </div>
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
          <p className="text-xs text-slate-400">CLV Promedio</p>
          <p className="text-lg font-bold text-slate-100 mt-1">{fmt(resumen.avg_clv || 0)}</p>
        </div>
        {Object.entries(resumen.por_segmento || {}).map(([seg, cnt]) => (
          <button
            key={seg}
            onClick={() => setSeg(segFilter === seg ? 'Todos' : seg)}
            className={`border rounded-xl p-4 text-left transition-all ${
              segFilter === seg ? 'border-brand-500 bg-brand-600/10' : 'border-surface-700 bg-surface-900 hover:border-surface-500'
            }`}
          >
            <p className="text-xs text-slate-400">{seg}</p>
            <p className="text-lg font-bold mt-1" style={{ color: SEG_COLOR[seg] }}>{cnt}</p>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {['tabla', 'grafico'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
          >
            {t === 'tabla' ? 'Tabla' : 'Top 20 CLV'}
          </button>
        ))}
        <select
          value={segFilter}
          onChange={(e) => setSeg(e.target.value)}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300"
        >
          {segs.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {tab === 'tabla' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Vendedor</th>
                  <th className="text-right px-4 py-3">Venta Año</th>
                  <th className="text-right px-4 py-3">Prom. Anual</th>
                  <th className="text-center px-3 py-3">Años</th>
                  <th className="text-center px-3 py-3">Factor</th>
                  <th className="text-right px-4 py-3">CLV Estimado</th>
                  <th className="text-center px-4 py-3">Segmento</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="px-4 py-2 font-mono text-slate-200">{r.vendedor}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_ano_actual)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{fmt(r.avg_annual_value)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.anos_activos}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.lifespan_factor}×</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-100">{fmt(r.clv_estimado)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ color: SEG_COLOR[r.segmento], background: `${SEG_COLOR[r.segmento]}18` }}>
                        {r.segmento}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'grafico' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topBar} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
              <YAxis type="category" dataKey="vendedor" tick={{ fill: '#94a3b8', fontSize: 10 }} width={80} />
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
              <Bar dataKey="clv_estimado" radius={[0, 4, 4, 0]}>
                {topBar.map((r, i) => (
                  <Cell key={i} fill={SEG_COLOR[r.segmento] || '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
