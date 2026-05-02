// Number formatting for Colombian Pesos BI dashboard
export function formatPeriod(ano, mes, mes_fin) {
  const MN = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  if (!mes) return `Año ${ano}`
  if (!mes_fin || mes_fin === mes) return `${MN[mes]} ${ano}`
  if (mes === 1  && mes_fin === 3)  return `Q1 ${ano}`
  if (mes === 4  && mes_fin === 6)  return `Q2 ${ano}`
  if (mes === 7  && mes_fin === 9)  return `Q3 ${ano}`
  if (mes === 10 && mes_fin === 12) return `Q4 ${ano}`
  if (mes === 1  && mes_fin === 6)  return `S1 ${ano}`
  if (mes === 7  && mes_fin === 12) return `S2 ${ano}`
  return `${MN[mes]}-${MN[mes_fin]} ${ano}`
}

export function fmtCOP(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 1e9)  return `${sign}$${(a / 1e9).toFixed(decimals)}MM`
  if (a >= 1e6)  return `${sign}$${(a / 1e6).toFixed(decimals)}M`
  if (a >= 1e3)  return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(0)}`
}

export function fmtNum(v, decimals = 1) {
  if (v == null || isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 1e9)  return `${sign}${(a / 1e9).toFixed(decimals)}MM`
  if (a >= 1e6)  return `${sign}${(a / 1e6).toFixed(decimals)}M`
  if (a >= 1e3)  return `${sign}${(a / 1e3).toFixed(0)}K`
  return `${sign}${a.toFixed(0)}`
}

export function fmtPct(v, decimals = 3) {
  if (v == null || isNaN(v)) return '—'
  return `${Number(v).toFixed(decimals)}%`
}

export function fmtInt(v) {
  if (v == null || isNaN(v)) return '—'
  return Number(v).toLocaleString('es-CO')
}

export function pctColor(v) {
  if (v == null) return 'text-slate-400'
  if (v >= 5)   return 'text-emerald-400'
  if (v >= 0)   return 'text-emerald-300'
  if (v >= -10) return 'text-amber-400'
  if (v >= -25) return 'text-orange-400'
  return 'text-red-400'
}

export function cumpColor(v) {
  if (v == null) return 'text-slate-400'
  if (v >= 100) return 'text-emerald-400'
  if (v >= 85)  return 'text-emerald-300'
  if (v >= 70)  return 'text-amber-400'
  if (v >= 55)  return 'text-orange-400'
  return 'text-red-400'
}

export function cumpBg(v) {
  if (v == null) return 'bg-slate-500'
  if (v >= 100) return 'bg-emerald-500'
  if (v >= 85)  return 'bg-emerald-400'
  if (v >= 70)  return 'bg-amber-400'
  if (v >= 55)  return 'bg-orange-500'
  return 'bg-red-500'
}

export const MONTH_NAMES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
export const MONTH_FULL  = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
