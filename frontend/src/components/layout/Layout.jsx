import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { FilterProvider } from '../../context/FilterContext'
import { GlobalFilters } from '../filters/GlobalFilters'
import {
  LayoutDashboard, TrendingUp, MapPin, Users2,
  Package, Users, BellRing, RefreshCw, Activity,
  Lightbulb, BotMessageSquare, LayoutGrid, Globe, Target, BookOpen, Rocket, Mail, LineChart, Ruler,
  Heart, Trophy, Zap, GitBranch, ShoppingCart, Sliders, FileText,
} from 'lucide-react'
import { api } from '../../services/api'
import logoAlico from '../../assets/logo.png'

const TABS = [
  { to: '/',           label: 'Resumen',    icon: LayoutDashboard },
  { to: '/tendencia',  label: 'Tendencia',  icon: TrendingUp      },
  { to: '/regiones',   label: 'Regiones',   icon: MapPin          },
  { to: '/vendedores', label: 'Vendedores', icon: Users2          },
  { to: '/productos',  label: 'Productos',  icon: Package         },
  { to: '/clientes',   label: 'Clientes',   icon: Users           },
  { to: '/alertas',    label: 'Alertas',    icon: BellRing        },
  { to: '/pronosticos',   label: 'Pronósticos',   icon: LineChart  },
  { to: '/mercados',   label: 'Mercados',   icon: Globe           },
  { to: '/hallazgos',     label: 'Hallazgos',     icon: Lightbulb       },
  { to: '/oportunidades', label: 'Oportunidades', icon: Rocket          },
  { to: '/agente',        label: 'Agente BI',     icon: BotMessageSquare },
  { to: '/dimensiones',  label: 'Dimensiones',  icon: LayoutGrid },
  { to: '/presupuesto',  label: 'Presupuesto',  icon: Target     },
  { to: '/diccionario',    label: 'Diccionario',    icon: BookOpen },
  { to: '/notificaciones',   label: 'Notificaciones',   icon: Mail         },
  { to: '/comercializacion', label: 'Comercialización', icon: Ruler        },
  { to: '/score-salud',      label: 'Score Salud',      icon: Heart        },
  { to: '/ranking',          label: 'Ranking',          icon: Trophy       },
  { to: '/anomalias',        label: 'Anomalías',        icon: Zap          },
  { to: '/cohort',           label: 'Cohortes',         icon: GitBranch    },
  { to: '/canasta',          label: 'Canasta',          icon: ShoppingCart },
  { to: '/simulador',        label: 'Simulador',        icon: Sliders      },
  { to: '/reporte',          label: 'Reporte PDF',      icon: FileText     },
]

function TabBar({ onRefresh, refreshing }) {
  const location = useLocation()
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface-900 border-b border-surface-700">
      {/* Brand row */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-surface-700/50">
        <div className="flex items-center gap-3">
          <img src={logoAlico} alt="ALICO" className="h-7 w-7 rounded-md object-contain" />
          <span className="font-bold text-slate-100 text-sm tracking-wide">Centro de Inteligencia de negocio</span>
          <span className="text-slate-600 text-xs">ALICO SAS BIC</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <button
            onClick={onRefresh}
            className={`flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors ${refreshing ? 'opacity-60' : ''}`}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>
      {/* Tabs row */}
      <div className="flex items-center gap-1 px-4 h-11 overflow-x-auto scrollbar-none">
        {TABS.map(({ to, label, icon: Icon }) => {
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
          {/* Global filters bar */}
          <div className="border-b border-surface-700/50 bg-surface-900/80 backdrop-blur">
            <GlobalFilters collapsed={!showFilters} onToggle={() => setShowFilters((s) => !s)} />
          </div>
          <div className="p-5 max-w-[1800px] mx-auto">
            <Outlet context={{ refreshKey }} />
          </div>
        </main>
      </div>
    </FilterProvider>
  )
}
