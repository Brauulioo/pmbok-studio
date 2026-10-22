// Reglas PMBOK del lado del cliente. Replican backend/services/pmbok_validator.py
// para dar feedback inmediato; el backend sigue siendo la fuente de verdad al exportar.

import presetsData from '../../../backend/data/presets.json';

export const MAX_EQUIPO = 10;
export const RACI_CYCLE = ['', 'R', 'A', 'C', 'I'];
export const ESTRATEGIAS = {
  Amenaza: ['Evitar', 'Mitigar', 'Transferir', 'Aceptar'],
  Oportunidad: ['Explotar', 'Compartir', 'Mejorar'],
};
export const GRAVEDAD = { 1: 'Insignificante', 2: 'Menor', 3: 'Moderada', 4: 'Importante', 5: 'Catastrófica' };
export const PROBABILIDAD = { 1: 'Muy improbable', 2: 'No es probable', 3: 'Posible', 4: 'Probable', 5: 'Muy probable' };
export const MONEDAS = ['CLP', 'USD', 'UM'];
const TOL = 1e-6;

// --------------------------------------------------------------------------
// Presets (mismo mapeo que backend/services/preset_loader.py)
// --------------------------------------------------------------------------
export const ESTADOS = ['Pendiente', 'En revisión', 'Aprobado', 'Rechazado'];

const dodDefaults = (d) => ({
  fecha_entrega: null,
  evidencia: '',
  estado: 'Pendiente',
  evidencia_registrada: [],
  aprobacion: null,
  comentario_revision: '',
  presupuesto: 0,
  inicio_semana_plan: null,
  fin_semana_plan: null,
  ...d,
});

/** Completa campos nuevos en proyectos guardados con versiones anteriores. */
export function normalizeProject(p) {
  return {
    ...p,
    dod: (p.dod ?? []).map(dodDefaults),
    raci: p.raci ?? {},
    riesgos: p.riesgos ?? [],
    kpis: (p.kpis ?? []).map((k) => ({ mediciones: [], ...k })),
    evm: { modo: 'manual', semana_corte: 0, registro_costos: [], bac: 0, pv: 0, ac: 0, porcentaje_avance: 0, unidad: 'UM', ...p.evm },
  };
}

export function presetToProject(p) {
  const paquetes = Object.fromEntries((p.evm.linea_base?.paquetes ?? []).map((pk) => [pk.entregable_codigo, pk]));
  return normalizeProject({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    fecha_inicio: null,
    equipo: p.roles.map((rol) => ({ rol, nombre: null })),
    // Inicio planificado = fin del entregable anterior (igual que preset_loader.py)
    dod: p.dod_items.map((d, i, arr) => {
      const fin = paquetes[d.codigo]?.fin_semana_plan ?? null;
      const finAnterior = arr.slice(0, i).map((x) => paquetes[x.codigo]?.fin_semana_plan).filter((v) => v != null).pop() ?? 0;
      return dodDefaults({
        ...d,
        presupuesto: paquetes[d.codigo]?.presupuesto ?? 0,
        inicio_semana_plan: fin != null ? finAnterior : null,
        fin_semana_plan: fin,
      });
    }),
    raci: structuredClone(p.raci_assignments),
    riesgos: structuredClone(p.risks),
    kpis: structuredClone(p.kpis),
    evm: {
      modo: 'linea_base',
      semana_corte: Number(p.evm.corte?.semana_corte) || 0,
      registro_costos: (p.evm.registro_costos ?? []).map(({ id, entregable_codigo, semana, importe, descripcion }) => ({ id, entregable_codigo, semana, importe, descripcion: descripcion ?? '' })),
      bac: 0, pv: 0, ac: 0, porcentaje_avance: 0,
      unidad: p.evm.unidad ?? 'UM',
    },
  });
}

export const BUNDLED_PRESETS = presetsData.presets.map(presetToProject);

