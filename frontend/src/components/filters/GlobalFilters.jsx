import { useEffect, useState } from 'react'
import { SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp, Globe, Store } from 'lucide-react'
import { useFilters } from '../../context/FilterContext'
import { api } from '../../services/api'

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
  const { filters, update, reset } = useFilters()
  const [opts, setOpts] = useState({ anos: [], regiones: [], vendedores: [], grupos: [], plantas: [] })

  useEffect(() => {
    Promise.allSettled([
      api.filterAnos(), api.filterRegiones(), api.filterVendedores(),
      api.filterGruposComerciales(), api.filterPlantas(),
    ]).then(([anos, reg, vend, gc, pl]) => {
      setOpts({
        anos:       anos.status === 'fulfilled'  ? anos.value  : [],
        regiones:   reg.status === 'fulfilled'   ? reg.value   : [],
        vendedores: vend.status === 'fulfilled'  ? vend.value  : [],
        grupos:     gc.status === 'fulfilled'    ? gc.value    : [],
        plantas:    pl.status === 'fulfilled'    ? pl.value    : [],
      })
    })
  }, [])

  const activeFilters = [
    { key: 'region',          label: 'Región',   value: filters.region },
    { key: 'vendedor',        label: 'Vendedor',  value: filters.vendedor },
    { key: 'grupo_comercial', label: 'Grupo',     value: filters.grupo_comercial },
    { key: 'planta',          label: 'Planta',    value: filters.planta },
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

  const isMonthActive = (m) => filters.mes === m && (!filters.mes_fin || filters.mes_fin === m)
  const isPresetActive = (p) => filters.mes === p.mes && filters.mes_fin === p.mes_fin

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
            <Pill
              key={p.label}
              label={p.label}
              active={isPresetActive(p)}
              onClick={() => selectPreset(p)}
              accent
            />
          ))}
        </div>

        {/* Active dimension chips */}
        {activeFilters.map((f) => (
          <span
            key={f.key}
            onClick={() => update({ [f.key]: '' })}
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
          title="Excluir ventas de puntos de venta (PVTA)"
        >
          <Store size={12} />
          {filters.excl_pvta ? 'Sin PVTA' : 'Con PVTA'}
        </button>

        <button onClick={reset} className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <RotateCcw size={11} /> Limpiar
        </button>
      </div>

      {/* Expanded dimension filters */}
      {!collapsed && (
        <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-surface-700/50">
          <DimSelect label="Región"         value={filters.region}          onChange={(v) => update({ region: v })}          options={opts.regiones} />
          <DimSelect label="Vendedor"       value={filters.vendedor}        onChange={(v) => update({ vendedor: v })}        options={opts.vendedores.map((v) => ({ value: v.CODIGO_VENDEDOR || v.codigo_vendedor, label: v.NOMBRE || v.nombre || v }))} />
          <DimSelect label="Grupo Comerc."  value={filters.grupo_comercial} onChange={(v) => update({ grupo_comercial: v })} options={opts.grupos} />
          <DimSelect label="Planta"         value={filters.planta}          onChange={(v) => update({ planta: v })}          options={opts.plantas} />
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
          ? accent
            ? 'bg-cyan-600/80 text-white'
            : 'bg-brand-600 text-white'
          : accent
            ? 'bg-surface-700 text-cyan-400 hover:text-cyan-200 border border-cyan-800/40'
            : 'bg-surface-700 text-slate-400 hover:text-slate-100'
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
