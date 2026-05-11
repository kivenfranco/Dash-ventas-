import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Download, ChevronLeft, ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const PAGE_SIZE = 50

const RIESGO_COLOR = { Alto: '#ef4444', Medio: '#f59e0b', Bajo: '#22c55e' }
const RIESGO_BG    = { Alto: 'rgba(239,68,68,0.1)', Medio: 'rgba(245,158,11,0.1)', Bajo: 'rgba(34,197,94,0.1)' }

const LEAD_ORDER = ['Inmediato', 'Corto plazo', 'Mediano plazo', 'Largo plazo']
const LEAD_COLOR = { 'Inmediato': '#ef4444', 'Corto plazo': '#f97316', 'Mediano plazo': '#f59e0b', 'Largo plazo': '#22c55e' }
const LEAD_BG    = { 'Inmediato': 'rgba(239,68,68,0.12)', 'Corto plazo': 'rgba(249,115,22,0.12)', 'Mediano plazo': 'rgba(245,158,11,0.12)', 'Largo plazo': 'rgba(34,197,94,0.12)' }
const LEAD_BORDER= { 'Inmediato': 'rgba(239,68,68,0.35)', 'Corto plazo': 'rgba(249,115,22,0.35)', 'Mediano plazo': 'rgba(245,158,11,0.35)', 'Largo plazo': 'rgba(34,197,94,0.35)' }

const fmt = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(a/1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function RiesgoBadge({ r }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: RIESGO_BG[r], color: RIESGO_COLOR[r] }}>
      {r}
    </span>
  )
}

function ChurnBarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs shadow-2xl">
      <p className="font-semibold mb-2" style={{ color: RIESGO_COLOR[label] || '#94a3b8' }}>
        Riesgo {label}
      </p>
      <div className="flex justify-between gap-6">
        <span className="text-slate-400">Clientes</span>
        <span className="font-bold text-slate-100">{payload[0].value}</span>
      </div>
    </div>
  )
}

function HistTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <p className="text-slate-300 font-medium mb-1">Prob. {label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-slate-400">Clientes</span>
        <span className="font-bold text-slate-100">{payload[0].value}</span>
      </div>
    </div>
  )
}

