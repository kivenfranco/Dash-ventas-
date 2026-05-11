import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Download, ChevronLeft, ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'

const ABC_PAGE = 50
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
  BarChart, Bar, Cell as BarCell,
} from 'recharts'

const ABC_COLOR  = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }
const XYZ_COLOR  = { X: '#3b82f6', Y: '#a78bfa', Z: '#f97316' }
const CLASE_BG   = {
  AX: 'bg-emerald-500/20 text-emerald-300', AY: 'bg-emerald-500/10 text-emerald-400',
  AZ: 'bg-yellow-500/10 text-yellow-300',
  BX: 'bg-blue-500/15 text-blue-300',       BY: 'bg-blue-500/10 text-blue-400',
  BZ: 'bg-purple-500/10 text-purple-400',
  CX: 'bg-slate-700 text-slate-300',         CY: 'bg-slate-700 text-slate-400',
  CZ: 'bg-red-500/10 text-red-400',
}

const CLASE_DESC = {
  AX: 'Alto valor, compra regular',    AY: 'Alto valor, compra variable',  AZ: 'Alto valor, compra errática',
  BX: 'Valor medio, compra regular',   BY: 'Valor medio, compra variable', BZ: 'Valor medio, compra errática',
  CX: 'Bajo valor, compra regular',    CY: 'Bajo valor, compra variable',  CZ: 'Bajo valor, compra errática',
}

