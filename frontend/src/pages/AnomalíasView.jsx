import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { AlertTriangle, TrendingUp, TrendingDown, RefreshCw, Zap } from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP, MONTH_NAMES } from '../utils/format'

const GROUP_OPTIONS = [
  { value: 'linea_negocio', label: 'Línea de Negocio' },
  { value: 'vendedor',      label: 'Vendedor'          },
  { value: 'estructura',    label: 'Estructura'        },
  { value: 'tipo_producto', label: 'Tipo de Producto'  },
]

const fmtPeriodo = (p) => {
  const [y, m] = p.split('-')
  return `${MONTH_NAMES[+m]} ${y.slice(2)}`
}

function Sparkline({ data, currentPeriod }) {
  const items = data.map((d) => ({
    periodo: d.periodo,
    ventas: d.ventas_netas,
    actual: d.periodo === currentPeriod,
  }))
  return (
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={items} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="ventas" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
        {items.filter((d) => d.actual).map((d, i) => (
          <ReferenceLine key={i} x={d.periodo} stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" />
        ))}
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }}
          labelFormatter={(l) => fmtPeriodo(l)}
          formatter={(v) => [fmtCOP(v), 'Ventas']}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AnomalíasView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [groupBy, setGroupBy] = useState('linea_negocio')
  const [umbral, setUmbral]   = useState(1.5)
  const [mes, setMes]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.anomaliasAuto(filters.ano, mes || filters.mes, groupBy, umbral)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters.ano, filters.mes, mes, groupBy, umbral, refreshKey])

  useEffect(() => { load() }, [load])

  const items = data?.data || []
  const picos  = items.filter((i) => i.tipo_anomalia === 'pico')
  const caidas = items.filter((i) => i.tipo_anomalia === 'caida')

  const currentPeriod = data ? `${data.ano}-${String(data.mes).padStart(2, '0')}` : ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={20} className="text-yellow-400" />
          <h1 className="text-lg font-semibold text-slate-100">Detector de Anomalías Automático</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            Z-score estadístico sobre 24 meses
          </span>
        </div>
        <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Agrupar por</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Umbral Z</span>
          <select value={umbral} onChange={(e) => setUmbral(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {[1.0, 1.5, 2.0, 2.5].map((z) => <option key={z} value={z}>{z}σ</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Mes analizado</span>
          <select value={mes || ''} onChange={(e) => setMes(e.target.value ? +e.target.value : null)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            <option value="">— del filtro —</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{MONTH_NAMES[i + 1]}</option>
            ))}
          </select>
        </div>
        {data && (
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <TrendingUp size={12} /> {picos.length} picos
            </span>
            <span className="flex items-center gap-1 text-xs text-red-400">
              <TrendingDown size={12} /> {caidas.length} caídas
            </span>
          </div>
        )}
      </div>

      {error && <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Analizando…
        </div>
      )}

      {data && items.length === 0 && (
        <div className="p-8 text-center text-slate-500 bg-surface-800 rounded-2xl border border-surface-700">
          <AlertTriangle size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm">No se detectaron anomalías con umbral Z ≥ {umbral}σ.</p>
          <p className="text-xs mt-1">Intenta reducir el umbral o cambiar el período.</p>
        </div>
      )}

      {data && items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((item) => {
            const isPico = item.tipo_anomalia === 'pico'
            const borderCls = isPico ? 'border-emerald-700/50' : 'border-red-700/50'
            const bgCls     = isPico ? 'bg-emerald-900/10' : 'bg-red-900/10'
            const textCls   = isPico ? 'text-emerald-400' : 'text-red-400'
            const badgeCls  = isPico
              ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
              : 'bg-red-900/40 text-red-300 border border-red-700/50'

            return (
              <div key={item.dimension} className={`rounded-2xl border ${borderCls} ${bgCls} p-4`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badgeCls}`}>
                        {isPico ? '↑ Pico' : '↓ Caída'}
                      </span>
                      <span className="text-xs text-slate-500">Z = {item.z_score > 0 ? '+' : ''}{item.z_score}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-100 leading-tight">{item.dimension}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Mes actual</p>
                    <p className="text-sm font-bold text-slate-100">{fmtCOP(item.mes_actual)}</p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center p-2 bg-surface-800/60 rounded-lg">
                    <p className="text-xs text-slate-500">Media hist.</p>
                    <p className="text-xs font-semibold text-slate-300">{fmtCOP(item.media_historica)}</p>
                  </div>
                  <div className="text-center p-2 bg-surface-800/60 rounded-lg">
                    <p className="text-xs text-slate-500">Variación</p>
                    <p className={`text-xs font-bold ${textCls}`}>
                      {item.variacion_pct != null ? `${item.variacion_pct > 0 ? '+' : ''}${item.variacion_pct}%` : '—'}
                    </p>
                  </div>
                  <div className="text-center p-2 bg-surface-800/60 rounded-lg">
                    <p className="text-xs text-slate-500">Desv. std.</p>
                    <p className="text-xs font-semibold text-slate-300">{fmtCOP(item.std_historica)}</p>
                  </div>
                </div>

                {/* Sparkline */}
                <Sparkline data={item.historico} currentPeriod={currentPeriod} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
