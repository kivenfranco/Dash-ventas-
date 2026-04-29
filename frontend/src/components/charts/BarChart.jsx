import {
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'

const fmtCurrency = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(v)

const GRADIENT_COLORS = ['#6366f1', '#818cf8', '#06b6d4', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#38bdf8', '#4ade80', '#fb923c']

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 shadow-xl text-sm">
      <p className="text-slate-100 font-semibold mb-1">{d.DIMENSION}</p>
      <p className="text-slate-400">Ventas: <span className="text-emerald-400 font-medium">{fmtCurrency(d.VENTAS_TOTALES)}</span></p>
      <p className="text-slate-400">Participación: <span className="text-brand-400 font-medium">{d.participacion_pct?.toFixed(1)}%</span></p>
      <p className="text-slate-400">Transacciones: <span className="text-slate-300">{d.NUM_TRANSACCIONES?.toLocaleString('es-MX')}</span></p>
    </div>
  )
}

export function HorizontalBarChart({ data = [], loading }) {
  const sorted = [...data].sort((a, b) => (b.VENTAS_TOTALES || 0) - (a.VENTAS_TOTALES || 0))
  const maxVal = sorted[0]?.VENTAS_TOTALES || 1

  return (
    <div className={`w-full h-80 ${loading ? 'opacity-40 animate-pulse' : 'animate-fade-in'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={sorted} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1f2937" />
          <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCurrency} />
          <YAxis type="category" dataKey="DIMENSION" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} width={100} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1f2937' }} />
          <Bar dataKey="VENTAS_TOTALES" radius={[0, 6, 6, 0]} maxBarSize={30}>
            {sorted.map((_, i) => (
              <Cell key={i} fill={GRADIENT_COLORS[i % GRADIENT_COLORS.length]} />
            ))}
            <LabelList
              dataKey="VENTAS_TOTALES"
              position="right"
              formatter={fmtCurrency}
              style={{ fill: '#94a3b8', fontSize: 11 }}
            />
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function VerticalBarChart({ data = [], xKey = 'DIMENSION', yKey = 'VENTAS_TOTALES', loading }) {
  return (
    <div className={`w-full h-72 ${loading ? 'opacity-40 animate-pulse' : 'animate-fade-in'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey={xKey} tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={fmtCurrency} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #374151', borderRadius: 12 }}
            labelStyle={{ color: '#f1f5f9' }}
            itemStyle={{ color: '#94a3b8' }}
            formatter={(v) => [fmtCurrency(v), 'Ventas']}
          />
          <Bar dataKey={yKey} radius={[6, 6, 0, 0]} maxBarSize={40}>
            {data.map((_, i) => <Cell key={i} fill={GRADIENT_COLORS[i % GRADIENT_COLORS.length]} />)}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  )
}
