import { useState, useEffect } from 'react'
import { BarChart2, Menu, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../../services/api'

export function Header({ onToggleSidebar, onRefresh }) {
  const [health, setHealth] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'error' }))
    const id = setInterval(() => {
      api.health().then(setHealth).catch(() => setHealth({ status: 'error' }))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.refresh()
      onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }

  const connected = health?.snowflake === true

  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-16 bg-surface-900 border-b border-surface-700 flex items-center px-4 gap-4">
      <button onClick={onToggleSidebar} className="btn-ghost p-2">
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-600 to-cyan-500 flex items-center justify-center">
          <BarChart2 size={14} className="text-white" />
        </div>
        <span className="font-bold text-slate-100 tracking-tight">BI Ventas</span>
        <span className="hidden sm:block text-xs text-slate-500 ml-1">
          Alico · {format(new Date(), "d 'de' MMMM yyyy", { locale: es })}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span className="hidden sm:block">{connected ? 'Snowflake conectado' : 'Sin conexión'}</span>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-ghost flex items-center gap-1.5 text-xs"
          title="Forzar actualización de datos"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden md:block">Actualizar</span>
        </button>
      </div>
    </header>
  )
}
