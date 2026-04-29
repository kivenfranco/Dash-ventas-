import { ChevronLeft, ChevronRight } from 'lucide-react'

export function DataTable({ data = [], pagination, onPageChange, loading }) {
  if (!data.length && !loading) {
    return (
      <div className="text-center py-12 text-slate-500">
        No hay datos para el periodo seleccionado.
      </div>
    )
  }

  const columns = data.length ? Object.keys(data[0]) : []

  const fmt = (val) => {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'number') return val.toLocaleString('es-MX', { maximumFractionDigits: 2 })
    return String(val)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-surface-700">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="bg-surface-700 text-slate-400">
              {columns.map((col) => (
                <th key={col} className="px-4 py-3 font-medium whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={i}
                className="border-t border-surface-700 hover:bg-surface-700/50 transition-colors"
              >
                {columns.map((col) => (
                  <td key={col} className="px-4 py-3 text-slate-300 whitespace-nowrap">
                    {fmt(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between text-sm text-slate-400 px-1">
          <span>
            {pagination.total.toLocaleString()} registros — Página {pagination.page} de {pagination.total_pages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="btn-ghost disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages}
              className="btn-ghost disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
