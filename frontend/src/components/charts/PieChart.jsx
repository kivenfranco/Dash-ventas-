import { PieChart as RePieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f87171', '#a78bfa', '#38bdf8', '#4ade80']

const fmtCurrency = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(v)

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-sm">
      <p className="text-slate-100 font-semibold">{d.name}</p>
      <p className="text-slate-400 mt-1">
        {fmtCurrency(d.value)} — <span className="text-brand-400">{d.payload?.participacion_pct?.toFixed(1)}%</span>
      </p>
    </div>
  )
}

export function DonutChart({ data = [], loading }) {
  const mapped = data.map((d) => ({
    name: d.DIMENSION,
    value: d.VENTAS_TOTALES,
    participacion_pct: d.participacion_pct,
  }))

  return (
    <div className={`w-full h-72 ${loading ? 'opacity-40 animate-pulse' : 'animate-fade-in'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RePieChart>
          <Pie
            data={mapped}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="75%"
            paddingAngle={3}
            dataKey="value"
          >
            {mapped.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(v) => <span className="text-slate-400 text-xs">{v}</span>}
            iconType="circle"
            iconSize={8}
          />
        </RePieChart>
      </ResponsiveContainer>
    </div>
  )
}
