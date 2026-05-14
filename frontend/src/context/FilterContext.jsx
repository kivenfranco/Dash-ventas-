import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from './AuthContext'

const FilterContext = createContext(null)

const DEFAULT_FILTERS = {
  ano: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  mes_fin: null,
  // Dimension filters — now arrays for multi-select
  region:          [],
  vendedor:        [],
  grupo_comercial: [],
  planta:          [],
  mercado:         [],
  cliente: '',
  excl_exportacion: false,
  excl_pvta: false,
}

const DEFAULT_COMP = { ano: new Date().getFullYear() - 1, mes: null, mes_fin: null, activo: false }

// Keys we sync to the URL
const URL_SYNC_KEYS = ['ano', 'mes', 'mes_fin', 'region', 'vendedor', 'grupo_comercial', 'planta', 'mercado']
const ARRAY_KEYS    = ['region', 'vendedor', 'grupo_comercial', 'planta', 'mercado']
// Keys persisted to localStorage (subset — no transient per-session selections)
const LS_PERSIST_KEYS = ['ano', 'mes', 'mes_fin', 'excl_exportacion', 'excl_pvta']
const LS_KEY = 'bi_filters_v1'

function parseUrlFilters(searchParams) {
  const f = { ...DEFAULT_FILTERS }
  for (const key of URL_SYNC_KEYS) {
    const val = searchParams.get(key)
    if (val == null) continue
    if (['ano', 'mes', 'mes_fin'].includes(key)) {
      f[key] = val ? parseInt(val, 10) || null : null
    } else if (ARRAY_KEYS.includes(key)) {
      f[key] = val ? val.split(',').map((v) => v.trim()).filter(Boolean) : []
    } else {
      f[key] = val
    }
  }
  return f
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved?.ano) return null
    const f = { ...DEFAULT_FILTERS }
    for (const key of LS_PERSIST_KEYS) {
      if (saved[key] != null) f[key] = saved[key]
    }
    return f
  } catch {
    return null
  }
}

function saveToStorage(filters) {
  try {
    const toSave = {}
    for (const key of LS_PERSIST_KEYS) toSave[key] = filters[key]
    localStorage.setItem(LS_KEY, JSON.stringify(toSave))
  } catch {}
}

export function FilterProvider({ children }) {
  const { user } = useAuth()
  const vendedorLocked = !!(user?.rol === 'vendedor' && user?.codigo_vendedor)

  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => {
    // URL params take absolute priority
    if (searchParams.toString()) return parseUrlFilters(searchParams)
    // Fallback: restore period + toggles from localStorage
    return loadFromStorage() ?? parseUrlFilters(searchParams)
  })
  const [compPeriod, setCompPeriod]     = useState(DEFAULT_COMP)

  // Force vendedor filter when role=vendedor
  useEffect(() => {
    if (vendedorLocked) {
      setFilters((prev) => ({ ...prev, vendedor: [user.codigo_vendedor] }))
    }
  }, [vendedorLocked, user?.codigo_vendedor])

  const update = useCallback((partial) => {
    setFilters((prev) => {
      const patched = vendedorLocked ? { ...partial, vendedor: [user?.codigo_vendedor] } : partial
      const next = { ...prev, ...patched }
      saveToStorage(next)
      setSearchParams(
        (params) => {
          const p = new URLSearchParams(params)
          for (const key of URL_SYNC_KEYS) {
            if (!(key in patched)) continue
            const v = patched[key]
            if (ARRAY_KEYS.includes(key)) {
              const arr = Array.isArray(v) ? v : []
              if (arr.length > 0) p.set(key, arr.join(','))
              else p.delete(key)
            } else {
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
  }, [setSearchParams, vendedorLocked, user?.codigo_vendedor])

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    saveToStorage(DEFAULT_FILTERS)
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  const updateComp = (partial) => setCompPeriod((prev) => ({ ...prev, ...partial }))
  const resetComp  = () => setCompPeriod(DEFAULT_COMP)

  // Provide backward-compat single-value strings alongside the arrays.
  // Pages that use filters.region (string) keep working; GlobalFilters uses arrays directly.
  const filtersWithCompat = useMemo(() => ({
    ...filters,
    // First selected value or '' for backward-compat single-value API calls
    region:          filters.region[0]          || '',
    vendedor:        filters.vendedor[0]         || '',
    grupo_comercial: filters.grupo_comercial[0]  || '',
    planta:          filters.planta[0]           || '',
    mercado:         filters.mercado[0]          || '',
    // Keep raw arrays under _arrays
    _regiones:         filters.region,
    _vendedores:       filters.vendedor,
    _grupos_comerciales: filters.grupo_comercial,
    _plantas:          filters.planta,
    _mercados:         filters.mercado,
  }), [filters])

  return (
    <FilterContext.Provider value={{ filters: filtersWithCompat, _raw: filters, update, reset, compPeriod, updateComp, resetComp, vendedorLocked }}>
      {children}
    </FilterContext.Provider>
  )
}

export const useFilters = () => {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
