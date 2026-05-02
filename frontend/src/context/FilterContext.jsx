import { createContext, useContext, useState } from 'react'

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

export function FilterProvider({ children }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  const update = (partial) => setFilters((prev) => ({ ...prev, ...partial }))
  const reset  = () => setFilters(DEFAULT_FILTERS)

  return (
    <FilterContext.Provider value={{ filters, update, reset }}>
      {children}
    </FilterContext.Provider>
  )
}

export const useFilters = () => {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
