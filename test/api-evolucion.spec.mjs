// API de evolución, F5 (spec/05 §4, §5, §7, §8, §10.4–10.5; spec/08 §4–§6): hijos + pre-torneo como trabajo
// con SSE, diferencias, cirugía (congelar, pesos a mano, trasplante), importación robusta.
// Escrito ANTES del código y congelado. Uso: node test/api-evolucion.spec.mjs http://localhost:8791
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
  return { status: res.status, body: json, text };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitJob = async (id, ms = 120000) => {
  const t0 = Date.now();
  for (;;) {
    const r = await api(`/api/lab/jobs/${id}`);
    assert.equal(r.status, 200, r.text);
    if (r.body.status === 'done' || r.body.status === 'error') return r.body;
    assert.ok(Date.now() - t0 < ms, `trabajo ${id} no termina: ${JSON.stringify(r.body).slice(0, 200)}`);
    await sleep(150);
  }
};
// lector SSE: acumula {event, data}
function listen() {
  const ctrl = new AbortController(); const events = [];
  const ready = fetch(BASE + '/api/lab/events', { signal: ctrl.signal }).then((res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk), data = /^data: (.*)$/m.exec(chunk);
            if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null });
          }
        }
      } catch { /* abortado */ }
    })();
  });
  return { events, ready, close: () => ctrl.abort() };
}
const { TEMPLATES } = await import('../shared/templates.js');
const { validate } = await import('../shared/genome.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const sorted = (rows) => rows.every((r, i) => i === 0 || rows[i - 1].wins > r.wins || (rows[i - 1].wins === r.wins && (rows[i - 1].killDiff > r.killDiff || (rows[i - 1].killDiff === r.killDiff && (rows[i - 1].kills > r.kills || (rows[i - 1].kills === r.kills && rows[i - 1].name <= r.name))))));

let parentId = null;
await check('POST /children: validaciones (404, n fuera de 1..16, games fuera de 0..20, soldiers)', async () => {
  const r = await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Hydra' });
  assert.equal(r.status, 201, r.text); parentId = r.body.id; assert.equal(parentId, 'hydra');
  assert.equal((await api('/api/lab/nets/no-existe/children', 'POST', { n: 1 })).status, 404);
  assert.equal((await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 0 })).status, 400);
  assert.equal((await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 17 })).status, 400);
  assert.equal((await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 2, pretournament: { games: 21 } })).status, 400);
  assert.equal((await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 2, pretournament: { games: 1, soldiers: 9 } })).status, 400);
  assert.equal((await api(`/api/lab/nets/${parentId}/children`, 'POST', 'esto no es json', true)).status, 400);
});

let firstBatch = null;
await check('POST /children: 202 {jobId}; el trabajo avanza (SSE job), termina (SSE children) y el ranking está ordenado; hijos guardados con linaje', async () => {
  const sse = listen(); await sse.ready;
  const r = await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 3, pretournament: { games: 2, soldiers: 1 }, seed: 5 });
  assert.equal(r.status, 202, r.text); assert.ok(r.body.jobId);
  const alive = await api('/api/lab/catalog'); assert.equal(alive.status, 200, 'el servidor responde mientras corre el pre-torneo');
  const job = await waitJob(r.body.jobId);
  assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300));
  assert.equal(job.kind, 'children'); assert.deepEqual(job.progress, { done: 6, total: 6 });
  const rk = job.result.ranking;
  assert.equal(job.result.parentId, parentId);
  assert.equal(rk.length, 3);
  for (const row of rk) {
    assert.ok(row.id && row.name && Number.isInteger(row.wins) && Number.isInteger(row.killDiff) && Number.isInteger(row.kills) && Number.isInteger(row.deaths) && Array.isArray(row.opsText), JSON.stringify(row));
    assert.ok(row.wins >= 0 && row.wins <= 2);
    assert.equal(row.killDiff, row.kills - row.deaths);
  }
  assert.ok(sorted(rk), JSON.stringify(rk));
  assert.deepEqual(rk.map((x) => x.name).sort(), ['Hydra-1a', 'Hydra-1b', 'Hydra-1c']);
  assert.deepEqual(rk.map((x) => x.id).sort(), ['hydra-1a', 'hydra-1b', 'hydra-1c']);
  for (const row of rk) {
    const g = (await api(`/api/lab/nets/${row.id}`)).body.genome;
    assert.deepEqual(g.lineage.parents, [parentId]); assert.equal(g.lineage.generation, 1);
    assert.deepEqual(g.lineage.mutations.map((o) => o.text), row.opsText);
    assert.ok(g.lineage.mutations.length >= 1 && validate(g).ok);
  }
  await sleep(100);
  const jobEv = sse.events.filter((e) => e.event === 'job' && e.data.id === r.body.jobId);
  assert.ok(jobEv.length >= 2 && jobEv.every((e) => e.data.kind === 'children' && e.data.progress && typeof e.data.progress.done === 'number'), `eventos job: ${jobEv.length}`);
  const ch = sse.events.find((e) => e.event === 'children' && e.data.jobId === r.body.jobId);
  assert.ok(ch, 'evento children');
  assert.equal(ch.data.parentId, parentId); assert.deepEqual(ch.data.ranking, rk);
  const list = (await api('/api/lab/jobs')).body;
  assert.ok(Array.isArray(list.jobs) && list.jobs.some((j) => j.id === r.body.jobId && j.status === 'done'));
  sse.close();
  firstBatch = Object.fromEntries(await Promise.all(rk.map(async (row) => [row.name, (await api(`/api/lab/nets/${row.id}`)).body.genome.weights])));
});

