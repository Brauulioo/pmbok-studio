const fs = require('node:fs');
const path = require('node:path');
const OUTPUT_FILE = path.join(__dirname, 'presets.json');

const definitions = {
  schema_version: '1.0.0',
  producto: 'PMBOK Studio',
  idioma: 'es',
  proposito: 'Plantillas educativas editables; los presupuestos, metas y umbrales son ejemplos, no resultados medidos ni exigencias universales de PMI.',
  convenciones: {
    referencias: 'codigo es único dentro de cada matriz y preset. Los nombres de roles son claves exactas; renombrarlos debe actualizar todas sus referencias en una transacción.',
    raci: { A: 'Aprobador y responsable último del resultado', R: 'Responsable de ejecutar', C: 'Consultado', I: 'Informado', cantidad_A_por_entregable: 1, cantidad_R_por_entregable: 1, nota: 'Un único R y la separación entre R y A son restricciones del producto solicitadas; RACI admite varios R en otros contextos.' },
    dod: 'Los criterios específicos se complementan con la definición común de terminado. evidencia describe lo esperado; evidencia_registrada contiene enlaces reales, inicialmente vacíos.',
    evidencia: 'Usar rutas del repositorio o enlaces verificables con versión/commit y fecha. Una descripción de evidencia esperada no demuestra aprobación.',
    formulas: 'Las fórmulas son especificaciones declarativas para implementar por codigo; no ejecutar strings con eval.',
    datos_faltantes: 'null = sin medición o no calculable. 0 = cero observado o estado inicial explícito. No convertir null en cero.',
    metas: 'Metas iniciales configurables. Una meta referenciada se resuelve en la misma fecha de corte.',
    indicadores: 'Los siete KPIs base son Rezagado respecto de la entrega de valor. Su historial puede informar pronósticos, pero no los convierte en indicadores adelantados.',
    alcance_cardinalidad: '5 roles, 6 entregables, 4 riesgos y 7 KPIs son requisitos de estos presets; el proyecto cargado puede ampliarse conservando sus invariantes.'
  },
  politica_riesgos: {
    formula_puntaje: 'gravedad * probabilidad',
    interpretacion: 'Puntaje de prioridad ordinal, no valor monetario esperado. En Oportunidad, gravedad representa magnitud del beneficio potencial.',
    escala_gravedad: [
      { valor: 1, etiqueta: 'Muy baja', criterio: 'Variación de esfuerzo o costo mayor que 0 y hasta 2% de la línea base; efecto funcional marginal.' },
      { valor: 2, etiqueta: 'Baja', criterio: 'Variación mayor que 2% y hasta 5%; efecto en una función secundaria.' },
      { valor: 3, etiqueta: 'Moderada', criterio: 'Variación mayor que 5% y hasta 10%; efecto en una función relevante.' },
      { valor: 4, etiqueta: 'Alta', criterio: 'Variación mayor que 10% y hasta 20%; efecto en un objetivo principal.' },
      { valor: 5, etiqueta: 'Muy alta', criterio: 'Variación mayor que 20%; compromete un objetivo esencial o habilita un beneficio decisivo.' }
    ],
    criterio_multidimensional: 'Elegir el máximo nivel aplicable de costo, esfuerzo o alcance; en amenaza valorar perjuicio y en oportunidad beneficio. Ajustar estas escalas antes de aprobar la línea base.',
    escala_probabilidad: [
      { valor: 1, porcentaje_mayor_que: 0, porcentaje_hasta: 20 },
      { valor: 2, porcentaje_mayor_que: 20, porcentaje_hasta: 40 },
      { valor: 3, porcentaje_mayor_que: 40, porcentaje_hasta: 60 },
      { valor: 4, porcentaje_mayor_que: 60, porcentaje_hasta: 80 },
      { valor: 5, porcentaje_mayor_que: 80, porcentaje_hasta: 100 }
    ],
    niveles: [ { nivel: 'Bajo', minimo: 1, maximo: 5 }, { nivel: 'Medio', minimo: 6, maximo: 12 }, { nivel: 'Alto', minimo: 13, maximo: 25 } ],
    estrategias_permitidas: { Amenaza: ['Evitar', 'Mitigar', 'Transferir', 'Aceptar'], Oportunidad: ['Explotar', 'Compartir', 'Mejorar'] },
    nota: 'El catálogo de estrategias y el corte >=13 son políticas del producto. Aceptar también puede aplicarse a oportunidades en la disciplina, pero se excluye aquí por requisito del contrato solicitado.'
  },
  politica_auditoria: {
    error: 'Bloquea marcar como validado, aprobar o publicar la matriz; permite guardar borrador.',
    warning: 'Recomienda revisión sin bloquear; permite registrar justificación.',
    concentracion_R_fraccion_mayor_que: 0.5,
    riesgo_alto_minimo: 13,
    tolerancia_numerica_absoluta: 0.000001,
    kpis_adelantados_minimo_recomendado: 1,
    faltantes_al_cargar: 'No advertir por ausencia normal de mediciones en la semana 0; mostrar Sin datos. Evaluar vencimientos según frecuencia y fecha de corte.',
    notas: 'La concentración de R es una señal, no prueba de sobrecarga; se confirma con esfuerzo y disponibilidad. Comparar cálculos sin redondear, redondear solo al mostrar.'
  },
  diccionario_medicion: {
    puntos_aceptados_sprint: 'Suma de puntos de historias únicas terminadas y aceptadas durante el sprint cerrado, incluyendo el DoD común. No contar dos veces historias reabiertas ni trabajo parcial.',
    hitos_vencidos: 'Número de entregables cuyo fin_semana_plan es menor o igual que semana_corte.',
    hitos_vencidos_aprobados_a_tiempo: 'Subconjunto de hitos_vencidos aprobado en o antes de su fin_semana_plan; incluye en el denominador los vencidos aún pendientes.',
    entregables_aprobados: 'Número de entregables con estado Aprobado y evidencia y aprobación registradas.',
    total_entregables: 'Número de entregables vigentes en dod_items; inicialmente 6.',
    entregables_planificados_acumulados: 'Número de entregables con fin_semana_plan <= semana_corte.',
    suma_calificaciones: 'Suma de respuestas válidas 1-5 de la encuesta de satisfacción de la revisión más reciente.',
    numero_respuestas: 'Número de respuestas válidas de esa misma revisión. Sin respuestas, satisfacción = null.',
    EV: 'Valor presupuestado del trabajo aprobado hasta el corte; suma de presupuesto de paquetes aprobados, según regla 0/100.',
    PV: 'Valor presupuestado del trabajo programado hasta el corte; suma de presupuesto de paquetes con fin_semana_plan <= semana_corte.',
    AC: 'Suma de costos reales incurridos hasta el corte, incluyendo trabajo en curso; fuente: registro_costos. No estimar como porcentaje de BAC.',
    BAC: 'Suma de presupuesto de todos los paquetes de la línea base vigente; excluye reserva de gestión.',
    registro_costos: 'Cada registro futuro: id único, entregable_codigo válido, semana >= 0 y <= semana_corte, importe >= 0 y unidad igual a la línea base; incluir facturas/devengos y horas por tarifa si se presupuestaron así.',
    aprobacion: 'Al aprobar guardar rol_aprobador igual al A del RACI, semana_aprobacion <= semana_corte y referencias a evidencia_registrada. No llenar automáticamente con datos del preset.'
  },
  fuentes: [
    { tema: 'RACI: único A; varios R posibles', url: 'https://www.pmi.org/pt-br/pmiheadless/home/blog/blog-posts/2026/07/27/15/54/stakeholder-management-raci' },
    { tema: 'EVM: definiciones y fórmulas', url: 'https://www.pmi.org/learning/library/advances-earned-schedule-value-management-6217' },
    { tema: 'Respuestas a oportunidades', url: 'https://www.pmi.org/learning/library/effective-strategies-exploiting-opportunities-7947' },
    { tema: 'Equilibrio de indicadores', url: 'https://www.pmi.org/it-it/learning/thought-leadership/measuring-what-matters' }
  ],
  presets: []
};

