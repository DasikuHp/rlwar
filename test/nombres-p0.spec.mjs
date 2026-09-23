// Auditoría P0 (2026-09-23): las hijas no repiten nombre en un mundo (decisión del usuario: "que no se repita,
// cambiamos de letra"; spec/05 §10). Escrito ANTES del código.
// - mutate con existingNames: la letra avanza hasta la primera libre, sin distinguir mayúsculas; sin existingNames,
//   como antes.
// - Por la API: dos crías de la misma madre dan cuatro nombres distintos, con las letras seguidas (a, b, c, d).
// - Dinastías: dos generaciones seguidas no dejan dos redes con el mismo nombre en el mundo.
// Uso: node test/nombres-p0.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-nombres-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const { mutate, DEFAULT_MUTATION } = await import('../evo/mutate.js');
const store = await import('../evo/store.js');
const TH = await import('../evo/throne.js');

const parent = { ...clone(TEMPLATES.sniper.genome), id: 'lince-veloz-1b', name: 'Lince Veloz-1b', lineage: { generation: 1, parents: [] } };

await check('mutate: con 2a–2d ya usados, la hija nueva es la 2e; la siguiente, con la 2e también usada, la 2f', () => {
  const names = new Set(['Lince Veloz-2a', 'Lince Veloz-2b', 'Lince Veloz-2c', 'Lince Veloz-2d']);
  const a = mutate(parent, DEFAULT_MUTATION, makeRng(1), { sibling: 0, existingIds: new Set(), existingNames: names }).child;
  assert.equal(a.name, 'Lince Veloz-2e');
  names.add(a.name);
  const b = mutate(parent, DEFAULT_MUTATION, makeRng(2), { sibling: 1, existingIds: new Set([a.id]), existingNames: names }).child;
  assert.equal(b.name, 'Lince Veloz-2f');
});
await check('mutate: sin distinguir mayúsculas ("lince veloz-2a" ocupa la 2a)', () => {
  const c = mutate(parent, DEFAULT_MUTATION, makeRng(3), { sibling: 0, existingIds: new Set(), existingNames: new Set(['lince veloz-2a']) }).child;
  assert.equal(c.name, 'Lince Veloz-2b');
});
await check('mutate: sin existingNames, como antes (la letra de sibling)', () => {
  assert.equal(mutate(parent, DEFAULT_MUTATION, makeRng(4), { sibling: 2, existingIds: new Set() }).child.name, 'Lince Veloz-2c');
});

await check('dinastías: dos generaciones seguidas no dejan dos redes con el mismo nombre', async () => {
  for (const [id, key] of [['casa-a', 'sniper'], ['casa-b', 'seer']]) assert.ok(store.saveNet({ ...clone(TEMPLATES[key].genome), id, name: id === 'casa-a' ? 'Orca' : 'Hydra' }).ok);
  TH.foundDynasties({ A: { name: 'Casa Orca', netId: 'casa-a' }, B: { name: 'Casa Hydra', netId: 'casa-b' } });
  const body = { seed: 11, training: { games: 1, speed: 'turbo', workers: 1, soldiers: 1 }, children: { n: 2, pretournament: { games: 0 } }, duel: { learning: 'frozen', speed: 'turbo', soldiers: 1 } };
  await TH.runGeneration(body, {});
  await TH.runGeneration({ ...body, seed: 12 }, {});
  const names = store.listNets().map((n) => n.name.toLocaleLowerCase('es'));
  assert.equal(new Set(names).size, names.length, `nombres: ${names.join(', ')}`);
});

// ---------- por la API ----------
const startServer = async (dir, port) => {
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  return { base, stop: () => new Promise((r) => { srv.once('exit', r); srv.kill(); }) };
};
const s = await startServer(mkdtempSync(join(tmpdir(), 'gw-evo-nombres-api-')), 23000 + (process.pid % 15000));
const api = async (p, method = 'GET', body = undefined) => { const res = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: res.status, body: j, text: t }; };
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
try {
  await check('API: dos crías de la misma madre dan cuatro nombres distintos, con las letras seguidas', async () => {
    const mother = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Lince Veloz' })).body.id;
    const names = [];
    for (const seed of [1, 2]) {
      const j = await api(`/api/lab/nets/${mother}/children`, 'POST', { n: 2, pretournament: { games: 0 }, seed });
      assert.equal(j.status, 202, j.text);
      const done = await until(async () => { const r = (await api(`/api/lab/jobs/${j.body.jobId}`)).body; return r && r.status !== 'running' ? r : null; }, 60000, 'cría');
      assert.equal(done.status, 'done', JSON.stringify(done));
      for (const row of done.result.ranking) names.push(row.name);
    }
    assert.deepEqual(names.slice().sort(), ['Lince Veloz-1a', 'Lince Veloz-1b', 'Lince Veloz-1c', 'Lince Veloz-1d']);
  });
} finally { await s.stop(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: nombres de hijas sin repetir)');
process.exitCode = fails ? 1 : 0;
