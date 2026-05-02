import { BookOpen, Database, BarChart2, Target, BellRing, Users, Lightbulb, Filter } from 'lucide-react'

const SECTIONS = [
  {
    id: 'fuentes',
    icon: Database,
    title: 'Fuentes de Datos',
    items: [
      {
        term: 'FACT_VENTAS',
        schema: 'GOLD.VENTAS',
        def: 'Tabla de hechos central. Contiene una fila por línea de factura. Campos clave: ANO_FISCAL, PERIODO_FISCAL, FECHA_FACTURA, NUMERO_FACTURA, NUMERO_CLIENTE, ID_CLIENTE, CODIGO_VENDEDOR, CODIGO_PRODUCTO, VENTAS_NETAS (COP), VENTAS_DOLARES, CANTIDAD, UNIDAD_MEDIDA_VENTA, DOMICILIO_KEY.',
      },
      {
        term: 'DIM_CLIENTE',
        schema: 'GOLD.MAESTROS',
        def: 'Maestro de clientes. Campos: NUMERO_CLIENTE, NOMBRE, TIPO_CLIENTE. No contiene MERCADO — el mercado del cliente se obtiene vía DIM_VENDEDOR_PP.',
      },
      {
        term: 'DIM_VENDEDOR',
        schema: 'GOLD.MAESTROS',
        def: 'Maestro de vendedores. Campos: CODIGO_VENDEDOR, NOMBRE.',
      },
      {
        term: 'DIM_DOMICILIO',
        schema: 'GOLD.MAESTROS',
        def: 'Geografía de entrega. Campo DESCRIPCION_REGION identifica la zona (p.ej. "ZONA EXPORTACIONES"). Se usa para filtrar exportaciones.',
      },
      {
        term: 'DIM_GRUPO_PRODUCTO',
        schema: 'GOLD.MAESTROS',
        def: 'Agrupación de productos. Campos: CODIGO_PRODUCTO, LINEA_NEGOCIO, PLANTA. Enlaza con DIM_GRUPO_COMERCIAL vía CODIGO_GRUPO_COMERCIAL.',
      },
      {
        term: 'DIM_GRUPO_COMERCIAL',
        schema: 'GOLD.MAESTROS',
        def: 'Grupos comerciales. Campos: CODIGO_GRUPO, NOMBRE_GRUPO, TIPO_FABRICACION.',
      },
      {
        term: 'DIM_TIEMPO',
        schema: 'GOLD.MAESTROS',
        def: 'Calendario de días hábiles. Campos: FECHA, ANO, MES_NUM, DIA_HABIL. Se usa para calcular "Debe Ser" en función de días laborados vs días del mes.',
      },
      {
        term: 'DIM_ESTADO_CLIENTE',
        schema: 'GOLD.VENTAS',
        def: 'Estado actual de cada cliente. Campos: ID_CLIENTE, ESTADO_CLIENTE (ACTIVO, NUEVO, PERDIDO, RIESGO, SEGUIMIENTO). Se usa para clasificar ventas como Orgánicas (cliente existente) o Inorgánicas (cliente NUEVO).',
      },
      {
        term: 'DIM_VENDEDOR_PP',
        schema: 'GOLD.VENTAS',
        def: 'Tabla de mapeo vendedor → atributos de segmentación. Campos: VENDEDOR, REGION, PLANTA, MERCADO, GRUPO_COMERCIAL, UNIDAD_MEDIDA, ID_CLIENTE, TIPO_VENTA. Necesaria para obtener MERCADO de las ventas ya que DIM_CLIENTE no tiene ese campo.',
      },
      {
        term: 'PP_REGION_PLANTA_GRUPO',
        schema: 'GOLD.VENTAS',
        def: 'Presupuesto granular por dimensión geográfica/productiva. Campos: ANO, MES_NUM, REGION, PLANTA, GRUPO_COMERCIAL, LINEA_NEGOCIO, PRESUPUESTO_MES. Solo existe para 2026.',
      },
      {
        term: 'PP_VENDEDOR_VALOR',
        schema: 'GOLD.VENTAS',
        def: 'Presupuesto en valor (COP) por vendedor con atributos de segmentación. Campos: ANO, MES_NUM, VENDEDOR, REGION, MERCADO, GRUPO_COMERCIAL, PLANTA, UNIDAD_MEDIDA, TIPO_VENTA, PP_VALOR_MES. Solo existe para 2026.',
      },
      {
        term: 'PP_VENDEDOR_CANTIDAD',
        schema: 'GOLD.VENTAS',
        def: 'Presupuesto en unidades por vendedor. Campos similares a PP_VENDEDOR_VALOR pero con PP_CANTIDAD_MES. Solo existe para 2026.',
      },
    ],
  },
  {
    id: 'kpis',
    icon: BarChart2,
    title: 'KPIs — Cómo se Calculan',
    items: [
      {
        term: 'Ventas Netas',
        def: 'SUM(FACT_VENTAS.VENTAS_NETAS) filtrado por año fiscal y período. Siempre en COP.',
      },
      {
        term: 'Variación YoY %',
        def: '(Ventas_Actual / Ventas_AñoAnterior - 1) × 100. Cuando se ve el año completo sin mes seleccionado, se acota el año anterior al mismo mes YTD para evitar comparar períodos desiguales.',
      },
      {
        term: 'Variación MoM %',
        def: '(Ventas_Mes / Ventas_MesAnterior - 1) × 100. Solo disponible cuando hay mes seleccionado.',
      },
      {
        term: 'PP Región/Planta/Grupo',
        def: 'SUM(PP_REGION_PLANTA_GRUPO.PRESUPUESTO_MES) filtrado por año y mes, respetando los filtros de región, planta y grupo comercial activos.',
      },
      {
        term: 'Debe Ser',
        def: 'PP_Mes × (Días_Hábiles_Transcurridos / Días_Hábiles_Mes). Indica cuánto se debería haber vendido a la fecha de hoy para estar en ritmo de cumplir el presupuesto.',
      },
      {
        term: 'Proyección',
        def: 'Ventas_Actual × (Días_Hábiles_Mes / Días_Hábiles_Transcurridos). Estimado de cierre del mes al ritmo actual.',
      },
      {
        term: 'Cumplimiento PP %',
        def: 'Ventas_Actual / PP_Mes × 100.',
      },
      {
        term: 'Cumplimiento Debe Ser %',
        def: 'Ventas_Actual / Debe_Ser × 100. >100% significa que se va adelantado al ritmo requerido.',
      },
      {
        term: 'Orgánica / Inorgánica',
        def: 'Clasifica cada venta según DIM_ESTADO_CLIENTE.ESTADO_CLIENTE. Clientes con ESTADO_CLIENTE = "NUEVO" se clasifican como Inorgánicas; todos los demás como Orgánicas.',
      },
    ],
  },
  {
    id: 'presupuesto',
    icon: Target,
    title: 'Presupuesto — Tablas y Dimensiones',
    items: [
      {
        term: 'Dimensiones granulares (con PP desglosado)',
        def: 'Región, Planta, Grupo Comercial, Línea de Negocio → PP se obtiene de PP_REGION_PLANTA_GRUPO agrupando por la dimensión correspondiente (REGION, PLANTA, GRUPO_COMERCIAL, LINEA_NEGOCIO). Columna de PP: PRESUPUESTO_MES.',
      },
      {
        term: 'Dimensiones con PP por vendedor',
        def: 'Mercado, Unidad de Medida → PP se obtiene de PP_VENDEDOR_VALOR agrupando por MERCADO o UNIDAD_MEDIDA. Columna de PP: PP_VALOR_MES.',
      },
      {
        term: 'Dimensiones sin PP desglosado',
        def: 'Tipo Fabricación, Tipo Cliente → Solo se muestra el PP total (suma de PP_VENDEDOR_VALOR) sin desglose por dimensión.',
      },
      {
        term: 'Ventas en dimensión Mercado',
        def: 'Se obtiene uniendo FACT_VENTAS con DIM_VENDEDOR_PP (FACT_VENTAS.CODIGO_VENDEDOR = DIM_VENDEDOR_PP.VENDEDOR) y usando DIM_VENDEDOR_PP.MERCADO como dimensión de agrupación.',
      },
      {
        term: 'Filtros y PP',
        def: 'Cuando se filtra por región, el PP granular también se filtra por REGION en PP_REGION_PLANTA_GRUPO. Cuando se filtra por región en PP_VENDEDOR_VALOR (para mercado/unidad de medida), se filtra la columna REGION de esa tabla.',
      },
      {
        term: 'Disponibilidad del PP',
        def: 'Solo existe presupuesto para el año 2026. Para años anteriores la página muestra ventas + variación YoY sin columnas de PP.',
      },
    ],
  },
  {
    id: 'alertas',
    icon: BellRing,
    title: 'Alertas — Cómo se Detectan',
    items: [
      {
        term: 'Alerta Caída YoY',
        def: 'Clientes que en el período actual tienen ventas con variación YoY ≤ umbral seleccionado (default −20%). Se calcula: (Ventas_Actual − Ventas_AñoAnt) / ABS(Ventas_AñoAnt) × 100. Solo se incluyen clientes que tenían ventas en el año anterior.',
      },
      {
        term: 'Severidad',
        def: 'Crítica: variación ≤ −50%. Alta: −50% < variación ≤ −30%. Media: > −30%.',
      },
      {
        term: 'Clientes Inactivos',
        def: 'Clientes que históricamente compraron pero no han facturado en los últimos N meses (seleccionable 1–12 meses). Se calcula con DATEDIFF entre MAX(FECHA_FACTURA) y la fecha actual. Solo se incluyen clientes con ventas históricas > 0.',
      },
      {
        term: 'Clasificación de Inactivos',
        def: 'Perdido: sin compra > 180 días. Riesgo alto: 91–180 días. En riesgo: hasta el umbral seleccionado.',
      },
      {
        term: 'Segmentación RFM',
        def: 'Basada en los últimos 2 años de ventas. R = Recencia (días desde última compra, menor = mejor). F = Frecuencia (número distinto de facturas). M = Monto (ventas netas totales). Cada dimensión se escala en quintiles 1–5 con pandas.qcut.',
      },
      {
        term: 'Segmentos RFM',
        def: 'Campeón (R≥4, F≥4, M≥4) · Leal (R≥3, F≥3, M≥3) · Nuevo (R≥4, F≤2) · En Riesgo (R≤2, F≥4) · No Perder (R=1, F≥4) · Perdido (R≤2, F≤2) · Potencial (R≥3, M≥4) · Regular (resto).',
      },
    ],
  },
  {
    id: 'filtros',
    icon: Filter,
    title: 'Filtros Globales',
    items: [
      {
        term: 'Año / Mes',
        def: 'Filtra ANO_FISCAL y PERIODO_FISCAL en FACT_VENTAS. Sin mes seleccionado, se acumula YTD para el año en curso.',
      },
      {
        term: 'Región',
        def: 'Filtra DIM_DOMICILIO.DESCRIPCION_REGION. Se une FACT_VENTAS → DIM_DOMICILIO vía DOMICILIO_KEY.',
      },
      {
        term: 'Vendedor',
        def: 'Filtra FACT_VENTAS.CODIGO_VENDEDOR directamente.',
      },
      {
        term: 'Grupo Comercial',
        def: 'Filtra DIM_GRUPO_COMERCIAL.NOMBRE_GRUPO. Se une FACT_VENTAS → DIM_GRUPO_PRODUCTO → DIM_GRUPO_COMERCIAL.',
      },
      {
        term: 'Planta',
        def: 'Filtra DIM_GRUPO_PRODUCTO.PLANTA. Se une FACT_VENTAS → DIM_GRUPO_PRODUCTO vía CODIGO_PRODUCTO.',
      },
      {
        term: 'Mercado',
        def: 'Filtra en PP_VENDEDOR_VALOR.MERCADO cuando es aplicable. El mercado en ventas se obtiene vía DIM_VENDEDOR_PP.',
      },
      {
        term: 'Excluir Exportaciones',
        def: 'Agrega condición: UPPER(DIM_DOMICILIO.DESCRIPCION_REGION) NOT LIKE \'%EXPORTACION%\'.',
      },
      {
        term: 'Excluir PVTA',
        def: 'Agrega condición: UPPER(FACT_VENTAS.CODIGO_VENDEDOR) NOT LIKE \'PVTA%\'. Elimina códigos de vendedor que corresponden a puntos de venta directos, no a vendedores de campo.',
      },
    ],
  },
  {
    id: 'hallazgos',
    icon: Lightbulb,
    title: 'Hallazgos — Lógica de Insights',
    items: [
      {
        term: 'YoY Global',
        def: 'Compara ventas totales del período actual vs mismo período del año anterior. Se muestra como positivo (crecimiento) o alerta (caída).',
      },
      {
        term: 'Mejor / Peor Región',
        def: 'Agrupa ventas por DIM_DOMICILIO.DESCRIPCION_REGION y calcula YoY por región. La de mayor crecimiento es destacada; la de mayor caída (>10%) genera alerta.',
      },
      {
        term: 'Cumplimiento Vendedores',
        def: 'Cruza ventas por vendedor (FACT_VENTAS) con su PP de valor (PP_VENDEDOR_VALOR.PP_VALOR_MES). El mejor y peor cumplimiento generan insight. Solo incluye vendedores con PP asignado.',
      },
      {
        term: 'Stock vs No Stock',
        def: 'Clasifica ventas según DIM_PARTE.ES_STOCK. Calcula qué porcentaje de ventas corresponde a productos de inventario.',
      },
      {
        term: 'Alertas de Clientes',
        def: 'Cuenta cuántos clientes tienen variación YoY ≤ −20% en el período. ≥20 clientes = crítico; ≥1 = alerta.',
      },
    ],
  },
  {
    id: 'conceptos',
    icon: BookOpen,
    title: 'Conceptos Clave',
    items: [
      {
        term: 'ANO_FISCAL / PERIODO_FISCAL',
        def: 'El año y mes fiscal de ALICO. PERIODO_FISCAL es el mes (1–12). Pueden diferir del año calendario.',
      },
      {
        term: 'Ventas Netas',
        def: 'Ventas brutas menos descuentos, devoluciones y notas crédito. Es la métrica principal de ingresos. Expresada en COP.',
      },
      {
        term: 'NUMERO_CLIENTE vs ID_CLIENTE',
        def: 'NUMERO_CLIENTE es el código externo del cliente (en DIM_CLIENTE). ID_CLIENTE es la llave interna usada en FACT_VENTAS y DIM_ESTADO_CLIENTE.',
      },
      {
        term: 'Presupuesto (PP)',
        def: 'Meta de ventas por período. PP_VALOR_MES = meta en COP. PP_CANTIDAD_MES = meta en unidades. Solo disponible para 2026.',
      },
      {
        term: 'Debe Ser',
        def: 'Ritmo de PP proporcional a los días hábiles transcurridos. Si hoy es el día 10 de 22 hábiles y el PP mensual es $100M, el Debe Ser es $45.5M.',
      },
      {
        term: 'Cump PP %',
        def: 'Cumplimiento del presupuesto total del mes. >100% = meta superada.',
      },
      {
        term: 'Cump Debe Ser %',
        def: 'Cumplimiento del ritmo requerido a la fecha. <100% = se va rezagado para cumplir la meta mensual.',
      },
      {
        term: 'Orgánica vs Inorgánica',
        def: 'Orgánica = ventas a clientes ya existentes (ESTADO_CLIENTE ≠ NUEVO). Inorgánica = ventas a clientes nuevos. Mide el crecimiento real vs crecimiento por incorporación de nuevos clientes.',
      },
      {
        term: 'Score RFM 1–5',
        def: '5 es el mejor. Recencia: menor tiempo desde última compra = 5. Frecuencia y Monto: mayor valor = 5. El score total (3–15) resume el valor global del cliente.',
      },
      {
        term: 'Excluir PVTA',
        def: 'Los códigos de vendedor que empiezan con "PVTA" corresponden a puntos de venta propios (canal retail directo), no a vendedores de campo. Excluirlos muestra solo el canal tradicional.',
      },
    ],
  },
]

