import { createContext, useContext, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const FilterContext = createContext(null)

const DEFAULT_FILTERS = {
  ano: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  mes_fin: null,
  region: '',
  vendedor: '',
  grupo_comercial: '',
  planta: '',
  mercado: '',
  cliente: '',
  excl_exportacion: false,
  excl_pvta: false,
}

const DEFAULT_COMP = { ano: new Date().getFullYear() - 1, mes: null, mes_fin: null, activo: false }

// Keys we sync to the URL
const URL_SYNC_KEYS = ['ano', 'mes', 'mes_fin', 'region', 'vendedor', 'grupo_comercial', 'planta', 'mercado']

function parseUrlFilters(searchParams) {
  const f = { ...DEFAULT_FILTERS }
  for (const key of URL_SYNC_KEYS) {
    const val = searchParams.get(key)
    if (val == null) continue
    if (['ano', 'mes', 'mes_fin'].includes(key)) {
      f[key] = val ? parseInt(val, 10) || null : null
    } else {
      f[key] = val
    }
  }
  return f
}

export function FilterProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters]           = useState(() => parseUrlFilters(searchParams))
  const [compPeriod, setCompPeriod]     = useState(DEFAULT_COMP)

  const update = useCallback((partial) => {
    setFilters((prev) => {
      const next = { ...prev, ...partial }
      // Sync URL-tracked keys
      setSearchParams(
        (params) => {
          const p = new URLSearchParams(params)
          for (const key of URL_SYNC_KEYS) {
            if (key in partial) {
              const v = partial[key]
              if (v != null && v !== '' && v !== false) p.set(key, String(v))
              else p.delete(key)
            }
          }
          return p
        },
        { replace: true },
      )
      return next
    })
  }, [setSearchParams])

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  const updateComp = (partial) => setCompPeriod((prev) => ({ ...prev, ...partial }))
  const resetComp  = () => setCompPeriod(DEFAULT_COMP)

  return (
    <FilterContext.Provider value={{ filters, update, reset, compPeriod, updateComp, resetComp }}>
      {children}
    </FilterContext.Provider>
  )
}

export const useFilters = () => {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
