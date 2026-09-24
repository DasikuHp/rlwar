// Hilos para las partidas sin pantalla del servidor (auditoría de la sesión 3, 2026-09-24; decisión del usuario "hilos
// para todo"). (1) Mientras el servidor juega partidas sin pantalla (entreno turbo de 1 hilo, duelo turbo, boletín,
// pre-torneo de hijas) sigue contestando: antes se quedaba sin responder hasta 1,4 s. Para que se note siempre, se usan
// redes lentas a propósito (Imaginación de 64 candidatos y Simulador fino): cada partida en el hilo del servidor lo
// bloquearía segundos. (2) El resultado es exactamente el de jugarlo en el proceso (misma semilla, misma partida): los
// oráculos se juegan aquí, con su propia carpeta de datos y las redes tal como estaban antes. Por la API con servidor
// propio. Escrito ANTES del arreglo y congelado. Uso: node test/hilos.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-hilos-local-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const MAX_MS = 500; // antes, con redes normales: 0,86 s (boletín), 1,16 s (entreno de 1 hilo) y 1,36 s (duelo turbo)

const store = await import('../evo/store.js');
const { runBulletin } = await import('../evo/exam.js');
const { runDuel } = await import('../evo/duel.js');
const { runPretournament } = await import('../evo/children.js');
const { LIMITS } = await import('../shared/constants.js');

const port = 30000 + ((process.pid + 5000) % 10000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-hilos-srv-')) }, stdio: 'ignore' });
const t0 = Date.now();
for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
// pregunta a /api/health cada 25 ms mientras `done()` sea falso; devuelve la respuesta más lenta (ms)
const worstLatency = async (done, limitMs = 300000) => {
  let worst = 0; const t1 = Date.now();
  while (!(await done())) {
    if (Date.now() - t1 > limitMs) throw new Error('tiempo agotado');
    const a = performance.now(); await fetch(base + '/api/health'); worst = Math.max(worst, performance.now() - a);
    await sleep(25);
  }
  return worst;
};
const mkNet = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };
const genomeOf = async (id) => (await api(`/api/lab/nets/${id}`)).body.genome;
const finished = (s) => ['done', 'error', 'stopped'].includes(s);
// una red lenta a propósito: 64 candidatos y Simulador fino (cada decisión simula 64 tiros con paso 0,01)
const mkSlow = async (name) => {
  const id = await mkNet('seer', name);
  const g = await genomeOf(id);
  g.imagination = { ...g.imagination, n: LIMITS.candidatesMax };
  for (const b of g.blocks) if (b.type === 'eye.simulator') b.params = { ...b.params, fine: true };
  const r = await api(`/api/lab/nets/${id}`, 'PUT', g);
  assert.equal(r.status, 200, r.text);
  return id;
};
const runJob = async (path, body) => {
  const r = await api(path, 'POST', body);
  assert.equal(r.status, 202, r.text);
  let j = null;
  const worst = await worstLatency(async () => { j = (await api(`/api/lab/jobs/${r.body.jobId}`)).body; return finished(j.status); });
  assert.equal(j.status, 'done', JSON.stringify(j).slice(0, 300));
  return { job: j, worst };
};

