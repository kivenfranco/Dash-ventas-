import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, formatPeriod } from '../utils/format'
import { exportToExcel } from '../utils/exportExcel'
import { KPICard } from '../components/kpis/KPICard'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  Users, UserCheck, UserPlus, UserMinus, AlertTriangle,
  Eye, RefreshCcw, Store, Download, ChevronLeft, ChevronRight,
} from 'lucide-react'

const PAGE_SIZE = 100

const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function fmtDate(d) {
  if (!d) return '—'
  const p = d.split('T')[0].split('-')
  if (p.length < 3) return d
  return `${parseInt(p[2])} ${MN[parseInt(p[1]) - 1]} ${String(p[0]).slice(2)}`
}

const ESTADO_CFG = {
  ACTIVO:      { color: '#10b981', bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: UserCheck,     label: 'Activos'      },
  NUEVO:       { color: '#06b6d4', bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    icon: UserPlus,      label: 'Nuevos'       },
  PERDIDO:     { color: '#f43f5e', bg: 'bg-rose-500/15',    text: 'text-rose-400',    icon: UserMinus,     label: 'Perdidos'     },
  RIESGO:      { color: '#f59e0b', bg: 'bg-amber-500/15',   text: 'text-amber-400',   icon: AlertTriangle, label: 'En Riesgo'    },
  SEGUIMIENTO: { color: '#a855f7', bg: 'bg-purple-500/15',  text: 'text-purple-400',  icon: Eye,           label: 'Seguimiento'  },
  RECUPERADO:  { color: '#3b82f6', bg: 'bg-blue-500/15',    text: 'text-blue-400',    icon: RefreshCcw,    label: 'Recuperados'  },
}

const ESTADOS_ORDER = ['ACTIVO', 'NUEVO', 'RECUPERADO', 'PERDIDO', 'RIESGO', 'SEGUIMIENTO']
const BKDOWN_ESTADOS = ['ACTIVO', 'NUEVO', 'RECUPERADO', 'SEGUIMIENTO', 'RIESGO', 'PERDIDO']
const BKDOWN_COLORS  = { ACTIVO: '#10b981', NUEVO: '#06b6d4', RECUPERADO: '#3b82f6', SEGUIMIENTO: '#a855f7', RIESGO: '#f59e0b', PERDIDO: '#f43f5e' }

const EXPORT_COLS = [
  { key: 'numero_cliente',   header: 'Código'         },
  { key: 'nombre',           header: 'Cliente'        },
  { key: 'estado',           header: 'Estado'         },
  { key: 'nombre_vendedor',  header: 'Asesor'         },
  { key: 'ventas_netas',     header: 'Ventas Período' },
  { key: 'ventas_netas_ant', header: 'Ventas Año Ant' },
  { key: 'variacion_yoy',    header: 'Var YoY %'      },
  { key: 'ultima_compra',    header: 'Últ. Compra'    },
  { key: 'meses_sin_compra', header: 'Meses s/c'      },
  { key: 'num_facturas',     header: 'Facturas'       },
]

