import { Component } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { fmtCOP, fmtPct, pctColor, MONTH_NAMES } from '../utils/format'

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

function SegTable({ label, rows, loading, error }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3,4,5].map((i) => <div key={i} className="animate-pulse h-7 bg-surface-700 rounded" />)}
      </div>
    )
  }
  if (error) {
    return <p className="text-rose-400 text-xs py-4">Error: {String(error)}</p>
  }
  if (!rows || rows.length === 0) {
    return <p className="text-slate-500 text-xs text-center py-6">Sin datos para el período</p>
  }
  const totalVN = rows.reduce((s, d) => s + (d.ventas_netas || 0), 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-surface-700 text-slate-400">
            <th className="pb-2 font-medium">#</th>
            <th className="pb-2 font-medium">{label}</th>
            <th className="pb-2 font-medium text-right">Ventas Netas</th>
            <th className="pb-2 font-medium text-right">Part %</th>
            <th className="pb-2 font-medium text-right">Año Ant.</th>
            <th className="pb-2 font-medium text-right">Var YoY</th>
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
            </tr>
          ))}
          <tr className="border-t-2 border-surface-600 font-bold text-slate-100">
            <td className="py-2" colSpan={2}>TOTAL</td>
            <td className="py-2 text-right text-brand-300">{fmtCOP(totalVN)}</td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function MercadosView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const { data: dgc, loading: lgc, error: egc } = useData(
    () => api.segments(filters, 'grupo_comercial', 30),
    [filters, refreshKey],
  )
  const { data: dmk, loading: lmk, error: emk } = useData(
    () => api.segments(filters, 'mercado', 30),
    [filters, refreshKey],
  )

  const period = filters.mes ? `${MONTH_NAMES[filters.mes]} ${filters.ano}` : `Año ${filters.ano}`
  const rowsGC = dgc?.data || []
  const rowsMK = dmk?.data || []

  return (
    <ErrBound>
      <div className="flex flex-col gap-5 animate-fade-in">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Mercados y Grupos Comerciales</h1>
          <p className="text-slate-500 text-xs mt-0.5">{period}</p>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Grupos Comerciales</h2>
          <SegTable label="Grupo Comercial" rows={rowsGC} loading={lgc} error={egc} />
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Mercados</h2>
          <SegTable label="Mercado" rows={rowsMK} loading={lmk} error={emk} />
        </div>
      </div>
    </ErrBound>
  )
}
