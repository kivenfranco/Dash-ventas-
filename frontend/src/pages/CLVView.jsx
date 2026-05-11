import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Download, ChevronLeft, ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, Sector,
} from 'recharts'

const CLV_PAGE = 50

const SEG_COLOR = {
  Platinum: '#e2e8f0',
  Gold:     '#fbbf24',
  Silver:   '#94a3b8',
  Bronze:   '#b45309',
}
const SEG_BG = {
  Platinum: 'rgba(226,232,240,0.12)',
  Gold:     'rgba(251,191,36,0.12)',
  Silver:   'rgba(148,163,184,0.12)',
  Bronze:   'rgba(180,83,9,0.12)',
}

const fmt = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(a/1e9).toFixed(2)}MM`
  if (a >= 1e6) return `$${(a/1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(a/1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function CLVTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-56 shadow-2xl">
      <p className="font-semibold text-slate-100 truncate mb-2">{d.nombre_cliente}</p>
      <p className="text-slate-500 font-mono mb-2">{d.numero_cliente}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">CLV estimado</span>
          <span className="font-bold text-slate-100">{fmt(d.clv_estimado)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">Venta anual</span>
          <span className="text-slate-300">{fmt(d.ventas_ano_actual)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">Prom. anual</span>
          <span className="text-slate-300">{fmt(d.avg_annual_value)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">Años activos</span>
          <span className="text-slate-300">{d.anos_activos}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">Vida estimada</span>
          <span className="text-slate-300">{((d.lifetime_estimado_anos ?? d.lifespan_factor) ?? 0).toFixed(1)}a</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-400">Prob. churn</span>
          <span className="text-amber-400 font-medium">
            {d.churn_prob != null ? `${(d.churn_prob * 100).toFixed(0)}%` : '—'}
          </span>
        </div>
        {d.clv_con_retencion != null && d.clv_con_retencion !== d.clv_estimado && (
          <div className="flex justify-between gap-6">
            <span className="text-slate-400">CLV + retención</span>
            <span className="text-emerald-400 font-medium">{fmt(d.clv_con_retencion)}</span>
          </div>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-surface-700">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ color: SEG_COLOR[d.segmento], background: SEG_BG[d.segmento] }}>
          {d.segmento}
        </span>
      </div>
    </div>
  )
}

function DonutLabel({ cx, cy, innerRadius, outerRadius, percent, name }) {
  return percent > 0.05 ? null : null
}

function ActiveShape({ cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value }) {
  return (
    <g>
      <text x={cx} y={cy - 8}  textAnchor="middle" fill="#f1f5f9" fontSize={15} fontWeight="bold">{value}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize={11}>{payload.name}</text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius}     outerRadius={outerRadius + 6}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={innerRadius - 2}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  )
}

export function CLVView() {
  const { refreshKey }          = useOutletContext()
  const { filters }             = useFilters()
  const [data, setData]         = useState([])
  const [resumen, setResumen]   = useState({})
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState('grafico')
  const [segFilter, setSeg]     = useState('Todos')
  const [activeDonut, setDonut] = useState(0)
  const [page, setPage]         = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.clv(filters.ano)
      .then((d) => { setData(d.data || []); setResumen(d.resumen || {}) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar CLV'))
      .finally(() => setLoading(false))
  }, [filters.ano, refreshKey])

  const segs      = ['Todos', 'Platinum', 'Gold', 'Silver', 'Bronze']
  const filtered  = segFilter === 'Todos' ? data : data.filter((r) => r.segmento === segFilter)
  const topBar    = filtered.slice(0, 20)
  const totalPgs  = Math.ceil(filtered.length / CLV_PAGE)
  const pageRows  = filtered.slice(page * CLV_PAGE, (page + 1) * CLV_PAGE)

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map((r) => ({
      'N° Cliente':     r.numero_cliente,
      'Nombre':         r.nombre_cliente,
      'Venta Año':      r.ventas_ano_actual,
      'Prom. Anual':    r.avg_annual_value,
      'Años Activos':   r.anos_activos,
      'Vida Est. (años)': (r.lifetime_estimado_anos ?? r.lifespan_factor),
      'Prob. Churn %':  r.churn_prob != null ? +(r.churn_prob * 100).toFixed(1) : null,
      'CLV Estimado':   r.clv_estimado,
      'CLV+Retención':  r.clv_con_retencion,
      'Segmento':       r.segmento,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'CLV')
    XLSX.writeFile(wb, `clv-${filters.ano}.xlsx`)
  }

  const donutData = Object.entries(resumen.por_segmento || {}).map(([name, value]) => ({
    name, value, fill: SEG_COLOR[name],
  }))

  const clvTotal   = resumen.total_clv   || 0
  const clvAvg     = resumen.avg_clv     || resumen.clv_promedio || 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Customer Lifetime Value</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          CLV = Promedio Anual × Vida Estimada × Multiplicador de Retención — {filters.ano}
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 col-span-1">
          <p className="text-xs text-slate-400">CLV Total</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{fmt(clvTotal)}</p>
        </div>
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 col-span-1">
          <p className="text-xs text-slate-400">CLV Promedio</p>
          <p className="text-xl font-bold text-slate-100 mt-1">{fmt(clvAvg)}</p>
        </div>
        {['Platinum','Gold','Silver','Bronze'].map((seg) => (
          <button
            key={seg}
            onClick={() => setSeg(segFilter === seg ? 'Todos' : seg)}
            className={`border rounded-xl p-4 text-left transition-all ${
              segFilter === seg ? 'ring-2 ring-brand-500' : 'border-surface-700 bg-surface-900 hover:border-surface-500'
            }`}
            style={{ background: segFilter === seg ? SEG_BG[seg] : undefined }}
          >
            <p className="text-xs text-slate-400">{seg}</p>
            <p className="text-xl font-bold mt-1" style={{ color: SEG_COLOR[seg] }}>
              {resumen.por_segmento?.[seg] ?? 0}
            </p>
          </button>
        ))}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 col-span-1">
          <p className="text-xs text-slate-400">Vida Prom. (años)</p>
          <p className="text-xl font-bold text-cyan-400 mt-1">
            {resumen.lifetime_promedio != null ? resumen.lifetime_promedio.toFixed(1) : '—'}
          </p>
        </div>
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 col-span-1">
          <p className="text-xs text-slate-400">Churn Prom.</p>
          <p className="text-xl font-bold text-orange-400 mt-1">
            {resumen.churn_prob_promedio_ponderado != null
              ? `${(resumen.churn_prob_promedio_ponderado * 100).toFixed(0)}%`
              : '—'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['grafico','Gráfico CLV'], ['donut','Distribución'], ['tabla','Tabla']].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}>{l}</button>
        ))}
        <select value={segFilter} onChange={(e) => { setSeg(e.target.value); setPage(0) }}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300">
          {segs.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button onClick={exportXlsx}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <Download size={12} /> Excel
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {/* Bar chart */}
      {tab === 'grafico' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4" style={{ height: Math.max(280, topBar.length * 28 + 60) }}>
          <p className="text-xs text-slate-400 mb-3">Top {topBar.length} clientes por CLV estimado</p>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={topBar} layout="vertical" margin={{ top: 2, right: 40, left: 4, bottom: 2 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="nombre_cliente" tick={{ fill: '#cbd5e1', fontSize: 10 }}
                axisLine={false} tickLine={false} width={170}
                tickFormatter={(v) => v?.length > 22 ? v.slice(0, 22) + '…' : v} />
              <Tooltip content={<CLVTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="clv_estimado" radius={[0, 4, 4, 0]} isAnimationActive maxBarSize={18}>
                {topBar.map((r, i) => (
                  <Cell key={i} fill={SEG_COLOR[r.segmento] || '#3b82f6'}
                    cursor="pointer" onClick={() => setSeg(r.segmento)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Donut chart */}
      {tab === 'donut' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-80 flex items-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                activeIndex={activeDonut}
                activeShape={ActiveShape}
                data={donutData}
                cx="40%"
                cy="50%"
                innerRadius={75}
                outerRadius={110}
                dataKey="value"
                onMouseEnter={(_, idx) => setDonut(idx)}
                isAnimationActive
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={activeDonut === i ? 1 : 0.75}
                    stroke="transparent" cursor="pointer"
                    onClick={() => setSeg(segFilter === entry.name ? 'Todos' : entry.name)} />
                ))}
              </Pie>
              <Legend
                layout="vertical" align="right" verticalAlign="middle"
                formatter={(value, entry) => (
                  <span style={{ color: entry.color, fontSize: 12 }}>
                    {value} — {entry.payload.value} clientes
                  </span>
                )}
              />
              <Tooltip
                formatter={(v, n) => [v, 'Clientes']}
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla */}
      {tab === 'tabla' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-surface-700 flex items-center justify-between">
            <p className="text-xs text-slate-400">{filtered.length} clientes · pág. {page + 1}/{totalPgs || 1}</p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 transition-colors text-slate-400 hover:text-slate-100">
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPgs - 1, p + 1))} disabled={page >= totalPgs - 1}
                className="p-1.5 rounded-lg hover:bg-surface-700 disabled:opacity-30 transition-colors text-slate-400 hover:text-slate-100">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-right px-4 py-3">Venta Año</th>
                  <th className="text-right px-4 py-3">Prom. Anual</th>
                  <th className="text-center px-3 py-3">Años</th>
                  <th className="text-center px-3 py-3">Vida Est.</th>
                  <th className="text-center px-3 py-3">P. Churn</th>
                  <th className="text-right px-4 py-3">CLV Estimado</th>
                  <th className="text-center px-4 py-3">Segmento</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50 transition-colors">
                    <td className="px-4 py-2 text-slate-500">{page * CLV_PAGE + i + 1}</td>
                    <td className="px-4 py-2 text-slate-200">
                      <div className="font-medium truncate max-w-xs" title={r.nombre_cliente}>{r.nombre_cliente}</div>
                      <div className="text-slate-500 font-mono">{r.numero_cliente}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_ano_actual)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{fmt(r.avg_annual_value)}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{r.anos_activos}</td>
                    <td className="px-3 py-2 text-center text-slate-400">
                      {((r.lifetime_estimado_anos ?? r.lifespan_factor) ?? 0).toFixed(1)}a
                    </td>
                    <td className="px-3 py-2 text-center font-medium"
                      style={{ color: r.churn_prob != null ? (r.churn_prob > 0.6 ? '#f97316' : r.churn_prob > 0.3 ? '#f59e0b' : '#22c55e') : '#6b7280' }}>
                      {r.churn_prob != null ? `${(r.churn_prob * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-100">{fmt(r.clv_estimado)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ color: SEG_COLOR[r.segmento], background: SEG_BG[r.segmento] }}>
                        {r.segmento}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
