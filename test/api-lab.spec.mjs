// API del laboratorio, parte de F2/F3 (spec/08 §1, §4, §7): catálogo, plantillas, redes (CRUD,
// validar, exportar/importar) y su aparición en /api/agents. Escrito ANTES del código y congelado.
// Uso: node test/api-lab.spec.mjs http://localhost:8791   (el servidor de la batería, con GW_EVO_DIR temporal)
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const api = async (p, method = 'GET', body = undefined, raw = false) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no json */ }
  return { status: res.status, body: json, text, headers: res.headers };
};
const { TEMPLATES } = await import('../shared/templates.js');
const { BLOCKS } = await import('../shared/genome.js');
const clone = (v) => JSON.parse(JSON.stringify(v));

await check('GET /api/lab/catalog: bloques, ojos con layout, familias, rasgos, recompensa, aprendizaje, límites, niveles', async () => {
  const r = await api('/api/lab/catalog');
  assert.equal(r.status, 200);
  const c = r.body;
  assert.equal(c.blocks.length, 26);
  for (const b of c.blocks) assert.ok(b.type && b.name && b.icon && b.group && b.level && b.explain && b.example && Array.isArray(b.params) && b.streams, b.type);
  const dense = c.blocks.find((b) => b.type === 'dense');
  assert.deepEqual(dense.params.map((p) => p.key), ['units', 'activation']);
  assert.equal(dense.params[0].max, 512);
  assert.ok(dense.params[1].options.some((o) => o.value === 'gelu' && o.explain));
  assert.equal(c.eyes.length, 10);
  const feats = c.eyes.find((e) => e.type === 'eye.features');
  assert.equal(feats.layout.length, 26); assert.equal(feats.layout[0].name, 'mi x');
  assert.equal(c.eyes.find((e) => e.type === 'eye.map').layout.length, 4 * 15 * 25, 'layout del mapa con parámetros por defecto');
  assert.deepEqual(c.families.map((f) => f.id), ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild']);
  for (const f of c.families) assert.ok(f.name && f.explain && Array.isArray(f.params));
  assert.deepEqual(c.traits.map((t) => t.key), ['temperature', 'pulse', 'teamSpirit', 'character']);
  for (const t of c.traits) assert.ok(t.name && t.explain && t.example && t.level);
  assert.equal(c.rewardTerms.length, 11);
  for (const t of c.rewardTerms) assert.ok(t.key && t.name && t.explain && t.personality && t.min === -5 && t.max === 5 && typeof t.default === 'number');
  assert.ok(c.learning.length >= 15 && c.learning.every((l) => l.key && l.name && l.explain && l.level));
  assert.ok(c.learning.some((l) => l.key === 'gradient.lr' && l.min === 1e-5 && l.max === 0.1 && l.default === 0.003));
  assert.ok(Array.isArray(c.mutation));
  assert.equal(c.limits.blocks, 64); assert.equal(c.limits.candidatesMax, 64);
  assert.deepEqual(c.levels, ['aprendiz', 'artesano', 'cientifico']);
  assert.ok(Object.keys(BLOCKS).every((t) => c.blocks.some((b) => b.type === t)));
});

await check('GET /api/lab/templates: las 4 con nombre, por qué y genoma válido', async () => {
  const r = await api('/api/lab/templates');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((t) => t.key).sort(), ['empty', 'seer', 'sniper', 'turtle']);
  for (const t of r.body) assert.ok(t.name && t.why && t.genome && t.genome.blocks.length && t.paramCount > 0);
});

let createdId = null;
await check('POST /api/lab/nets desde plantilla: 201, id derivado del nombre, único; genoma propio; inválido → 400', async () => {
  const r = await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Mi Vidente' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.id, 'mi-vidente'); assert.equal(r.body.genome.name, 'Mi Vidente'); assert.ok(r.body.genome.blocks.length > 0);
  createdId = r.body.id;
  const r2 = await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Mi Vidente' });
  assert.equal(r2.status, 201); assert.equal(r2.body.id, 'mi-vidente-2', 'nombre repetido → sufijo');
  const custom = { ...clone(TEMPLATES.empty.genome), id: 'propia-1', name: 'Propia' };
  const r3 = await api('/api/lab/nets', 'POST', { genome: custom });
  assert.equal(r3.status, 201); assert.equal(r3.body.id, 'propia-1');
  const bad = await api('/api/lab/nets', 'POST', { genome: { ...custom, id: 'mala-1', blocks: 'x' } });
  assert.equal(bad.status, 400); assert.ok(Array.isArray(bad.body.errors) && bad.body.errors[0].code);
  const noTpl = await api('/api/lab/nets', 'POST', { template: 'inexistente', name: 'x' });
  assert.equal(noTpl.status, 400);
  const noName = await api('/api/lab/nets', 'POST', { template: 'empty' });
  assert.equal(noName.status, 201); assert.ok(/^vacia|^empty|^red/.test(noName.body.id), 'sin nombre: id a partir de la plantilla: ' + noName.body.id);
});

