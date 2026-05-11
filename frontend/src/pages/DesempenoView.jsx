import { useState, useCallback, useEffect, useRef } from 'react'
import { useOutletContext, useLocation } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Users, Package, Activity,
  MapPin, User, Users2, ShoppingBag, RefreshCw, Search,
} from 'lucide-react'
import { api } from '../services/api'
import { useFilters } from '../context/FilterContext'
import { useAuth } from '../context/AuthContext'
import { fmtCOP, pctColor, MONTH_NAMES } from '../utils/format'

const DIM_TYPES = [
  { value: 'vendedor',        label: 'Vendedor',         icon: User,      placeholder: 'Ej: V001, MCRESP...' },
  { value: 'region',          label: 'Región',            icon: MapPin,    placeholder: 'Ej: ZONA ANTIOQUIA...' },
  { value: 'cliente',         label: 'Cliente',           icon: Users,     placeholder: 'Ej: 10001...' },
  { value: 'grupo_comercial', label: 'Grupo Comercial',   icon: ShoppingBag, placeholder: 'Ej: LAMINADOS...' },
]

const BAR_COLORS = ['#6366f1','#8b5cf6','#3b82f6','#06b6d4','#10b981','#f59e0b','#f97316','#ec4899','#94a3b8','#64748b']

function KpiCard({ label, value, sub, icon: Icon, color = 'text-brand-300', delta }) {
  return (
    <div className="bg-surface-800 rounded-2xl border border-surface-700 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        {Icon && <Icon size={14} className="text-slate-500" />}
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
      {delta != null && (
        <div className={`text-xs font-medium flex items-center gap-1 ${pctColor(delta)}`}>
          {delta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {delta > 0 ? '+' : ''}{delta?.toFixed(1)}% vs año ant.
        </div>
      )}
    </div>
  )
}

function fmtPeriodo(p) {
  const [y, m] = p.split('-')
  return `${MONTH_NAMES[+m]} ${y.slice(2)}`
}

const TrendTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-xs">
      <p className="text-slate-300 font-semibold mb-1">{fmtPeriodo(label)}</p>
      <p className="text-brand-300 font-bold">{fmtCOP(payload[0]?.value)}</p>
    </div>
  )
}

