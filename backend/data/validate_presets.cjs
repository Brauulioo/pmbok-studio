const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const raw = fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8');
assert.notEqual(raw.charCodeAt(0), 0xFEFF, 'UTF-8 sin BOM');
const data = JSON.parse(raw);
const requiredKpis = ['Velocidad de Desarrollo','Cumplimiento del Cronograma','EV','SPI','CPI','Entregable Aprobado','Satisfacción del Cliente'];
const codes = ['E1','E2','E3','E4','E5','E6'];
assert.equal(data.presets.length, 3);
assert.equal(new Set(data.presets.map(p => p.id)).size, 3);
for (const p of data.presets) {
  const roles = p.roles;
  assert.equal(roles.length, 5);
  assert.equal(new Set(roles).size, 5);
  assert.deepEqual(p.dod_items.map(d => d.codigo), codes);
  assert.deepEqual(Object.keys(p.raci_assignments).sort(), codes);
  const rCounts = Object.fromEntries(roles.map(r=>[r,0]));
  for (const d of p.dod_items) {
    for (const field of ['codigo','entregable','criterio_aceptacion','responsable','evidencia']) assert.ok(typeof d[field] === 'string' && d[field].trim(), field);
    const row = p.raci_assignments[d.codigo];
    assert.deepEqual(Object.keys(row).sort(), [...roles].sort());
    assert.ok(Object.values(row).every(v => ['R','A','C','I'].includes(v)));
    assert.equal(Object.values(row).filter(v=>v==='A').length, 1);
    assert.equal(Object.values(row).filter(v=>v==='R').length, 1);
    assert.equal(row[d.responsable], 'R');
    rCounts[d.responsable]++;
    assert.equal(d.estado, 'Pendiente');
    assert.equal(d.aprobacion, null);
    assert.deepEqual(d.evidencia_registrada, []);
  }
  assert.ok(Math.max(...Object.values(rCounts)) <= 3, 'Sin concentración R >50%');
  assert.deepEqual(p.risks.map(r => r.codigo), ['R1','R2','R3','R4']);
  assert.equal(p.risks.filter(r=>r.tipo==='Amenaza').length, 3);
  assert.equal(p.risks.filter(r=>r.tipo==='Oportunidad').length, 1);
  for (const r of p.risks) {
    assert.ok(Number.isInteger(r.gravedad) && r.gravedad >= 1 && r.gravedad <= 5);
    assert.ok(Number.isInteger(r.probabilidad) && r.probabilidad >= 1 && r.probabilidad <= 5);
    assert.ok(data.politica_riesgos.estrategias_permitidas[r.tipo].includes(r.tipo_estrategia));
    assert.ok(roles.includes(r.propietario));
    assert.ok(r.descripcion && r.estrategia && r.disparador);
    assert.ok(r.entregables_afectados.length && r.entregables_afectados.every(c=>codes.includes(c)));
  }
  assert.deepEqual(p.kpis.map(k=>k.codigo), ['K1','K2','K3','K4','K5','K6','K7']);
  assert.deepEqual(p.kpis.map(k=>k.nombre), requiredKpis);
  for (const k of p.kpis) {
    assert.ok(roles.includes(k.responsable));
    for (const f of ['definicion','formula','unidad','fuente','frecuencia']) assert.ok(k[f]);
    assert.ok(k.meta.tipo);
    assert.equal(k.tipo_indicador, 'Rezagado');
    assert.equal(k.valor_actual, null);
  }
  assert.equal(p.advertencias_iniciales_esperadas.length, 1);
  assert.equal(p.sugerencia_indicador_adelantado.incluido_en_kpis_base, false);
  const evm = p.evm, base = evm.linea_base;
  assert.deepEqual(base.paquetes.map(a=>a.entregable_codigo), codes);
  assert.ok(base.paquetes.every(a=>a.presupuesto > 0 && a.fin_semana_plan > 0 && a.fin_semana_plan <= p.configuracion_proyecto.duracion_semanas));
  assert.equal(base.BAC, base.paquetes.reduce((s,a)=>s+a.presupuesto,0));
  assert.deepEqual([evm.corte.EV,evm.corte.PV,evm.corte.AC], [0,0,0]);
  assert.deepEqual([evm.corte.SPI,evm.corte.CPI], [null,null]);
  console.log(`${p.id}: OK; roles=5, DoD=6, RACI=6x5, riesgos=3+1, KPIs=7, BAC=${base.BAC} UM`);
}
// Sanidad del contrato de medición: avance ponderado, inicialización y cierre.
const base = data.presets[0].evm.linea_base;
const calculate = (week, approved, AC) => {
  const PV = base.paquetes.filter(p=>p.fin_semana_plan<=week).reduce((s,p)=>s+p.presupuesto,0);
  const EV = base.paquetes.filter(p=>approved.includes(p.entregable_codigo)).reduce((s,p)=>s+p.presupuesto,0);
  return {EV,PV,AC,SPI:PV>0?EV/PV:null,CPI:AC>0?EV/AC:null};
};
assert.deepEqual(calculate(0,[],0), {EV:0,PV:0,AC:0,SPI:null,CPI:null});
assert.deepEqual(calculate(4,['E1'],1250), {EV:1000,PV:2500,AC:1250,SPI:0.4,CPI:0.8});
assert.equal(calculate(12,codes,11000).SPI,1);
assert.ok(calculate(12,codes,11000).CPI < 1);
assert.equal(calculate(0,['E1'],0).SPI,null);
assert.equal(calculate(0,['E1'],0).CPI,null);
console.log('Escenarios EVM: inicio, atraso, sobrecosto y denominadores cero: OK.');
console.log('Validación completa: sin errores de estructura o referencias; KPI-03 esperado en los 3 presets.');
