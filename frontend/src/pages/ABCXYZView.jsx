import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const ABC_COLOR  = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }
const XYZ_COLOR  = { X: '#3b82f6', Y: '#a78bfa', Z: '#f97316' }
const CLASE_BG   = {
  AX: 'bg-emerald-500/20 text-emerald-300', AY: 'bg-emerald-500/10 text-emerald-400',
  AZ: 'bg-yellow-500/10 text-yellow-300',
  BX: 'bg-blue-500/15 text-blue-300',       BY: 'bg-blue-500/10 text-blue-400',
  BZ: 'bg-purple-500/10 text-purple-400',
  CX: 'bg-slate-700 text-slate-300',         CY: 'bg-slate-700 text-slate-400',
  CZ: 'bg-red-500/10 text-red-400',
}

const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v}`

const MATRIX_CELLS = [
  ['AX','AY','AZ'],
  ['BX','BY','BZ'],
  ['CX','CY','CZ'],
]

export function ABCXYZView() {
  const { refreshKey }          = useOutletContext()
  const { filters }             = useFilters()
  const [data, setData]         = useState([])
  const [resumen, setResumen]   = useState({})
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState('tabla')
  const [claseFilter, setClase] = useState('Todos')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.abcxyz(filters.ano)
      .then((d) => { setData(d.data || []); setResumen(d.resumen || {}) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar ABC/XYZ'))
      .finally(() => setLoading(false))
  }, [filters.ano, refreshKey])

  const clases    = ['Todos', ...Object.keys(CLASE_BG)]
  const filtered  = claseFilter === 'Todos' ? data : data.filter((r) => r.clase === claseFilter)
  const paretoData = data.map((r, i) => ({ i: i + 1, cum_pct: r.cum_pct }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Clasificación ABC / XYZ</h1>
        <p className="text-xs text-slate-400 mt-0.5">ABC: participación en ventas · XYZ: variabilidad — {filters.ano}</p>
      </div>

      {/* Matrix */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-3 font-medium">Matriz ABC × XYZ — cantidad de productos</p>
        <div className="grid grid-cols-4 gap-2 max-w-sm">
          <div className="text-center" />
          {['X', 'Y', 'Z'].map((x) => (
            <div key={x} className="text-center text-xs font-bold" style={{ color: XYZ_COLOR[x] }}>{x}</div>
          ))}
          {MATRIX_CELLS.map((row, ri) => (
            <>
              <div key={`r${ri}`} className="text-xs font-bold flex items-center" style={{ color: ABC_COLOR[['A','B','C'][ri]] }}>
                {['A','B','C'][ri]}
              </div>
              {row.map((cls) => (
                <button
                  key={cls}
                  onClick={() => setClase(claseFilter === cls ? 'Todos' : cls)}
                  className={`rounded-lg p-3 text-center text-sm font-bold transition-all ${
                    claseFilter === cls ? 'ring-2 ring-brand-500 ' : ''
                  } ${CLASE_BG[cls] || 'bg-surface-800 text-slate-400'}`}
                >
                  {resumen[cls] || 0}
                  <div className="text-xs font-normal opacity-70">{cls}</div>
                </button>
              ))}
            </>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {['tabla', 'pareto'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
          >
            {t === 'tabla' ? 'Tabla productos' : 'Curva Pareto'}
          </button>
        ))}
        <select
          value={claseFilter}
          onChange={(e) => setClase(e.target.value)}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300"
        >
          {clases.map((c) => <option key={c}>{c}</option>)}
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
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Descripción</th>
                  <th className="text-right px-4 py-3">Ventas</th>
                  <th className="text-right px-4 py-3">Cum %</th>
                  <th className="text-center px-3 py-3">ABC</th>
                  <th className="text-right px-3 py-3">CV</th>
                  <th className="text-center px-3 py-3">XYZ</th>
                  <th className="text-center px-3 py-3">Clase</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="px-4 py-2 font-mono text-slate-400">{r.codigo_producto}</td>
                    <td className="px-4 py-2 text-slate-200 max-w-xs truncate">{r.descripcion}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_netas)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{r.cum_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center font-bold text-base" style={{ color: ABC_COLOR[r.abc] }}>{r.abc}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.cv.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center font-bold text-base" style={{ color: XYZ_COLOR[r.xyz] }}>{r.xyz}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CLASE_BG[r.clase] || 'bg-surface-700 text-slate-400'}`}>
                        {r.clase}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'pareto' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={paretoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="i" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'Nro producto', position: 'insideBottom', fill: '#94a3b8', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v) => `${v.toFixed(1)}%`} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
              <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 4" label={{ value: 'A 80%', fill: '#22c55e', fontSize: 11 }} />
              <ReferenceLine y={95} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'B 95%', fill: '#f59e0b', fontSize: 11 }} />
              <Line dataKey="cum_pct" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