function item(codigo, entregable, criterio_aceptacion, responsable, evidencia) {
  return { codigo, entregable, criterio_aceptacion, responsable, evidencia, estado: 'Pendiente', evidencia_registrada: [], aprobacion: null };
}
function risk(codigo, tipo, descripcion, gravedad, probabilidad, tipo_estrategia, estrategia, propietario, entregables_afectados, disparador) {
  return { codigo, tipo, descripcion, gravedad, probabilidad, tipo_estrategia, estrategia, propietario, entregables_afectados, disparador, estado: 'Identificado', justificacion_aceptacion: null };
}
function makeKpis(roles, ctx) {
  const make = (codigo, nombre, definicion, formula, unidad, meta, fuente, responsable, frecuencia) => ({ codigo, nombre, tipo_indicador: 'Rezagado', definicion, formula, unidad, meta, fuente, responsable, frecuencia, valor_actual: null, sin_datos: 'Mostrar Sin datos; no inferir cumplimiento ni incumplimiento.' });
  return [
    make('K1', 'Velocidad de Desarrollo', `Puntos aceptados de ${ctx.trabajo} por sprint de 2 semanas. Usar escala estable del equipo; no comparar equipos ni personas.`, 'puntos_aceptados_sprint', 'puntos/sprint', { tipo: 'Referencia_inicial', valor: 12, revision: 'Recalibrar con la mediana de 3 sprints cerrados; no usar para evaluar productividad individual.' }, 'Backlog con puntos, sprint y evidencia de aceptación', roles[0], 'Al cierre de cada sprint'),
    make('K2', 'Cumplimiento del Cronograma', `Porcentaje de hitos vencidos de ${ctx.hitos} aprobados dentro del plazo.`, '100 * hitos_vencidos_aprobados_a_tiempo / hitos_vencidos; null si hitos_vencidos = 0', '%', { tipo: 'Minimo', valor: 90 }, 'Línea base y registro de aprobación de E1-E6', roles[0], 'Semanal'),
    make('K3', 'EV', `Valor ganado de ${ctx.hitos} con aceptación verificable. No representa ingresos ni gasto real.`, 'SUM(presupuesto_i * aprobado_i); aprobado_i = 1 si aprobado al corte, en otro caso 0', 'UM', { tipo: 'Minimo_referenciado', referencia: 'PV' }, 'Paquetes de la línea base y aprobaciones del DoD', roles[0], 'Semanal'),
    make('K4', 'SPI', 'Eficiencia de avance frente al trabajo presupuestado previsto al corte.', 'EV / PV; null si PV = 0', 'ratio', { tipo: 'Minimo', valor: 1 }, 'EV y PV de la misma línea base y corte', roles[0], 'Semanal'),
    make('K5', 'CPI', `Eficiencia del costo de ${ctx.costos}.`, 'EV / AC; null si AC = 0', 'ratio', { tipo: 'Minimo', valor: 1 }, 'EV y costos incurridos acumulados de registro_costos', roles[0], 'Semanal'),
    make('K6', 'Entregable Aprobado', 'Porcentaje de entregables vigentes formalmente aprobados; todos pesan igual solo para este KPI, no para EV.', '100 * entregables_aprobados / total_entregables; null si total_entregables = 0', '%', { tipo: 'Minimo_referenciado', referencia: '100 * entregables_planificados_acumulados / total_entregables', meta_cierre: 100 }, 'DoD, evidencia registrada y aprobación del rol A', roles[3], 'Semanal'),
    make('K7', 'Satisfacción del Cliente', `Media de encuesta 1-5 al ${ctx.cliente}, sobre ${ctx.satisfaccion}. Publicar también el número de respuestas.`, 'suma_calificaciones / numero_respuestas; null si numero_respuestas = 0', 'puntos/5', { tipo: 'Minimo', valor: 4 }, 'Encuesta posterior a la demostración, escala 1=muy insatisfecho a 5=muy satisfecho', roles[0], 'Al cierre de cada sprint con demostración')
  ];
}
function preset(id, nombre, descripcion, roles, items, rows, risks, budgets, ctx) {
  const raci = {};
  items.forEach((it, i) => { raci[it.codigo] = Object.fromEntries(roles.map((r, j) => [r, rows[i][j]])); });
  return {
    id, nombre, descripcion, roles,
    configuracion_proyecto: { duracion_semanas: 12, duracion_sprint_semanas: 2, fecha_inicio: null, cliente_representante: ctx.cliente, requiere_validacion_de_supuestos: true },
    dod_comun: ['Cambios revisados por al menos un integrante distinto del autor.', 'Pruebas asociadas al criterio de aceptación ejecutadas y aprobadas.', 'Cero defectos críticos abiertos en el alcance entregado.', 'Documentación y evidencia versionadas sin secretos ni datos personales reales.', 'El rol A registra aprobación después de verificar los criterios específicos.'],
    dod_items: items, raci_assignments: raci, risks,
    evm: {
      unidad: 'UM', descripcion_unidad: 'Unidad monetaria didáctica ficticia; sustituir por una única moneda para medición real.',
      origen_presupuesto: 'Ejemplo editable: incluye trabajo valorado e insumos; usar la misma base de costo para presupuesto y costo real.',
      linea_base: { version: '1.0', estado: 'Propuesta', BAC: budgets.reduce((a,b)=>a+b,0), metodo_devengo_EV: '0/100 por entregable aprobado', metodo_distribucion_PV: '0/100 al fin planificado de cada entregable', paquetes: items.map((it,i)=>({entregable_codigo: it.codigo, presupuesto: budgets[i], fin_semana_plan: 2*(i+1)})) },
      corte: { semana_corte: 0, EV: 0, PV: 0, AC: 0, SPI: null, CPI: null, estado: 'Inicial_sin_ejecucion' },
      registro_costos: [],
      calculo: { BAC: 'SUM(presupuesto_i)', EV: 'SUM(presupuesto_i donde estado = Aprobado y semana_aprobacion <= semana_corte)', PV: 'SUM(presupuesto_i donde fin_semana_plan <= semana_corte)', AC: 'SUM(importe de registro_costos hasta semana_corte)', SPI: 'PV > 0 ? EV / PV : null', CPI: 'AC > 0 ? EV / AC : null' },
      nota: 'Aprobar la línea base antes de interpretar desempeño. Si se requiere granularidad semanal, descomponer paquetes y distribuir PV explícitamente; no usar porcentaje subjetivo ni puntos de historia como moneda. AC puede superar BAC.'
    },
    kpis: makeKpis(roles, ctx),
    sugerencia_indicador_adelantado: { nombre: ctx.leading, tipo_indicador: 'Adelantado', formula: ctx.leading_formula, meta_minima_porcentaje: 90, frecuencia: 'Antes de cada sprint', incluido_en_kpis_base: false },
    advertencias_iniciales_esperadas: ['KPI-03: Los 7 KPIs base son rezagados; considerar activar la sugerencia de indicador adelantado.']
  };
}