await check('GET /api/lab/nets y /:id: listado con campos, detalle con paramCount y avisos; 404', async () => {
  const list = await api('/api/lab/nets');
  assert.equal(list.status, 200);
  const e = list.body.nets.find((n) => n.id === createdId);
  assert.ok(e, 'aparece'); assert.equal(e.name, 'Mi Vidente');
  for (const k of ['emblem', 'traits', 'stats', 'generation', 'paramCount', 'blocks', 'updatedAt', 'isQueen', 'training']) assert.ok(k in e, k);
  assert.equal(e.isQueen, false); assert.equal(e.training, false);
  const one = await api(`/api/lab/nets/${createdId}`);
  assert.equal(one.status, 200); assert.equal(one.body.genome.id, createdId); assert.ok(one.body.paramCount > 0 && Array.isArray(one.body.warnings));
  assert.equal((await api('/api/lab/nets/no-existe')).status, 404);
  assert.equal((await api('/api/lab/nets/Mal%20Id')).status, 404);
});

await check('PUT /api/lab/nets/:id: guarda un genoma completo válido; inválido → 400; id distinto → 400', async () => {
  const one = (await api(`/api/lab/nets/${createdId}`)).body.genome;
  const g = { ...one, name: 'Vidente editada', traits: { ...one.traits, temperature: 0.5 } };
  const r = await api(`/api/lab/nets/${createdId}`, 'PUT', g);
  assert.equal(r.status, 200, r.text); assert.equal(r.body.ok, true); assert.ok(Array.isArray(r.body.warnings));
  const back = (await api(`/api/lab/nets/${createdId}`)).body.genome;
  assert.equal(back.name, 'Vidente editada'); assert.equal(back.traits.temperature, 0.5);
  const bad = await api(`/api/lab/nets/${createdId}`, 'PUT', { ...g, traits: { temperature: 99 } });
  assert.equal(bad.status, 400); assert.ok(bad.body.errors.some((e) => e.code === 'traits'));
  const mismatch = await api(`/api/lab/nets/${createdId}`, 'PUT', { ...g, id: 'otro-id' });
  assert.equal(mismatch.status, 400);
  assert.equal((await api('/api/lab/nets/no-existe', 'PUT', g)).status, 404);
});

await check('POST /api/lab/nets/:id/validate: no guarda, devuelve errores/avisos/paramCount', async () => {
  const one = (await api(`/api/lab/nets/${createdId}`)).body.genome;
  const r = await api(`/api/lab/nets/${createdId}/validate`, 'POST', { ...one, name: 'No guardada' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.ok(r.body.paramCount > 0 && Array.isArray(r.body.warnings) && Array.isArray(r.body.errors));
  assert.equal((await api(`/api/lab/nets/${createdId}`)).body.genome.name, 'Vidente editada', 'validate no guarda');
  const bad = await api(`/api/lab/nets/${createdId}/validate`, 'POST', { ...one, blocks: [...one.blocks, { id: 'z', type: 'eye.laser', params: {} }] });
  assert.equal(bad.status, 200); assert.equal(bad.body.ok, false); assert.ok(bad.body.errors.some((e) => e.code === 'block-type' && e.message && e.example));
});

await check('export / import: descarga, 409 si existe, ?rename=1, inválido → 400 (nunca 500), cuerpo enorme → 400', async () => {
  const ex = await api(`/api/lab/nets/${createdId}/export`);
  assert.equal(ex.status, 200); assert.equal(ex.body.id, createdId);
  assert.ok(/attachment/.test(ex.headers.get('content-disposition') || ''));
  const dup = await api('/api/lab/nets/import', 'POST', ex.body);
  assert.equal(dup.status, 409);
  const ren = await api('/api/lab/nets/import?rename=1', 'POST', ex.body);
  assert.equal(ren.status, 201); assert.notEqual(ren.body.id, createdId); assert.ok(ren.body.id.startsWith(createdId));
  const fresh = await api('/api/lab/nets/import', 'POST', { ...ex.body, id: 'importada-1', name: 'Importada' });
  assert.equal(fresh.status, 201); assert.equal(fresh.body.id, 'importada-1');
  const bad = await api('/api/lab/nets/import', 'POST', { ...ex.body, id: 'rota-9', wires: [{ from: 'nadie', to: 'nadie' }] });
  assert.equal(bad.status, 400); assert.ok(bad.body.errors.some((e) => e.code === 'wire-ref'));
  const notJson = await api('/api/lab/nets/import', 'POST', '{ esto no es json', true);
  assert.equal(notJson.status, 400);
  const huge = await api('/api/lab/nets/import', 'POST', 'x'.repeat(2 * 1024 * 1024), true);
  assert.ok(huge.status === 400 || huge.status === 413, String(huge.status));
  const health = await api('/api/health');
  assert.equal(health.status, 200, 'el servidor sigue vivo');
});

await check('/api/agents lista las redes guardadas como net:<id>; DELETE y 404 después', async () => {
  const agents = (await api('/api/agents')).body.agents;
  const a = agents.find((x) => x.id === `net:${createdId}`);
  assert.ok(a && a.net === true && a.netId === createdId && a.name === 'Vidente editada' && a.icon === '🧠');
  const del = await api(`/api/lab/nets/${createdId}`, 'DELETE');
  assert.equal(del.status, 200); assert.equal(del.body.ok, true);
  assert.equal((await api(`/api/lab/nets/${createdId}`)).status, 404);
  assert.equal((await api(`/api/lab/nets/${createdId}`, 'DELETE')).status, 404);
  assert.ok(!(await api('/api/agents')).body.agents.some((x) => x.id === `net:${createdId}`));
  assert.equal((await api('/api/lab/nada')).status, 404);
  assert.equal((await api('/api/lab/nets/x/y/z')).status, 404);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (API del laboratorio)');
process.exit(fails ? 1 : 0);
