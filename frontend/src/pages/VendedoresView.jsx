import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, fmtNum, pctColor, cumpColor, cumpBg, MONTH_NAMES } from '../utils/format'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6','#3b82f6','#ef4444']

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const full = payload[0]?.payload?.full || label
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-xs min-w-52">
      <p className="text-slate-200 font-semibold mb-2">{full}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">{p.name}</span>
          <span className="text-slate-100 font-medium">
            {p.dataKey?.includes('pct') ? fmtPct(p.value) : fmtCOP(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function CumpBar({ value }) {
  const w = Math.min(Math.max(value || 0, 0), 150)
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cumpBg(value)}`} style={{ width: `${Math.min(w, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold w-12 ${cumpColor(value)}`}>{fmtPct(value)}</span>
    </div>
  )
}

export function VendedoresView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const { data, loading } = useData(() => api.vendedores(filters), [filters, refreshKey])
  const rows = data?.data || []

  const shortName = (n) => n?.length > 22 ? n.slice(0, 20) + '…' : (n || '')

  const top10 = rows.slice(0, 10)
  const chartData = top10.map((d) => ({
    name: shortName(d.nombre || d.codigo_vendedor),
    full: d.nombre || d.codigo_vendedor,
    ventas_netas: d.ventas_netas,
    pp_valor: d.pp_valor,
  }))

  const cumpData = rows
    .filter((d) => d.cump_pp_valor_pct != null)
    .slice(0, 12)
    .map((d) => ({
      name: shortName(d.nombre || d.codigo_vendedor),
      full: d.nombre || d.codigo_vendedor,
      cump_pp_valor_pct: d.cump_pp_valor_pct,
    }))

  const chartH = Math.max(top10.length * 48 + 20, 280)
  const cumpH  = Math.max(cumpData.length * 36 + 20, 280)

  const period = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Rendimiento por Vendedor</h1>
        <p className="text-slate-500 text-xs mt-0.5">Ventas reales vs presupuesto · {period}</p>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Ventas vs PP */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Ventas vs Presupuesto · Top 10</h2>
          <p className="text-xs text-slate-500 mb-4">ventas netas vs PP valor mes</p>
          <div className={loading ? 'opacity-40 animate-pulse' : ''} style={{ height: chartH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={160} />
                <Tooltip content={<TTip />} />
                <Bar dataKey="ventas_netas" name="Ventas" fill="#6366f1" radius={[0, 3, 3, 0]} barSize={14} />
                <Bar dataKey="pp_valor" name="Presupuesto" fill="#f59e0b33" stroke="#f59e0b" strokeWidth={1} radius={[0, 3, 3, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cumplimiento */}
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Cumplimiento PP Valor (%)</h2>
          <p className="text-xs text-slate-500 mb-4">ventas / presupuesto · Top 12</p>
          <div className={loading ? 'opacity-40 animate-pulse' : ''} style={{ height: cumpH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cumpData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={160} />
                <Tooltip content={<TTip />} />
                <ReferenceLine x={100} stroke="#f59e0b" strokeDasharray="4 2" />
                <Bar dataKey="cump_pp_valor_pct" name="Cump PP %" radius={[0, 3, 3, 0]} barSize={18}>
                  {cumpData.map((entry, i) => {
                    const v = entry.cump_pp_valor_pct || 0
                    return <Cell key={i} fill={v >= 100 ? '#10b981' : v >= 80 ? '#6366f1' : v >= 60 ? '#f59e0b' : '#f43f5e'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Full table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Ranking Completo de Vendedores</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-3 font-medium">#</th>
                <th className="pb-3 font-medium">Vendedor</th>
                <th className="pb-3 font-medium text-right">Ventas Netas</th>
                <th className="pb-3 font-medium text-right">Año Ant.</th>
                <th className="pb-3 font-medium text-right">Var YoY</th>
                <th className="pb-3 font-medium text-right">Mes Ant.</th>
                <th className="pb-3 font-medium text-right">Var MoM</th>
                <th className="pb-3 font-medium text-right">PP Valor</th>
                <th className="pb-3 font-medium">Cump PP Valor</th>
                <th className="pb-3 font-medium text-right">PP Cant.</th>
                <th className="pb-3 font-medium text-right">Cump PP Cant.</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(8)].map((_, i) => (
                    <tr key={i}><td colSpan={11} className="py-3"><div className="animate-pulse h-5 bg-surface-700 rounded" /></td></tr>
                  ))
                : rows.map((d, i) => (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                      <td className="py-2.5 text-slate-500">{i + 1}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                          <span className="font-medium text-slate-100">{d.nombre}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                      <td className="py-2.5 text-right text-slate-500">{fmtCOP(d.ventas_netas_ant)}</td>
                      <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>{d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct) : '—'}</td>
                      <td className="py-2.5 text-right text-slate-500">{d.ventas_mes_ant != null ? fmtCOP(d.ventas_mes_ant) : '—'}</td>
                      <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_mom_pct)}`}>{d.variacion_mom_pct != null ? fmtPct(d.variacion_mom_pct) : '—'}</td>
                      <td className="py-2.5 text-right text-amber-400">{d.pp_valor > 0 ? fmtCOP(d.pp_valor) : '—'}</td>
                      <td className="py-2.5"><CumpBar value={d.cump_pp_valor_pct} /></td>
                      <td className="py-2.5 text-right text-amber-400/70">{d.pp_cantidad > 0 ? fmtNum(d.pp_cantidad) : '—'}</td>
                      <td className={`py-2.5 text-right text-xs font-semibold ${cumpColor(d.cump_pp_cantidad_pct)}`}>
                        {d.cump_pp_cantidad_pct != null ? fmtPct(d.cump_pp_cantidad_pct) : '—'}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
