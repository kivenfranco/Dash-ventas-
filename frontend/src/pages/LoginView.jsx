import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logoAlico from '../assets/logo.png'

export function LoginView() {
  const { login }                   = useAuth()
  const navigate                    = useNavigate()
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Credenciales incorrectas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={logoAlico} alt="ALICO" className="h-14 w-14 rounded-xl object-contain" />
          <div className="text-center">
            <p className="text-xl font-bold text-slate-100">Centro de Inteligencia</p>
            <p className="text-sm text-slate-400">ALICO SAS BIC</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface-900 border border-surface-700 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-slate-100 font-semibold text-lg mb-5">Iniciar sesión</h1>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                placeholder="usuario@alico.com"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors mt-1"
            >
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          BI Ventas v3.0 · ALICO SAS BIC
        </p>
      </div>
    </div>
  )
}
