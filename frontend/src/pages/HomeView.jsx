import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { fmtCOP, fmtPct, formatPeriod } from '../utils/format'
import logoAlico from '../assets/logo.png'
import {
  LayoutDashboard, TrendingUp, Users, Package,
  BrainCircuit, AlertCircle, ShoppingCart, BarChart3,
  Calendar, Map, UserCircle, Settings, MessageSquare,
  Activity, ArrowUpRight, Zap, Target
} from 'lucide-react'

const MENU_GROUPS = [
  {
    title: 'Ventas y Comercialización',
    icon: LayoutDashboard,
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
    items: [
      { path: '/resumen',        label: 'Resumen Ejecutivo', desc: 'Vista consolidada de KPIs, cumplimiento de presupuesto y comparativa anual.', icon: BarChart3 },
      { path: '/tendencia',      label: 'Tendencias Temporales', desc: 'Análisis evolutivo de ventas por mes, semana y día.', icon: TrendingUp },
      { path: '/regiones',       label: 'Análisis Geográfico', desc: 'Desempeño por regiones, zonas y sucursales.', icon: Map },
      { path: '/vendedores',     label: 'Gestión Comercial', desc: 'Productividad de asesores y cumplimiento de metas.', icon: UserCircle },
      { path: '/productos',      label: 'Portafolio de Productos', desc: 'Ventas por línea de negocio, grupo comercial y unidades.', icon: Package },
      { path: '/presupuesto',    label: 'Control Presupuestal', desc: 'Seguimiento detallado de ejecución vs presupuesto.', icon: Target },
    ]
  },
  {
    title: 'Gestión de Clientes',
    icon: Users,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    items: [
      { path: '/clientes',       label: 'Estado de Cartera', desc: 'Clasificación de clientes: Activos, Nuevos, Riesgo y Perdidos.', icon: Users },
      { path: '/alertas',        label: 'Alertas de Inactividad', desc: 'Detección temprana de clientes que han dejado de comprar.', icon: AlertCircle },
      { path: '/rfm',            label: 'Segmentación RFM', desc: 'Análisis por Recencia, Frecuencia y Monto para fidelización.', icon: Zap },
      { path: '/migracion-rfm',  label: 'Migración de Estados', desc: 'Flujo de movimiento de clientes entre segmentos de valor.', icon: Activity },
      { path: '/clientes-pareto', label: 'Análisis de Pareto', desc: 'Identificación del 20% de clientes que generan el 80% de venta.', icon: Target },
    ]
  },
  {
    title: 'Inteligencia Artificial',
    icon: BrainCircuit,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    items: [
      { path: '/agente',         label: 'Asistente Virtual IA', desc: 'Consulta tus datos en lenguaje natural mediante Inteligencia Artificial.', icon: MessageSquare },
      { path: '/pronosticos',    label: 'Predicción de Ventas', desc: 'Proyecciones estadísticas basadas en modelos de Machine Learning.', icon: TrendingUp },
      { path: '/churn',          label: 'Riesgo de Abandono', desc: 'Identificación predictiva de clientes con alta probabilidad de fuga.', icon: AlertCircle },
      { path: '/cross-selling',  label: 'Cross-Selling & Afinidad', desc: 'Sugerencias de productos complementarios basadas en market basket analysis.', icon: ShoppingCart },
      { path: '/abcxyz',         label: 'Clasificación ABC-XYZ', desc: 'Priorización de inventario según rentabilidad y variabilidad.', icon: Package },
    ]
  },
  {
    title: 'Herramientas y Configuración',
    icon: Settings,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    items: [
      { path: '/notificaciones', label: 'Envío de Notificaciones', desc: 'Gestión automatizada de reportes vía Teams, WhatsApp y Correo.', icon: Zap },
      { path: '/diccionario',    label: 'Glosario de Términos', desc: 'Definición de fórmulas, KPIs y conceptos del dashboard.', icon: MessageSquare },
      { path: '/admin',          label: 'Administración', desc: 'Gestión de usuarios, permisos y configuración del sistema.', icon: Settings },
    ]
  }
]

export function HomeView() {
  const { filters } = useFilters()
  const period = formatPeriod(filters.ano, filters.mes, filters.mes_fin)

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in pb-12">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface-800 to-surface-950 border border-surface-700/50 p-10 md:p-16 mb-12">
        {/* Abstract background elements */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-500/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-purple-500/5 blur-[100px] rounded-full" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-white flex items-center justify-center shadow-2xl shadow-brand-500/20 overflow-hidden p-4 shrink-0 transition-transform hover:scale-105 duration-500">
            <img src={logoAlico} alt="ALICO" className="w-full h-full object-contain" />
          </div>
          
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-col gap-1 mb-6">
              <h2 className="text-brand-400 font-bold tracking-[0.2em] text-sm uppercase">Alico SAS BIC</h2>
              <h1 className="text-4xl md:text-6xl font-black text-white leading-tight">
                Centro de Inteligencia <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-cyan-400">de Negocio</span>
              </h1>
            </div>
            
            <p className="text-slate-400 text-lg md:text-xl leading-relaxed max-w-3xl">
              Bienvenido al centro de mando <span className="text-slate-100 font-semibold italic">comercial</span>. 
              Transformamos datos en valor estratégico para liderar el mercado con precisión, 
              visión de futuro y analítica de alto nivel.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Groups */}
      <div className="space-y-12">
        {MENU_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="flex items-center gap-3 mb-6 px-4">
              <div className={`w-8 h-8 rounded-lg ${group.bg} flex items-center justify-center`}>
                <group.icon className={group.color} size={18} />
              </div>
              <h2 className="text-lg font-bold text-slate-200 uppercase tracking-wider">{group.title}</h2>
              <div className="flex-1 h-px bg-gradient-to-r from-surface-700 to-transparent" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="group relative bg-surface-900/40 hover:bg-surface-800/60 border border-surface-800 hover:border-surface-600 rounded-2xl p-5 transition-all duration-300 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1 overflow-hidden"
                >
                  <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-brand-500/5 rounded-full blur-2xl group-hover:bg-brand-500/10 transition-colors" />
                  
                  <div className="flex gap-4 relative z-10">
                    <div className="w-12 h-12 rounded-xl bg-surface-800 border border-surface-700 flex items-center justify-center text-slate-400 group-hover:text-brand-400 group-hover:border-brand-500/30 transition-all duration-300">
                      <item.icon size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-slate-100 font-bold group-hover:text-brand-300 transition-colors">{item.label}</h3>
                        <ArrowUpRight size={14} className="text-slate-600 group-hover:text-brand-400 transition-all" />
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed line-clamp-2">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Branding */}
      <div className="mt-24 pb-12 flex flex-col items-center gap-4 opacity-40 hover:opacity-80 transition-opacity duration-700">
        <img src={logoAlico} alt="ALICO" className="h-10 object-contain" />
        <div className="text-xs font-medium text-slate-500 tracking-[0.4em]">2026</div>
      </div>
    </div>
  )
}
