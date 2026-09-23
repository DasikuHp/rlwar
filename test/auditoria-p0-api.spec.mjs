// Auditoría P0 (2026-09-23), arreglos del servidor con su propio servidor y carpeta de datos. Escrito ANTES del código.
// - spec/08 §10.7: una cría terminada se guarda en disco con su `result` (el ranking); tras reiniciar, GET /jobs/:id
//   devuelve lo mismo. Antes se guardaba antes de tener el resultado (evo/api.js startChildrenJob) y quedaba null.
// - spec/04 §9.8: el `elapsedMs` de un entreno terminado no sigue contando.
// - spec/08 §10.6: los topes de cuerpo se cuentan en bytes, y una letra partida entre dos trozos llega entera (en
//   /api/lab y en las rutas de sala).
// Uso: node test/auditoria-p0-api.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const startServer = async (dir, port) => {
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  return { base, port, stop: () => new Promise((r) => { srv.once('exit', r); srv.kill(); }) };
};
const apiOf = (s) => async (p, method = 'GET', body = undefined) => {
  const res = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: res.status, body: j, text: t };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
// manda un cuerpo en dos escrituras separadas por una pausa, partido en el byte `cut` (así llega en dos trozos)
const sendSplit = (port, path, buf, cut) => new Promise((resolve, reject) => {
  const req = request({ host: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length } }, (res) => {
    let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: res.statusCode, body: j }); });
  });
  req.on('error', reject);
  req.write(buf.subarray(0, cut));
  setTimeout(() => { req.end(buf.subarray(cut)); }, 150);
});

const dir = mkdtempSync(join(tmpdir(), 'gw-evo-p0api-'));
const port = 21000 + (process.pid % 15000);
let s = await startServer(dir, port);
let api = apiOf(s);
try {
  await check('cría: tras reiniciar el servidor, GET /jobs/:id devuelve el mismo resultado (ranking con sus hijos), no null', async () => {
    const mother = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Madre Auditoría' })).body.id;
    const j = await api(`/api/lab/nets/${mother}/children`, 'POST', { n: 2, pretournament: { games: 1, soldiers: 1 }, seed: 5 });
    assert.equal(j.status, 202, j.text);
    const done = await until(async () => { const r = (await api(`/api/lab/jobs/${j.body.jobId}`)).body; return r && r.status !== 'running' ? r : null; }, 120000, 'cría');
    assert.equal(done.status, 'done', JSON.stringify(done));
    assert.equal(done.result.ranking.length, 2, 'premisa: dos hijos en el ranking');
    await s.stop();
    s = await startServer(dir, port + 1);
    api = apiOf(s);
    const after = await api(`/api/lab/jobs/${j.body.jobId}`);
    assert.equal(after.status, 200, after.text);
    assert.equal(after.body.status, 'done');
    assert.deepEqual(after.body.result, done.result);
    const listed = (await api('/api/lab/jobs')).body.jobs.find((x) => x.id === j.body.jobId);
    assert.deepEqual(listed && listed.result, done.result, 'también en el listado');
  });

  await check('entreno terminado: su elapsedMs no sigue contando (dos lecturas separadas dan lo mismo)', async () => {
    const id = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Reloj Auditoría' })).body.id;
    const tr = await api('/api/lab/trainings', 'POST', { netId: id, speed: 'turbo', workers: 1, duration: { games: 2 }, soldiers: 1, seed: 3, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(tr.status, 202, tr.text);
    const t1 = await until(async () => { const r = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return r && !['queued', 'running', 'paused'].includes(r.status) ? r : null; }, 120000, 'entreno');
    assert.ok(Number.isFinite(t1.elapsedMs) && t1.elapsedMs >= 0, `elapsedMs ${t1.elapsedMs}`);
    await sleep(400);
    const t2 = (await api(`/api/lab/trainings/${tr.body.id}`)).body;
    assert.equal(t2.elapsedMs, t1.elapsedMs, 'un entreno terminado no cambia su duración');
  });

  await check('/api/lab: una "Ñ" partida entre dos trozos del cuerpo llega entera (nombre de la red intacto)', async () => {
    const name = 'Ñandú Ágil';
    const buf = Buffer.from(JSON.stringify({ template: 'sniper', name }), 'utf8');
    const at = buf.indexOf(Buffer.from('Ñ', 'utf8'));
    const r = await sendSplit(s.port, '/api/lab/nets', buf, at + 1); // corta entre los dos bytes de la Ñ
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const g = await api(`/api/lab/nets/${r.body.id}`);
    assert.equal(g.body.genome.name, name);
  });

  await check('salas: una "Ñ" partida entre dos trozos llega entera (nombre de la sala intacto)', async () => {
    const name = 'Sala Ñu';
    const buf = Buffer.from(JSON.stringify({ name }), 'utf8');
    const at = buf.indexOf(Buffer.from('Ñ', 'utf8'));
    const r = await sendSplit(s.port, '/api/rooms', buf, at + 1);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, name);
  });

  await check('salas: el tope de 100 000 se cuenta en bytes (unos 50 010 caracteres con "ñ" pasan de 100 000 bytes → 413)', async () => {
    const pad = 'ñ'.repeat(50005); // 100 010 bytes solo en el relleno
    const buf = Buffer.from(JSON.stringify({ name: 'x', pad }), 'utf8');
    assert.ok(buf.length > 100000 && JSON.stringify({ name: 'x', pad }).length < 100000, 'premisa: más de 100 000 bytes, menos de 100 000 caracteres');
    const r = await sendSplit(s.port, '/api/rooms', buf, 1000);
    assert.equal(r.status, 413, JSON.stringify(r.body));
  });
} finally { await s.stop(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: servidor)');
process.exitCode = fails ? 1 : 0;
