import { useState, useEffect, useCallback, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Printer, RefreshCw, FileText, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP, pctColor, formatPeriod, MONTH_NAMES } from '../utils/format'

const HOY = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })

const Section = ({ title, children, className = '' }) => (
  <div className={`print:break-inside-avoid mb-6 ${className}`}>
    <h2 className="text-sm font-bold text-slate-200 border-b border-surface-600 pb-1.5 mb-3 print:text-black print:border-gray-300">
      {title}
    </h2>
    {children}
  </div>
)

const KpiBox = ({ label, value, sub, up }) => (
  <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 print:border-gray-300 print:bg-white">
    <p className="text-xs text-slate-500 print:text-gray-500">{label}</p>
    <p className="text-xl font-bold text-slate-100 print:text-black mt-1">{value}</p>
    {sub != null && (
      <p className={`text-xs mt-1 font-medium ${up == null ? 'text-slate-400' : up ? 'text-emerald-400' : 'text-red-400'} print:text-gray-600`}>
        {sub}
      </p>
    )}
  </div>
)

export function ReporteView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()
  const printRef = useRef()

  const [kpis,       setKpis]      = useState(null)
  const [alertas,    setAlertas]   = useState(null)
  const [hallazgos,  setHallazgos] = useState(null)
  const [presupuesto, setPptos]    = useState(null)
  const [loading,    setLoading]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [k, a, h] = await Promise.all([
        api.kpis(filters),
        api.alertas(filters, -20, true).catch(() => ({ clientes: [] })),
        api.hallazgos(filters).catch(() => ({ hallazgos: [] })),
      ])
      setKpis(k)
      setAlertas(a)
      setHallazgos(h)
    } catch (_) {}
    finally { setLoading(false) }
  }, [filters, refreshKey])

  useEffect(() => { load() }, [load])

  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  const doPrint = () => window.print()

  const alertasCriticas = (alertas?.clientes || []).filter((c) => c.variacion_yoy < -30).slice(0, 10)
  const alertasRiesgo   = (alertas?.clientes || []).filter((c) => c.variacion_yoy >= -30 && c.variacion_yoy < -10).slice(0, 10)

  const hallazgosList = hallazgos?.hallazgos || hallazgos?.data || []

  return (
    <div className="space-y-4">
      {/* Screen-only controls */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-slate-400" />
          <h1 className="text-lg font-semibold text-slate-100">Reporte Ejecutivo</h1>
          <span className="text-xs text-slate-500 bg-surface-800 px-2 py-0.5 rounded-full border border-surface-600">
            {period}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          <button
            onClick={doPrint}
            className="flex items-center gap-2 text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl transition-colors"
          >
            <Printer size={14} /> Imprimir / Guardar PDF
          </button>
        </div>
      </div>

      {/* Print hint */}
      <div className="p-3 bg-surface-800 border border-surface-700 rounded-xl text-xs text-slate-400 print:hidden">
        <span className="font-medium text-slate-300">Consejo:</span> Al imprimir, selecciona "Guardar como PDF" en el destino para generar el archivo PDF. Usa orientación horizontal para mejor resultado.
      </div>

      {loading && !kpis && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Preparando reporte…
        </div>
      )}

      {/* ── REPORT CONTENT ── */}
      {kpis && (
        <div ref={printRef} className="space-y-6 print:space-y-4">
          {/* Cover header — print only shows this prominently */}
          <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 print:border-0 print:bg-white print:rounded-none print:border-b-2 print:border-gray-800">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-100 print:text-black">Reporte Ejecutivo de Ventas</h1>
                <p className="text-sm text-slate-400 print:text-gray-600 mt-1">ALICO SAS BIC · Centro de Inteligencia de Negocio</p>
                <p className="text-sm text-slate-300 print:text-gray-800 mt-2 font-medium">{period}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 print:text-gray-500">Generado el</p>
                <p className="text-sm text-slate-300 print:text-gray-700 font-medium">{HOY}</p>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <Section title="Indicadores Clave de Desempeño">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:grid-cols-4">
              <KpiBox
                label="Ventas Netas"
                value={fmtCOP(kpis.ventas_netas)}
                sub={kpis.variacion_yoy != null ? `${kpis.variacion_yoy > 0 ? '+' : ''}${kpis.variacion_yoy?.toFixed(1)}% YoY` : null}
                up={kpis.variacion_yoy >= 0}
              />
              <KpiBox
                label="Clientes Activos"
                value={kpis.clientes_activos?.toLocaleString('es-CO') ?? '—'}
                sub={kpis.clientes_nuevos != null ? `${kpis.clientes_nuevos} nuevos` : null}
              />
              <KpiBox
                label="Ticket Promedio"
                value={fmtCOP(kpis.ticket_promedio)}
              />
              <KpiBox
                label="Transacciones"
                value={kpis.transacciones?.toLocaleString('es-CO') ?? '—'}
              />
            </div>
          </Section>

          {/* Alertas */}
          {(alertasCriticas.length > 0 || alertasRiesgo.length > 0) && (
            <Section title="Alertas de Clientes">
              {alertasCriticas.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400 mb-2 print:text-red-600">
                    <AlertTriangle size={12} /> Crítico — caída &gt; 30% YoY ({alertasCriticas.length} clientes)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs print:text-[10px]">
                      <thead>
                        <tr className="border-b border-surface-700 print:border-gray-300">
                          <th className="pb-1.5 text-left text-slate-400 print:text-gray-500">Cliente</th>
                          <th className="pb-1.5 text-right text-slate-400 print:text-gray-500">Ventas</th>
                          <th className="pb-1.5 text-right text-slate-400 print:text-gray-500">Var. YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertasCriticas.map((c, i) => (
                          <tr key={i} className="border-b border-surface-700/30 print:border-gray-200">
                            <td className="py-1 text-slate-200 print:text-black">{c.cliente || c.nombre || '—'}</td>
                            <td className="py-1 text-right text-slate-300 print:text-gray-800">{fmtCOP(c.ventas_netas)}</td>
                            <td className="py-1 text-right font-bold text-red-400 print:text-red-600">
                              {c.variacion_yoy?.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {alertasRiesgo.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-2 print:text-amber-600">
                    <AlertTriangle size={12} /> En riesgo — caída 10–30% YoY ({alertasRiesgo.length} clientes)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs print:text-[10px]">
                      <thead>
                        <tr className="border-b border-surface-700 print:border-gray-300">
                          <th className="pb-1.5 text-left text-slate-400 print:text-gray-500">Cliente</th>
                          <th className="pb-1.5 text-right text-slate-400 print:text-gray-500">Ventas</th>
                          <th className="pb-1.5 text-right text-slate-400 print:text-gray-500">Var. YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertasRiesgo.map((c, i) => (
                          <tr key={i} className="border-b border-surface-700/30 print:border-gray-200">
                            <td className="py-1 text-slate-200 print:text-black">{c.cliente || c.nombre || '—'}</td>
                            <td className="py-1 text-right text-slate-300 print:text-gray-800">{fmtCOP(c.ventas_netas)}</td>
                            <td className="py-1 text-right font-bold text-amber-400 print:text-amber-600">
                              {c.variacion_yoy?.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Hallazgos */}
          {hallazgosList.length > 0 && (
            <Section title="Hallazgos y Recomendaciones">
              <div className="space-y-2">
                {hallazgosList.slice(0, 8).map((h, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 print:border-gray-200 print:bg-white">
                    <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      h.tipo === 'alerta' ? 'bg-red-500' :
                      h.tipo === 'oportunidad' ? 'bg-emerald-500' : 'bg-brand-500'
                    }`} />
                    <div>
                      <p className="text-xs font-medium text-slate-200 print:text-black">{h.titulo || h.title}</p>
                      <p className="text-xs text-slate-400 print:text-gray-600 mt-0.5">{h.descripcion || h.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Footer */}
          <div className="text-xs text-slate-600 print:text-gray-400 text-center pt-4 border-t border-surface-700 print:border-gray-300">
            Reporte generado automáticamente por el Centro de Inteligencia de Negocio ALICO SAS BIC ·{' '}
            Período: {period} · Fecha: {HOY}
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          header, nav, aside { display: none !important; }
          main { padding-top: 0 !important; }
          .max-w-\\[1800px\\] { max-width: 100% !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  )
}
