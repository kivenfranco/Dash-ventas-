import axios from 'axios'

const http = axios.create({ baseURL: '/api', timeout: 60_000 })

// Attach JWT on every request
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('bi_token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// On 401, clear token and redirect to login
http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('bi_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

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
  // ── Auth ──────────────────────────────────────────────────────────────────
  login:              (email, password) => http.post('/auth/login', { email, password }).then((r) => r.data),
  me:                 ()               => http.get('/auth/me').then((r) => r.data),
  cambiarPassword:    (body)           => http.post('/auth/cambiar-password', body).then((r) => r.data),
  authUsers:          ()               => http.get('/auth/users').then((r) => r.data),
  authCreateUser:     (body)           => http.post('/auth/users', body).then((r) => r.data),
  authUpdateUser:     (id, body)       => http.put(`/auth/users/${id}`, body).then((r) => r.data),
  authDeleteUser:     (id)             => http.delete(`/auth/users/${id}`).then((r) => r.data),

  // ── System ────────────────────────────────────────────────────────────────
  health:  () => http.get('/health').then((r) => r.data),
  refresh: () => http.post('/refresh').then((r) => r.data),

  // ── Core analytics ────────────────────────────────────────────────────────
  kpis:       (filters)             => http.get('/kpis',      { params: toParams(filters) }).then((r) => r.data),
  trends:     (filters)             => http.get('/trends',    { params: toParams(filters) }).then((r) => r.data),
  segments:   (filters, groupBy, n) => http.get('/segments',  { params: { ...toParams(filters), group_by: groupBy, top_n: n || 15 } }).then((r) => r.data),
  vendedores: (filters)             => http.get('/vendedores', { params: toParams(filters) }).then((r) => r.data),
  alertas:           (filters, umbral, exclPvta, esStock)       => http.get('/alertas/clientes',  { params: { ...toParams(filters), umbral_yoy: umbral ?? -20, top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  inactivos:         (filters, meses, exclPvta, esStock)        => http.get('/alertas/inactivos',  { params: { ...toParams(filters), meses_inactivo: meses ?? 3, top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
  rfmAlertas:        (filters, exclPvta, esStock)               => http.get('/alertas/rfm',        { params: { ...toParams(filters), top_n: 500, excl_pvta: exclPvta ?? true, ...(esStock ? { es_stock: esStock } : {}) } }).then((r) => r.data),
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

  pronosticos: (params) => http.get('/pronosticos', { params }).then((r) => r.data),

  comercializacion:          (filters) => http.get('/comercializacion', { params: { ano: filters.ano, ...(filters.mes ? { mes: filters.mes } : {}), ...(filters.mes_fin && filters.mes_fin !== filters.mes ? { mes_fin: filters.mes_fin } : {}) } }).then((r) => r.data),
  comercializacionPronostico: (meses)  => http.get('/comercializacion/pronostico', { params: { meses } }).then((r) => r.data),

  scoreSalud:    (ano, mes, topN, exclPvta, limit, offset) => http.get('/score-salud', { params: { ano, ...(mes ? { mes } : {}), top_n: topN || 100, excl_pvta: exclPvta ?? true, limit: limit || 50, offset: offset || 0 } }).then((r) => r.data),
  ranking:       (ano, mes, groupBy, topN, limit, offset)  => http.get('/ranking',     { params: { ano, ...(mes ? { mes } : {}), group_by: groupBy || 'descripcion', top_n: topN || 30, limit: limit || 30, offset: offset || 0 } }).then((r) => r.data),
  anomaliasAuto: (ano, mes, groupBy, umbral) => http.get('/anomalias-auto', { params: { ano, ...(mes ? { mes } : {}), group_by: groupBy || 'linea_negocio', umbral_z: umbral || 1.5 } }).then((r) => r.data),
  cohort:        (anoInicio, meses, exclPvta) => http.get('/cohort',    { params: { ano_inicio: anoInicio, meses: meses || 12, excl_pvta: exclPvta ?? true } }).then((r) => r.data),
  canasta:       (ano, mes, topN, minSoporte, exclPvta) => http.get('/canasta', { params: { ano, ...(mes ? { mes } : {}), top_n: topN || 30, min_soporte: minSoporte || 0.02, excl_pvta: exclPvta ?? true } }).then((r) => r.data),

  factoresCom:       ()             => http.get('/factores-com').then((r) => r.data),
  factoresComSave:   (body)         => http.post('/factores-com', body).then((r) => r.data),
  factoresComDelete: (codigo)       => http.delete(`/factores-com/${codigo}`).then((r) => r.data),

  // ── Nuevos endpoints analíticos ───────────────────────────────────────────
  rfm:          (ano, mes, exclPvta, topN) => http.get('/rfm',    { params: { ano, ...(mes ? { mes } : {}), excl_pvta: exclPvta ?? true, top_n: topN || 500 } }).then((r) => r.data),
  abcxyz:       (ano, exclPvta, topN)      => http.get('/abcxyz', { params: { ano, excl_pvta: exclPvta ?? true, top_n: topN || 500 } }).then((r) => r.data),
  clv:          (ano, exclPvta, topN)      => http.get('/clv',    { params: { ano, excl_pvta: exclPvta ?? true, top_n: topN || 200 } }).then((r) => r.data),
  crossSelling: (ano, mes, topN, minS)     => http.get('/cross-selling', { params: { ano, ...(mes ? { mes } : {}), top_n: topN || 50, min_soporte: minS || 0.02 } }).then((r) => r.data),
  crossSellingVendedor: (cod, ano, mes)    => http.get(`/cross-selling/${cod}`, { params: { ano, ...(mes ? { mes } : {}) } }).then((r) => r.data),
  churn:        (ano, exclPvta, topN)      => http.get('/churn',  { params: { ano, excl_pvta: exclPvta ?? true, top_n: topN || 200 } }).then((r) => r.data),
  search:       (q, tipo)                  => http.get('/search', { params: { q, tipo: tipo || 'all' } }).then((r) => r.data),

  // ── Notificaciones ────────────────────────────────────────────────────────
  notifConfig:       ()               => http.get('/notificaciones/config').then((r) => r.data),
  notifContactos:    ()               => http.get('/notificaciones/contactos').then((r) => r.data),
  notifVendedores:   (ano)            => http.get('/notificaciones/vendedores', { params: ano ? { ano } : {} }).then((r) => r.data),
  notifSaveMapeo:    (items)          => http.post('/notificaciones/mapeo', items).then((r) => r.data),
  notifDeleteMapeo:  (cod)            => http.delete(`/notificaciones/mapeo/${cod}`).then((r) => r.data),
  notifEnviar:       (body)           => http.post('/notificaciones/enviar', body).then((r) => r.data),
  notifEnviarUno:    (cod, body)      => http.post(`/notificaciones/enviar/${cod}`, body).then((r) => r.data),
  notifPreview:      (cod, ano, mes)  => http.get(`/notificaciones/preview/${cod}`, { params: { ...(ano ? { ano } : {}), ...(mes ? { mes } : {}) } }).then((r) => r.data),
  notifTeamsTest:    (body)           => http.post('/notificaciones/teams-test', body).then((r) => r.data),
  notifWhatsAppTest: (body)           => http.post('/notificaciones/whatsapp-test', body).then((r) => r.data),

  filterAnos:             () => http.get('/filters/anos').then((r) => r.data.anos),
  filterRegiones:         () => http.get('/filters/regiones').then((r) => r.data.regiones),
  filterVendedores:       () => http.get('/filters/vendedores').then((r) => r.data.vendedores),
  filterGruposComerciales:() => http.get('/filters/grupos-comerciales').then((r) => r.data.grupos_comerciales),
  filterPlantas:          () => http.get('/filters/plantas').then((r) => r.data.plantas),
  filterLineas:           () => http.get('/filters/lineas').then((r) => r.data.lineas),
  filterMercados:         () => http.get('/filters/mercados').then((r) => r.data.mercados),
}
