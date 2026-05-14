import { useRef } from 'react'
import { Download } from 'lucide-react'
import { downloadChartAsPng } from '../../utils/downloadChart'

/**
 * Wraps a chart and provides a PNG download button that appears on hover.
 *
 * Usage:
 *   <ChartDownloadButton filename="ventas-region.png">
 *     <ResponsiveContainer>...</ResponsiveContainer>
 *   </ChartDownloadButton>
 */
export function ChartDownloadButton({ children, filename = 'grafico.png', className = '' }) {
  const ref = useRef(null)

  return (
    <div ref={ref} className={`relative group ${className}`}>
      {children}
      <button
        onClick={() => downloadChartAsPng(ref, filename)}
        title="Descargar PNG"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10
                   flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium
                   bg-surface-700/90 text-slate-400 hover:text-slate-100 hover:bg-surface-600
                   border border-surface-600 backdrop-blur-sm"
      >
        <Download size={11} />
        PNG
      </button>
    </div>
  )
}
