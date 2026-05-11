import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  BarChart, Bar, Legend,
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
const SEGMENT_ORDER = [
  'Campeón','Cliente Leal','Potencial Leal','Cliente Reciente',
  'En Riesgo','Necesita Atención','Hibernando','Perdido',
]

const fmt = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(a/1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a/1e3).toFixed(0)}K`
  return `$${v}`
}

function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-48 shadow-2xl">
      <p className="font-semibold text-slate-100 truncate">{d.nombre_cliente}</p>
      <p className="text-slate-500 font-mono mb-2">{d.numero_cliente}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Ventas</span>
          <span className="text-slate-200">{fmt(d.ventas_netas)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-emerald-400">Recencia</span>
          <span className="font-bold text-emerald-300">{d.score_r}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">Frecuencia</span>
          <span className="font-bold text-blue-300">{d.score_f}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-purple-400">Monetario</span>
          <span className="font-bold text-purple-300">{d.score_m}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Score total</span>
          <span className="font-bold text-slate-100">{d.score_rfm}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-surface-700">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ background: `${SEGMENT_COLOR[d.segmento]}20`, color: SEGMENT_COLOR[d.segmento] }}>
          {d.segmento}
        </span>
      </div>
    </div>
  )
}

function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <p className="font-semibold mb-1" style={{ color: SEGMENT_COLOR[label] || '#94a3b8' }}>{label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-slate-400">Clientes</span>
        <span className="font-bold text-slate-100">{payload[0].value}</span>
      </div>
    </div>
  )
}

export function RFMView() {
  const { refreshKey }           = useOutletContext()
  const { filters }              = useFilters()
  const [data, setData]          = useState([])
  const [resumen, setResumen]    = useState({})
  const [loading, setLoading]    = useState(false)
  const [error, setError]        = useState('')
  const [tab, setTab]            = useState('grafico')
  const [segFilter, setSegFilter]= useState('Todos')
  const [rfmPage, setRfmPage]    = useState(0)
  const RFM_PAGE = 50

  useEffect(() => {
    setLoading(true)
    setError('')
    api.rfm(filters.ano, filters.mes, true, 500, filters.mes_fin)
      .then((d) => { setData(d.data || []); setResumen(d.resumen || {}) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar RFM'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.mes, filters.mes_fin, refreshKey])

  const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const periodoLabel = filters.mes
    ? `${MN[filters.mes-1]}${filters.mes_fin && filters.mes_fin !== filters.mes ? ` – ${MN[filters.mes_fin-1]}` : ''} ${filters.ano}`
    : filters.ano

  const segments   = ['Todos', ...SEGMENT_ORDER]
  const filtered   = segFilter === 'Todos' ? data : data.filter((r) => r.segmento === segFilter)
  const rfmPages   = Math.ceil(filtered.length / RFM_PAGE)
  const rfmRows    = filtered.slice(rfmPage * RFM_PAGE, (rfmPage + 1) * RFM_PAGE)

  // Bar chart data — ordered by importance
  const barData = useMemo(() =>
    SEGMENT_ORDER
      .filter((s) => resumen[s] > 0)
      .map((s) => ({ segmento: s, count: resumen[s] || 0 }))
  , [resumen])

  const totalClientes = Object.values(resumen).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Segmentación RFM</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Recencia · Frecuencia · Monetario — {periodoLabel}
          {totalClientes > 0 && <span className="ml-2 text-slate-500">{totalClientes} clientes analizados</span>}
        </p>
      </div>

      {/* Segment cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {SEGMENT_ORDER.map((seg) => {
          const count = resumen[seg] || 0
          const pct   = totalClientes > 0 ? (count / totalClientes * 100).toFixed(0) : 0
          return (
            <button key={seg} onClick={() => setSegFilter(segFilter === seg ? 'Todos' : seg)}
              className={`border rounded-xl p-3 text-left transition-all hover:scale-[1.02] ${
                segFilter === seg ? 'ring-2' : 'border-surface-700'
              }`}
              style={{
                background: `${SEGMENT_COLOR[seg]}10`,
                borderColor: segFilter === seg ? SEGMENT_COLOR[seg] : undefined,
                ringColor: SEGMENT_COLOR[seg],
              }}
            >
              <div className="text-lg font-bold" style={{ color: SEGMENT_COLOR[seg] }}>{count}</div>
              <div className="text-xs text-slate-400 mt-0.5 leading-tight">{seg}</div>
              <div className="text-xs mt-1" style={{ color: `${SEGMENT_COLOR[seg]}99` }}>{pct}%</div>
            </button>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['grafico','Distribución'], ['scatter','Scatter R×M'], ['tabla','Tabla']].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}>{l}</button>
        ))}
        <select value={segFilter} onChange={(e) => { setSegFilter(e.target.value); setRfmPage(0) }}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300">
          {segments.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button
          onClick={() => {
            const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
              'N° Cliente': r.numero_cliente, 'Nombre': r.nombre_cliente,
              'Ventas': r.ventas_netas, 'Meses Activos': r.meses_activos,
              'Score R': r.score_r, 'Score F': r.score_f, 'Score M': r.score_m,
              'Score RFM': r.score_rfm, 'Segmento': r.segmento,
            })))
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'RFM')
            XLSX.writeFile(wb, `rfm-${filters.ano}.xlsx`)
          }}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <Download size={12} /> Excel
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {/* Bar chart */}
      {tab === 'grafico' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-80">
          <p className="text-xs text-slate-400 mb-3">Distribución de segmentos — haz clic para filtrar</p>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={barData} layout="vertical" margin={{ top: 2, right: 50, left: 8, bottom: 2 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="segmento" tick={{ fill: '#cbd5e1', fontSize: 11 }}
                axisLine={false} tickLine={false} width={135} />
              <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive maxBarSize={20}
                label={{ position: 'right', fill: '#94a3b8', fontSize: 10 }}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={SEGMENT_COLOR[d.segmento]}
                    fillOpacity={segFilter === d.segmento || segFilter === 'Todos' ? 0.85 : 0.25}
                    cursor="pointer"
                    onClick={() => setSegFilter(segFilter === d.segmento ? 'Todos' : d.segmento)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Scatter */}
      {tab === 'scatter' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-96">
          <p className="text-xs text-slate-400 mb-1">Score Recencia (X) vs Score Monetario (Y) · tamaño = ventas</p>
          <ResponsiveContainer width="100%" height="90%">
            <ScatterChart margin={{ top: 8, right: 24, left: 4, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="score_r" type="number" name="Recencia"
                label={{ value: 'Score Recencia (1=antiguo, 5=reciente)', position: 'insideBottom', fill: '#6b7280', fontSize: 11, dy: 16 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0.5, 5.5]} ticks={[1,2,3,4,5]}
                axisLine={false} tickLine={false} />
              <YAxis dataKey="score_m" type="number" name="Monetario"
                label={{ value: 'Score Monetario', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0.5, 5.5]} ticks={[1,2,3,4,5]}
                axisLine={false} tickLine={false} />
              <ZAxis dataKey="ventas_netas" range={[30, 500]} />
              <Tooltip cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} content={<ScatterTip />} />
              <Scatter data={filtered} isAnimationActive>
                {filtered.map((r, i) => (
                  <Cell key={i} fill={SEGMENT_COLOR[r.segmento] || '#6b7280'}
                    fillOpacity={0.75} cursor="pointer" />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      {tab === 'tabla' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-surface-700 flex items-center justify-between text-xs text-slate-400">
            <span>{filtered.length} clientes{segFilter !== 'Todos' ? ` · "${segFilter}"` : ''} · pág. {rfmPage + 1}/{rfmPages || 1}</span>
            <div className="flex gap-1">
              <button onClick={() => setRfmPage(p => Math.max(0, p - 1))} disabled={rfmPage === 0}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 text-slate-400 hover:text-slate-100 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button onClick={() => setRfmPage(p => Math.min(rfmPages - 1, p + 1))} disabled={rfmPage >= rfmPages - 1}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 text-slate-400 hover:text-slate-100 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-right px-4 py-3">Ventas</th>
                  <th className="text-center px-3 py-3">Meses</th>
                  <th className="text-center px-3 py-3 text-emerald-400">R</th>
                  <th className="text-center px-3 py-3 text-blue-400">F</th>
                  <th className="text-center px-3 py-3 text-purple-400">M</th>
                  <th className="text-center px-3 py-3">RFM</th>
                  <th className="text-left px-4 py-3">Segmento</th>
                </tr>
              </thead>
              <tbody>
                {rfmRows.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50 transition-colors">
                    <td className="px-4 py-2 text-slate-200">
                      <div className="font-medium truncate max-w-xs" title={r.nombre_cliente}>{r.nombre_cliente}</div>
                      <div className="text-slate-500 font-mono">{r.numero_cliente}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_netas)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.meses_activos}</td>
                    <td className="px-3 py-2 text-center font-bold text-emerald-400">{r.score_r}</td>
                    <td className="px-3 py-2 text-center font-bold text-blue-400">{r.score_f}</td>
                    <td className="px-3 py-2 text-center font-bold text-purple-400">{r.score_m}</td>
                    <td className="px-3 py-2 text-center font-bold text-slate-200">{r.score_rfm}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: `${SEGMENT_COLOR[r.segmento]}20`, color: SEGMENT_COLOR[r.segmento] }}>
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
    </div>
  )
}
