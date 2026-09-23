// "¿Qué pasaría si…?" con el terreno de P1 (spec/01 §10.1, spec/08 §9.1): la escena admite círculos y bocados, la red
// decide sobre ese terreno (el Simulador ve el bocado) y lo inválido es un 400 con motivo. Escrito tras el código de la
// validación (auditoría de P1, 2026-09-24: faltaba este test) y congelado.
// Uso: node test/terreno-api.spec.mjs http://localhost:8791
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body: json, text };
};
const policy = await import('../shared/policy.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const C = await import('../shared/constants.js');

const scene = {
  soldiers: [{ id: 'me', team: 'left', x: -10, y: 0 }, { id: 'e1', team: 'right', x: 10, y: 0 }],
  obstacles: [{ kind: 'circle', x: 0, y: 0, r: 0.6 }, { x: 4, y: 6, w: 2, h: 2 }],
  bites: [{ x: 0, y: 0, r: C.BITE_RADIUS }], // se come el círculo entero: la recta directa pasa
  soldierId: 'me',
};
let netId;

await check('whatif con círculos y bocados: la decisión es la de decideShot con ese terreno', async () => {
  netId = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Terreno Que Pasaria' })).body.id;
  const g = (await api(`/api/lab/nets/${netId}`)).body.genome;
  const r = await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3 });
  assert.equal(r.status, 200, r.text);
  const d = r.body.decision;
  const state = { soldiers: scene.soldiers.map((s) => ({ ownerId: s.team === 'left' ? 'pL' : 'pR', alive: true, turns: 0, ...s })), obstacles: scene.obstacles, bites: scene.bites, shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, players: [] };
  const net = compile(g);
  const ref = policy.decideShot({ net, genome: g, state, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(3), attribution: true });
  assert.equal(d.chosen, ref.decision.chosen);
  assert.equal(d.candidates.length, ref.decision.candidates.length);
  d.candidates.forEach((c, i) => assert.ok(Math.abs(c.p - ref.decision.candidates[i].p) < 1e-12 && c.expr === ref.decision.candidates[i].expr && c.sim.type === ref.decision.candidates[i].sim.type, `candidato ${i}`));
});

await check('whatif: el Simulador de la red ve el bocado (sin él, algún candidato choca en vez de matar)', async () => {
  const withBite = (await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3 })).body.decision;
  const blind = (await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene: { ...scene, bites: [] }, seed: 3 })).body.decision;
  const changed = withBite.candidates.filter((c, i) => c.sim.type === 'kill' && blind.candidates[i].sim.type === 'obstacle');
  assert.ok(changed.length > 0, JSON.stringify(withBite.candidates.map((c, i) => [c.sim.type, blind.candidates[i].sim.type])));
});

await check('whatif: obstáculos y bocados inválidos → 400 con motivo; 256 bocados valen y 257 no', async () => {
  const bad = [
    { ...scene, obstacles: [{ kind: 'circle', x: 0, y: 0, r: 0 }] },
    { ...scene, obstacles: [{ kind: 'circle', x: 0, y: 0 }] },
    { ...scene, obstacles: [{ kind: 'circle', x: 'a', y: 0, r: 1 }] },
    { ...scene, obstacles: [{ x: 0, y: 0, w: 0, h: 2 }] },
    { ...scene, bites: [{ x: 0, y: 0, r: -1 }] },
    { ...scene, bites: [{ x: 0, y: null, r: 0.78 }] },
    { ...scene, bites: [null] },
    { ...scene, bites: Array.from({ length: 257 }, () => ({ x: 0, y: 0, r: 0.78 })) },
  ];
  for (const sc of bad) {
    const r = await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene: sc, seed: 3 });
    assert.equal(r.status, 400, `${JSON.stringify(sc).slice(0, 120)} → ${r.status}`);
    assert.ok(r.body && typeof r.body.error === 'string' && r.body.error.length > 5, r.text);
  }
  const ok = await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene: { ...scene, bites: Array.from({ length: 256 }, () => ({ x: 0, y: 0, r: 0.78 })) }, seed: 3 });
  assert.equal(ok.status, 200, ok.text);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (terreno: "¿qué pasaría si…?" por la API)');
process.exit(fails ? 1 : 0);