export function emptyProject() {
  return {
    id: null,
    nombre: 'Nuevo proyecto',
    descripcion: '',
    fecha_inicio: null,
    equipo: [{ rol: 'Líder de Proyecto', nombre: null }],
    dod: [],
    raci: {},
    riesgos: [],
    kpis: [],
    evm: { modo: 'linea_base', semana_corte: 0, registro_costos: [], bac: 0, pv: 0, ac: 0, porcentaje_avance: 0, unidad: 'CLP' },
  };
}

// --------------------------------------------------------------------------
// Códigos correlativos
// --------------------------------------------------------------------------
export function nextCode(prefix, items) {
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const max = items.reduce((m, it) => {
    const g = re.exec(it.codigo ?? '');
    return g ? Math.max(m, Number(g[1])) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

// --------------------------------------------------------------------------
// Operaciones que mantienen las referencias cruzadas consistentes
// --------------------------------------------------------------------------
export function renameRole(p, oldRol, newRol) {
  const swap = (r) => (r === oldRol ? newRol : r);
  const raci = Object.fromEntries(
    Object.entries(p.raci).map(([cod, fila]) => [
      cod,
      Object.fromEntries(Object.entries(fila).map(([rol, v]) => [swap(rol), v])),
    ]),
  );
  return {
    ...p,
    equipo: p.equipo.map((m) => (m.rol === oldRol ? { ...m, rol: newRol } : m)),
    dod: p.dod.map((d) => ({ ...d, responsable: swap(d.responsable) })),
    raci,
    riesgos: p.riesgos.map((r) => ({ ...r, propietario: swap(r.propietario) })),
    kpis: p.kpis.map((k) => ({ ...k, responsable: swap(k.responsable) })),
  };
}

export function removeRole(p, rol) {
  const raci = Object.fromEntries(
    Object.entries(p.raci).map(([cod, fila]) => {
      const { [rol]: _, ...rest } = fila;
      return [cod, rest];
    }),
  );
  return { ...p, equipo: p.equipo.filter((m) => m.rol !== rol), raci };
}

export function addDod(p) {
  const codigo = nextCode('E', p.dod);
  const responsable = p.equipo[0]?.rol ?? '';
  return {
    ...p,
    dod: [...p.dod, dodDefaults({ codigo, entregable: 'Nuevo entregable', criterio_aceptacion: '', responsable })],
    // La fila RACI nace sincronizada: el responsable del DoD queda como R
    raci: { ...p.raci, [codigo]: responsable ? { [responsable]: 'R' } : {} },
  };
}

export function updateDod(p, index, patch) {
  const prev = p.dod[index];
  const next = { ...prev, ...patch };
  let { raci, riesgos } = p;
  if (patch.codigo !== undefined && patch.codigo !== prev.codigo) {
    raci = Object.fromEntries(Object.entries(raci).map(([c, f]) => [c === prev.codigo ? patch.codigo : c, f]));
    riesgos = riesgos.map((r) => ({
      ...r,
      entregables_afectados: (r.entregables_afectados ?? []).map((c) => (c === prev.codigo ? patch.codigo : c)),
    }));
  }
  if (!raci[next.codigo]) raci = { ...raci, [next.codigo]: {} };
  return { ...p, dod: p.dod.map((d, i) => (i === index ? next : d)), raci, riesgos };
}

export function removeDod(p, index) {
  const cod = p.dod[index].codigo;
  const { [cod]: _, ...raci } = p.raci;
  return {
    ...p,
    dod: p.dod.filter((_, i) => i !== index),
    raci,
    riesgos: p.riesgos.map((r) => ({ ...r, entregables_afectados: (r.entregables_afectados ?? []).filter((c) => c !== cod) })),
  };
}

// --------------------------------------------------------------------------
// Flujo de aprobación (Pendiente → En revisión → Aprobado / Rechazado)
// --------------------------------------------------------------------------
export function rolAccountable(p, codigo) {
  const a = Object.entries(p.raci[codigo] ?? {}).filter(([, v]) => v === 'A').map(([rol]) => rol);
  return a.length === 1 ? a[0] : null;
}

const patchDod = (p, codigo, fn) => ({ ...p, dod: p.dod.map((d) => (d.codigo === codigo ? fn(d) : d)) });

export const addEvidence = (p, codigo, ev) =>
  patchDod(p, codigo, (d) => ({ ...d, evidencia_registrada: [...d.evidencia_registrada, ev] }));

export const removeEvidence = (p, codigo, j) =>
  patchDod(p, codigo, (d) => ({ ...d, evidencia_registrada: d.evidencia_registrada.filter((_, k) => k !== j) }));

export const sendToReview = (p, codigo) =>
  patchDod(p, codigo, (d) => ({ ...d, estado: 'En revisión' }));

export const approveDod = (p, codigo, { semana, comentario }) =>
  patchDod(p, codigo, (d) => ({
    ...d,
    estado: 'Aprobado',
    comentario_revision: '',
    aprobacion: { rol_aprobador: rolAccountable(p, codigo), semana_aprobacion: semana, fecha: new Date().toISOString().slice(0, 10), comentario: comentario ?? '' },
  }));

export const rejectDod = (p, codigo, motivo) =>
  patchDod(p, codigo, (d) => ({ ...d, estado: 'Rechazado', aprobacion: null, comentario_revision: motivo }));

export const reopenDod = (p, codigo) =>
  patchDod(p, codigo, (d) => ({ ...d, estado: 'Pendiente', aprobacion: null }));

// --------------------------------------------------------------------------
// KPIs: mediciones, meta numérica y semáforo (igual que pmbok_validator.py)
// --------------------------------------------------------------------------
const parseNum = (s) => {
  let t = String(s).trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export function metaNumerica(p, k, semana) {
  const m = k.meta;
  if (m == null) return null;
  if (typeof m === 'string') {
    const g = /(>=|<=|≥|≤)\s*(-?[\d.,]+)/.exec(m);
    if (!g) return null;
    const v = parseNum(g[2]);
    return v == null ? null : { op: g[1] === '>=' || g[1] === '≥' ? '>=' : '<=', valor: v };
  }
  if (m.tipo === 'Minimo' && m.valor != null) return { op: '>=', valor: m.valor };
  if (m.tipo === 'Maximo' && m.valor != null) return { op: '<=', valor: m.valor };
  if (m.tipo === 'Minimo_referenciado' && m.referencia) {
    const planificados = p.dod.filter((d) => d.fin_semana_plan != null && d.fin_semana_plan <= semana);
    if (m.referencia.trim().toUpperCase() === 'PV') return { op: '>=', valor: planificados.reduce((s, d) => s + (Number(d.presupuesto) || 0), 0) };
    if (m.referencia.includes('entregables_planificados_acumulados') && p.dod.length)
      return { op: '>=', valor: (100 * planificados.length) / p.dod.length };
  }
  return null;
}

export function evaluarMedicion(p, k, med) {
  const meta = metaNumerica(p, k, med.semana);
  if (!meta) return { estado: 'sin_meta', meta: null };
  const { op, valor } = meta;
  const cumple = op === '>=' ? med.valor >= valor - TOL : med.valor <= valor + TOL;
  const riesgo = op === '>=' ? med.valor >= 0.9 * valor : med.valor <= 1.1 * valor;
  return { estado: cumple ? 'cumple' : riesgo ? 'en_riesgo' : 'no_cumple', meta };
}

export function evaluarKPI(p, k) {
  const meds = k.mediciones ?? [];
  if (!meds.length) return { estado: 'sin_datos', ultima: null, meta: null };
  const ultima = meds.reduce((a, b) => (b.semana >= a.semana ? b : a));
  return { ...evaluarMedicion(p, k, ultima), ultima };
}

const norm = (s) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Valor calculable desde el propio proyecto para los KPIs base, en la semana de corte. */
export function medicionAutomatica(p, k) {
  if (p.evm.modo !== 'linea_base') return null;
  const corte = p.evm.semana_corte;
  const r = calcEVM(resolveEVM(p));
  const n = norm(k.nombre);
  if (n === 'ev' || n.startsWith('valor ganado')) return r.ev;
  if (n === 'spi' || n.includes('desempeno de cronograma')) return r.spi;
  if (n === 'cpi' || n.includes('desempeno de costo')) return r.cpi;
  if (n.startsWith('entregable aprobado') || n.startsWith('entregables aprobados'))
    return p.dod.length ? (100 * p.dod.filter((d) => aprobadoAlCorte(d, corte)).length) / p.dod.length : null;
  if (n.startsWith('cumplimiento del cronograma')) {
    const vencidos = p.dod.filter((d) => d.fin_semana_plan != null && d.fin_semana_plan <= corte);
    if (!vencidos.length) return null;
    const aTiempo = vencidos.filter((d) => aprobadoAlCorte(d, corte) && d.aprobacion.semana_aprobacion <= d.fin_semana_plan);
    return (100 * aTiempo.length) / vencidos.length;
  }
  return null;
}

export function addMedicion(p, codigo, med) {
  return {
    ...p,
    kpis: p.kpis.map((k) => {
      if (k.codigo !== codigo) return k;
      const mediciones = [...(k.mediciones ?? []).filter((m) => m.semana !== med.semana), med].sort((a, b) => a.semana - b.semana);
      return { ...k, mediciones, valor_actual: mediciones[mediciones.length - 1].valor };
    }),
  };
}

export function removeMedicion(p, codigo, semana) {
  return {
    ...p,
    kpis: p.kpis.map((k) => {
      if (k.codigo !== codigo) return k;
      const mediciones = (k.mediciones ?? []).filter((m) => m.semana !== semana);
      return { ...k, mediciones, valor_actual: mediciones.length ? mediciones[mediciones.length - 1].valor : null };
    }),
  };
}

// --------------------------------------------------------------------------
// Registro de costos
// --------------------------------------------------------------------------
export function addCost(p, cost) {
  const n = p.evm.registro_costos.reduce((m, c) => Math.max(m, Number(/^C(\d+)$/.exec(c.id)?.[1] ?? 0)), 0);
  return { ...p, evm: { ...p.evm, registro_costos: [...p.evm.registro_costos, { id: `C${n + 1}`, descripcion: '', ...cost }] } };
}

export const removeCost = (p, id) =>
  ({ ...p, evm: { ...p.evm, registro_costos: p.evm.registro_costos.filter((c) => c.id !== id) } });

export function cycleRaci(p, codigo, rol) {
  const fila = p.raci[codigo] ?? {};
  const actual = fila[rol] ?? '';
  const sig = RACI_CYCLE[(RACI_CYCLE.indexOf(actual) + 1) % RACI_CYCLE.length];
  return { ...p, raci: { ...p.raci, [codigo]: { ...fila, [rol]: sig } } };
}

// --------------------------------------------------------------------------
// Riesgos
// --------------------------------------------------------------------------
export const riskScore = (r) => r.gravedad * r.probabilidad;

export function riskLevel(score) {
  if (score <= 6) return 'Bajo';
  if (score <= 12) return 'Medio';
  return 'Alto';
}

// --------------------------------------------------------------------------
// RACI
// --------------------------------------------------------------------------
export function raciRowStatus(fila = {}, roles) {
  const vals = roles.map((r) => fila[r] ?? '');
  const a = vals.filter((v) => v === 'A').length;
  const r = vals.filter((v) => v === 'R').length;
  if (a !== 1 || r === 0) {
    const msgs = [];
    if (a === 0) msgs.push('Falta A');
    if (a > 1) msgs.push(`${a} A`);
    if (r === 0) msgs.push('Falta R');
    return { level: 'bad', label: msgs.join(' · '), a, r };
  }
  if (r > 1) return { level: 'warn', label: `${r} R`, a, r };
  return { level: 'ok', label: 'OK', a, r };
}

// --------------------------------------------------------------------------
// EVM
// --------------------------------------------------------------------------
const div = (a, b) => (Math.abs(b) > TOL ? a / b : null);

export const aprobadoAlCorte = (d, corte) =>
  d.estado === 'Aprobado' && d.aprobacion != null && d.aprobacion.semana_aprobacion <= corte;

/** Igual que pmbok_validator.resolver_evm: en modo línea base deriva BAC/PV/AC/% avance. */
export function resolveEVM(p) {
  const evm = p.evm;
  if (evm.modo !== 'linea_base') return evm;
  const corte = evm.semana_corte;
  const bac = p.dod.reduce((s, d) => s + (Number(d.presupuesto) || 0), 0);
  const pv = p.dod.reduce((s, d) => s + (d.fin_semana_plan != null && d.fin_semana_plan <= corte ? Number(d.presupuesto) || 0 : 0), 0);
  const ev = p.dod.reduce((s, d) => s + (aprobadoAlCorte(d, corte) ? Number(d.presupuesto) || 0 : 0), 0);
  const ac = evm.registro_costos.reduce((s, c) => s + (c.semana <= corte ? Number(c.importe) || 0 : 0), 0);
  return { ...evm, bac, pv, ac, porcentaje_avance: bac > TOL ? (ev / bac) * 100 : 0 };
}

/**
 * Serie semanal para la curva S (modo línea base). PV se proyecta hasta el final
 * del plan; EV y AC son datos reales y solo existen hasta la semana de corte.
 */
export function serieSemanal(p) {
  const corte = p.evm.semana_corte;
  const ultima = Math.max(
    1, corte,
    ...p.dod.map((d) => d.fin_semana_plan ?? 0),
    ...p.evm.registro_costos.map((c) => c.semana),
  );
  const bac = p.dod.reduce((s, d) => s + (Number(d.presupuesto) || 0), 0);
  const out = [];
  for (let w = 0; w <= ultima; w++) {
    const pv = p.dod.reduce((s, d) => s + (d.fin_semana_plan != null && d.fin_semana_plan <= w ? Number(d.presupuesto) || 0 : 0), 0);
    const real = w <= corte;
    const ev = real ? p.dod.reduce((s, d) => s + (aprobadoAlCorte(d, w) ? Number(d.presupuesto) || 0 : 0), 0) : null;
    const ac = real ? p.evm.registro_costos.reduce((s, c) => s + (c.semana <= w ? Number(c.importe) || 0 : 0), 0) : null;
    out.push({ semana: w, pv, ev, ac, spi: real ? div(ev, pv) : null, cpi: real ? div(ev, ac) : null });
  }
  return { bac, corte, ultima, puntos: out };
}

export function calcEVM({ bac, pv, ac, porcentaje_avance }) {
  const ev = (porcentaje_avance / 100) * bac;
  const spi = div(ev, pv);
  const cpi = div(ev, ac);
  const eac = cpi ? bac / cpi : null;
  return { ev, sv: ev - pv, cv: ev - ac, spi, cpi, eac, etc: eac != null ? eac - ac : null, vac: eac != null ? bac - eac : null };
}

// --------------------------------------------------------------------------
// Validación global (mismos códigos que el backend)
// --------------------------------------------------------------------------
const fmt = (v) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v);
const dups = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

export function validateProject(p) {
  const out = [];
  const add = (severity, section, code, message, ref = null) => out.push({ severity, section, code, message, ref });
  const roles = p.equipo.map((m) => m.rol);
  const rolesSet = new Set(roles);
  const dodCodes = new Set(p.dod.map((d) => d.codigo));

  dups(roles).forEach((r) => add('error', 'equipo', 'EQ-01', `El rol '${r}' está repetido.`, r));
  if (roles.some((r) => !r.trim())) add('error', 'equipo', 'EQ-02', 'Hay un integrante sin rol.');

  dups(p.dod.map((d) => d.codigo)).forEach((c) => add('error', 'dod', 'DOD-01', `Código de entregable duplicado: ${c}.`, c));
  if (!p.dod.length) add('warning', 'dod', 'DOD-02', 'El proyecto no tiene entregables definidos.');
  p.dod.forEach((d) => {
    if (!rolesSet.has(d.responsable)) add('error', 'dod', 'DOD-03', `${d.codigo}: el responsable '${d.responsable}' no pertenece al equipo.`, d.codigo);
    if (!d.evidencia?.trim()) add('warning', 'dod', 'DOD-04', `${d.codigo}: falta la evidencia/comprobación esperada.`, d.codigo);
  });

  Object.keys(p.raci).forEach((c) => {
    if (!dodCodes.has(c)) add('error', 'raci', 'RACI-01', `La actividad RACI '${c}' no corresponde a ningún entregable.`, c);
  });
  const rCount = {};
  const asignados = new Set();
  p.dod.forEach((d) => {
    const fila = p.raci[d.codigo];
    if (!fila) return add('error', 'raci', 'RACI-02', `${d.codigo} no tiene asignaciones RACI.`, d.codigo);
    Object.keys(fila).forEach((rol) => {
      if (!rolesSet.has(rol)) add('error', 'raci', 'RACI-03', `${d.codigo}: el rol '${rol}' no pertenece al equipo.`, d.codigo);
    });
    roles.forEach((rol) => {
      if (fila[rol]) asignados.add(rol);
      if (fila[rol] === 'R') rCount[rol] = (rCount[rol] ?? 0) + 1;
    });
    const st = raciRowStatus(fila, roles);
    if (st.a !== 1) add('error', 'raci', 'RACI-04', `${d.codigo}: debe tener exactamente un 'A' (tiene ${st.a}).`, d.codigo);
    if (st.r === 0) add('error', 'raci', 'RACI-05', `${d.codigo}: debe tener al menos un 'R'.`, d.codigo);
    else if (st.r > 1) add('warning', 'raci', 'RACI-06', `${d.codigo}: tiene ${st.r} 'R'; se recomienda uno solo.`, d.codigo);
    if (rolesSet.has(d.responsable) && fila[d.responsable] !== 'R')
      add('error', 'raci', 'RACI-07', `${d.codigo}: el responsable del DoD ('${d.responsable}') debe ser 'R' en la RACI.`, d.codigo);
  });
  const total = Object.keys(p.raci).length;
  Object.entries(rCount).forEach(([rol, n]) => {
    if (total && n / total > 0.5 + TOL) add('warning', 'raci', 'RACI-08', `'${rol}' es R en ${n} de ${total} entregables (>50%).`, rol);
  });
  roles.forEach((rol) => {
    if (p.dod.length && !asignados.has(rol)) add('warning', 'raci', 'RACI-09', `'${rol}' no tiene asignaciones en la RACI.`, rol);
  });

  dups(p.riesgos.map((r) => r.codigo)).forEach((c) => add('error', 'riesgos', 'RSK-01', `Código de riesgo duplicado: ${c}.`, c));
  p.riesgos.forEach((r) => {
    if (!rolesSet.has(r.propietario)) add('error', 'riesgos', 'RSK-02', `${r.codigo}: el propietario '${r.propietario}' no pertenece al equipo.`, r.codigo);
    if (!ESTRATEGIAS[r.tipo]?.includes(r.tipo_estrategia))
      add('error', 'riesgos', 'RSK-03', `${r.codigo}: '${r.tipo_estrategia}' no es válida para ${r.tipo}.`, r.codigo);
    (r.entregables_afectados ?? []).forEach((c) => {
      if (!dodCodes.has(c)) add('error', 'riesgos', 'RSK-04', `${r.codigo}: el entregable '${c}' no existe.`, r.codigo);
    });
    if (r.tipo === 'Amenaza' && riskLevel(riskScore(r)) === 'Alto' && r.tipo_estrategia === 'Aceptar' && !r.justificacion_aceptacion)
      add('warning', 'riesgos', 'RSK-05', `${r.codigo}: amenaza Alta aceptada sin justificación.`, r.codigo);
  });

  dups(p.kpis.map((k) => k.codigo)).forEach((c) => add('error', 'kpis', 'KPI-01', `Código de KPI duplicado: ${c}.`, c));
  p.kpis.forEach((k) => {
    if (!rolesSet.has(k.responsable)) add('error', 'kpis', 'KPI-02', `${k.codigo}: el responsable '${k.responsable}' no pertenece al equipo.`, k.codigo);
  });
  if (p.kpis.length && !p.kpis.some((k) => k.tipo_indicador === 'Adelantado'))
    add('warning', 'kpis', 'KPI-03', 'Todos los KPIs son rezagados; considera al menos un indicador adelantado.');
  p.kpis.forEach((k) => {
    const ev = evaluarKPI(p, k);
    if (ev.estado === 'no_cumple')
      add('warning', 'kpis', 'KPI-04', `${k.codigo} (${k.nombre}): la última medición (${fmt(ev.ultima.valor)}) no cumple la meta (${fmt(ev.meta.valor)}).`, k.codigo);
    if (p.evm.modo === 'linea_base' && (k.mediciones ?? []).some((m) => m.semana > p.evm.semana_corte))
      add('warning', 'kpis', 'KPI-05', `${k.codigo}: tiene mediciones posteriores a la semana de corte.`, k.codigo);
  });

  p.dod.forEach((d) => {
    if (d.inicio_semana_plan != null && d.fin_semana_plan != null && d.inicio_semana_plan > d.fin_semana_plan)
      add('error', 'dod', 'CRO-01', `${d.codigo}: la semana de inicio (${d.inicio_semana_plan}) es posterior a la de fin (${d.fin_semana_plan}).`, d.codigo);
    if (p.evm.modo === 'linea_base' && d.fin_semana_plan != null && d.fin_semana_plan <= p.evm.semana_corte && !aprobadoAlCorte(d, p.evm.semana_corte))
      add('warning', 'dod', 'CRO-02', `${d.codigo}: debía terminar en la semana ${d.fin_semana_plan} y no está aprobado al corte.`, d.codigo);
  });

  const corte = p.evm.semana_corte;
  const lineaBase = p.evm.modo === 'linea_base';
  p.dod.forEach((d) => {
    if ((d.estado === 'En revisión' || d.estado === 'Aprobado') && !d.evidencia_registrada?.length)
      add('error', 'dod', 'APR-01', `${d.codigo}: está '${d.estado}' sin evidencia registrada.`, d.codigo);
    if (d.estado === 'Aprobado') {
      if (!d.aprobacion) return add('error', 'dod', 'APR-02', `${d.codigo}: está Aprobado pero no tiene registro de aprobación.`, d.codigo);
      const rolA = rolAccountable(p, d.codigo);
      if (rolA && d.aprobacion.rol_aprobador !== rolA)
        add('error', 'dod', 'APR-03', `${d.codigo}: lo aprobó '${d.aprobacion.rol_aprobador}', pero el aprobador según la RACI es '${rolA}'.`, d.codigo);
      if (lineaBase && d.aprobacion.semana_aprobacion > corte)
        add('error', 'dod', 'APR-04', `${d.codigo}: semana de aprobación ${d.aprobacion.semana_aprobacion} posterior al corte (semana ${corte}).`, d.codigo);
    } else if (d.aprobacion) {
      add('warning', 'dod', 'APR-05', `${d.codigo}: tiene aprobación registrada pero su estado es '${d.estado}'.`, d.codigo);
    }
    if (d.estado === 'Rechazado' && !d.comentario_revision) add('warning', 'dod', 'APR-06', `${d.codigo}: rechazado sin indicar el motivo.`, d.codigo);
  });

  const efectivo = resolveEVM(p);
  if (lineaBase) {
    if (efectivo.bac <= TOL) add('error', 'evm', 'EVM-01', 'BAC = 0: asigna presupuesto a los entregables de la línea base.');
    p.dod.forEach((d) => {
      if (!(Number(d.presupuesto) > TOL)) add('warning', 'evm', 'EVM-07', `${d.codigo}: sin presupuesto en la línea base.`, d.codigo);
      if (d.fin_semana_plan == null) add('warning', 'evm', 'EVM-08', `${d.codigo}: sin semana de fin planificada; no suma al PV.`, d.codigo);
    });
    p.evm.registro_costos.forEach((c) => {
      if (!dodCodes.has(c.entregable_codigo)) add('error', 'evm', 'EVM-09', `Costo ${c.id}: el entregable '${c.entregable_codigo}' no existe.`, c.id);
    });
  } else {
    if (efectivo.bac <= TOL) add('error', 'evm', 'EVM-01', 'El presupuesto total (BAC) debe ser mayor que 0.');
    if (efectivo.pv > efectivo.bac + TOL) add('error', 'evm', 'EVM-02', 'PV no puede superar el BAC.');
  }
  const evm = calcEVM(efectivo);
  if (evm.spi != null && evm.spi < 1 - TOL) add('warning', 'evm', 'EVM-04', `SPI = ${evm.spi.toFixed(2)}: el proyecto va atrasado.`);
  if (evm.cpi != null && evm.cpi < 1 - TOL) add('warning', 'evm', 'EVM-06', `CPI = ${evm.cpi.toFixed(2)}: hay sobrecosto.`);

  return out;
}

// --------------------------------------------------------------------------
// Formato
// --------------------------------------------------------------------------
export function formatMoney(v, unidad) {
  if (v == null || Number.isNaN(v)) return '—';
  if (unidad === 'CLP' || unidad === 'USD') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: unidad, maximumFractionDigits: unidad === 'CLP' ? 0 : 2 }).format(v);
  }
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v)} ${unidad || ''}`.trim();
}

const num = (v) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v);

/** Igual que excel_exporter._meta_kpi: convierte la meta estructurada en texto. */
export function formatMeta(k) {
  const m = k.meta;
  if (m == null) return '';
  if (typeof m === 'string') return m;
  const u = k.unidad ? ` ${k.unidad}` : '';
  let t;
  if (m.tipo === 'Minimo' && m.valor != null) t = `>= ${num(m.valor)}${u}`;
  else if (m.tipo === 'Maximo' && m.valor != null) t = `<= ${num(m.valor)}${u}`;
  else if (m.tipo === 'Minimo_referenciado' && m.referencia) t = `>= ${m.referencia}`;
  else if (m.tipo === 'Referencia_inicial' && m.valor != null) t = `${num(m.valor)}${u} (referencia inicial)`;
  else t = `${m.tipo.replace(/_/g, ' ')}${m.valor != null ? `: ${num(m.valor)}${u}` : ''}`;
  if (m.meta_cierre != null) t += `; al cierre: ${num(m.meta_cierre)}${u}`;
  return t;
}

export const kpiMetodo = (k) => k.metodo_medicion ?? k.formula ?? '';

/** Limpia el estado antes de enviarlo al backend (fechas vacías → null). */
export function toPayload(p) {
  const fecha = (v) => (v ? v : null);
  return {
    ...p,
    evm: { ...p.evm, registro_costos: p.evm.registro_costos.map((c) => ({ ...c, semana: Number(c.semana) || 0, importe: Number(c.importe) || 0 })) },
    fecha_inicio: fecha(p.fecha_inicio),
    dod: p.dod.map((d) => ({ ...d, fecha_entrega: fecha(d.fecha_entrega) })),
    riesgos: p.riesgos.map((r) => ({ ...r, fecha_revision: fecha(r.fecha_revision) })),
    equipo: p.equipo.map((m) => ({ ...m, nombre: m.nombre?.trim() ? m.nombre : null })),
  };
}
