import { useState, useCallback, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtInt, fmtPct, pctColor, MONTH_NAMES, formatPeriod } from '../utils/format'
import { Trash2, Plus, Save } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, BarChart, Legend,
} from 'recharts'

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6']
const C_METROS = '#06b6d4'
const C_VENTAS = '#000F9F'

function fmtM(v) {
  if (v == null || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}Mm`
  if (a >= 1e3) return `${(a / 1e3).toFixed(1)}km`
  return `${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })} m`
}

function KPI({ label, value, sub, color = 'text-brand-300' }) {
  return (
    <div className="card flex flex-col gap-1">
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function TTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-52">
      <p className="text-slate-200 font-semibold mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>
            {p.dataKey === 'metros' ? fmtM(p.value) : fmtCOP(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function TTipProd({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs min-w-48">
      <p className="text-slate-200 font-semibold mb-1 max-w-44 truncate">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 py-0.5">
          <span className="text-slate-400">{p.name}</span>
          <span className="font-medium text-cyan-400">{fmtM(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function ComercializacionView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [tab, setTab]  = useState('resumen')

  const fetcher = useCallback(
    () => api.comercializacion({ ano: filters.ano, mes: filters.mes, mes_fin: filters.mes_fin }),
    [filters.ano, filters.mes, filters.mes_fin, refreshKey]
  )
  const pronFetcher = useCallback(
    () => api.comercializacionPronostico(8),
    [refreshKey]
  )

  const { data, loading, error } = useData(fetcher, [filters.ano, filters.mes, filters.mes_fin, refreshKey])
  const { data: pron }           = useData(pronFetcher, [refreshKey])

  // Factores personalizados por producto
  const [factores, setFactores]   = useState({})
  const [savingFactor, setSaving] = useState(false)
  const [newFactor, setNewFactor] = useState({ codigo_producto: '', descripcion: '', uom: '', factor: '' })

  const loadFactores = useCallback(async () => {
    try { const r = await api.factoresCom(); setFactores(r.factores || {}) } catch (_) {}
  }, [])

  useEffect(() => { loadFactores() }, [loadFactores])

  const handleSaveFactor = async () => {
    if (!newFactor.codigo_producto || !newFactor.factor) return
    setSaving(true)
    try {
      await api.factoresComSave({ ...newFactor, factor: parseFloat(newFactor.factor) })
      setNewFactor({ codigo_producto: '', descripcion: '', uom: '', factor: '' })
      await loadFactores()
    } catch (e) { alert(e.response?.data?.detail || e.message) }
    finally { setSaving(false) }
  }

  const handleDeleteFactor = async (codigo) => {
    if (!confirm(`¿Eliminar factor para ${codigo}?`)) return
    await api.factoresComDelete(codigo)
    await loadFactores()
  }

  const kpis      = data?.kpis      || {}
  const mensual   = data?.mensual   || []
  const productos = data?.por_producto || []
  const uoms      = data?.por_uom   || []

  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  // Chart: mensual metros + ventas
  const chartMensual = mensual.map((m) => ({
    name:        MONTH_NAMES[m.mes],
    metros:      m.metros,
    ventas_netas: m.ventas_netas,
  }))

  // Chart: top 10 productos por metros
  const topProd = productos
    .filter((p) => p.metros > 0)
    .slice(0, 10)
    .map((p) => ({
      name:   p.producto?.length > 24 ? p.producto.slice(0, 24) + '…' : (p.producto || '—'),
      metros: p.metros,
    }))

  // Pronóstico chart: histórico últimos 12 + forecast
  const histLast = (pron?.historico || []).slice(-12).map((m) => ({
    name:   MONTH_NAMES[m.mes],
    metros: m.metros,
    ventas_netas: m.ventas_netas,
    tipo:   'historico',
  }))
  const pronData = (pron?.pronostico || []).map((m) => ({
    name:   MONTH_NAMES[m.mes],
    metros_pron: m.metros,
    ventas_pron: m.ventas_netas,
    tipo:   'pronostico',
  }))
  const chartPron = [...histLast, ...pronData]

  const TABS = [
    { id: 'resumen',    label: 'Resumen' },
    { id: 'productos',  label: 'Por Producto' },
    { id: 'uom',        label: 'Por Unidad de Medida' },
    { id: 'pronostico', label: 'Pronóstico' },
    { id: 'factores',   label: `Factores (${Object.keys(factores).length})` },
  ]

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Análisis de Comercialización</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Cantidades estandarizadas en metros · Línea Comercialización · {period}
        </p>
      </div>

      {error && <div className="card border border-red-500/30 text-red-400 text-sm">{error}</div>}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI
          label="Total Metros Vendidos"
          value={loading ? '…' : fmtM(kpis.metros_totales)}
          sub="unidades convertidas a metro"
          color="text-cyan-400"
        />
        <KPI
          label="Ingresos Totales"
          value={loading ? '…' : fmtCOP(kpis.ventas_totales)}
          sub="ventas netas COP"
        />
        <KPI
          label="Precio Prom. / Metro"
          value={loading ? '…' : fmtCOP(kpis.precio_por_metro)}
          sub="ingreso por metro lineal"
          color="text-amber-400"
        />
        <KPI
          label="Ventas Convertidas"
          value={loading ? '…' : fmtPct(kpis.pct_ventas_convertidas, 1)}
          sub="% con factor de conversión conocido"
          color={kpis.pct_ventas_convertidas >= 80 ? 'text-emerald-400' : 'text-orange-400'}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-700">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px ${
              tab === t.id
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* RESUMEN */}
      {tab === 'resumen' && (
        <div className="flex flex-col gap-5">
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-4">Metros y Ventas por Mes</h2>
            <div className={`h-64 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartMensual} margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="m" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtM} width={70} />
                  <YAxis yAxisId="v" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} width={80} />
                  <Tooltip content={<TTip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
                  <Bar yAxisId="m" dataKey="metros" name="Metros" fill={C_METROS} fillOpacity={0.85} radius={[3, 3, 0, 0]} barSize={22} />
                  <Line yAxisId="v" dataKey="ventas_netas" name="Ventas ($)" stroke={C_VENTAS} strokeWidth={2} dot={{ r: 3, fill: C_VENTAS }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-4">Top 10 Productos por Metros</h2>
            <div className={`h-64 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProd} layout="vertical" margin={{ top: 2, right: 16, left: 4, bottom: 2 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtM} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={175} />
                  <Tooltip content={<TTipProd />} />
                  <Bar dataKey="metros" name="Metros" fill={C_METROS} radius={[0, 3, 3, 0]} barSize={13}>
                    {topProd.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* POR PRODUCTO */}
      {tab === 'productos' && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Detalle por Producto</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Producto</th>
                <th className="pb-2 font-medium text-center">UOM</th>
                <th className="pb-2 font-medium text-center">Factor</th>
                <th className="pb-2 font-medium text-right">Cantidad orig.</th>
                <th className="pb-2 font-medium text-right">Metros</th>
                <th className="pb-2 font-medium text-right">Ventas Netas</th>
                <th className="pb-2 font-medium text-right">$/metro</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p, i) => (
                <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                  <td className="py-2 text-slate-500">{i + 1}</td>
                  <td className="py-2 font-medium text-slate-100 max-w-xs">
                    <span className="truncate block max-w-[260px]">{p.producto || '—'}</span>
                  </td>
                  <td className="py-2 text-center">
                    <span className="px-2 py-0.5 rounded-md bg-surface-700 text-slate-300 font-mono text-[11px]">{p.uom}</span>
                  </td>
                  <td className="py-2 text-center">
                    {p.factor != null
                      ? <span className="text-cyan-400 font-semibold">× {p.factor}</span>
                      : <span className="text-amber-500 text-[11px]">pendiente</span>}
                  </td>
                  <td className="py-2 text-right text-slate-400">{fmtInt(p.cantidad)}</td>
                  <td className="py-2 text-right font-semibold text-cyan-400">{p.metros > 0 ? fmtM(p.metros) : '—'}</td>
                  <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(p.ventas_netas)}</td>
                  <td className="py-2 text-right text-amber-400">{p.precio_por_metro != null ? fmtCOP(p.precio_por_metro) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* POR UOM */}
      {tab === 'uom' && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-200 mb-1">Unidades de Medida detectadas</h2>
          <p className="text-xs text-slate-500 mb-4">
            UOM con factor "pendiente" (TB, KG, UND) requieren factor por producto para convertir a metros.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-surface-700 text-slate-400">
                <th className="pb-2 font-medium">Código UOM</th>
                <th className="pb-2 font-medium">Factor a metros</th>
                <th className="pb-2 font-medium text-right">Cantidad original</th>
                <th className="pb-2 font-medium text-right">Metros</th>
                <th className="pb-2 font-medium text-right">Ventas Netas</th>
                <th className="pb-2 font-medium text-right">$/metro</th>
              </tr>
            </thead>
            <tbody>
              {uoms.map((u, i) => (
                <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                  <td className="py-2">
                    <span className="px-2 py-0.5 rounded-md bg-surface-700 text-slate-200 font-mono font-bold">{u.uom}</span>
                  </td>
                  <td className="py-2">
                    {u.factor != null
                      ? <span className="text-cyan-400 font-semibold">× {u.factor}</span>
                      : <span className="inline-flex items-center gap-1 text-amber-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          pendiente de factor por producto
                        </span>}
                  </td>
                  <td className="py-2 text-right text-slate-400">{fmtInt(u.cantidad)}</td>
                  <td className="py-2 text-right font-semibold text-cyan-400">{u.metros > 0 ? fmtM(u.metros) : '—'}</td>
                  <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(u.ventas_netas)}</td>
                  <td className="py-2 text-right text-amber-400">{u.precio_por_metro != null ? fmtCOP(u.precio_por_metro) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* FACTORES */}
      {tab === 'factores' && (
        <div className="flex flex-col gap-5">
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Factores de conversión por producto</h2>
            <p className="text-xs text-slate-500 mb-4">
              Define cuántos metros equivale 1 unidad de cada producto para UOM que no tienen factor estándar (TB, KG, UND, etc.).
              Estos factores se aplican automáticamente en el cálculo de metros.
            </p>

            {/* Add form */}
            <div className="grid grid-cols-5 gap-2 mb-4 p-3 bg-surface-700/40 rounded-xl border border-surface-600/50">
              <input
                placeholder="Código producto *"
                value={newFactor.codigo_producto}
                onChange={(e) => setNewFactor((f) => ({ ...f, codigo_producto: e.target.value }))}
                className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1.5"
              />
              <input
                placeholder="Descripción"
                value={newFactor.descripcion}
                onChange={(e) => setNewFactor((f) => ({ ...f, descripcion: e.target.value }))}
                className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1.5 col-span-2"
              />
              <input
                placeholder="UOM (ej: TB)"
                value={newFactor.uom}
                onChange={(e) => setNewFactor((f) => ({ ...f, uom: e.target.value }))}
                className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1.5"
              />
              <div className="flex gap-2">
                <input
                  type="number" placeholder="Factor *" step="0.001" min="0"
                  value={newFactor.factor}
                  onChange={(e) => setNewFactor((f) => ({ ...f, factor: e.target.value }))}
                  className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1.5 flex-1 w-0"
                />
                <button
                  onClick={handleSaveFactor} disabled={savingFactor || !newFactor.codigo_producto || !newFactor.factor}
                  className="flex items-center gap-1 text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                >
                  <Plus size={11} /> Agregar
                </button>
              </div>
            </div>

            {/* Existing factors table */}
            {Object.keys(factores).length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No hay factores definidos. Agrega el primero arriba.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-surface-700 text-slate-400">
                    <th className="pb-2 font-medium">Código producto</th>
                    <th className="pb-2 font-medium">Descripción</th>
                    <th className="pb-2 font-medium">UOM</th>
                    <th className="pb-2 font-medium text-right">Factor (m/unidad)</th>
                    <th className="pb-2 font-medium text-center">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(factores).map(([cod, v]) => (
                    <tr key={cod} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                      <td className="py-2 font-mono text-slate-200">{cod}</td>
                      <td className="py-2 text-slate-300">{v.descripcion || '—'}</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 rounded bg-surface-700 text-slate-300 font-mono">{v.uom || '—'}</span>
                      </td>
                      <td className="py-2 text-right font-semibold text-cyan-400">× {v.factor}</td>
                      <td className="py-2 text-center">
                        <button
                          onClick={() => handleDeleteFactor(cod)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-1 rounded transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Products pending factor */}
          {productos.filter((p) => !p.factor && p.uom !== 'SIN_UOM').length > 0 && (
            <div className="card border border-amber-700/30 bg-amber-900/10">
              <h2 className="text-sm font-semibold text-amber-300 mb-1">
                Productos sin factor ({productos.filter((p) => !p.factor && p.uom !== 'SIN_UOM').length})
              </h2>
              <p className="text-xs text-slate-500 mb-3">
                Estos productos tienen UOM sin conversión estándar. Define su factor arriba para incluirlos en el cálculo de metros.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-surface-700 text-slate-400">
                      <th className="pb-2 font-medium">Producto</th>
                      <th className="pb-2 font-medium text-center">UOM</th>
                      <th className="pb-2 font-medium text-right">Ventas</th>
                      <th className="pb-2 font-medium text-center">Acción rápida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.filter((p) => !p.factor && p.uom !== 'SIN_UOM').slice(0, 20).map((p, i) => (
                      <tr key={i} className="border-b border-surface-700/20">
                        <td className="py-1.5 text-slate-300 max-w-xs truncate">{p.producto}</td>
                        <td className="py-1.5 text-center">
                          <span className="px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 font-mono">{p.uom}</span>
                        </td>
                        <td className="py-1.5 text-right text-brand-300">{fmtCOP(p.ventas_netas)}</td>
                        <td className="py-1.5 text-center">
                          <button
                            onClick={() => { setTab('factores'); setNewFactor({ codigo_producto: p.codigo_producto || '', descripcion: p.producto || '', uom: p.uom || '', factor: '' }) }}
                            className="text-xs text-brand-400 hover:text-brand-300 underline"
                          >
                            Agregar factor
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PRONÓSTICO */}
      {tab === 'pronostico' && (
        <div className="flex flex-col gap-5">
          <div className="card">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-sm font-semibold text-slate-200">Pronóstico · Metros y Ventas</h2>
              <p className="text-xs text-slate-500">Histórico 12m + pronóstico 8m · WMA exponencial</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartPron} margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="m" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtM} width={70} />
                  <YAxis yAxisId="v" orientation="right" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} width={80} />
                  <Tooltip content={<TTip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: '#94a3b8' }}>{v}</span>} />
                  <Bar yAxisId="m" dataKey="metros" name="Metros histórico" fill={C_METROS} fillOpacity={0.7} radius={[3, 3, 0, 0]} barSize={16} />
                  <Bar yAxisId="m" dataKey="metros_pron" name="Metros pronóstico" fill={C_METROS} fillOpacity={0.35} radius={[3, 3, 0, 0]} barSize={16} />
                  <Line yAxisId="v" dataKey="ventas_netas" name="Ventas histórico ($)" stroke={C_VENTAS} strokeWidth={2} dot={{ r: 3, fill: C_VENTAS }} />
                  <Line yAxisId="v" dataKey="ventas_pron" name="Ventas pronóstico ($)" stroke={C_VENTAS} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: C_VENTAS }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Tabla de Pronóstico</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b border-surface-700 text-slate-400">
                  <th className="pb-2 font-medium">Período</th>
                  <th className="pb-2 font-medium text-right">Metros pron.</th>
                  <th className="pb-2 font-medium text-right">Ventas pron.</th>
                  <th className="pb-2 font-medium text-right">$/metro pron.</th>
                </tr>
              </thead>
              <tbody>
                {(pron?.pronostico || []).map((m, i) => (
                  <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20 transition-colors">
                    <td className="py-2 font-medium text-slate-200">{MONTH_NAMES[m.mes]} {m.ano}</td>
                    <td className="py-2 text-right font-semibold text-cyan-400">{fmtM(m.metros)}</td>
                    <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(m.ventas_netas)}</td>
                    <td className="py-2 text-right text-amber-400">{m.precio_por_metro != null ? fmtCOP(m.precio_por_metro) : '—'}</td>
                  </tr>
                ))}
                {pron?.pronostico?.length > 0 && (
                  <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
                    <td className="py-2">TOTAL</td>
                    <td className="py-2 text-right text-cyan-400">
                      {fmtM((pron.pronostico).reduce((s, m) => s + m.metros, 0))}
                    </td>
                    <td className="py-2 text-right text-brand-300">
                      {fmtCOP((pron.pronostico).reduce((s, m) => s + m.ventas_netas, 0))}
                    </td>
                    <td className="py-2" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