export function ChurnView() {
  const { refreshKey }         = useOutletContext()
  const { filters }            = useFilters()
  const [data, setData]              = useState([])
  const [resumen, setResumen]        = useState({})
  const [leadResumen, setLeadResumen]= useState({})
  const [metodo, setMetodo]          = useState('')
  const [loading, setLoading]        = useState(false)
  const [error, setError]            = useState('')
  const [tab, setTab]                = useState('grafico')
  const [rFilter, setRFilter]        = useState('Todos')
  const [page, setPage]              = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.churn(filters.ano, filters.excl_pvta !== false)
      .then((d) => {
        setData(d.data || [])
        setResumen(d.resumen || {})
        setLeadResumen(d.lead_time_resumen || {})
        setMetodo(d.metodo || '')
      })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar Churn'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.excl_pvta, refreshKey])

  const filtered = rFilter === 'Todos' ? data : data.filter((r) => r.riesgo === rFilter)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows   = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      'N° Cliente':       r.numero_cliente,
      'Nombre':           r.nombre_cliente,
      'Venta Actual':     r.ventas_cur,
      'Venta Anterior':   r.ventas_prev,
      'Meses Activos':    r.meses_cur,
      'Var. YoY %':       r.variacion_yoy,
      'Prob. Churn %':    r.prob_churn,
      'Riesgo':           r.riesgo,
      'Lead Time Alerta': r.lead_time_alerta,
      'Div. Productos':   r.diversidad_productos,
      'Ratio Actividad':  r.ratio_actividad,
      'Pausa Máx. Meses': r.pausa_maxima_meses,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Churn')
    XLSX.writeFile(wb, `churn-${filters.ano}.xlsx`)
  }

  const histData = useMemo(() => {
    const buckets = [
      { label: '0-20%',   min: 0,  max: 20,  count: 0 },
      { label: '20-40%',  min: 20, max: 40,  count: 0 },
      { label: '40-60%',  min: 40, max: 60,  count: 0 },
      { label: '60-80%',  min: 60, max: 80,  count: 0 },
      { label: '80-100%', min: 80, max: 100, count: 0 },
    ]
    data.forEach((r) => {
      const p = r.prob_churn ?? 0
      const b = buckets.find((b) => p >= b.min && p < b.max) || buckets[buckets.length - 1]
      b.count++
    })
    return buckets
  }, [data])

  const barData = [
    { label: 'Alto',  value: resumen.Alto  || 0 },
    { label: 'Medio', value: resumen.Medio || 0 },
    { label: 'Bajo',  value: resumen.Bajo  || 0 },
  ]

  const totalRisk = (resumen.Alto || 0) + (resumen.Medio || 0) + (resumen.Bajo || 0)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Predicción de Churn</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Riesgo de abandono por cliente — {filters.ano}
            {metodo && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-surface-700 text-slate-400">
                {metodo === 'logistic_regression' ? 'Regresión Logística' : 'Heurístico'}
              </span>
            )}
          </p>
        </div>
        {totalRisk > 0 && (
          <div className="text-right">
            <p className="text-xs text-slate-400">Riesgo medio/alto</p>
            <p className="text-lg font-bold text-orange-400">
              {(((resumen.Alto || 0) + (resumen.Medio || 0)) / totalRisk * 100).toFixed(0)}%
            </p>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 max-w-lg">
        {['Alto', 'Medio', 'Bajo'].map((r) => (
          <button key={r} onClick={() => setRFilter(rFilter === r ? 'Todos' : r)}
            className={`border rounded-xl p-4 text-left transition-all ${
              rFilter === r ? 'ring-2 ring-offset-1 ring-offset-surface-950' : 'hover:scale-[1.02]'
            }`}
            style={{
              borderColor: rFilter === r ? RIESGO_COLOR[r] : undefined,
              background: RIESGO_BG[r],
            }}
          >
            <p className="text-xs font-bold" style={{ color: RIESGO_COLOR[r] }}>{r} Riesgo</p>
            <p className="text-2xl font-bold mt-1" style={{ color: RIESGO_COLOR[r] }}>{resumen[r] || 0}</p>
            {totalRisk > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {((resumen[r] || 0) / totalRisk * 100).toFixed(0)}% del total
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Lead Time breakdown */}
      {LEAD_ORDER.some((lt) => leadResumen[lt]) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {LEAD_ORDER.map((lt) => (
            <div key={lt} className="rounded-xl px-3 py-2.5 border"
              style={{ background: LEAD_BG[lt], borderColor: LEAD_BORDER[lt] }}>
              <p className="text-xs font-medium" style={{ color: LEAD_COLOR[lt] }}>{lt}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color: LEAD_COLOR[lt] }}>
                {leadResumen[lt] || 0}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">clientes</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['grafico','Distribución'], ['histograma','Histograma Prob.'], ['tabla','Tabla']].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}>{l}</button>
        ))}
        <select value={rFilter} onChange={(e) => { setRFilter(e.target.value); setPage(0) }}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300">
          {['Todos', 'Alto', 'Medio', 'Bajo'].map((r) => <option key={r}>{r}</option>)}
        </select>
        <button onClick={exportXlsx}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <Download size={12} /> Excel
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {/* Bar chart: distribución por riesgo */}
      {tab === 'grafico' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-72">
          <p className="text-xs text-slate-400 mb-3">Clientes por nivel de riesgo — haz clic para filtrar</p>
          <ResponsiveContainer width="100%" height="82%">
            <BarChart data={barData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip content={<ChurnBarTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive>
                {barData.map((d, i) => (
                  <Cell key={i} fill={RIESGO_COLOR[d.label]}
                    fillOpacity={rFilter === d.label || rFilter === 'Todos' ? 0.9 : 0.3}
                    cursor="pointer"
                    onClick={() => setRFilter(rFilter === d.label ? 'Todos' : d.label)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Histogram: distribución de probabilidades */}
      {tab === 'histograma' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-72">
          <p className="text-xs text-slate-400 mb-3">Distribución de probabilidades de churn</p>
          <ResponsiveContainer width="100%" height="82%">
            <BarChart data={histData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip content={<HistTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive>
                {histData.map((d, i) => {
                  const pct = d.min
                  const color = pct >= 80 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#22c55e'
                  return <Cell key={i} fill={color} fillOpacity={0.85} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      {tab === 'tabla' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-surface-700 flex items-center justify-between">
            <p className="text-xs text-slate-400">{filtered.length} clientes · página {page + 1} de {totalPages || 1}</p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 transition-colors text-slate-400 hover:text-slate-100">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 transition-colors text-slate-400 hover:text-slate-100">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-right px-4 py-3">Venta Actual</th>
                  <th className="text-right px-4 py-3">Venta Anterior</th>
                  <th className="text-center px-3 py-3">Meses</th>
                  <th className="text-right px-3 py-3">Div.</th>
                  <th className="text-right px-3 py-3">Ratio</th>
                  <th className="text-right px-3 py-3">Pausa</th>
                  <th className="text-center px-3 py-3">Lead Time</th>
                  <th className="text-right px-3 py-3">Var. YoY</th>
                  <th className="text-right px-4 py-3">Prob. Churn</th>
                  <th className="text-center px-4 py-3">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50 transition-colors">
                    <td className="px-4 py-2 text-slate-200">
                      <div className="font-medium truncate max-w-xs" title={r.nombre_cliente}>{r.nombre_cliente}</div>
                      <div className="text-slate-500 font-mono">{r.numero_cliente}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_cur)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{fmt(r.ventas_prev)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.meses_cur}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.diversidad_productos ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.ratio_actividad != null ? r.ratio_actividad.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.pausa_maxima_meses ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {r.lead_time_alerta ? (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{ color: LEAD_COLOR[r.lead_time_alerta], background: LEAD_BG[r.lead_time_alerta] }}>
                          {r.lead_time_alerta}
                        </span>
                      ) : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      r.variacion_yoy == null ? 'text-slate-500' :
                      r.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {r.variacion_yoy != null ? `${r.variacion_yoy > 0 ? '+' : ''}${r.variacion_yoy.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-20 bg-surface-700 rounded-full h-1.5 overflow-hidden">
                          <div className="h-1.5 rounded-full transition-all"
                            style={{ width: `${r.prob_churn}%`, background: RIESGO_COLOR[r.riesgo] }} />
                        </div>
                        <span className="text-slate-200 w-10 text-right font-medium">{r.prob_churn.toFixed(0)}%</span>
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
    </div>
  )
}
