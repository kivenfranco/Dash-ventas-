import {
  DollarSign, TrendingUp, Target, Zap,
  Calendar, Clock, Users, UserCheck,
  UserPlus, UserMinus, AlertTriangle, Eye,
  BarChart2, Package, Activity,
} from 'lucide-react'
import { KPICard } from './KPICard'

// ── Progress bar for Cump% / días ─────────────────────────────────────────────
function ProgressKPI({ label, value, max = 100, color = 'brand', loading }) {
  const pct = Math.min((value / max) * 100, 100)
  const colors = {
    brand:   'bg-brand-500',
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    red:     'bg-red-500',
  }
  const barColor = value >= 100 ? colors.emerald : value >= 80 ? colors.brand : value >= 60 ? colors.amber : colors.red

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl p-5">
      <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">{label}</p>
      {loading ? (
        <div className="animate-pulse h-8 bg-slate-700 rounded-lg" />
      ) : (
        <>
          <p className="text-3xl font-bold text-slate-100">{value != null ? `${Number(value).toFixed(1)}%` : '—'}</p>
          <div className="mt-3 w-full h-2 bg-surface-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">{value != null ? `${Number(value).toFixed(1)}% de meta` : ''}</p>
        </>
      )}
    </div>
  )
}

// ── Días hábiles progress ─────────────────────────────────────────────────────
function WorkingDaysCard({ mes, transcurridos, loading }) {
  const pct = mes > 0 ? Math.round((transcurridos / mes) * 100) : 0
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-2xl p-5">
      <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">Días Hábiles</p>
      {loading ? (
        <div className="animate-pulse h-8 bg-slate-700 rounded-lg" />
      ) : (
        <>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-slate-100">{transcurridos}</span>
            <span className="text-slate-500 text-sm mb-1">/ {mes} días</span>
          </div>
          <div className="mt-3 w-full h-2 bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-amber-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-1">{pct}% del mes transcurrido</p>
        </>
      )}
    </div>
  )
}

// ── Main KPI Grid ─────────────────────────────────────────────────────────────
export function KPIGrid({ data, loading }) {
  const m = data || {}

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1 — Core sales */}
      <section>
        <p className="section-title mb-3">Ventas</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <KPICard label="Ventas Netas" value={m.ventas_netas} format="currency"
            changePct={m.variacion_yoy_pct} changeLabel="vs año ant."
            icon={DollarSign} accent="brand" loading={loading} />
          <KPICard label="Ventas Dólares" value={m.ventas_dolares} format="currency"
            icon={DollarSign} accent="cyan" loading={loading} />
          <KPICard label="Cantidad" value={m.cantidad} format="integer"
            icon={Package} accent="slate" loading={loading} />
          <KPICard label="Venta Año Anterior" value={m.venta_ano_anterior} format="currency"
            icon={TrendingUp} accent="slate" loading={loading} />
          <KPICard label="Var. YoY %" value={m.variacion_yoy_pct} format="percent"
            icon={Activity} accent={m.variacion_yoy_pct >= 0 ? 'emerald' : 'rose'} loading={loading} />
        </div>
      </section>

      {/* Row 2 — Budget & compliance */}
      <section>
        <p className="section-title mb-3">Presupuesto y Cumplimiento</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPICard label="PP Región/Planta" value={m.pp_region_planta_mes} format="currency"
            icon={Target} accent="amber" loading={loading} />
          <KPICard label="Debe Ser" value={m.debe_ser} format="currency"
            icon={Calendar} accent="orange" loading={loading} />
          <KPICard label="Proyección" value={m.proyeccion} format="currency"
            icon={Zap} accent="cyan" loading={loading} />
          <ProgressKPI label="Cump % (vs Debe Ser)" value={m.cump_pct} loading={loading} />
          <ProgressKPI label="Cump PP % (vs PP)" value={m.cump_pp_pct} loading={loading} />
          <WorkingDaysCard mes={m.dias_habiles_mes} transcurridos={m.dias_habiles_transcurridos} loading={loading} />
        </div>
      </section>

      {/* Row 3 — MoM comparison */}
      <section>
        <p className="section-title mb-3">Comparación Mensual</p>
        <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-2 gap-4">
          <KPICard label="Venta Mes Anterior" value={m.venta_mes_anterior} format="currency"
            icon={TrendingUp} accent="slate" loading={loading} compact />
          <KPICard label="Var. MoM %" value={m.variacion_mom_pct} format="percent"
            icon={Activity} accent={m.variacion_mom_pct >= 0 ? 'emerald' : 'rose'} loading={loading} compact />
        </div>
      </section>

      {/* Row 4 — Clients */}
      <section>
        <p className="section-title mb-3">Segmentación de Clientes</p>
        <div className="grid grid-cols-3 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPICard label="Total Clientes" value={m.total_clientes} format="integer"
            icon={Users} accent="brand" loading={loading} compact />
          <KPICard label="Activos" value={m.clientes_activos} format="integer"
            icon={UserCheck} accent="emerald" loading={loading} compact />
          <KPICard label="Nuevos" value={m.clientes_nuevos} format="integer"
            icon={UserPlus} accent="cyan" loading={loading} compact />
          <KPICard label="Perdidos" value={m.clientes_perdidos} format="integer"
            icon={UserMinus} accent="rose" loading={loading} compact />
          <KPICard label="En Riesgo" value={m.clientes_riesgo} format="integer"
            icon={AlertTriangle} accent="amber" loading={loading} compact />
          <KPICard label="Seguimiento" value={m.clientes_seguimiento} format="integer"
            icon={Eye} accent="purple" loading={loading} compact />
        </div>
      </section>
    </div>
  )
}
