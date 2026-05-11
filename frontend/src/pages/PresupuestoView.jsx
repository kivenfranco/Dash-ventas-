import { Component, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, cumpColor, cumpBg, pctColor, MONTH_NAMES } from '../utils/format'
import { Target, TrendingUp, Clock, Zap, Leaf, Sprout, Plus, X, Check } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6','#3b82f6','#84cc16']

const PANELS = [
  { id: 'region',              label: 'Región',           granular: true  },
  { id: 'planta',              label: 'Planta',           granular: true  },
  { id: 'grupo_comercial',     label: 'Grupo Comercial',  granular: true  },
  { id: 'mercado',             label: 'Mercado',          granular: false },
  { id: 'linea_negocio',       label: 'Línea de Negocio', granular: true  },
  { id: 'tipo_fabricacion',    label: 'Tipo Fabricación', granular: false },
  { id: 'unidad_medida_venta', label: 'Unidad de Medida', granular: false },
  { id: 'tipo_cliente',        label: 'Tipo de Cliente',  granular: false },
]

class ErrBound extends Component {
  state = { err: null }
  static getDerivedStateFromError(e) { return { err: e } }
  render() {
    if (this.state.err) return (
      <div className="p-6 font-mono text-xs text-rose-400 bg-surface-800 rounded-xl whitespace-pre-wrap">
        <strong>Error:</strong> {String(this.state.err)}
      </div>
    )
    return this.props.children
  }
}

