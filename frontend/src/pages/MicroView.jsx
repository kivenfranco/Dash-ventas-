import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { useData } from '../hooks/useData'
import { api } from '../services/api'
import { GlobalFilters } from '../components/filters/GlobalFilters'
import { DataTable } from '../components/common/DataTable'
import { PageLoader, ErrorDisplay } from '../components/common/LoadingSpinner'
import { AlignJustify, Download } from 'lucide-react'

const SORT_OPTIONS = [
  { value: 'date_desc',   label: 'Fecha ↓' },
  { value: 'date_asc',    label: 'Fecha ↑' },
  { value: 'amount_desc', label: 'Monto ↓' },
  { value: 'amount_asc',  label: 'Monto ↑' },
]

export function MicroView() {
  const { refreshKey } = useOutletContext()
  const { filters } = useFilters()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortBy, setSortBy] = useState('date_desc')

  const { data, loading, error, reload } = useData(
    () => api.detail(filters, page, pageSize, sortBy),
    [filters, refreshKey, page, pageSize, sortBy]
  )

  const handlePageChange = (newPage) => setPage(newPage)

  const downloadCSV = () => {
    if (!data?.data?.length) return
    const cols = Object.keys(data.data[0])
    const rows = [cols.join(','), ...data.data.map((r) => cols.map((c) => `"${r[c] ?? ''}"`).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas_detalle_p${page}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <ErrorDisplay message={error} onRetry={reload} />

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Vista Micro</h1>
        <p className="text-slate-500 text-sm mt-0.5">Detalle transaccional — exploración granular de ventas</p>
      </div>

      <GlobalFilters onRefresh={reload} />

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <AlignJustify size={16} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-300">Transacciones</h2>
            {data?.pagination?.total != null && (
              <span className="badge badge-blue">
                {data.pagination.total.toLocaleString('es-MX')} registros
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              className="select w-36"
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="select w-28"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n} / pág.</option>
              ))}
            </select>
            <button
              onClick={downloadCSV}
              disabled={!data?.data?.length}
              className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"
              title="Descargar página como CSV"
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>

        {loading ? (
          <PageLoader />
        ) : (
          <DataTable
            data={data?.data || []}
            pagination={data?.pagination}
            onPageChange={handlePageChange}
            loading={loading}
          />
        )}
      </div>
    </div>
  )
}
