// Parte 3, casos extra por la API b (servidor propio): lo que dejó la pasada dirigida de mutantes (spec/mutantes.md
// "Parte 3"). El progreso de una cría es n·partidas (con 2 y 2, no confundible con n/partidas); la moviola de un turno
// sin decisión de disparo da la primera decisión (M3); un POST a un duelo o entreno guardado no lo devuelve (solo GET
// mira el disco, M9); borrar la reina o una campeona avisa por el canal SSE que toca (throne / dynasty).
// Uso: node test/arreglos-parte3-extra-api-b.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}${e.cause ? ` (${e.cause.code || ''} ${e.cause.message || ''})` : ''}`); fails++; }
};
const startServer = async (dir, port) => {
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  return { base, stop: () => new Promise((r) => { srv.once('exit', r); srv.kill(); }) };
};
// un GET se reintenta una vez si llega cortado por una conexión reutilizada que el servidor ya cerró (ver -extra-api)
const apiOf = (s) => async function call(p, method = 'GET', body = undefined, retry = true) {
  let res;
  try { res = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { if (retry && method === 'GET' && e.cause && e.cause.code === 'ECONNRESET') return call(p, method, body, false); throw e; }
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: res.status, body: j, text: t };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
const done = (r) => r && !['queued', 'running', 'paused'].includes(r.status);

const dir = mkdtempSync(join(tmpdir(), 'gw-evo-p3extrab-srv-'));
const port = 30000 + (process.pid % 10000);
let s = await startServer(dir, port);
let api = apiOf(s);
try {
  const a = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Otra A' })).body.id;
  const b = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Otra B' })).body.id;

  await check('cría: el progreso final es n·partidas (2 hijos × 2 partidas = 4)', async () => {
    const r = await api(`/api/lab/nets/${a}/children`, 'POST', { n: 2, pretournament: { games: 2, soldiers: 1 }, seed: 4 });
    assert.equal(r.status, 202, r.text);
    const job = await until(async () => { const x = (await api(`/api/lab/jobs/${r.body.jobId}`)).body; return x && x.status !== 'running' ? x : null; }, 120000, 'cría');
    assert.deepEqual([job.status, job.progress], ['done', { done: 4, total: 4 }]);
  });

  let duelId = null;
  await check('moviola: en un turno sin decisión de disparo, sin ?player= da la primera decisión de ese turno (M3)', async () => {
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'turbo', soldiers: 2, seed: 6 });
    duelId = d.body.id;
    const rec = await until(async () => { const x = (await api(`/api/lab/duels/${duelId}`)).body; return done(x) ? x : null; }, 120000, 'duelo');
    let found = null;
    for (const g of rec.games) {
      const game = (await api(`/api/lab/games/${g.gameId}`)).body;
      const byTurn = new Map();
      for (const e of game.events) if (e.type === 'decision' && !e.data.truncated) { if (!byTurn.has(e.turn)) byTurn.set(e.turn, []); byTurn.get(e.turn).push(e); }
      for (const [turn, list] of byTurn) if (!list.some((e) => e.data.phase === 'shoot') && game.trajectories[list[0].actor.playerId]) { found = { gameId: g.gameId, turn, first: list[0] }; break; }
      if (found) break;
    }
    assert.ok(found, 'premisa: hay un turno solo con decisiones de moverse (tras el último disparo)');
    const r = await api(`/api/lab/games/${found.gameId}/turns/${found.turn}/brain`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.decision.eventId, found.first.id);
  });

  await check('tras reiniciar, solo GET mira los duelos y entrenos guardados: un POST a su id da 404 (M9)', async () => {
    const tr = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 1 }, soldiers: 1, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    await until(async () => done((await api(`/api/lab/trainings/${tr.body.id}`)).body), 60000, 'entreno');
    await s.stop();
    s = await startServer(dir, port + 1);
    api = apiOf(s);
    assert.equal((await api(`/api/lab/duels/${duelId}`)).status, 200, 'premisa: el duelo guardado se lee');
    assert.equal((await api(`/api/lab/trainings/${tr.body.id}`)).status, 200, 'premisa: el entreno guardado se lee');
    assert.equal((await api(`/api/lab/duels/${duelId}`, 'POST', {})).status, 404);
    assert.equal((await api(`/api/lab/trainings/${tr.body.id}`, 'POST', {})).status, 404);
  });

  await check('borrar la reina avisa por el canal throne (reign.end) y borrar una campeona por el canal dynasty (champion.deleted)', async () => {
    assert.equal((await api('/api/lab/throne/challenge', 'POST', { challenger: a })).body.result, 'seated');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Uno', netId: b }, B: { name: 'Casa Dos', netId: (await api('/api/lab/nets', 'POST', { template: 'empty', name: 'Otra C' })).body.id } })).status, 200);
    const ac = new AbortController();
    const got = [];
    const res = await fetch(s.base + '/api/lab/events', { signal: ac.signal });
    const reader = res.body.getReader();
    (async () => { let buf = ''; try { for (;;) { const { value, done: end } = await reader.read(); if (end) break; buf += new TextDecoder().decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.+)$/m.exec(chunk); const data = /^data: (.+)$/m.exec(chunk); if (ev && data) got.push({ event: ev[1], data: JSON.parse(data[1]) }); } } } catch { /* cerrado */ } })();
    await until(async () => got.some((e) => e.event === 'hello'), 5000, 'hello');
    assert.equal((await api(`/api/lab/nets/${a}?force=1`, 'DELETE')).status, 200);
    assert.equal((await api(`/api/lab/nets/${b}?force=1`, 'DELETE')).status, 200);
    await until(async () => got.some((e) => e.event === 'dynasty'), 5000, 'evento dynasty');
    ac.abort();
    const thr = got.find((e) => e.event === 'throne');
    assert.ok(thr && thr.data.event === 'reign.end' && thr.data.queen === null, JSON.stringify(got.map((e) => e.event)));
    const dyn = got.find((e) => e.event === 'dynasty');
    assert.ok(dyn && dyn.data.event === 'champion.deleted' && dyn.data.house === 'A', JSON.stringify(dyn));
  });
} finally { await s.stop(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (parte 3, casos extra por la API b)');
process.exitCode = fails ? 1 : 0;
