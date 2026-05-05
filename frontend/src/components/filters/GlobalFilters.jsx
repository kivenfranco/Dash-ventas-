import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp, Globe, Store, Search, Bookmark, BookmarkCheck, Trash2 } from 'lucide-react'
import { useFilters } from '../../context/FilterContext'
import { api } from '../../services/api'

const STORAGE_KEY = 'bi_ventas_favoritos'

function useFavoritos(filters, update) {
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
    const nuevo = { id: Date.now(), nombre: nombre.trim(), filters: { ...filters } }
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
  const { filters, update, reset, compPeriod, updateComp } = useFilters()
  const fav = useFavoritos(filters, update)
  const [opts, setOpts] = useState({ anos: [], regiones: [], vendedores: [], grupos: [], lineas: [], mercados: [] })
  const [clienteInput, setClienteInput] = useState(filters.cliente || '')
  const debounceRef = useRef(null)

  useEffect(() => {
    Promise.allSettled([
      api.filterAnos(), api.filterRegiones(), api.filterVendedores(),
      api.filterGruposComerciales(), api.filterLineas(), api.filterMercados(),
    ]).then(([anos, reg, vend, gc, ln, merc]) => {
      setOpts({
        anos:       anos.status  === 'fulfilled' ? anos.value  : [],
        regiones:   reg.status   === 'fulfilled' ? reg.value   : [],
        vendedores: vend.status  === 'fulfilled' ? vend.value  : [],
        grupos:     gc.status    === 'fulfilled' ? gc.value    : [],
        lineas:     ln.status    === 'fulfilled' ? ln.value    : [],
        mercados:   merc.status  === 'fulfilled' ? merc.value  : [],
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

  const activeFilters = [
    { key: 'region',          label: 'Región',   value: filters.region },
    { key: 'vendedor',        label: 'Vendedor', value: filters.vendedor },
    { key: 'grupo_comercial', label: 'Grupo',    value: filters.grupo_comercial },
    { key: 'planta',          label: 'Línea',    value: filters.planta },
    { key: 'mercado',         label: 'Mercado',  value: filters.mercado },
    { key: 'cliente',         label: 'Cliente',  value: filters.cliente },
  ].filter((f) => f.value)

  const selectMes = (m) => {
    if (filters.mes === m && !filters.mes_fin) {
      update({ mes: null, mes_fin: null })
    } else {
      update({ mes: m, mes_fin: null })
    }
  }

  const selectPreset = (p) => {
    if (filters.mes === p.mes && filters.mes_fin === p.mes_fin) {
      update({ mes: null, mes_fin: null })
    } else {
      update({ mes: p.mes, mes_fin: p.mes_fin })
    }
  }

  const isMonthActive  = (m) => filters.mes === m && (!filters.mes_fin || filters.mes_fin === m)
  const isPresetActive = (p) => filters.mes === p.mes && filters.mes_fin === p.mes_fin

  const handleReset = () => {
    setClienteInput('')
    reset()
  }

  return (
    <div className="px-5 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {/* Toggle */}
        <button onClick={onToggle} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition-colors">
          <SlidersHorizontal size={13} />
          <span className="font-medium">Filtros</span>
          {collapsed ? <ChevronDown size={12}/> : <ChevronUp size={12}/>}
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
        <div className="flex flex-wrap gap-1">
          <Pill label="Año" active={!filters.mes} onClick={() => update({ mes: null, mes_fin: null })} />
          {MN.map((name, i) => (
            <Pill key={i} label={name} active={isMonthActive(i + 1)} onClick={() => selectMes(i + 1)} />
          ))}
        </div>

        {/* Quarter / Semester presets */}
        <div className="flex flex-wrap gap-1 border-l border-surface-700 pl-3">
          {PRESETS.map((p) => (
            <Pill key={p.label} label={p.label} active={isPresetActive(p)} onClick={() => selectPreset(p)} accent />
          ))}
        </div>

        {/* Active dimension chips */}
        {activeFilters.map((f) => (
          <span
            key={f.key}
            onClick={() => {
              if (f.key === 'cliente') setClienteInput('')
              update({ [f.key]: '' })
            }}
            className="badge badge-blue cursor-pointer hover:bg-red-500/20 hover:text-red-400 transition-colors text-xs"
          >
            {f.label}: {f.value} ×
          </span>
        ))}

        {/* Excl exportación */}
        <button
          onClick={() => update({ excl_exportacion: !filters.excl_exportacion })}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
            filters.excl_exportacion
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-surface-700 text-slate-400 border-surface-600 hover:text-slate-100'
          }`}
          title="Excluir ventas de exportación (ZONA EXPORTACIONES)"
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
          title="Excluir puntos de venta (PVTA*, PBOGOTA)"
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
              {/* Guardar actual */}
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

      {/* Expanded dimension filters */}
      {!collapsed && (
        <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-surface-700/50">
          <DimSelect label="Región"        value={filters.region}          onChange={(v) => update({ region: v })}          options={opts.regiones} />
          <DimSelect label="Vendedor"      value={filters.vendedor}        onChange={(v) => update({ vendedor: v })}        options={opts.vendedores.map((v) => ({ value: v.CODIGO_VENDEDOR || v.codigo_vendedor, label: v.NOMBRE || v.nombre || v }))} />
          <DimSelect label="Grupo Comerc." value={filters.grupo_comercial} onChange={(v) => update({ grupo_comercial: v })} options={opts.grupos} />
          <DimSelect label="Línea Neg."    value={filters.planta}          onChange={(v) => update({ planta: v })}          options={opts.lineas} />
          <DimSelect label="Mercado"       value={filters.mercado}         onChange={(v) => update({ mercado: v })}         options={opts.mercados} />
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
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 whitespace-nowrap">Cliente</label>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-36 placeholder-slate-500"
                placeholder="buscar nombre..."
                value={clienteInput}
                onChange={(e) => handleClienteChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ label, active, onClick, accent = false }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        active
          ? accent ? 'bg-cyan-600/80 text-white' : 'bg-brand-600 text-white'
          : accent ? 'bg-surface-700 text-cyan-400 hover:text-cyan-200 border border-cyan-800/40' : 'bg-surface-700 text-slate-400 hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  )
}

function DimSelect({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-slate-400 whitespace-nowrap">{label}</label>
      <select
        className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer w-36"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Todos</option>
        {options.map((o) => {
          const val = typeof o === 'object' ? o.value : o
          const lbl = typeof o === 'object' ? o.label : o
          return <option key={val} value={val}>{lbl}</option>
        })}
      </select>
    </div>
  )
}
