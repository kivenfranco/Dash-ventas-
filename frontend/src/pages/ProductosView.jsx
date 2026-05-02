import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt, fmtNum, pctColor, cumpColor, cumpBg, MONTH_NAMES, formatPeriod } from '../utils/format'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6']
const C_PP    = '#F8A62B'
const C_VN    = '#000F9F'

const SEGS = [
  { key: 'linea_negocio',       label: 'Línea de Negocio'  },
  { key: 'grupo_comercial',     label: 'Grupo Comercial'   },
  { key: 'tipo_fabricacion',    label: 'Tipo Fabricación'  },
  { key: 'unidad_medida_venta', label: 'Unidad de Medida'  },
  { key: 'descripcion_parte',   label: 'Top Partes'        },
]

// Dimensions that carry PP valor (from PP_REGION_PLANTA_GRUPO or PP_VENDEDOR_VALOR)
const HAS_PP      = new Set(['linea_negocio', 'grupo_comercial', 'unidad_medida_venta'])
// Dimensions that also carry PP cantidad (from PP_VENDEDOR_CANTIDAD)
const HAS_PP_CANT = new Set(['unidad_medida_venta'])

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-52">
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

function CumpBar({ value }) {
  const w = Math.min(Math.max(value || 0, 0), 150)
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cumpBg(value)}`} style={{ width: `${Math.min(w, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold ${cumpColor(value)}`}>{fmtPct(value, 1)}</span>
    </div>
  )
}

export function ProductosView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [seg, setSeg]  = useState('linea_negocio')

  const { data, loading } = useData(() => api.segments(filters, seg, 20), [filters, refreshKey, seg])
  const rows = data?.data || []

  const hasPP      = HAS_PP.has(seg)
  const hasPPCant  = HAS_PP_CANT.has(seg)

  const totalVN   = rows.reduce((s, d) => s + (d.ventas_netas    || 0), 0)
  const totalAnt  = rows.reduce((s, d) => s + (d.ventas_netas_ant || 0), 0)
  const totalPP   = rows.reduce((s, d) => s + (d.presupuesto     || 0), 0)
  const yoyTotal  = totalAnt > 0 ? ((totalVN / totalAnt - 1) * 100) : null
  const cumpTotal = totalPP  > 0 ? (totalVN / totalPP * 100)        : null

  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  const barData = rows.slice(0, 10).map((d) => ({
    name:             d.dimension?.length > 22 ? d.dimension.slice(0, 20) + '…' : d.dimension,
    ventas_netas:     d.ventas_netas,
    ventas_netas_ant: d.ventas_netas_ant,
    ...(hasPP && { presupuesto: d.presupuesto }),
  }))

  const pieData = rows.slice(0, 8).map((d, i) => ({
    name: d.dimension, value: d.ventas_netas, fill: PALETTE[i % PALETTE.length],
  }))

  const barH = Math.max(barData.length * 52 + 20, 260)

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis de Productos</h1>
          <p className="text-slate-500 text-xs mt-0.5">Ventas por línea, grupo comercial y planta · {period}</p>
        </div>
        <div className="flex flex-wrap gap-1 bg-surface-800 border border-surface-700 p-1 rounded-xl">
          {SEGS.map((s) => (
            <button key={s.key} onClick={() => setSeg(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${seg === s.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-3">
        <Chip l="Ventas totales" v={fmtCOP(totalVN)}  c="text-brand-400" />
        <Chip l="Año anterior"   v={fmtCOP(totalAnt)} c="text-slate-400" />
        <Chip l="Var YoY"        v={fmtPct(yoyTotal)} c={pctColor(yoyTotal)} />
        {hasPP && <Chip l="Presupuesto"   v={fmtCOP(totalPP)}   c="text-amber-400" />}
        {hasPP && <Chip l="Cump PP"       v={fmtPct(cumpTotal)} c={cumpColor(cumpTotal)} />}
        <Chip l={SEGS.find(s => s.key === seg)?.label} v={rows.length} c="text-cyan-400" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">
            Ventas {hasPP ? 'vs Presupuesto' : 'vs Año Anterior'}
          </h2>
          <p className="text-xs text-slate-500 mb-4">por {SEGS.find(s => s.key === seg)?.label} · Top 10</p>
          <div className={loading ? 'opacity-40 animate-pulse' : ''} style={{ height: barH }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={140} />
                <Tooltip content={<TTip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v, e) => <span style={{ color: e.color }}>{v}</span>} />
                <Bar dataKey="ventas_netas" name="Ventas Netas" fill={C_VN} radius={[0,3,3,0]} barSize={13} />
                {hasPP
                  ? <Bar dataKey="presupuesto" name="Presupuesto" fill={C_PP} fillOpacity={0.75} radius={[0,3,3,0]} barSize={13} />
                  : <Bar dataKey="ventas_netas_ant" name="Año Anterior" fill="#1f2937" stroke="#475569" strokeWidth={1} radius={[0,3,3,0]} barSize={13} />
                }
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="xl:col-span-2 card">
          <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Participación</h2>
          <p className="text-xs text-slate-500 mb-4">distribución de ventas</p>
          <div className={`h-64 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                  dataKey="value" nameKey="name" paddingAngle={2}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }} />
                <Legend formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 10 }}>{v?.length > 18 ? v.slice(0,18)+'…' : v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">Detalle por {SEGS.find(s => s.key === seg)?.label}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-3 font-medium">#</th>
                <th className="pb-3 font-medium">{SEGS.find(s => s.key === seg)?.label}</th>
                <th className="pb-3 font-medium text-right">Ventas Netas</th>
                <th className="pb-3 font-medium text-right">Part %</th>
                {hasPP && <th className="pb-3 font-medium text-right">Presupuesto</th>}
                {hasPP && <th className="pb-3 font-medium">Cump PP</th>}
                {hasPPCant && <th className="pb-3 font-medium text-right">PP Cantidad</th>}
                {hasPPCant && <th className="pb-3 font-medium">Cump Cant.</th>}
                <th className="pb-3 font-medium text-right">Año Ant.</th>
                <th className="pb-3 font-medium text-right">Var YoY</th>
                <th className="pb-3 font-medium text-right">Mes Ant.</th>
                <th className="pb-3 font-medium text-right">Var MoM</th>
                <th className="pb-3 font-medium text-right">Clientes</th>
                <th className="pb-3 font-medium text-right">Ticket Prom.</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_,i) => (
                    <tr key={i}><td colSpan={14}><div className="animate-pulse h-5 my-2 bg-surface-700 rounded" /></td></tr>
                  ))
                : rows.map((d, i) => (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2.5 text-slate-500">{i+1}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                          <span className="font-medium text-slate-100">{d.dimension}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-10 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${d.participacion_pct}%`, background: PALETTE[i%PALETTE.length] }} />
                          </div>
                          <span className="text-slate-400 w-9 text-right">{fmtPct(d.participacion_pct)}</span>
                        </div>
                      </td>
                      {hasPP && (
                        <td className="py-2.5 text-right text-amber-400">
                          {d.presupuesto > 0 ? fmtCOP(d.presupuesto) : '—'}
                        </td>
                      )}
                      {hasPP && (
                        <td className="py-2.5">
                          {d.cump_pp_pct != null ? <CumpBar value={d.cump_pp_pct} /> : <span className="text-slate-600">—</span>}
                        </td>
                      )}
                      {hasPPCant && (
                        <td className="py-2.5 text-right text-amber-400/80">
                          {d.presupuesto_cantidad > 0 ? fmtNum(d.presupuesto_cantidad) : '—'}
                        </td>
                      )}
                      {hasPPCant && (
                        <td className="py-2.5">
                          {d.cump_pp_cantidad_pct != null ? <CumpBar value={d.cump_pp_cantidad_pct} /> : <span className="text-slate-600">—</span>}
                        </td>
                      )}
                      <td className="py-2.5 text-right text-slate-500">{d.ventas_netas_ant != null ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                      <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>{d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct) : '—'}</td>
                      <td className="py-2.5 text-right text-slate-500">{d.ventas_mes_ant != null ? fmtCOP(d.ventas_mes_ant) : '—'}</td>
                      <td className={`py-2.5 text-right font-semibold ${pctColor(d.variacion_mom_pct)}`}>{d.variacion_mom_pct != null ? fmtPct(d.variacion_mom_pct) : '—'}</td>
                      <td className="py-2.5 text-right text-slate-400">{fmtInt(d.num_clientes)}</td>
                      <td className="py-2.5 text-right text-slate-400">{fmtCOP(d.ticket_promedio)}</td>
                    </tr>
                  ))
              }
              {rows.length > 0 && (
                <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
                  <td colSpan={2} className="py-2.5">TOTAL</td>
                  <td className="py-2.5 text-right text-brand-300">{fmtCOP(totalVN)}</td>
                  <td className="py-2.5 text-right text-slate-400">100%</td>
                  {hasPP && <td className="py-2.5 text-right text-amber-400">{fmtCOP(totalPP)}</td>}
                  {hasPP && <td className="py-2.5"><CumpBar value={cumpTotal} /></td>}
                  {hasPPCant && <td colSpan={2} />}
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

function Chip({ l, v, c }) {
  return (
    <div className="card-sm flex items-center gap-2">
      <span className="text-xs text-slate-500">{l}</span>
      <span className={`text-sm font-bold ${c}`}>{v}</span>
    </div>
  )
}
