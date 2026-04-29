import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { KPICard } from '../components/kpis/KPICard'
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart'
import { fmtCOP, fmtPct, fmtInt, cumpColor, cumpBg, pctColor, formatPeriod } from '../utils/format'
import {
  DollarSign, TrendingUp, TrendingDown, Target, Zap, Clock, Activity, Calendar, MapPin,
} from 'lucide-react'
import {
  RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  PieChart, Pie, Cell,
} from 'recharts'

function GaugeCard({ label, value, falta, loading }) {
  const pct   = Math.min(Math.max(value || 0, 0), 150)
  const color = pct >= 100 ? '#10b981' : pct >= 80 ? '#6366f1' : pct >= 60 ? '#f59e0b' : '#f43f5e'
  const data  = [{ value: pct, fill: color }]

  return (
    <div className="card flex flex-col items-center py-4">
      <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">{label}</p>
      {loading ? (
        <div className="w-full h-32 animate-pulse bg-surface-700 rounded-xl" />
      ) : (
        <>
          <div className="w-full max-w-[220px] h-[110px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart cx="50%" cy="100%" innerRadius="60%" outerRadius="100%" startAngle={180} endAngle={0} data={data}>
                <PolarAngleAxis type="number" domain={[0, 150]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={5} background={{ fill: '#1f2937' }} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <span className={`text-2xl font-bold -mt-1 ${cumpColor(value)}`}>{fmtPct(value, 1)}</span>
          <p className="text-xs text-slate-500 mt-1.5 text-center">
            {(value || 0) >= 100
              ? '✓ Meta alcanzada'
              : falta != null
                ? `Falta ${fmtCOP(Math.max(falta, 0))}`
                : `Falta ${fmtPct(100 - (value || 0), 1)}`}
          </p>
        </>
      )}
    </div>
  )
}

function WorkingDays({ mes, trans, loading }) {
  const pct = mes > 0 ? Math.round((trans / mes) * 100) : 0
  return (
    <div className="card">
      <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-3">Días Hábiles</p>
      {loading ? <div className="animate-pulse h-10 bg-slate-700 rounded" /> : (
        <>
          <div className="flex items-end gap-1.5">
            <span className="text-3xl font-bold text-slate-100">{trans}</span>
            <span className="text-slate-500 text-sm mb-1">/ {mes} días</span>
          </div>
          <div className="mt-3 w-full h-2 bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-1">{pct}% del mes transcurrido</p>
        </>
      )}
    </div>
  )
}

function VentasDiariasTable({ data, loading }) {
  if (loading) return (
    <div className="space-y-1.5">
      {[...Array(8)].map((_, i) => <div key={i} className="animate-pulse h-7 bg-surface-700 rounded" />)}
    </div>
  )
  const rows = data?.data || []
  if (!rows.length) return <p className="text-slate-500 text-xs text-center py-6">Sin datos</p>

  const fmtFecha = (s) => {
    if (!s) return '—'
    const d = new Date(s + 'T12:00:00')
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })
  }

  const fmtCOPFull = (v) => {
    if (v == null) return '—'
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-surface-700 text-slate-400">
            <th className="pb-2 font-medium">Fecha</th>
            <th className="pb-2 font-medium text-right">Ventas Netas (COP)</th>
            <th className="pb-2 font-medium text-right">Var día ant.</th>
            <th className="pb-2 font-medium text-right">Cantidad</th>
            <th className="pb-2 font-medium text-right">Transacciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((d, i) => (
            <tr key={i} className={`border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors ${i === 0 ? 'bg-brand-600/5' : ''}`}>
              <td className="py-1.5 text-slate-300 font-medium">{fmtFecha(d.fecha)}</td>
              <td className="py-1.5 text-right font-semibold text-brand-300">{fmtCOPFull(d.ventas_netas)}</td>
              <td className={`py-1.5 text-right font-semibold text-xs ${pctColor(d.var_dia_pct)}`}>
                {d.var_dia_pct != null ? fmtPct(d.var_dia_pct, 1) : '—'}
              </td>
              <td className="py-1.5 text-right text-slate-400">{fmtInt(d.cantidad)}</td>
              <td className="py-1.5 text-right text-slate-400">{fmtInt(d.num_transacciones)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ResumenView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const { data: kpis,      loading: kL } = useData(() => api.kpis(filters),                    [filters, refreshKey])
  const { data: trends,    loading: tL } = useData(() => api.trends(filters),                  [filters, refreshKey])
  const { data: ppPlantas, loading: ppL} = useData(() => api.presupuesto(filters, 'linea_negocio', 20), [filters, refreshKey])
  const { data: ppRegiones,loading: prL} = useData(() => api.presupuesto(filters, 'region', 20),[filters, refreshKey])
  const { data: diarias,   loading: dL } = useData(() => api.ventasDiarias(filters, 60),        [filters, refreshKey])

  const k = kpis || {}
  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)
  const diferencia = (k.ventas_netas || 0) - (k.venta_ano_anterior || 0)

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Resumen Ejecutivo</h1>
          <p className="text-slate-500 text-xs mt-0.5">Centro de mando · <span className="text-brand-400">{period}</span></p>
        </div>
        {k.ventas_netas && (
          <div className="hidden md:flex items-center gap-6 text-xs">
            <Stat label="Ventas"     value={fmtCOP(k.ventas_netas)}  color="text-brand-400" />
            <Stat label="Cump"       value={fmtPct(k.cump_pct, 1)}   color={cumpColor(k.cump_pct)} />
            <Stat label="YoY"        value={fmtPct(k.variacion_yoy_pct, 1)} color={pctColor(k.variacion_yoy_pct)} />
            <Stat label="Proyección" value={fmtCOP(k.proyeccion)}     color="text-cyan-400" />
          </div>
        )}
      </div>

      {/* === Row 1: Gauges + días hábiles === */}
      <section>
        <SectionLabel>Presupuesto y Cumplimiento</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KPICard label="Presupuesto"   value={k.pp_region_planta_mes} format="currency" icon={Target} accent="amber"  loading={kL} />
          <KPICard label="Debe Ser"      value={k.debe_ser}             format="currency" icon={Clock}  accent="orange"
            sub={`${fmtInt(k.dias_habiles_transcurridos)} días hábiles`} loading={kL} />
          <KPICard label="Proyección Mes" value={k.proyeccion}          format="currency" icon={Zap}    accent="cyan"   loading={kL} />
          <GaugeCard label="Cump vs Debe Ser" value={k.cump_pct}     falta={k.debe_ser - k.ventas_netas}           loading={kL} />
          <GaugeCard label="Cump vs PP"       value={k.cump_pp_pct}  falta={k.pp_region_planta_mes - k.ventas_netas} loading={kL} />
          <WorkingDays mes={k.dias_habiles_mes} trans={k.dias_habiles_transcurridos} loading={kL} />
        </div>
      </section>

      {/* === Row 2: Core KPIs === */}
      <section>
        <SectionLabel>Ventas</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KPICard label="Ventas Netas" value={k.ventas_netas} format="currency" icon={DollarSign} accent="brand"
            changePct={k.variacion_yoy_pct} changeLabel="vs año ant." loading={kL} />
          <KPICard label="Año Anterior" value={k.venta_ano_anterior} format="currency" icon={TrendingUp} accent="slate" loading={kL}
            sub={`mismo período ${(filters.ano || new Date().getFullYear()) - 1}`} />
          <KPICard
            label="Diferencia YoY"
            value={diferencia}
            format="currency"
            icon={diferencia >= 0 ? TrendingUp : TrendingDown}
            accent={!k.ventas_netas ? 'slate' : diferencia >= 0 ? 'emerald' : 'rose'}
            loading={kL}
            changePct={k.variacion_yoy_pct}
            changeLabel="variación YoY"
            sub={diferencia >= 0 ? 'crecimiento absoluto' : 'caída absoluta'}
          />
        </div>
      </section>

      {/* === Row 3: Evolution chart (full width) === */}
      <div className="card">
        <h2 className="text-sm font-semibold text-slate-200 mb-0.5">Evolución de Ventas {filters.ano}</h2>
        <p className="text-xs text-slate-500 mb-4">ventas netas vs presupuesto vs año anterior</p>
        <TimeSeriesChart data={trends?.series || []} loading={tL} />
      </div>

      {/* === Row 4: Regiones full chart === */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Análisis por Región</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">ventas netas vs presupuesto y cumplimiento — todas las regiones</p>
        <RegionesChart data={ppRegiones?.data || []} loading={prL} />
      </div>

      {/* === Row 4b: Region participation pie === */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Participación por Región</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">distribución de ventas netas por zona</p>
        <RegionPieChart data={ppRegiones?.data || []} loading={prL} />
      </div>

      {/* === Row 5: Planta analysis === */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Análisis por Línea de Negocio</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">participación, ventas vs año anterior y cumplimiento por línea de negocio</p>
        <PlantaChart data={ppPlantas?.data || []} loading={ppL} />
      </div>

      {/* === Row 6: Daily sales table === */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Ventas por Día</h2>
          <span className="text-xs text-slate-500 ml-1">— ventas por fecha de factura</span>
        </div>
        <VentasDiariasTable data={diarias} loading={dL} />
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <p className="text-slate-500">{label}</p>
      <p className={`font-bold ${color}`}>{value}</p>
    </div>
  )
}

function SectionLabel({ children }) {
  return <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-2">{children}</p>
}

const C_VENTAS = '#000F9F'
const C_PP     = '#F8A62B'

function RegionesChart({ data, loading }) {
  if (loading) return (
    <div className="space-y-2">
      {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse h-8 bg-surface-700 rounded" />)}
    </div>
  )
  if (!data.length) return <p className="text-slate-500 text-xs text-center py-6">Sin datos</p>

  const rows = data.map((d) => ({
    name: (d.dimension || '').length > 22 ? d.dimension.slice(0, 20) + '…' : (d.dimension || ''),
    fullName: d.dimension || '',
    ventas:  Math.round(d.ventas_netas  || 0),
    pp:      Math.round(d.presupuesto   || 0),
    cump:    d.cumplimiento_pct,
    yoy:     d.variacion_yoy_pct,
    part:    d.participacion_pct,
  }))

  const RegTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs min-w-44 shadow-xl">
        <p className="text-slate-200 font-semibold mb-2">{d.fullName}</p>
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span style={{ color: C_VENTAS }}>● Ventas</span>
            <span className="text-slate-100 font-medium">{fmtCOP(d.ventas)}</span>
          </div>
          {d.pp > 0 && (
            <div className="flex justify-between gap-4">
              <span style={{ color: C_PP }}>● Presupuesto</span>
              <span className="text-slate-100 font-medium">{fmtCOP(d.pp)}</span>
            </div>
          )}
          {d.cump != null && (
            <div className="flex justify-between gap-4 pt-1 border-t border-surface-700">
              <span className="text-slate-400">Cumplimiento</span>
              <span className={`font-bold ${cumpColor(d.cump)}`}>{fmtPct(d.cump, 1)}</span>
            </div>
          )}
          {d.yoy != null && (
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">YoY</span>
              <span className={`font-semibold ${pctColor(d.yoy)}`}>{d.yoy >= 0 ? '+' : ''}{fmtPct(d.yoy, 1)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Participación</span>
            <span className="text-slate-300">{fmtPct(d.part, 1)}</span>
          </div>
        </div>
      </div>
    )
  }

  const chartHeight = Math.max(rows.length * 52 + 30, 200)

  return (
    <div className="overflow-x-auto">
      <div style={{ minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 170, left: 12, bottom: 4 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
            <XAxis
              type="number" tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false} tickLine={false} tickFormatter={fmtCOP}
            />
            <YAxis
              type="category" dataKey="name"
              tick={{ fill: '#cbd5e1', fontSize: 11 }}
              axisLine={false} tickLine={false} width={120}
            />
            <Tooltip content={<RegTooltip />} cursor={{ fill: '#1f2937' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v, e) => <span style={{ color: e.color }}>{v}</span>} />
            <Bar dataKey="ventas" name="Ventas Netas" fill={C_VENTAS} radius={[0, 3, 3, 0]} barSize={16}>
              <LabelList
                dataKey="cump"
                content={({ x, y, width, height, value, index }) => {
                  if (value == null) return null
                  const color = value >= 100 ? '#10b981' : value >= 80 ? '#6366f1' : value >= 60 ? '#f59e0b' : '#f43f5e'
                  const ventas = rows[index]?.ventas
                  return (
                    <text x={x + width + 8} y={y + height / 2 + 4} fontSize={10} fontWeight={600}>
                      <tspan fill="#94a3b8" fontSize={9}>{fmtCOP(ventas)}</tspan>
                      <tspan fill={color}>{' · '}{fmtPct(value, 1)}</tspan>
                    </text>
                  )
                }}
              />
            </Bar>
            <Bar dataKey="pp" name="Presupuesto" fill={C_PP} radius={[0, 3, 3, 0]} barSize={16} fillOpacity={0.75}>
              <LabelList
                dataKey="pp"
                content={({ x, y, width, height, value }) => {
                  if (!value) return null
                  return <text x={x + width + 8} y={y + height / 2 + 4} fill="#F8A62B" fontSize={9} fontWeight={500}>{fmtCOP(value)}</text>
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const REGION_COLORS  = ['#000F9F','#F8A62B','#10b981','#8b5cf6','#f43f5e','#06b6d4','#f97316','#ec4899','#84cc16','#a3e635']
const PLANTA_COLORS  = ['#000F9F','#F8A62B','#10b981','#8b5cf6','#f43f5e','#06b6d4','#f97316','#ec4899','#84cc16']

function RegionPieChart({ data, loading }) {
  if (loading) return (
    <div className="animate-pulse h-52 bg-surface-700 rounded" />
  )
  if (!data.length) return <p className="text-slate-500 text-xs text-center py-6">Sin datos</p>

  const pieData = data.map((d, i) => ({
    name:   d.dimension || '',
    value:  d.participacion_pct || 0,
    ventas: d.ventas_netas || 0,
    color:  REGION_COLORS[i % REGION_COLORS.length],
  }))

  return (
    <div className="flex flex-col md:flex-row gap-6 items-center">
      <div className="w-full md:w-64 flex-shrink-0">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
              {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0]
              return (
                <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-xs">
                  <p className="text-slate-200 font-semibold mb-1">{p.name}</p>
                  <p style={{ color: p.payload.color }} className="font-bold">{fmtPct(p.value, 1)}</p>
                  <p className="text-slate-400">{fmtCOP(p.payload.ventas)}</p>
                </div>
              )
            }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1.5 w-full">
        {pieData.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span className="text-slate-300 flex-1 truncate min-w-0">{d.name}</span>
            <span className="text-slate-400 whitespace-nowrap">{fmtCOP(d.ventas)}</span>
            <span className="font-bold w-10 text-right" style={{ color: d.color }}>{fmtPct(d.value, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
const C_ANT_PLANTA  = '#4b5563'

function PlantaChart({ data, loading }) {
  if (loading) return (
    <div className="flex gap-4">
      <div className="animate-pulse w-60 h-60 bg-surface-700 rounded-full" />
      <div className="flex-1 animate-pulse h-60 bg-surface-700 rounded" />
    </div>
  )
  if (!data.length) return <p className="text-slate-500 text-xs text-center py-6">Sin datos</p>

  const series = data.map((d, i) => ({
    name:  d.dimension || '',
    short: (d.dimension || '').length > 8 ? d.dimension.slice(0, 7) + '…' : (d.dimension || ''),
    ventas: Math.round(d.ventas_netas  || 0),
    ant:    Math.round(d.ventas_netas_ant || 0),
    pp:     Math.round(d.presupuesto   || 0),
    cump:   d.cumplimiento_pct,
    yoy:    d.variacion_yoy_pct,
    part:   d.participacion_pct,
    color:  PLANTA_COLORS[i % PLANTA_COLORS.length],
  }))

  const pieData = series.map((d) => ({ name: d.name, value: d.part || 0, color: d.color }))

  const YoYLabel = ({ x, y, width, value }) => {
    if (value == null) return null
    const color = value >= 0 ? '#10b981' : '#f43f5e'
    return (
      <text x={x + width / 2} y={y - 4} fill={color} fontSize={9} fontWeight={700} textAnchor="middle">
        {value >= 0 ? '+' : ''}{fmtPct(value, 1)}
      </text>
    )
  }

  const CustomXTick = ({ x, y, payload, index }) => {
    const d = series[index]
    if (!d) return null
    const cc = (d.cump || 0) >= 100 ? '#10b981' : (d.cump || 0) >= 80 ? '#6366f1' : (d.cump || 0) >= 60 ? '#f59e0b' : '#f43f5e'
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={14} textAnchor="middle" fill="#cbd5e1" fontSize={10}>{d.short}</text>
        {d.cump != null && (
          <text x={0} y={0} dy={26} textAnchor="middle" fill={cc} fontSize={9} fontWeight={700}>{fmtPct(d.cump, 1)}</text>
        )}
      </g>
    )
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      {/* Donut — participación */}
      <div className="xl:w-72 flex flex-col items-center justify-center">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={2} dataKey="value">
              {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0]
              return (
                <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-xs">
                  <p className="text-slate-200 font-semibold">{p.name}</p>
                  <p style={{ color: p.payload.color }} className="font-bold">{fmtPct(p.value, 1)}</p>
                </div>
              )
            }} />
            <Legend iconSize={8} formatter={(v) => <span className="text-slate-400 text-xs">{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-500 -mt-2 text-center">Participación por Planta</p>
      </div>

      {/* Grouped bars — ant vs ventas */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={series} margin={{ top: 22, right: 16, left: 10, bottom: 44 }} barCategoryGap="25%" barGap={3}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="short" tick={<CustomXTick />} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} width={60} />
            <Tooltip
              cursor={{ fill: '#1f2937' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload
                return (
                  <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs min-w-40 shadow-xl">
                    <p className="text-slate-200 font-semibold mb-1.5">{d.name}</p>
                    <div className="space-y-1">
                      <div className="flex justify-between gap-4"><span style={{ color: C_VENTAS }}>● Ventas</span><span className="text-slate-100 font-medium">{fmtCOP(d.ventas)}</span></div>
                      <div className="flex justify-between gap-4"><span style={{ color: C_ANT_PLANTA }}>● Año Ant.</span><span className="text-slate-100 font-medium">{fmtCOP(d.ant)}</span></div>
                      {d.pp > 0 && <div className="flex justify-between gap-4"><span style={{ color: C_PP }}>● PP</span><span className="text-slate-100 font-medium">{fmtCOP(d.pp)}</span></div>}
                      {d.yoy != null && <div className="flex justify-between gap-4 pt-1 border-t border-surface-700"><span className="text-slate-400">YoY</span><span className={`font-bold ${d.yoy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{d.yoy >= 0 ? '+' : ''}{fmtPct(d.yoy, 1)}</span></div>}
                      {d.cump != null && <div className="flex justify-between gap-4"><span className="text-slate-400">Cump</span><span className={`font-bold ${cumpColor(d.cump)}`}>{fmtPct(d.cump, 1)}</span></div>}
                    </div>
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v, e) => <span style={{ color: e.color }}>{v}</span>} />
            <Bar dataKey="ant"    name="Año Anterior"  fill={C_ANT_PLANTA} radius={[3,3,0,0]} barSize={20} />
            <Bar dataKey="ventas" name="Ventas Netas"  fill={C_VENTAS}     radius={[3,3,0,0]} barSize={20}>
              <LabelList dataKey="yoy" content={<YoYLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
