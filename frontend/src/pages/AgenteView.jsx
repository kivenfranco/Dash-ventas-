import { useState, useRef, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useFilters } from '../context/FilterContext'
import { api } from '../services/api'
import { Bot, Send, User, ChevronDown, ChevronUp, Database, Loader2, Trash2, Zap } from 'lucide-react'

function SqlBlock({ sql, descripcion, datos }) {
  const [openSql, setOpenSql]   = useState(false)
  const [openData, setOpenData] = useState(false)
  if (!sql) return null
  const cols = datos?.columns || []
  const rows = datos?.rows || []
  return (
    <div className="mt-3 space-y-1.5">
      <button
        onClick={() => setOpenSql((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        {openSql ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <Database size={11} />
        {descripcion || 'Ver SQL'}
      </button>
      {openSql && (
        <pre className="bg-surface-950 border border-surface-700 rounded-lg p-3 text-xs text-cyan-300 overflow-x-auto whitespace-pre-wrap">{sql}</pre>
      )}
      {rows.length > 0 && (
        <>
          <button
            onClick={() => setOpenData((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {openData ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Ver datos ({datos.total_rows} filas{datos.total_rows > rows.length ? `, mostrando ${rows.length}` : ''})
          </button>
          {openData && (
            <div className="overflow-x-auto">
              <table className="text-xs border border-surface-700 rounded-lg overflow-hidden w-full">
                <thead>
                  <tr className="bg-surface-800">
                    {cols.map((c) => (
                      <th key={c} className="px-2 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap border-b border-surface-700">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-surface-700/50 hover:bg-surface-700/20">
                      {row.map((v, j) => (
                        <td key={j} className="px-2 py-1.5 text-slate-300 whitespace-nowrap max-w-48 truncate">{v == null ? '—' : String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TokenUsage({ usage }) {
  if (!usage) return null
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500 mt-2">
      <Zap size={11} />
      <span>
        {usage.input_tokens} in · {usage.output_tokens} out
      </span>
    </div>
  )
}

function Mensaje({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUser ? 'bg-brand-600' : 'bg-surface-700 border border-surface-600'}`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-brand-400" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-600 text-white rounded-tr-sm'
            : 'bg-surface-800 border border-surface-700 text-slate-200 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>
        {!isUser && (
          <SqlBlock sql={msg.sql} descripcion={msg.sql_descripcion} datos={msg.datos} />
        )}
        {!isUser && <TokenUsage usage={msg.uso} />}
      </div>
    </div>
  )
}

const SUGERENCIAS = [
  '¿Cuáles son los 5 vendedores con más ventas este año?',
  '¿Qué región tiene mayor crecimiento YoY?',
  '¿Cuántos clientes nuevos hay en 2025?',
  '¿Cómo van las ventas de stock vs no stock?',
  '¿Qué vendedor tiene mejor cumplimiento de presupuesto?',
]

const CHAT_KEY = 'bi_agente_chat'

export function AgenteView() {
  const { refreshKey }  = useOutletContext()
  const { filters }     = useFilters()
  const [mensajes, setMensajes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]') } catch { return [] }
  })
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(mensajes)) } catch (_) {}
  }, [mensajes])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, loading])

  const buildHistorial = (msgs) =>
    msgs.flatMap((m) => {
      if (m.role === 'user')      return [{ role: 'user',      content: m.content }]
      if (m.role === 'assistant') return [{ role: 'assistant', content: m.content }]
      return []
    })

  const enviar = async (texto) => {
    const pregunta = (texto || input).trim()
    if (!pregunta || loading) return
    setInput('')
    setError(null)

    const newMsgs = [...mensajes, { role: 'user', content: pregunta }]
    setMensajes(newMsgs)
    setLoading(true)

    try {
      const historial = buildHistorial(mensajes)
      const res = await api.agente(pregunta, historial, filters.ano, filters.mes)
      setMensajes((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.respuesta,
          sql: res.sql,
          sql_descripcion: res.sql_descripcion,
          datos: res.datos,
          uso: res.uso,
        },
      ])
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || 'Error desconocido'
      setError(msg)
      setMensajes((prev) => prev.slice(0, -1))
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const limpiar = () => {
    setMensajes([])
    setError(null)
    try { localStorage.removeItem(CHAT_KEY) } catch (_) {}
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-[calc(100vh-170px)] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Agente BI</h1>
          <p className="text-slate-500 text-xs mt-0.5">Consulta los datos de ventas en lenguaje natural · Snowflake + Claude</p>
        </div>
        {mensajes.length > 0 && (
          <button onClick={limpiar} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-rose-500/10">
            <Trash2 size={12} />
            Limpiar
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {mensajes.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="w-16 h-16 rounded-2xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center">
              <Bot size={28} className="text-brand-400" />
            </div>
            <div className="text-center">
              <p className="text-slate-300 font-medium mb-1">Pregunta lo que necesites</p>
              <p className="text-slate-500 text-xs">Consulto Snowflake en tiempo real y respondo con datos actuales</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="text-left text-xs text-slate-400 hover:text-slate-100 bg-surface-800 hover:bg-surface-700 border border-surface-700 hover:border-surface-600 rounded-xl px-4 py-3 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) => <Mensaje key={i} msg={m} />)}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-brand-400" />
            </div>
            <div className="bg-surface-800 border border-surface-700 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin text-brand-400" />
              <span className="text-xs text-slate-400">Consultando Snowflake…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 mt-4">
        <form onSubmit={(e) => { e.preventDefault(); enviar() }} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta sobre ventas, clientes, productos…"
            disabled={loading}
            className="flex-1 bg-surface-800 border border-surface-700 focus:border-brand-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex items-center gap-1.5 px-4 py-3 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
        <p className="text-xs text-slate-600 mt-2 text-center">
          Usa los filtros globales de año y mes para enfocar el análisis
        </p>
      </div>
    </div>
  )
}
