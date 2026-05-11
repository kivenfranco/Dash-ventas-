import {
  BookOpen, Database, BarChart2, Target, BellRing, Lightbulb, Filter,
  Activity, TrendingUp, Package, Users, PieChart, Trophy, Zap,
  ShoppingCart, GitBranch, UserX, Heart, Ruler, GitMerge, Award,
} from 'lucide-react'

const SECTIONS = [
  {
    id: 'fuentes',
    icon: Database,
    title: 'Fuentes de Datos',
    items: [
      {
        term: 'FACT_VENTAS',
        schema: 'GOLD.VENTAS',
        def: 'Tabla de hechos central. Una fila por línea de factura. Campos clave: ANO_FISCAL, PERIODO_FISCAL, FECHA_FACTURA, NUMERO_FACTURA, NUMERO_CLIENTE, ID_CLIENTE, CODIGO_VENDEDOR, CODIGO_PRODUCTO, VENTAS_NETAS (COP), VENTAS_DOLARES, CANTIDAD, UNIDAD_MEDIDA_VENTA, DOMICILIO_KEY.',
      },
      {
        term: 'DIM_CLIENTE',
        schema: 'GOLD.MAESTROS',
        def: 'Maestro de clientes. Campos: NUMERO_CLIENTE, NOMBRE, TIPO_CLIENTE. El mercado del cliente se obtiene vía DIM_VENDEDOR_PP.',
      },
      {
        term: 'DIM_VENDEDOR',
        schema: 'GOLD.MAESTROS',
        def: 'Maestro de vendedores. Campos: CODIGO_VENDEDOR, NOMBRE.',
      },
      {
        term: 'DIM_DOMICILIO',
        schema: 'GOLD.MAESTROS',
        def: 'Geografía de entrega. Campo DESCRIPCION_REGION identifica la zona (p.ej. "ZONA EXPORTACIONES").',
      },
      {
        term: 'DIM_GRUPO_PRODUCTO',
        schema: 'GOLD.MAESTROS',
        def: 'Agrupación de productos. Campos: CODIGO_PRODUCTO, LINEA_NEGOCIO, PLANTA. Enlaza con DIM_GRUPO_COMERCIAL vía CODIGO_GRUPO_COMERCIAL.',
      },
      {
        term: 'DIM_GRUPO_COMERCIAL',
        schema: 'GOLD.MAESTROS',
        def: 'Grupos comerciales. Campos: CODIGO_GRUPO, NOMBRE_GRUPO, TIPO_FABRICACION. Contiene el nombre legible de cada grupo de productos.',
      },
      {
        term: 'DIM_TIEMPO',
        schema: 'GOLD.MAESTROS',
        def: 'Calendario de días hábiles. Campos: FECHA, ANO, MES_NUM, DIA_HABIL. Se usa para calcular "Debe Ser" en función de días laborados vs días del mes.',
      },
      {
        term: 'DIM_ESTADO_CLIENTE',
        schema: 'GOLD.VENTAS',
        def: 'Estado actual de cada cliente. Campos: ID_CLIENTE, ESTADO_CLIENTE (ACTIVO, NUEVO, PERDIDO, RIESGO, SEGUIMIENTO). Determina si las ventas son Orgánicas (cliente existente) o Inorgánicas (NUEVO).',
      },
      {
        term: 'DIM_VENDEDOR_PP',
        schema: 'GOLD.VENTAS',
        def: 'Mapeo vendedor → atributos de segmentación. Campos: VENDEDOR, REGION, PLANTA, MERCADO, GRUPO_COMERCIAL, UNIDAD_MEDIDA. Necesaria para obtener MERCADO.',
      },
      {
        term: 'PP_REGION_PLANTA_GRUPO',
        schema: 'GOLD.VENTAS',
        def: 'Presupuesto granular por dimensión geográfica/productiva. Campos: ANO, MES_NUM, REGION, PLANTA, GRUPO_COMERCIAL, LINEA_NEGOCIO, PRESUPUESTO_MES. Solo existe para 2026.',
      },
      {
        term: 'PP_VENDEDOR_VALOR',
        schema: 'GOLD.VENTAS',
        def: 'Presupuesto en COP por vendedor. Campos: ANO, MES_NUM, VENDEDOR, REGION, MERCADO, GRUPO_COMERCIAL, PLANTA, PP_VALOR_MES. Solo existe para 2026.',
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
        def: '(Ventas_Actual / Ventas_AñoAnterior - 1) × 100. Sin mes seleccionado se acota el año anterior al mismo mes YTD para comparar períodos iguales.',
      },
      {
        term: 'Variación MoM %',
        def: '(Ventas_Mes / Ventas_MesAnterior - 1) × 100. Solo disponible cuando hay mes seleccionado.',
      },
      {
        term: 'Cumplimiento PP %',
        def: 'Ventas_Actual / PP_Mes × 100. Mide qué porcentaje de la meta mensual se ha alcanzado.',
      },
      {
        term: 'Debe Ser',
        def: 'PP_Mes × (Días_Hábiles_Transcurridos / Días_Hábiles_Mes). Indica cuánto se debería haber vendido a la fecha de hoy para ir en ritmo de cumplir el presupuesto.',
      },
      {
        term: 'Proyección',
        def: 'Ventas_Actual × (Días_Hábiles_Mes / Días_Hábiles_Transcurridos). Estimado de cierre del mes al ritmo actual.',
      },
      {
        term: 'Orgánica / Inorgánica',
        def: 'Clasifica cada venta según DIM_ESTADO_CLIENTE. ESTADO_CLIENTE = "NUEVO" → Inorgánica; todos los demás → Orgánica. Mide crecimiento real vs incorporación de nuevos clientes.',
      },
    ],
  },
  {
    id: 'rfm',
    icon: PieChart,
    title: 'RFM — Segmentación de Clientes',
    items: [
      {
        term: '¿Qué es RFM?',
        def: 'Modelo de segmentación que clasifica clientes en 3 dimensiones: Recencia (R), Frecuencia (F) y Monto (M). Permite identificar clientes de alto valor, clientes en riesgo y oportunidades de retención.',
      },
      {
        term: 'Recencia (R)',
        def: 'Días transcurridos desde la última compra del cliente hasta hoy. Menor valor = mejor (cliente activo). Se calcula con DATEDIFF(MAX(FECHA_FACTURA), hoy).',
      },
      {
        term: 'Frecuencia (F)',
        def: 'Número de facturas distintas (NUMERO_FACTURA) del cliente en el período. Mayor valor = más fiel.',
      },
      {
        term: 'Monto (M)',
        def: 'Suma de VENTAS_NETAS del cliente en el período. Mayor valor = mayor aportación.',
      },
      {
        term: 'Scores 1–5',
        def: 'Cada dimensión R, F, M se escala de 1 a 5 usando quintiles (pandas.qcut). 5 es el mejor. Score total = R+F+M (3–15). Un cliente con score 15 es el más valioso posible.',
      },
      {
        term: 'Segmento Campeón',
        def: 'R ≥ 4, F ≥ 4, M ≥ 4. Clientes que compran frecuentemente, recientemente y en alto volumen. Prioridad máxima de retención.',
      },
      {
        term: 'Segmento Leal',
        def: 'R ≥ 3, F ≥ 3, M ≥ 3. Buenos clientes activos pero no en el top absoluto. Target para upselling.',
      },
      {
        term: 'Segmento En Riesgo',
        def: 'R ≤ 2, F ≥ 4. Clientes que antes compraban mucho pero llevan tiempo sin hacerlo. Acción urgente de reactivación.',
      },
      {
        term: 'Segmento No Perder',
        def: 'R = 1, F ≥ 4. Los clientes más frecuentes históricamente que están inactivos. Riesgo crítico de pérdida.',
      },
      {
        term: 'Segmento Perdido',
        def: 'R ≤ 2, F ≤ 2. Clientes inactivos con poca frecuencia histórica. Bajo valor de reactivación.',
      },
    ],
  },
  {
    id: 'abcxyz',
    icon: BarChart2,
    title: 'ABC/XYZ — Clasificación de Clientes',
    items: [
      {
        term: '¿Qué es ABC/XYZ?',
        def: 'Matriz de clasificación que combina la importancia económica (ABC) con la predictibilidad del comportamiento de compra (XYZ). Ayuda a priorizar esfuerzos comerciales y de inventario.',
      },
      {
        term: 'Clase A',
        def: 'Clientes que representan el 80% acumulado de las ventas totales. Son los de mayor valor. Requieren atención prioritaria y planes de cuenta dedicados.',
      },
      {
        term: 'Clase B',
        def: 'Clientes en el 80–95% acumulado de ventas. Valor medio. Potencial de crecimiento hacia la clase A.',
      },
      {
        term: 'Clase C',
        def: 'Clientes en el 95–100% acumulado. Bajo valor individual pero alto en volumen de registros. Gestión eficiente sin sobrecoste.',
      },
      {
        term: 'Clase X',
        def: 'Coeficiente de variación (CV = desv.estándar / media) < 0.5. Compras muy regulares y predecibles. Fácil de planificar.',
      },
      {
        term: 'Clase Y',
        def: 'CV entre 0.5 y 1.0. Compras con cierta variabilidad. Requiere más seguimiento.',
      },
      {
        term: 'Clase Z',
        def: 'CV > 1.0 o cliente con pocos períodos. Comportamiento irregular o esporádico. Alto riesgo de pérdida.',
      },
      {
        term: 'Combinaciones clave',
        def: 'AX = cliente A con compra regular (oro). AZ = cliente A con comportamiento errático (riesgo). CX = cliente pequeño pero fiel. CZ = cliente de bajo valor e impredecible (candidato a pérdida).',
      },
    ],
  },
  {
    id: 'clv',
    icon: Award,
    title: 'CLV — Valor de Vida del Cliente',
    items: [
      {
        term: '¿Qué es el CLV?',
        def: 'Customer Lifetime Value: estimación del ingreso total que un cliente puede generar a lo largo de su relación con ALICO. Ayuda a priorizar dónde invertir esfuerzos de retención y adquisición.',
      },
      {
        term: 'CLV Histórico',
        def: 'SUM(VENTAS_NETAS) del cliente desde su primera compra hasta hoy. Representable como COP total generado históricamente.',
      },
      {
        term: 'CLV Proyectado',
        def: 'CLV_Histórico × Factor_Retención proyectado a 12 meses adicionales según la tasa de compra promedio mensual del cliente.',
      },
      {
        term: 'Antigüedad',
        def: 'Meses desde la primera factura del cliente hasta la fecha de análisis.',
      },
      {
        term: 'Ticket Promedio',
        def: 'Ventas_Totales / Número_de_Facturas. Monto promedio por transacción.',
      },
      {
        term: 'Frecuencia Mensual',
        def: 'Número de facturas / Meses_Activos. Cuántas compras realiza el cliente por mes en promedio.',
      },
      {
        term: 'Segmento CLV',
        def: 'Alto (top 20% por CLV proyectado) · Medio (siguiente 30%) · Bajo (resto). Guía la asignación de recursos comerciales.',
      },
    ],
  },
  {
    id: 'cross-selling',
    icon: GitMerge,
    title: 'Cross-Selling — Venta Cruzada',
    items: [
      {
        term: '¿Qué es el Cross-Selling?',
        def: 'Análisis de reglas de asociación entre productos o grupos comerciales. Identifica qué productos se compran juntos con mayor frecuencia para recomendar al vendedor qué ofrecer a cada cliente.',
      },
      {
        term: 'Antecedente → Consecuente',
        def: 'Regla de la forma "quienes compran producto A también compran producto B". Antecedente = lo que el cliente ya tiene; Consecuente = lo que podría comprar.',
      },
      {
        term: 'Soporte',
        def: 'Proporción de transacciones (baskets) donde aparecen ambos productos juntos. Soporte = co-ocurrencias / total_baskets. Un soporte de 0.05 significa que en el 5% de las transacciones aparecen juntos.',
      },
      {
        term: 'Confianza',
        def: 'P(B|A) = co-ocurrencias(A∧B) / ocurrencias(A). Probabilidad de que al comprar A también se compre B. Confianza de 0.7 = 70% de las veces que se compra A también se compra B.',
      },
      {
        term: 'Lift',
        def: 'Confianza(A→B) / Soporte(B). Lift > 1 indica relación positiva no aleatoria. Lift = 2.0 significa que A y B se compran juntos el doble de lo esperado por azar. El dashboard muestra las reglas ordenadas por Lift.',
      },
      {
        term: 'Basket (canasta de transacción)',
        def: 'Para Cross-Selling se define como (NUMERO_CLIENTE + NUMERO_FACTURA), es decir, productos comprados en la misma factura por el mismo cliente.',
      },
      {
        term: 'Recomendaciones por cliente',
        def: 'Dado un cliente, se filtran las reglas donde el antecedente está en sus compras y el consecuente NO lo ha comprado. Se ordena por Lift para mostrar las recomendaciones más relevantes.',
      },
    ],
  },
  {
    id: 'churn',
    icon: UserX,
    title: 'Churn — Predicción de Abandono',
    items: [
      {
        term: '¿Qué es el Churn?',
        def: 'Probabilidad de que un cliente deje de comprar ("abandone") en los próximos meses. Permite actuar preventivamente sobre clientes de alto valor en riesgo de perderse.',
      },
      {
        term: 'Score de Churn (0–100)',
        def: 'Puntuación calculada en base a múltiples señales: recencia (días sin comprar), frecuencia histórica, tendencia reciente de ventas y consistencia de compra. Mayor score = mayor riesgo de churn.',
      },
      {
        term: 'Riesgo Alto',
        def: 'Score > 70. Cliente con señales claras de desenganche: lleva meses sin comprar y/o la tendencia es fuertemente negativa. Acción inmediata.',
      },
      {
        term: 'Riesgo Medio',
        def: 'Score 40–70. Señales ambiguas. Monitorear y activar plan de contacto.',
      },
      {
        term: 'Riesgo Bajo',
        def: 'Score < 40. Cliente activo y en ritmo normal de compra.',
      },
      {
        term: 'Factores del modelo',
        def: 'Días desde última compra (peso mayor), tendencia de ventas últimos 3 meses vs período anterior, ratio frecuencia_reciente / frecuencia_histórica, y presencia en el período actual del año.',
      },
    ],
  },
  {
    id: 'score-salud',
    icon: Heart,
    title: 'Score Salud — Puntuación Integral del Cliente',
    items: [
      {
        term: '¿Qué es el Score Salud?',
        def: 'Puntaje 0–100 que resume la salud comercial de cada cliente combinando crecimiento, frecuencia, regularidad y nivel de ventas. Un cliente con score 100 es activo, creciente, frecuente y consistente.',
      },
      {
        term: 'Componente Crecimiento YoY',
        def: 'Contribuye hasta 30 puntos. Score = 30 si la variación YoY ≥ +20%. Se reduce proporcionalmente hasta 0 si la variación ≤ −20%. Mide si el cliente está creciendo o contrayéndose.',
      },
      {
        term: 'Componente Frecuencia',
        def: 'Contribuye hasta 25 puntos. Basado en el número de meses con ventas en el año actual. 12 meses activos = 25 puntos máximos.',
      },
      {
        term: 'Componente Regularidad',
        def: 'Contribuye hasta 25 puntos. Inverso del coeficiente de variación mensual de ventas. Compras muy uniformes = score alto. Compras esporádicas = score bajo.',
      },
      {
        term: 'Componente Volumen',
        def: 'Contribuye hasta 20 puntos. Ventas del cliente vs percentil 90 del total de clientes. Clientes de alto volumen obtienen los 20 puntos; clientes pequeños obtienen proporcionalmente menos.',
      },
      {
        term: 'Categorías',
        def: 'Excelente (80–100) · Bueno (60–79) · Regular (40–59) · Deficiente (<40). Visible como badge de color en la tabla de clientes.',
      },
    ],
  },
  {
    id: 'ranking',
    icon: Trophy,
    title: 'Ranking — Posicionamiento de Grupos/Productos',
    items: [
      {
        term: '¿Qué es el Ranking?',
        def: 'Clasificación mensual de grupos comerciales, líneas de negocio u otras dimensiones de producto según sus ventas. Muestra la posición actual, la posición del mes anterior y el delta de ranking.',
      },
      {
        term: 'Delta de Ranking',
        def: 'rank_anterior − rank_actual. Positivo (↑) = subió posiciones. Negativo (↓) = bajó. NULL = es nuevo en el ranking este mes.',
      },
      {
        term: 'Variación % MoM',
        def: '(Ventas_Mes_Actual / Ventas_Mes_Anterior - 1) × 100. Mide el cambio de ventas monetario entre el mes actual y el anterior.',
      },
      {
        term: 'Agrupaciones disponibles',
        def: 'Grupo Comercial (NOMBRE_GRUPO de DIM_GRUPO_COMERCIAL) · Línea de Negocio (LINEA_NEGOCIO de DIM_GRUPO_PRODUCTO) · Estructura · Dispositivo · Tipo Producto.',
      },
      {
        term: 'Top N',
        def: 'Se calcula sobre los top N grupos (configurable 5–100) del mes actual y del mes anterior por separado, luego se cruzan para calcular el delta.',
      },
    ],
  },
  {
    id: 'anomalias',
    icon: Zap,
    title: 'Anomalías — Detección Automática',
    items: [
      {
        term: '¿Qué son las Anomalías?',
        def: 'Desviaciones estadísticas significativas en las ventas de un período respecto al comportamiento histórico esperado. Pueden ser positivas (picos inesperados) o negativas (caídas bruscas).',
      },
      {
        term: 'Método de detección',
        def: 'Z-Score: se calcula la media y desviación estándar de las ventas mensuales históricas de cada dimensión (grupo comercial, línea, etc.). Puntos con |Z| > umbral (default 1.5σ) se marcan como anomalía.',
      },
      {
        term: 'Z-Score',
        def: '(Ventas_Mes - Media_Histórica) / Desviación_Estándar. Z > 0 = ventas por encima del promedio. Z < 0 = por debajo. |Z| > 1.5 es estadísticamente inusual (~87% de confianza).',
      },
      {
        term: 'Umbral σ',
        def: 'Configurable de 1.0 a 3.0. Umbral bajo (1.0) detecta más anomalías (más sensible). Umbral alto (3.0) solo detecta eventos muy extremos.',
      },
      {
        term: 'Sin anomalías detectadas',
        def: 'Es un resultado válido y positivo. Significa que las ventas del período analizado están dentro del rango histórico normal para todas las dimensiones del grupo seleccionado.',
      },
      {
        term: 'Dimensiones disponibles',
        def: 'Línea de Negocio (default) · Grupo Comercial · Vendedor · Región · Cliente.',
      },
    ],
  },
  {
    id: 'canasta',
    icon: ShoppingCart,
    title: 'Canasta — Co-ocurrencia de Productos',
    items: [
      {
        term: '¿Qué es el Análisis de Canasta?',
        def: 'Identifica qué grupos de productos se compran juntos dentro del mismo vendedor y mes. Diferente a Cross-Selling: la canasta analiza co-ocurrencia a nivel de "bolsa de compras" del vendedor, no de factura individual.',
      },
      {
        term: 'Canasta (basket)',
        def: 'En este análisis se define como (CODIGO_VENDEDOR + ANO_FISCAL + PERIODO_FISCAL): todos los productos que un vendedor movió en un mes dado. Distinto a Cross-Selling que usa la factura individual.',
      },
      {
        term: 'Co-ocurrencias',
        def: 'Número de canastas (vendedor-mes) donde aparecen los dos productos a la vez.',
      },
      {
        term: 'Soporte %',
        def: 'Co-ocurrencias / Total_canastas × 100. Qué porcentaje de canastas contienen ambos productos.',
      },
      {
        term: 'Confianza A→B %',
        def: 'Co-ocurrencias / Canastas_con_A × 100. Probabilidad de que si hay A también haya B en la misma canasta.',
      },
      {
        term: 'Lift',
        def: 'Soporte(A∧B) / (Soporte(A) × Soporte(B)). Lift > 1 indica que los productos se venden juntos más de lo esperado por azar. Útil para identificar grupos naturales de productos.',
      },
      {
        term: 'Excluir PVTA',
        def: 'Opción para excluir canastas de puntos de venta directos (vendedores con código PVTA*). Recomendado para analizar el canal de vendedores de campo.',
      },
    ],
  },
  {
    id: 'pareto',
    icon: PieChart,
    title: 'Pareto Clientes — Regla 80/20',
    items: [
      {
        term: '¿Qué es el Pareto de Clientes?',
        def: 'Análisis que identifica cuántos clientes concentran el 80% de las ventas totales (Principio de Pareto). Permite focalizar esfuerzos comerciales en los clientes de mayor impacto.',
      },
      {
        term: 'Participación % (PCT_TOTAL)',
        def: 'Ventas_Cliente / Ventas_Total × 100. Qué porcentaje del total de ventas representa este cliente individualmente.',
      },
      {
        term: 'Acumulado % (PCT_ACUMULADO)',
        def: 'Suma acumulada de PCT_TOTAL ordenando clientes de mayor a menor venta. El punto donde cruza el 80% define la línea de Pareto.',
      },
      {
        term: 'Clientes Pareto 80',
        def: 'El conjunto mínimo de clientes que suman el 80% de las ventas. Comúnmente representa entre el 10-20% del total de clientes activos.',
      },
      {
        term: 'Filtros disponibles',
        def: 'Se puede filtrar por año, mes, región, vendedor, grupo comercial. Permite calcular el Pareto dentro de un segmento específico.',
      },
      {
        term: 'Curva de Pareto',
        def: 'Gráfico con barras de ventas individuales (eje izquierdo) y línea de porcentaje acumulado (eje derecho). La intersección de la curva con el 80% horizontal define el corte de Pareto.',
      },
    ],
  },
  {
    id: 'comercializacion',
    icon: Ruler,
    title: 'Comercialización — Análisis en Metros',
    items: [
      {
        term: '¿Qué es la Comercialización?',
        def: 'Análisis del volumen de ventas en metros lineales/cuadrados para productos donde la unidad de medida es metro (PIE, METRO, etc.). Complementa el análisis en COP con una visión de volumen físico.',
      },
      {
        term: 'Unidad de Medida (UOM)',
        def: 'Campo UNIDAD_MEDIDA_VENTA de FACT_VENTAS. Indica la unidad en que se mide cada producto (PIE, METRO, KG, UN, etc.).',
      },
      {
        term: 'Metros Totales',
        def: 'SUM(CANTIDAD) para todos los registros donde la unidad de medida es convertible a metros (PIE, PIE2, METRO, M2, etc.). Aplica factores de conversión si es necesario.',
      },
      {
        term: 'Porcentaje Convertido',
        def: 'Porcentaje de las ventas en COP que corresponde a productos con UOM convertible a metros. Un 87% significa que el 87% de las ventas son de productos medidos en unidades lineales/superficiales.',
      },
      {
        term: 'Pronóstico de metros',
        def: 'Proyección basada en el ritmo de metros vendidos en los meses previos del año. Usa regresión lineal simple sobre los puntos históricos disponibles.',
      },
      {
        term: 'Distribución por grupo',
        def: 'Desglose de metros por grupo comercial (NOMBRE_GRUPO). Permite ver qué líneas de producto aportan más volumen físico.',
      },
    ],
  },
  {
    id: 'cohort',
    icon: GitBranch,
    title: 'Cohortes — Retención de Clientes',
    items: [
      {
        term: '¿Qué es el Análisis de Cohortes?',
        def: 'Agrupa a los clientes por el mes en que realizaron su primera compra (cohorte de adquisición) y rastrea cuántos de ellos volvieron a comprar en los meses siguientes. Mide la retención real.',
      },
      {
        term: 'Cohorte de Adquisición',
        def: 'Mes de la primera factura del cliente. Todos los clientes cuya primera compra fue en, por ejemplo, enero 2025 forman la "cohorte Ene-2025".',
      },
      {
        term: 'Mes Relativo (M+0, M+1...)',
        def: 'M+0 = mes de adquisición (100% por definición). M+1 = mes siguiente. M+3 = 3 meses después. El porcentaje indica cuántos clientes de esa cohorte compraron en ese mes relativo.',
      },
      {
        term: 'Retención %',
        def: 'Clientes_Activos_en_M+N / Clientes_Cohorte_M+0 × 100. Una retención del 40% en M+3 significa que 4 de cada 10 clientes nuevos volvieron a comprar 3 meses después.',
      },
      {
        term: 'Mapa de calor',
        def: 'La visualización en tabla de colores permite ver de un vistazo qué cohortes tienen mejor retención. Celdas más oscuras = mayor retención. El gradiente es por fila (relativo a la cohorte).',
      },
    ],
  },
  {
    id: 'desempeno',
    icon: Activity,
    title: 'Desempeño Global — Ficha Integral',
    items: [
      {
        term: '¿Qué es el Desempeño Global?',
        def: 'Ficha de análisis exhaustiva para cualquier dimensión del negocio: vendedor, región, cliente o grupo comercial. Concentra en una sola vista todos los KPIs, tendencias y rankings relevantes para esa dimensión.',
      },
      {
        term: 'Dimensiones soportadas',
        def: 'Vendedor (filtro por CODIGO_VENDEDOR) · Región (filtro por DESCRIPCION_REGION) · Cliente (filtro por NUMERO_CLIENTE) · Grupo Comercial (filtro por NOMBRE_GRUPO en DIM_GRUPO_COMERCIAL).',
      },
      {
        term: 'KPIs de la ficha',
        def: 'Ventas Netas (año seleccionado) · Ventas Año Anterior · Variación YoY % · N° Clientes distintos · N° Productos distintos · Meses Activos en el año.',
      },
      {
        term: 'Tendencia 24 meses',
        def: 'Gráfico de área con las ventas mensuales del año actual y el año anterior para visualizar estacionalidad, picos y caídas a lo largo del tiempo.',
      },
      {
        term: 'Top Grupos Comerciales',
        def: 'Los 10 grupos comerciales con más ventas dentro de la dimensión seleccionada. Muestra barra horizontal con el NOMBRE_GRUPO y el monto en COP.',
      },
      {
        term: 'Top Clientes',
        def: 'Los 10 clientes con más ventas dentro de la dimensión seleccionada. No aplica cuando la dimensión es "cliente" (ya es un individuo).',
      },
      {
        term: 'Top Vendedores',
        def: 'Los 10 vendedores con más ventas dentro de la dimensión seleccionada. No aplica cuando la dimensión es "vendedor" (ya es un individuo).',
      },
      {
        term: 'Autocompletado',
        def: 'El campo de búsqueda usa el endpoint /api/filters/* y /api/dimensions para sugerir valores válidos conforme se escribe, evitando consultas con dimensiones inexistentes.',
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
        def: 'Región, Planta, Grupo Comercial, Línea de Negocio → PP se obtiene de PP_REGION_PLANTA_GRUPO agrupando por la dimensión correspondiente. Columna: PRESUPUESTO_MES.',
      },
      {
        term: 'Dimensiones con PP por vendedor',
        def: 'Mercado, Unidad de Medida → PP de PP_VENDEDOR_VALOR agrupando por MERCADO o UNIDAD_MEDIDA. Columna: PP_VALOR_MES.',
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
        def: 'Clientes con variación YoY ≤ umbral seleccionado (default −20%). Se calculan solo para clientes con ventas en ambos períodos.',
      },
      {
        term: 'Severidad',
        def: 'Crítica: variación ≤ −50%. Alta: −50% < variación ≤ −30%. Media: > −30%.',
      },
      {
        term: 'Clientes Inactivos',
        def: 'Clientes sin facturar en los últimos N meses (configurable 1–12). Se calcula con DATEDIFF entre MAX(FECHA_FACTURA) y hoy. Clasificación: Perdido >180d · Riesgo Alto 91–180d · En Riesgo < umbral.',
      },
    ],
  },
  {
    id: 'filtros',
    icon: Filter,
    title: 'Filtros Globales',
    items: [
      {
        term: 'Año / Mes / Mes Fin',
        def: 'Año = ANO_FISCAL. Mes = PERIODO_FISCAL. Mes Fin permite seleccionar un rango (ej. Ene-Mar). Sin mes = acumula YTD del año.',
      },
      {
        term: 'Región',
        def: 'Filtra DIM_DOMICILIO.DESCRIPCION_REGION vía JOIN FACT_VENTAS → DIM_DOMICILIO (DOMICILIO_KEY).',
      },
      {
        term: 'Vendedor',
        def: 'Filtra FACT_VENTAS.CODIGO_VENDEDOR directamente. Soporta múltiples valores (IN clause).',
      },
      {
        term: 'Grupo Comercial',
        def: 'Filtra DIM_GRUPO_COMERCIAL.NOMBRE_GRUPO vía JOIN FACT_VENTAS → DIM_GRUPO_PRODUCTO → DIM_GRUPO_COMERCIAL.',
      },
      {
        term: 'Planta',
        def: 'Filtra DIM_GRUPO_PRODUCTO.PLANTA vía JOIN por CODIGO_PRODUCTO.',
      },
      {
        term: 'Excluir PVTA',
        def: 'Excluye CODIGO_VENDEDOR LIKE \'PVTA%\'. Elimina puntos de venta directos del análisis.',
      },
      {
        term: 'Excluir Exportaciones',
        def: 'Excluye DESCRIPCION_REGION LIKE \'%EXPORTACION%\'.',
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
        def: 'El año y mes fiscal de ALICO. PERIODO_FISCAL es el número de mes (1–12). Pueden diferir del año calendario.',
      },
      {
        term: 'Ventas Netas',
        def: 'Ventas brutas menos descuentos, devoluciones y notas crédito. Métrica principal de ingresos. Expresada en COP.',
      },
      {
        term: 'NUMERO_CLIENTE vs ID_CLIENTE',
        def: 'NUMERO_CLIENTE es el código externo del cliente (visible en DIM_CLIENTE). ID_CLIENTE es la llave interna usada en FACT_VENTAS y DIM_ESTADO_CLIENTE.',
      },
      {
        term: 'Canasta vs Cross-Selling',
        def: 'Canasta: analiza co-ocurrencia a nivel vendedor-mes (qué lleva el vendedor en su "bolsa" del mes). Cross-Selling: analiza co-ocurrencia a nivel factura individual (qué compra el cliente en la misma transacción).',
      },
      {
        term: 'Lift > 1',
        def: 'En reglas de asociación, un Lift > 1 significa relación positiva real entre los dos ítems. Lift = 1 sería compra independiente (aleatoria). Prioriza reglas con Lift alto para recomendaciones.',
      },
      {
        term: 'Score RFM 1–5',
        def: '5 es el mejor. R: menor tiempo sin comprar = 5. F y M: mayor valor = 5. El score total (3–15) resume el valor global del cliente. Un score de 15 es el cliente ideal.',
      },
      {
        term: 'Excluir PVTA',
        def: 'Códigos de vendedor que empiezan con "PVTA" corresponden a puntos de venta propios (canal retail directo). Excluirlos enfoca el análisis en el canal de vendedores de campo.',
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
          Fuentes, tablas, métricas, módulos analíticos y conceptos del modelo BI Ventas · ALICO SAS BIC
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
