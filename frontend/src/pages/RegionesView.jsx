import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, pctColor, cumpColor, cumpBg, MONTH_NAMES } from '../utils/format'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'

const SEG_OPTS = [
  { key: 'region',           label: 'Región' },
  { key: 'grupo_comercial',  label: 'Grupo Comercial' },
  { key: 'linea_negocio',    label: 'Línea de Negocio' },
  { key: 'tipo_fabricacion', label: 'Tipo Fabricación' },
  { key: 'tipo_cliente',     label: 'Tipo Cliente' },
]

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6']

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-xs min-w-52">
      <p className="text-slate-200 font-semibold mb-2 truncate max-w-48">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">{p.name}</span>
          <span className="text-slate-100 font-medium">{fmtCOP(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function RegionesView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [seg, setSeg]  = useState('region')

  const { data, loading } = useData(() => api.segments(filters, seg, 20), [filters, refreshKey, seg])

  const rows = data?.data || []
  const totalVN  = rows.reduce((s, d) => s + (d.ventas_netas || 0), 0)
  const totalAnt = rows.reduce((s, d) => s + (d.ventas_netas_ant || 0), 0)
  const yoyTotal = totalAnt > 0 ? ((totalVN / totalAnt - 1) * 100) : null

  const chartData = rows.slice(0, 12).map((d) => ({
    name: d.dimension?.length > 18 ? d.dimension.slice(0, 18) + '…' : d.dimension,
    ventas_netas: d.ventas_netas,
    ventas_netas_ant: d.ventas_netas_ant,
  }))

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis por Dimensión</h1>
          <p className="text-slate-500 text-xs mt-0.5">Ventas, cumplimiento y variaciones por segmento</p>
        </div>
        <div className="flex gap-1 bg-surface-800 border border-surface-700 p-1 rounded-xl">
          {SEG_OPTS.map((s) => (
            <button key={s.key} onClick={() => setSeg(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${seg === s.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <Chip label="Total ventas" value={fmtCOP(totalVN)} color="text-brand-400" />
        <Chip label="Año anterior" value={fmtCOP(totalAnt)} color="text-slate-400" />
        <Chip label="Variación YoY" value={fmtPct(yoyTotal)} color={pctColor(yoyTotal)} />
        <Chip label="Segmentos" value={rows.length} color="text-cyan-400" />
      </div>

      {/* Bar chart — current vs prior year */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-0.5">
          Ventas Netas por {SEG_OPTS.find((s) => s.key === seg)?.label}
        </h2>
        <p className="text-xs text-slate-500 mb-4">actual vs año anterior · Top 12</p>
        <div className={`h-72 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip content={<TTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
              <Bar dataKey="ventas_netas" name="Ventas Netas" radius={[0, 3, 3, 0]} fill="#6366f1" />
              <Bar dataKey="ventas_netas_ant" name="Año Anterior" radius={[0, 3, 3, 0]} fill="#1f2937" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detail table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">
          Tabla Detallada — {SEG_OPTS.find((s) => s.key === seg)?.label}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-3 font-medium">#</th>
                <th className="pb-3 font-medium">{SEG_OPTS.find((s) => s.key === seg)?.label}</th>
                <th className="pb-3 font-medium text-right">Ventas Netas</th>
                <th className="pb-3 font-medium text-right">Part %</th>
                <th className="pb-3 font-medium text-right">Año Anterior</th>
                <th className="pb-3 font-medium text-right">Var YoY</th>
                <th className="pb-3 font-medium text-right">Mes Ant.</th>
                <th className="pb-3 font-medium text-right">Var MoM</th>
                <th className="pb-3 font-medium text-right">Clientes</th>
                <th className="pb-3 font-medium text-right">Ticket Prom.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                  <td className="py-2.5 text-slate-500">{i + 1}</td>
                  <td className="py-2.5 font-medium text-slate-100 max-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {d.dimension}
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${d.participacion_pct}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                      <span className="text-slate-400 w-9 text-right">{fmtPct(d.participacion_pct, 1)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-slate-500">{d.ventas_netas_ant != null ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                  <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>{d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct) : '—'}</td>
                  <td className="py-2.5 text-right text-slate-500">{d.ventas_mes_ant != null ? fmtCOP(d.ventas_mes_ant) : '—'}</td>
                  <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_mom_pct)}`}>{d.variacion_mom_pct != null ? fmtPct(d.variacion_mom_pct) : '—'}</td>
                  <td className="py-2.5 text-right text-slate-400">{fmtInt(d.num_clientes)}</td>
                  <td className="py-2.5 text-right text-slate-400">{fmtCOP(d.ticket_promedio)}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
                  <td className="py-2.5" colSpan={2}>TOTAL</td>
                  <td className="py-2.5 text-right text-brand-300">{fmtCOP(totalVN)}</td>
                  <td className="py-2.5 text-right text-slate-400">100%</td>
                  <td className="py-2.5 text-right text-slate-500">{fmtCOP(totalAnt)}</td>
                  <td className={`py-2.5 text-right ${pctColor(yoyTotal)}`}>{fmtPct(yoyTotal)}</td>
                  <td colSpan={4} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Chip({ label, value, color }) {
  return (
    <div className="card-sm flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  )
}