export function ClientesView() {
  const { refreshKey }  = useOutletContext()
  const { filters }     = useFilters()
  const [exclPvta, setExclPvta] = useState(true)
  const [estadoSel, setEstadoSel] = useState(null)
  const [page, setPage] = useState(1)

  const f = { ...filters, excl_pvta: exclPvta }

  const { data: estados, loading: eL } = useData(
    () => api.clientesEstados(f),
    [filters, refreshKey, exclPvta]
  )
  const { data: byVend, loading: vL } = useData(
    () => api.segments(f, 'vendedor', 30),
    [filters, refreshKey, exclPvta]
  )
  const { data: clienteLista, loading: cL } = useData(
    () => api.clientesLista(f, estadoSel, 500),
    [filters, refreshKey, exclPvta, estadoSel],
    { onSuccess: () => setPage(1) }
  )
  const { data: breakdown } = useData(
    () => api.clientesBreakdown(f),
    [filters, refreshKey, exclPvta]
  )

  const k      = estados || {}
  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  const estadoData = (k.detalle || []).map((d) => ({
    name:  ESTADO_CFG[d.estado]?.label || d.estado,
    value: d.cnt,
    color: ESTADO_CFG[d.estado]?.color || '#6b7280',
  })).filter((d) => d.value > 0)

  const allRows   = clienteLista?.data || []
  const total     = allRows.length
  const pageRows  = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const vendRows = byVend?.data || []
  const bkVend   = (breakdown?.by_vendedor || []).slice(0, 12)
  const bkReg    = (breakdown?.by_region   || []).slice(0, 12)

  const toggleEstado = (est) => { setEstadoSel((prev) => (prev === est ? null : est)); setPage(1) }

  const handleExport = () => {
    if (!allRows.length) return
    const period_label = formatPeriod(filters.ano, filters.mes, filters.mes_fin)
    exportToExcel(allRows, EXPORT_COLS, `Clientes_${estadoSel || 'Todos'}_${period_label}`)
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Estado de Clientes</h1>
          <p className="text-slate-500 text-xs mt-0.5">Clasificación dinámica · {period}</p>
        </div>
        <button
          onClick={() => setExclPvta((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            exclPvta
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
        >
          <Store size={12} />
          {exclPvta ? 'Sin PVTA' : 'Con PVTA'}
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <KPICard label="Total"       value={k.total_clientes}       format="integer" icon={Users}         accent="brand"   compact loading={eL} />
        <KPICard label="Activos"     value={k.clientes_activos}     format="integer" icon={UserCheck}     accent="emerald" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_activos/k.total_clientes)*100,1)} del total` : ''} />
        <KPICard label="Nuevos"      value={k.clientes_nuevos}      format="integer" icon={UserPlus}      accent="cyan"    compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_nuevos/k.total_clientes)*100,1)} del total` : ''} />
        <KPICard label="Recuperados" value={k.clientes_recuperados} format="integer" icon={RefreshCcw}    accent="blue"    compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_recuperados/k.total_clientes)*100,1)} del total` : ''} />
        <KPICard label="Seguimiento" value={k.clientes_seguimiento} format="integer" icon={Eye}           accent="purple"  compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_seguimiento/k.total_clientes)*100,1)} del total` : ''} />
        <KPICard label="En Riesgo"   value={k.clientes_riesgo}      format="integer" icon={AlertTriangle} accent="amber"   compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_riesgo/k.total_clientes)*100,1)} del total` : ''} />
        <KPICard label="Perdidos"    value={k.clientes_perdidos}    format="integer" icon={UserMinus}     accent="rose"    compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_perdidos/k.total_clientes)*100,1)} del total` : ''} />
      </div>

      {/* Estado filter buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => toggleEstado(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            estadoSel === null
              ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
        >
          Todos
        </button>
        {ESTADOS_ORDER.map((est) => {
          const cfg      = ESTADO_CFG[est]
          const IconComp = cfg.icon
          const cnt = k[`clientes_${est.toLowerCase()}`]
            ?? k[`clientes_${est.toLowerCase()}s`]
            ?? (k.detalle || []).find(d => d.estado === est)?.cnt ?? 0
          return (
            <button key={est} onClick={() => toggleEstado(est)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                estadoSel === est
                  ? `${cfg.bg} ${cfg.text} border-current`
                  : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
              }`}
            >
              <IconComp size={11} />
              {cfg.label}
              {cnt > 0 && <span className="opacity-70">({fmtInt(cnt)})</span>}
            </button>
          )
        })}
      </div>

      {/* Distribution charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Distribución por Estado</h2>
          <p className="text-xs text-slate-500 mb-4">composición del portafolio al {period}</p>
          <div className={`h-60 ${eL ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={estadoData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={3}
                  onClick={(data) => {
                    // Find the original status key from the label/config
                    const key = Object.keys(ESTADO_CFG).find(k => ESTADO_CFG[k].label === data.name)
                    if (key) toggleEstado(key)
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  {estadoData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [fmtInt(v), n]} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                <Legend formatter={(v, entry) => <span style={{ color: entry.color, fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Detalle por Estado</h2>
          <p className="text-xs text-slate-500 mb-4">conteo y % del total (haz clic para filtrar)</p>
          <div className="space-y-3">
            {(k.detalle || []).map((d) => {
              const cfg      = ESTADO_CFG[d.estado] || { color: '#6b7280', bg: 'bg-slate-500/15', text: 'text-slate-400', icon: Users, label: d.estado }
              const pct      = k.total_clientes ? (d.cnt / k.total_clientes) * 100 : 0
              const IconComp = cfg.icon
              const isSel    = estadoSel === d.estado
              return (
                <div
                  key={d.estado}
                  onClick={() => toggleEstado(d.estado)}
                  className={`flex items-center gap-3 cursor-pointer p-1 rounded-lg transition-colors ${
                    isSel ? 'bg-surface-700 ring-1 ring-surface-600' : 'hover:bg-surface-700/50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                    <IconComp size={14} className={cfg.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-medium">{cfg.label || d.estado}</span>
                      <span className={`font-bold ${cfg.text}`}>{fmtInt(d.cnt)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: cfg.color }} />
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 w-10 text-right">{fmtPct(pct, 1)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Breakdown charts — by vendedor and region */}
      {(bkVend.length > 0 || bkReg.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {bkVend.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Estados por Asesor</h2>
              <p className="text-xs text-slate-500 mb-3">distribución ACTIVO · NUEVO · PERDIDO · RIESGO por asesor (top {bkVend.length})</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bkVend.map(d => ({ ...d, nombre: d.nombre?.length > 16 ? d.nombre.slice(0,15)+'…' : d.nombre }))}
                    layout="vertical" margin={{ top: 2, right: 16, left: 8, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="nombre" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={120} />
                    <Tooltip contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }}
                      formatter={(v, name) => [fmtInt(v), name]} />
                    {BKDOWN_ESTADOS.map((est) => (
                      <Bar key={est} dataKey={est} stackId="a" fill={BKDOWN_COLORS[est]} name={ESTADO_CFG[est]?.label || est}
                        radius={est === 'PERDIDO' ? [0,3,3,0] : [0,0,0,0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {bkReg.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Estados por Zona/Región</h2>
              <p className="text-xs text-slate-500 mb-3">distribución ACTIVO · NUEVO · PERDIDO · RIESGO por región (top {bkReg.length})</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bkReg.map(d => ({ ...d, nombre: d.nombre?.length > 18 ? d.nombre.slice(0,17)+'…' : d.nombre }))}
                    layout="vertical" margin={{ top: 2, right: 16, left: 8, bottom: 2 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="nombre" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
                    <Tooltip contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }}
                      formatter={(v, name) => [fmtInt(v), name]} />
                    {BKDOWN_ESTADOS.map((est) => (
                      <Bar key={est} dataKey={est} stackId="a" fill={BKDOWN_COLORS[est]} name={ESTADO_CFG[est]?.label || est}
                        radius={est === 'PERDIDO' ? [0,3,3,0] : [0,0,0,0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Client list table */}
      <div className="card">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-slate-200">
            {estadoSel ? `Clientes ${ESTADO_CFG[estadoSel]?.label || estadoSel}` : 'Clientes del Período'}
          </h2>
          <div className="flex items-center gap-2">
            {total > 0 && (
              <button onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">
                <Download size={12} />
                Excel ({fmtInt(total)})
              </button>
            )}
            {total > 0 && (
              <span className="text-xs text-slate-500">{fmtInt(total)} registros</span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {estadoSel
            ? `Clasificados como ${estadoSel} al ${period}`
            : `Top 500 por ventas — todos los estados`}
        </p>
        <div className={`overflow-x-auto ${cL ? 'opacity-40 animate-pulse' : ''}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium text-right">Ventas Período</th>
                <th className="pb-2 font-medium text-right">Año Ant.</th>
                <th className="pb-2 font-medium text-right">Var YoY</th>
                <th className="pb-2 font-medium text-right">Últ. Compra</th>
                <th className="pb-2 font-medium text-right">Meses s/c</th>
                <th className="pb-2 font-medium text-right">Facturas</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d, i) => {
                const estCfg = ESTADO_CFG[d.estado?.toUpperCase()] || {}
                const meses  = d.meses_sin_compra ?? 0
                const rowNum = (page - 1) * PAGE_SIZE + i + 1
                return (
                  <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                    <td className="py-2 text-slate-500">{rowNum}</td>
                    <td className="py-2 max-w-[180px]">
                      <div className="font-medium text-slate-100 truncate">{d.nombre || d.numero_cliente}</div>
                      <div className="text-slate-500 text-[10px]">{d.numero_cliente}</div>
                    </td>
                    <td className="py-2">
                      {d.estado ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${estCfg.bg || 'bg-slate-500/15'} ${estCfg.text || 'text-slate-400'}`}>
                          {d.estado}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 text-slate-300 max-w-[140px] truncate">{d.nombre_vendedor || d.vendedor || '—'}</td>
                    <td className="py-2 text-right font-semibold text-brand-300">
                      {d.ventas_netas > 0 ? fmtCOP(d.ventas_netas) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {d.ventas_netas_ant > 0 ? fmtCOP(d.ventas_netas_ant) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className={`py-2 text-right font-semibold ${d.variacion_yoy == null ? 'text-slate-500' : d.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {d.variacion_yoy != null ? fmtPct(d.variacion_yoy, 1) : '—'}
                    </td>
                    <td className="py-2 text-right text-slate-300">{fmtDate(d.ultima_compra)}</td>
                    <td className={`py-2 text-right font-medium ${meses >= 12 ? 'text-rose-400' : meses >= 8 ? 'text-amber-400' : meses >= 4 ? 'text-purple-400' : 'text-slate-400'}`}>
                      {meses}
                    </td>
                    <td className="py-2 text-right text-slate-400">{fmtInt(d.num_facturas)}</td>
                  </tr>
                )
              })}
              {pageRows.length === 0 && !cL && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">Sin datos para el período seleccionado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} setPage={setPage} total={total} pageSize={PAGE_SIZE} />
      </div>

      {/* Asesores */}
      {vendRows.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Asesores en este Segmento</h2>
          <p className="text-xs text-slate-500 mb-4">clientes y ventas por asesor en el filtro activo</p>
          <div className={`overflow-x-auto ${vL ? 'opacity-40 animate-pulse' : ''}`}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-surface-700 text-slate-400">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Asesor</th>
                  <th className="pb-2 font-medium text-right">Clientes</th>
                  <th className="pb-2 font-medium text-right">Facturas</th>
                  <th className="pb-2 font-medium text-right">Ventas Netas</th>
                  <th className="pb-2 font-medium text-right">Part %</th>
                  <th className="pb-2 font-medium text-right">Var YoY</th>
                </tr>
              </thead>
              <tbody>
                {vendRows.map((d, i) => (
                  <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                    <td className="py-2 text-slate-500">{i + 1}</td>
                    <td className="py-2 font-medium text-slate-100 max-w-[200px] truncate">{d.dimension || '—'}</td>
                    <td className="py-2 text-right text-slate-300">{fmtInt(d.num_clientes)}</td>
                    <td className="py-2 text-right text-slate-400">{fmtInt(d.num_transacciones)}</td>
                    <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                    <td className="py-2 text-right text-slate-400">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-8 h-1 bg-surface-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(d.participacion_pct, 100)}%` }} />
                        </div>
                        {fmtPct(d.participacion_pct, 1)}
                      </div>
                    </td>
                    <td className={`py-2 text-right font-semibold ${d.variacion_yoy_pct == null ? 'text-slate-500' : d.variacion_yoy_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct, 1) : '—'}
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

function Pagination({ page, setPage, total, pageSize }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700/50">
      <span className="text-xs text-slate-500">
        Mostrando {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} de {fmtInt(total)}
      </span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-surface-700 border border-surface-600 text-slate-400 disabled:opacity-30 hover:text-slate-100 transition-colors">
          <ChevronLeft size={12} /> Ant
        </button>
        <span className="px-2 text-xs text-slate-500 tabular-nums">Hoja {page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-surface-700 border border-surface-600 text-slate-400 disabled:opacity-30 hover:text-slate-100 transition-colors">
          Sig <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
