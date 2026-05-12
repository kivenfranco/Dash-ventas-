import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { FilterProvider } from '../../context/FilterContext'
import { GlobalFilters } from '../filters/GlobalFilters'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../services/api'
import logoAlico from '../../assets/logo.png'
import {
  LayoutDashboard, TrendingUp, MapPin, Users2,
  Package, Users, BellRing, RefreshCw, Activity,
  Lightbulb, BotMessageSquare, LayoutGrid, Globe, Target, BookOpen, Rocket, Mail, LineChart, Ruler,
  Heart, Trophy, Zap, GitBranch, ShoppingCart, Sliders, FileText,
  Search, LogOut, UserCircle, ChevronDown, BarChart2, GitMerge, UserX, PieChart, Shield, Sun, Moon,
  Layers, Thermometer, GitCompareArrows, ShieldAlert,
} from 'lucide-react'

const TABS = [
  // ── 0. Inicio ─────────────────────────────────────────────────────────────
  { to: '/',               label: 'Inicio',           icon: LayoutDashboard  },
  // ── 1. Monitoreo diario ───────────────────────────────────────────────────
  { to: '/resumen',        label: 'Resumen',          icon: BarChart2        },
  { to: '/tendencia',      label: 'Tendencia',         icon: TrendingUp       },
  { to: '/alertas',        label: 'Alertas',           icon: BellRing         },
  { to: '/anomalias',      label: 'Anomalías',         icon: Zap              },
  { to: '/hallazgos',      label: 'Hallazgos',         icon: Lightbulb        },
  { to: '/oportunidades',  label: 'Oportunidades',     icon: Rocket           },
  // ── 2. Análisis dimensional ───────────────────────────────────────────────
  { to: '/desempeno',      label: 'Desempeño Global',  icon: Activity         },
  { to: '/vendedores',     label: 'Vendedores',        icon: Users2           },
  { to: '/regiones',       label: 'Regiones',          icon: MapPin           },
  { to: '/clientes',       label: 'Clientes',          icon: Users            },
  { to: '/productos',      label: 'Productos',         icon: Package          },
  { to: '/mercados',       label: 'Mercados',          icon: Globe            },
  { to: '/dimensiones',    label: 'Dimensiones',       icon: LayoutGrid       },
  // ── 3. Financiero y presupuesto ───────────────────────────────────────────
  { to: '/presupuesto',    label: 'Presupuesto',       icon: Target           },
  { to: '/pvm',            label: 'PVM',               icon: Layers           },
  { to: '/estacionalidad', label: 'Estacionalidad',    icon: Thermometer      },
  { to: '/pronosticos',    label: 'Pronósticos',       icon: LineChart        },
  { to: '/comercializacion', label: 'Comercialización', icon: Ruler           },
  // ── 4. Análisis avanzado de clientes ─────────────────────────────────────
  { to: '/clientes-pareto', label: 'Pareto Clientes',  icon: PieChart         },
  { to: '/rfm',            label: 'RFM',               icon: PieChart         },
  { to: '/abcxyz',         label: 'ABC/XYZ',           icon: BarChart2        },
  { to: '/clv',            label: 'CLV',               icon: Activity         },
  { to: '/churn',          label: 'Churn',             icon: UserX            },
  { to: '/riesgo-cliente', label: 'Riesgo Cliente',    icon: ShieldAlert      },
  { to: '/score-salud',    label: 'Score Salud',       icon: Heart            },
  { to: '/cohort',         label: 'Cohortes',          icon: GitBranch        },
  { to: '/migracion-rfm',  label: 'Migración RFM',     icon: GitCompareArrows },
  // ── 5. Análisis de producto y canasta ─────────────────────────────────────
  { to: '/kpis-producto',  label: 'KPIs Producto',     icon: BarChart2        },
  { to: '/ranking',        label: 'Ranking',           icon: Trophy           },
  { to: '/canasta',        label: 'Canasta',           icon: ShoppingCart     },
  { to: '/cross-selling',  label: 'Cross-Selling',     icon: GitMerge         },
  // ── 6. Herramientas ───────────────────────────────────────────────────────
  { to: '/simulador',      label: 'Simulador',         icon: Sliders          },
  { to: '/agente',         label: 'Agente BI',         icon: BotMessageSquare },
  { to: '/notificaciones', label: 'Notificaciones',    icon: Mail             },
  { to: '/reporte',        label: 'Reporte PDF',       icon: FileText         },
  { to: '/diccionario',    label: 'Diccionario',       icon: BookOpen         },
  // ── 7. Sistema ────────────────────────────────────────────────────────────
  { to: '/admin',          label: 'Administración',    icon: Shield, adminOnly: true },
]

