import { useEffect, useRef, useState } from 'react'
import {
  SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp,
  Globe, Store, Search, Bookmark, BookmarkCheck, Trash2, X, Check,
} from 'lucide-react'
import { useFilters } from '../../context/FilterContext'
import { api } from '../../services/api'

const STORAGE_KEY = 'bi_ventas_favoritos'

function useFavoritos(rawFilters, update) {
  const [favoritos, setFavoritos]   = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [open, setOpen]             = useState(false)
  const [nombre, setNombre]         = useState('')
  const [guardando, setGuardando]   = useState(false)
  const panelRef                    = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const guardar = () => {
    if (!nombre.trim()) return
    const nuevo = { id: Date.now(), nombre: nombre.trim(), filters: { ...rawFilters } }
    const lista = [nuevo, ...favoritos.filter((f) => f.nombre !== nombre.trim())].slice(0, 12)
    setFavoritos(lista)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista))
    setNombre('')
    setGuardando(false)
  }

  const cargar = (fav) => { update(fav.filters); setOpen(false) }

  const eliminar = (id, e) => {
    e.stopPropagation()
    const lista = favoritos.filter((f) => f.id !== id)
    setFavoritos(lista)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista))
  }

  return { favoritos, open, setOpen, nombre, setNombre, guardando, setGuardando, guardar, cargar, eliminar, panelRef }
}

const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const PRESETS = [
  { label: 'Q1', mes: 1,  mes_fin: 3  },
  { label: 'Q2', mes: 4,  mes_fin: 6  },
  { label: 'Q3', mes: 7,  mes_fin: 9  },
  { label: 'Q4', mes: 10, mes_fin: 12 },
  { label: 'S1', mes: 1,  mes_fin: 6  },
  { label: 'S2', mes: 7,  mes_fin: 12 },
]

