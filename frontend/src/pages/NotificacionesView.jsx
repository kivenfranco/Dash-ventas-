import { useEffect, useState, useCallback } from 'react'
import { api } from '../services/api'
import { fmtCOP } from '../utils/format'
import {
  Mail, Send, Settings, Search, CheckCircle, AlertTriangle,
  UserCheck, UserX, Eye, Trash2, RefreshCw, Info, Bell,
  MessageSquare, Smartphone,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ ok }) {
  return ok
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium">Mapeado</span>
    : <span className="text-xs px-2 py-0.5 rounded-full bg-surface-700 text-slate-500 border border-surface-600 font-medium">Sin mapear</span>
}

function SmtpBanner({ config }) {
  if (!config) return null
  if (config.smtp_configurado) return (
    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-4 py-3 text-xs text-emerald-300">
      <CheckCircle size={13} />
      SMTP configurado · enviando desde <strong className="ml-1">{config.smtp_user}</strong> via {config.smtp_host}:{config.smtp_port}
    </div>
  )
  return (
    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-xs text-amber-300">
      <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
      <div>
        <strong>SMTP no configurado.</strong> Agrega en el archivo <code className="bg-surface-700 px-1 rounded">.env</code> del backend:
        <pre className="mt-2 bg-surface-800 rounded p-2 text-slate-300 leading-5">{`SMTP_USER=kfranco@alico-sa.com\nSMTP_PASSWORD=tu_contraseña`}</pre>
        Usa tu correo de Outlook corporativo. Si tienes MFA activo, genera una contraseña de aplicación en{' '}
        <a href="https://mysignins.microsoft.com/security-info" target="_blank" rel="noreferrer" className="underline">mysignins.microsoft.com</a>.
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function NotificacionesView() {
  const [vendedores,  setVendedores]  = useState([])
  const [contactos,   setContactos]   = useState([])
  const [config,      setConfig]      = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [tab,         setTab]         = useState('mapeo')   // 'mapeo' | 'enviar' | 'canales'
  const [envioLog,    setEnvioLog]    = useState(null)
  const [enviando,    setEnviando]    = useState(false)
  const [previewCod,  setPreviewCod]  = useState(null)
  const [saving,      setSaving]      = useState(null)

  // edición inline por vendedor
  const [edits, setEdits] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, c, cfg] = await Promise.all([
        api.notifVendedores(),
        api.notifContactos(),
        api.notifConfig(),
      ])
      setVendedores(v.vendedores || [])
      setContactos(c.contactos   || [])
      setConfig(cfg)
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = vendedores.filter((v) =>
    !search || v.nombre?.toLowerCase().includes(search.toLowerCase()) || v.codigo_vendedor?.toLowerCase().includes(search.toLowerCase())
  )

  const mapeados   = filtered.filter((v) => v.mapeado)
  const sinMapear  = filtered.filter((v) => !v.mapeado)

  const setEdit = (cod, field, val) =>
    setEdits((prev) => ({ ...prev, [cod]: { ...prev[cod], [field]: val } }))

  const getEdit = (v, field) =>
    edits[v.codigo_vendedor]?.[field] ?? v[field] ?? ''

  const handleSaveOne = async (v) => {
    const email         = getEdit(v, 'email')
    const nombre_asesor = getEdit(v, 'nombre_asesor') || v.nombre
    const director_email = getEdit(v, 'director_email') || v.director_sugerido || ''
    if (!email) return
    setSaving(v.codigo_vendedor)
    try {
      await api.notifSaveMapeo([{
        codigo_vendedor: v.codigo_vendedor,
        email,
        nombre_asesor,
        director_email,
        region: v.region_principal,
      }])
      await load()
      setEdits((prev) => { const n = { ...prev }; delete n[v.codigo_vendedor]; return n })
    } catch (_) {}
    setSaving(null)
  }

  const handleDelete = async (cod) => {
    try {
      await api.notifDeleteMapeo(cod)
      await load()
    } catch (_) {}
  }

  const handleEnviarTodos = async () => {
    setEnviando(true)
    setEnvioLog(null)
    try {
      const res = await api.notifEnviar({})
      setEnvioLog(res)
    } catch (e) {
      setEnvioLog({ status: 'error', mensaje: String(e) })
    }
    setEnviando(false)
  }

  const handleEnviarUno = async (cod) => {
    setEnviando(cod)
    try {
      const res = await api.notifEnviarUno(cod, {})
      setEnvioLog(res)
    } catch (e) {
      setEnvioLog({ status: 'error', mensaje: String(e) })
    }
    setEnviando(null)
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Bell size={18} className="text-brand-400" /> Notificaciones — Alertas Semanales
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Envío automático cada lunes 8:00 AM · Clientes en caída YoY y clientes inactivos por vendedor
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
          <RefreshCw size={12} /> Recargar
        </button>
      </div>

      {/* SMTP banner */}
      <SmtpBanner config={config} />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-700">
        {[['mapeo', 'Configurar Mapeo'], ['enviar', 'Enviar Alertas'], ['canales', 'Canales y Pruebas']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: Mapeo ── */}
      {tab === 'mapeo' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar vendedor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-full"
              />
            </div>
            <span className="text-xs text-slate-500">
              <strong className="text-emerald-400">{mapeados.length}</strong> mapeados ·{' '}
              <strong className="text-amber-400">{sinMapear.length}</strong> pendientes
            </span>
          </div>

          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Info size={12} />
            Para cada vendedor del sistema, asigna el correo del asesor responsable y el director de zona que recibirá copia.
            El gerente, subgerente y BI siempre son copiados automáticamente.
          </p>

          {loading
            ? <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="card h-16 animate-pulse" />)}</div>
            : (
              <div className="flex flex-col gap-2">
                {filtered.map((v) => (
                  <VendedorRow
                    key={v.codigo_vendedor}
                    v={v}
                    contactos={contactos}
                    edit={edits[v.codigo_vendedor] || {}}
                    setEdit={(field, val) => setEdit(v.codigo_vendedor, field, val)}
                    onSave={() => handleSaveOne(v)}
                    onDelete={() => handleDelete(v.codigo_vendedor)}
                    onPreview={() => setPreviewCod(v.codigo_vendedor)}
                    saving={saving === v.codigo_vendedor}
                    enviando={enviando === v.codigo_vendedor}
                    onEnviar={() => handleEnviarUno(v.codigo_vendedor)}
                    config={config}
                  />
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* ── TAB: Enviar ── */}
      {tab === 'enviar' && (
        <div className="flex flex-col gap-4">
          <div className="card border-surface-700">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Envío masivo — todos los vendedores mapeados</h2>
            <p className="text-xs text-slate-500 mb-4">
              Solo se envía a vendedores con correo asignado y que tengan al menos 1 cliente en alerta o inactivo.
              El sistema también envía automáticamente cada lunes a las 8:00 AM (hora Colombia).
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleEnviarTodos}
                disabled={enviando === true || !config?.smtp_configurado}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  config?.smtp_configurado
                    ? 'bg-brand-600 hover:bg-brand-500 text-white'
                    : 'bg-surface-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                {enviando === true ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {enviando === true ? 'Enviando…' : 'Enviar ahora a todos'}
              </button>
              {!config?.smtp_configurado && (
                <span className="text-xs text-amber-400">Configura SMTP primero</span>
              )}
            </div>
          </div>

          {/* Resultado de envío */}
          {envioLog && <EnvioLog log={envioLog} />}

          {/* Resumen de mapeados */}
          <div className="card">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">
              Vendedores configurados ({vendedores.filter((v) => v.mapeado).length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-surface-700 text-slate-400">
                    <th className="pb-2 font-medium">Código</th>
                    <th className="pb-2 font-medium">Nombre DB</th>
                    <th className="pb-2 font-medium">Email asesor</th>
                    <th className="pb-2 font-medium">Director CC</th>
                    <th className="pb-2 font-medium text-right">Ventas {new Date().getFullYear()}</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {vendedores.filter((v) => v.mapeado).map((v) => (
                    <tr key={v.codigo_vendedor} className="border-b border-surface-700/30 hover:bg-surface-700/20">
                      <td className="py-2 font-mono text-slate-400">{v.codigo_vendedor}</td>
                      <td className="py-2 text-slate-200 font-medium">{v.nombre}</td>
                      <td className="py-2 text-brand-300">{v.email}</td>
                      <td className="py-2 text-slate-400">{v.director_email || '—'}</td>
                      <td className="py-2 text-right text-slate-300">{fmtCOP(v.ventas_totales)}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => handleEnviarUno(v.codigo_vendedor)}
                          disabled={!config?.smtp_configurado || enviando === v.codigo_vendedor}
                          className="text-brand-400 hover:text-brand-200 transition-colors"
                          title="Enviar ahora"
                        >
                          {enviando === v.codigo_vendedor
                            ? <RefreshCw size={12} className="animate-spin" />
                            : <Send size={12} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Canales ── */}
      {tab === 'canales' && (
        <CanalesTab config={config} />
      )}

      {/* Preview modal */}
      {previewCod && (
        <PreviewModal
          cod={previewCod}
          onClose={() => setPreviewCod(null)}
        />
      )}
    </div>
  )
}

// ── Canales y pruebas ────────────────────────────────────────────────────────

function ChannelCard({ icon: Icon, title, configured, children }) {
  return (
    <div className={`card border ${configured ? 'border-surface-700' : 'border-surface-700/50'}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${configured ? 'bg-emerald-500/15' : 'bg-surface-700'}`}>
          <Icon size={16} className={configured ? 'text-emerald-400' : 'text-slate-500'} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{title}</span>
            {configured
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Configurado</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-surface-700 text-slate-500 border border-surface-600">No configurado</span>
            }
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

function CanalesTab({ config }) {
  const [emailDest,    setEmailDest]    = useState('')
  const [teamsMsg,     setTeamsMsg]     = useState('')
  const [waNumero,     setWaNumero]     = useState('')
  const [waMsg,        setWaMsg]        = useState('')
  const [emailLog,     setEmailLog]     = useState(null)
  const [teamsLog,     setTeamsLog]     = useState(null)
  const [waLog,        setWaLog]        = useState(null)
  const [sending,      setSending]      = useState(null)

  const testEmail = async () => {
    setSending('email'); setEmailLog(null)
    try {
      const r = await api.notifEmailTest(emailDest ? { destinatario: emailDest } : {})
      setEmailLog({ ok: true, msg: r.mensaje })
    } catch (e) {
      setEmailLog({ ok: false, msg: e?.response?.data?.detail || String(e) })
    }
    setSending(null)
  }

  const testTeams = async () => {
    setSending('teams'); setTeamsLog(null)
    try {
      const r = await api.notifTeamsTest(teamsMsg ? { mensaje: teamsMsg } : {})
      setTeamsLog({ ok: true, msg: r.mensaje })
    } catch (e) {
      setTeamsLog({ ok: false, msg: e?.response?.data?.detail || String(e) })
    }
    setSending(null)
  }

  const testWhatsApp = async () => {
    if (!waNumero) return
    setSending('wa'); setWaLog(null)
    try {
      const r = await api.notifWhatsAppTest({ numero: waNumero, ...(waMsg ? { mensaje: waMsg } : {}) })
      setWaLog({ ok: true, msg: r.mensaje })
    } catch (e) {
      setWaLog({ ok: false, msg: e?.response?.data?.detail || String(e) })
    }
    setSending(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">
        Configura cada canal en <code className="bg-surface-700 px-1 rounded">backend/.env</code> y prueba la conexión.
        Las alertas semanales solo usan Email por ahora — Teams y WhatsApp son notificaciones adicionales opcionales.
      </p>

      {/* Email */}
      <ChannelCard icon={Mail} title="Correo electrónico (SMTP)" configured={config?.smtp_configurado}>
        {config?.smtp_configurado ? (
          <p className="text-xs text-slate-400 mb-3">
            Enviando como <strong className="text-slate-200">{config.smtp_user}</strong> vía {config.smtp_host}:{config.smtp_port}
          </p>
        ) : (
          <pre className="text-xs bg-surface-800 rounded p-3 text-slate-300 leading-5 mb-3">{`SMTP_USER=kfranco@alico-sa.com\nSMTP_PASSWORD=tu_contraseña_de_aplicación`}</pre>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            placeholder={`Enviar a (default: ${config?.smtp_user || 'SMTP_USER'})`}
            value={emailDest}
            onChange={(e) => setEmailDest(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 flex-1 min-w-48"
          />
          <button
            onClick={testEmail}
            disabled={sending === 'email' || !config?.smtp_configurado}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-surface-700 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {sending === 'email' ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />}
            Enviar prueba
          </button>
        </div>
        {emailLog && <TestLog log={emailLog} />}
      </ChannelCard>

      {/* Teams */}
      <ChannelCard icon={MessageSquare} title="Microsoft Teams (Webhook)" configured={config?.teams_configurado}>
        {!config?.teams_configurado && (
          <pre className="text-xs bg-surface-800 rounded p-3 text-slate-300 leading-5 mb-3">{`TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...`}</pre>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Mensaje de prueba (opcional)"
            value={teamsMsg}
            onChange={(e) => setTeamsMsg(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 flex-1 min-w-48"
          />
          <button
            onClick={testTeams}
            disabled={sending === 'teams' || !config?.teams_configurado}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-surface-700 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {sending === 'teams' ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />}
            Probar Teams
          </button>
        </div>
        {teamsLog && <TestLog log={teamsLog} />}
      </ChannelCard>

      {/* WhatsApp */}
      <ChannelCard icon={Smartphone} title="WhatsApp Business API" configured={config?.whatsapp_configurado}>
        {!config?.whatsapp_configurado && (
          <pre className="text-xs bg-surface-800 rounded p-3 text-slate-300 leading-5 mb-3">{`WHATSAPP_TOKEN=EAAxxxx\nWHATSAPP_PHONE_ID=1234567890`}</pre>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="tel"
            placeholder="Número destino (+57300...)"
            value={waNumero}
            onChange={(e) => setWaNumero(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-44"
          />
          <input
            type="text"
            placeholder="Mensaje (opcional)"
            value={waMsg}
            onChange={(e) => setWaMsg(e.target.value)}
            className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 flex-1 min-w-32"
          />
          <button
            onClick={testWhatsApp}
            disabled={sending === 'wa' || !config?.whatsapp_configurado || !waNumero}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-surface-700 disabled:text-slate-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {sending === 'wa' ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />}
            Probar WA
          </button>
        </div>
        {waLog && <TestLog log={waLog} />}
      </ChannelCard>
    </div>
  )
}

function TestLog({ log }) {
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
      log.ok
        ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
        : 'bg-red-500/10 border border-red-500/25 text-red-300'
    }`}>
      {log.ok ? <CheckCircle size={12} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />}
      <span>{log.msg}</span>
    </div>
  )
}

// ── Fila de vendedor ──────────────────────────────────────────────────────────

function VendedorRow({ v, contactos, edit, setEdit, onSave, onDelete, onPreview, saving, enviando, onEnviar, config }) {
  const [open, setOpen] = useState(!v.mapeado && false)

  const emailOpts = contactos.map((c) => ({ value: c.email, label: `${c.nombre} (${c.email})` }))
  const dirOpts   = contactos
    .filter((c) => c.cargo?.toLowerCase().includes('director'))
    .map((c) => ({ value: c.email, label: `${c.nombre} — ${c.cargo}` }))

  const currentEmail  = edit.email          ?? v.email          ?? ''
  const currentDir    = edit.director_email ?? v.director_email ?? v.director_sugerido ?? ''
  const currentNombre = edit.nombre_asesor  ?? v.nombre_asesor  ?? v.nombre            ?? ''

  const isDirty = (edit.email !== undefined && edit.email !== v.email) ||
                  (edit.director_email !== undefined && edit.director_email !== v.director_email) ||
                  (edit.nombre_asesor !== undefined && edit.nombre_asesor !== v.nombre_asesor)

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      v.mapeado ? 'border-surface-700 bg-surface-800/50' : 'border-surface-700/50 bg-surface-900/50'
    }`}>
      {/* Header de la fila */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-surface-700 flex items-center justify-center flex-shrink-0">
          {v.mapeado
            ? <UserCheck size={13} className="text-emerald-400" />
            : <UserX     size={13} className="text-slate-500"   />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100">{v.nombre}</span>
            <span className="text-xs font-mono text-slate-500">{v.codigo_vendedor}</span>
            <Badge ok={v.mapeado} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
            <span>{v.region_principal || '—'}</span>
            {v.mapeado && <span className="text-brand-400">{v.email}</span>}
            {v.mapeado && v.director_email && <span>CC: {v.director_email}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {v.mapeado && (
            <>
              <button onClick={onPreview} className="p-1.5 text-slate-500 hover:text-brand-300 hover:bg-surface-700 rounded-lg transition-colors" title="Previsualizar email">
                <Eye size={13} />
              </button>
              <button
                onClick={onEnviar}
                disabled={!config?.smtp_configurado || enviando}
                className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-surface-700 rounded-lg transition-colors disabled:opacity-40"
                title="Enviar ahora"
              >
                {enviando ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
              <button onClick={onDelete} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-surface-700 rounded-lg transition-colors" title="Eliminar mapeo">
                <Trash2 size={13} />
              </button>
            </>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-surface-700 rounded-lg transition-colors"
            title="Configurar"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* Formulario expandible */}
      {open && (
        <div className="px-4 pb-4 border-t border-surface-700/50 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Nombre asesor */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Nombre asesor (para el email)</label>
              <input
                type="text"
                value={currentNombre}
                onChange={(e) => setEdit('nombre_asesor', e.target.value)}
                className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-full"
                placeholder="Nombre que aparecerá en el correo"
              />
            </div>
            {/* Email */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Email asesor</label>
              <select
                value={currentEmail}
                onChange={(e) => {
                  const sel = contactos.find((c) => c.email === e.target.value)
                  setEdit('email', e.target.value)
                  if (sel && !edit.nombre_asesor) setEdit('nombre_asesor', sel.nombre)
                }}
                className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-full cursor-pointer"
              >
                <option value="">— Seleccionar —</option>
                {emailOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* Director CC */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                Director CC{' '}
                {v.director_sugerido && !currentDir && (
                  <span className="text-brand-400">(sugerido: {v.director_sugerido})</span>
                )}
              </label>
              <select
                value={currentDir}
                onChange={(e) => setEdit('director_email', e.target.value)}
                className="bg-surface-700 border border-surface-600 text-slate-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 w-full cursor-pointer"
              >
                <option value="">— Seleccionar —</option>
                {dirOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={onSave}
              disabled={!currentEmail || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle size={11} />}
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-200 transition-colors">
              Cancelar
            </button>
            {isDirty && <span className="text-xs text-amber-400">Cambios sin guardar</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Log de envío ──────────────────────────────────────────────────────────────

function EnvioLog({ log }) {
  if (log.status === 'error') return (
    <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-xs text-red-300">
      <strong>Error:</strong> {log.mensaje}
    </div>
  )
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">Resultado del envío</h3>
      <div className="flex gap-4 flex-wrap mb-4">
        <Stat label="Enviados"    value={log.enviados}    color="text-emerald-400" />
        <Stat label="Sin alertas" value={log.sin_alertas} color="text-slate-400"   />
        <Stat label="Errores"     value={log.errores}     color="text-red-400"     />
      </div>
      {log.detalle?.length > 0 && (
        <div className="flex flex-col gap-1">
          {log.detalle.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {d.status === 'enviado'
                ? <CheckCircle size={11} className="text-emerald-400" />
                : <Info size={11} className="text-slate-500" />}
              <span className="text-slate-300">{d.nombre}</span>
              {d.status === 'enviado' && (
                <span className="text-slate-500">
                  — {d.clientes_caida} en caída · {d.clientes_inactivos} inactivos
                </span>
              )}
              {d.status === 'sin_alertas' && (
                <span className="text-slate-600">sin alertas</span>
              )}
            </div>
          ))}
        </div>
      )}
      {log.detalle_errores?.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {log.detalle_errores.map((e, i) => (
            <div key={i} className="text-xs text-red-400">✗ {e.codigo}: {e.error}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value ?? 0}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({ cod, onClose }) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.notifPreview(cod)
      .then((h) => setHtml(h))
      .catch(() => setHtml('<p style="color:red">Error cargando preview</p>'))
      .finally(() => setLoading(false))
  }, [cod])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Mail size={14} className="text-brand-400" />
            <span className="text-sm font-semibold text-slate-100">Preview del correo — {cod}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading
            ? <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Cargando preview…</div>
            : <iframe srcDoc={html} title="email-preview" className="w-full h-full min-h-[500px] border-0" />
          }
        </div>
      </div>
    </div>
  )
}
