import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, MONTH_NAMES } from '../utils/format'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts'
import {
  ShieldAlert, RefreshCcw, TrendingUp, Users, AlertTriangle,
  Zap, Target, ArrowRight, BarChart2, Info,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function RiskBadge({ nivel }) {
  const map = {
    alto:  'bg-red-500/15 text-red-400 border-red-500/30',
    medio: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    bajo:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${map[nivel] || map.medio}`}>
      Riesgo {nivel}
    </span>
  )
}

function KpiCard({ label, value, sub, color = 'text-slate-100', bg = 'bg-surface-800 border-surface-700', icon: Icon, extra }) {
  return (
    <div className={`border rounded-xl p-4 flex flex-col gap-1 ${bg}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
      {extra}
    </div>
  )
}

const BUCKET_CFG = {
  retener:   { label: 'Retener',   color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/25',     icon: ShieldAlert },
  recuperar: { label: 'Recuperar', color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   icon: RefreshCcw  },
  crecer:    { label: 'Crecer',    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', icon: TrendingUp  },
}

const URGENCIA_DOT = { alta: 'bg-red-400', media: 'bg-amber-400', baja: 'bg-emerald-400' }

// ── Vista ─────────────────────────────────────────────────────────────────────

export function OportunidadesView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const { data, loading } = useData(() => api.oportunidades(filters), [filters, refreshKey])

  const period = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`

  const conc     = data?.concentracion    || {}
  const ret      = data?.retencion        || {}
  const riesgo   = data?.riesgo           || {}
  const recup    = data?.recuperacion     || {}
  const cross    = data?.cross_sell       || {}
  const acciones = data?.acciones         || []
  const pareto   = data?.pareto_data      || []

  const retBuckets = { retener: [], recuperar: [], crecer: [] }
  acciones.forEach((a) => { if (retBuckets[a.bucket]) retBuckets[a.bucket].push(a) })

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Oportunidades Estratégicas</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          KPIs que deberías medir · Dinero en riesgo · Acciones de impacto inmediato · {period}
        </p>
      </div>

      {/* Bloque 1 — KPIs estratégicos */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">KPIs estratégicos</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard
            label="Retención de clientes"
            value={ret.pct != null ? `${ret.pct}%` : '—'}
            sub={`${fmtInt(ret.n_retenidos)} de ${fmtInt(ret.n_ant)} compraron de nuevo`}
            color={ret.pct >= 85 ? 'text-emerald-400' : ret.pct >= 70 ? 'text-amber-400' : 'text-red-400'}
            bg={ret.pct < 70 ? 'bg-red-500/10 border-red-500/25' : 'bg-surface-800 border-surface-700'}
            icon={Users}
          />
          <KpiCard
            label="Clientes perdidos"
            value={fmtInt(ret.clientes_perdidos)}
            sub="compraron año pasado, no este año"
            color={ret.clientes_perdidos > 20 ? 'text-red-400' : 'text-orange-400'}
            icon={AlertTriangle}
          />
          <KpiCard
            label="Clientes nuevos"
            value={fmtInt(ret.nuevos)}
            sub={fmtCOP(ret.vn_nuevos) + ' generados'}
            color="text-emerald-400"
            icon={TrendingUp}
          />
          <KpiCard
            label="$ en riesgo (caída >20%)"
            value={loading ? '…' : _shortCOP(riesgo.monto_en_riesgo)}
            sub={`${fmtInt(riesgo.n_clientes)} clientes en alerta`}
            color="text-red-400"
            bg="bg-red-500/10 border-red-500/25"
            icon={ShieldAlert}
          />
          <KpiCard
            label="$ recuperable (inactivos)"
            value={loading ? '…' : _shortCOP(recup.vn_recuperable)}
            sub={`${fmtInt(recup.n_inactivos)} clientes +3 meses sin compra`}
            color="text-amber-400"
            bg="bg-amber-500/10 border-amber-500/25"
            icon={RefreshCcw}
          />
          <KpiCard
            label="Cross-sell oportunidad"
            value={fmtInt(cross.n_mono_linea)}
            sub={`clientes en 1 sola línea (${cross.pct_mono?.toFixed(0)}% del total)`}
            color="text-cyan-400"
            icon={Zap}
          />
        </div>
      </section>

      {/* Bloque 2 — Concentración de ingresos */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Pareto chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-200">Curva de Pareto — Concentración de Clientes</h2>
            <RiskBadge nivel={conc.riesgo_concentracion} />
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Solo <strong className="text-slate-300">{conc.pareto_80_n} clientes</strong> generan el 80% de tu facturación
            · Top 5: <strong className="text-red-400">{conc.pct_top5}%</strong>
            · Top 10: <strong className="text-orange-400">{conc.pct_top10}%</strong>
          </p>
          {pareto.length > 0 && (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pareto} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="paretoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="pct_clientes" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `${v}%`} label={{ value: '% clientes', position: 'insideBottom', fill: '#6b7280', fontSize: 10, dy: 6 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v, k) => [`${v}%`, k === 'pct_ventas' ? '% facturación' : '% clientes']}
                    contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                  <Area dataKey="pct_ventas" name="% facturación" stroke="#6366f1" fill="url(#paretoGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top 5 tabla + retención */}
        <div className="flex flex-col gap-3">
          <div className="card flex-1">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Top 5 Clientes — Riesgo de Dependencia</h2>
            {conc.riesgo_concentracion === 'alto' && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">
                  El {conc.pct_top5}% de tus ingresos depende de 5 clientes. Perder cualquiera de ellos impacta materialmente el resultado.
                </p>
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-surface-700 text-slate-400">
                  <th className="pb-2">#</th><th className="pb-2">Cliente</th>
                  <th className="pb-2 text-right">Ventas</th><th className="pb-2 text-right">% total</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={4}><div className="animate-pulse h-4 my-1.5 bg-surface-700 rounded" /></td></tr>)
                  : (conc.top5 || []).map((c, i) => (
                    <tr key={i} className="border-b border-surface-700/30">
                      <td className="py-1.5 text-slate-500">{i + 1}</td>
                      <td className="py-1.5 text-slate-100 max-w-[160px] truncate font-medium">{c.nombre}</td>
                      <td className="py-1.5 text-right text-brand-300">{fmtCOP(c.ventas)}</td>
                      <td className={`py-1.5 text-right font-semibold ${c.pct > 15 ? 'text-red-400' : c.pct > 8 ? 'text-orange-400' : 'text-slate-300'}`}>{c.pct}%</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Retención visual */}
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-2">Retención de Cartera</h2>
            <div className="flex items-center gap-3">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f2937" strokeWidth="3.5" />
                  <circle cx="18" cy="18" r="15.9" fill="none"
                    stroke={ret.pct >= 85 ? '#10b981' : ret.pct >= 70 ? '#f59e0b' : '#f43f5e'}
                    strokeWidth="3.5"
                    strokeDasharray={`${ret.pct || 0} 100`}
                    strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-slate-100">{ret.pct?.toFixed(0)}%</span>
                </div>
              </div>
              <div className="text-xs text-slate-400 flex flex-col gap-1.5">
                <div><span className="text-slate-300 font-semibold">{fmtInt(ret.n_retenidos)}</span> clientes retenidos de {fmtInt(ret.n_ant)}</div>
                <div className="text-red-400"><span className="font-semibold">{fmtInt(ret.clientes_perdidos)}</span> se fueron vs año anterior</div>
                <div className="text-emerald-400"><span className="font-semibold">{fmtInt(ret.nuevos)}</span> clientes nuevos captados</div>
                <div className="text-slate-500">Benchmark sector: 80-90%</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bloque 3 — Acciones prioritarias */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Acciones de impacto inmediato — ordenadas por $ en juego
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['retener', 'recuperar', 'crecer']).map((bucket) => {
            const cfg = BUCKET_CFG[bucket]
            const Icon = cfg.icon
            const items = retBuckets[bucket] || []
            return (
              <div key={bucket} className={`border rounded-xl p-4 ${cfg.bg} ${cfg.border}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={15} className={cfg.color} />
                  <span className={`font-bold text-sm ${cfg.color}`}>{cfg.label}</span>
                </div>
                {items.length === 0
                  ? <p className="text-xs text-slate-500">Sin acciones detectadas para este período.</p>
                  : items.map((a, i) => (
                    <div key={i} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${URGENCIA_DOT[a.urgencia]}`} />
                        <p className="text-xs font-semibold text-slate-100 leading-snug">{a.titulo}</p>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mb-1.5">{a.descripcion}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${cfg.color}`}>{a.impacto_label} en juego</span>
                        <ArrowRight size={11} className="text-slate-600" />
                        <span className="text-xs text-slate-500">{a.n_clientes} clientes</span>
                      </div>
                    </div>
                  ))
                }
              </div>
            )
          })}
        </div>
      </section>

      {/* Bloque 4 — Cosas que probablemente no estás midiendo */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Métricas que recomendamos incorporar
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {RECOMENDACIONES.map((r, i) => (
            <div key={i} className="card border-surface-700/50">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-600/15 border border-brand-500/25 flex items-center justify-center flex-shrink-0">
                  <r.icon size={14} className="text-brand-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100 mb-0.5">{r.titulo}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{r.descripcion}</p>
                  {r.como && (
                    <p className="text-xs text-brand-400 mt-1.5 flex items-center gap-1">
                      <Info size={10} /> {r.como}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// ── Recomendaciones estáticas ─────────────────────────────────────────────────

const RECOMENDACIONES = [
  {
    icon: Target,
    titulo: "Ticket promedio por segmento RFM",
    descripcion: "Saber cuánto factura en promedio cada tipo de cliente (Campeón, Leal, Nuevo) permite calibrar el mínimo de pedido y las condiciones comerciales por segmento.",
    como: "Cruza RFM con factura promedio mensual para detectar el segmento más rentable.",
  },
  {
    icon: BarChart2,
    titulo: "Velocidad de crecimiento de cartera nueva",
    descripcion: "¿Cuántos clientes nuevos capta cada vendedor por mes? Un vendedor con alto cumplimiento pero sin clientes nuevos tiene un portfolio frágil a largo plazo.",
    como: "Agrega 'nuevos clientes / vendedor / mes' como KPI en la vista de vendedores.",
  },
  {
    icon: RefreshCcw,
    titulo: "Período óptimo de reactivación",
    descripcion: "Estadísticamente, un cliente inactivo tiene más probabilidad de reactivarse entre los 3 y 6 meses de inactividad. Pasado ese umbral, el costo de recuperación sube 3x.",
    como: "Segmenta inactivos en: 1-3 meses, 3-6 meses, +6 meses y asigna estrategia distinta a cada grupo.",
  },
  {
    icon: Zap,
    titulo: "Índice de venta cruzada",
    descripcion: "El promedio de líneas de negocio por cliente activo indica qué tan diversificado está el portfolio. Un índice <1.5 señala oportunidad de cross-sell masivo.",
    como: "Identifica clientes de alto valor que compran solo 1 línea y asígnalos a campañas de extensión.",
  },
  {
    icon: ShieldAlert,
    titulo: "HHI — Índice de Concentración de Ingresos",
    descripcion: "Si los 5 primeros clientes superan el 40% del total, cualquier evento en uno de ellos (quiebra, cambio de proveedor) puede generar una caída de doble dígito en resultados.",
    como: "Establece un tope máximo de dependencia por cliente (e.g., ningún cliente >15% del total).",
  },
  {
    icon: Users,
    titulo: "Tasa de conversión cliente activo → recurrente",
    descripcion: "¿Qué % de clientes que compraron el mes 1 vuelven a comprar en el mes 3? Optimizar esta tasa es más barato que adquirir clientes nuevos.",
    como: "Analiza cohortes mensuales: clientes que entraron en enero ¿cuántos siguieron en marzo?",
  },
]

function _shortCOP(v) {
  return fmtCOP(v, 2)
}
