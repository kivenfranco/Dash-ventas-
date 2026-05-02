import axios from 'axios'

const http = axios.create({ baseURL: '/api', timeout: 60_000 })

const toParams = (filters) => {
  const p = {}
  if (filters.ano)             p.ano              = filters.ano
  if (filters.mes)             p.mes              = filters.mes
  if (filters.region)          p.region           = filters.region
  if (filters.vendedor)        p.vendedor         = filters.vendedor
  if (filters.grupo_comercial) p.grupo_comercial  = filters.grupo_comercial
  if (filters.planta)          p.planta           = filters.planta
  if (filters.mercado)         p.mercado          = filters.mercado
  if (filters.cliente)         p.cliente          = filters.cliente
  if (filters.mes_fin && filters.mes_fin !== filters.mes) p.mes_fin = filters.mes_fin
  if (filters.excl_exportacion) p.excl_exportacion = true
  if (filters.excl_pvta)        p.excl_pvta        = true
  return p
}

export const api = {
  health:  () => http.get('/health').then((r) => r.data),
  refresh: () => http.post('/refresh').then((r) => r.data),

  kpis:       (filters)             => http.get('/kpis',      { params: toParams(filters) }).then((r) => r.data),
  trends:     (filters)             => http.get('/trends',    { params: toParams(filters) }).then((r) => r.data),
  segments:   (filters, groupBy, n) => http.get('/segments',  { params: { ...toParams(filters), group_by: groupBy, top_n: n || 15 } }).then((r) => r.data),
  vendedores: (filters)             => http.get('/vendedores', { params: toParams(filters) }).then((r) => r.data),
  alertas:           (filters, umbral, exclPvta, esStock)       => http.get('/alertas/clientes',  { params: { ...toParams(filters), umbral_yoy: umbral ?? -20, top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  inactivos:         (filters, meses, exclPvta, esStock)        => http.get('/alertas/inactivos',  { params: { ...toParams(filters), meses_inactivo: meses ?? 3, top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  rfm:               (filters, exclPvta, esStock)               => http.get('/alertas/rfm',        { params: { ...toParams(filters), top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  tendenciaClientes: (filters, exclPvta, topN, mesesT, esStock) => http.get('/alertas/tendencia',  { params: { ...toParams(filters), top_n: topN || 500, meses_tendencia: mesesT || 6, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  atributos:  (filters, groupBy, n) => http.get('/atributos', { params: { ...toParams(filters), group_by: groupBy, top_n: n || 20 } }).then((r) => r.data),
  hallazgos:     (filters)             => http.get('/hallazgos',     { params: toParams(filters) }).then((r) => r.data),
  oportunidades: (filters)             => http.get('/oportunidades', { params: toParams(filters) }).then((r) => r.data),
  agente:          (pregunta, historial, ano, mes) => http.post('/agente', { pregunta, historial: historial || [], ano, mes }).then((r) => r.data),
  ventasDiarias:     (filters, limit) => http.get('/ventas-diarias', { params: { ...toParams(filters), limit: limit || 90 } }).then((r) => r.data),
  ventasDiariasPvta: (filters, limit) => http.get('/ventas-diarias/pvta', { params: { ano: filters.ano, ...(filters.mes ? { mes: filters.mes } : {}), ...(filters.mes_fin && filters.mes_fin !== filters.mes ? { mes_fin: filters.mes_fin } : {}), limit: limit || 120 } }).then((r) => r.data),
  presupuesto:     (filters, groupBy, topN) => http.get('/presupuesto', { params: { ...toParams(filters), group_by: groupBy, top_n: topN || 30 } }).then((r) => r.data),
  clientesEstados:   (filters)             => http.get('/clientes/estados',   { params: toParams(filters) }).then((r) => r.data),
  clientesLista:     (filters, estado, topN) => http.get('/clientes/lista',   { params: { ...toParams(filters), ...(estado ? { estado } : {}), top_n: topN || 500 } }).then((r) => r.data),
  clientesBreakdown: (filters)             => http.get('/clientes/breakdown', { params: toParams(filters) }).then((r) => r.data),

  // Notificaciones
  notifConfig:       ()               => http.get('/notificaciones/config').then((r) => r.data),
  notifContactos:    ()               => http.get('/notificaciones/contactos').then((r) => r.data),
  notifVendedores:   (ano)            => http.get('/notificaciones/vendedores', { params: ano ? { ano } : {} }).then((r) => r.data),
  notifSaveMapeo:    (items)          => http.post('/notificaciones/mapeo', items).then((r) => r.data),
  notifDeleteMapeo:  (cod)            => http.delete(`/notificaciones/mapeo/${cod}`).then((r) => r.data),
  notifEnviar:       (body)           => http.post('/notificaciones/enviar', body).then((r) => r.data),
  notifEnviarUno:    (cod, body)      => http.post(`/notificaciones/enviar/${cod}`, body).then((r) => r.data),
  notifPreview:      (cod, ano, mes)  => http.get(`/notificaciones/preview/${cod}`, { params: { ...(ano ? { ano } : {}), ...(mes ? { mes } : {}) } }).then((r) => r.data),

  filterAnos:             () => http.get('/filters/anos').then((r) => r.data.anos),
  filterRegiones:         () => http.get('/filters/regiones').then((r) => r.data.regiones),
  filterVendedores:       () => http.get('/filters/vendedores').then((r) => r.data.vendedores),
  filterGruposComerciales:() => http.get('/filters/grupos-comerciales').then((r) => r.data.grupos_comerciales),
  filterPlantas:          () => http.get('/filters/plantas').then((r) => r.data.plantas),
  filterLineas:           () => http.get('/filters/lineas').then((r) => r.data.lineas),
  filterMercados:         () => http.get('/filters/mercados').then((r) => r.data.mercados),
}
