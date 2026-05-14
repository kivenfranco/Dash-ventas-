import { Component, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, pctColor, cumpColor, cumpBg, formatPeriod } from '../utils/format'
import { Store } from 'lucide-react'

class ErrBound extends Component {
  state = { err: null }
  static getDerivedStateFromError(e) { return { err: e } }
  render() {
    if (this.state.err) return (
      <div className="p-8 font-mono text-xs text-rose-400 bg-surface-800 rounded-xl whitespace-pre-wrap">
        <strong className="text-rose-300">Error en Mercados:</strong>{'\n'}
        {String(this.state.err)}{'\n\n'}{this.state.err?.stack}
      </div>
    )
    return this.props.children
  }
}

const PALETTE = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#a855f7','#ec4899','#14b8a6','#f97316','#8b5cf6','#3b82f6','#84cc16']

function CumpBar({ value }) {
  const w = Math.min(Math.max(value || 0, 0), 150)
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cumpBg(value)}`} style={{ width: `${Math.min(w, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold ${cumpColor(value)}`}>{fmtPct(value, 1)}</span>
    </div>
  )
}

export function MercadosView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()
  const [exclPvta, setExclPvta] = useState(true)

  const f = { ...filters, excl_pvta: exclPvta }

  const { data, loading, error } = useData(
    () => api.segments(f, 'mercado', 30),
    [filters, refreshKey, exclPvta],
  )

  const period  = formatPeriod(filters.ano, filters.mes, filters.mes_fin)
  const rows    = data?.data || []
  const hasPP   = rows.length > 0 && rows[0]?.presupuesto != null
  const totalVN = rows.reduce((s, d) => s + (d.ventas_netas  || 0), 0)
  const totalPP = rows.reduce((s, d) => s + (d.presupuesto   || 0), 0)

  return (
    <ErrBound>
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Mercados</h1>
            <p className="text-slate-500 text-xs mt-0.5">{period}</p>
          </div>
          <button
            onClick={() => setExclPvta((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              exclPvta
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
            }`}
          >
            <Store size={12} />
            {exclPvta ? 'Sin PVTA' : 'Con PVTA'}
          </button>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Ventas por Mercado</h2>

          {loading && (
            <div className="space-y-2">
              {[1,2,3,4,5].map((i) => (
                <div key={i} className="animate-pulse h-7 bg-surface-700 rounded" />
              ))}
            </div>
          )}

          {error && <p className="text-rose-400 text-xs py-4">Error: {String(error)}</p>}

          {!loading && !error && rows.length === 0 && (
            <p className="text-slate-500 text-xs text-center py-6">Sin datos para el período</p>
          )}

          {!loading && !error && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-surface-700 text-slate-400">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Mercado</th>
                    <th className="pb-2 font-medium text-right">Ventas Netas</th>
                    <th className="pb-2 font-medium text-right">Part %</th>
                    <th className="pb-2 font-medium text-right">Año Ant.</th>
                    <th className="pb-2 font-medium text-right">Var YoY</th>
                    {hasPP && <th className="pb-2 font-medium text-right">Presupuesto</th>}
                    {hasPP && <th className="pb-2 font-medium">Cumpl.</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d, i) => (
                    <tr key={i} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2 text-slate-500">{i + 1}</td>
                      <td className="py-2 text-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % 12] }} />
                          <span className="max-w-xs truncate">{String(d.dimension || '—')}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right font-semibold text-brand-300">{fmtCOP(d.ventas_netas)}</td>
                      <td className="py-2 text-right text-slate-400">{fmtPct(d.participacion_pct, 1)}</td>
                      <td className="py-2 text-right text-slate-500">{d.ventas_netas_ant != null ? fmtCOP(d.ventas_netas_ant) : '—'}</td>
                      <td className={`py-2 text-right font-semibold ${pctColor(d.variacion_yoy_pct)}`}>
                        {d.variacion_yoy_pct != null ? fmtPct(d.variacion_yoy_pct, 1) : '—'}
                      </td>
                      {hasPP && (
                        <td className="py-2 text-right text-slate-300">
                          {d.presupuesto != null ? fmtCOP(d.presupuesto) : '—'}
                        </td>
                      )}
                      {hasPP && (
                        <td className="py-2">
                          {d.cump_pp_pct != null ? <CumpBar value={d.cump_pp_pct} /> : <span className="text-slate-600">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
                    <td className="py-2" colSpan={2}>TOTAL</td>
                    <td className="py-2 text-right text-brand-300">{fmtCOP(totalVN)}</td>
                    <td colSpan={2} />
                    <td />
                    {hasPP && <td className="py-2 text-right text-slate-300">{fmtCOP(totalPP)}</td>}
                    {hasPP && (
                      <td className="py-2">
                        {totalPP > 0 ? <CumpBar value={(totalVN / totalPP) * 100} /> : null}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ErrBound>
  )
}