function Section({ section }) {
  const Icon = section.icon
  return (
    <div className="card" id={section.id}>
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-surface-700">
        <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
          <Icon size={15} className="text-brand-400" />
        </div>
        <h2 className="text-base font-bold text-slate-100">{section.title}</h2>
      </div>
      <dl className="space-y-4">
        {section.items.map((item, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-1 md:gap-4">
            <dt className="md:col-span-1">
              <span className="text-xs font-semibold text-brand-300 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded">{item.term}</span>
              {item.schema && (
                <span className="block text-[10px] text-slate-500 mt-1 font-mono">{item.schema}</span>
              )}
            </dt>
            <dd className="md:col-span-3 text-sm text-slate-300 leading-relaxed">{item.def}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function DiccionarioView() {
  return (
    <div className="flex flex-col gap-5 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Diccionario de Datos</h1>
        <p className="text-slate-500 text-xs mt-0.5">
          Fuentes, tablas, métricas y conceptos del modelo BI Ventas · ALICO SAS BIC
        </p>
      </div>

      {/* Quick nav */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-slate-400 hover:text-slate-100 hover:border-brand-500/50 transition-all"
            >
              <Icon size={12} />
              {s.title.split(' — ')[0]}
            </a>
          )
        })}
      </div>

      {SECTIONS.map((s) => <Section key={s.id} section={s} />)}
    </div>
  )
}
