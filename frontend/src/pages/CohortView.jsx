import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { RefreshCw, Users } from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'

const retColor = (pct) => {
  if (pct == null) return { bg: 'bg-surface-800', text: 'text-slate-600' }
  if (pct >= 80) return { bg: 'bg-emerald-800',  text: 'text-emerald-100' }
  if (pct >= 60) return { bg: 'bg-emerald-900',  text: 'text-emerald-300' }
  if (pct >= 40) return { bg: 'bg-yellow-900',   text: 'text-yellow-300'  }
  if (pct >= 20) return { bg: 'bg-orange-900',   text: 'text-orange-300'  }
  if (pct > 0)   return { bg: 'bg-red-900',      text: 'text-red-300'     }
  return              { bg: 'bg-surface-800',    text: 'text-slate-600'   }
}

const MESES_OPTIONS = [6, 9, 12, 18, 24]

export function CohortView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [meses, setMeses]     = useState(12)
  const [exclPvta, setExclPvta] = useState(true)
  const [anoInicio, setAnoInicio] = useState(new Date().getFullYear() - 1)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.cohort(anoInicio, meses, exclPvta)
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [anoInicio, meses, exclPvta, refreshKey])

  useEffect(() => { load() }, [load])

  const cohorts = data?.cohorts || []
  const maxOffset = meses

  const offsetCols = Array.from({ length: Math.min(maxOffset + 1, 13) }, (_, i) => i)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Cohort de Retención de Clientes</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            % clientes activos por mes desde primera compra
          </span>
        </div>
        <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-surface-800 rounded-xl border border-surface-700">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Año inicio</span>
          <select value={anoInicio} onChange={(e) => setAnoInicio(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {[new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Ventana (meses)</span>
          <select value={meses} onChange={(e) => setMeses(+e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded px-2 py-1">
            {MESES_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={exclPvta} onChange={(e) => setExclPvta(e.target.checked)}
            className="w-3.5 h-3.5 accent-brand-500" />
          Excluir PVTA
        </label>
        {data && (
          <span className="text-xs text-slate-500 ml-auto">{cohorts.length} cohortes</span>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>Retención:</span>
        {[
          { label: '≥80%', bg: 'bg-emerald-800' },
          { label: '60-79%', bg: 'bg-emerald-900' },
          { label: '40-59%', bg: 'bg-yellow-900' },
          { label: '20-39%', bg: 'bg-orange-900' },
          { label: '<20%', bg: 'bg-red-900' },
          { label: 'Sin datos', bg: 'bg-surface-800' },
        ].map(({ label, bg }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-4 h-4 rounded ${bg} border border-surface-600`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {error && <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Calculando cohortes…
        </div>
      )}

      {data && cohorts.length === 0 && (
        <div className="p-8 text-center text-slate-500 bg-surface-800 rounded-2xl border border-surface-700">
          <Users size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm">No hay datos de cohortes para el período seleccionado.</p>
        </div>
      )}

      {/* Heatmap table */}
      {data && cohorts.length > 0 && (
        <div className="bg-surface-800 rounded-2xl border border-surface-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-surface-900/60 border-b border-surface-700">
                  <th className="px-3 py-2.5 text-left text-slate-400 font-medium whitespace-nowrap">Cohorte</th>
                  <th className="px-3 py-2.5 text-center text-slate-400 font-medium whitespace-nowrap">N inicial</th>
                  {offsetCols.map((o) => (
                    <th key={o} className="px-2 py-2.5 text-center text-slate-400 font-medium whitespace-nowrap min-w-[60px]">
                      {o === 0 ? 'M0' : `+${o}M`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((cohort) => {
                  const retMap = Object.fromEntries(
                    cohort.retention.map((r) => [r.offset_mes, r])
                  )
                  return (
                    <tr key={cohort.cohort_periodo} className="border-t border-surface-700/30">
                      <td className="px-3 py-1.5 text-slate-300 font-medium whitespace-nowrap">{cohort.cohort_periodo}</td>
                      <td className="px-3 py-1.5 text-center text-slate-400">{cohort.n_clientes_inicial}</td>
                      {offsetCols.map((o) => {
                        const ret = retMap[o]
                        if (!ret) {
                          return <td key={o} className="px-2 py-1.5 text-center bg-surface-800/30" />
                        }
                        const { bg, text } = retColor(ret.pct_retencion)
                        return (
                          <td key={o} className={`px-2 py-1.5 text-center ${bg} transition-colors`}
                            title={`${ret.n_activos} activos (${ret.pct_retencion}%)`}>
                            <span className={`font-semibold ${text}`}>
                              {ret.pct_retencion.toFixed(0)}%
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-surface-700/50 text-xs text-slate-500">
            M0 = mes de primera compra · +NM = N meses después · Porcentaje de clientes que realizaron al menos una compra
          </div>
        </div>
      )}
    </div>
  )
}