const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const fmt = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v}`

const MATRIX_CELLS = [
  ['AX','AY','AZ'],
  ['BX','BY','BZ'],
  ['CX','CY','CZ'],
]

export function ABCXYZView() {
  const { refreshKey }          = useOutletContext()
  const { filters }             = useFilters()
  const [abcData, setAbcData]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState('tabla')
  const [claseFilter, setClase] = useState('Todos')
  const [page, setPage]         = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    api.abcxyz(filters.ano, filters.mes, true, 500, filters.mes_fin)
      .then((d) => setAbcData(d))
      .catch((e) => setError(e?.response?.data?.detail || 'Error al cargar ABC/XYZ'))
      .finally(() => setLoading(false))
  }, [filters.ano, filters.mes, filters.mes_fin, refreshKey])

  const data    = abcData?.data || []
  const resumen = abcData?.resumen || {}

  const xyzValido  = abcData?.xyz_valido !== false
  const nMeses     = abcData?.n_meses || 0
  const clases    = ['Todos', ...(xyzValido ? Object.keys(CLASE_BG) : ['A','B','C'])]
  const filtered  = claseFilter === 'Todos' ? data : data.filter((r) => xyzValido ? r.clase === claseFilter : r.abc === claseFilter)
  const paretoData = data.map((r, i) => ({ i: i + 1, cum_pct: r.cum_pct }))

  const totalPages = Math.max(1, Math.ceil(filtered.length / ABC_PAGE))
  const pageRows   = filtered.slice(page * ABC_PAGE, (page + 1) * ABC_PAGE)

  // Reset page when filter changes
  const handleClaseChange = (val) => { setClase(val); setPage(0) }

  const periodoLabel = filters.mes
    ? `${MN[filters.mes - 1]}${filters.mes_fin && filters.mes_fin !== filters.mes ? ` – ${MN[filters.mes_fin - 1]}` : ''} ${filters.ano}`
    : filters.ano

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Clasificación ABC / XYZ — Clientes</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          ABC: concentración de ventas · XYZ: regularidad de compra — {periodoLabel}
        </p>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-3 text-xs space-y-1.5">
          <p className="font-semibold text-slate-300 mb-2">Clasificación ABC</p>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#22c55e20',color:'#22c55e'}}>A</span><span className="text-slate-400">Top 80% de ventas — clientes clave</span></div>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#f59e0b20',color:'#f59e0b'}}>B</span><span className="text-slate-400">Sig. 15% — clientes secundarios</span></div>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#ef444420',color:'#ef4444'}}>C</span><span className="text-slate-400">Resto 5% — clientes marginales</span></div>
        </div>
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-3 text-xs space-y-1.5">
          <p className="font-semibold text-slate-300 mb-2">Clasificación XYZ</p>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#3b82f620',color:'#3b82f6'}}>X</span><span className="text-slate-400">CV &lt; 0.5 — compra regular y estable</span></div>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#a78bfa20',color:'#a78bfa'}}>Y</span><span className="text-slate-400">0.5 ≤ CV &lt; 1.0 — compra variable</span></div>
          <div className="flex items-center gap-2"><span className="w-4 h-4 rounded font-bold text-center text-[10px] flex items-center justify-center" style={{background:'#f9731620',color:'#f97316'}}>Z</span><span className="text-slate-400">CV ≥ 1.0 — compra errática</span></div>
        </div>
      </div>

      {/* Matrix */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-3 font-medium">Matriz ABC × XYZ — cantidad de clientes</p>
        <div className="grid grid-cols-4 gap-2 max-w-sm">
          <div className="text-center" />
          {['X', 'Y', 'Z'].map((x) => (
            <div key={x} className="text-center text-xs font-bold" style={{ color: XYZ_COLOR[x] }}>{x}</div>
          ))}
          {MATRIX_CELLS.map((row, ri) => (
            <div key={ri} className="contents">
              <div className="text-xs font-bold flex items-center" style={{ color: ABC_COLOR[['A','B','C'][ri]] }}>
                {['A','B','C'][ri]}
              </div>
              {row.map((cls) => (
                <button
                  key={cls}
                  onClick={() => handleClaseChange(claseFilter === cls ? 'Todos' : cls)}
                  title={CLASE_DESC[cls]}
                  className={`rounded-lg p-3 text-center text-sm font-bold transition-all ${
                    claseFilter === cls ? 'ring-2 ring-brand-500 ' : ''
                  } ${CLASE_BG[cls] || 'bg-surface-800 text-slate-400'}`}
                >
                  {resumen[cls] || 0}
                  <div className="text-xs font-normal opacity-70">{cls}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['tabla','Tabla clientes'], ['pareto','Curva Pareto'], ['barras','Distribución']].map(([t, l]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
            }`}
          >
            {l}
          </button>
        ))}
        <select
          value={claseFilter}
          onChange={(e) => handleClaseChange(e.target.value)}
          className="ml-auto bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-xs text-slate-300"
        >
          {clases.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button
          onClick={() => {
            const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
              'N° Cliente': r.numero_cliente, 'Nombre': r.nombre_cliente,
              'Ventas': r.ventas_netas, 'Cum %': r.cum_pct,
              'ABC': r.abc, 'CV': r.cv, 'XYZ': r.xyz, 'Clase': r.clase,
            })))
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'ABCXYZ')
            XLSX.writeFile(wb, `abcxyz-${filters.ano}.xlsx`)
          }}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <Download size={12} /> Excel
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Cargando…</p>}
      {error   && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && !xyzValido && data.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">
          <span className="text-amber-400 font-bold mt-0.5">⚠</span>
          <span>
            <strong>XYZ no disponible</strong> — solo hay {nMeses} {nMeses === 1 ? 'mes' : 'meses'} de datos en el período seleccionado.
            La clasificación XYZ requiere ≥2 meses para calcular la variabilidad de compra. Se muestra solo la clasificación ABC.
          </span>
        </div>
      )}

      {tab === 'tabla' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-surface-700">
            <span className="text-xs text-slate-400">{filtered.length} clientes</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-700 text-slate-400">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-right px-4 py-3">Ventas</th>
                  <th className="text-right px-4 py-3">Cum %</th>
                  <th className="text-center px-3 py-3">ABC</th>
                  {xyzValido && <th className="text-right px-3 py-3">CV</th>}
                  {xyzValido && <th className="text-center px-3 py-3">XYZ</th>}
                  <th className="text-center px-3 py-3">Clase</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-surface-800 hover:bg-surface-800/50">
                    <td className="px-4 py-2 text-slate-500 text-xs">{page * ABC_PAGE + i + 1}</td>
                    <td className="px-4 py-2 font-mono text-slate-400 text-xs">{r.numero_cliente}</td>
                    <td className="px-4 py-2 text-slate-200 max-w-xs truncate">{r.nombre_cliente}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{fmt(r.ventas_netas)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{r.cum_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center font-bold text-base" style={{ color: ABC_COLOR[r.abc] }}>{r.abc}</td>
                    {xyzValido && <td className="px-3 py-2 text-right text-slate-400">{r.cv?.toFixed(2) ?? '—'}</td>}
                    {xyzValido && <td className="px-3 py-2 text-center font-bold text-base" style={{ color: XYZ_COLOR[r.xyz] }}>{r.xyz}</td>}
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CLASE_BG[r.clase] || 'bg-surface-700 text-slate-400'}`}>
                        {r.clase}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'barras' && !loading && (() => {
        const claseKeys = xyzValido ? Object.keys(CLASE_BG) : ['A','B','C']
        const barData = claseKeys
          .map((c) => ({ clase: c, count: resumen[c] || 0 }))
          .filter((d) => d.count > 0)
          .sort((a, b) => b.count - a.count)
        return (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 h-72">
            <p className="text-xs text-slate-400 mb-3">Clientes por clase — haz clic para filtrar</p>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={barData} margin={{ top: 2, right: 20, left: 4, bottom: 2 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="clase" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                  formatter={(v) => [v, 'Clientes']}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive maxBarSize={40}
                  label={{ position: 'top', fill: '#94a3b8', fontSize: 10 }}>
                  {barData.map((d, i) => {
                    const abc = d.clase[0]
                    const xyz = d.clase[1]
                    const color = xyzValido
                      ? (abc === 'A' ? '#22c55e' : abc === 'B' ? '#3b82f6' : '#ef4444')
                      : ABC_COLOR[abc]
                    return (
                      <BarCell key={i} fill={color}
                        fillOpacity={claseFilter === d.clase || claseFilter === 'Todos' ? 0.9 : 0.3}
                        cursor="pointer"
                        onClick={() => handleClaseChange(claseFilter === d.clase ? 'Todos' : d.clase)} />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })()}

      {tab === 'pareto' && !loading && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={paretoData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="i" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'Nro cliente', position: 'insideBottom', fill: '#94a3b8', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v) => `${v.toFixed(1)}%`} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
              <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 4" label={{ value: 'A 80%', fill: '#22c55e', fontSize: 11 }} />
              <ReferenceLine y={95} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'B 95%', fill: '#f59e0b', fontSize: 11 }} />
              <Line dataKey="cum_pct" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