let roles = ['Líder de Proyecto', 'Desarrollador Backend', 'Desarrollador Frontend', 'QA / Tester', 'Arquitecto BD'];
definitions.presets.push(preset('web-saas-full-stack', 'Aplicación Web / SaaS Full-Stack', 'MVP de gestión de tareas multiusuario con autenticación, API, base de datos y despliegue reproducible.', roles, [
  item('E1', 'Alcance y arquitectura del MVP', 'Backlog con al menos 8 historias priorizadas, cada una con criterios verificables; diagrama de componentes, modelo de autorización y alcance de la demo aprobados.', roles[0], 'docs/alcance.md, docs/arquitectura.md y acta de revisión vinculada al commit.'),
  item('E2', 'Modelo de datos y migraciones', 'Esquema implementado con restricciones de integridad; migraciones y carga de datos sintéticos ejecutadas desde una BD vacía; respaldo restaurado y conteo de registros verificado.', roles[4], 'Migraciones, diagrama ER, script de semillas e informe de restauración.'),
  item('E3', 'API y autenticación', 'Registro, inicio de sesión y CRUD de tareas documentados; 100% de pruebas de acceso cruzado entre usuarios rechazan la operación; pruebas de integración de los flujos críticos aprobadas.', roles[1], 'Especificación OpenAPI, reporte de pruebas y enlaces a ejecuciones CI.'),
  item('E4', 'Interfaz web integrada', 'Flujos de registro, inicio de sesión y gestión de tareas completados en anchos de 360 y 1280 px; navegación por teclado, etiquetas y mensajes de error verificados; 100% de casos E2E críticos aprobados.', roles[2], 'Reporte E2E, lista de comprobación de accesibilidad y capturas de la versión evaluada.'),
  item('E5', 'Validación funcional y de rendimiento', 'Suite crítica completa aprobada y cero defectos críticos abiertos; con 20 usuarios concurrentes durante 5 minutos, lecturas de tareas con p95 <= 500 ms y tasa de error < 1% en el entorno documentado.', roles[3], 'Plan de pruebas, defectos cerrados y reporte de carga con configuración del entorno.'),
  item('E6', 'Release y despliegue reproducible', 'Una persona distinta del autor despliega desde un clon limpio siguiendo README; smoke tests aprobados en la URL de demo; rollback a la versión anterior probado; licencia del repositorio y dependencias documentadas.', roles[1], 'Tag de release, URL de demo, registro de despliegue y rollback, README y archivo LICENSE.')
], ['RCCIA','ACICR','ARICC','ACRCI','ACIRC','ARICI'], [
  risk('R1','Amenaza','Si falla el aislamiento de usuarios en la API, un usuario podría acceder a tareas ajenas y bloquear la aceptación de la demo.',5,3,'Mitigar','Implementar autorización por recurso y pruebas negativas de acceso cruzado en CI antes de integrar cada endpoint.',roles[1],['E3','E5'],'Cualquier prueba de acceso cruzado permite leer o modificar datos ajenos.'),
  risk('R2','Amenaza','Si se acumulan cambios incompatibles entre frontend y backend, la integración podría retrasar la demostración.',4,4,'Mitigar','Acordar contrato OpenAPI en E1, generar mocks y ejecutar pruebas de contrato en cada pull request.',roles[2],['E3','E4'],'Una prueba de contrato falla o un cambio de API carece de consumidor actualizado.'),
  risk('R3','Amenaza','Si el hosting de demostración suspende su cuota gratuita, la release podría quedar inaccesible en la evaluación.',4,3,'Evitar','Eliminar la dependencia de la cuota gratuita: desplegar y ensayar la demo en infraestructura universitaria confirmada antes de E6.',roles[1],['E6'],'No existe confirmación de disponibilidad del entorno a dos semanas de la demo.'),
  risk('R4','Oportunidad','Si un componente de autenticación reutilizable supera la evaluación técnica y de licencia, se podría reducir el esfuerzo de E3.',3,4,'Mejorar','Hacer un spike con el componente, validar licencia y pruebas de aislamiento, y actualizar estimaciones solo con resultados reproducibles.',roles[1],['E3'],'El spike satisface las pruebas de autenticación y no requiere cambios mayores.')
], [1000,1500,2500,2200,1500,1300], { trabajo:'historias de API, interfaz y despliegue', hitos:'arquitectura, datos, API, interfaz, pruebas y release', costos:'desarrollo, hosting y pruebas del SaaS', cliente:'docente o representante de usuarios designado', satisfaccion:'utilidad de los flujos y facilidad de uso', leading:'Historias del próximo sprint listas para desarrollo', leading_formula:'100 * historias_con_criterios_contrato_y_dependencias_resueltas / historias_del_proximo_sprint; null si denominador = 0' }));

