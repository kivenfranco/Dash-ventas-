import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, pctColor, MONTH_NAMES } from '../utils/format'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Star, AlertTriangle, CheckCircle,
  Package, Users, Trophy, Lightbulb, Info,
} from 'lucide-react'

const ICON_MAP = {
  trending_up:    TrendingUp,
  trending_down:  TrendingDown,
  star:           Star,
  warning:        AlertTriangle,
  check_circle:   CheckCircle,
  inventory:      Package,
  person_remove:  Users,
  person_alert:   AlertTriangle,
  emoji_events:   Trophy,
}

const CAT_CFG = {
  positivo:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'Positivo'  },
  alerta:     { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  text: 'text-orange-400',  label: 'Alerta'    },
  critica:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-400',     label: 'Crítico'   },
  tendencia:  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    text: 'text-cyan-400',    label: 'Tendencia' },
  oportunidad:{ bg: 'bg-purple-500/10',  border: 'border-purple-500/30',  text: 'text-purple-400',  label: 'Oportunidad'},
}

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899']

export function HallazgosView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const { data, loading, error } = useData(() => api.hallazgos(filters), [filters, refreshKey])

  const insights   = data?.insights   || []
  const regiones   = data?.regiones   || []
  const vendedores = data?.vendedores || []
  const stock      = data?.stock_vs_nostock || []
  const period     = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`

  const nPos   = insights.filter((i) => i.categoria === 'positivo').length
  const nAlert = insights.filter((i) => ['alerta','critica'].includes(i.categoria)).length

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <p className="text-red-400 font-semibold mb-1">Error cargando hallazgos</p>
        <p className="text-slate-500 text-xs max-w-md">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Hallazgos e Insights</h1>
          <p className="text-slate-500 text-xs mt-0.5">Conclusiones automáticas basadas en datos · {period}</p>
        </div>
        <div className="flex gap-3">
          <StatBadge label="Positivos" value={nPos}   color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/25" />
          <StatBadge label="Alertas"   value={nAlert} color="text-orange-400"  bg="bg-orange-500/10 border-orange-500/25"  />
        </div>
      </div>

      {/* Insights grid */}
      {loading
        ? <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <div key={i} className="card animate-pulse h-28" />)}
          </div>
        : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {insights.map((ins, i) => {
              const cfg = CAT_CFG[ins.categoria] || CAT_CFG.tendencia
              const IconComp = ICON_MAP[ins.icono] || Info
              return (
                <div key={i} className={`border rounded-xl p-4 ${cfg.bg} ${cfg.border}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg ${cfg.bg} border ${cfg.border} flex items-center justify-center flex-shrink-0`}>
                      <IconComp size={14} className={cfg.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text} border ${cfg.border}`}>{cfg.label}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-100 mb-1 leading-snug">{ins.titulo}</p>
                      <p className="text-xs text-slate-400 leading-relaxed">{ins.descripcion}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Regiones YoY */}
        {regiones.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Variación YoY por Región</h2>
            <p className="text-xs text-slate-500 mb-4">crecimiento vs año anterior por zona geográfica</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={regiones.slice(0, 10).map((r) => ({
                    name: r.region?.length > 14 ? r.region.slice(0, 14) + '…' : r.region,
                    yoy: r.variacion_yoy_pct,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip formatter={(v) => [`${v?.toFixed(1)}%`, 'YoY']} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                  <ReferenceLine x={0} stroke="#374151" />
                  <Bar dataKey="yoy" name="YoY%" radius={[0, 3, 3, 0]}>
                    {regiones.slice(0, 10).map((r, i) => (
                      <Cell key={i} fill={(r.variacion_yoy_pct || 0) >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Vendedores cumplimiento */}
        {vendedores.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Cumplimiento PP por Vendedor</h2>
            <p className="text-xs text-slate-500 mb-4">% de presupuesto alcanzado</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={vendedores.slice(0, 10).map((v) => ({
                    name: v.nombre?.length > 12 ? v.nombre.slice(0, 12) + '…' : v.nombre,
                    cump: v.cump_pct,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip formatter={(v) => [`${v?.toFixed(1)}%`, 'Cumplimiento']} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                  <ReferenceLine x={100} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '100%', fill: '#f59e0b', fontSize: 10, position: 'top' }} />
                  <Bar dataKey="cump" name="Cumpl%" radius={[0, 3, 3, 0]}>
                    {vendedores.slice(0, 10).map((v, i) => (
                      <Cell key={i} fill={(v.cump_pct || 0) >= 100 ? '#10b981' : (v.cump_pct || 0) >= 70 ? '#f59e0b' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Regiones tabla */}
      {regiones.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Ranking de Regiones</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-surface-700 text-slate-400">
                  <th className="pb-3 font-medium">#</th>
                  <th className="pb-3 font-medium">Región</th>
                  <th className="pb-3 font-medium text-right">Ventas Actuales</th>
                  <th className="pb-3 font-medium text-right">Año Anterior</th>
                  <th className="pb-3 font-medium text-right">Var YoY</th>
                </tr>
              </thead>
              <tbody>
                {regiones.map((r, i) => (
                  <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                    <td className="py-2.5 text-slate-500">{i + 1}</td>
                    <td className="py-2.5 font-medium text-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        {r.region}
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-semibold text-brand-300">{fmtCOP(r.ventas_netas)}</td>
                    <td className="py-2.5 text-right text-slate-500">{fmtCOP(r.ventas_netas_ant)}</td>
                    <td className={`py-2.5 text-right font-semibold ${pctColor(r.variacion_yoy_pct)}`}>{r.variacion_yoy_pct != null ? fmtPct(r.variacion_yoy_pct) : '—'}</td>
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

function StatBadge({ label, value, color, bg }) {
  return (
    <div className={`border rounded-xl px-4 py-2 ${bg} flex items-center gap-2`}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  )
}