export function DesempenoView() {
  const { refreshKey }    = useOutletContext()
  const { filters }       = useFilters()
  const { user }          = useAuth()
  const location          = useLocation()
  const navDrill          = location.state  // { dimType, dimValue } from drill-down

  const [dimType, setDimType]   = useState(navDrill?.dimType || 'vendedor')
  const [dimValue, setDimValue] = useState('')
  const [inputVal, setInputVal] = useState('')

  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  // Autocomplete options
  const [options, setOptions]   = useState([])
  const [showOpts, setShowOpts] = useState(false)

  // pendingNavRef: set from drill-down navigation state (takes priority)
  const pendingNavRef   = useRef(navDrill?.dimValue ? { type: navDrill.dimType, value: navDrill.dimValue } : null)
  // autoSearchedRef: prevents double vendedor auto-load
  const autoSearchedRef = useRef(!!navDrill?.dimValue)

  // Load dimension options when type changes
  useEffect(() => {
    async function fetchOptions() {
      try {
        if (dimType === 'region') {
          const d = await api.getDimensions('region')
          setOptions((d.dimensions || []).map(o => ({ value: o.id, label: o.name })))
        } else if (dimType === 'vendedor') {
          const d = await api.filterVendedores()
          setOptions((d || []).map(v => ({ value: v.CODIGO_VENDEDOR, label: v.NOMBRE })))
        } else if (dimType === 'grupo_comercial') {
          const d = await api.filterGruposComerciales()
          setOptions((d || []).map(g => ({ value: g, label: g })))
        } else {
          setOptions([])
        }
        // Trigger pending drill-down navigation after options load
        if (pendingNavRef.current && pendingNavRef.current.type === dimType) {
          const { type, value } = pendingNavRef.current
          pendingNavRef.current = null
          setDimValue(value)
          setInputVal(value)
          setLoading(true); setError(null); setData(null)
          api.desempeno(type, value, filters.ano, filters.mes)
            .then(setData)
            .catch(e => setError(e?.response?.data?.detail || e.message || 'Error'))
            .finally(() => setLoading(false))
        }
      } catch (_) { setOptions([]) }
    }
    setData(null); setDimValue(''); setInputVal(''); setError(null)
    fetchOptions()
  }, [dimType])

  // Auto-load for vendedor role: once options are populated, search own data
  useEffect(() => {
    if (
      user?.rol === 'vendedor' &&
      user.codigo_vendedor &&
      !autoSearchedRef.current &&
      options.length > 0
    ) {
      autoSearchedRef.current = true
      const code = user.codigo_vendedor
      setDimValue(code)
      setInputVal(user.nombre || code)
      setLoading(true); setError(null); setData(null)
      api.desempeno('vendedor', code, filters.ano, filters.mes)
        .then(setData)
        .catch(e => setError(e?.response?.data?.detail || e.message || 'Error'))
        .finally(() => setLoading(false))
    }
  }, [user?.rol, user?.codigo_vendedor, options.length])

  const filteredOpts = options.filter(o =>
    !inputVal || o.label.toLowerCase().includes(inputVal.toLowerCase())
  )

  const handleSearch = useCallback(async () => {
    const val = dimValue || inputVal
    if (!val.trim()) return
    setLoading(true); setError(null); setData(null)
    try {
      const res = await api.desempeno(dimType, val.trim(), filters.ano, filters.mes)
      setData(res)
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [dimType, dimValue, inputVal, filters.ano, filters.mes, refreshKey])

  const selectedType = DIM_TYPES.find(d => d.value === dimType)

  const kpis = data?.kpis || {}
  const tendencia = data?.tendencia || []
  const topGrupos = data?.top_grupos || []
  const topClientes = data?.top_clientes || []
  const topVendedores = data?.top_vendedores || []

  const maxGrupo = Math.max(...topGrupos.map(g => g.ventas), 1)
  const maxCli   = Math.max(...topClientes.map(c => c.ventas), 1)
  const maxVend  = Math.max(...topVendedores.map(v => v.ventas), 1)

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Análisis Global de Desempeño</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Selecciona una dimensión y consulta el desempeño completo: KPIs, tendencia, grupos, clientes y vendedores
        </p>
      </div>

      {/* Selector */}
      <div className="bg-surface-800 rounded-2xl border border-surface-700 p-4 flex flex-wrap gap-4 items-end">
        {/* Dimension type tabs */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-400">Analizar por</span>
          <div className="flex gap-1 bg-surface-700 p-1 rounded-xl">
            {DIM_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setDimType(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${dimType === value
                    ? 'bg-brand-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-100'
                  }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Autocomplete input */}
        <div className="flex flex-col gap-1.5 relative min-w-64">
          <span className="text-xs text-slate-400">
            {selectedType?.label}
          </span>
          <div className="relative">
            <input
              value={inputVal}
              onChange={e => { setInputVal(e.target.value); setDimValue(''); setShowOpts(true) }}
              onFocus={() => setShowOpts(true)}
              onBlur={() => setTimeout(() => setShowOpts(false), 150)}
              onKeyDown={e => { if (e.key === 'Enter') { setShowOpts(false); handleSearch() } }}
              placeholder={selectedType?.placeholder}
              className="w-full bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:border-brand-500"
            />
            <Search size={13} className="absolute right-2.5 top-2 text-slate-500 pointer-events-none" />

            {showOpts && filteredOpts.length > 0 && (
              <div className="absolute z-50 top-full mt-1 w-full bg-surface-800 border border-surface-600 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                {filteredOpts.slice(0, 30).map(opt => (
                  <button
                    key={opt.value}
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-surface-700 hover:text-slate-100 transition-colors"
                    onMouseDown={() => { setInputVal(opt.label); setDimValue(opt.value); setShowOpts(false) }}
                  >
                    {opt.label}
                    {opt.value !== opt.label && <span className="text-slate-500 ml-1">({opt.value})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleSearch}
          disabled={loading || (!dimValue && !inputVal.trim())}
          className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          Analizar
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-300 text-sm">{error}</div>
      )}

      {/* Loading placeholder */}
      {loading && !data && (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Cargando ficha de desempeño…
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-slate-600 text-sm gap-3">
          <Activity size={32} className="text-slate-700" />
          <p>Selecciona un {selectedType?.label.toLowerCase()} y presiona Analizar</p>
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <>
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
              {selectedType && <selectedType.icon size={18} className="text-brand-400" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">{data.dimension_label}</h2>
              <p className="text-xs text-slate-500">
                {selectedType?.label} · {filters.ano}{filters.mes ? ` · ${MONTH_NAMES[filters.mes]}` : ' · YTD'}
              </p>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Ventas Netas"
              value={fmtCOP(kpis.ventas_netas)}
              delta={kpis.var_yoy_pct}
              icon={TrendingUp}
              color="text-brand-300"
            />
            <KpiCard
              label="Var. YoY"
              value={kpis.var_yoy_pct != null ? `${kpis.var_yoy_pct > 0 ? '+' : ''}${kpis.var_yoy_pct?.toFixed(1)}%` : '—'}
              sub={`Año ant: ${fmtCOP(kpis.ventas_ant)}`}
              icon={Activity}
              color={pctColor(kpis.var_yoy_pct)}
            />
            <KpiCard
              label="Clientes Activos"
              value={kpis.num_clientes?.toLocaleString()}
              sub="con ventas en el período"
              icon={Users2}
              color="text-emerald-400"
            />
            <KpiCard
              label="Grupos Comerciales"
              value={kpis.num_productos?.toLocaleString()}
              sub={`${kpis.meses_activos} meses con actividad`}
              icon={Package}
              color="text-violet-400"
            />
          </div>

          {/* Tendencia */}
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Tendencia 24 Meses</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tendencia} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="desempGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="periodo" tick={{ fill: '#6b7280', fontSize: 9 }} tickFormatter={fmtPeriodo} interval={2} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} tickFormatter={v => `${(v/1e9).toFixed(1)}B`} />
                  <Tooltip content={<TrendTooltip />} />
                  <Area dataKey="ventas" stroke="#6366f1" fill="url(#desempGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bottom grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Grupos */}
            {topGrupos.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-slate-200 mb-4">Top Grupos Comerciales</h3>
                <div className="space-y-2">
                  {topGrupos.map((g, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold text-slate-400">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-xs text-slate-200 truncate font-medium">{g.nombre}</span>
                          <span className="text-xs text-brand-300 ml-2 shrink-0">{fmtCOP(g.ventas)}</span>
                        </div>
                        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(g.ventas / maxGrupo) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Clientes */}
            {topClientes.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-slate-200 mb-4">Top 10 Clientes</h3>
                <div className="space-y-2">
                  {topClientes.map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-4 text-[10px] font-bold text-slate-400 shrink-0">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-xs text-slate-200 truncate font-medium">{c.nombre}</span>
                          <span className="text-xs text-emerald-400 ml-2 shrink-0">{fmtCOP(c.ventas)}</span>
                        </div>
                        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${(c.ventas / maxCli) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Vendedores */}
            {topVendedores.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-slate-200 mb-4">Top 10 Vendedores</h3>
                <div className="space-y-2">
                  {topVendedores.map((v, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-4 text-[10px] font-bold text-slate-400 shrink-0">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="text-xs text-slate-200 truncate font-medium">{v.nombre}</span>
                          <span className="text-xs text-violet-400 ml-2 shrink-0">{fmtCOP(v.ventas)}</span>
                        </div>
                        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${(v.ventas / maxVend) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Distribución top grupos - bar chart */}
            {topGrupos.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-slate-200 mb-4">Ventas por Grupo (gráfico)</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topGrupos} layout="vertical" margin={{ top: 0, right: 60, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1f2937" />
                      <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 9 }} tickFormatter={v => `${(v/1e9).toFixed(1)}B`} />
                      <YAxis type="category" dataKey="nombre" tick={{ fill: '#94a3b8', fontSize: 9 }} width={100} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                        formatter={v => [fmtCOP(v), 'Ventas']}
                      />
                      <Bar dataKey="ventas" radius={[0, 4, 4, 0]}>
                        {topGrupos.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
