import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { Shield, UserPlus, Pencil, Trash2, Check, X, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'

const ROL_BADGE = {
  admin:    'bg-brand-900/50 text-brand-300 border border-brand-500/40',
  vendedor: 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/40',
}

const EMPTY_FORM = { nombre: '', email: '', password: '', rol: 'vendedor', codigo_vendedor: '' }

function UserForm({ initial = EMPTY_FORM, onSave, onCancel, editMode }) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!editMode && !form.password) { setErr('La contraseña es obligatoria'); return }
    setSaving(true); setErr('')
    try {
      await onSave(form)
    } catch (ex) {
      setErr(ex?.response?.data?.detail || ex.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-surface-800 rounded-2xl border border-surface-600">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Nombre completo</label>
        <input required value={form.nombre} onChange={e => set('nombre', e.target.value)}
          className="input" placeholder="Ana García" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Correo electrónico</label>
        <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
          className="input" placeholder="ana@alico-sa.com" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">{editMode ? 'Nueva contraseña (vacío = sin cambios)' : 'Contraseña'}</label>
        <div className="relative">
          <input value={form.password} onChange={e => set('password', e.target.value)}
            type={showPwd ? 'text' : 'password'}
            className="input pr-8 w-full" placeholder={editMode ? '(sin cambios)' : '···'} />
          <button type="button" onClick={() => setShowPwd(p => !p)}
            className="absolute right-2 top-1.5 text-slate-500 hover:text-slate-300">
            {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400">Rol</label>
        <select value={form.rol} onChange={e => set('rol', e.target.value)} className="select">
          <option value="admin">admin — acceso total</option>
          <option value="vendedor">vendedor — solo sus datos</option>
        </select>
      </div>
      {form.rol === 'vendedor' && (
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs text-slate-400">Código vendedor (CODIGO_VENDEDOR en Snowflake)</label>
          <input value={form.codigo_vendedor} onChange={e => set('codigo_vendedor', e.target.value)}
            className="input max-w-xs" placeholder="VEN001" />
        </div>
      )}
      {err && <p className="sm:col-span-2 text-red-400 text-xs">{err}</p>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-4 py-2 rounded-lg hover:bg-surface-700 transition-colors">
          <X size={13} /> Cancelar
        </button>
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors">
          {saving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {editMode ? 'Guardar cambios' : 'Crear usuario'}
        </button>
      </div>
    </form>
  )
}

export function AdminView() {
  const { user: me } = useAuth()

  if (me && me.rol !== 'admin') return <Navigate to="/" replace />

  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [creating, setCreating]   = useState(false)
  const [editId, setEditId]       = useState(null)
  const [deleteId, setDeleteId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.authUsers()
      setUsers(d.users || [])
    } catch (_) {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (form) => {
    await api.authCreateUser({
      nombre: form.nombre, email: form.email, password: form.password,
      rol: form.rol, codigo_vendedor: form.rol === 'vendedor' ? form.codigo_vendedor : null,
    })
    setCreating(false)
    load()
  }

  const handleUpdate = async (id, form) => {
    const body = { nombre: form.nombre, rol: form.rol }
    if (form.password) body.password = form.password
    if (form.rol === 'vendedor') body.codigo_vendedor = form.codigo_vendedor
    await api.authUpdateUser(id, body)
    setEditId(null)
    load()
  }

  const handleDelete = async (id) => {
    await api.authDeleteUser(id)
    setDeleteId(null)
    load()
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
            <Shield size={16} className="text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">Administración de Usuarios</h1>
            <p className="text-xs text-slate-500">Gestión de cuentas y roles — solo administradores</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 px-3 py-2 rounded-lg hover:bg-surface-700 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
          {!creating && (
            <button onClick={() => { setCreating(true); setEditId(null) }}
              className="flex items-center gap-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors">
              <UserPlus size={13} /> Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {/* Roles info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-4 bg-surface-800 rounded-xl border border-surface-700">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROL_BADGE.admin}`}>admin</span>
          </div>
          <p className="text-xs text-slate-400">Acceso completo: ve todos los clientes, vendedores y regiones. Puede crear, editar y eliminar usuarios.</p>
        </div>
        <div className="p-4 bg-surface-800 rounded-xl border border-surface-700">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROL_BADGE.vendedor}`}>vendedor</span>
          </div>
          <p className="text-xs text-slate-400">Acceso filtrado: el backend filtra automáticamente para mostrar solo las ventas de su CODIGO_VENDEDOR asignado.</p>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <UserForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
          editMode={false}
        />
      )}

      {/* Users table */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-300">{users.length} usuarios registrados</p>
        </div>
        {loading && (
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm">
            <RefreshCw size={14} className="animate-spin mr-2" /> Cargando…
          </div>
        )}
        {!loading && users.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">No hay usuarios registrados.</p>
        )}
        <div className="divide-y divide-surface-700">
          {users.map(u => (
            <div key={u.id}>
              {editId === u.id ? (
                <div className="p-2">
                  <UserForm
                    initial={{
                      nombre: u.nombre, email: u.email, password: '',
                      rol: u.rol, codigo_vendedor: u.codigo_vendedor || '',
                    }}
                    onSave={(form) => handleUpdate(u.id, form)}
                    onCancel={() => setEditId(null)}
                    editMode
                  />
                </div>
              ) : (
                <div className="flex items-center gap-4 px-4 py-3 hover:bg-surface-800/50 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-slate-300">{u.nombre?.[0]?.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{u.nombre}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                    {u.codigo_vendedor && (
                      <p className="text-xs text-slate-600 font-mono">Vendedor: {u.codigo_vendedor}</p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROL_BADGE[u.rol] || 'bg-surface-700 text-slate-400'}`}>
                    {u.rol}
                  </span>
                  {/* Delete confirm inline */}
                  {deleteId === u.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-400">¿Eliminar?</span>
                      <button onClick={() => handleDelete(u.id)}
                        className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                        Sí, eliminar
                      </button>
                      <button onClick={() => setDeleteId(null)}
                        className="text-xs text-slate-400 hover:text-slate-100 px-3 py-1.5 rounded-lg hover:bg-surface-700 transition-colors">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => { setEditId(u.id); setCreating(false) }}
                        className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-surface-700 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={13} />
                      </button>
                      {u.id !== me?.id && (
                        <button
                          onClick={() => setDeleteId(u.id)}
                          className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Security tip */}
      <div className="p-4 bg-amber-900/10 border border-amber-700/30 rounded-xl text-xs text-amber-300/80 space-y-1">
        <p className="font-semibold text-amber-300">Recomendaciones de seguridad</p>
        <p>· Cambia la contraseña del admin por defecto inmediatamente si aún es "Alico2024!"</p>
        <p>· Cada vendedor debe tener su propio usuario con CODIGO_VENDEDOR correcto</p>
        <p>· El backend filtra los datos automáticamente según el rol — no se puede ver información de otros vendedores</p>
        <p>· Define AUTH_SECRET_KEY en el archivo .env del servidor de producción con una clave aleatoria fuerte</p>
      </div>
    </div>
  )
}
