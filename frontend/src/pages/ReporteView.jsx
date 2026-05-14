import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Printer, RefreshCw, FileText, AlertTriangle } from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { fmtCOP } from '../utils/format'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'

const HOY = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })

const MN_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MN_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function formatPeriodo(ano, mes, mes_fin) {
  if (!mes) return `Año ${ano}`
  if (!mes_fin || mes_fin === mes) return `${MN_LARGO[mes - 1]} ${ano}`
  return `${MN_LARGO[mes - 1]} – ${MN_LARGO[mes_fin - 1]} ${ano}`
}

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

const SEG_RFM_COLOR = {
  'Campeón': '#22c55e', 'Cliente Leal': '#3b82f6', 'Potencial Leal': '#06b6d4',
  'Cliente Reciente': '#a78bfa', 'En Riesgo': '#f59e0b', 'Necesita Atención': '#f97316',
  'Hibernando': '#6b7280', 'Perdido': '#ef4444',
}
const SEG_CLV_COLOR = { Platinum: '#e2e8f0', Gold: '#fbbf24', Silver: '#94a3b8', Bronze: '#b45309' }
const RIESGO_COLOR  = { Alto: '#ef4444', Medio: '#f59e0b', Bajo: '#22c55e' }
const ABC_COLOR     = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }

export function ReporteView() {
  const { refreshKey } = useOutletContext()
  const { filters }    = useFilters()

  const [kpis,       setKpis]      = useState(null)
  const [alertas,    setAlertas]   = useState(null)
  const [hallazgos,  setHallazgos] = useState(null)
  const [rfmData,    setRfm]       = useState(null)
  const [churnData,  setChurn]     = useState(null)
  const [abcData,    setAbc]       = useState(null)
  const [paretoData, setPareto]    = useState(null)
  const [clvData,    setClv]       = useState(null)
  const [trends,     setTrends]    = useState(null)
  const [regiones,   setRegiones]  = useState(null)
  const [loading,    setLoading]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const exclPvta = filters.excl_pvta !== false
      const region   = filters._regiones?.[0] ?? filters.region ?? null
      const vendedor = filters._vendedores?.[0] ?? filters.vendedor ?? null
      const [k, a, h, rfm, churn, abc, pareto, clv, tr, reg] = await Promise.allSettled([
        api.kpis(filters),
        api.alertas(filters, -20, true),
        api.hallazgos(filters),
        api.rfm(filters.ano, filters.mes, exclPvta, 500, filters.mes_fin),
        api.churn(filters.ano, exclPvta, 200),
        api.abcxyz(filters.ano, filters.mes, exclPvta, 500, filters.mes_fin),
        api.getClientesPareto(filters.ano, filters.mes, 'region', null, filters.mes_fin, exclPvta, filters.excl_exportacion ?? false, region, vendedor),
        api.clv(filters.ano, exclPvta, 200),
        api.trends(filters),
        api.presupuesto(filters, 'region', 20),
      ])
      if (k.status === 'fulfilled')      setKpis(k.value)
      if (a.status === 'fulfilled')      setAlertas(a.value)
      if (h.status === 'fulfilled')      setHallazgos(h.value)
      if (rfm.status === 'fulfilled')    setRfm(rfm.value)
      if (churn.status === 'fulfilled')  setChurn(churn.value)
      if (abc.status === 'fulfilled')    setAbc(abc.value)
      if (pareto.status === 'fulfilled') setPareto(pareto.value)
      if (clv.status === 'fulfilled')    setClv(clv.value)
      if (tr.status === 'fulfilled')     setTrends(tr.value)
      if (reg.status === 'fulfilled')    setRegiones(reg.value)
    } finally { setLoading(false) }
  }, [filters])

  useEffect(() => { load() }, [load])

  const period = formatPeriodo(filters.ano, filters.mes, filters.mes_fin)

  // Build active-filter context for the report cover and narrative
  const filterCtx = []
  const _r  = filters._regiones?.length   ? filters._regiones.join(', ')            : filters.region           || null
  const _v  = filters._vendedores?.length  ? filters._vendedores.join(', ')          : filters.vendedor         || null
  const _gc = filters._grupos_comerciales?.length ? filters._grupos_comerciales.join(', ') : filters.grupo_comercial || null
  const _pl = filters._plantas?.length     ? filters._plantas.join(', ')             : filters.planta           || null
  const _me = filters._mercados?.length    ? filters._mercados.join(', ')            : filters.mercado          || null
  if (_v)  filterCtx.push({ label: 'Asesor',           value: _v  })
  if (_r)  filterCtx.push({ label: 'Región',           value: _r  })
  if (_gc) filterCtx.push({ label: 'Grupo Comercial',  value: _gc })
  if (_pl) filterCtx.push({ label: 'Línea de Negocio', value: _pl })
  if (_me) filterCtx.push({ label: 'Mercado',          value: _me })
  const isFiltered  = filterCtx.length > 0
  const scopeTitle  = isFiltered ? filterCtx.map((f) => `${f.label}: ${f.value}`).join(' · ') : 'Alcance General'
  const scopeNarr   = isFiltered
    ? `Este informe analiza el desempeño de <strong>${filterCtx.map((f) => `${f.label} ${f.value}`).join(', ')}</strong> durante ${period}.`
    : `Este informe resume el desempeño comercial global de ALICO SAS BIC durante ${period}.`

  const alertasCriticas = (alertas?.clientes || []).filter((c) => c.variacion_yoy < -30).slice(0, 10)
  const alertasRiesgo   = (alertas?.clientes || []).filter((c) => c.variacion_yoy >= -30 && c.variacion_yoy < -10).slice(0, 10)
  const hallazgosList   = hallazgos?.hallazgos || hallazgos?.data || []

  // RFM resumen
  const rfmResumen  = rfmData?.resumen || {}
  const rfmTotal    = Object.values(rfmResumen).reduce((s, v) => s + v, 0)
  const rfmTop      = rfmData?.data?.slice(0, 5) || []

  // Churn
  const churnRes    = churnData?.resumen || {}
  const churnTop    = (churnData?.data || []).filter((r) => r.riesgo === 'Alto').slice(0, 8)

  // ABC/XYZ
  const abcResumen  = abcData?.resumen || {}
  const abcA        = (abcData?.data || []).filter((r) => r.abc === 'A').slice(0, 8)

  // Pareto — mostrar solo los clientes que componen el 80%, no un límite fijo
  const pareto80Count  = paretoData?.pareto_80_count || 0
  const paretoTotal    = paretoData?.total_sales || 0
  const paretoAllClients = paretoData?.clients || []
  // Mostrar hasta el corte 80% + 3 siguientes para contexto (máx 30 en pantalla)
  const paretoClients = paretoAllClients.slice(0, Math.min(Math.max(pareto80Count + 3, 10), 30))

  // CLV
  const clvResumen = clvData?.resumen || {}
  const clvTop     = (clvData?.data || []).slice(0, 8)

  const isReady = kpis || rfmData || churnData

  return (
    <div className="space-y-4">
      {/* Controls */}
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
            onClick={() => window.print()}
            className="flex items-center gap-2 text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-xl transition-colors"
          >
            <Printer size={14} /> Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="p-3 bg-surface-800 border border-surface-700 rounded-xl text-xs text-slate-400 print:hidden">
        <span className="font-medium text-slate-300">Consejo:</span> Al imprimir selecciona "Guardar como PDF". Orientación horizontal recomendada.
        {filters.mes && filters.mes_fin && <span className="ml-2 text-cyan-400">Período: {MN_CORTO[filters.mes-1]} – {MN_CORTO[filters.mes_fin-1]} {filters.ano} ({filters.mes_fin - filters.mes + 1} meses)</span>}
      </div>

      {loading && !isReady && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Preparando reporte…
        </div>
      )}

      {isReady && (
        <div className="space-y-6 print:space-y-4">
          {/* Cover */}
          <div className="bg-surface-800 border border-surface-700 rounded-2xl p-6 print:border-0 print:bg-white print:border-b-2 print:border-gray-800">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-slate-100 print:text-black">
                  Reporte Ejecutivo de Ventas
                </h1>
                <p className="text-sm text-slate-400 print:text-gray-600 mt-1">ALICO SAS BIC · Centro de Inteligencia de Negocio</p>
                <p className="text-sm text-slate-300 print:text-gray-800 mt-2 font-semibold">{period}</p>
                {isFiltered ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filterCtx.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-600/20 text-brand-300 border border-brand-500/30 print:bg-blue-50 print:text-blue-800 print:border-blue-300">
                        <span className="text-brand-500 print:text-blue-500">{f.label}:</span> {f.value}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 print:text-gray-500">Alcance: todas las regiones, asesores y canales</p>
                )}
              </div>
              <div className="text-right ml-4 shrink-0">
                <p className="text-xs text-slate-500 print:text-gray-500">Generado el</p>
                <p className="text-sm text-slate-300 print:text-gray-700 font-medium">{HOY}</p>
                <p className={`mt-2 text-xs font-bold px-2 py-0.5 rounded-full ${isFiltered ? 'bg-brand-600/20 text-brand-300 print:bg-blue-100 print:text-blue-800' : 'bg-surface-700 text-slate-400 print:bg-gray-100 print:text-gray-600'}`}>
                  {isFiltered ? 'Segmentado' : 'General'}
                </p>
              </div>
            </div>
          </div>

          {/* Resumen ejecutivo interpretativo */}
          {(kpis || rfmTotal > 0 || churnRes.Alto > 0) && (
            <Section title="Resumen Ejecutivo">
              <ul className="space-y-2 text-xs">
                <li className="flex gap-2 p-2.5 rounded-lg border border-surface-600 bg-surface-800 print:bg-white print:border-gray-200">
                  <span className="font-bold text-brand-400 print:text-black shrink-0">▶</span>
                  <span className="text-slate-300 print:text-black" dangerouslySetInnerHTML={{ __html: scopeNarr }} />
                </li>
                {kpis?.variacion_yoy != null && (
                  <li className={`flex gap-2 p-2.5 rounded-lg border ${kpis.variacion_yoy >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'} print:bg-white print:border-gray-200`}>
                    <span className={`font-bold ${kpis.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'} print:text-black shrink-0`}>▶</span>
                    <span className="text-slate-300 print:text-black">
                      Ventas netas <strong>{fmtCOP(kpis.ventas_netas)}</strong> — variación YoY de <strong className={kpis.variacion_yoy >= 0 ? 'text-emerald-400' : 'text-red-400'}>{kpis.variacion_yoy > 0 ? '+' : ''}{kpis.variacion_yoy.toFixed(1)}%</strong> respecto al año anterior.
                    </span>
                  </li>
                )}
                {pareto80Count > 0 && paretoTotal > 0 && (
                  <li className="flex gap-2 p-2.5 rounded-lg border border-brand-500/20 bg-brand-500/5 print:bg-white print:border-gray-200">
                    <span className="font-bold text-brand-400 print:text-black shrink-0">▶</span>
                    <span className="text-slate-300 print:text-black">
                      Solo <strong>{pareto80Count} cliente{pareto80Count !== 1 ? 's' : ''}</strong> ({((pareto80Count / (paretoAllClients.length || 1)) * 100).toFixed(1)}% del total) concentran el <strong>80%</strong> de las ventas — <strong>{fmtCOP(paretoTotal * 0.8)}</strong>. Alta concentración de riesgo.
                    </span>
                  </li>
                )}
                {rfmTotal > 0 && rfmResumen['Campeón'] != null && (
                  <li className="flex gap-2 p-2.5 rounded-lg border border-surface-600 bg-surface-800 print:bg-white print:border-gray-200">
                    <span className="font-bold text-green-400 print:text-black shrink-0">▶</span>
                    <span className="text-slate-300 print:text-black">
                      RFM: <strong className="text-green-400">{rfmResumen['Campeón'] || 0} Campeones</strong> y <strong className="text-blue-400">{rfmResumen['Cliente Leal'] || 0} Leales</strong>.{' '}
                      {(rfmResumen['En Riesgo'] || 0) + (rfmResumen['Perdido'] || 0) > 0 && (
                        <><strong className="text-red-400">{(rfmResumen['En Riesgo'] || 0) + (rfmResumen['Perdido'] || 0)} clientes en riesgo o perdidos</strong> requieren atención inmediata.</>
                      )}
                    </span>
                  </li>
                )}
                {churnRes.Alto > 0 && (
                  <li className="flex gap-2 p-2.5 rounded-lg border border-red-500/20 bg-red-500/5 print:bg-white print:border-gray-200">
                    <span className="font-bold text-red-400 print:text-black shrink-0">▶</span>
                    <span className="text-slate-300 print:text-black">
                      Predicción Churn: <strong className="text-red-400">{churnRes.Alto} clientes con riesgo ALTO</strong> de abandono y <strong className="text-amber-400">{churnRes.Medio || 0} con riesgo MEDIO</strong>. Se recomienda acción preventiva inmediata en el segmento alto.
                    </span>
                  </li>
                )}
                {clvResumen.total_clv > 0 && (
                  <li className="flex gap-2 p-2.5 rounded-lg border border-surface-600 bg-surface-800 print:bg-white print:border-gray-200">
                    <span className="font-bold text-amber-400 print:text-black shrink-0">▶</span>
                    <span className="text-slate-300 print:text-black">
                      CLV total estimado: <strong>{fmtCOP(clvResumen.total_clv)}</strong>. Clientes Platinum: <strong className="text-slate-200">{clvResumen.por_segmento?.Platinum || 0}</strong> · Gold: <strong className="text-amber-400">{clvResumen.por_segmento?.Gold || 0}</strong>.
                    </span>
                  </li>
                )}
                {Object.keys(abcResumen).length > 0 && (() => {
                  const totalABC = Object.values(abcResumen).reduce((s,v) => s+v, 0)
                  const countA = Object.entries(abcResumen).filter(([k]) => k.startsWith('A')).reduce((s,[,v]) => s+v, 0)
                  return totalABC > 0 ? (
                    <li className="flex gap-2 p-2.5 rounded-lg border border-surface-600 bg-surface-800 print:bg-white print:border-gray-200">
                      <span className="font-bold text-emerald-400 print:text-black shrink-0">▶</span>
                      <span className="text-slate-300 print:text-black">
                        ABC/XYZ: <strong className="text-emerald-400">{countA} clientes categoría A</strong> ({(countA/totalABC*100).toFixed(0)}%) generan el 80% de las ventas. El {(100 - countA/totalABC*100).toFixed(0)}% restante de clientes contribuye solo el 20%.
                      </span>
                    </li>
                  ) : null
                })()}
              </ul>
            </Section>
          )}

          {/* KPIs */}
          {kpis && (
            <Section title="Indicadores Clave de Desempeño">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:grid-cols-4">
                <KpiBox label="Ventas Netas" value={fmtCOP(kpis.ventas_netas)}
                  sub={kpis.variacion_yoy != null ? `${kpis.variacion_yoy > 0 ? '+' : ''}${kpis.variacion_yoy?.toFixed(1)}% vs año ant.` : null}
                  up={kpis.variacion_yoy >= 0} />
                <KpiBox label="Clientes Activos" value={kpis.clientes_activos?.toLocaleString('es-CO') ?? '—'}
                  sub={kpis.clientes_nuevos != null ? `${kpis.clientes_nuevos} nuevos` : null} />
                <KpiBox label="Ticket Promedio" value={fmtCOP(kpis.ticket_promedio)} />
                <KpiBox label="Transacciones" value={kpis.transacciones?.toLocaleString('es-CO') ?? '—'} />
              </div>
            </Section>
          )}

          {/* Tendencia mensual */}
          {(trends?.series || []).length > 0 && (() => {
            const series = trends.series.map((d) => ({
              mes:    MN_CORTO[(d.mes || 1) - 1],
              ventas: Math.round(d.ventas_netas || 0),
              pp:     Math.round(d.presupuesto || 0),
              ant:    Math.round(d.venta_ano_anterior || 0),
            }))
            const fmtY = (v) => v >= 1e9 ? `$${(v/1e9).toFixed(1)}MM` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`
            return (
              <Section title={`Evolución Mensual de Ventas ${filters.ano}`}>
                {/* Screen version */}
                <div className="print:hidden">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 4 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={fmtY} width={48} />
                      <Tooltip
                        formatter={(v, name) => [fmtCOP(v), name]}
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="ant"    name="Año Ant."   fill="#4b5563" radius={[2,2,0,0]} barSize={12} />
                      <Bar dataKey="pp"     name="Presupuesto" fill="#F8A62B" radius={[2,2,0,0]} barSize={12} fillOpacity={0.75} />
                      <Bar dataKey="ventas" name="Ventas"     fill="#818cf8" radius={[2,2,0,0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Print-friendly table fallback */}
                <div className="hidden print:block">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-gray-300 text-gray-600">
                        <th className="pb-1 text-left">Mes</th>
                        <th className="pb-1 text-right">Ventas</th>
                        <th className="pb-1 text-right">Presupuesto</th>
                        <th className="pb-1 text-right">Año Ant.</th>
                        <th className="pb-1 text-right">Cump. PP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((d, i) => {
                        const cump = d.pp > 0 ? (d.ventas / d.pp * 100) : null
                        return (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-0.5 text-black font-medium">{d.mes}</td>
                            <td className="py-0.5 text-right text-blue-700 font-semibold">{fmtCOP(d.ventas)}</td>
                            <td className="py-0.5 text-right text-amber-700">{fmtCOP(d.pp)}</td>
                            <td className="py-0.5 text-right text-gray-600">{fmtCOP(d.ant)}</td>
                            <td className={`py-0.5 text-right font-bold ${cump == null ? 'text-gray-400' : cump >= 100 ? 'text-green-700' : cump >= 80 ? 'text-blue-700' : 'text-red-600'}`}>
                              {cump != null ? `${cump.toFixed(0)}%` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            )
          })()}

          {/* Desempeño por Región */}
          {(regiones?.data || []).length > 0 && (() => {
            const rows = regiones.data.map((d) => ({
              name:   (d.dimension || '').length > 16 ? d.dimension.slice(0, 14) + '…' : (d.dimension || ''),
              full:   d.dimension || '',
              ventas: Math.round(d.ventas_netas || 0),
              pp:     Math.round(d.presupuesto  || 0),
              cump:   d.cumplimiento_pct,
              yoy:    d.variacion_yoy_pct,
            }))
            const fmtY = (v) => v >= 1e9 ? `$${(v/1e9).toFixed(0)}MM` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v}`
            return (
              <Section title="Desempeño por Región">
                <div className="print:hidden">
                  <ResponsiveContainer width="100%" height={Math.max(rows.length * 38 + 30, 180)}>
                    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 140, left: 8, bottom: 4 }} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={fmtY} />
                      <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
                      <Tooltip
                        formatter={(v, name) => [fmtCOP(v), name]}
                        contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                        labelFormatter={(l, p) => p?.[0]?.payload?.full || l}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Bar dataKey="ventas" name="Ventas" fill="#818cf8" radius={[0,3,3,0]} barSize={14} />
                      <Bar dataKey="pp"     name="PP"     fill="#F8A62B" radius={[0,3,3,0]} barSize={14} fillOpacity={0.7} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="hidden print:block">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-gray-300 text-gray-600">
                        <th className="pb-1 text-left">Región</th>
                        <th className="pb-1 text-right">Ventas</th>
                        <th className="pb-1 text-right">PP</th>
                        <th className="pb-1 text-right">Cump.</th>
                        <th className="pb-1 text-right">YoY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-0.5 text-black font-medium">{d.full}</td>
                          <td className="py-0.5 text-right text-blue-700 font-semibold">{fmtCOP(d.ventas)}</td>
                          <td className="py-0.5 text-right text-amber-700">{fmtCOP(d.pp)}</td>
                          <td className={`py-0.5 text-right font-bold ${d.cump == null ? 'text-gray-400' : d.cump >= 100 ? 'text-green-700' : d.cump >= 80 ? 'text-blue-700' : 'text-red-600'}`}>
                            {d.cump != null ? `${d.cump.toFixed(0)}%` : '—'}
                          </td>
                          <td className={`py-0.5 text-right font-bold ${d.yoy == null ? 'text-gray-400' : d.yoy >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {d.yoy != null ? `${d.yoy >= 0 ? '+' : ''}${d.yoy.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )
          })()}

          {/* Pareto clientes */}
          {paretoClients.length > 0 && (
            <Section title={`Clientes Pareto — Top ${paretoClients.length} (${pareto80Count} representan el 80% de ventas)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs print:text-[10px]">
                  <thead>
                    <tr className="border-b border-surface-700 print:border-gray-300 text-slate-400 print:text-gray-600">
                      <th className="pb-2 text-left">#</th>
                      <th className="pb-2 text-left">Cliente</th>
                      <th className="pb-2 text-right">Ventas</th>
                      <th className="pb-2 text-right">% Total</th>
                      <th className="pb-2 text-right">% Acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paretoClients.map((c, i) => (
                      <tr key={i} className={`border-b border-surface-700/30 print:border-gray-200 ${c.pct_acumulado <= 80 ? 'bg-emerald-500/5' : ''}`}>
                        <td className="py-1 text-slate-500 print:text-gray-500">{i + 1}</td>
                        <td className="py-1 text-slate-200 print:text-black font-medium">{c.nombre}</td>
                        <td className="py-1 text-right text-brand-300 print:text-blue-700 font-medium">{fmtCOP(c.ventas)}</td>
                        <td className="py-1 text-right text-slate-400 print:text-gray-600">{c.pct_total?.toFixed(1)}%</td>
                        <td className="py-1 text-right font-bold" style={{ color: c.pct_acumulado <= 80 ? '#22c55e' : '#94a3b8' }}>
                          {c.pct_acumulado?.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2 print:text-gray-500">
                Total ventas en el período: {fmtCOP(paretoTotal)} · Filas en verde = clientes que componen el 80%
              </p>
            </Section>
          )}

          {/* RFM */}
          {rfmTotal > 0 && (
            <Section title={`Segmentación RFM — ${rfmTotal} clientes analizados`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Distribución por segmento</p>
                  <div className="space-y-1.5">
                    {Object.entries(rfmResumen).filter(([,v]) => v > 0).map(([seg, cnt]) => (
                      <div key={seg} className="flex items-center gap-2">
                        <div className="w-20 text-xs font-medium truncate" style={{ color: SEG_RFM_COLOR[seg] || '#94a3b8' }}>{seg}</div>
                        <div className="flex-1 bg-surface-700 print:bg-gray-200 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full" style={{ width: `${(cnt / rfmTotal * 100).toFixed(0)}%`, background: SEG_RFM_COLOR[seg] || '#6b7280' }} />
                        </div>
                        <div className="text-xs text-slate-300 print:text-gray-700 w-8 text-right font-bold">{cnt}</div>
                        <div className="text-xs text-slate-500 print:text-gray-500 w-10 text-right">{(cnt / rfmTotal * 100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
                {rfmTop.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Top clientes por score RFM</p>
                    <table className="w-full text-xs print:text-[10px]">
                      <thead>
                        <tr className="text-slate-400 print:text-gray-600 border-b border-surface-700 print:border-gray-300">
                          <th className="pb-1 text-left">Cliente</th>
                          <th className="pb-1 text-center">RFM</th>
                          <th className="pb-1 text-left">Segmento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rfmTop.map((r, i) => (
                          <tr key={i} className="border-b border-surface-800 print:border-gray-100">
                            <td className="py-1 text-slate-200 print:text-black truncate max-w-[120px]">{r.nombre_cliente}</td>
                            <td className="py-1 text-center font-bold text-slate-100 print:text-black">{r.score_rfm}</td>
                            <td className="py-1" style={{ color: SEG_RFM_COLOR[r.segmento] || '#94a3b8' }}>{r.segmento}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* CLV */}
          {clvTop.length > 0 && (
            <Section title={`Customer Lifetime Value — CLV Total: ${fmtCOP(clvResumen.total_clv || 0)}`}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Segmentación por valor</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['Platinum','Gold','Silver','Bronze'].map((s) => (
                      <div key={s} className="bg-surface-800 print:bg-white print:border print:border-gray-200 rounded-lg p-2 text-center">
                        <p className="text-xs font-bold" style={{ color: SEG_CLV_COLOR[s] }}>{s}</p>
                        <p className="text-lg font-bold text-slate-100 print:text-black">{clvResumen.por_segmento?.[s] || 0}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Top clientes por CLV estimado</p>
                  <table className="w-full text-xs print:text-[10px]">
                    <thead>
                      <tr className="text-slate-400 print:text-gray-600 border-b border-surface-700 print:border-gray-300">
                        <th className="pb-1 text-left">Cliente</th>
                        <th className="pb-1 text-right">CLV</th>
                        <th className="pb-1 text-left">Seg.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clvTop.map((r, i) => (
                        <tr key={i} className="border-b border-surface-800 print:border-gray-100">
                          <td className="py-0.5 text-slate-200 print:text-black truncate max-w-[130px]">{r.nombre_cliente}</td>
                          <td className="py-0.5 text-right font-bold text-slate-100 print:text-black">
                            {r.clv_estimado >= 1e6 ? `$${(r.clv_estimado/1e6).toFixed(1)}M` : `$${(r.clv_estimado/1e3).toFixed(0)}K`}
                          </td>
                          <td className="py-0.5 text-xs font-medium" style={{ color: SEG_CLV_COLOR[r.segmento] }}>{r.segmento}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Section>
          )}

          {/* ABC/XYZ */}
          {Object.keys(abcResumen).length > 0 && (
            <Section title="Clasificación ABC/XYZ de Clientes">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Distribución por categoría ABC</p>
                  {['A','B','C'].map((abc) => {
                    const total = Object.entries(abcResumen).filter(([k]) => k.startsWith(abc)).reduce((s,[,v]) => s+v, 0)
                    const grandTotal = Object.values(abcResumen).reduce((s,v) => s+v, 0)
                    return (
                      <div key={abc} className="flex items-center gap-2 mb-1.5">
                        <span className="w-5 text-sm font-bold" style={{ color: ABC_COLOR[abc] }}>{abc}</span>
                        <div className="flex-1 bg-surface-700 print:bg-gray-200 rounded-full h-2">
                          <div className="h-2 rounded-full" style={{ width: `${grandTotal ? (total/grandTotal*100).toFixed(0) : 0}%`, background: ABC_COLOR[abc] }} />
                        </div>
                        <span className="text-xs font-bold text-slate-200 print:text-black w-8 text-right">{total}</span>
                        <span className="text-xs text-slate-500 print:text-gray-500 w-10 text-right">{grandTotal ? (total/grandTotal*100).toFixed(0) : 0}%</span>
                      </div>
                    )
                  })}
                </div>
                {abcA.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Clientes A — mayor contribución</p>
                    <table className="w-full text-xs print:text-[10px]">
                      <tbody>
                        {abcA.map((r, i) => (
                          <tr key={i} className="border-b border-surface-800 print:border-gray-100">
                            <td className="py-0.5 text-slate-200 print:text-black truncate max-w-[140px]">{r.nombre_cliente}</td>
                            <td className="py-0.5 text-right text-emerald-400 print:text-green-700 font-medium">
                              {r.ventas_netas >= 1e6 ? `$${(r.ventas_netas/1e6).toFixed(1)}M` : `$${(r.ventas_netas/1e3).toFixed(0)}K`}
                            </td>
                            <td className="py-0.5 text-right text-slate-400 print:text-gray-500">{r.cum_pct?.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Churn */}
          {(churnRes.Alto > 0 || churnRes.Medio > 0) && (
            <Section title="Predicción de Abandono (Churn)">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {['Alto','Medio','Bajo'].map((r) => (
                      <div key={r} className="rounded-xl p-3 text-center bg-surface-800 print:bg-white print:border print:border-gray-200">
                        <p className="text-xs font-bold" style={{ color: RIESGO_COLOR[r] }}>{r}</p>
                        <p className="text-xl font-bold" style={{ color: RIESGO_COLOR[r] }}>{churnRes[r] || 0}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 print:text-gray-500">
                    Método: {churnData?.metodo === 'logistic_regression' ? 'Regresión Logística' : 'Heurístico'}
                  </p>
                </div>
                {churnTop.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-2 print:text-gray-500">Clientes en riesgo ALTO</p>
                    <table className="w-full text-xs print:text-[10px]">
                      <thead>
                        <tr className="text-slate-400 print:text-gray-600 border-b border-surface-700 print:border-gray-300">
                          <th className="pb-1 text-left">Cliente</th>
                          <th className="pb-1 text-right">Prob.</th>
                          <th className="pb-1 text-right">Var. YoY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {churnTop.map((r, i) => (
                          <tr key={i} className="border-b border-surface-800 print:border-gray-100">
                            <td className="py-0.5 text-slate-200 print:text-black truncate max-w-[130px]">{r.nombre_cliente}</td>
                            <td className="py-0.5 text-right font-bold text-red-400 print:text-red-600">{r.prob_churn.toFixed(0)}%</td>
                            <td className={`py-0.5 text-right ${r.variacion_yoy < 0 ? 'text-red-400 print:text-red-600' : 'text-emerald-400 print:text-green-700'}`}>
                              {r.variacion_yoy != null ? `${r.variacion_yoy > 0 ? '+' : ''}${r.variacion_yoy.toFixed(0)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Alertas */}
          {(alertasCriticas.length > 0 || alertasRiesgo.length > 0) && (
            <Section title="Alertas de Clientes">
              {alertasCriticas.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-red-400 print:text-red-600 mb-2 flex items-center gap-1">
                    <AlertTriangle size={12} /> Crítico — caída &gt;30% YoY ({alertasCriticas.length})
                  </p>
                  <table className="w-full text-xs print:text-[10px]">
                    <thead><tr className="border-b border-surface-700 print:border-gray-300 text-slate-400 print:text-gray-500">
                      <th className="pb-1 text-left">Cliente</th><th className="pb-1 text-right">Ventas</th><th className="pb-1 text-right">Var. YoY</th>
                    </tr></thead>
                    <tbody>{alertasCriticas.map((c, i) => (
                      <tr key={i} className="border-b border-surface-700/30 print:border-gray-200">
                        <td className="py-1 text-slate-200 print:text-black">{c.cliente || c.nombre || '—'}</td>
                        <td className="py-1 text-right text-slate-300 print:text-gray-800">{fmtCOP(c.ventas_netas)}</td>
                        <td className="py-1 text-right font-bold text-red-400 print:text-red-600">{c.variacion_yoy?.toFixed(1)}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {alertasRiesgo.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-400 print:text-amber-600 mb-2 flex items-center gap-1">
                    <AlertTriangle size={12} /> En riesgo — caída 10–30% YoY ({alertasRiesgo.length})
                  </p>
                  <table className="w-full text-xs print:text-[10px]">
                    <thead><tr className="border-b border-surface-700 print:border-gray-300 text-slate-400 print:text-gray-500">
                      <th className="pb-1 text-left">Cliente</th><th className="pb-1 text-right">Ventas</th><th className="pb-1 text-right">Var. YoY</th>
                    </tr></thead>
                    <tbody>{alertasRiesgo.map((c, i) => (
                      <tr key={i} className="border-b border-surface-700/30 print:border-gray-200">
                        <td className="py-1 text-slate-200 print:text-black">{c.cliente || c.nombre || '—'}</td>
                        <td className="py-1 text-right text-slate-300 print:text-gray-800">{fmtCOP(c.ventas_netas)}</td>
                        <td className="py-1 text-right font-bold text-amber-400 print:text-amber-600">{c.variacion_yoy?.toFixed(1)}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
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
                      h.tipo === 'alerta' ? 'bg-red-500' : h.tipo === 'oportunidad' ? 'bg-emerald-500' : 'bg-brand-500'
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

          <div className="text-xs text-slate-600 print:text-gray-400 text-center pt-4 border-t border-surface-700 print:border-gray-300">
            Reporte generado automáticamente · ALICO SAS BIC · Período: {period} · {HOY}
          </div>
        </div>
      )}

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
