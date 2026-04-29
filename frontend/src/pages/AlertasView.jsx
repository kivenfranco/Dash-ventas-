import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, MONTH_NAMES } from '../utils/format'
import { BellRing, AlertTriangle, AlertCircle, Info, TrendingDown, Filter, Store, Clock, BarChart2, Users } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, ScatterChart, Scatter, ZAxis,
} from 'recharts'

const SEV_CFG = {
  critica:    { label: 'Crítica',    bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30',    icon: AlertCircle   },
  alta:       { label: 'Alta',       bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', icon: AlertTriangle },
  media:      { label: 'Media',      bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30',  icon: Info          },
}
const INACT_CFG = {
  perdido:    { label: 'Perdido',    bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30'    },
  riesgo_alto:{ label: 'Riesgo alto',bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  riesgo:     { label: 'Riesgo',     bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30'  },
}
const RFM_COLORS = {
  'Campeón':  '#10b981', 'Leal': '#6366f1', 'Potencial': '#06b6d4',
  'Nuevo':    '#3b82f6', 'Regular': '#94a3b8', 'En Riesgo': '#f59e0b',
  'No Perder':'#f97316', 'Perdido': '#f43f5e',
}

const TABS = [
  { id: 'caida',     label: 'Caída YoY',   icon: TrendingDown },
  { id: 'inactivos', label: 'Inactivos',   icon: Clock        },
  { id: 'rfm',       label: 'RFM',         icon: BarChart2    },
]

export function AlertasView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [tab, setTab]  = useState('caida')
  const [umbral, setUmbral]   = useState(-20)
  const [meses, setMeses]     = useState(3)
  const [exclPvta, setExclPvta] = useState(true)

  const period = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Alertas y Segmentación de Clientes</h1>
          <p className="text-slate-500 text-xs mt-0.5">Riesgo de pérdida · Inactivos · RFM · {period}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExclPvta((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              exclPvta ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                       : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
            }`}
          >
            <Store size={12} />
            {exclPvta ? 'Sin PVTA' : 'Con PVTA'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-slate-100 border border-surface-700'
            }`}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {tab === 'caida'     && <CaidaTab filters={filters} refreshKey={refreshKey} umbral={umbral} setUmbral={setUmbral} exclPvta={exclPvta} />}
      {tab === 'inactivos' && <InactivosTab filters={filters} refreshKey={refreshKey} meses={meses} setMeses={setMeses} exclPvta={exclPvta} />}
      {tab === 'rfm'       && <RFMTab filters={filters} refreshKey={refreshKey} exclPvta={exclPvta} />}
    </div>
  )
}

/* ─── Caída YoY ─────────────────────────────────────────────────────────── */
function CaidaTab({ filters, refreshKey, umbral, setUmbral, exclPvta }) {
  const [sevFilter, setSevFilter] = useState('all')
  const { data, loading } = useData(() => api.alertas(filters, umbral, exclPvta), [filters, refreshKey, umbral, exclPvta])

  const res     = data?.resumen || {}
  const alertas = data?.alertas || []
  const filtered = sevFilter === 'all' ? alertas : alertas.filter((a) => a.severidad === sevFilter)
  const chartData = filtered.slice(0, 10).map((a) => ({
    name: a.nombre?.length > 16 ? a.nombre.slice(0, 16) + '…' : (a.nombre || '—'),
    variacion_yoy_pct: a.variacion_yoy_pct,
  }))

  return (
    <>
      {res.critica > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3">
          <BellRing size={18} className="text-red-400 flex-shrink-0 animate-pulse" />
          <span className="text-red-400 font-semibold text-sm">
            {res.critica} clientes críticos — caída &gt;50% vs año anterior
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {[['all','Todas'], ['critica','Críticas'], ['alta','Altas'], ['media','Medias']].map(([key, lbl]) => (
            <button key={key} onClick={() => setSevFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sevFilter === key ? 'bg-brand-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-100'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Filter size={12} className="text-slate-400" />
          <span className="text-xs text-slate-400">Umbral:</span>
          <select className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1 text-xs"
            value={umbral} onChange={(e) => setUmbral(Number(e.target.value))}>
            {[-10,-20,-30,-40,-50].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Total" value={fmtInt(res.total)} color="text-slate-200" bg="bg-surface-800 border-surface-700" />
        <SumCard label="Crítica >-50%" value={fmtInt(res.critica)} color="text-red-400" bg="bg-red-500/10 border-red-500/25" />
        <SumCard label="Alta -30%/-50%" value={fmtInt(res.alta)} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/25" />
        <SumCard label="Media -20%/-30%" value={fmtInt(res.media)} color="text-amber-400" bg="bg-amber-500/10 border-amber-500/25" />
      </div>
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Top 10 Mayores Caídas</h2>
          <div className={`h-52 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top:2, right:20, left:8, bottom:2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill:'#6b7280', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill:'#cbd5e1', fontSize:10 }} axisLine={false} tickLine={false} width={120} />
                <Tooltip formatter={(v) => fmtPct(v)} contentStyle={{ background:'#161b27', border:'1px solid #1f2937', borderRadius:8, fontSize:11 }} />
                <ReferenceLine x={umbral} stroke="#f59e0b" strokeDasharray="4 2" />
                <Bar dataKey="variacion_yoy_pct" name="Var YoY" radius={[0,3,3,0]}>
                  {chartData.map((e, i) => {
                    const v = e.variacion_yoy_pct || 0
                    return <Cell key={i} fill={v <= -50 ? '#f43f5e' : v <= -30 ? '#f97316' : '#f59e0b'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <ClientTable rows={filtered} loading={loading} columns="caida" />
    </>
  )
}

/* ─── Inactivos ──────────────────────────────────────────────────────────── */
function InactivosTab({ filters, refreshKey, meses, setMeses, exclPvta }) {
  const [clasFilter, setClasFilter] = useState('all')
  const { data, loading } = useData(() => api.inactivos(filters, meses, exclPvta), [filters, refreshKey, meses, exclPvta])

  const rows    = data?.data || []
  const filtered = clasFilter === 'all' ? rows : rows.filter((r) => r.clasificacion === clasFilter)

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {[['all','Todos'], ['perdido','Perdidos >6m'], ['riesgo_alto','Riesgo >3m'], ['riesgo','Riesgo']].map(([key, lbl]) => (
            <button key={key} onClick={() => setClasFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${clasFilter === key ? 'bg-brand-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-100'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Clock size={12} className="text-slate-400" />
          <span className="text-xs text-slate-400">Sin compra ≥</span>
          <select className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1 text-xs"
            value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            {[1,2,3,4,6,9,12].map((v) => <option key={v} value={v}>{v} mes{v > 1 ? 'es' : ''}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SumCard label="Perdidos >6 meses" value={fmtInt(data?.perdidos)} color="text-red-400" bg="bg-red-500/10 border-red-500/25" />
        <SumCard label="Riesgo alto >3 meses" value={fmtInt(data?.riesgo_alto)} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/25" />
        <SumCard label={`Riesgo >${meses} meses`} value={fmtInt(data?.riesgo)} color="text-amber-400" bg="bg-amber-500/10 border-amber-500/25" />
      </div>
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Clientes Inactivos · {filtered.length} registros</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Vendedor</th>
                <th className="pb-2 font-medium text-right">Días sin compra</th>
                <th className="pb-2 font-medium text-right">Última compra</th>
                <th className="pb-2 font-medium text-right">Ventas 12m</th>
                <th className="pb-2 font-medium text-right">Ventas históricas</th>
                <th className="pb-2 font-medium text-right">Nº Facturas</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_,i) => <tr key={i}><td colSpan={8}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : filtered.length === 0
                ? <tr><td colSpan={8} className="py-10 text-center text-slate-500">Sin inactivos con los filtros seleccionados</td></tr>
                : filtered.map((r, i) => {
                    const cfg = INACT_CFG[r.clasificacion] || INACT_CFG.riesgo
                    return (
                      <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                        <td className="py-2">
                          <span className={`badge ${cfg.bg} ${cfg.text} border ${cfg.border} text-xs`}>{cfg.label}</span>
                        </td>
                        <td className="py-2 font-medium text-slate-100 max-w-[160px] truncate">{r.nombre}</td>
                        <td className="py-2 text-slate-400 max-w-[120px] truncate">{r.nombre_vendedor || r.vendedor}</td>
                        <td className="py-2 text-right font-bold text-rose-400">{fmtInt(r.dias_sin_compra)}</td>
                        <td className="py-2 text-right text-slate-500">{r.ultima_compra || '—'}</td>
                        <td className="py-2 text-right text-slate-400">{fmtCOP(r.ventas_12m)}</td>
                        <td className="py-2 text-right text-slate-500">{fmtCOP(r.ventas_historico)}</td>
                        <td className="py-2 text-right text-slate-500">{fmtInt(r.num_facturas)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ─── RFM ────────────────────────────────────────────────────────────────── */
const RFM_ORDER = ['Campeón','Leal','Potencial','Nuevo','Regular','En Riesgo','No Perder','Perdido']

function RFMTab({ filters, refreshKey, exclPvta }) {
  const [segFilter, setSegFilter] = useState('all')
  const { data, loading } = useData(() => api.rfm(filters, exclPvta), [filters, refreshKey, exclPvta])

  const rows    = data?.data || []
  const segs    = data?.segmentos || {}
  const filtered = segFilter === 'all' ? rows : rows.filter((r) => r.segmento === segFilter)

  const segData = RFM_ORDER
    .filter((s) => segs[s])
    .map((s) => ({ name: s, value: segs[s], fill: RFM_COLORS[s] || '#6366f1' }))

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        {segData.map((s) => (
          <button key={s.name} onClick={() => setSegFilter(segFilter === s.name ? 'all' : s.name)}
            className={`rounded-xl p-3 border text-left transition-all ${segFilter === s.name ? 'border-brand-500 bg-brand-600/10' : 'border-surface-700 bg-surface-800 hover:border-surface-500'}`}>
            <div className="w-2 h-2 rounded-full mb-1.5" style={{ background: s.fill }} />
            <p className="text-xs text-slate-400 leading-tight">{s.name}</p>
            <p className="text-lg font-bold text-slate-100 mt-0.5">{s.value}</p>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Detalle RFM · {filtered.length} clientes
            {segFilter !== 'all' && <span className="ml-2 text-xs text-brand-400">— {segFilter}</span>}
          </h2>
          {segFilter !== 'all' && (
            <button onClick={() => setSegFilter('all')} className="text-xs text-slate-400 hover:text-slate-100">
              Ver todos ×
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">Segmento</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium text-right">Monto</th>
                <th className="pb-2 font-medium text-right">R (días)</th>
                <th className="pb-2 font-medium text-right">F (facturas)</th>
                <th className="pb-2 font-medium text-right">Score R</th>
                <th className="pb-2 font-medium text-right">Score F</th>
                <th className="pb-2 font-medium text-right">Score M</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_,i) => <tr key={i}><td colSpan={10}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : filtered.length === 0
                ? <tr><td colSpan={10} className="py-10 text-center text-slate-500">Sin datos</td></tr>
                : filtered.map((r, i) => (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: (RFM_COLORS[r.segmento] || '#6366f1') + '25', color: RFM_COLORS[r.segmento] || '#6366f1' }}>
                          {r.segmento}
                        </span>
                      </td>
                      <td className="py-2 font-medium text-slate-100 max-w-[160px] truncate">{r.nombre}</td>
                      <td className="py-2 text-right text-brand-300 font-semibold">{fmtCOP(r.monto)}</td>
                      <td className="py-2 text-right text-slate-400">{fmtInt(r.recencia)}</td>
                      <td className="py-2 text-right text-slate-400">{fmtInt(r.frecuencia)}</td>
                      <td className="py-2 text-right"><Score v={r.r_score} /></td>
                      <td className="py-2 text-right"><Score v={r.f_score} /></td>
                      <td className="py-2 text-right"><Score v={r.m_score} /></td>
                      <td className="py-2 text-right font-bold text-slate-200">{r.rfm_score}</td>
                      <td className="py-2 text-slate-500">{r.ultima_compra || '—'}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ─── Shared ─────────────────────────────────────────────────────────────── */
function ClientTable({ rows, loading, columns }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-slate-200 mb-4">Lista · {rows.length} clientes</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-surface-700 text-slate-400">
              <th className="pb-2 font-medium">Severidad</th>
              <th className="pb-2 font-medium">Cliente</th>
              <th className="pb-2 font-medium">Estado</th>
              <th className="pb-2 font-medium">Vendedor</th>
              <th className="pb-2 font-medium text-right">Ventas</th>
              <th className="pb-2 font-medium text-right">Año Ant.</th>
              <th className="pb-2 font-medium text-right">Var YoY</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(8)].map((_,i) => <tr key={i}><td colSpan={7}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
              : rows.length === 0
              ? <tr><td colSpan={7} className="py-10 text-center text-slate-500">Sin alertas con el umbral seleccionado</td></tr>
              : rows.map((a, i) => {
                  const sev = SEV_CFG[a.severidad] || SEV_CFG.media
                  const Icon = sev.icon
                  return (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2">
                        <span className={`badge ${sev.bg} ${sev.text} border ${sev.border} text-xs`}>
                          <Icon size={10} />{sev.label}
                        </span>
                      </td>
                      <td className="py-2 font-medium text-slate-100 max-w-[160px] truncate">{a.nombre}</td>
                      <td className="py-2"><EstadoBadge estado={a.estado_cliente} /></td>
                      <td className="py-2 text-slate-400 max-w-[120px] truncate">{a.nombre_vendedor || a.vendedor}</td>
                      <td className="py-2 text-right text-brand-300 font-medium">{fmtCOP(a.ventas_netas)}</td>
                      <td className="py-2 text-right text-slate-500">{fmtCOP(a.ventas_netas_ant)}</td>
                      <td className={`py-2 text-right font-bold ${a.variacion_yoy_pct <= -50 ? 'text-red-400' : a.variacion_yoy_pct <= -30 ? 'text-orange-400' : 'text-amber-400'}`}>
                        {fmtPct(a.variacion_yoy_pct, 1)}
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Score({ v }) {
  const colors = ['','text-red-400','text-orange-400','text-amber-400','text-emerald-300','text-emerald-400']
  return <span className={`font-bold ${colors[v] || 'text-slate-400'}`}>{v}</span>
}

function SumCard({ label, value, color, bg }) {
  return (
    <div className={`border rounded-xl p-4 ${bg}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

const ESTADO_COLORS = {
  ACTIVO:'badge-green', NUEVO:'badge-blue', PERDIDO:'badge-red',
  RIESGO:'badge-yellow', SEGUIMIENTO:'badge bg-purple-500/15 text-purple-400',
  RECUPERADO:'badge bg-blue-500/15 text-blue-400',
}
function EstadoBadge({ estado }) {
  const cls = ESTADO_COLORS[estado?.toUpperCase()] || 'badge-blue'
  return <span className={`badge ${cls} text-xs`}>{estado || '—'}</span>
}
