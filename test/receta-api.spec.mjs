// Receta de entreno por la API (spec/04 §11, ronda 17): validación con 400 en español, vista del entreno, eventos
// SSE y versiones de una red (lista, una, diferencia, volver). Servidor propio. Escrito ANTES del código.
// Uso: node test/receta-api.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const port = 24000 + (process.pid % 15000);
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-receta-api-')) }, stdio: 'ignore' });
const base = `http://localhost:${port}`;
for (const t0 = Date.now(); ;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body = undefined) => { const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: res.status, body: j, text: t }; };
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
const doneTraining = async (id) => until(async () => { const r = (await api(`/api/lab/trainings/${id}`)).body; return r && !['queued', 'running', 'paused'].includes(r.status) ? r : null; }, 180000, 'entreno');
// SSE del laboratorio: guarda los eventos que llegan
const listen = () => {
  const ctrl = new AbortController(); const events = [];
  const ready = (async () => {
    const res = await fetch(base + '/api/lab/events', { signal: ctrl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(chunk), da = /^data: (.*)$/m.exec(chunk); if (ev && da) events.push({ event: ev[1], data: JSON.parse(da[1]) }); } } } catch { /* cerrado */ } })();
  })();
  return { ready, events, close: () => ctrl.abort() };
};

try {
  const net = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Receta' })).body.id;
  const body = (extra) => ({ netId: net, speed: 'turbo', workers: 1, duration: { games: 4 }, soldiers: 1, seed: 7, opponents: { antagonist: 0, hallOfFame: 0, self: 1 }, ...extra });

  await check('400 con motivo y ejemplo para cada parte de la receta, y no se crea ningún entreno', async () => {
    const before = (await api('/api/lab/trainings')).body.trainings.length;
    for (const extra of [
      { learning: { gradient: { lr: 0.5 } } },
      { learning: { gradient: { lR: 0.01 } } },
      { duration: { plateau: { window: 20 } }, schedule: { lr: { shape: 'linear', to: 0.001 } } },
      { schedule: { temperature: { shape: 'linear', to: 9 } } },
      { reward: { graze: 9 } },
      { frozen: ['nadie'] },
      { curriculum: [] },
      { curriculum: [{ name: 'A', until: { winRate: 2 } }, { name: 'B' }] },
      { exam: 'sí' },
    ]) {
      const r = await api('/api/lab/trainings', 'POST', body(extra));
      assert.equal(r.status, 400, `${JSON.stringify(extra)} → ${r.status} ${r.text}`);
      assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0, 'error');
      assert.ok(Array.isArray(r.body.errors) && r.body.errors.every((e) => e.message && e.example), `errores con ejemplo: ${r.text}`);
    }
    assert.equal((await api('/api/lab/trainings')).body.trainings.length, before);
  });

  let trainedId = null, versionN = null;
  await check('receta completa: 202; la vista lleva la receta, la fase, la lección, lo aplicado, el examen, la versión y la mejor', async () => {
    const sse = listen(); await sse.ready;
    const recipe = { learning: { gradient: { lr: 0.01 } }, schedule: { lr: { shape: 'linear', to: 0.001 } }, reward: { graze: 0.3 }, frozen: ['d'], curriculum: [{ name: 'A', soldiers: 1, until: { games: 2 } }, { name: 'B', soldiers: 2 }], exam: true, keepBest: true };
    const r = await api('/api/lab/trainings', 'POST', body(recipe));
    assert.equal(r.status, 202, r.text);
    trainedId = r.body.id;
    const v = await doneTraining(trainedId);
    assert.equal(v.status, 'done', JSON.stringify(v.error));
    assert.deepEqual(v.recipe, recipe);
    assert.equal(v.phase, 'done');
    assert.deepEqual(v.lesson, { index: 1, name: 'B' });
    assert.ok(v.applied && Number.isFinite(v.applied.lr) && Number.isFinite(v.applied.temperature), JSON.stringify(v.applied));
    for (const k of ['before', 'after']) assert.ok(v.exam && ['aim', 'cover', 'survival', 'adaptation'].every((s) => Number.isFinite(v.exam[k][s])), `exam.${k}`);
    assert.ok(Number.isInteger(v.versionBefore), 'versionBefore');
    versionN = v.versionBefore;
    assert.deepEqual(v.keptBest, { restored: false, reason: 'menos de 20 partidas' });
    assert.deepEqual(v.curriculum.map((x) => [x.name, x.from, x.to, x.met]), [['A', 0, 1, true], ['B', 2, null, false]]);
    await sleep(300);
    sse.close();
    const mine = (type) => sse.events.filter((e) => e.event === type && (e.data.trainingId === trainedId || e.data.id === trainedId));
    assert.deepEqual(mine('curriculum').map((e) => e.data.reason), ['start', 'met', 'start']);
    assert.deepEqual(mine('exam').map((e) => e.data.when), ['before', 'after']);
    assert.ok(mine('sleep').every((e) => e.data.update && e.data.update.applied), 'cada sueño dice lo que aplicó');
  });

  await check('la red en disco conserva su aprendizaje, su recompensa y sus congelados', async () => {
    const g = (await api(`/api/lab/nets/${net}`)).body.genome;
    assert.equal(g.learning.gradient.lr, 0.003);
    assert.equal(g.reward.graze, 0.1);
    assert.deepEqual(g.frozen, []);
    assert.ok(g.stats.games >= 4, 'pero sí cuenta lo jugado');
  });

  await check('versiones: lista, una, diferencia con la red de ahora y volver (se puede deshacer); 404 si no existe', async () => {
    const list = (await api(`/api/lab/nets/${net}/versions`)).body.versions;
    const v = list.find((x) => x.n === versionN);
    assert.ok(v && v.trainingId === trainedId && Number.isInteger(v.paramCount) && Number.isFinite(v.ts), JSON.stringify(list));
    const one = (await api(`/api/lab/nets/${net}/versions/${versionN}`)).body;
    assert.equal(one.n, versionN); assert.ok(one.genome && Array.isArray(one.genome.blocks));
    const diff = await api(`/api/lab/nets/${net}/versions/${versionN}/diff`);
    assert.equal(diff.status, 200, diff.text);
    assert.ok(Array.isArray(diff.body.blocks) && diff.body.blocks.some((b) => b.status === 'changed'), 'el entreno cambió pesos');
    const statsBefore = (await api(`/api/lab/nets/${net}`)).body.genome.stats;
    const rs = await api(`/api/lab/nets/${net}/versions/${versionN}/restore`, 'POST', {});
    assert.equal(rs.status, 200, rs.text);
    const g = (await api(`/api/lab/nets/${net}`)).body.genome;
    assert.deepEqual(g.weights, one.genome.weights, 'vuelven los pesos');
    assert.deepEqual(g.stats, statsBefore, 'lo vivido se queda');
    const list2 = (await api(`/api/lab/nets/${net}/versions`)).body.versions;
    assert.equal(list2.length, list.length + 1, 'la de antes de volver se guardó');
    assert.equal((await api(`/api/lab/nets/${net}/versions/999`)).status, 404);
    assert.equal((await api(`/api/lab/nets/${net}/versions/999/restore`, 'POST', {})).status, 404);
  });

  await check('volver a una versión con la red entrenando → 409 con el motivo', async () => {
    const r = await api('/api/lab/trainings', 'POST', body({ duration: { games: 400 } }));
    assert.equal(r.status, 202, r.text);
    await until(async () => (await api(`/api/lab/trainings/${r.body.id}`)).body.status === 'running', 30000, 'arranca');
    const rs = await api(`/api/lab/nets/${net}/versions/${versionN}/restore`, 'POST', {});
    assert.equal(rs.status, 409, rs.text);
    assert.ok(/entren/.test(rs.body.error), rs.text);
    await api(`/api/lab/trainings/${r.body.id}/stop`, 'POST', {});
    await doneTraining(r.body.id);
  });

  await check('generación de dinastías: su entreno cruzado valida la receta igual (400)', async () => {
    const b = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Otra casa' })).body.id;
    const f = await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa A', netId: net }, B: { name: 'Casa B', netId: b } });
    assert.equal(f.status, 200, f.text);
    const g = await api('/api/lab/dynasties/generation', 'POST', { training: { games: 1, reward: { graze: 9 } } });
    assert.equal(g.status, 400, g.text);
    assert.ok(/graze/.test(g.text));
  });
} finally { srv.kill(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (receta de entreno por la API)');
process.exitCode = fails ? 1 : 0;
