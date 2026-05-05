import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const RIESGO_COLOR = { Alto: '#ef4444', Medio: '#f59e0b', Bajo: '#22c55e' }

const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`

function RiesgoBadge({ r }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium`}
      style={{ background: `${RIESGO_COLOR[r]}20`, color: RIESGO_COLOR[r] }}>
      {r}
    </span>
  )
}

export function ChurnView() {
  const { refreshKey }         = useOutletContext()
  const { filters }            = useFilters()
  const [data, setData]        = useState([])
  const [resumen, setResumen]  = useState({})
  const [metodo, setMetodo]    = useState('')
  const [loading, setLoading]  = useState(false)
  const [error, setError]      = useState('')
  const [tab, setTab]          = useState('tabla')
  const [rFilter, setRFilter]  = useState('Todos')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.churn(filters.ano)
      .then((d) => {
        setData(d.data || [])
        setResumen(d.resumen || {})
        setMetodo(d.metodo || '')
      })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar Churn'))
      .finally(() => setLoading(false))
  }, [filters.ano, refreshKey])

  const filtered = rFilter === 'Todos' ? data : data.filter((r) => r.riesgo === rFilter)
  const histData = [
    { label: 'Alto',  value: resumen.Alto  || 0, fill: RIESGO_COLOR.Alto  },
    { label: 'Medio', value: resumen.Medio || 0, fill: RIESGO_COLOR.Medio },
    { label: 'Bajo',  value: resumen.Bajo  || 0, fill: RIESGO_COLOR.Bajo  },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Predicción de Churn</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Riesgo de abandono por vendedor — {filters.ano}
            {metodo && <span className="ml-2 text-slate-600">({metodo === 'logistic_regression' ? 'Regresión Logística' : 'Heurístico'})</span>}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 max-w-sm">
        {['Alto', 'Medio', 'Bajo'].map((r) => (
          <button
            key={r}
            onClick={() => setRFilter(rFilter === r ? 'Todos' : r)}
            className={`border rounded-xl p-4 text-left transition-all ${
              rFilter === r ? 'border-brand-500 bg-brand-600/10' : 'border-surface-700 bg-surface-900 hover:border-surface-500'
            }`}
          >
            <p className="text-xs font-bold" style={{ color: RIESGO_COLOR[r] }}>{r}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: RIESGO_COLOR[r] }}>{resumen[r] || 0}</p>
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
            {t === 'tabla' ? 'Tabla' : 'Distribución'}
          </button>
        ))}
        <select
          value={rFilter}
          onChange={(e) => setRFilter(e.target.value)}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300"
        >
          {['Todos', 'Alto', 'Medio', 'Bajo'].map((r) => <option key={r}>{r}</option>)}
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
                  <th className="text-right px-4 py-3">Venta Actual</th>
                  <th className="text-right px-4 py-3">Venta Anterior</th>
                  <th className="text-center px-3 py-3">Meses Cur</th>
                  <th className="text-right px-3 py-3">Var. YoY</th>
                  <th className="text-right px-4 py-3">Prob. Churn</th>
                  <th className="text-center px-4 py-3">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="px-4 py-2 font-mono text-slate-200">{r.vendedor}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_cur)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{fmt(r.ventas_prev)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.meses_cur}</td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      r.variacion_yoy == null ? 'text-slate-500' :
                      r.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {r.variacion_yoy != null ? `${r.variacion_yoy > 0 ? '+' : ''}${r.variacion_yoy.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-16 bg-surface-700 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full transition-all"
                            style={{ width: `${r.prob_churn}%`, background: RIESGO_COLOR[r.riesgo] }}
                          />
                        </div>
                        <span className="text-slate-200 w-10 text-right">{r.prob_churn.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center"><RiesgoBadge r={r.riesgo} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'grafico' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                formatter={(v) => [v, 'Vendedores']}
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {histData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
