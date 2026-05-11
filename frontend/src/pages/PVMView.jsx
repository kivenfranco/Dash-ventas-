import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct } from '../utils/format'
import { exportToExcel } from '../utils/exportExcel'
import { Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
} from 'recharts'

const GROUP_OPTIONS = [
  { value: 'linea_negocio',    label: 'Línea de negocio' },
  { value: 'grupo_comercial',  label: 'Grupo comercial'  },
  { value: 'region',           label: 'Región'            },
  { value: 'tipo_fabricacion', label: 'Tipo fabricación'  },
]

const EFFECT_COLORS = {
  precio:  '#6366f1',
  volumen: '#06b6d4',
  mix:     '#f59e0b',
}

function DeltaBadge({ value }) {
  if (value == null) return <span className="text-slate-500">—</span>
  const pos = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pos ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function EffectBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.abs(value) / max * 100) : 0
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color, opacity: 0.8 }}
        />
      </div>
      <span className={`text-[10px] w-20 text-right tabular-nums ${value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {value >= 0 ? '+' : ''}{fmtCOP(value)}
      </span>
    </div>
  )
}

function WaterfallTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const data = payload[0]?.payload
  if (!data) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-48">
      <p className="font-semibold text-slate-200 mb-2 truncate">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Ventas actuales</span>
          <span className="text-slate-100">{fmtCOP(data.ventas_cur)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Ventas anteriores</span>
          <span className="text-slate-100">{fmtCOP(data.ventas_prev)}</span>
        </div>
        <div className="border-t border-surface-700 pt-1 mt-1 space-y-1">
          <div className="flex justify-between gap-4">
            <span style={{ color: EFFECT_COLORS.precio }}>Efecto precio</span>
            <span className={data.efecto_precio >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {data.efecto_precio >= 0 ? '+' : ''}{fmtCOP(data.efecto_precio)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: EFFECT_COLORS.volumen }}>Efecto volumen</span>
            <span className={data.efecto_volumen >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {data.efecto_volumen >= 0 ? '+' : ''}{fmtCOP(data.efecto_volumen)}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: EFFECT_COLORS.mix }}>Efecto mix</span>
            <span className={data.efecto_mix >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {data.efecto_mix >= 0 ? '+' : ''}{fmtCOP(data.efecto_mix)}
            </span>
          </div>
        </div>
        <div className="border-t border-surface-700 pt-1 flex justify-between gap-4">
          <span className="text-slate-300 font-medium">Delta total</span>
          <span className={data.delta_total >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
            {data.delta_total >= 0 ? '+' : ''}{fmtCOP(data.delta_total)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function PVMView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [groupBy, setGroupBy] = useState('linea_negocio')

  const { data, loading } = useData(
    () => api.pvm(filters, groupBy),
    [filters, refreshKey, groupBy]
  )

  const rows      = data?.data || []
  const top10     = rows.slice(0, 10)
  const maxEffect = Math.max(
    1,
    ...rows.flatMap((r) => [
      Math.abs(r.efecto_precio),
      Math.abs(r.efecto_volumen),
      Math.abs(r.efecto_mix),
    ])
  )

  // Stacked bar waterfall data — show efecto breakdown per dimension
  const chartData = top10.map((r) => ({
    ...r,
    name: r.dimension?.length > 20 ? r.dimension.slice(0, 19) + '…' : (r.dimension || '—'),
  }))

  // Global totals waterfall: Ventas prev + efecto_precio + efecto_volumen + efecto_mix = Ventas cur
  const waterfallGlobal = data
    ? [
        { name: `${data.ano_prev}`, value: data.total_prev, base: 0, fill: '#3b82f6', type: 'bar' },
        {
          name: 'Precio',
          value: Math.abs(data.efecto_precio_total),
          base: data.total_prev,
          fill: data.efecto_precio_total >= 0 ? EFFECT_COLORS.precio : '#ef4444',
          type: 'effect',
          raw: data.efecto_precio_total,
        },
        {
          name: 'Volumen',
          value: Math.abs(data.efecto_volumen_total),
          base: data.total_prev + (data.efecto_precio_total >= 0 ? data.efecto_precio_total : 0),
          fill: data.efecto_volumen_total >= 0 ? EFFECT_COLORS.volumen : '#ef4444',
          type: 'effect',
          raw: data.efecto_volumen_total,
        },
        {
          name: 'Mix',
          value: Math.abs(data.efecto_mix_total),
          base: data.total_prev
            + (data.efecto_precio_total >= 0 ? data.efecto_precio_total : 0)
            + (data.efecto_volumen_total >= 0 ? data.efecto_volumen_total : 0),
          fill: data.efecto_mix_total >= 0 ? EFFECT_COLORS.mix : '#ef4444',
          type: 'effect',
          raw: data.efecto_mix_total,
        },
        { name: `${data.ano}`, value: data.total_cur, base: 0, fill: '#22c55e', type: 'bar' },
      ]
    : []

  const handleExport = () =>
    exportToExcel(
      rows,
      [
        { key: 'dimension',      header: 'Dimensión'        },
        { key: 'ventas_cur',     header: 'Ventas actual'    },
        { key: 'ventas_prev',    header: 'Ventas anterior'  },
        { key: 'cantidad_cur',   header: 'Cantidad actual'  },
        { key: 'cantidad_prev',  header: 'Cantidad anterior'},
        { key: 'precio_cur',     header: 'Precio actual'    },
        { key: 'precio_prev',    header: 'Precio anterior'  },
        { key: 'efecto_precio',  header: 'Efecto Precio'    },
        { key: 'efecto_volumen', header: 'Efecto Volumen'   },
        { key: 'efecto_mix',     header: 'Efecto Mix'       },
        { key: 'delta_total',    header: 'Delta Total'      },
        { key: 'delta_pct',      header: 'Delta %'          },
      ],
      `PVM_${data?.ano || ''}`
    )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis PVM</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Descomposición Precio · Volumen · Mix — {data?.ano_prev ?? '…'} vs {data?.ano ?? '…'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-surface-800 border border-surface-700 rounded-lg p-1">
            {GROUP_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setGroupBy(o.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  groupBy === o.value
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
          {rows.length > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">
              <Download size={12} /> Excel
            </button>
          )}
        </div>
      </div>

      {/* Global KPI cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 mb-1">Ventas {data.ano}</p>
            <p className="text-lg font-bold text-slate-100">{fmtCOP(data.total_cur)}</p>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 mb-1">Ventas {data.ano_prev}</p>
            <p className="text-lg font-bold text-slate-100">{fmtCOP(data.total_prev)}</p>
          </div>
          <div className={`rounded-xl p-4 border ${data.total_delta >= 0 ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-red-500/10 border-red-500/25'}`}>
            <p className="text-[10px] text-slate-500 mb-1">Delta total</p>
            <p className={`text-lg font-bold ${data.total_delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {data.total_delta >= 0 ? '+' : ''}{fmtCOP(data.total_delta)}
            </p>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 space-y-1">
            <div className="flex justify-between text-[10px]">
              <span style={{ color: EFFECT_COLORS.precio }}>Precio</span>
              <span className={data.efecto_precio_total >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {data.efecto_precio_total >= 0 ? '+' : ''}{fmtCOP(data.efecto_precio_total)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span style={{ color: EFFECT_COLORS.volumen }}>Volumen</span>
              <span className={data.efecto_volumen_total >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {data.efecto_volumen_total >= 0 ? '+' : ''}{fmtCOP(data.efecto_volumen_total)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span style={{ color: EFFECT_COLORS.mix }}>Mix</span>
              <span className={data.efecto_mix_total >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {data.efecto_mix_total >= 0 ? '+' : ''}{fmtCOP(data.efecto_mix_total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Global waterfall */}
      {waterfallGlobal.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-1">Cascada global PVM</p>
          <p className="text-[10px] text-slate-500 mb-4">
            De ventas {data.ano_prev} a ventas {data.ano} descompuesto en efectos de precio, volumen y mix
          </p>
          <div className={`h-56 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallGlobal} margin={{ top: 16, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => fmtCOP(v)} width={72} />
                <Tooltip
                  formatter={(v, k, p) => {
                    const raw = p?.payload?.raw
                    if (raw != null) return [`${raw >= 0 ? '+' : ''}${fmtCOP(raw)}`, k]
                    return [fmtCOP(v), k]
                  }}
                  contentStyle={{ background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11 }}
                />
                {/* Invisible base bar */}
                <Bar dataKey="base" fill="transparent" stackId="wf" isAnimationActive={false} />
                <Bar dataKey="value" stackId="wf" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {waterfallGlobal.map((d, i) => (
                    <Cell key={i} fill={d.fill} fillOpacity={0.85} />
                  ))}
                  <LabelList dataKey="value" position="top" style={{ fill: '#94a3b8', fontSize: 10 }}
                    formatter={(v, _, p) => {
                      const entry = waterfallGlobal[p?.index]
                      if (!entry) return fmtCOP(v)
                      if (entry.raw != null) return `${entry.raw >= 0 ? '+' : ''}${fmtCOP(Math.abs(entry.raw))}`
                      return fmtCOP(v)
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-dimension effect chart */}
      {chartData.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-0.5">
            Efectos por {GROUP_OPTIONS.find((o) => o.value === groupBy)?.label} — Top {chartData.length}
          </p>
          <p className="text-[10px] text-slate-500 mb-4">
            <span style={{ color: EFFECT_COLORS.precio }}>■</span> precio ·
            <span style={{ color: EFFECT_COLORS.volumen }} className="ml-1">■</span> volumen ·
            <span style={{ color: EFFECT_COLORS.mix }} className="ml-1">■</span> mix
          </p>
          <div className={`h-72 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical"
                margin={{ top: 4, right: 64, left: 8, bottom: 4 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => fmtCOP(v)} />
                <YAxis type="category" dataKey="name"
                  tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
                <Tooltip content={<WaterfallTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <ReferenceLine x={0} stroke="#334155" strokeWidth={1} />
                <Bar dataKey="efecto_precio"  name="Precio"  fill={EFFECT_COLORS.precio}  fillOpacity={0.8} maxBarSize={10} radius={[0, 3, 3, 0]} />
                <Bar dataKey="efecto_volumen" name="Volumen" fill={EFFECT_COLORS.volumen} fillOpacity={0.8} maxBarSize={10} radius={[0, 3, 3, 0]} />
                <Bar dataKey="efecto_mix"     name="Mix"     fill={EFFECT_COLORS.mix}     fillOpacity={0.8} maxBarSize={10} radius={[0, 3, 3, 0]}>
                  <LabelList dataKey="delta_total" position="right" style={{ fill: '#94a3b8', fontSize: 9 }}
                    formatter={(v) => `${v >= 0 ? '+' : ''}${fmtCOP(v)}`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Decomposition table */}
      {rows.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-700">
            <p className="text-xs font-medium text-slate-300">Descomposición detallada · {rows.length} grupos</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Dimensión</th>
                  <th className="text-right px-4 py-3">Venta actual</th>
                  <th className="text-right px-4 py-3">Venta ant.</th>
                  <th className="text-right px-4 py-3">Δ%</th>
                  <th className="text-right px-4 py-3 min-w-[160px]" style={{ color: EFFECT_COLORS.precio }}>Precio</th>
                  <th className="text-right px-4 py-3 min-w-[160px]" style={{ color: EFFECT_COLORS.volumen }}>Volumen</th>
                  <th className="text-right px-4 py-3 min-w-[160px]" style={{ color: EFFECT_COLORS.mix }}>Mix</th>
                  <th className="text-right px-4 py-3">Delta total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-surface-700/40 hover:bg-surface-700/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-200 max-w-[180px]">
                      <span className="truncate block" title={r.dimension}>{r.dimension}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300 tabular-nums">{fmtCOP(r.ventas_cur)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{fmtCOP(r.ventas_prev)}</td>
                    <td className="px-4 py-2.5 text-right"><DeltaBadge value={r.delta_pct} /></td>
                    <td className="px-4 py-2.5">
                      <EffectBar value={r.efecto_precio}  max={maxEffect} color={EFFECT_COLORS.precio} />
                    </td>
                    <td className="px-4 py-2.5">
                      <EffectBar value={r.efecto_volumen} max={maxEffect} color={EFFECT_COLORS.volumen} />
                    </td>
                    <td className="px-4 py-2.5">
                      <EffectBar value={r.efecto_mix}     max={maxEffect} color={EFFECT_COLORS.mix} />
                    </td>
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${r.delta_total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.delta_total >= 0 ? '+' : ''}{fmtCOP(r.delta_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Cargando…</div>
      )}
    </div>
  )
}