try {
  const slow = await mkSlow('Hilo Lenta'), slow2 = await mkSlow('Hilo Lenta Dos');

  await check(`entreno turbo de 1 hilo con una red lenta: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    const r = await api('/api/lab/trainings', 'POST', { netId: slow, speed: 'turbo', workers: 1, duration: { games: 4 }, soldiers: 2, seed: 71, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2 } });
    assert.equal(r.status, 202, r.text);
    let st = null;
    const worst = await worstLatency(async () => { st = (await api(`/api/lab/trainings/${r.body.id}`)).body; return finished(st.status); });
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
  });

  await check(`duelo turbo entre redes lentas: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    const r = await api('/api/lab/duels', 'POST', { a: slow, b: slow2, speed: 'turbo', learning: 'frozen', soldiers: 2, seed: 29 });
    assert.equal(r.status, 202, r.text);
    let d = null;
    const worst = await worstLatency(async () => { d = (await api(`/api/lab/duels/${r.body.id}`)).body; return finished(d.status); });
    assert.equal(d.status, 'done', JSON.stringify(d).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
  });

  await check(`boletín de una red lenta: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    const { worst } = await runJob(`/api/lab/nets/${slow}/bulletin`, {});
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
  });

  await check(`pre-torneo de una hija de una red lenta: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    const { worst } = await runJob(`/api/lab/nets/${slow}/children`, { n: 1, seed: 31, pretournament: { games: 4, soldiers: 2, opponentId: slow2 } });
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
  });

  const seer = await mkNet('seer', 'Hilo Vidente');
  const sniper = await mkNet('sniper', 'Hilo Tirador');
  const gSeer = await genomeOf(seer), gSniper = await genomeOf(sniper); // tal como están antes de cualquier duelo

  await check('duelo turbo: cada partida sale igual que jugada en el proceso con las mismas redes', async () => {
    const r = await api('/api/lab/duels', 'POST', { a: seer, b: sniper, speed: 'turbo', learning: 'frozen', soldiers: 2, seed: 17 });
    assert.equal(r.status, 202, r.text);
    let d = null;
    while (!d || !finished(d.status)) { await sleep(100); d = (await api(`/api/lab/duels/${r.body.id}`)).body; }
    assert.equal(d.status, 'done', JSON.stringify(d).slice(0, 300));
    assert.ok(store.saveNet(gSeer).ok && store.saveNet(gSniper).ok);
    const local = await runDuel({ a: seer, b: sniper, learning: 'frozen', speed: 'turbo', soldiers: 2, seed: 17, saveGames: false, league: false });
    const view = (games) => games.map((g) => [g.seed, g.left, g.right, g.winner, g.kills[seer], g.kills[sniper]]);
    assert.deepEqual(view(d.games), view(local.games));
  });

  await check('boletín: las notas y los detalles son los de runBulletin en el proceso', async () => {
    const g = await genomeOf(seer);
    const { job } = await runJob(`/api/lab/nets/${seer}/bulletin`, {});
    const local = await runBulletin(g);
    for (const k of ['aim', 'cover', 'survival', 'adaptation', 'details', 'seeds']) assert.deepEqual(job.result[k], local[k], k);
  });

  await check('entreno turbo de 1 hilo: los pesos finales son bit a bit los de entrenar en el proceso con la misma receta', async () => {
    const learner = await mkNet('sniper', 'Hilo Alumna');
    const g0 = await genomeOf(learner), rival = await genomeOf(seer);
    const cfg = { speed: 'turbo', workers: 1, duration: { games: 12 }, soldiers: 2, seed: 83, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: seer } };
    const r = await api('/api/lab/trainings', 'POST', { netId: learner, ...cfg });
    assert.equal(r.status, 202, r.text);
    let st = null;
    while (!st || !finished(st.status)) { await sleep(100); st = (await api(`/api/lab/trainings/${r.body.id}`)).body; }
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    const remote = await genomeOf(learner);
    assert.ok(store.saveNet(g0).ok && store.saveNet(rival).ok);
    const { createTrainer } = await import('../evo/train.js');
    const t = createTrainer({ netId: learner, ...cfg });
    await t.start();
    assert.equal(t.status, 'done', t.error || '');
    assert.ok(isDeepStrictEqual(store.loadNet(learner).weights, remote.weights), 'los pesos finales no coinciden');
    assert.notDeepEqual(remote.weights, g0.weights, 'premisa: el entreno cambió los pesos');
  });

  await check('pre-torneo de hijas: cada hija saca lo mismo que jugando en el proceso', async () => {
    const opponent = await genomeOf(sniper);
    const { job } = await runJob(`/api/lab/nets/${seer}/children`, { n: 3, seed: 23, pretournament: { games: 4, soldiers: 2, opponentId: sniper } });
    const children = [];
    for (const row of job.result.ranking) children.push(await genomeOf(row.id));
    const local = runPretournament({ children, opponent, games: 4, seed: 23, soldiers: 2 });
    const byId = (ranking) => Object.fromEntries(ranking.map((x) => [x.id, [x.wins, x.kills, x.deaths]]));
    assert.deepEqual(byId(job.result.ranking), byId(local.ranking));
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (hilos: el servidor contesta mientras juega y el resultado es el mismo)');
process.exit(fails ? 1 : 0);