roles = ['Líder de Proyecto', 'Ingeniero de Firmware', 'Desarrollador Cloud', 'QA / Integración', 'Ingeniero de Hardware'];
definitions.presets.push(preset('iot-hardware-cloud', 'Sistema IoT / Hardware + Cloud', 'Prototipo de monitoreo ambiental con sensor de temperatura, microcontrolador, telemetría y panel cloud.', roles, [
  item('E1','Especificación y arquitectura IoT','Variables, frecuencia de muestreo de 10 s y rango de operación documentados; diagrama dispositivo-red-cloud, presupuesto de energía y 6 casos de uso aprobados.',roles[0],'Especificación, arquitectura, lista preliminar de materiales y acta de revisión.'),
  item('E2','Prototipo electrónico calibrado','Lista de materiales y conexiones reproducibles; 30 lecturas por punto en 3 puntos entre 15 y 35 °C con error absoluto medio <= 1 °C frente a referencia documentada; operación continua de 2 horas sin reinicios.',roles[4],'Esquemático, fotos del montaje, BOM y datos de calibración con instrumento de referencia.'),
  item('E3','Firmware de adquisición y envío','Muestreo cada 10 s con tolerancia de 1 s durante 30 minutos; almacena al menos 60 muestras sin red y las reenvía al recuperar conexión; cada muestra incluye ID, timestamp y unidad; secretos fuera del repositorio.',roles[1],'Firmware versionado, registro serial y prueba de desconexión y recuperación.'),
  item('E4','Ingesta cloud y panel de telemetría','Mensajes autenticados llegan al almacenamiento y panel; deduplicación por ID comprobada; p95 de latencia extremo a extremo <= 5 s con 10 dispositivos simulados durante 15 minutos en red documentada.',roles[2],'Infraestructura como código, esquema de mensajes, reporte de latencia y URL del panel.'),
  item('E5','Prueba integral de confiabilidad','Prueba de 2 horas con 3 dispositivos, al menos 2 físicos y 1 simulado, y corte de red de 5 minutos; >= 99% de muestras esperadas disponibles tras recuperación, sin duplicados; credenciales inválidas rechazadas.',roles[3],'Plan de integración, logs correlacionados, conteo de muestras y reporte de seguridad.'),
  item('E6','Kit de entrega y demostración','Otro integrante reproduce instalación y conexión desde las instrucciones; demostración de lectura, alerta y recuperación de red aprobada; manual de montaje, operación y limitaciones completo.',roles[2],'Release de firmware/cloud, manual, video de demo y acta de aceptación.')
], ['RCCIA','ACICR','ARCIC','ACRCI','ACIRC','ACRIC'], [
  risk('R1','Amenaza','Si el sensor o microcontrolador llega tarde, el prototipo físico podría impedir ejecutar las pruebas integrales.',4,4,'Mitigar','Verificar stock al inicio, comprar componentes críticos en la primera semana y validar un modelo alternativo compatible; usar simulación mientras llega el hardware.',roles[4],['E2','E5'],'El proveedor informa fecha posterior a la semana 2.'),
  risk('R2','Amenaza','Si la red del laboratorio es inestable, se podrían perder muestras durante las pruebas y la demo.',4,4,'Mitigar','Implementar buffer local, reintentos con espera creciente y deduplicación; probar recuperación con un corte de 5 minutos.',roles[1],['E3','E4','E5'],'La pérdida de muestras supera 1% después de recuperar la red.'),
  risk('R3','Amenaza','Si se usan credenciales compartidas o embebidas en el repositorio, un tercero podría publicar telemetría falsa.',5,3,'Evitar','Eliminar credenciales compartidas: provisionar identidad individual por dispositivo, revocar claves expuestas y bloquear commits con secretos detectados.',roles[2],['E3','E4'],'Se detecta una clave en el historial o dos dispositivos comparten identidad.'),
  risk('R4','Oportunidad','Si el laboratorio confirma préstamo de sensores calibrados, se podría ampliar la validación con mejores instrumentos sin compra adicional.',3,3,'Compartir','Acordar con el laboratorio préstamo, horarios y responsabilidades; compartir resultados de calibración y reconocer su colaboración en el informe.',roles[4],['E2','E5'],'El laboratorio ofrece instrumentos y un bloque horario compatible con las pruebas.')
], [1000,3000,2400,2200,1900,1500], { trabajo:'historias de hardware, firmware y cloud con pruebas de aceptación', hitos:'arquitectura, prototipo, firmware, cloud, integración y kit', costos:'trabajo, componentes, instrumentación y servicios cloud', cliente:'docente y usuario del laboratorio designados', satisfaccion:'confiabilidad de lecturas, utilidad de alertas y facilidad de operación', leading:'Dependencias del próximo sprint IoT disponibles y verificadas', leading_formula:'100 * dependencias_con_componentes_accesos_y_bancos_verificados / dependencias_del_proximo_sprint; null si denominador = 0' }));

