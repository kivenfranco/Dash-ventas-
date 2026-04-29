import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, formatPeriod } from '../utils/format'
import { KPICard } from '../components/kpis/KPICard'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Users, UserCheck, UserPlus, UserMinus, AlertTriangle, Eye, RefreshCcw, Store } from 'lucide-react'

const ESTADO_CFG = {
  ACTIVO:      { color: '#10b981', bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: UserCheck,     label: 'Activos'      },
  NUEVO:       { color: '#06b6d4', bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    icon: UserPlus,      label: 'Nuevos'       },
  PERDIDO:     { color: '#f43f5e', bg: 'bg-rose-500/15',    text: 'text-rose-400',    icon: UserMinus,     label: 'Perdidos'     },
  RIESGO:      { color: '#f59e0b', bg: 'bg-amber-500/15',   text: 'text-amber-400',   icon: AlertTriangle, label: 'En Riesgo'    },
  SEGUIMIENTO: { color: '#a855f7', bg: 'bg-purple-500/15',  text: 'text-purple-400',  icon: Eye,           label: 'Seguimiento'  },
  RECUPERADO:  { color: '#3b82f6', bg: 'bg-blue-500/15',    text: 'text-blue-400',    icon: RefreshCcw,    label: 'Recuperados'  },
}

const ESTADOS_ORDER = ['ACTIVO', 'NUEVO', 'PERDIDO', 'RIESGO', 'SEGUIMIENTO']

export function ClientesView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [exclPvta, setExclPvta] = useState(true)
  const [estadoSel, setEstadoSel] = useState(null)

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
    () => api.clientesLista(f, estadoSel, 150),
    [filters, refreshKey, exclPvta, estadoSel]
  )

  const k = estados || {}
  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  const estadoData = (k.detalle || []).map((d) => ({
    name: ESTADO_CFG[d.estado]?.label || d.estado,
    value: d.cnt,
    color: ESTADO_CFG[d.estado]?.color || '#6b7280',
  })).filter((d) => d.value > 0)

  const vendRows  = byVend?.data || []
  const listaRows = clienteLista?.data || []

  const toggleEstado = (est) => setEstadoSel((prev) => (prev === est ? null : est))

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Estado de Clientes</h1>
          <p className="text-slate-500 text-xs mt-0.5">Segmentación y análisis del portafolio · {period}</p>
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
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <KPICard label="Total Clientes" value={k.total_clientes} format="integer" icon={Users} accent="brand" compact loading={eL} />
        <KPICard label="Activos" value={k.clientes_activos} format="integer" icon={UserCheck} accent="emerald" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_activos/k.total_clientes)*100)} activos` : ''} />
        <KPICard label="Nuevos" value={k.clientes_nuevos} format="integer" icon={UserPlus} accent="cyan" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_nuevos/k.total_clientes)*100)} del total` : ''} />
        <KPICard label="Perdidos" value={k.clientes_perdidos} format="integer" icon={UserMinus} accent="rose" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_perdidos/k.total_clientes)*100)} del total` : ''} />
        <KPICard label="En Riesgo" value={k.clientes_riesgo} format="integer" icon={AlertTriangle} accent="amber" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_riesgo/k.total_clientes)*100)} del total` : ''} />
        <KPICard label="Seguimiento" value={k.clientes_seguimiento} format="integer" icon={Eye} accent="purple" compact loading={eL}
          sub={k.total_clientes ? `${fmtPct((k.clientes_seguimiento/k.total_clientes)*100)} del total` : ''} />
      </div>

      {/* Estado filter buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEstadoSel(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            estadoSel === null
              ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
        >
          Todos
        </button>
        {ESTADOS_ORDER.map((est) => {
          const cfg = ESTADO_CFG[est]
          const IconComp = cfg.icon
          const cnt = k[`clientes_${est.toLowerCase()}`] ?? (k.detalle || []).find(d => d.estado === est)?.cnt ?? 0
          return (
            <button
              key={est}
              onClick={() => toggleEstado(est)}
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
        {/* Donut estado */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Distribución por Estado</h2>
          <p className="text-xs text-slate-500 mb-4">composición del portafolio de clientes</p>
          <div className={`h-60 ${eL ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={estadoData} cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                  dataKey="value" nameKey="name" paddingAngle={3}>
                  {estadoData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [fmtInt(v), n]} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                <Legend formatter={(v, entry) => <span style={{ color: entry.color, fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Estado bars */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Detalle por Estado</h2>
          <p className="text-xs text-slate-500 mb-4">conteo y % del total de clientes</p>
          <div className="space-y-3">
            {(k.detalle || []).map((d) => {
              const cfg = ESTADO_CFG[d.estado] || { color: '#6b7280', bg: 'bg-slate-500/15', text: 'text-slate-400', icon: Users }
              const pct = k.total_clientes ? (d.cnt / k.total_clientes) * 100 : 0
              const IconComp = cfg.icon
              return (
                <div key={d.estado} className="flex items-center gap-3">
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
                  <span className="text-xs text-slate-500 w-10 text-right">{fmtPct(pct)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Client list table */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-200">
            {estadoSel ? `Clientes ${ESTADO_CFG[estadoSel]?.label || estadoSel}` : 'Clientes del Período'}
          </h2>
          {clienteLista?.total != null && (
            <span className="text-xs text-slate-500">{fmtInt(clienteLista.total)} registros</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {estadoSel ? `Detalle de clientes con estado ${estadoSel}` : 'Top 150 clientes por ventas netas en el período'}
        </p>
        <div className={`overflow-x-auto ${cL ? 'opacity-40 animate-pulse' : ''}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2 font-medium">Asesor</th>
                <th className="pb-2 font-medium text-right">Ventas Netas</th>
                <th className="pb-2 font-medium text-right">Año Ant.</th>
                <th className="pb-2 font-medium text-right">Var YoY</th>
                <th className="pb-2 font-medium text-right">Facturas</th>
              </tr>
            </thead>
            <tbody>
              {listaRows.map((d, i) => {
                const estCfg = ESTADO_CFG[d.estado?.toUpperCase()] || {}
                return (
                  <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                    <td className="py-2 text-slate-500">{i + 1}</td>
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
                    <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                    <td className="py-2 text-right text-slate-400">{d.ventas_netas_ant ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                    <td className={`py-2 text-right font-semibold ${d.variacion_yoy == null ? 'text-slate-500' : d.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {d.variacion_yoy != null ? fmtPct(d.variacion_yoy, 1) : '—'}
                    </td>
                    <td className="py-2 text-right text-slate-400">{fmtInt(d.num_facturas)}</td>
                  </tr>
                )
              })}
              {listaRows.length === 0 && !cL && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">Sin datos para el período seleccionado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Asesores */}
      {vendRows.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Asesores en este Segmento</h2>
          <p className="text-xs text-slate-500 mb-4">vendedores con su cantidad de clientes y ventas en el filtro activo</p>
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
