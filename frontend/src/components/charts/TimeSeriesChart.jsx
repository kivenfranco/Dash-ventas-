import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Bar,
} from 'recharts'
import { fmtCOP, fmtPct, MONTH_NAMES } from '../../utils/format'

const C_VENTAS = '#000F9F'
const C_PP     = '#F8A62B'
const C_ANT    = '#00B0F0'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const byKey = {}
  payload.forEach((p) => { byKey[p.dataKey] = p })

  const vn     = byKey['ventas_netas']?.value
  const pp     = byKey['pp_mes']?.value
  const ant    = byKey['ventas_netas_ant']?.value
  const yoyPct = byKey['variacion_yoy_pct']?.value
  const difYoy = payload[0]?.payload?.diferencia_yoy

  const yoyColor = yoyPct == null ? '#6b7280' : yoyPct >= 0 ? '#10b981' : '#f43f5e'

  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-xs min-w-56">
      <p className="text-slate-200 font-semibold mb-2">{MONTH_NAMES[label] || label}</p>

      {vn != null && (
        <Row color={C_VENTAS} label="Ventas Netas" value={fmtCOP(vn)} />
      )}
      {pp != null && pp > 0 && (
        <Row color={C_PP} label="Presupuesto" value={fmtCOP(pp)} />
      )}
      {ant != null && ant > 0 && (
        <Row color={C_ANT} label="Año Anterior" value={fmtCOP(ant)} />
      )}

      {(yoyPct != null || difYoy != null) && (
        <div className="mt-2 pt-2 border-t border-surface-700">
          <div className="flex justify-between gap-6 py-0.5">
            <span className="text-slate-400">Var YoY</span>
            <span className="font-bold" style={{ color: yoyColor }}>
              {difYoy != null && `${difYoy >= 0 ? '+' : ''}${fmtCOP(difYoy)}`}
              {yoyPct != null && ` (${yoyPct >= 0 ? '+' : ''}${fmtPct(yoyPct, 1)})`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ color, label, value }) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-slate-400">{label}</span>
      </div>
      <span className="text-slate-100 font-medium">{value}</span>
    </div>
  )
}

export function TimeSeriesChart({ data = [], loading }) {
  const series = data.map((d) => ({
    ...d,
    mes_label: MONTH_NAMES[d.mes_num] || d.mes_num,
  }))

  return (
    <div className={`w-full h-72 ${loading ? 'opacity-40 animate-pulse' : 'animate-fade-in'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
          <defs>
            <linearGradient id="gradVN" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={C_VENTAS} stopOpacity={0.30} />
              <stop offset="95%" stopColor={C_VENTAS} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="mes_num"
            tickFormatter={(v) => MONTH_NAMES[v] || v}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={false} tickLine={false}
            tickFormatter={fmtCOP}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v, entry) => <span style={{ color: entry.color, fontSize: 11 }}>{v}</span>}
          />
          <ReferenceLine y={0} stroke="#374151" strokeDasharray="2 4" />
          <Area
            type="monotone" dataKey="ventas_netas" name="Ventas Netas"
            stroke={C_VENTAS} fill="url(#gradVN)" strokeWidth={2.5} dot={false}
          />
          <Line
            type="monotone" dataKey="pp_mes" name="Presupuesto"
            stroke={C_PP} strokeWidth={2} dot={false}
            strokeDasharray="6 3"
          />
          <Line
            type="monotone" dataKey="ventas_netas_ant" name="Año Anterior"
            stroke={C_ANT} strokeWidth={1.5} dot={false}
            strokeDasharray="3 3"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function VarYoYChart({ data = [], loading }) {
  const series = data.map((d) => ({
    ...d,
    color: (d.variacion_yoy_pct || 0) >= 0 ? '#10b981' : '#f43f5e',
  }))

  return (
    <div className={`w-full h-48 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis dataKey="mes_num" tickFormatter={(v) => MONTH_NAMES[v] || v} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={45} />
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-xs">
                <p className="text-slate-200 font-semibold mb-1">{MONTH_NAMES[label]}</p>
                <p style={{ color: payload[0].payload.color }}>{fmtPct(payload[0].value, 1)}</p>
              </div>
            )
          }} />
          <ReferenceLine y={0} stroke="#6b7280" />
          <Bar dataKey="variacion_yoy_pct" name="Var YoY %" radius={[3,3,0,0]}>
            {series.map((entry, i) => (
              <rect key={i} fill={entry.color} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
