import * as XLSX from 'xlsx'

/**
 * Descarga un array de objetos como archivo .xlsx.
 * @param {object[]} rows  - datos a exportar
 * @param {Array<{key:string, header:string}>} columns - columnas a incluir y sus encabezados
 * @param {string} filename - nombre del archivo (sin .xlsx)
 */
export function exportToExcel(rows, columns, filename) {
  const data = rows.map((row) => {
    const obj = {}
    columns.forEach(({ key, header }) => {
      const v = row[key]
      obj[header] = v == null ? '' : v
    })
    return obj
  })

  const ws = XLSX.utils.json_to_sheet(data)

  // Auto-width columns
  const colWidths = columns.map(({ header }) => ({ wch: Math.max(header.length + 2, 14) }))
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Datos')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