function SearchBar() {
  const navigate                     = useNavigate()
  const [query, setQuery]            = useState('')
  const [results, setResults]        = useState([])
  const [open, setOpen]              = useState(false)
  const [loading, setLoading]        = useState(false)
  const ref                          = useRef(null)
  const timerRef                     = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(timerRef.current)
    if (val.length < 2) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.search(val)
        setResults(data.results || [])
        setOpen(true)
      } catch (_) {}
      finally { setLoading(false) }
    }, 300)
  }

  const select = (r) => {
    setOpen(false)
    setQuery('')
    if (r.tipo === 'vendedor')    navigate(`/vendedores?vendedor=${r.id}`)
    else if (r.tipo === 'producto') navigate(`/productos`)
    else if (r.tipo === 'estructura') navigate(`/productos`)
  }

  const tipoColor = { vendedor: 'text-brand-400', producto: 'text-emerald-400', estructura: 'text-amber-400' }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 bg-surface-800 border border-surface-600 rounded-lg px-3 py-1.5 w-56 focus-within:border-brand-500">
        <Search size={13} className="text-slate-500 shrink-0" />
        <input
          value={query}
          onChange={handleChange}
          placeholder="Buscar…"
          className="bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none w-full"
        />
        {loading && <div className="h-3 w-3 border border-slate-500 border-t-transparent rounded-full animate-spin shrink-0" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 w-72 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl z-50 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => select(r)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-700 text-left"
            >
              <span className={`text-xs font-medium ${tipoColor[r.tipo] || 'text-slate-400'} w-20 shrink-0`}>
                {r.tipo}
              </span>
              <span className="text-xs text-slate-200 truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()
  const [open, setOpen]  = useState(false)
  const ref              = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  if (!user) return null
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-slate-300 hover:text-slate-100 px-2 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
      >
        <UserCircle size={16} className="text-brand-400" />
        <span className="max-w-[100px] truncate">{user.nombre}</span>
        <ChevronDown size={12} className="text-slate-500" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-surface-700">
            <p className="text-xs font-medium text-slate-200 truncate">{user.nombre}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded mt-1 inline-block ${user.rol === 'admin' ? 'bg-brand-600/30 text-brand-300' : 'bg-surface-700 text-slate-400'}`}>
              {user.rol}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={13} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}

const LIGHT_KEY = 'bi_light_mode'

function useLightMode() {
  const [light, setLight] = useState(() => localStorage.getItem(LIGHT_KEY) === 'true')

  useEffect(() => {
    document.documentElement.classList.toggle('light-mode', light)
    localStorage.setItem(LIGHT_KEY, String(light))
  }, [light])

  return [light, useCallback(() => setLight((v) => !v), [])]
}

function TabBar({ onRefresh, refreshing }) {
  const location      = useLocation()
  const { user }      = useAuth()
  const [light, toggleLight] = useLightMode()
  const visibleTabs   = TABS.filter(t => !t.adminOnly || user?.rol === 'admin')
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface-900 border-b border-surface-700">
      {/* Brand row */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-surface-700/50">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src={logoAlico} alt="ALICO" className="h-7 w-7 rounded-md object-contain" />
          <div className="flex flex-col md:flex-row md:items-center md:gap-2">
            <span className="font-bold text-slate-100 text-sm tracking-wide">Centro de Inteligencia de Negocio</span>
            <span className="text-slate-600 text-[10px] md:text-xs uppercase tracking-tighter">ALICO SAS BIC</span>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <SearchBar />
          <span className="text-xs text-slate-500">{new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <button
            onClick={toggleLight}
            title={light ? 'Modo oscuro' : 'Modo claro'}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-2.5 py-1.5 rounded-lg hover:bg-surface-700 transition-colors"
          >
            {light ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          <button
            onClick={onRefresh}
            className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors ${refreshing ? 'opacity-60' : ''}`}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <UserMenu />
        </div>
      </div>
      {/* Tabs row */}
      <div className="flex items-center gap-1 px-4 h-11 overflow-x-auto scrollbar-none">
        {visibleTabs.map(({ to, label, icon: Icon }) => {
          const active = to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                active
                  ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
              }`}
            >
              <Icon size={14} />
              {label}
            </NavLink>
          )
        })}
      </div>
    </header>
  )
}

export function Layout() {
  const location                      = useLocation()
  const [refreshKey, setRefreshKey]   = useState(0)
  const [refreshing, setRefreshing]   = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await api.refresh() } catch (_) {}
    setRefreshKey((k) => k + 1)
    setTimeout(() => setRefreshing(false), 1000)
  }

  return (
    <FilterProvider>
      <div className="min-h-screen bg-surface-950">
        <TabBar onRefresh={handleRefresh} refreshing={refreshing} />
        <main className="pt-[92px]">
          {/* Global filters bar - Hide on Home page */}
          {location.pathname !== '/' && (
            <div className="border-b border-surface-700/50 bg-surface-900/80 backdrop-blur">
              <GlobalFilters collapsed={!showFilters} onToggle={() => setShowFilters((s) => !s)} />
            </div>
          )}
          <div className="p-5 max-w-[1800px] mx-auto">
            <Outlet context={{ refreshKey }} />
          </div>
        </main>
      </div>
    </FilterProvider>
  )
}
