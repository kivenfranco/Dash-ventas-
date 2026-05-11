import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { TrendingUp, TrendingDown, Activity } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
  LineChart, Line, Legend,
} from 'recharts'

const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const fmt = (v) => {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}MM`
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`
  return `$${a.toFixed(0)}`
}

const fmtCompact = (v) => {
  if (v == null || isNaN(v) || v === 0) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(a / 1e9).toFixed(1)}MM`
  if (a >= 1e6) return `${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(a / 1e3).toFixed(0)}K`
  return `${a.toFixed(0)}`
}

function lerpColor(fromHex, toHex, t) {
  const parse = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const [r1, g1, b1] = parse(fromHex)
  const [r2, g2, b2] = parse(toHex)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r},${g},${b})`
}

const YEAR_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a78bfa', '#f97316', '#06b6d4', '#ec4899']

function IndexBarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  const color = v > 1.1 ? '#22c55e' : v < 0.9 ? '#f59e0b' : '#3b82f6'
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <p className="font-semibold text-slate-200 mb-1">{label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-slate-400">Índice</span>
        <span className="font-bold" style={{ color }}>{v?.toFixed(2)}</span>
      </div>
      <div className="mt-1 text-slate-500 text-[10px]">
        {v > 1.1 ? 'Por encima del promedio' : v < 0.9 ? 'Por debajo del promedio' : 'Cerca del promedio'}
      </div>
    </div>
  )
}

function TrendLineTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2.5 text-xs shadow-2xl min-w-36">
      <p className="font-semibold text-slate-300 mb-2">{MN[(label ?? 1) - 1] || label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="font-medium text-slate-200">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function EstacionalidadView() {
  const { refreshKey }        = useOutletContext()
  const { filters }           = useFilters()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [anosVis, setAnosVis] = useState([])

  useEffect(() => {
    setLoading(true)
    setError('')
    api.estacionalidad(filters)
      .then((d) => { setData(d); setAnosVis([]) })
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar estacionalidad'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.mes, filters.mes_fin, refreshKey])

  const anos       = data?.anos || []
  const series     = data?.series || []
  const resumenMes = data?.resumen_mes || []
  const indices    = data?.indices_estacionalidad || []
  const mejorMes   = data?.mejor_mes
  const peorMes    = data?.peor_mes

  const visibleAnos = useMemo(
    () => anosVis.length === 0 ? anos : anos.filter((a) => anosVis.includes(a)),
    [anosVis, anos]
  )

  const toggleAno = (ano) =>
    setAnosVis((prev) =>
      prev.includes(ano) ? prev.filter((a) => a !== ano) : [...prev, ano]
    )

  const heatmapMap = useMemo(() => {
    const m = {}
    for (const row of series) {
      if (!m[row.ano]) m[row.ano] = {}
      m[row.ano][row.mes] = row.ventas
    }
    return m
  }, [series])

  const heatmapMax = useMemo(() => {
    let max = 0
    for (const row of series) {
      if ((anosVis.length === 0 || anosVis.includes(row.ano)) && row.ventas > max) max = row.ventas
    }
    return max || 1
  }, [series, anosVis])

  const indexData = useMemo(
    () => indices.map((r) => ({ mes: r.label, indice: r.indice })),
    [indices]
  )

  const trendData = useMemo(() => {
    const byMes = {}
    for (const row of series) {
      if (anosVis.length > 0 && !anosVis.includes(row.ano)) continue
      if (!byMes[row.mes]) byMes[row.mes] = { mes: row.mes, label: MN[row.mes - 1] }
      byMes[row.mes][String(row.ano)] = row.ventas
    }
    return Object.values(byMes).sort((a, b) => a.mes - b.mes)
  }, [series, anosVis])

  const amplitud = useMemo(() => {
    if (!indices.length) return null
    const vals = indices.map((r) => r.indice).filter(Boolean)
    const mn = Math.min(...vals)
    const mx = Math.max(...vals)
    return mn > 0 ? mx / mn : null
  }, [indices])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Análisis de Estacionalidad</h1>
        <p className="text-xs text-slate-400 mt-0.5">Patrones de venta por mes a través de los años</p>
      </div>

      {/* Year selector */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-500">Años:</span>
        <button
          onClick={() => setAnosVis([])}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            anosVis.length === 0
              ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
              : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
          }`}
        >Todos</button>
        {anos.map((ano, i) => (
          <button
            key={ano}
            onClick={() => toggleAno(ano)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
              anosVis.includes(ano) ? 'border-transparent' : 'border-surface-700 text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
            style={anosVis.includes(ano) ? {
              background: YEAR_COLORS[i % YEAR_COLORS.length] + '33',
              color: YEAR_COLORS[i % YEAR_COLORS.length],
              borderColor: YEAR_COLORS[i % YEAR_COLORS.length] + '66',
            } : {}}
          >{ano}</button>
        ))}
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {/* KPI strip */}
      {!loading && data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <TrendingUp size={18} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Mejor mes</p>
              <p className="text-lg font-bold text-slate-100">{mejorMes?.label ?? '—'}</p>
              <p className="text-xs text-emerald-400">{fmt(mejorMes?.promedio)} prom.</p>
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <TrendingDown size={18} className="text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Peor mes</p>
              <p className="text-lg font-bold text-slate-100">{peorMes?.label ?? '—'}</p>
              <p className="text-xs text-amber-400">{fmt(peorMes?.promedio)} prom.</p>
            </div>
          </div>
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-brand-600/10">
              <Activity size={18} className="text-brand-400" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Amplitud estacional</p>
              <p className="text-lg font-bold text-slate-100">
                {amplitud != null ? `${amplitud.toFixed(1)}×` : '—'}
              </p>
              <p className="text-xs text-slate-500">índice máx / mín</p>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap */}
      {!loading && data && visibleAnos.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 overflow-x-auto">
          <p className="text-xs font-medium text-slate-300 mb-3">Mapa de calor — ventas por año y mes</p>
          <table className="w-full text-xs border-separate border-spacing-1 min-w-[640px]">
            <thead>
              <tr>
                <th className="text-left text-slate-500 pr-2 py-1 font-normal w-14">Año</th>
                {MN.map((m, i) => (
                  <th key={i} className="text-center text-slate-400 py-1 font-medium w-16">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleAnos.map((ano) => (
                <tr key={ano}>
                  <td className="text-slate-400 pr-2 font-mono font-semibold text-xs">{ano}</td>
                  {Array.from({ length: 12 }, (_, mi) => {
                    const mes = mi + 1
                    const val = heatmapMap[ano]?.[mes]
                    const t   = val ? Math.min(1, val / heatmapMax) : 0
                    const bg  = val ? lerpColor('#1e293b', '#2563eb', t * 0.85 + 0.08) : '#1e293b'
                    const tc  = t > 0.55 ? '#f1f5f9' : t > 0.2 ? '#cbd5e1' : '#475569'
                    return (
                      <td key={mes} title={val ? `${ano} ${MN[mi]}: ${fmt(val)}` : `${ano} ${MN[mi]}: sin datos`}
                        style={{ background: bg, color: tc }}
                        className="rounded-md text-center py-2 cursor-default transition-opacity hover:opacity-80">
                        {fmtCompact(val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {resumenMes.length > 0 && (
                <tr>
                  <td className="text-slate-500 pr-2 font-normal text-[10px] pt-1">Prom.</td>
                  {resumenMes.map((rm) => {
                    const t  = Math.min(1, (rm.promedio || 0) / heatmapMax)
                    const bg = rm.promedio ? lerpColor('#1e293b', '#7c3aed', t * 0.7 + 0.05) : '#1e293b'
                    const tc = t > 0.5 ? '#f1f5f9' : '#94a3b8'
                    return (
                      <td key={rm.mes} title={`Promedio ${rm.label}: ${fmt(rm.promedio)}`}
                        style={{ background: bg, color: tc }}
                        className="rounded-md text-center py-1.5 cursor-default text-[10px]">
                        {fmtCompact(rm.promedio)}
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-600 mt-2">
            Intensidad de color proporcional al volumen · última fila = promedio histórico por mes
          </p>
        </div>
      )}

      {/* Seasonality index */}
      {!loading && indexData.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-0.5">
            Índice de Estacionalidad (1.0 = promedio)
          </p>
          <p className="text-[10px] text-slate-500 mb-4">
            <span className="text-emerald-400">■</span> &gt;1.1 por encima ·
            <span className="text-blue-400 ml-1">■</span> 0.9–1.1 promedio ·
            <span className="text-amber-400 ml-1">■</span> &lt;0.9 por debajo
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={indexData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="mes" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 'auto']} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<IndexBarTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5}
                  label={{ value: '1.0', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                <Bar dataKey="indice" radius={[4, 4, 0, 0]} maxBarSize={36}
                  label={{ position: 'top', fill: '#94a3b8', fontSize: 10, formatter: (v) => v?.toFixed(2) }}>
                  {indexData.map((d, i) => (
                    <Cell key={i}
                      fill={d.indice > 1.1 ? '#22c55e' : d.indice < 0.9 ? '#f59e0b' : '#3b82f6'}
                      fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Multi-year trend lines */}
      {!loading && trendData.length > 0 && visibleAnos.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-300 mb-1">Tendencia mensual por año</p>
          <p className="text-[10px] text-slate-500 mb-3">
            Comparativa del patrón estacional entre {visibleAnos.join(', ')}
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => fmtCompact(v)} width={48} />
                <Tooltip content={<TrendLineTip />} cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 8 }} />
                {visibleAnos.map((ano, i) => (
                  <Line key={ano} type="monotone" dataKey={String(ano)}
                    stroke={YEAR_COLORS[anos.indexOf(ano) % YEAR_COLORS.length]}
                    strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Summary table */}
      {!loading && resumenMes.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-700">
            <p className="text-xs font-medium text-slate-300">Resumen por mes</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Mes</th>
                  <th className="text-right px-4 py-3">Promedio</th>
                  <th className="text-right px-4 py-3">Máximo</th>
                  <th className="text-right px-4 py-3">Mínimo</th>
                  <th className="text-right px-4 py-3">Índice</th>
                  <th className="text-center px-4 py-3">Mejor año</th>
                </tr>
              </thead>
              <tbody>
                {resumenMes.map((rm) => {
                  const idx    = indices.find((r) => r.mes === rm.mes)
                  const indice = idx?.indice
                  const idxColor = indice > 1.1 ? 'text-emerald-400' : indice < 0.9 ? 'text-amber-400' : 'text-blue-400'
                  return (
                    <tr key={rm.mes} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-slate-200">{rm.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-300">{fmt(rm.promedio)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-400">{fmt(rm.max)}</td>
                      <td className="px-4 py-2.5 text-right text-red-400">{fmt(rm.min)}</td>
                      <td className={`px-4 py-2.5 text-right font-bold ${idxColor}`}>
                        {indice != null ? indice.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{rm.mejor_ano ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
