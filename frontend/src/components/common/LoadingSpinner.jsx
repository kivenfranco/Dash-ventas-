export function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`${sizes[size]} rounded-full border-2 border-surface-600 border-t-brand-500 animate-spin`} />
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
      <LoadingSpinner size="lg" />
      <p className="text-slate-500 text-sm">Cargando datos…</p>
    </div>
  )
}

export function ErrorDisplay({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
      <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
        <span className="text-red-400 text-2xl">⚠</span>
      </div>
      <div className="text-center">
        <p className="text-slate-300 font-medium">Error al cargar datos</p>
        <p className="text-slate-500 text-sm mt-1 max-w-sm">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">
          Reintentar
        </button>
      )}
    </div>
  )
}
