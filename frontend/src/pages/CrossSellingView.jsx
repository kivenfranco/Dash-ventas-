import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'

function LiftBadge({ lift }) {
  const cls =
    lift >= 5 ? 'bg-emerald-500/20 text-emerald-300' :
    lift >= 2 ? 'bg-brand-500/20 text-brand-300' :
                'bg-surface-700 text-slate-400'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>{lift.toFixed(2)}×</span>
}

export function CrossSellingView() {
  const { refreshKey }            = useOutletContext()
  const { filters }               = useFilters()
  const [rules, setRules]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [tab, setTab]             = useState('reglas')
  const [vendedor, setVendedor]   = useState('')
  const [recs, setRecs]           = useState(null)
  const [recLoading, setRL]       = useState(false)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.crossSelling(filters.ano, filters.mes)
      .then((d) => setRules(d.data || []))
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.mes, refreshKey])

  const buscarVendedor = async () => {
    if (!vendedor.trim()) return
    setRL(true)
    try {
      const d = await api.crossSellingVendedor(vendedor.trim(), filters.ano, filters.mes)
      setRecs(d)
    } catch (e) {
      setRecs({ vendedor: vendedor, recomendaciones: [], error: e?.response?.data?.detail })
    } finally { setRL(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Cross-Selling</h1>
        <p className="text-xs text-slate-400 mt-0.5">Asociaciones de productos — lift &gt; 1 indica co-compra frecuente — {filters.ano}</p>
      </div>

      <div className="flex gap-2">
        {['reglas', 'vendedor'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
          >
            {t === 'reglas' ? 'Reglas globales' : 'Por vendedor'}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {tab === 'reglas' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">Si compra…</th>
                  <th className="text-left px-4 py-3">También compra…</th>
                  <th className="text-right px-3 py-3">Soporte</th>
                  <th className="text-right px-3 py-3">Confianza</th>
                  <th className="text-center px-3 py-3">Lift</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={i} className={`border-b border-surface-800 hover:bg-surface-800/50 ${r.lift >= 5 ? 'bg-emerald-500/5' : ''}`}>
                    <td className="px-4 py-2 text-slate-200 max-w-xs">
                      <div className="font-medium">{r.desc_ante}</div>
                      <div className="text-slate-500 font-mono">{r.antecedente}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-200 max-w-xs">
                      <div className="font-medium">{r.desc_cons}</div>
                      <div className="text-slate-500 font-mono">{r.consecuente}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{(r.soporte * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-slate-400">{(r.confianza * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center"><LiftBadge lift={r.lift} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'vendedor' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscarVendedor()}
              placeholder="Código vendedor (ej. V001)"
              className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 w-64"
            />
            <button
              onClick={buscarVendedor}
              disabled={recLoading}
              className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {recLoading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          {recs && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-200 mb-1">
                Vendedor: <span className="font-mono text-brand-300">{recs.vendedor}</span>
                <span className="text-slate-500 text-xs ml-2">— {recs.productos_actuales} productos actuales</span>
              </p>
              {recs.error && <p className="text-red-400 text-xs mt-2">{recs.error}</p>}
              {(!recs.recomendaciones || recs.recomendaciones.length === 0) && !recs.error && (
                <p className="text-slate-400 text-sm mt-2">Sin recomendaciones para este vendedor.</p>
              )}
              {recs.recomendaciones?.length > 0 && (
                <table className="w-full text-xs mt-3">
                  <thead>
                    <tr className="border-b border-surface-700 text-slate-400">
                      <th className="text-left py-2">Producto recomendado</th>
                      <th className="text-left py-2">Basado en</th>
                      <th className="text-center py-2">Lift</th>
                      <th className="text-right py-2">Confianza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.recomendaciones.map((r, i) => (
                      <tr key={i} className="border-b border-surface-800">
                        <td className="py-2 text-slate-200">
                          <div>{r.desc_cons}</div>
                          <div className="text-slate-500 font-mono">{r.consecuente}</div>
                        </td>
                        <td className="py-2 text-slate-400">
                          <div>{r.desc_ante}</div>
                          <div className="text-slate-600 font-mono">{r.antecedente}</div>
                        </td>
                        <td className="py-2 text-center"><LiftBadge lift={r.lift} /></td>
                        <td className="py-2 text-right text-slate-400">{(r.confianza * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
