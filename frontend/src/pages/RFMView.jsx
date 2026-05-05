import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const SEGMENT_COLOR = {
  'Campeón':           '#22c55e',
  'Cliente Leal':      '#3b82f6',
  'Potencial Leal':    '#06b6d4',
  'Cliente Reciente':  '#a78bfa',
  'En Riesgo':         '#f59e0b',
  'Necesita Atención': '#f97316',
  'Hibernando':        '#6b7280',
  'Perdido':           '#ef4444',
}

const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v}`

export function RFMView() {
  const { refreshKey }           = useOutletContext()
  const { filters }              = useFilters()
  const [data, setData]          = useState([])
  const [resumen, setResumen]    = useState({})
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState('')
  const [tab, setTab]            = useState('tabla')
  const [segFilter, setSegFilter]= useState('Todos')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.rfm(filters.ano, filters.mes, true)
      .then((d) => { setData(d.data || []); setResumen(d.resumen || {}) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar RFM'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.mes, refreshKey])

  const segments = ['Todos', ...Object.keys(SEGMENT_COLOR)]
  const filtered = segFilter === 'Todos' ? data : data.filter((r) => r.segmento === segFilter)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Segmentación RFM</h1>
          <p className="text-xs text-slate-400 mt-0.5">Recencia · Frecuencia · Monetario — {filters.ano}</p>
        </div>
      </div>

      {/* Resumen cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {Object.entries(resumen).map(([seg, count]) => (
          <button
            key={seg}
            onClick={() => setSegFilter(segFilter === seg ? 'Todos' : seg)}
            className={`bg-surface-800 border rounded-xl p-3 text-left transition-all ${
              segFilter === seg ? 'border-brand-500 bg-brand-600/10' : 'border-surface-700 hover:border-surface-500'
            }`}
          >
            <div className="text-lg font-bold" style={{ color: SEGMENT_COLOR[seg] }}>{count}</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-tight">{seg}</div>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {['tabla', 'scatter'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
          >
            {t === 'tabla' ? 'Tabla' : 'Scatter R×M'}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <select
            value={segFilter}
            onChange={(e) => setSegFilter(e.target.value)}
            className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300"
          >
            {segments.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
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
                  <th className="text-right px-4 py-3">Ventas</th>
                  <th className="text-center px-3 py-3">Meses</th>
                  <th className="text-center px-3 py-3">R</th>
                  <th className="text-center px-3 py-3">F</th>
                  <th className="text-center px-3 py-3">M</th>
                  <th className="text-center px-3 py-3">RFM</th>
                  <th className="text-left px-4 py-3">Segmento</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="px-4 py-2 font-mono text-slate-200">{r.vendedor}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_netas)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.meses_activos}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: SEGMENT_COLOR['Campeón'] }}>{r.score_r}</td>
                    <td className="px-3 py-2 text-center font-bold text-blue-400">{r.score_f}</td>
                    <td className="px-3 py-2 text-center font-bold text-purple-400">{r.score_m}</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-200">{r.score_rfm}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: `${SEGMENT_COLOR[r.segmento]}20`, color: SEGMENT_COLOR[r.segmento] }}>
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

      {tab === 'scatter' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="score_r" name="Recencia" label={{ value: 'Score R', position: 'insideBottom', fill: '#94a3b8', fontSize: 11 }} tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0.5, 5.5]} />
              <YAxis dataKey="score_m" name="Monetario" label={{ value: 'Score M', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0.5, 5.5]} />
              <ZAxis dataKey="ventas_netas" range={[40, 400]} />
              <Tooltip
                cursor={{ stroke: '#475569' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="bg-surface-800 border border-surface-600 rounded-lg p-3 text-xs">
                      <p className="font-mono text-slate-200">{d.vendedor}</p>
                      <p className="text-slate-400 mt-1">Ventas: {fmt(d.ventas_netas)}</p>
                      <p style={{ color: SEGMENT_COLOR[d.segmento] }}>{d.segmento}</p>
                    </div>
                  )
                }}
              />
              <Scatter data={filtered} fill="#3b82f6">
                {filtered.map((r, i) => (
                  <Cell key={i} fill={SEGMENT_COLOR[r.segmento] || '#6b7280'} fillOpacity={0.8} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
