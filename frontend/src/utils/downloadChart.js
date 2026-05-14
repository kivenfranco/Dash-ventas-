/**
 * Downloads a chart container element as a PNG file.
 * Usage: pass a React ref of the chart's wrapper div.
 */
export async function downloadChartAsPng(containerRef, filename = 'grafico.png') {
  const node = containerRef?.current
  if (!node) return

  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(node, {
      backgroundColor: '#0d1117',
      scale: 2,
      useCORS: true,
      logging: false,
    })
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } catch {
    // Fallback: use native SVG export if html2canvas not available
    const svg = node.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.replace('.png', '.svg')
    a.click()
    URL.revokeObjectURL(url)
  }
}
