import { NavLink } from 'react-router-dom'
import { BarChart2, Layers, AlignJustify, Zap, PieChart } from 'lucide-react'

const NAV = [
  { to: '/',          icon: Zap,          label: 'Macro',           sub: 'KPIs y tendencias' },
  { to: '/mid',       icon: Layers,       label: 'Intermedia',      sub: 'Segmentaciones'    },
  { to: '/micro',     icon: AlignJustify, label: 'Micro',           sub: 'Detalle transacc.' },
  { to: '/clientes-pareto', icon: PieChart, label: 'Pareto Clientes', sub: 'Concentración 80%' },
]

export function Sidebar({ collapsed }) {
  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {NAV.map(({ to, icon: Icon, label, sub }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl transition-all group
               ${isActive
                ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30'
                : 'text-slate-400 hover:bg-surface-700 hover:text-slate-100'
              }`
            }
          >
            <Icon size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{label}</p>
                <p className="text-xs text-slate-500 truncate">{sub}</p>
              </div>
            )}
          </NavLink>
        ))}
      </nav>
      {!collapsed && (
        <div className="p-3 border-t border-surface-700">
          <div className="text-xs text-slate-500 text-center">BI Ventas v1.0</div>
        </div>
      )}
    </div>
  )
}
