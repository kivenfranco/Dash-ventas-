import { useMemo } from 'react'

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function lerp(min, max, t) {
  return min + (max - min) * t
}

function valueToColor(value, min, max) {
  if (max === min) return 'rgba(99,102,241,0.3)'
  const t = (value - min) / (max - min)
  const r = Math.round(lerp(13, 99, t))
  const g = Math.round(lerp(17, 102, t))
  const b = Math.round(lerp(23, 241, t))
  return `rgba(${r},${g},${b},${0.2 + t * 0.8})`
}

const fmtCurrency = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 }).format(v)

export function HeatmapChart({ data = [], loading }) {
  const { grid, minVal, maxVal } = useMemo(() => {
    if (!data.length) return { grid: [], minVal: 0, maxVal: 0 }

    const map = {}
    data.forEach((d) => {
      try {
        const date = new Date(d.PERIODO)
        const year = date.getFullYear()
        const month = date.getMonth()
        if (!map[year]) map[year] = {}
        map[year][month] = (map[year][month] || 0) + (d.VENTAS_TOTALES || 0)
      } catch {}
    })

    const years = Object.keys(map).sort()
    const allVals = Object.values(map).flatMap((ym) => Object.values(ym))
    const minVal = Math.min(...allVals)
    const maxVal = Math.max(...allVals)

    const grid = years.map((year) => ({
      year,
      months: MONTHS.map((_, mi) => ({ month: mi, value: map[year]?.[mi] || 0 })),
    }))

    return { grid, minVal, maxVal }
  }, [data])

  if (!grid.length) return (
    <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
      Sin datos suficientes para el heatmap
    </div>
  )

  return (
    <div className={`overflow-x-auto ${loading ? 'opacity-40 animate-pulse' : 'animate-fade-in'}`}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="w-12 text-left text-slate-500 pb-2">Año</th>
            {MONTHS.map((m) => (
              <th key={m} className="text-center text-slate-500 pb-2 font-normal">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map(({ year, months }) => (
            <tr key={year}>
              <td className="text-slate-400 font-semibold pr-2 py-1">{year}</td>
              {months.map(({ month, value }) => (
                <td key={month} className="py-1 px-0.5">
                  <div
                    className="h-8 rounded-md flex items-center justify-center text-xs font-medium text-slate-300 cursor-default transition-transform hover:scale-110"
                    style={{ background: valueToColor(value, minVal, maxVal) }}
                    title={`${MONTHS[month]} ${year}: ${fmtCurrency(value)}`}
                  >
                    {value > 0 ? fmtCurrency(value) : ''}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
        <span>Bajo</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((t) => (
            <div key={t} className="w-6 h-3 rounded-sm" style={{ background: valueToColor(minVal + t * (maxVal - minVal), minVal, maxVal) }} />
          ))}
        </div>
        <span>Alto</span>
      </div>
    </div>
  )
}
