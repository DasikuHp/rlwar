// F4 — API de entrenos (spec/04 §9.6): crear, estado, lista, parar, SSE global. Escrito ANTES del
// código y congelado. Uso: node test/api-trainings.spec.mjs http://localhost:8791
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* no json */ }
  return { status: res.status, body: json, text };
};

let netId = null, rivalId = null, trainingId = null;
await check('preparación: dos redes desde plantilla', async () => {
  netId = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Entrena' })).body.id;
  rivalId = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Rival' })).body.id;
  assert.ok(netId && rivalId);
});

await check('POST /api/lab/trainings: 202 con id; 404 red inexistente; 400 cuerpo malo; la red aparece como training:true', async () => {
  assert.equal((await api('/api/lab/trainings', 'POST', { netId: 'no-existe', duration: { games: 1 } })).status, 404);
  assert.equal((await api('/api/lab/trainings', 'POST', { netId, duration: { games: 0 } })).status, 400);
  assert.equal((await api('/api/lab/trainings', 'POST', { netId, speed: 'warp' })).status, 400);
  const r = await api('/api/lab/trainings', 'POST', { netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: rivalId }, speed: 'turbo', workers: 1, duration: { games: 6 }, soldiers: 1, seed: 3 });
  assert.equal(r.status, 202, r.text); assert.ok(r.body.id && ['queued', 'running'].includes(r.body.status));
  trainingId = r.body.id;
  const dup = await api('/api/lab/trainings', 'POST', { netId, duration: { games: 2 } });
  assert.ok(dup.status === 409 || dup.status === 202, String(dup.status));
  const t0 = Date.now(); let st = null;
  while (Date.now() - t0 < 60000) { st = (await api(`/api/lab/trainings/${trainingId}`)).body; if (st.status === 'done' || st.status === 'error') break; await sleep(150); }
  assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
  assert.equal(st.games, 6); assert.ok(st.updates >= 1 && typeof st.elapsedMs === 'number' && st.curve.length === 6 && st.config.netId === netId);
  assert.ok(st.lastLesson && st.lastLesson.blockId);
  const list = (await api('/api/lab/trainings')).body.trainings;
  assert.ok(list.some((t) => t.id === trainingId && t.netId === netId && t.status === 'done'));
  const nets = (await api('/api/lab/nets')).body.nets;
  assert.equal(nets.find((n) => n.id === netId).training, false);
  assert.equal((await api('/api/lab/trainings/nada')).status, 404);
});

await check('SSE /api/lab/events: hello y eventos training/curve/sleep/lesson durante un entreno; PUT bloqueado (409) mientras entrena; stop', async () => {
  const ctrl = new AbortController();
  const events = [];
  const stream = fetch(BASE + '/api/lab/events', { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const m = /event: (\w+)/.exec(chunk); if (m) events.push({ ev: m[1], data: (chunk.split('\n').find((l) => l.startsWith('data: ')) || '').slice(6) }); }
      }
    } catch { /* abortado */ }
  });
  await sleep(300);
  assert.ok(events.some((e) => e.ev === 'hello'), 'hello al conectar');
  const r = await api('/api/lab/trainings', 'POST', { netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: rivalId }, speed: 'turbo', workers: 1, duration: { games: 40 }, soldiers: 1, seed: 9 });
  assert.equal(r.status, 202);
  const id = r.body.id;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !events.some((e) => e.ev === 'sleep')) await sleep(100);
  assert.ok(events.some((e) => e.ev === 'training' && JSON.parse(e.data).id === id), 'evento training');
  assert.ok(events.some((e) => e.ev === 'curve' && JSON.parse(e.data).trainingId === id), 'evento curve');
  assert.ok(events.some((e) => e.ev === 'sleep'), 'evento sleep');
  const one = (await api(`/api/lab/nets/${netId}`)).body.genome;
  assert.equal((await api(`/api/lab/nets/${netId}`, 'PUT', one)).status, 409, 'entrenando: no se edita');
  assert.equal((await api(`/api/lab/nets/${netId}`, 'DELETE')).status, 409, 'entrenando: no se borra');
  assert.equal((await api('/api/lab/nets')).body.nets.find((n) => n.id === netId).training, true);
  const stop = await api(`/api/lab/trainings/${id}/stop`, 'POST');
  assert.equal(stop.status, 200); assert.ok(['stopped', 'done'].includes(stop.body.status), JSON.stringify(stop.body));
  const t1 = Date.now(); let st = null;
  while (Date.now() - t1 < 20000) { st = (await api(`/api/lab/trainings/${id}`)).body; if (st.status === 'stopped' || st.status === 'done') break; await sleep(100); }
  assert.ok(['stopped', 'done'].includes(st.status)); assert.ok(st.games < 40);
  assert.ok(events.some((e) => e.ev === 'lesson' && JSON.parse(e.data).trainingId === id) || events.some((e) => e.ev === 'sleep'));
  assert.equal((await api(`/api/lab/trainings/${id}/stop`, 'POST')).status, 200, 'parar dos veces no rompe');
  assert.equal((await api(`/api/lab/nets/${netId}`, 'PUT', one)).status, 200, 'ya se puede editar');
  ctrl.abort(); await stream;
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (API de entrenos)');
process.exit(fails ? 1 : 0);
