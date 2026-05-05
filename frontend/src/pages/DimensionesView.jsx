import { useOutletContext } from 'react-router-dom'
import { useState, useCallback } from 'react'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, pctColor, cumpColor, cumpBg, MONTH_NAMES, formatPeriod } from '../utils/format'
import { X } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts'

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6','#3b82f6','#84cc16']
const C_VN  = '#000F9F'
const C_PP  = '#F8A62B'
const C_ANT = '#1f2937'

const PANELS = [
  { id: 'organico',       label: 'Tipo de Venta',      src: 'seg', top: 10 },
  { id: 'es_stock',       label: 'Stock vs No Stock',  src: 'atr', top: 20 },
  { id: 'linea_negocio',  label: 'Línea de Negocio',   src: 'atr', top: 20 },
  { id: 'estructura',     label: 'Estructura',         src: 'atr', top: 50 },
  { id: 'tipo_producto',  label: 'Tipo Producto',      src: 'atr', top: 50 },
]

// Map dimension id → API filter key used for drill-down cross-panel
const DRILL_FILTER_MAP = {
  linea_negocio: 'planta',
  estructura:    'estructura',
}

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-48">
      <p className="text-slate-200 font-semibold mb-2 truncate max-w-44">{label}</p>
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

export function DimPanel({ panelId, label, src, top, filters, refreshKey, drill, onDrill }) {
  // Merge global filters with active drill (cross-panel filter)
  const effectiveFilters = drill && drill.panelId !== panelId
    ? { ...filters, [drill.filterKey]: drill.value }
    : filters

  const fetcher = useCallback(
    src === 'seg'
      ? () => api.segments(effectiveFilters, panelId, top)
      : () => api.atributos(effectiveFilters, panelId, top),
    [effectiveFilters, panelId, top, refreshKey]
  )

  const { data, loading, error } = useData(fetcher, [effectiveFilters, refreshKey, panelId])
  const rows   = data?.data || []
  const hasPP  = rows.length > 0 && rows[0]?.presupuesto != null
  const totalVN = rows.reduce((s, d) => s + (d.ventas_netas || 0), 0)
  const totalPP = rows.reduce((s, d) => s + (d.presupuesto || 0), 0)
  const totalAnt = rows.reduce((s, d) => s + (d.ventas_netas_ant || 0), 0)

  const chartData = rows.slice(0, 12).map((d) => ({
    name:             d.dimension?.length > 22 ? d.dimension.slice(0, 22) + '…' : (d.dimension || '—'),
    ventas_netas:     d.ventas_netas,
    ventas_netas_ant: d.ventas_netas_ant,
    ...(hasPP && { presupuesto: d.presupuesto }),
  }))

  const pieData = rows.slice(0, 8).map((d, i) => ({
    name:  d.dimension?.length > 18 ? d.dimension.slice(0, 18) + '…' : (d.dimension || '—'),
    value: d.ventas_netas,
    fill:  PALETTE[i % PALETTE.length],
  }))

  const colSpanSkeleton = hasPP ? 9 : 7

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-slate-200 mb-0.5">{label}</h2>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mt-3">
        {/* Bar chart */}
        <div className={`xl:col-span-3 h-56 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 16, left: 4, bottom: 2 }} barCategoryGap="25%"
              style={onDrill ? { cursor: 'pointer' } : {}}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={120} />
              <Tooltip content={<TTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
              <Bar dataKey="ventas_netas" name="Ventas Netas" fill={C_VN} radius={[0, 3, 3, 0]} barSize={13}
                onClick={onDrill ? (d) => onDrill(panelId, rows.find((r) => r.dimension?.slice(0, 22) + (r.dimension?.length > 22 ? '…' : '') === d.name || r.dimension === d.name)?.dimension) : undefined}
              >
                {!hasPP && chartData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
              {hasPP
                ? <Bar dataKey="presupuesto" name="Presupuesto" fill={C_PP} fillOpacity={0.75} radius={[0, 3, 3, 0]} barSize={13} />
                : chartData.some((d) => d.ventas_netas_ant > 0) && (
                    <Bar dataKey="ventas_netas_ant" name="Año Anterior" radius={[0, 3, 3, 0]} fill={C_ANT} stroke="#374151" strokeWidth={1} barSize={13} />
                  )
              }
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie */}
        <div className={`xl:col-span-2 h-56 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart style={onDrill ? { cursor: 'pointer' } : {}}>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={2}
                onClick={onDrill ? (e) => onDrill(panelId, rows.find((r) => (r.dimension?.slice(0, 18) + (r.dimension?.length > 18 ? '…' : '')) === e.name || r.dimension === e.name)?.dimension) : undefined}
              >
                {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 10 }} />
              <Legend formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 10 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Mini table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left border-b border-surface-700 text-slate-400">
              <th className="pb-2 font-medium">#</th>
              <th className="pb-2 font-medium">{label}</th>
              <th className="pb-2 font-medium text-right">Ventas Netas</th>
              <th className="pb-2 font-medium text-right">Part %</th>
              {hasPP && <th className="pb-2 font-medium text-right">Presupuesto</th>}
              {hasPP && <th className="pb-2 font-medium">Cump PP</th>}
              <th className="pb-2 font-medium text-right">Año Ant.</th>
              <th className="pb-2 font-medium text-right">Var YoY</th>
              <th className="pb-2 font-medium text-right">Var MoM</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(4)].map((_, i) => (
                  <tr key={i}><td colSpan={colSpanSkeleton}><div className="animate-pulse h-5 my-1.5 bg-surface-700 rounded" /></td></tr>
                ))
              : rows.slice(0, 15).map((d, i) => (
                  <tr key={i}
                    className={`border-b border-surface-700/30 transition-colors ${onDrill ? 'cursor-pointer hover:bg-brand-500/10' : 'hover:bg-surface-700/20'}`}
                    onClick={onDrill ? () => onDrill(panelId, d.dimension) : undefined}
                  >
                    <td className="py-2 text-slate-500">{i + 1}</td>
                    <td className="py-2 font-medium text-slate-100">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="max-w-[200px] truncate">{d.dimension || '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-10 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${d.participacion_pct}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                        <span className="text-slate-400 w-8 text-right">{fmtPct(d.participacion_pct, 1)}</span>
                      </div>
                    </td>
                    {hasPP && (
                      <td className="py-2 text-right text-amber-400">
                        {d.presupuesto > 0 ? fmtCOP(d.presupuesto) : '—'}
                      </td>
                    )}
                    {hasPP && (
                      <td className="py-2">
                        {d.cump_pp_pct != null ? <CumpBar value={d.cump_pp_pct} /> : <span className="text-slate-600">—</span>}
                      </td>
                    )}
                    <td className="py-2 text-right text-slate-500">{d.ventas_netas_ant != null ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                    <td className={`py-2 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>{d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct, 1) : '—'}</td>
                    <td className={`py-2 text-right font-semibold ${pctColor(d.variacion_mom_pct)}`}>{d.variacion_mom_pct != null ? fmtPct(d.variacion_mom_pct, 1) : '—'}</td>
                  </tr>
                ))
            }
            {rows.length > 0 && (
              <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
                <td className="py-2" colSpan={2}>TOTAL</td>
                <td className="py-2 text-right text-brand-300">{fmtCOP(totalVN)}</td>
                <td className="py-2 text-right text-slate-400">100%</td>
                {hasPP && <td className="py-2 text-right text-amber-400">{fmtCOP(totalPP)}</td>}
                {hasPP && <td className="py-2"><CumpBar value={totalPP > 0 ? totalVN / totalPP * 100 : null} /></td>}
                <td className="py-2 text-right text-slate-500">{fmtCOP(totalAnt)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DimensionesView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [active, setActive] = useState(null)
  // drill: { panelId, filterKey, value, label } — cross-panel filter applied when user clicks a bar/row
  const [drill, setDrill]   = useState(null)

  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  const handleDrill = useCallback((panelId, rawValue) => {
    const filterKey = DRILL_FILTER_MAP[panelId]
    if (!filterKey || !rawValue || rawValue === 'Sin Clasificar') return
    const panel = PANELS.find((p) => p.id === panelId)
    setDrill((prev) =>
      prev?.panelId === panelId && prev?.value === rawValue
        ? null  // clicking same item clears the drill
        : { panelId, filterKey, value: rawValue, label: panel?.label ?? panelId }
    )
  }, [])

  const visiblePanels = active ? PANELS.filter((p) => p.id === active) : PANELS

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis por Dimensión</h1>
          <p className="text-slate-500 text-xs mt-0.5">Tipo de venta, stock, línea, estructura y tipo de producto · {period}</p>
        </div>
        <div className="flex gap-1 flex-wrap justify-end items-center">
          {/* Drill-down chip */}
          {drill && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-500/20 border border-brand-500/40 text-brand-300 text-xs font-medium">
              <span className="text-slate-400">{drill.label}:</span>
              <span>{drill.value}</span>
              <button onClick={() => setDrill(null)} className="ml-1 hover:text-white transition-colors">
                <X size={12} />
              </button>
            </div>
          )}
          <button onClick={() => setActive(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!active ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-slate-100 border border-surface-700'}`}>
            Todos
          </button>
          {PANELS.map((p) => (
            <button key={p.id} onClick={() => setActive(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active === p.id ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-slate-100 border border-surface-700'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {visiblePanels.map((p) => (
        <DimPanel
          key={p.id}
          panelId={p.id}
          label={p.label}
          src={p.src}
          top={p.top}
          filters={filters}
          refreshKey={refreshKey}
          drill={drill}
          onDrill={DRILL_FILTER_MAP[p.id] ? handleDrill : undefined}
        />
      ))}
    </div>
  )
}