export function GlobalFilters({ collapsed, onToggle }) {
  const { filters, _raw, update, reset, compPeriod, updateComp, vendedorLocked } = useFilters()
  const rawFilters = _raw || filters
  const fav = useFavoritos(rawFilters, update)

  const [opts, setOpts] = useState({ anos: [], regiones: [], vendedores: [], grupos: [], lineas: [], mercados: [], clientes: [] })
  const [clienteInput, setClienteInput] = useState(filters.cliente || '')
  const debounceRef = useRef(null)

  // Selected arrays (from _raw so we get real arrays)
  const selRegiones  = rawFilters.region          || []
  const selVendedores= rawFilters.vendedor         || []
  const selGrupos    = rawFilters.grupo_comercial  || []
  const selPlantas   = rawFilters.planta           || []
  const selMercados  = rawFilters.mercado          || []

  useEffect(() => {
    Promise.allSettled([
      api.filterAnos(), api.filterRegiones(), api.filterVendedores(),
      api.filterGruposComerciales(), api.filterLineas(), api.filterMercados(),
      api.filterClientes(),
    ]).then(([anos, reg, vend, gc, ln, merc, cli]) => {
      setOpts({
        anos:       anos.status  === 'fulfilled' ? anos.value  : [],
        regiones:   reg.status   === 'fulfilled' ? reg.value   : [],
        vendedores: vend.status  === 'fulfilled' ? vend.value  : [],
        grupos:     gc.status    === 'fulfilled' ? gc.value    : [],
        lineas:     ln.status    === 'fulfilled' ? ln.value    : [],
        mercados:   merc.status  === 'fulfilled' ? merc.value  : [],
        clientes:   cli.status   === 'fulfilled' ? cli.value   : [],
      })
    })
  }, [])

  useEffect(() => {
    if (!filters.cliente) setClienteInput('')
  }, [filters.cliente])

  const handleClienteChange = (v) => {
    setClienteInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => update({ cliente: v.trim() }), 450)
  }

  // ── Month selection (range) ─────────────────────────────────────────────────
  const selectMes = (m) => {
    const { mes, mes_fin } = filters
    if (!mes) {
      update({ mes: m, mes_fin: null })
    } else if (!mes_fin) {
      if (m === mes) update({ mes: null, mes_fin: null })
      else if (m > mes) update({ mes_fin: m })
      else update({ mes: m, mes_fin: null })
    } else {
      // Range already set: extend or contract
      if (m > mes_fin)       update({ mes_fin: m })
      else if (m < mes)      update({ mes: m })
      else if (m === mes && mes === mes_fin) update({ mes: null, mes_fin: null })
      else if (m === mes)    update({ mes: mes + 1 <= mes_fin ? mes + 1 : null, mes_fin: mes + 1 <= mes_fin ? mes_fin : null })
      else if (m === mes_fin)update({ mes_fin: mes_fin - 1 >= mes ? mes_fin - 1 : null })
      else                   update({ mes: m, mes_fin: null })
    }
  }

  const selectPreset = (p) => {
    if (filters.mes === p.mes && filters.mes_fin === p.mes_fin) update({ mes: null, mes_fin: null })
    else update({ mes: p.mes, mes_fin: p.mes_fin })
  }

  const isMonthActive  = (m) => {
    if (!filters.mes) return false
    if (!filters.mes_fin) return filters.mes === m
    return m >= filters.mes && m <= filters.mes_fin
  }
  const isMonthEdge    = (m) => m === filters.mes || m === filters.mes_fin
  const isPresetActive = (p) => filters.mes === p.mes && filters.mes_fin === p.mes_fin

  const rangeLabel = filters.mes
    ? filters.mes_fin && filters.mes_fin !== filters.mes
      ? `${MN[filters.mes - 1]} → ${MN[filters.mes_fin - 1]} · ${filters.mes_fin - filters.mes + 1} meses`
      : MN[filters.mes - 1]
    : null

  const handleReset = () => { setClienteInput(''); reset() }

  // ── Multi-select togglers ───────────────────────────────────────────────────
  const toggleDim = (key, value) => {
    const current = rawFilters[key] || []
    const next    = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    update({ [key]: next })
  }

  const removeDimValue = (key, value) => {
    const next = (rawFilters[key] || []).filter((v) => v !== value)
    update({ [key]: next })
  }

  // Total active dimension chips for badge
  const totalActiveDims = selRegiones.length + selVendedores.length + selGrupos.length + selPlantas.length + selMercados.length

  return (
    <div className="px-5 py-2">
      {/* ── Row 1: year, months, presets, quick toggles ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Toggle */}
        <button onClick={onToggle} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition-colors">
          <SlidersHorizontal size={13} />
          <span className="font-medium">Filtros</span>
          {collapsed ? <ChevronDown size={12}/> : <ChevronUp size={12}/>}
          {totalActiveDims > 0 && (
            <span className="bg-brand-600/40 text-brand-300 text-[10px] px-1.5 rounded-full font-bold">{totalActiveDims}</span>
          )}
        </button>

        {/* Año */}
        <select
          className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          value={filters.ano}
          onChange={(e) => update({ ano: Number(e.target.value), mes: null, mes_fin: null })}
        >
          {opts.anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        {/* Month pills */}
        <div className="flex flex-wrap gap-1 items-center">
          <Pill label="Año" active={!filters.mes} onClick={() => update({ mes: null, mes_fin: null })} />
          {MN.map((name, i) => (
            <Pill key={i} label={name} active={isMonthActive(i + 1)} edge={isMonthEdge(i + 1)} onClick={() => selectMes(i + 1)} />
          ))}
        </div>

        {/* Range label */}
        {rangeLabel && (
          <span className="px-2.5 py-1 rounded-lg bg-brand-600/15 border border-brand-500/30 text-xs text-brand-300 font-medium">
            {rangeLabel}
          </span>
        )}

        {/* Quarter / Semester presets */}
        <div className="flex flex-wrap gap-1 border-l border-surface-700 pl-3">
          {PRESETS.map((p) => (
            <Pill key={p.label} label={p.label} active={isPresetActive(p)} onClick={() => selectPreset(p)} accent />
          ))}
        </div>

        {/* Excl exportación */}
        <button
          onClick={() => update({ excl_exportacion: !filters.excl_exportacion })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
            filters.excl_exportacion
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
          title="Excluir ventas de exportación"
        >
          <Globe size={12} />
          {filters.excl_exportacion ? 'Solo Nacional' : 'Nacional+Exp'}
        </button>

        {/* Excl PVTA */}
        <button
          onClick={() => update({ excl_pvta: !filters.excl_pvta })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
            filters.excl_pvta
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
          title="Excluir puntos de venta"
        >
          <Store size={12} />
          {filters.excl_pvta ? 'Sin PVTA' : 'Con PVTA'}
        </button>

        {/* Favoritos */}
        <div className="relative ml-auto" ref={fav.panelRef}>
          <button onClick={() => { fav.setOpen((o) => !o); fav.setGuardando(false) }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${fav.open ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-amber-300'}`}>
            <Bookmark size={12} />
            Favoritos {fav.favoritos.length > 0 && <span className="bg-amber-500/30 text-amber-300 px-1 rounded">{fav.favoritos.length}</span>}
          </button>
          {fav.open && (
            <div className="absolute right-0 top-8 z-50 w-64 bg-surface-800 border border-surface-600 rounded-xl shadow-xl p-3">
              {fav.guardando ? (
                <div className="flex gap-1.5 mb-3">
                  <input autoFocus value={fav.nombre} onChange={(e) => fav.setNombre(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fav.guardar()}
                    placeholder="Nombre del preset…"
                    className="flex-1 bg-surface-700 border border-surface-600 text-slate-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-500" />
                  <button onClick={fav.guardar} className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded-lg font-medium">OK</button>
                  <button onClick={() => fav.setGuardando(false)} className="px-2 py-1.5 bg-surface-700 text-slate-400 text-xs rounded-lg">✕</button>
                </div>
              ) : (
                <button onClick={() => fav.setGuardando(true)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium hover:bg-amber-500/20 transition-colors">
                  <BookmarkCheck size={12} /> Guardar filtros actuales
                </button>
              )}
              {fav.favoritos.length === 0
                ? <p className="text-slate-500 text-xs text-center py-2">No hay favoritos guardados</p>
                : fav.favoritos.map((f) => (
                  <div key={f.id} onClick={() => fav.cargar(f)}
                    className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-surface-700 cursor-pointer group transition-colors">
                    <span className="text-xs text-slate-200 truncate">{f.nombre}</span>
                    <button onClick={(e) => fav.eliminar(f.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all ml-2 flex-shrink-0">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              }
            </div>
          )}
        </div>

        <button onClick={handleReset} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <RotateCcw size={11} /> Limpiar
        </button>
      </div>

      {/* ── Row 2: dimension multi-selects + active chips ── */}
      {!collapsed && (
        <div className="flex flex-wrap items-start gap-3 mt-2 pt-2 border-t border-surface-700/50">
          {/* Multi-select dropdowns */}
          <MultiDimSelect
            label="Región"
            dimKey="region"
            selected={selRegiones}
            options={opts.regiones}
            onToggle={(v) => toggleDim('region', v)}
            update={update}
          />
          {!vendedorLocked && (
            <MultiDimSelect
              label="Vendedor"
              dimKey="vendedor"
              selected={selVendedores}
              options={opts.vendedores.map((v) => ({ value: v.CODIGO_VENDEDOR || v.codigo_vendedor || v, label: v.NOMBRE || v.nombre || v }))}
              onToggle={(v) => toggleDim('vendedor', v)}
              update={update}
            />
          )}
          <MultiDimSelect
            label="Grupo Comerc."
            dimKey="grupo_comercial"
            selected={selGrupos}
            options={opts.grupos}
            onToggle={(v) => toggleDim('grupo_comercial', v)}
            update={update}
          />
          <MultiDimSelect
            label="Línea Neg."
            dimKey="planta"
            selected={selPlantas}
            options={opts.lineas}
            onToggle={(v) => toggleDim('planta', v)}
            update={update}
          />
          <MultiDimSelect
            label="Mercado"
            dimKey="mercado"
            selected={selMercados}
            options={opts.mercados}
            onToggle={(v) => toggleDim('mercado', v)}
            update={update}
          />

          {/* Comparador de período */}
          <div className="flex items-center gap-1.5 border-l border-surface-700 pl-3">
            <button
              onClick={() => updateComp({ activo: !compPeriod.activo })}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all whitespace-nowrap ${
                compPeriod.activo
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                  : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-violet-300'
              }`}
            >
              ⇄ Comparar vs
            </button>
            {compPeriod.activo && (
              <>
                <select
                  className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                  value={compPeriod.ano}
                  onChange={(e) => updateComp({ ano: Number(e.target.value) })}
                >
                  {opts.anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select
                  className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                  value={compPeriod.mes ?? ''}
                  onChange={(e) => updateComp({ mes: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Año completo</option>
                  {MN.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                </select>
              </>
            )}
          </div>

          {/* Cliente searchable dropdown */}
          <ClienteSearch
            clientes={opts.clientes}
            selected={filters.cliente}
            onSelect={(nombre) => update({ cliente: nombre })}
            onClear={() => update({ cliente: '' })}
          />
        </div>
      )}

      {/* ── Active dimension chips ── */}
      {totalActiveDims > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {[
            { key: 'region',          label: 'Región',   values: selRegiones   },
            { key: 'vendedor',        label: 'Vend.',    values: selVendedores  },
            { key: 'grupo_comercial', label: 'Grupo',    values: selGrupos      },
            { key: 'planta',          label: 'Línea',    values: selPlantas     },
            { key: 'mercado',         label: 'Mercado',  values: selMercados    },
          ].flatMap(({ key, label, values }) =>
            values.map((v) => {
              const isLocked = key === 'vendedor' && vendedorLocked
              let displayVal = v
              if (key === 'vendedor') {
                const found = opts.vendedores.find(ov => (ov.CODIGO_VENDEDOR || ov.codigo_vendedor) === v)
                if (found) displayVal = found.NOMBRE || found.nombre
              }
              return (
                <span
                  key={`${key}-${v}`}
                  onClick={() => !isLocked && removeDimValue(key, v)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                    isLocked
                      ? 'bg-brand-500/25 text-brand-300 cursor-default'
                      : 'bg-brand-500/15 text-brand-300 cursor-pointer hover:bg-red-500/20 hover:text-red-400'
                  }`}
                >
                  <span className="text-slate-500">{label}:</span> {displayVal}
                  {!isLocked && <X size={10} />}
                </span>
              )
            })
          )}
          {filters.cliente && (
            <span
              onClick={() => { setClienteInput(''); update({ cliente: '' }) }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-500/15 text-brand-300 cursor-pointer hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <span className="text-slate-500">Cliente:</span> {filters.cliente}
              <X size={10} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Pill({ label, active, edge, onClick, accent = false }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        edge && active
          ? accent ? 'bg-cyan-600/80 text-white' : 'bg-brand-600 text-white'
          : active && !accent
          ? 'bg-brand-600/40 text-brand-200 ring-1 ring-brand-500/50'
          : active && accent
          ? 'bg-cyan-600/80 text-white'
          : accent
          ? 'bg-surface-700 text-cyan-400 hover:text-cyan-200 border border-cyan-800/40'
          : 'bg-surface-700 text-slate-400 hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  )
}

function MultiDimSelect({ label, dimKey, selected, options, onToggle, update }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const normalized = options.map((o) => {
    const val = typeof o === 'object' ? (o.value ?? o.id ?? o) : o
    const lbl = typeof o === 'object' ? (o.label ?? o.name ?? String(val)) : String(o)
    return { val: String(val), lbl }
  })

  const filtered = search
    ? normalized.filter(({ lbl }) => lbl.toLowerCase().includes(search.toLowerCase()))
    : normalized

  const hasSelection = selected.length > 0
  const allFilteredSelected = filtered.length > 0 && filtered.every(f => selected.includes(f.val))

  const handleToggleAll = (e) => {
    e.stopPropagation()
    const visibleVals = filtered.map(f => f.val)
    if (allFilteredSelected) {
      // Remove all visible from selection
      update({ [dimKey]: selected.filter(s => !visibleVals.includes(s)) })
    } else {
      // Add all visible to selection
      update({ [dimKey]: Array.from(new Set([...selected, ...visibleVals])) })
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          hasSelection
            ? 'bg-brand-600/20 text-brand-300 border-brand-500/40'
            : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
        }`}
      >
        {label}
        {hasSelection && (
          <span className="bg-brand-500/40 text-brand-200 text-[10px] px-1.5 rounded-full font-bold leading-4">
            {selected.length}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden flex flex-col">
          {/* Header with Toggle All */}
          <div className="p-2 border-b border-surface-700 space-y-2 bg-surface-800/80 backdrop-blur">
            <div className="flex items-center justify-between px-1">
              <button
                onClick={handleToggleAll}
                className="text-[10px] uppercase tracking-wider font-bold text-brand-400 hover:text-brand-300 transition-colors"
              >
                {allFilteredSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
              </button>
              <span className="text-[10px] text-slate-500">{filtered.length} items</span>
            </div>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}…`}
                className="w-full bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded-lg pl-6 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">Sin resultados</p>
            ) : (
              filtered.map(({ val, lbl }) => {
                const active = selected.includes(val)
                return (
                  <div
                    key={val}
                    onClick={() => onToggle(val)}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs transition-colors ${
                      active ? 'bg-brand-600/10 text-brand-300' : 'text-slate-300 hover:bg-surface-700/50'
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                      active ? 'bg-brand-500 border-brand-500' : 'border-slate-600 bg-surface-700'
                    }`}>
                      {active && <Check size={9} className="text-white" />}
                    </div>
                    <span className="truncate">{lbl}</span>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          {hasSelection && (
            <div className="p-2 border-t border-surface-700 bg-surface-800/80">
              <button
                onClick={(e) => { e.stopPropagation(); update({ [dimKey]: [] }); setOpen(false) }}
                className="w-full text-[10px] uppercase font-bold text-slate-500 hover:text-red-400 py-1 transition-colors"
              >
                Limpiar selección ({selected.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ClienteSearch({ clientes, selected, onSelect, onClear }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref                 = useRef(null)

  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const normalized = (clientes || []).map((c) => {
    const num  = String(c.NUMERO_CLIENTE ?? c.numero_cliente ?? '')
    const name = String(c.NOMBRE ?? c.nombre ?? num)
    return { num, name }
  })

  const filtered = search.length >= 2
    ? normalized.filter(({ name, num }) =>
        name.toLowerCase().includes(search.toLowerCase()) ||
        num.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 30)
    : []

  const handleSelect = (name) => {
    onSelect(name)
    setSearch('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          selected
            ? 'bg-brand-600/20 text-brand-300 border-brand-500/40'
            : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
        }`}
      >
        <Search size={11} />
        {selected ? `${selected.length > 18 ? selected.slice(0, 18) + '…' : selected}` : 'Cliente'}
        {selected && (
          <span
            onClick={(e) => { e.stopPropagation(); onClear(); setSearch('') }}
            className="ml-1 hover:text-red-400"
          >
            <X size={10} />
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-surface-700">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full bg-surface-700 border border-surface-600 text-slate-200 text-xs rounded-lg pl-6 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-52 overflow-y-auto">
            {search.length < 2 ? (
              <p className="text-xs text-slate-500 text-center py-3">Escribe al menos 2 letras…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">Sin resultados</p>
            ) : (
              filtered.map(({ num, name }) => (
                <div
                  key={num}
                  onClick={() => handleSelect(name)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors ${
                    selected === name ? 'bg-brand-600/15 text-brand-300' : 'text-slate-300 hover:bg-surface-700'
                  }`}
                >
                  <span className="text-slate-500 w-12 flex-shrink-0 font-mono">{num}</span>
                  <span className="truncate">{name}</span>
                </div>
              ))
            )}
          </div>

          {/* Clear */}
          {selected && (
            <div className="p-2 border-t border-surface-700">
              <button
                onClick={() => { onClear(); setOpen(false); setSearch('') }}
                className="w-full text-xs text-slate-400 hover:text-red-400 py-1 transition-colors"
              >
                Limpiar cliente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