await check('POST /children: misma semilla → mismos hijos (pesos idénticos, ids con sufijo); games 0 → sin partidas; hello del SSE lleva jobs', async () => {
  const r = await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 3, pretournament: { games: 0 }, seed: 5 });
  assert.equal(r.status, 202);
  const job = await waitJob(r.body.jobId);
  assert.equal(job.status, 'done'); assert.deepEqual(job.progress, { done: 0, total: 0 });
  const rk = job.result.ranking;
  assert.deepEqual(rk.map((x) => x.id).sort(), ['hydra-1a-2', 'hydra-1b-2', 'hydra-1c-2']);
  assert.ok(rk.every((x) => x.wins === 0 && x.kills === 0 && x.deaths === 0 && x.killDiff === 0));
  for (const row of rk) assert.deepEqual((await api(`/api/lab/nets/${row.id}`)).body.genome.weights, firstBatch[row.name], `${row.name} determinista`);
  const sse = listen(); await sse.ready; await sleep(150);
  const hello = sse.events.find((e) => e.event === 'hello');
  assert.ok(hello && Array.isArray(hello.data.jobs) && hello.data.jobs.some((j) => j.id === r.body.jobId), 'hello con jobs');
  sse.close();
  assert.equal((await api('/api/lab/jobs/no-existe')).status, 404);
});

await check('POST /children con opponentId explícito y sin él (sin reina → el padre): ambos terminan', async () => {
  const rival = await api('/api/lab/nets', 'POST', { template: 'empty', name: 'Rival' });
  assert.equal(rival.status, 201);
  const bad = await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 1, pretournament: { games: 1, opponentId: 'nadie' }, seed: 9 });
  assert.equal(bad.status, 404);
  const r = await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 1, pretournament: { games: 1, opponentId: rival.body.id, soldiers: 'random' }, seed: 9 });
  assert.equal(r.status, 202);
  const job = await waitJob(r.body.jobId);
  assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300));
  assert.equal(job.result.opponentId, rival.body.id);
  assert.ok([1, 2, 3, 4].includes(job.result.soldiers));
  const r2 = await api(`/api/lab/nets/${parentId}/children`, 'POST', { n: 1, pretournament: { games: 1 }, seed: 11 });
  const job2 = await waitJob(r2.body.jobId);
  assert.equal(job2.status, 'done'); assert.equal(job2.result.opponentId, parentId, 'sin reina, el rival es el padre');
});

await check('GET /diff/:otherId: bloques con estado, relChange, heat; cables; rasgos; textos de las mutaciones; 404 si falta', async () => {
  const r = await api('/api/lab/nets/hydra-1a/diff/hydra');
  assert.equal(r.status, 200, r.text);
  const d = r.body;
  assert.ok(Array.isArray(d.blocks) && d.blocks.length >= 7);
  for (const b of d.blocks) assert.ok(b.blockId && b.name && ['same', 'changed', 'added', 'removed'].includes(b.status) && typeof b.relChange === 'number' && Array.isArray(b.heat) && b.heat.length <= 64, JSON.stringify(b));
  assert.deepEqual(Object.keys(d.wires).sort(), ['added', 'removed']);
  assert.ok(d.traits.before && d.traits.after && d.imagination.before && d.imagination.after);
  const g = (await api('/api/lab/nets/hydra-1a')).body.genome;
  assert.deepEqual(d.text, g.lineage.mutations.map((o) => o.text));
  const self = (await api('/api/lab/nets/hydra/diff/hydra')).body;
  assert.ok(self.blocks.every((b) => b.status === 'same' && b.relChange === 0));
  assert.equal((await api('/api/lab/nets/hydra-1a/diff/no-existe')).status, 404);
  assert.equal((await api('/api/lab/nets/no-existe/diff/hydra')).status, 404);
});

