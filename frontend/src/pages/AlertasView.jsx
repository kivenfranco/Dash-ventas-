import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, MONTH_NAMES } from '../utils/format'
import { exportToExcel } from '../utils/exportExcel'
import {
  BellRing, AlertTriangle, AlertCircle, Info,
  TrendingDown, Store, Clock, BarChart2, Activity, Zap,
  Download, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

const PAGE_SIZE = 100

function Pagination({ page, setPage, total }) {
  const totalPages = Math.ceil(total / PAGE_SIZE)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700/50">
      <span className="text-xs text-slate-500">
        {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, total)} de {fmtInt(total)}
      </span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => setPage(p => p-1)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-surface-700 border border-surface-600 text-slate-400 disabled:opacity-30 hover:text-slate-100 transition-colors">
          <ChevronLeft size={12}/> Ant
        </button>
        <span className="px-2 text-xs text-slate-500 tabular-nums">Hoja {page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p+1)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-surface-700 border border-surface-600 text-slate-400 disabled:opacity-30 hover:text-slate-100 transition-colors">
          Sig <ChevronRight size={12}/>
        </button>
      </div>
    </div>
  )
}

function ExportBtn({ onClick, count }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">
      <Download size={12}/> Excel ({fmtInt(count)})
    </button>
  )
}

// ── Config visual ────────────────────────────────────────────────────────────

