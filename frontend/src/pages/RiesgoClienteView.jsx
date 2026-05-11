import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, fmtInt } from '../utils/format'
import { exportToExcel } from '../utils/exportExcel'
import { Download, ChevronUp, ChevronDown, ShieldAlert, ShieldCheck, Shield } from 'lucide-react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'

const NIVEL_CFG = {
  Alto:  { color: '#ef4444', bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30',    icon: ShieldAlert  },
  Medio: { color: '#f59e0b', bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30',  icon: Shield       },
  Bajo:  { color: '#22c55e', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', icon: ShieldCheck },
}

const COLS = [
  { key: 'risk_score',   label: 'Score',     dir: 'desc' },
  { key: 'nombre_cliente', label: 'Cliente', dir: 'asc'  },
  { key: 'ventas_cur',   label: 'Vta actual', dir: 'desc' },
  { key: 'variacion_yoy', label: 'Var YoY',  dir: 'asc'  },
  { key: 'last_mes',     label: 'Últ. mes',   dir: 'asc'  },
  { key: 'diversidad_productos', label: 'Productos', dir: 'asc' },
  { key: 'anos_activos', label: 'Antigüedad', dir: 'desc' },
]

function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const cfg = NIVEL_CFG[d.nivel] || NIVEL_CFG.Bajo
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-44">
      <p className="font-semibold text-slate-200 truncate mb-1">{d.nombre_cliente}</p>
      <div className="space-y-0.5">
        <div className="flex justify-between gap-3">
          <span className="text-slate-400">Score riesgo</span>
          <span className="font-bold" style={{ color: cfg.color }}>{d.risk_score?.toFixed(1)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-400">Ventas actuales</span>
          <span className="text-slate-200">{fmtCOP(d.ventas_cur)}</span>
        </div>
        {d.variacion_yoy != null && (
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Var YoY</span>
            <span className={d.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {d.variacion_yoy >= 0 ? '+' : ''}{d.variacion_yoy?.toFixed(1)}%
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-slate-400">Nivel</span>
          <span className={cfg.text}>{d.nivel}</span>
        </div>
      </div>
    </div>
  )
}

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span className="text-slate-600 ml-0.5">↕</span>
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="inline ml-0.5 text-brand-400" />
    : <ChevronDown size={11} className="inline ml-0.5 text-brand-400" />
}

export function RiesgoClienteView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [nivelFilter, setNivelFilter] = useState('all')
  const [sortKey,  setSortKey]  = useState('risk_score')
  const [sortDir,  setSortDir]  = useState('desc')
  const [topN,     setTopN]     = useState(200)

  const { data, loading } = useData(
    () => api.riesgoCliente(filters, topN),
    [filters, refreshKey, topN]
  )

  const rows = data?.data || []
  const resumen = data?.resumen || {}

  const filtered = nivelFilter === 'all' ? rows : rows.filter((r) => r.nivel === nivelFilter)

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0
    const vb = b[sortKey] ?? 0
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    return sortDir === 'asc' ? va - vb : vb - va
  })

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(COLS.find((c) => c.key === key)?.dir || 'desc') }
  }

  const handleExport = () =>
    exportToExcel(sorted, [
      { key: 'nombre_cliente',     header: 'Cliente'       },
      { key: 'ventas_cur',         header: 'Vta actual'    },
      { key: 'ventas_prev',        header: 'Vta anterior'  },
      { key: 'variacion_yoy',      header: 'Var YoY %'     },
      { key: 'risk_score',         header: 'Score riesgo'  },
      { key: 'churn_score',        header: 'Score churn'   },
      { key: 'yoy_score',          header: 'Score YoY'     },
      { key: 'nivel',              header: 'Nivel'         },
      { key: 'last_mes',           header: 'Últ. mes'      },
      { key: 'diversidad_productos', header: 'Productos'   },
      { key: 'anos_activos',       header: 'Antigüedad'    },
    ], `RiesgoCliente_${data?.ano || ''}`)

  // Scatter data — log scale for ventas_cur so it's readable
  const scatterData = rows.map((r) => ({
    ...r,
    x: r.risk_score,
    y: Math.log10(Math.max(r.ventas_cur, 1)),
  }))

  // Pie data
  const pieData = [
    { name: 'Alto',  value: resumen.Alto  || 0, fill: '#ef4444' },
    { name: 'Medio', value: resumen.Medio || 0, fill: '#f59e0b' },
    { name: 'Bajo',  value: resumen.Bajo  || 0, fill: '#22c55e' },
  ].filter((d) => d.value > 0)

  const total = (resumen.Alto || 0) + (resumen.Medio || 0) + (resumen.Bajo || 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Riesgo Unificado de Clientes</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Score combinado: churn 40 % · caída YoY 35 % · importancia CLV 25 %
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs">
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>Top {n}</option>)}
          </select>
          {sorted.length > 0 && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors">
              <Download size={12} /> Excel ({fmtInt(sorted.length)})
            </button>
          )}
        </div>
      </div>

      {/* KPI + pie */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {(['Alto', 'Medio', 'Bajo']).map((nivel) => {
            const cfg = NIVEL_CFG[nivel]
            const Icon = cfg.icon
            const cnt = resumen[nivel] || 0
            return (
              <button key={nivel} onClick={() => setNivelFilter(nivelFilter === nivel ? 'all' : nivel)}
                className={`rounded-xl p-4 border text-left transition-all ${
                  nivelFilter === nivel || nivelFilter === 'all'
                    ? `${cfg.bg} ${cfg.border}`
                    : 'bg-surface-800 border-surface-700 opacity-50'
                }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={15} className={cfg.text} />
                  <span className={`text-xs font-semibold ${cfg.text}`}>Riesgo {nivel}</span>
                </div>
                <p className="text-2xl font-bold text-slate-100">{fmtInt(cnt)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {total > 0 ? ((cnt / total) * 100).toFixed(1) : 0}% del total
                </p>
              </button>
            )
          })}

          {/* Donut */}
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 mb-2">Distribución</p>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" innerRadius="55%" outerRadius="80%"
                    paddingAngle={2} strokeWidth={0}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.85} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} clientes`]} contentStyle={{
                    background: '#161b27', border: '1px solid #1f2937', borderRadius: 8, fontSize: 11,
                  }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-around mt-1">
              {pieData.map((d) => (
                <div key={d.name} className="text-center">
                  <div className="w-2 h-2 rounded-full mx-auto mb-0.5" style={{ background: d.fill }} />
                  <p className="text-[9px] text-slate-500">{d.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scatter */}
      {rows.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-0.5">Score de riesgo vs ventas actuales</p>
          <p className="text-[10px] text-slate-500 mb-4">
            Eje X = score riesgo (100 = máximo) · Eje Y = ventas en escala logarítmica ·
            <span className="text-red-400 ml-1">●</span> Alto ·
            <span className="text-amber-400 ml-1">●</span> Medio ·
            <span className="text-emerald-400 ml-1">●</span> Bajo
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" dataKey="x" name="Score" domain={[0, 100]}
                  tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                  label={{ value: 'Score de riesgo', position: 'insideBottom', offset: -2, fill: '#475569', fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Ventas (log)"
                  tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => fmtCOP(Math.pow(10, v))} width={64} />
                <Tooltip content={<ScatterTip />} cursor={{ stroke: '#334155', strokeDasharray: '4 4' }} />
                <Scatter data={scatterData} isAnimationActive={false}>
                  {scatterData.map((d, i) => (
                    <Cell key={i} fill={NIVEL_CFG[d.nivel]?.color || '#94a3b8'} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-medium text-slate-300">{fmtInt(sorted.length)} clientes · ordenados por score</p>
          <div className="flex gap-1">
            {[['all', 'Todos'], ['Alto', 'Alto'], ['Medio', 'Medio'], ['Bajo', 'Bajo']].map(([k, l]) => (
              <button key={k} onClick={() => setNivelFilter(k)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  nivelFilter === k
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface-700 text-slate-400 hover:text-slate-100'
                }`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-700 text-slate-400">
                <th className="text-left px-4 py-3">#</th>
                {COLS.map((c) => (
                  <th key={c.key}
                    className="px-4 py-3 cursor-pointer hover:text-slate-200 transition-colors whitespace-nowrap select-none"
                    style={{ textAlign: c.key === 'nombre_cliente' ? 'left' : 'right' }}
                    onClick={() => handleSort(c.key)}>
                    {c.label}<SortIcon col={c.key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
                <th className="text-center px-4 py-3">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map((r, i) => {
                const cfg = NIVEL_CFG[r.nivel] || NIVEL_CFG.Bajo
                return (
                  <tr key={r.numero_cliente} className="border-b border-surface-700/40 hover:bg-surface-700/20 transition-colors">
                    <td className="px-4 py-2.5 text-slate-600 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: cfg.color }}>
                      {r.risk_score?.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-200 truncate max-w-[180px]" title={r.nombre_cliente}>
                        {r.nombre_cliente}
                      </div>
                      <div className="text-slate-500 font-mono text-[10px]">{r.numero_cliente}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{fmtCOP(r.ventas_cur)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.variacion_yoy != null ? (
                        <span className={r.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {r.variacion_yoy >= 0 ? '+' : ''}{r.variacion_yoy?.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                      {r.last_mes > 0 ? `M${r.last_mes}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{r.diversidad_productos}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                      {r.anos_activos > 0 ? `${r.anos_activos} año${r.anos_activos !== 1 ? 's' : ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                        {r.nivel}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-600">
                    {loading ? 'Cargando…' : 'Sin datos para los filtros seleccionados'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
