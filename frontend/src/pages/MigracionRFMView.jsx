import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Users, UserPlus, RefreshCw, UserMinus, TrendingUp, TrendingDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LabelList, Sankey
} from 'recharts'

const SEG_COLOR = {
  'Campeón':            '#22c55e',
  'Cliente Leal':       '#3b82f6',
  'Potencial Leal':     '#06b6d4',
  'Cliente Reciente':   '#a78bfa',
  'En Riesgo':          '#f59e0b',
  'Necesita Atención':  '#f97316',
  'Hibernando':         '#6b7280',
  'Perdido':            '#ef4444',
  'Nuevo':              '#10b981',
  'Perdido (Inactivo)': '#dc2626',
}

const SEGMENTS_PREV = [
  'Campeón', 'Cliente Leal', 'Potencial Leal', 'Cliente Reciente',
  'En Riesgo', 'Necesita Atención', 'Hibernando', 'Perdido', 'Nuevo',
]
const SEGMENTS_ACTUAL = [
  'Campeón', 'Cliente Leal', 'Potencial Leal', 'Cliente Reciente',
  'En Riesgo', 'Necesita Atención', 'Hibernando', 'Perdido', 'Perdido (Inactivo)',
]

const fmt = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}MM`
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`
  return `$${a.toFixed(0)}`
}

const SEG_RANK = Object.fromEntries(SEGMENTS_PREV.map((s, i) => [s, i]))

function segDirection(prev, actual) {
  const rp = SEG_RANK[prev] ?? 99
  const ra = SEG_RANK[actual] ?? 99
  if (actual === 'Perdido (Inactivo)') return 'down'
  if (ra < rp) return 'up'
  if (ra > rp) return 'down'
  return 'same'
}

function NetMoveTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-44">
      <p className="font-semibold mb-2" style={{ color: SEG_COLOR[label] || '#94a3b8' }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.fill }}>{p.name}</span>
          <span className="font-bold text-slate-100">{Math.abs(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function MigracionRFMView() {
  const { refreshKey }        = useOutletContext()
  const { filters }           = useFilters()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.rfmMigracion(filters)
      .then((d) => setData(d))
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar migración RFM'))
      .finally(() => setLoading(false))
  }, [filters, refreshKey])

  const ano       = data?.ano
  const anoPrev   = data?.ano_prev
  const matriz    = data?.matriz || []
  const resumen   = data?.resumen || {}
  const topCaidas  = data?.top_caidas  || []
  const topMejoras = data?.top_mejoras || []

  const matrixMap = useMemo(() => {
    const m = {}
    for (const row of matriz) {
      if (!m[row.segmento_prev]) m[row.segmento_prev] = {}
      m[row.segmento_prev][row.segmento_actual] = row
    }
    return m
  }, [matriz])

  const rowTotals = useMemo(() => {
    const t = {}
    for (const row of matriz) t[row.segmento_prev] = (t[row.segmento_prev] || 0) + row.clientes
    return t
  }, [matriz])

  const colTotals = useMemo(() => {
    const t = {}
    for (const row of matriz) t[row.segmento_actual] = (t[row.segmento_actual] || 0) + row.clientes
    return t
  }, [matriz])

  const matrixMax = useMemo(() => Math.max(1, ...matriz.map((r) => r.clientes)), [matriz])

  const netMoveData = useMemo(() => {
    const gained = {}
    const lost   = {}
    for (const row of matriz) {
      const { segmento_prev: prev, segmento_actual: actual, clientes } = row
      if (prev !== actual) {
        lost[prev]     = (lost[prev]   || 0) + clientes
        gained[actual] = (gained[actual] || 0) + clientes
      }
    }
    return SEGMENTS_PREV
      .map((seg) => ({
        seg,
        ganados:  gained[seg] || 0,
        perdidos: -(lost[seg] || 0),
      }))
      .filter((d) => d.ganados !== 0 || d.perdidos !== 0)
  }, [matriz])

  const sankeyData = useMemo(() => {
    if (!matriz || matriz.length === 0) return null
    const nodes = []
    const links = []
    const nodeMap = {}

    SEGMENTS_PREV.forEach(s => {
      const name = `${s} (Ant)`
      nodes.push({ name, fill: SEG_COLOR[s] || '#94a3b8' })
      nodeMap[name] = nodes.length - 1
    })
    
    SEGMENTS_ACTUAL.forEach(s => {
      const name = `${s} (Act)`
      nodes.push({ name, fill: SEG_COLOR[s] || '#94a3b8' })
      nodeMap[name] = nodes.length - 1
    })

    matriz.forEach(row => {
      if (row.clientes > 0) {
        const sKey = `${row.segmento_prev} (Ant)`
        const tKey = `${row.segmento_actual} (Act)`
        if (nodeMap[sKey] !== undefined && nodeMap[tKey] !== undefined) {
          links.push({
            source: nodeMap[sKey],
            target: nodeMap[tKey],
            value: row.clientes
          })
        }
      }
    })

    return { nodes, links }
  }, [matriz])

  const cellBg = (prev, actual, clientes) => {
    if (!clientes) return 'transparent'
    const dir = segDirection(prev, actual)
    const intensity = Math.min(0.7, 0.1 + 0.6 * (clientes / matrixMax))
    if (dir === 'same') return `rgba(148,163,184,${intensity})`
    if (dir === 'up')   return `rgba(34,197,94,${intensity})`
    return `rgba(239,68,68,${intensity})`
  }

  const cellText = (prev, actual, clientes) => {
    if (!clientes) return '#334155'
    const dir = segDirection(prev, actual)
    const t = clientes / matrixMax
    if (dir === 'same') return t > 0.4 ? '#f1f5f9' : '#94a3b8'
    if (dir === 'up')   return t > 0.4 ? '#f1f5f9' : '#86efac'
    return t > 0.4 ? '#f1f5f9' : '#fca5a5'
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Migración de Segmentos RFM</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Movimiento de clientes entre segmentos{ano && anoPrev ? `: ${anoPrev} → ${ano}` : ''}
        </p>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {/* KPI strip */}
      {!loading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-slate-700/50"><Users size={16} className="text-slate-300" /></div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Total clientes</p>
              <p className="text-xl font-bold text-slate-100">{resumen.total_clientes_cur ?? '—'}</p>
              {resumen.total_clientes_prev != null && (
                <p className="text-[10px] text-slate-500">vs {resumen.total_clientes_prev} anterior</p>
              )}
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><UserPlus size={16} className="text-emerald-400" /></div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Nuevos</p>
              <p className="text-xl font-bold text-emerald-300">{resumen.nuevos ?? '—'}</p>
              <p className="text-[10px] text-slate-500">primera compra</p>
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><RefreshCw size={16} className="text-blue-400" /></div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Recuperados</p>
              <p className="text-xl font-bold text-blue-300">{resumen.recuperados ?? '—'}</p>
              <p className="text-[10px] text-slate-500">volvieron a comprar</p>
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-500/10"><UserMinus size={16} className="text-red-400" /></div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">Perdidos</p>
              <p className="text-xl font-bold text-red-300">{resumen.perdidos ?? '—'}</p>
              <p className="text-[10px] text-slate-500">inactivos este año</p>
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <p className="text-[10px] text-slate-500 mb-2">Movimiento neto</p>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={13} className="text-emerald-400 shrink-0" />
              <span className="text-[10px] text-slate-400">Mejoraron</span>
              <span className="ml-auto text-sm font-bold text-emerald-300">{resumen.mejoraron ?? '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingDown size={13} className="text-rose-400 shrink-0" />
              <span className="text-[10px] text-slate-400">Empeoraron</span>
              <span className="ml-auto text-sm font-bold text-rose-300">{resumen.empeoraron ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Migration matrix */}
      {!loading && data && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 overflow-x-auto">
          <p className="text-xs font-medium text-slate-300 mb-1">Matriz de migración</p>
          <p className="text-[10px] text-slate-500 mb-3">
            Filas = segmento anterior ({anoPrev}) · Columnas = segmento actual ({ano}) ·
            <span className="text-emerald-400 ml-1">verde</span> mejora ·
            <span className="text-red-400 ml-1">rojo</span> caída · diagonal = sin cambio
          </p>
          <div style={{ minWidth: 760 }}>
            <table className="w-full text-[10px] border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 font-normal px-2 py-1 text-[10px] w-36">
                    {anoPrev} → {ano}
                  </th>
                  {SEGMENTS_ACTUAL.map((seg) => (
                    <th key={seg} className="text-center py-1 px-1 font-medium text-[10px] w-20"
                      style={{ color: SEG_COLOR[seg] || '#94a3b8' }}>
                      <span className="block truncate max-w-[72px] mx-auto" title={seg}>
                        {seg.replace(' (Inactivo)', '')}
                      </span>
                    </th>
                  ))}
                  <th className="text-center text-slate-500 font-normal px-2 py-1 text-[10px]">Total</th>
                </tr>
              </thead>
              <tbody>
                {SEGMENTS_PREV.map((prev) => (
                  <tr key={prev}>
                    <td className="px-2 py-1 font-medium text-[10px] text-right"
                      style={{ color: SEG_COLOR[prev] || '#94a3b8' }}>
                      <span className="truncate block max-w-[128px]" title={prev}>{prev}</span>
                    </td>
                    {SEGMENTS_ACTUAL.map((actual) => {
                      const cell  = matrixMap[prev]?.[actual]
                      const count  = cell?.clientes || 0
                      const ventas = cell?.ventas_cur
                      return (
                        <td key={actual}
                          title={count > 0
                            ? `${prev} → ${actual}: ${count} clientes${ventas ? ` · ${fmt(ventas)}` : ''}`
                            : undefined}
                          style={{ background: cellBg(prev, actual, count), color: cellText(prev, actual, count) }}
                          className="text-center rounded py-1.5 cursor-default font-mono">
                          {count > 0 ? count : ''}
                        </td>
                      )
                    })}
                    <td className="text-center text-slate-400 font-mono px-2 py-1 text-[10px]">
                      {rowTotals[prev] || 0}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-2 py-1 text-slate-500 text-right text-[10px]">Total</td>
                  {SEGMENTS_ACTUAL.map((seg) => (
                    <td key={seg} className="text-center text-slate-400 font-mono py-1 text-[10px]">
                      {colTotals[seg] || 0}
                    </td>
                  ))}
                  <td className="text-center text-slate-300 font-mono font-bold px-2 py-1 text-[10px]">
                    {Object.values(colTotals).reduce((a, b) => a + b, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sankey Diagram */}
      {!loading && sankeyData && sankeyData.links.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5 overflow-x-auto">
          <p className="text-xs font-medium text-slate-300 mb-1">Diagrama de Flujos (Sankey)</p>
          <p className="text-[10px] text-slate-500 mb-3">
            Visualización de cómo los clientes han migrado entre el período anterior y el actual.
          </p>
          <div className="h-[400px] min-w-[700px]">
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={sankeyData}
                node={{ stroke: '#1e293b', strokeWidth: 1 }}
                nodePadding={30}
                margin={{ left: 10, right: 10, top: 10, bottom: 10 }}
                link={{ stroke: '#334155', fillOpacity: 0.3 }}
              >
                <Tooltip 
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-xs shadow-xl">
                        {d.source && d.target ? (
                          <p className="text-slate-200">
                            <span className="font-semibold text-slate-400">{d.source.name}</span> →{' '}
                            <span className="font-semibold text-slate-400">{d.target.name}</span>
                            <br/><span className="text-brand-300 font-bold">{d.value}</span> clientes
                          </p>
                        ) : (
                          <p className="text-slate-200 font-semibold">{d.name} <span className="text-brand-300">{d.value}</span></p>
                        )}
                      </div>
                    )
                  }}
                />
              </Sankey>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Net movement chart */}
      {!loading && netMoveData.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-0.5">Movimiento neto por segmento</p>
          <p className="text-[10px] text-slate-500 mb-3">
            <span className="text-emerald-400">■</span> clientes ganados ·
            <span className="text-red-400 ml-1">■</span> clientes cedidos a otros segmentos
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={netMoveData} layout="vertical"
                margin={{ top: 4, right: 48, left: 8, bottom: 4 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="seg"
                  tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
                <Tooltip content={<NetMoveTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <ReferenceLine x={0} stroke="#334155" strokeWidth={1} />
                <Bar dataKey="ganados" name="Ganados" fill="#22c55e" fillOpacity={0.75}
                  radius={[0, 4, 4, 0]} maxBarSize={14}>
                  <LabelList dataKey="ganados" position="right" style={{ fill: '#86efac', fontSize: 10 }}
                    formatter={(v) => v > 0 ? `+${v}` : ''} />
                </Bar>
                <Bar dataKey="perdidos" name="Cedidos" fill="#ef4444" fillOpacity={0.75}
                  radius={[0, 4, 4, 0]} maxBarSize={14}>
                  <LabelList dataKey="perdidos" position="right" style={{ fill: '#fca5a5', fontSize: 10 }}
                    formatter={(v) => v < 0 ? v : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top caídas & mejoras */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClientTable title="Top 10 caídas de segmento" icon={<TrendingDown size={14} className="text-red-400" />} rows={topCaidas} />
        <ClientTable title="Top 10 mejoras de segmento" icon={<TrendingUp size={14} className="text-emerald-400" />} rows={topMejoras} />
      </div>
    </div>
  )
}

function ClientTable({ title, icon, rows }) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-700 flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium text-slate-300">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-700 text-slate-500">
              <th className="text-left px-4 py-2.5">Cliente</th>
              <th className="text-center px-3 py-2.5">Movimiento</th>
              <th className="text-right px-4 py-2.5">Venta actual</th>
              <th className="text-right px-4 py-2.5">Variación</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r, i) => {
              const vari = r.ventas_prev > 0
                ? ((r.ventas_cur - r.ventas_prev) / r.ventas_prev) * 100
                : null
              return (
                <tr key={i} className="border-b border-surface-700/40 hover:bg-surface-700/30 transition-colors">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-200 truncate max-w-[140px]" title={r.nombre_cliente}>
                      {r.nombre_cliente}
                    </div>
                    <div className="text-slate-500 font-mono text-[10px]">{r.numero_cliente}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span className="text-[10px] font-medium" style={{ color: SEG_COLOR[r.segmento_prev] || '#94a3b8' }}>
                        {r.segmento_prev}
                      </span>
                      <span className="text-slate-600">→</span>
                      <span className="text-[10px] font-medium" style={{ color: SEG_COLOR[r.segmento_actual] || '#94a3b8' }}>
                        {r.segmento_actual}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_cur)}</td>
                  <td className="px-4 py-2 text-right">
                    {vari != null ? (
                      <span className={vari >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {vari >= 0 ? '+' : ''}{vari.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">Sin datos</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