await check('cirugía: PUT /frozen congela y descongela; 400 si el bloque no existe', async () => {
  const r = await api('/api/lab/nets/hydra/frozen', 'PUT', { blocks: ['d'] });
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.body, { ok: true, frozen: ['d'] });
  assert.deepEqual((await api('/api/lab/nets/hydra')).body.genome.frozen, ['d']);
  assert.equal((await api('/api/lab/nets/hydra/frozen', 'PUT', { blocks: ['nadie'] })).status, 400);
  assert.equal((await api('/api/lab/nets/hydra/frozen', 'PUT', { blocks: 'd' })).status, 400);
  const r2 = await api('/api/lab/nets/hydra/frozen', 'PUT', { blocks: [] });
  assert.deepEqual(r2.body, { ok: true, frozen: [] });
});

await check('cirugía: PUT /weights/:blockId cambia solo las claves enviadas; forma exacta; NaN/Infinity → 400 weights-nan; 404 bloque', async () => {
  const before = (await api('/api/lab/nets/hydra')).body.genome.weights;
  const b = before.md.b.map(() => 0.5);
  const r = await api('/api/lab/nets/hydra/weights/md', 'PUT', { b });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.ok, true);
  const after = (await api('/api/lab/nets/hydra')).body.genome.weights;
  assert.deepEqual(after.md.b, b); assert.deepEqual(after.md.W, before.md.W); assert.deepEqual(after.d, before.d);
  const bad = await api('/api/lab/nets/hydra/weights/md', 'PUT', { b: [1, 2] });
  assert.equal(bad.status, 400); assert.equal(bad.body.errors[0].code, 'weights-shape');
  const nan = await api('/api/lab/nets/hydra/weights/md', 'PUT', `{"b": [${before.md.b.map((_, i) => (i === 0 ? '1e999' : '0')).join(',')}]}`, true);
  assert.equal(nan.status, 400); assert.equal(nan.body.errors[0].code, 'weights-nan');
  const nul = await api('/api/lab/nets/hydra/weights/md', 'PUT', { b: before.md.b.map((_, i) => (i === 0 ? null : 0)) });
  assert.equal(nul.status, 400); assert.equal(nul.body.errors[0].code, 'weights-nan');
  assert.equal((await api('/api/lab/nets/hydra/weights/nadie', 'PUT', { b })).status, 404);
  assert.equal((await api('/api/lab/nets/hydra/weights/md', 'PUT', { Z: [1] })).status, 400, 'clave desconocida');
  assert.deepEqual((await api('/api/lab/nets/hydra')).body.genome.weights.md.b, b, 'los fallos no guardan nada');
});

