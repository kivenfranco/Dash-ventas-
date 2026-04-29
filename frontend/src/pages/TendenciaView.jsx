import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, pctColor, MONTH_NAMES } from '../utils/format'
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-xs min-w-56">
      <p className="text-slate-200 font-semibold mb-2">{MONTH_NAMES[label] || label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-400">{p.name}</span>
          </div>
          <span className="text-slate-100 font-medium">
            {p.dataKey === 'variacion_yoy_pct' ? fmtPct(p.value) : fmtCOP(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TendenciaView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const { data: trends, loading } = useData(() => api.trends({ ...filters, mes: null }), [filters, refreshKey])

  const series = (trends?.series || []).map((d) => ({
    ...d,
    cump_pct: d.pp_mes > 0 ? +((d.ventas_netas / d.pp_mes) * 100).toFixed(1) : null,
  }))

  const totalVN  = series.reduce((s, d) => s + (d.ventas_netas || 0), 0)
  const totalPP  = series.reduce((s, d) => s + (d.pp_mes || 0), 0)
  const totalAnt = series.reduce((s, d) => s + (d.ventas_netas_ant || 0), 0)
  const cumpTotal = totalPP > 0 ? (totalVN / totalPP * 100) : null
  const yoyTotal  = totalAnt > 0 ? ((totalVN / totalAnt - 1) * 100) : null

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Tendencia {filters.ano}</h1>
        <p className="text-slate-500 text-xs mt-0.5">Evolución mensual de ventas, presupuesto y variación interanual</p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {[
          { l: 'Ventas Acumuladas', v: fmtCOP(totalVN), c: 'text-brand-400' },
          { l: 'Presupuesto', v: fmtCOP(totalPP), c: 'text-amber-400' },
          { l: 'Año Anterior', v: fmtCOP(totalAnt), c: 'text-slate-400' },
          { l: 'Cump PP', v: fmtPct(cumpTotal), c: cumpTotal >= 100 ? 'text-emerald-400' : cumpTotal >= 80 ? 'text-amber-400' : 'text-red-400' },
          { l: 'Var YoY', v: fmtPct(yoyTotal), c: pctColor(yoyTotal) },
        ].map(({ l, v, c }) => (
          <div key={l} className="card-sm flex items-center gap-3">
            <span className="text-xs text-slate-500">{l}</span>
            <span className={`text-sm font-bold ${c}`}>{v}</span>
          </div>
        ))}
      </div>

      {/* Main trend chart */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Ventas vs Presupuesto vs Año Anterior</h2>
        <p className="text-xs text-slate-500 mb-4">valores mensuales en COP</p>
        <div className={`h-80 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
              <defs>
                <linearGradient id="gVN" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="mes_num" tickFormatter={(v) => MONTH_NAMES[v] || v} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} width={62} />
              <Tooltip content={<TTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
              <Area type="monotone" dataKey="ventas_netas" name="Ventas Netas" stroke="#6366f1" fill="url(#gVN)" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="pp_mes" name="Presupuesto" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="6 3" />
              <Line type="monotone" dataKey="ventas_netas_ant" name="Año Anterior" stroke="#475569" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* YoY variation chart */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Variación Año vs Año (%)</h2>
        <p className="text-xs text-slate-500 mb-4">% de crecimiento mensual vs mismo mes año anterior</p>
        <div className={`h-52 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="mes_num" tickFormatter={(v) => MONTH_NAMES[v] || v} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={45} />
              <Tooltip content={<TTip />} />
              <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 2" />
              <Bar dataKey="variacion_yoy_pct" name="Var YoY %" radius={[3, 3, 0, 0]}>
                {series.map((entry, i) => (
                  <Cell key={i} fill={(entry.variacion_yoy_pct || 0) >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumplimiento por mes */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Cumplimiento vs Presupuesto por Mes (%)</h2>
        <p className="text-xs text-slate-500 mb-4">ventas / presupuesto mensual</p>
        <div className={`h-52 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="mes_num" tickFormatter={(v) => MONTH_NAMES[v] || v} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={45} />
              <Tooltip content={<TTip />} />
              <ReferenceLine y={100} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: 'Meta 100%', fill: '#f59e0b', fontSize: 10 }} />
              <Bar dataKey="cump_pct" name="Cump PP %" radius={[3, 3, 0, 0]}>
                {series.map((entry, i) => {
                  const v = entry.cump_pct || 0
                  const fill = v >= 100 ? '#10b981' : v >= 85 ? '#6366f1' : v >= 70 ? '#f59e0b' : '#f43f5e'
                  return <Cell key={i} fill={fill} />
                })}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Detalle Mensual</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-3 font-medium">Mes</th>
                <th className="pb-3 font-medium text-right">Ventas Netas</th>
                <th className="pb-3 font-medium text-right">Presupuesto</th>
                <th className="pb-3 font-medium text-right">Cump PP</th>
                <th className="pb-3 font-medium text-right">Año Anterior</th>
                <th className="pb-3 font-medium text-right">Var YoY</th>
              </tr>
            </thead>
            <tbody>
              {series.map((d, i) => (
                <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                  <td className="py-2.5 font-medium text-slate-200">{d.mes_nombre || MONTH_NAMES[d.mes_num]}</td>
                  <td className="py-2.5 text-right text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                  <td className="py-2.5 text-right text-amber-400">{fmtCOP(d.pp_mes)}</td>
                  <td className={`py-2.5 text-right font-semibold ${cumpColorV(d.cump_pct)}`}>{fmtPct(d.cump_pct)}</td>
                  <td className="py-2.5 text-right text-slate-500">{fmtCOP(d.ventas_netas_ant)}</td>
                  <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>{fmtPct(d.variacion_yoy_pct)}</td>
                </tr>
              ))}
              {series.length > 0 && (
                <tr className="border-t-2 border-surface-600 font-bold text-slate-200">
                  <td className="py-2.5">TOTAL</td>
                  <td className="py-2.5 text-right text-brand-300">{fmtCOP(totalVN)}</td>
                  <td className="py-2.5 text-right text-amber-400">{fmtCOP(totalPP)}</td>
                  <td className={`py-2.5 text-right ${cumpColorV(cumpTotal)}`}>{fmtPct(cumpTotal)}</td>
                  <td className="py-2.5 text-right text-slate-500">{fmtCOP(totalAnt)}</td>
                  <td className={`py-2.5 text-right ${pctColor(yoyTotal)}`}>{fmtPct(yoyTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function cumpColorV(v) {
  if (v == null) return 'text-slate-500'
  if (v >= 100) return 'text-emerald-400'
  if (v >= 85)  return 'text-brand-400'
  if (v >= 70)  return 'text-amber-400'
  return 'text-red-400'
}
