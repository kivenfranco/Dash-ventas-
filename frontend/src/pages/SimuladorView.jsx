import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw, Sliders, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP, pctColor } from '../utils/format'

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

const SliderRow = ({ label, hint, value, onChange, min, max, step, unit = '%', color = 'brand' }) => {
  const pct = ((value - min) / (max - min)) * 100
  const colorMap = {
    brand: 'accent-brand-500',
    emerald: 'accent-emerald-500',
    red: 'accent-red-500',
    amber: 'accent-amber-500',
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-slate-200">{label}</span>
          {hint && <span className="text-xs text-slate-500 ml-2">{hint}</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number" value={value} step={step}
            onChange={(e) => onChange(clamp(+e.target.value, min, max))}
            className="w-20 text-right text-sm font-mono bg-surface-700 border border-surface-600 text-slate-200 rounded px-2 py-0.5"
          />
          <span className="text-xs text-slate-400 w-4">{unit}</span>
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className={`w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-700 ${colorMap[color]}`}
      />
      <div className="flex justify-between text-[10px] text-slate-600">
        <span>{min}{unit}</span>
        <span>0{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

const KpiCard = ({ label, value, compare, prefix = '' }) => {
  const diff = compare != null ? value - compare : null
  const pct  = compare && compare !== 0 ? (diff / Math.abs(compare)) * 100 : null
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-100">{prefix}{fmtCOP(value)}</p>
      {diff != null && (
        <p className={`text-xs mt-1 font-medium ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {diff >= 0 ? '+' : ''}{fmtCOP(diff)} ({pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'})
        </p>
      )}
    </div>
  )
}

export function SimuladorView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [kpisBase, setKpisBase] = useState(null)
  const [loading, setLoading]   = useState(false)

  // Sliders
  const [precio,   setPrecio]   = useState(0)   // % cambio en precio
  const [volumen,  setVolumen]  = useState(0)   // % cambio en volumen
  const [clientes, setClientes] = useState(0)   // % cambio en # clientes activos
  const [margen,   setMargen]   = useState(35)  // % margen bruto asumido

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.kpis(filters)
      setKpisBase(res)
    } catch (_) {}
    finally { setLoading(false) }
  }, [filters, refreshKey])

  useEffect(() => { load() }, [load])

  const reset = () => { setPrecio(0); setVolumen(0); setClientes(0); setMargen(35) }

  const base = kpisBase?.ventas_netas ?? 0
  const baseMargen = base * (margen / 100)

  // Projected
  const factorPrecio   = 1 + precio   / 100
  const factorVolumen  = 1 + volumen  / 100
  const factorClientes = 1 + clientes / 100

  const proyVentas = base * factorPrecio * factorVolumen * factorClientes
  const proyMargen = proyVentas * (margen / 100)
  const deltaVentas = proyVentas - base
  const pctDelta    = base > 0 ? ((proyVentas / base) - 1) * 100 : 0

  const escenario =
    pctDelta > 10 ? { label: 'Optimista', cls: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/40' }
    : pctDelta > 0  ? { label: 'Favorable', cls: 'text-brand-400',   bg: 'bg-brand-900/20 border-brand-700/40' }
    : pctDelta < -10? { label: 'Pesimista', cls: 'text-red-400',     bg: 'bg-red-900/20 border-red-700/40' }
    :                 { label: 'Conservador', cls: 'text-slate-400',  bg: 'bg-surface-800 border-surface-700' }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders size={20} className="text-brand-400" />
          <h1 className="text-lg font-semibold text-slate-100">Simulador de Escenarios</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            proyección de impacto en ventas
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <RotateCcw size={12} /> Resetear
          </button>
          <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar base
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Sliders panel */}
        <div className="space-y-5 bg-surface-800 rounded-2xl border border-surface-700 p-5">
          <p className="text-sm font-semibold text-slate-200">Variables de simulación</p>

          <SliderRow
            label="Cambio en precio" hint="vs. período base"
            value={precio} onChange={setPrecio} min={-50} max={50} step={1} color="amber"
          />
          <SliderRow
            label="Cambio en volumen" hint="unidades vendidas"
            value={volumen} onChange={setVolumen} min={-50} max={100} step={1} color="brand"
          />
          <SliderRow
            label="Cambio en clientes activos" hint="% de la base actual"
            value={clientes} onChange={setClientes} min={-50} max={100} step={1} color="emerald"
          />

          <div className="border-t border-surface-700 pt-4">
            <SliderRow
              label="Margen bruto asumido" hint="para calcular utilidad proyectada"
              value={margen} onChange={setMargen} min={5} max={80} step={1} color="amber"
            />
          </div>

          <div className="p-3 bg-surface-700/40 rounded-xl border border-surface-600/50 text-xs text-slate-400">
            <p className="font-medium text-slate-300 mb-1">Fórmula aplicada:</p>
            <code className="text-[10px] text-brand-300">
              Ventas = Base × (1+Δprecio%) × (1+Δvolumen%) × (1+Δclientes%)
            </code>
            <p className="mt-1">Margen = Ventas proyectadas × {margen}%</p>
          </div>
        </div>

        {/* Results panel */}
        <div className="space-y-4">
          {/* Escenario badge */}
          <div className={`flex items-center justify-between p-4 rounded-2xl border ${escenario.bg}`}>
            <div>
              <p className="text-xs text-slate-400">Escenario detectado</p>
              <p className={`text-2xl font-bold ${escenario.cls}`}>{escenario.label}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Impacto proyectado</p>
              <p className={`text-xl font-bold ${pctDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {pctDelta >= 0 ? '+' : ''}{pctDelta.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* KPI comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
              <p className="text-xs text-slate-400 mb-1">Ventas base ({filters.ano})</p>
              <p className="text-xl font-bold text-slate-100">{fmtCOP(base)}</p>
              <p className="text-xs text-slate-500 mt-1">Período seleccionado</p>
            </div>
            <div className={`rounded-xl border p-4 ${pctDelta >= 0 ? 'bg-emerald-900/10 border-emerald-700/40' : 'bg-red-900/10 border-red-700/40'}`}>
              <p className="text-xs text-slate-400 mb-1">Ventas proyectadas</p>
              <p className={`text-xl font-bold ${pctDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtCOP(proyVentas)}</p>
              <p className={`text-xs mt-1 font-medium ${pctDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {deltaVentas >= 0 ? '+' : ''}{fmtCOP(deltaVentas)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
              <p className="text-xs text-slate-400 mb-1">Margen base ({margen}%)</p>
              <p className="text-lg font-bold text-slate-100">{fmtCOP(baseMargen)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${proyMargen >= baseMargen ? 'bg-emerald-900/10 border-emerald-700/40' : 'bg-red-900/10 border-red-700/40'}`}>
              <p className="text-xs text-slate-400 mb-1">Margen proyectado</p>
              <p className={`text-lg font-bold ${proyMargen >= baseMargen ? 'text-emerald-400' : 'text-red-400'}`}>{fmtCOP(proyMargen)}</p>
              <p className={`text-xs mt-1 ${proyMargen >= baseMargen ? 'text-emerald-500' : 'text-red-500'}`}>
                {proyMargen - baseMargen >= 0 ? '+' : ''}{fmtCOP(proyMargen - baseMargen)}
              </p>
            </div>
          </div>

          {/* Breakdown */}
          <div className="bg-surface-800 rounded-xl border border-surface-700 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-300">Descomposición del impacto</p>
            {[
              { label: 'Efecto precio',   pct: (factorPrecio - 1) * 100,   icon: TrendingUp },
              { label: 'Efecto volumen',  pct: (factorVolumen - 1) * 100,  icon: TrendingUp },
              { label: 'Efecto clientes', pct: (factorClientes - 1) * 100, icon: TrendingUp },
            ].map(({ label, pct: p }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-32">{label}</span>
                <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${p >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(Math.abs(p), 100) / 2 + 50}%`, marginLeft: p < 0 ? `${50 - Math.min(Math.abs(p), 50)}%` : '50%' }}
                  />
                </div>
                <span className={`text-xs font-mono w-16 text-right ${p >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p >= 0 ? '+' : ''}{p.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-600 text-center">
        Modelo simplificado de impacto multiplicativo. Los efectos reales pueden diferir por interdependencias entre variables.
      </p>
    </div>
  )
}