await check('cirugía: POST /transplant compatible copia pesos; incompatible reinicializa con aviso; sin replaceBlockId añade suelto; queda en el linaje', async () => {
  const donor = await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Donante' });
  assert.equal(donor.status, 201);
  const donorW = (await api(`/api/lab/nets/${donor.body.id}`)).body.genome.weights;
  const r = await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: donor.body.id, blockId: 'd', replaceBlockId: 'd' });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.ok, true); assert.equal(r.body.blockId, 'd'); assert.deepEqual(r.body.warnings, []);
  let g = (await api('/api/lab/nets/hydra')).body.genome;
  assert.deepEqual(g.weights.d, donorW.d, 'pesos copiados');
  const last = g.lineage.mutations[g.lineage.mutations.length - 1];
  assert.equal(last.op, 'transplant'); assert.equal(last.from, donor.body.id); assert.equal(last.blockId, 'd'); assert.ok(typeof last.text === 'string' && last.text.length);
  const turtle = await api('/api/lab/nets', 'POST', { template: 'turtle', name: 'Tortuga donante' });
  const r2 = await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: turtle.body.id, blockId: 'cd', replaceBlockId: 'md' });
  assert.equal(r2.status, 200, r2.text); assert.ok(r2.body.warnings.length >= 1, 'aviso: formas distintas');
  g = (await api('/api/lab/nets/hydra')).body.genome;
  const md = g.blocks.find((b) => b.id === 'md');
  assert.equal(md.type, 'dense'); assert.equal(md.params.units, 16);
  assert.ok(validate(g).ok, JSON.stringify(validate(g).errors[0]));
  assert.equal(g.weights.md.W.length, 9 * 16, 'reinicializado con la forma de la receptora');
  assert.ok(g.wires.some((w) => w.from === 'm' && w.to === 'md') && g.wires.some((w) => w.from === 'md' && w.to === 'fm'), 'conserva cables');
  const r3 = await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: turtle.body.id, blockId: 'g' });
  assert.equal(r3.status, 200, r3.text);
  g = (await api('/api/lab/nets/hydra')).body.genome;
  const nb = g.blocks.find((b) => b.id === r3.body.blockId);
  assert.ok(nb && nb.type === 'gru' && !g.wires.some((w) => w.from === nb.id || w.to === nb.id), 'bloque nuevo sin cables');
  assert.ok(validate(g).warnings.some((w) => w.code === 'unconnected' && w.blockId === nb.id));
  assert.equal((await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: 'nadie', blockId: 'd' })).status, 404);
  assert.equal((await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: donor.body.id, blockId: 'nadie' })).status, 404);
  assert.equal((await api('/api/lab/nets/hydra/transplant', 'POST', { fromNetId: donor.body.id, blockId: 'd', replaceBlockId: 'nadie' })).status, 404);
});

await check('cirugía durante un entreno → 409 (frozen, weights, transplant, children)', async () => {
  const t = await api('/api/lab/trainings', 'POST', { netId: 'hydra-1b', speed: 'turbo', duration: { games: 40 } });
  assert.equal(t.status, 202, t.text);
  assert.equal((await api('/api/lab/nets/hydra-1b/frozen', 'PUT', { blocks: [] })).status, 409);
  assert.equal((await api('/api/lab/nets/hydra-1b/weights/d', 'PUT', { b: [] })).status, 409);
  assert.equal((await api('/api/lab/nets/hydra-1b/transplant', 'POST', { fromNetId: 'hydra', blockId: 'd' })).status, 409);
  assert.equal((await api('/api/lab/nets/hydra-1b/children', 'POST', { n: 1, pretournament: { games: 0 } })).status, 409);
  await api(`/api/lab/trainings/${t.body.id}/stop`, 'POST');
});

await check('importar: ciclo → 400 cycle; NaN → 400 weights-nan; JSON roto → 400; el servidor sigue vivo; exportar → importar → exportar idéntico', async () => {
  const g = clone(TEMPLATES.sniper.genome); g.id = 'ciclo-1'; g.name = 'Ciclo'; g.wires.push({ from: 'ch', to: 'd' });
  const cyc = await api('/api/lab/nets/import', 'POST', g);
  assert.equal(cyc.status, 400); assert.ok(cyc.body.errors.some((e) => e.code === 'cycle'), JSON.stringify(cyc.body).slice(0, 200));
  const n = clone(TEMPLATES.sniper.genome); n.id = 'nan-1'; n.name = 'NaN';
  const txt = JSON.stringify(n).replace(/"W":\[[^\]]*\]/, (m) => m.replace(/\[[^,]*,/, '[1e999,'));
  const nan = await api('/api/lab/nets/import', 'POST', txt, true);
  assert.equal(nan.status, 400); assert.ok(nan.body.errors.some((e) => e.code === 'weights-nan'), JSON.stringify(nan.body).slice(0, 200));
  assert.equal((await api('/api/lab/nets/import', 'POST', '{"id": ', true)).status, 400);
  assert.equal((await api('/api/lab/catalog')).status, 200, 'vivo');
  const ex1 = await api('/api/lab/nets/hydra-1c/export');
  assert.equal(ex1.status, 200);
  assert.equal((await api('/api/lab/nets/hydra-1c', 'DELETE')).body.ok, true);
  const imp = await api('/api/lab/nets/import', 'POST', ex1.body);
  assert.equal(imp.status, 201, imp.text); assert.equal(imp.body.id, 'hydra-1c');
  const ex2 = await api('/api/lab/nets/hydra-1c/export');
  assert.equal(ex2.text, ex1.text, 'exportar → importar → exportar idéntico');
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\napi-evolucion OK');