const SEV_CFG = {
  critica: { label: 'Crítica',    bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30',    icon: AlertCircle   },
  alta:    { label: 'Alta',       bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', icon: AlertTriangle },
  media:   { label: 'Media',      bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30',  icon: Info          },
}

const INACT_CFG = {
  perdido:     { label: 'Perdido >6m',   bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30'    },
  riesgo_alto: { label: 'Riesgo >3m',   bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
  riesgo:      { label: 'Riesgo',        bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30'  },
}

const RFM_COLORS = {
  'Campeón': '#10b981', 'Leal': '#6366f1', 'Potencial': '#06b6d4',
  'Nuevo':   '#3b82f6', 'Regular': '#94a3b8', 'En Riesgo': '#f59e0b',
  'No Perder': '#f97316', 'Perdido': '#f43f5e',
}

const TABS = [
  { id: 'caida',      label: 'Caída YoY',    icon: TrendingDown },
  { id: 'tendencia',  label: 'Tendencia 6m', icon: Activity     },
  { id: 'inactivos',  label: 'Inactivos',    icon: Clock        },
  { id: 'rfm',        label: 'RFM',          icon: BarChart2    },
  { id: 'predictivo', label: 'Predictivo',   icon: Zap          },
]

const LEAD_ORDER_A = ['Inmediato', 'Corto plazo', 'Mediano plazo', 'Largo plazo']
const LEAD_CFG_A = {
  'Inmediato':     { text: 'text-red-400',     bg: 'bg-red-500/15',    border: 'border-red-500/30'     },
  'Corto plazo':   { text: 'text-orange-400',  bg: 'bg-orange-500/15', border: 'border-orange-500/30'  },
  'Mediano plazo': { text: 'text-amber-400',   bg: 'bg-amber-500/15',  border: 'border-amber-500/30'   },
  'Largo plazo':   { text: 'text-emerald-400', bg: 'bg-emerald-500/15',border: 'border-emerald-500/30' },
}
const RIESGO_COL_A = { Alto: '#ef4444', Medio: '#f59e0b', Bajo: '#22c55e' }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MN_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmtDate(d) {
  if (!d) return '—'
  const parts = d.split('T')[0].split('-')
  if (parts.length < 3) return d
  return `${parseInt(parts[2])} ${MN_SHORT[parseInt(parts[1]) - 1]} ${String(parts[0]).slice(2)}`
}

// ── Vista principal ──────────────────────────────────────────────────────────

export function AlertasView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [tab, setTab]  = useState('caida')
  const [umbral, setUmbral]         = useState(-20)
  const [meses, setMeses]           = useState(3)
  const [mesesTend, setMesesTend]   = useState(6)
  const [exclPvta, setExclPvta]     = useState(true)
  const [esStock, setEsStock]       = useState(null)  // null=Todos, 'Stock', 'No Stock'

  const period = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Alertas y Segmentación de Clientes</h1>
          <p className="text-slate-500 text-xs mt-0.5">Riesgo de pérdida · Tendencia · Inactivos · RFM · {period}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Stock / No Stock */}
          <div className="flex items-center gap-1 bg-surface-800 border border-surface-700 rounded-lg p-1">
            {[null, 'Stock', 'No Stock'].map((v) => (
              <button key={String(v)} onClick={() => setEsStock(v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  esStock === v ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'
                }`}>
                {v ?? 'Todos'}
              </button>
            ))}
          </div>
          {/* PVTA toggle */}
          <button
            onClick={() => setExclPvta((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              exclPvta
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
            }`}
          >
            <Store size={12} />
            {exclPvta ? 'Sin PVTA/Bogotá' : 'Con PVTA'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id
                ? 'bg-brand-600 text-white'
                : 'bg-surface-800 text-slate-400 hover:text-slate-100 border border-surface-700'
            }`}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {tab === 'caida'      && <CaidaTab      filters={filters} refreshKey={refreshKey} umbral={umbral}       setUmbral={setUmbral}       exclPvta={exclPvta} esStock={esStock} />}
      {tab === 'tendencia'  && <TendenciaTab  filters={filters} refreshKey={refreshKey} mesesTend={mesesTend} setMesesTend={setMesesTend} exclPvta={exclPvta} esStock={esStock} />}
      {tab === 'inactivos'  && <InactivosTab  filters={filters} refreshKey={refreshKey} meses={meses}         setMeses={setMeses}         exclPvta={exclPvta} esStock={esStock} />}
      {tab === 'rfm'        && <RFMTab        filters={filters} refreshKey={refreshKey}                                                   exclPvta={exclPvta} esStock={esStock} />}
      {tab === 'predictivo' && <PredictTab    filters={filters} refreshKey={refreshKey}                                                   exclPvta={exclPvta} />}
    </div>
  )
}

// ── Caída YoY ────────────────────────────────────────────────────────────────

function CaidaTab({ filters, refreshKey, umbral, setUmbral, exclPvta, esStock }) {
  const [sevFilter, setSevFilter] = useState('all')
  const [page, setPage] = useState(1)
  const { data, loading } = useData(() => api.alertas(filters, umbral, exclPvta, esStock), [filters, refreshKey, umbral, exclPvta, esStock])

  const res      = data?.resumen || {}
  const alertas  = data?.alertas || []
  const filtered = sevFilter === 'all' ? alertas : alertas.filter((a) => a.severidad === sevFilter)
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const handleExport = () => exportToExcel(filtered, [
    { key: 'nombre',           header: 'Cliente'     },
    { key: 'nombre_vendedor',  header: 'Asesor'      },
    { key: 'ventas_netas',     header: 'Ventas'      },
    { key: 'ventas_netas_ant', header: 'Año Ant.'    },
    { key: 'variacion_yoy_pct',header: 'Var YoY %'   },
    { key: 'ultima_compra',    header: 'Últ. Compra' },
    { key: 'severidad',        header: 'Severidad'   },
  ], `AlertasCaida_${filters.ano}`)

  const chartData = filtered.slice(0, 12).map((a) => ({
    name: a.nombre?.length > 18 ? a.nombre.slice(0, 17) + '…' : (a.nombre || '—'),
    pct:  a.variacion_yoy_pct,
    ant:  a.ventas_netas_ant,
  }))

  return (
    <>
      {res.critica > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3">
          <BellRing size={18} className="text-red-400 flex-shrink-0 animate-pulse" />
          <span className="text-red-400 font-semibold text-sm">
            {res.critica} clientes críticos — caída &gt;50% vs año anterior · ordenados por mayor consumo histórico
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {[['all','Todas'], ['critica','Críticas'], ['alta','Altas'], ['media','Medias']].map(([key, lbl]) => (
            <FilterBtn key={key} active={sevFilter === key} onClick={() => setSevFilter(key)}>{lbl}</FilterBtn>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs text-slate-400">
          <span>Umbral:</span>
          <select className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1 text-xs"
            value={umbral} onChange={(e) => setUmbral(Number(e.target.value))}>
            {[-5,-10,-20,-30,-40,-50].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Total clientes"   value={fmtInt(res.total)}   color="text-slate-200"   bg="bg-surface-800 border-surface-700" />
        <SumCard label="Crítica >-50%"    value={fmtInt(res.critica)} color="text-red-400"     bg="bg-red-500/10 border-red-500/25" />
        <SumCard label="Alta -30%/-50%"   value={fmtInt(res.alta)}    color="text-orange-400"  bg="bg-orange-500/10 border-orange-500/25" />
        <SumCard label="Media umbral/-30%" value={fmtInt(res.media)}  color="text-amber-400"   bg="bg-amber-500/10 border-amber-500/25" />
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Top {chartData.length} Mayores Caídas</h2>
          <p className="text-xs text-slate-500 mb-4">variación YoY % — clientes con mayor consumo histórico primero</p>
          <div className={`h-56 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 20, left: 8, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={140} />
                <Tooltip formatter={(v, k) => k === 'pct' ? fmtPct(v) : fmtCOP(v)}
                  contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine x={umbral} stroke="#f59e0b" strokeDasharray="4 2" />
                <Bar dataKey="pct" name="Var YoY" radius={[0, 3, 3, 0]}>
                  {chartData.map((e, i) => {
                    const v = e.pct || 0
                    return <Cell key={i} fill={v <= -50 ? '#f43f5e' : v <= -30 ? '#f97316' : '#f59e0b'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200">Lista · {filtered.length} clientes</h2>
          {filtered.length > 0 && <ExportBtn onClick={handleExport} count={filtered.length} />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Severidad</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium text-right">Ventas</th>
                <th className="pb-2 font-medium text-right">Año Ant.</th>
                <th className="pb-2 font-medium text-right">Var YoY</th>
                <th className="pb-2 font-medium text-right">Últ. compra</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => <tr key={i}><td colSpan={8}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : pageRows.length === 0
                ? <tr><td colSpan={8} className="py-10 text-center text-slate-500">Sin alertas con el umbral seleccionado</td></tr>
                : pageRows.map((a, i) => {
                    const sev  = SEV_CFG[a.severidad] || SEV_CFG.media
                    const Icon = sev.icon
                    return (
                      <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                        <td className="py-2 text-slate-500">{(page-1)*PAGE_SIZE+i+1}</td>
                        <td className="py-2">
                          <span className={`badge ${sev.bg} ${sev.text} border ${sev.border} text-xs`}>
                            <Icon size={10} />{sev.label}
                          </span>
                        </td>
                        <td className="py-2 font-medium text-slate-100 max-w-[180px] truncate">{a.nombre}</td>
                        <td className="py-2 text-slate-400 max-w-[130px] truncate">{a.nombre_vendedor || a.vendedor}</td>
                        <td className="py-2 text-right text-brand-300 font-medium">{fmtCOP(a.ventas_netas)}</td>
                        <td className="py-2 text-right text-slate-500">{fmtCOP(a.ventas_netas_ant)}</td>
                        <td className={`py-2 text-right font-bold ${a.variacion_yoy_pct <= -50 ? 'text-red-400' : a.variacion_yoy_pct <= -30 ? 'text-orange-400' : 'text-amber-400'}`}>
                          {fmtPct(a.variacion_yoy_pct, 1)}
                        </td>
                        <td className="py-2 text-right text-slate-500 text-xs">{fmtDate(a.ultima_compra)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  )
}

// ── Tendencia 6m ─────────────────────────────────────────────────────────────

function Sparkline({ values = [], w = 88, h = 26 }) {
  if (!values || values.length < 2) return <span className="text-slate-600 text-xs">—</span>
  const nonZero = values.filter((v) => v > 0)
  if (!nonZero.length) return <span className="text-slate-600 text-xs">—</span>
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const decline = values[values.length - 1] < values[0]
  const color = decline ? '#f43f5e' : '#10b981'
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - 2 - ((v - min) / range) * (h - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => {
        const x = (i / (values.length - 1)) * w
        const y = h - 2 - ((v - min) / range) * (h - 4)
        return <circle key={i} cx={x} cy={y} r={2} fill={v > 0 ? color : 'none'} />
      })}
    </svg>
  )
}

function TendenciaTab({ filters, refreshKey, mesesTend, setMesesTend, exclPvta, esStock }) {
  const [sevFilter, setSevFilter] = useState('all')
  const [page, setPage] = useState(1)
  const { data, loading } = useData(
    () => api.tendenciaClientes(filters, exclPvta, 500, mesesTend, esStock),
    [filters, refreshKey, exclPvta, mesesTend, esStock]
  )

  const rows     = data?.data || []
  const periodos = data?.periodos || []
  const filtered = sevFilter === 'all' ? rows : rows.filter((r) => r.severidad === sevFilter)
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const handleExport = () => exportToExcel(filtered, [
    { key: 'nombre',         header: 'Cliente'      },
    { key: 'nombre_vendedor',header: 'Asesor'        },
    { key: 'slope_pct',      header: 'Pendiente %/mes'},
    { key: 'avg_mensual',    header: 'Prom/mes COP' },
    { key: 'total_periodo',  header: 'Total Período' },
    { key: 'ultima_compra',  header: 'Últ. Compra'  },
    { key: 'severidad',      header: 'Severidad'    },
  ], `AlertasTendencia_${filters.ano}`)

  const chartData = filtered.slice(0, 12).map((r) => ({
    name:  r.nombre?.length > 18 ? r.nombre.slice(0, 17) + '…' : (r.nombre || '—'),
    slope: Math.abs(r.slope_pct),
    avg:   r.avg_mensual,
  }))

  return (
    <>
      {(data?.critica || 0) > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-3">
          <BellRing size={18} className="text-red-400 flex-shrink-0 animate-pulse" />
          <span className="text-red-400 font-semibold text-sm">
            {data.critica} clientes en caída crítica — declive &gt;15%/mes en los últimos {mesesTend} meses
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {[['all','Todos'], ['critica','Crítica >-15%/mes'], ['alta','Alta >-8%/mes'], ['media','Media']].map(([key, lbl]) => (
            <FilterBtn key={key} active={sevFilter === key} onClick={() => setSevFilter(key)}>{lbl}</FilterBtn>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs text-slate-400">
          <span>Ventana:</span>
          <select className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1 text-xs"
            value={mesesTend} onChange={(e) => setMesesTend(Number(e.target.value))}>
            {[3, 4, 5, 6, 9, 12].map((v) => <option key={v} value={v}>{v} meses</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Total en declive"   value={fmtInt(data?.total)}   color="text-slate-200"  bg="bg-surface-800 border-surface-700" />
        <SumCard label="Crítica >-15%/mes"  value={fmtInt(data?.critica)} color="text-red-400"    bg="bg-red-500/10 border-red-500/25" />
        <SumCard label="Alta >-8%/mes"      value={fmtInt(data?.alta)}    color="text-orange-400" bg="bg-orange-500/10 border-orange-500/25" />
        <SumCard label="Media"              value={fmtInt(data?.media)}   color="text-amber-400"  bg="bg-amber-500/10 border-amber-500/25" />
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Top {chartData.length} Mayores Declives</h2>
          <p className="text-xs text-slate-500 mb-4">pendiente absoluta %/mes — regresión lineal sobre {mesesTend} meses · período: {periodos.join(' → ')}</p>
          <div className={`h-56 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 60, left: 8, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={140} />
                <Tooltip formatter={(v) => `${v.toFixed(1)}%/mes`}
                  contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="slope" name="Declive %/mes" radius={[0, 3, 3, 0]}>
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={e.slope >= 15 ? '#f43f5e' : e.slope >= 8 ? '#f97316' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Detalle · {filtered.length} clientes</h2>
            <p className="text-xs text-slate-500 mt-0.5">período: {periodos.join(' → ') || '—'}</p>
          </div>
          {filtered.length > 0 && <ExportBtn onClick={handleExport} count={filtered.length} />}
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Severidad</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium">Tendencia</th>
                <th className="pb-2 font-medium text-right">Prom/mes</th>
                <th className="pb-2 font-medium text-right">Pendiente</th>
                <th className="pb-2 font-medium text-right">Total período</th>
                <th className="pb-2 font-medium text-right">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => <tr key={i}><td colSpan={9}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : pageRows.length === 0
                ? <tr><td colSpan={9} className="py-10 text-center text-slate-500">Sin clientes con tendencia decreciente</td></tr>
                : pageRows.map((r, i) => {
                    const sev  = SEV_CFG[r.severidad] || SEV_CFG.media
                    const Icon = sev.icon
                    return (
                      <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                        <td className="py-2 text-slate-500">{(page-1)*PAGE_SIZE+i+1}</td>
                        <td className="py-2">
                          <span className={`badge ${sev.bg} ${sev.text} border ${sev.border} text-xs`}>
                            <Icon size={10} />{sev.label}
                          </span>
                        </td>
                        <td className="py-2 font-medium text-slate-100 max-w-[160px] truncate">{r.nombre}</td>
                        <td className="py-2 text-slate-400 max-w-[120px] truncate">{r.nombre_vendedor}</td>
                        <td className="py-2"><Sparkline values={r.mensual} /></td>
                        <td className="py-2 text-right text-slate-300">{fmtCOP(r.avg_mensual)}</td>
                        <td className="py-2 text-right font-bold text-rose-400">{fmtPct(r.slope_pct, 1)}/mes</td>
                        <td className="py-2 text-right text-slate-400">{fmtCOP(r.total_periodo)}</td>
                        <td className="py-2 text-right text-slate-500 text-xs">{fmtDate(r.ultima_compra)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  )
}

// ── Inactivos ─────────────────────────────────────────────────────────────────

function InactivosTab({ filters, refreshKey, meses, setMeses, exclPvta, esStock }) {
  const [clasFilter, setClasFilter] = useState('all')
  const [page, setPage] = useState(1)
  const { data, loading } = useData(() => api.inactivos(filters, meses, exclPvta, esStock), [filters, refreshKey, meses, exclPvta, esStock])

  const rows     = data?.data || []
  const filtered = clasFilter === 'all' ? rows : rows.filter((r) => r.clasificacion === clasFilter)
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const handleExport = () => exportToExcel(filtered, [
    { key: 'nombre',          header: 'Cliente'        },
    { key: 'nombre_vendedor', header: 'Asesor'          },
    { key: 'clasificacion',   header: 'Estado'          },
    { key: 'dias_sin_compra', header: 'Días sin compra' },
    { key: 'ultima_compra',   header: 'Últ. Compra'    },
    { key: 'ventas_12m',      header: 'Ventas 12m'     },
    { key: 'ventas_historico',header: 'Ventas Históricas'},
    { key: 'num_facturas',    header: 'Facturas'        },
  ], `Inactivos_${filters.ano}`)

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {[['all','Todos'], ['perdido','Perdidos >6m'], ['riesgo_alto','Riesgo >3m'], ['riesgo','Riesgo']].map(([key, lbl]) => (
            <FilterBtn key={key} active={clasFilter === key} onClick={() => setClasFilter(key)}>{lbl}</FilterBtn>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs text-slate-400">
          <Clock size={12} />
          <span>Sin compra ≥</span>
          <select className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1 text-xs"
            value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 9, 12].map((v) => <option key={v} value={v}>{v} mes{v > 1 ? 'es' : ''}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SumCard label="Perdidos >6 meses"    value={fmtInt(data?.perdidos)}    color="text-red-400"    bg="bg-red-500/10 border-red-500/25" />
        <SumCard label="Riesgo alto >3 meses"  value={fmtInt(data?.riesgo_alto)} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/25" />
        <SumCard label={`Riesgo >${meses} meses`} value={fmtInt(data?.riesgo)}  color="text-amber-400"  bg="bg-amber-500/10 border-amber-500/25" />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Clientes Inactivos · {filtered.length} registros</h2>
            <p className="text-xs text-slate-500 mt-0.5">ordenados por mayor consumo histórico</p>
          </div>
          {filtered.length > 0 && <ExportBtn onClick={handleExport} count={filtered.length} />}
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium text-right">Días s/c</th>
                <th className="pb-2 font-medium text-right">Última compra</th>
                <th className="pb-2 font-medium text-right">Ventas 12m</th>
                <th className="pb-2 font-medium text-right">Ventas históricas</th>
                <th className="pb-2 font-medium text-right">Facturas</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_, i) => <tr key={i}><td colSpan={9}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : pageRows.length === 0
                ? <tr><td colSpan={9} className="py-10 text-center text-slate-500">Sin inactivos con los filtros seleccionados</td></tr>
                : pageRows.map((r, i) => {
                    const cfg = INACT_CFG[r.clasificacion] || INACT_CFG.riesgo
                    return (
                      <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                        <td className="py-2 text-slate-500">{(page-1)*PAGE_SIZE+i+1}</td>
                        <td className="py-2">
                          <span className={`badge ${cfg.bg} ${cfg.text} border ${cfg.border} text-xs`}>{cfg.label}</span>
                        </td>
                        <td className="py-2 font-medium text-slate-100 max-w-[180px] truncate">{r.nombre}</td>
                        <td className="py-2 text-slate-400 max-w-[130px] truncate">{r.nombre_vendedor || r.vendedor}</td>
                        <td className="py-2 text-right font-bold text-rose-400">{fmtInt(r.dias_sin_compra)}</td>
                        <td className="py-2 text-right text-slate-500 text-xs">{fmtDate(r.ultima_compra)}</td>
                        <td className="py-2 text-right text-slate-400">{fmtCOP(r.ventas_12m)}</td>
                        <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(r.ventas_historico)}</td>
                        <td className="py-2 text-right text-slate-500">{fmtInt(r.num_facturas)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  )
}

// ── RFM ───────────────────────────────────────────────────────────────────────

const RFM_ORDER = ['Campeón','Leal','Potencial','Nuevo','Regular','En Riesgo','No Perder','Perdido']

function RFMTab({ filters, refreshKey, exclPvta, esStock }) {
  const [segFilter, setSegFilter] = useState('all')
  const [page, setPage] = useState(1)
  const { data, loading } = useData(() => api.rfm(filters, exclPvta, esStock), [filters, refreshKey, exclPvta, esStock])

  const rows     = data?.data || []
  const segs     = data?.segmentos || {}
  const filtered = segFilter === 'all' ? rows : rows.filter((r) => r.segmento === segFilter)
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const handleExport = () => exportToExcel(filtered, [
    { key: 'nombre',          header: 'Cliente'     },
    { key: 'nombre_vendedor', header: 'Asesor'       },
    { key: 'segmento',        header: 'Segmento RFM' },
    { key: 'monto',           header: 'Monto COP'   },
    { key: 'recencia',        header: 'Recencia días'},
    { key: 'frecuencia',      header: 'Frecuencia'  },
    { key: 'r_score',         header: 'R Score'     },
    { key: 'f_score',         header: 'F Score'     },
    { key: 'm_score',         header: 'M Score'     },
    { key: 'rfm_score',       header: 'RFM Total'   },
    { key: 'ultima_compra',   header: 'Últ. Compra' },
  ], `RFM_${filters.ano}`)

  const segData = RFM_ORDER.filter((s) => segs[s]).map((s) => ({ name: s, value: segs[s], fill: RFM_COLORS[s] || '#6366f1' }))

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        {segData.map((s) => (
          <button key={s.name} onClick={() => setSegFilter(segFilter === s.name ? 'all' : s.name)}
            className={`rounded-xl p-3 border text-left transition-all ${
              segFilter === s.name ? 'border-brand-500 bg-brand-600/10' : 'border-surface-700 bg-surface-800 hover:border-surface-500'
            }`}>
            <div className="w-2 h-2 rounded-full mb-1.5" style={{ background: s.fill }} />
            <p className="text-xs text-slate-400 leading-tight">{s.name}</p>
            <p className="text-lg font-bold text-slate-100 mt-0.5">{s.value}</p>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">
              Detalle RFM · {filtered.length} clientes
              {segFilter !== 'all' && <span className="ml-2 text-xs text-brand-400">— {segFilter}</span>}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Recencia · Frecuencia · Monto — últimos 2 años</p>
          </div>
          <div className="flex items-center gap-2">
            {segFilter !== 'all' && (
              <button onClick={() => setSegFilter('all')} className="text-xs text-slate-400 hover:text-slate-100">Ver todos ×</button>
            )}
            {filtered.length > 0 && <ExportBtn onClick={handleExport} count={filtered.length} />}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Segmento</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium text-right">Monto</th>
                <th className="pb-2 font-medium text-right">R días</th>
                <th className="pb-2 font-medium text-right">F facturas</th>
                <th className="pb-2 font-medium text-right">R</th>
                <th className="pb-2 font-medium text-right">F</th>
                <th className="pb-2 font-medium text-right">M</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium">Última compra</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_, i) => <tr key={i}><td colSpan={12}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>)
                : pageRows.length === 0
                ? <tr><td colSpan={12} className="py-10 text-center text-slate-500">Sin datos</td></tr>
                : pageRows.map((r, i) => (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2 text-slate-500">{(page-1)*PAGE_SIZE+i+1}</td>
                      <td className="py-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: (RFM_COLORS[r.segmento] || '#6366f1') + '25', color: RFM_COLORS[r.segmento] || '#6366f1' }}>
                          {r.segmento}
                        </span>
                      </td>
                      <td className="py-2 font-medium text-slate-100 max-w-[160px] truncate">{r.nombre}</td>
                      <td className="py-2 text-slate-400 max-w-[110px] truncate">{r.nombre_vendedor || r.vendedor || '—'}</td>
                      <td className="py-2 text-right text-brand-300 font-semibold">{fmtCOP(r.monto)}</td>
                      <td className="py-2 text-right text-slate-400">{fmtInt(r.recencia)}</td>
                      <td className="py-2 text-right text-slate-400">{fmtInt(r.frecuencia)}</td>
                      <td className="py-2 text-right"><Score v={r.r_score} /></td>
                      <td className="py-2 text-right"><Score v={r.f_score} /></td>
                      <td className="py-2 text-right"><Score v={r.m_score} /></td>
                      <td className="py-2 text-right font-bold text-slate-200">{r.rfm_score}</td>
                      <td className="py-2 text-slate-500 text-xs">{fmtDate(r.ultima_compra)}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function FilterBtn({ children, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active ? 'bg-brand-600 text-white' : 'bg-surface-700 text-slate-400 hover:text-slate-100'
      }`}>
      {children}
    </button>
  )
}

function SumCard({ label, value, color, bg }) {
  return (
    <div className={`border rounded-xl p-4 ${bg}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
    </div>
  )
}

function Score({ v }) {
  const colors = ['', 'text-red-400', 'text-orange-400', 'text-amber-400', 'text-emerald-300', 'text-emerald-400']
  return <span className={`font-bold ${colors[v] || 'text-slate-400'}`}>{v}</span>
}

const ESTADO_COLORS = {
  ACTIVO: 'badge-green', NUEVO: 'badge-blue', PERDIDO: 'badge-red',
  RIESGO: 'badge-yellow', SEGUIMIENTO: 'badge bg-purple-500/15 text-purple-400',
  RECUPERADO: 'badge bg-blue-500/15 text-blue-400',
}
function EstadoBadge({ estado }) {
  const cls = ESTADO_COLORS[estado?.toUpperCase()] || 'badge-blue'
  return <span className={`badge ${cls} text-xs`}>{estado || '—'}</span>
}

// ── Predictivo (Churn) ────────────────────────────────────────────────────────

const fmtV = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(a/1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function PredictTab({ filters, refreshKey, exclPvta }) {
  const [page, setPage]             = useState(1)
  const [leadFilter, setLeadFilter] = useState('all')
  const { data, loading }           = useData(
    () => api.churn(filters.ano, exclPvta, 500),
    [filters, refreshKey, exclPvta]
  )

  const rows        = data?.data        || []
  const leadResumen = data?.lead_time_resumen || {}
  const metodo      = data?.metodo      || ''

  const filtered  = leadFilter === 'all' ? rows : rows.filter((r) => r.lead_time_alerta === leadFilter)
  const pageRows  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleExport = () => exportToExcel(filtered, [
    { key: 'nombre_cliente',       header: 'Cliente'          },
    { key: 'numero_cliente',       header: 'N° Cliente'       },
    { key: 'prob_churn',           header: 'Prob. Churn %'    },
    { key: 'riesgo',               header: 'Riesgo'           },
    { key: 'lead_time_alerta',     header: 'Lead Time'        },
    { key: 'ventas_cur',           header: 'Venta Actual'     },
    { key: 'variacion_yoy',        header: 'Var. YoY %'       },
    { key: 'diversidad_productos', header: 'Div. Productos'   },
    { key: 'pausa_maxima_meses',   header: 'Pausa Máx. Meses' },
  ], `Predictivo_Churn_${filters.ano}`)

  return (
    <>
      {/* Lead time summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {LEAD_ORDER_A.map((lt) => {
          const cfg = LEAD_CFG_A[lt]
          return (
            <button key={lt}
              onClick={() => { setLeadFilter(leadFilter === lt ? 'all' : lt); setPage(1) }}
              className={`border rounded-xl p-4 text-left transition-all ${cfg.bg} ${cfg.border} ${
                leadFilter === lt ? 'ring-2 ring-brand-500' : 'hover:scale-[1.02]'
              }`}>
              <p className={`text-xs font-bold ${cfg.text}`}>{lt}</p>
              <p className={`text-2xl font-bold mt-1 ${cfg.text}`}>{leadResumen[lt] || 0}</p>
              <p className="text-xs text-slate-500 mt-1">clientes</p>
            </button>
          )
        })}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">
              Predicción de abandono · {filtered.length} clientes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {metodo === 'logistic_regression' ? 'Regresión Logística' : 'Modelo heurístico'}
              {' · '}ordenados por probabilidad de churn
              {leadFilter !== 'all' && <span className="ml-1 text-brand-400">— {leadFilter}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {leadFilter !== 'all' && (
              <FilterBtn active={false} onClick={() => { setLeadFilter('all'); setPage(1) }}>Ver todos ×</FilterBtn>
            )}
            {filtered.length > 0 && <ExportBtn onClick={handleExport} count={filtered.length} />}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Lead Time</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium text-right">Venta Actual</th>
                <th className="pb-2 font-medium text-right">Var. YoY</th>
                <th className="pb-2 font-medium text-right">Prob. Churn</th>
                <th className="pb-2 font-medium text-center">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i}><td colSpan={7}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>
                  ))
                : pageRows.length === 0
                ? <tr><td colSpan={7} className="py-10 text-center text-slate-500">Sin datos de predicción</td></tr>
                : pageRows.map((r, i) => {
                    const lt    = r.lead_time_alerta
                    const ltCfg = LEAD_CFG_A[lt] || LEAD_CFG_A['Largo plazo']
                    return (
                      <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                        <td className="py-2 text-slate-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="py-2">
                          <span className={`badge ${ltCfg.bg} ${ltCfg.text} border ${ltCfg.border} text-xs`}>
                            {lt || '—'}
                          </span>
                        </td>
                        <td className="py-2 font-medium text-slate-100 max-w-[180px] truncate">
                          <div title={r.nombre_cliente}>{r.nombre_cliente}</div>
                          <div className="text-slate-500 font-mono">{r.numero_cliente}</div>
                        </td>
                        <td className="py-2 text-right text-slate-300">{fmtV(r.ventas_cur)}</td>
                        <td className={`py-2 text-right font-medium ${
                          r.variacion_yoy == null ? 'text-slate-500'
                            : r.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {r.variacion_yoy != null ? `${r.variacion_yoy > 0 ? '+' : ''}${r.variacion_yoy.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-16 bg-surface-700 rounded-full h-1.5 overflow-hidden">
                              <div className="h-1.5 rounded-full"
                                style={{ width: `${r.prob_churn ?? 0}%`, background: RIESGO_COL_A[r.riesgo] || '#6b7280' }} />
                            </div>
                            <span className="text-slate-200 w-8 text-right font-medium">{(r.prob_churn ?? 0).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-2 text-center">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: (RIESGO_COL_A[r.riesgo] || '#6b7280') + '25',
                              color:       RIESGO_COL_A[r.riesgo] || '#6b7280',
                            }}>
                            {r.riesgo}
                          </span>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={filtered.length} />
      </div>
    </>
  )
}