function KPI({ label, value, sub, color, icon: Icon, loading }) {
  return (
    <div className="card py-3 px-4">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon size={13} className={color || 'text-slate-400'} />}
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
      </div>
      {loading
        ? <div className="animate-pulse h-7 bg-surface-700 rounded mt-1" />
        : <p className={`text-xl font-bold ${color || 'text-slate-100'}`}>{value ?? '—'}</p>}
      {sub && !loading && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function GaugeMini({ label, value, loading }) {
  const pct = Math.min(Math.max(value || 0, 0), 200)
  const color = pct >= 100 ? 'text-emerald-400' : pct >= 80 ? 'text-brand-400' : pct >= 60 ? 'text-amber-400' : 'text-rose-400'
  const bg    = pct >= 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-brand-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="card py-3 px-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">{label}</p>
      {loading
        ? <div className="animate-pulse h-7 bg-surface-700 rounded" />
        : (
          <>
            <p className={`text-xl font-bold ${color}`}>{value != null ? fmtPct(value, 1) : '—'}</p>
            <div className="mt-2 w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </>
        )}
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-3 py-2 text-xs min-w-44">
      <p className="text-slate-200 font-semibold mb-1 truncate max-w-40">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-3 py-0.5">
          <span className="text-slate-400">{p.name}</span>
          <span className="text-slate-100 font-medium">{fmtCOP(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PPTable({ data, loading, hasGranularPP, hasPP, panelId, metaDims }) {
  if (loading) return (
    <div className="space-y-1.5 mt-2">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="animate-pulse h-7 bg-surface-700 rounded" />
      ))}
    </div>
  )
  if (!data?.length) return <p className="text-slate-500 text-xs text-center py-8">Sin datos para el período</p>

  const showMetaDim = Object.keys(metaDims || {}).length > 0

  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-surface-700 text-slate-400">
            <th className="pb-2 font-medium">#</th>
            <th className="pb-2 font-medium">Dimensión</th>
            <th className="pb-2 font-medium text-right">Ventas</th>
            <th className="pb-2 font-medium text-right">Part %</th>
            {hasGranularPP && hasPP && <>
              <th className="pb-2 font-medium text-right">Presupuesto</th>
              <th className="pb-2 font-medium text-right">Debe Ser</th>
              <th className="pb-2 font-medium text-right">Cump PP</th>
              <th className="pb-2 font-medium text-right">Cump DS</th>
            </>}
            {showMetaDim && <th className="pb-2 font-medium text-right text-brand-400">Meta ✎</th>}
            <th className="pb-2 font-medium text-right">Año Ant.</th>
            <th className="pb-2 font-medium text-right">Var YoY</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => {
            const dimKey = `${panelId}:${d.dimension}`
            const metaVal = metaDims?.[dimKey] ?? null
            const metaCump = metaVal != null && d.ventas_netas > 0
              ? d.ventas_netas / metaVal * 100 : null
            return (
              <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                <td className="py-2 text-slate-500">{i + 1}</td>
                <td className="py-2 text-slate-100">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % 12] }} />
                    <span className="max-w-[180px] truncate">{d.dimension || '—'}</span>
                  </div>
                </td>
                <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                <td className="py-2 text-right text-slate-400">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="w-8 h-1 bg-surface-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${d.participacion_pct}%` }} />
                    </div>
                    {fmtPct(d.participacion_pct, 1)}
                  </div>
                </td>
                {hasGranularPP && hasPP && <>
                  <td className="py-2 text-right text-slate-400">{d.presupuesto != null ? fmtCOP(d.presupuesto) : '—'}</td>
                  <td className="py-2 text-right text-slate-400">{d.debe_ser != null ? fmtCOP(d.debe_ser) : '—'}</td>
                  <td className={`py-2 text-right font-semibold ${cumpColor(d.cumplimiento_pct)}`}>
                    {d.cumplimiento_pct != null ? fmtPct(d.cumplimiento_pct, 1) : '—'}
                  </td>
                  <td className={`py-2 text-right font-semibold ${cumpColor(d.cump_debe_ser_pct)}`}>
                    {d.cump_debe_ser_pct != null ? fmtPct(d.cump_debe_ser_pct, 1) : '—'}
                  </td>
                </>}
                {showMetaDim && (
                  <td className="py-2 text-right">
                    {metaVal != null ? (
                      <div>
                        <span className="text-brand-400 font-medium">{fmtCOP(metaVal)}</span>
                        {metaCump != null && (
                          <span className={`ml-1 text-xs font-bold ${metaCump >= 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {fmtPct(metaCump, 0)}
                          </span>
                        )}
                      </div>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                )}
                <td className="py-2 text-right text-slate-500">{d.ventas_netas_ant ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                <td className={`py-2 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>
                  {d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct, 1) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PPPanel({ panelId, label, filters, refreshKey }) {
  const { data, loading, error } = useData(
    () => api.presupuesto(filters, panelId, 30),
    [filters, refreshKey, panelId],
  )
  const { data: metaData } = useData(
    () => api.presupuestoManualGet(filters.ano, filters.mes || null),
    [filters.ano, filters.mes],
  )

  const rows    = data?.data || []
  const summary = data?.summary || {}
  const org     = data?.organico || {}
  const hasPP   = data?.has_pp || false
  const isGran  = data?.pp_granular || false

  const metaGlobal  = metaData?.metas?.global ?? null
  const metaDims    = metaData?.metas?.por_dimension ?? {}
  const metaNota    = metaData?.metas?.nota || ''
  const hasMetaManual = metaGlobal != null || Object.keys(metaDims).length > 0

  const chartData = rows.slice(0, 12).map((d, i) => ({
    name:        d.dimension?.length > 20 ? d.dimension.slice(0, 20) + '…' : (d.dimension || '—'),
    ventas:      d.ventas_netas,
    presupuesto: d.presupuesto,
    fill:        PALETTE[i % PALETTE.length],
  }))

  return (
    <ErrBound>
      <div className="flex flex-col gap-4">
        {error && <p className="text-rose-400 text-xs bg-surface-800 p-3 rounded-lg">{error}</p>}

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          <KPI label="Ventas Período" value={fmtCOP(data?.ventas_totales)} color="text-brand-300"
            icon={TrendingUp} loading={loading} sub={`YoY: ${fmtPct(data?.variacion_yoy_total, 1)}`} />
          {hasPP && <>
            <KPI label="Presupuesto" value={fmtCOP(summary.presupuesto)} color="text-amber-300"
              icon={Target} loading={loading} />
            <KPI label="Debe Ser" value={fmtCOP(summary.debe_ser)} color="text-orange-300"
              icon={Clock} loading={loading}
              sub={`${data?.dias_habiles_transcurridos}/${data?.dias_habiles_mes} días hábiles`} />
            <GaugeMini label="Cump vs PP" value={summary.cumplimiento_pct} loading={loading} />
            <GaugeMini label="Cump vs Debe Ser" value={summary.cump_debe_ser_pct} loading={loading} />
          </>}
          {hasMetaManual && (
            <div className="card py-3 px-4 border-brand-500/30 bg-brand-600/5">
              <p className="text-xs text-brand-400 font-medium uppercase tracking-wide mb-1">Meta Manual</p>
              {metaGlobal != null && (
                <p className="text-lg font-bold text-brand-300">{fmtCOP(metaGlobal)}</p>
              )}
              {Object.keys(metaDims).length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">{Object.keys(metaDims).length} dim. configuradas</p>
              )}
              {metaNota && <p className="text-xs text-slate-500 mt-0.5 truncate">{metaNota}</p>}
              {metaGlobal != null && data?.ventas_totales > 0 && (
                <p className={`text-xs font-semibold mt-1 ${data.ventas_totales >= metaGlobal ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {fmtPct(data.ventas_totales / metaGlobal * 100, 1)} cump.
                </p>
              )}
            </div>
          )}
          {org.organica != null && (
            <div className="card py-3 px-4 col-span-2 md:col-span-1">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Orgánica / Inorgánica</p>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-emerald-400"><Leaf size={11} />Orgánica</span>
                  <span className="text-xs font-semibold text-slate-100">{fmtCOP(org.organica)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-cyan-400"><Sprout size={11} />Inorgánica</span>
                  <span className="text-xs font-semibold text-slate-100">{fmtCOP(org.inorganica)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chart + Table */}
        <div className="card">
          {/* Bar chart */}
          <div className={`h-52 mb-4 ${loading ? 'opacity-40 animate-pulse' : ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 16, left: 4, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtCOP} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={130} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="ventas" name="Ventas" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
                {isGran && hasPP && chartData.some((d) => d.presupuesto > 0) && (
                  <Bar dataKey="presupuesto" name="Presupuesto" radius={[0, 3, 3, 0]} fill="#78350f" stroke="#92400e" strokeWidth={1} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <PPTable data={rows} loading={loading} hasGranularPP={isGran} hasPP={hasPP}
            panelId={panelId} metaDims={metaDims} />
        </div>
      </div>
    </ErrBound>
  )
}

const DIM_INGRESO = [
  { value: '',                 label: 'Global (sin dimensión)' },
  { value: 'region',           label: 'Región' },
  { value: 'planta',           label: 'Planta' },
  { value: 'grupo_comercial',  label: 'Grupo Comercial' },
  { value: 'linea_negocio',    label: 'Línea de Negocio' },
]

function MetaModal({ filters, onClose, onSaved }) {
  const curYear = filters.ano || new Date().getFullYear()
  const [ano,    setAno]    = useState(String(curYear))
  const [mes,    setMes]    = useState(filters.mes ? String(filters.mes) : '')
  const [monto,  setMonto]  = useState('')
  const [dimKey, setDimKey] = useState('')
  const [dimVal, setDimVal] = useState('')
  const [nota,   setNota]   = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [ok,     setOk]     = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    const v = parseFloat(monto.replace(/[.,]/g, (m, o, s) => {
      const dots   = s.split('').filter(c => c === '.').length
      const commas = s.split('').filter(c => c === ',').length
      return (dots === 1 && commas === 0) || (commas === 1 && dots === 0) ? (m === ',' ? '.' : m) : ''
    }))
    if (isNaN(v) || v <= 0) { setErr('Ingresa un monto válido mayor a 0'); return }
    setSaving(true); setErr('')
    try {
      await api.presupuestoManualSave({
        ano:              parseInt(ano),
        mes:              mes ? parseInt(mes) : null,
        monto:            v,
        dimension_key:    dimKey || null,
        dimension_valor:  dimKey ? dimVal : null,
        nota:             nota || null,
      })
      setOk(true)
      setTimeout(() => { onSaved(); onClose() }, 1200)
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex.message || 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <h2 className="text-sm font-semibold text-slate-100">Ingresar Meta de Presupuesto</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors"><X size={16} /></button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Año</label>
              <input type="number" value={ano} onChange={(e) => setAno(e.target.value)} min="2020" max="2030" className="input" required />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Mes (opcional)</label>
              <select value={mes} onChange={(e) => setMes(e.target.value)} className="select">
                <option value="">— Anual —</option>
                {MONTH_NAMES.slice(1).map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Monto (COP)</label>
            <input
              type="text" value={monto} onChange={(e) => setMonto(e.target.value)}
              placeholder="Ej: 500000000"
              className="input" required
            />
            {monto && !isNaN(parseFloat(monto.replace(',','.'))) && (
              <p className="text-xs text-brand-400 mt-1">{fmtCOP(parseFloat(monto.replace(',','.')))}</p>
            )}
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Dimensión (opcional)</label>
            <select value={dimKey} onChange={(e) => { setDimKey(e.target.value); setDimVal('') }} className="select mb-2">
              {DIM_INGRESO.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            {dimKey && (
              <input
                type="text" value={dimVal} onChange={(e) => setDimVal(e.target.value)}
                placeholder={`Valor de ${DIM_INGRESO.find(d => d.value === dimKey)?.label || ''}`}
                className="input"
              />
            )}
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Nota (opcional)</label>
            <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: Revisado en junta de enero" className="input" />
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-100 bg-surface-800 border border-surface-700 rounded-xl transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || ok}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white rounded-xl transition-colors"
            >
              {ok ? <><Check size={14} /> Guardado</> : saving ? 'Guardando…' : <><Plus size={14} /> Guardar Meta</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function PresupuestoView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [active, setActive]     = useState('region')
  const [showMeta, setShowMeta] = useState(false)
  const [metaSaved, setMetaSaved] = useState(0)

  const panel  = PANELS.find((p) => p.id === active) || PANELS[0]
  const period = filters.mes
    ? `${MONTH_NAMES[filters.mes]} ${filters.ano}`
    : `Año ${filters.ano}`

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {showMeta && (
        <MetaModal
          filters={filters}
          onClose={() => setShowMeta(false)}
          onSaved={() => setMetaSaved((n) => n + 1)}
        />
      )}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Análisis de Presupuesto</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            PP vs Ventas reales · Cumplimiento · Deber Ser · YoY · {period}
          </p>
        </div>
        {/* Actions + Dimension selector */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowMeta(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/40 text-brand-300 rounded-lg transition-colors"
          >
            <Plus size={12} /> Ingresar Meta
          </button>
          {PANELS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active === p.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-800 text-slate-400 hover:text-slate-100 border border-surface-700'
              }`}
            >
              {p.label}
              {p.granular && (
                <span className="ml-1 text-amber-400 text-[9px]">PP</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <PPPanel
        key={`${active}-${metaSaved}`}
        panelId={active}
        label={panel.label}
        filters={filters}
        refreshKey={refreshKey}
      />
    </div>
  )
}
