import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { fmtCOP, fmtNum, fmtPct, fmtInt } from '../../utils/format'

const FMT = {
  currency: fmtCOP,
  number:   fmtNum,
  percent:  (v) => fmtPct(v),
  integer:  fmtInt,
  text:     (v) => String(v),
}

function Delta({ pct, label }) {
  if (pct === null || pct === undefined) return null
  const up = pct > 0, zero = Math.abs(pct) < 0.05
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`badge ${up ? 'badge-green' : zero ? 'badge-blue' : 'badge-red'}`}>
        {up ? <TrendingUp size={10}/> : zero ? <Minus size={10}/> : <TrendingDown size={10}/>}
        {up ? '+' : ''}{Number(pct).toFixed(1)}%
      </span>
      {label && <span className="text-xs text-slate-600">{label}</span>}
    </div>
  )
}

const ACCENT = {
  brand:   { grad: 'from-brand-600/15',   border: 'border-brand-500/25',   icon: 'text-brand-400'   },
  emerald: { grad: 'from-emerald-600/15', border: 'border-emerald-500/25', icon: 'text-emerald-400' },
  cyan:    { grad: 'from-cyan-600/15',    border: 'border-cyan-500/25',    icon: 'text-cyan-400'    },
  amber:   { grad: 'from-amber-600/15',   border: 'border-amber-500/25',   icon: 'text-amber-400'   },
  purple:  { grad: 'from-purple-600/15',  border: 'border-purple-500/25',  icon: 'text-purple-400'  },
  rose:    { grad: 'from-rose-600/15',    border: 'border-rose-500/25',    icon: 'text-rose-400'    },
  slate:   { grad: 'from-slate-600/15',   border: 'border-slate-500/25',   icon: 'text-slate-400'   },
  orange:  { grad: 'from-orange-600/15',  border: 'border-orange-500/25',  icon: 'text-orange-400'  },
  red:     { grad: 'from-red-600/15',     border: 'border-red-500/25',     icon: 'text-red-400'     },
}

export function KPICard({
  label, value, sub,
  format = 'integer',
  changePct, changeLabel,
  icon: Icon, accent = 'brand',
  loading, compact = false,
}) {
  const ac = ACCENT[accent] || ACCENT.brand
  const displayValue = loading
    ? '…'
    : value === null || value === undefined
    ? '—'
    : (FMT[format] || FMT.integer)(value)

  if (compact) {
    return (
      <div className={`bg-gradient-to-br ${ac.grad} to-transparent border ${ac.border} rounded-xl p-4`}>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-slate-500 leading-tight">{label}</p>
          {Icon && <Icon size={13} className={ac.icon} />}
        </div>
        <p className={`text-2xl font-bold tracking-tight ${loading ? 'animate-pulse text-slate-600' : 'text-slate-100'}`}>
          {displayValue}
        </p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        {!loading && changePct !== undefined && (
          <div className="mt-1.5"><Delta pct={changePct} label={changeLabel} /></div>
        )}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${ac.grad} to-transparent border ${ac.border} rounded-2xl p-5`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase leading-tight">{label}</p>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg bg-surface-800/60 flex items-center justify-center ${ac.icon}`}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className={`text-3xl font-bold tracking-tight ${loading ? 'animate-pulse text-slate-600' : 'text-slate-100'}`}>
        {displayValue}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      {!loading && (
        <div className="mt-2"><Delta pct={changePct} label={changeLabel} /></div>
      )}
    </div>
  )
}