roles = ['Líder de Proyecto', 'Ingeniero de Datos', 'Científico de Datos', 'QA / Validación de Datos', 'Ingeniero MLOps / BI'];
definitions.presets.push(preset('datos-ia-analytics', 'Arquitectura de Datos / IA & Analytics', 'Pipeline reproducible para clasificación binaria sobre datos públicos o sintéticos, con evaluación y dashboard de resultados.', roles, [
  item('E1','Problema, alcance y contrato de datos','Variable objetivo, usuarios, fuentes autorizadas, esquema, criterios de calidad y métrica F1 macro definidos; baseline de mayoría y partición por tiempo o entidad elegidos según el caso, sin fuga entre conjuntos.',roles[0],'Ficha del problema, contrato de datos, procedencia/licencia y protocolo de partición aprobado.'),
  item('E2','Ingesta y almacenamiento reproducibles','Pipeline ejecutado dos veces sin duplicar registros por clave; 100% de pruebas de esquema aprobadas; >= 98% de completitud en campos obligatorios y cero claves primarias duplicadas; datos inválidos segregados.',roles[1],'Código de ingesta, esquema, catálogo, reporte de calidad y manifiesto con hashes de datos.'),
  item('E3','Dataset analítico y features','Transformaciones ajustadas solo con entrenamiento; ningún ID de entidad cruza particiones cuando aplica; conjuntos versionados con hashes, diccionario de features y pruebas de ausencia de fuga aprobadas.',roles[1],'Pipeline de features, manifiestos de particiones y reporte de pruebas de fuga.'),
  item('E4','Modelo y evaluación reproducible','Semilla, dependencias y parámetros registrados; modelo final elegido con validación; evaluación única en test bloqueado con F1 macro >= 0.75 y al menos 0.05 sobre baseline; matriz de confusión e intervalo bootstrap del 95% reportados.',roles[2],'Artefacto del modelo, registro de experimentos y reporte de evaluación del test bloqueado.'),
  item('E5','Validación independiente y ficha del modelo','Otro integrante reproduce F1 macro con diferencia absoluta <= 0.01 usando el mismo snapshot; verifica métricas por grupos pertinentes, procedencia autorizada y limitaciones; cero defectos críticos abiertos.',roles[3],'Reporte independiente, ficha del modelo, ficha de datos y registro de defectos.'),
  item('E6','Pipeline publicado y dashboard','Desde un entorno limpio se ejecutan ingesta, features e inferencia sobre un snapshot versionado; panel muestra predicciones y métricas coherentes con la fuente en 20 casos muestreados; guía de uso y rollback verificados.',roles[4],'Release, entorno bloqueado, logs de ejecución, URL/capturas del dashboard y manual de operación.')
], ['RCCIA','ARCIC','ARCCI','ACRCI','ACIRC','ACCIR'], [
  risk('R1','Amenaza','Si aparecen cambios de esquema o datos incompletos en la fuente, el pipeline podría producir resultados inválidos.',4,4,'Mitigar','Versionar contratos, validar esquema y completitud antes de cargar, aislar registros inválidos y mantener un snapshot autorizado para reproducibilidad.',roles[1],['E2','E3'],'Falla el contrato de esquema o la completitud baja de 98%.'),
  risk('R2','Amenaza','Si la partición mezcla entidades o información futura, la fuga de datos podría inflar artificialmente las métricas del modelo.',5,3,'Evitar','Separar por entidad o tiempo antes de transformar, ajustar transformaciones solo con entrenamiento y bloquear el test hasta la evaluación final.',roles[2],['E3','E4','E5'],'Se detecta una entidad compartida indebidamente o una feature posterior al momento de predicción.'),
  risk('R3','Amenaza','Si el entrenamiento requiere más memoria o tiempo que los recursos disponibles, la evaluación podría no concluir dentro del semestre.',4,3,'Mitigar','Perfilar con una muestra, fijar un presupuesto máximo de experimentos y priorizar modelos tabulares ligeros; reservar capacidad antes de la semana 8.',roles[4],['E4','E6'],'Un ensayo excede 80% de la memoria disponible o el presupuesto de tiempo por experimento acordado.'),
  risk('R4','Oportunidad','Si un dataset público etiquetado cumple el contrato y su licencia permite reutilización, se podría eliminar el etiquetado manual del alcance.',4,3,'Explotar','Completar la evaluación de calidad y licencia en E1, fijar un snapshot apto como fuente oficial y reemplazar la tarea de etiquetado mediante cambio aprobado.',roles[1],['E1','E2','E3'],'Existe un dataset con etiquetas verificadas, cobertura suficiente y autorización de reutilización.')
], [1000,2000,2000,3000,1500,1500], { trabajo:'historias de ingesta, features, modelado y visualización', hitos:'contrato, ingesta, features, modelo, validación y publicación', costos:'ingeniería de datos, cómputo, almacenamiento y validación', cliente:'docente o usuario analista designado', satisfaccion:'interpretabilidad, utilidad del análisis y reproducibilidad', leading:'Fuentes del próximo sprint con contrato y acceso validados', leading_formula:'100 * fuentes_con_esquema_permiso_acceso_y_muestra_validados / fuentes_requeridas_proximo_sprint; null si denominador = 0' }));

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(definitions, null, 2) + '\n', 'utf8');
console.log(`Generado ${OUTPUT_FILE}`);
