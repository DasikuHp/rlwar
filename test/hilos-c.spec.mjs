// ⚠ BORRADOR (sesión 5): NUNCA EJECUTADO, sin congelar y fuera de run-all. Antes de usarlo, medir las premisas (lote 4 o
// 8, duelo "mix") y ajustar números; ver spec/relevo-2026-09-24-s5.md, pendiente 1. Quitar este aviso al congelarlo.
// Aprender en un hilo (spec/11, sesión 5 del 2026-09-24; decisión del usuario "aprender en un hilo, ahora"). Con grupo de
// hilos, el servidor solo coordina: el sueño del entreno (gradiente y empaquetado de la partida de muestra) y el
// aprendizaje de los duelos van a un hilo, así que el servidor contesta SIEMPRE, también mientras aprende, y el resultado
// es bit a bit el de aprender en el proceso. Se cronometran todas las peticiones (estado y salud). Las premisas se miden
// aquí mismo, en el proceso del test (sin grupo de hilos: juega y aprende en su hilo principal): lo que tarda aprender
// pasa de 2·MAX_MS. Escrito ANTES del arreglo y congelado. Uso: node test/hilos-c.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-hilos-c-local-'));
const LOCAL_DIR = process.env.GW_EVO_DIR;
const SRV_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-hilos-c-srv-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const MAX_MS = 500; // el mismo límite que hilos.spec y hilos-b

const store = await import('../evo/store.js');
const { createTrainer } = await import('../evo/train.js');
const { runDuel, makePlay } = await import('../evo/duel.js');
const { LIMITS } = await import('../shared/constants.js');

const port = 30000 + ((process.pid + 9000) % 10000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: SRV_DIR }, stdio: 'ignore' });
const t0 = Date.now();
for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
// una red lenta a propósito (como en hilos.spec): 64 candidatos y Simulador fino
const mkSlow = async (name) => {
  const r = await api('/api/lab/nets', 'POST', { template: 'seer', name });
  assert.equal(r.status, 201, r.text);
  const g = (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
  g.imagination = { ...g.imagination, n: LIMITS.candidatesMax };
  for (const b of g.blocks) if (b.type === 'eye.simulator') b.params = { ...b.params, fine: true };
  const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', g);
  assert.equal(p.status, 200, p.text);
  return (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
};
const finished = (s) => ['done', 'error', 'stopped'].includes(s);
// sigue `path` hasta que acaba, cronometrando todas las peticiones (la de estado y la de salud) → {st, worst}
const watch = async (path) => {
  let worst = 0, st = null;
  const timed = async (f) => { const a = performance.now(); const v = await f(); worst = Math.max(worst, performance.now() - a); return v; };
  const t1 = Date.now();
  for (;;) {
    st = (await timed(() => api(path))).body;
    if (finished(st.status)) break;
    if (Date.now() - t1 > 600000) throw new Error('tiempo agotado');
    await timed(() => fetch(base + '/api/health'));
    await sleep(25);
  }
  return { st, worst };
};
const optimOf = (dir, id) => { const f = join(dir, 'nets', id, 'optim.json'); assert.ok(existsSync(f), `falta ${f}`); return JSON.parse(readFileSync(f, 'utf8')); };
const learnedPart = (g) => ({ weights: g.weights, stats: g.reward.stats, usage: g.imagination.usage, families: g.imagination.families });
const rewardAndEmotion = (events) => events.filter((e) => e.type === 'reward' || e.type === 'emotion').map((e) => [e.type, e.data]);

// el entreno de los puntos 1 y 4 (partidas y aprendizaje: en el proceso, en este hilo)
const TRAIN = { speed: 'turbo', workers: 1, duration: { games: 8 }, soldiers: 3, seed: 17 };
let trainPremise = 0;

try {
  await check(`entreno turbo de 1 hilo, redes lentas, lote de 4: aprender en el proceso tarda más de ${2 * MAX_MS} ms y el servidor contesta siempre en menos de ${MAX_MS} ms; pesos, Adam, estadísticas, Imaginación y partida de muestra, bit a bit`, async () => {
    const slow = await mkSlow('Hilo C Lenta'), slow2 = await mkSlow('Hilo C Lenta Dos');
    const cfg = { ...TRAIN, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2.id } };

    // premisa y oráculo: el mismo entreno en el proceso; lo que tarda aprender = de la última partida del lote al sueño
    assert.ok(store.saveNet(slow).ok && store.saveNet(slow2).ok);
    const local = createTrainer({ netId: slow.id, ...cfg });
    let lastCurve = null;
    local.on('curve', () => { lastCurve = performance.now(); });
    local.on('sleep', () => { if (lastCurve !== null) trainPremise = Math.max(trainPremise, performance.now() - lastCurve); });
    await local.start();
    assert.equal(local.status, 'done', local.error || '');
    assert.ok(trainPremise > 2 * MAX_MS, `premisa: en el proceso, aprender tarda como mucho ${Math.round(trainPremise)} ms (hacen falta más de ${2 * MAX_MS})`);
    assert.ok(local.sampleGames.length >= 1, 'premisa: hay partida de muestra');

    // por la API, desde el POST hasta el final
    const r = await api('/api/lab/trainings', 'POST', { netId: slow.id, ...cfg });
    assert.equal(r.status, 202, r.text);
    const { st, worst } = await watch(`/api/lab/trainings/${r.body.id}`);
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms (aprender en el proceso: ${Math.round(trainPremise)} ms)`);

    // bit a bit (punto 4)
    const remote = (await api(`/api/lab/nets/${slow.id}`)).body.genome;
    assert.ok(isDeepStrictEqual(learnedPart(remote), learnedPart(store.loadNet(slow.id))), 'pesos, reward.stats o Imaginación distintos');
    assert.deepEqual(optimOf(SRV_DIR, slow.id), optimOf(LOCAL_DIR, slow.id), 'estado de Adam distinto');
    assert.equal(st.sampleGames.length, local.sampleGames.length);
    for (let i = 0; i < st.sampleGames.length; i++) {
      const gs = (await api(`/api/lab/games/${st.sampleGames[i]}`)).body, gl = store.loadGame(local.sampleGames[i]);
      assert.ok(rewardAndEmotion(gs.events).length > 0, 'premisa: la partida de muestra trae recompensas y emociones');
      assert.deepEqual(rewardAndEmotion(gs.events), rewardAndEmotion(gl.events), `partida de muestra ${i}`);
    }
    console.log(`  (aprender en el proceso: ${Math.round(trainPremise)} ms; respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });

  await check(`entreno turbo de 2 hilos (grupo propio), redes lentas, lote de 4: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    assert.ok(trainPremise > 2 * MAX_MS, 'premisa: la del punto anterior (mismo aprendizaje)');
    const slow = await mkSlow('Hilo C Lenta Tres'), slow2 = await mkSlow('Hilo C Lenta Cuatro');
    const r = await api('/api/lab/trainings', 'POST', { netId: slow.id, ...TRAIN, workers: 2, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2.id } });
    assert.equal(r.status, 202, r.text);
    const { st, worst } = await watch(`/api/lab/trainings/${r.body.id}`);
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
    console.log(`  (respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });

  await check(`duelo turbo "mix" entre redes lentas: aprender en el proceso tarda más de ${2 * MAX_MS} ms y el servidor contesta siempre en menos de ${MAX_MS} ms; pesos y Adam de las dos, bit a bit`, async () => {
    const a = await mkSlow('Hilo C Duelo A'), b = await mkSlow('Hilo C Duelo B');
    const DUEL = { learning: 'mix', speed: 'turbo', soldiers: 3, seed: 29 };
    // premisa y oráculo: el mismo duelo en el proceso; lo que tarda aprender = de acabar cada partida a `onGame`, y el
    // repaso final = del último `onGame` a que acaba el duelo
    assert.ok(store.saveNet(a).ok && store.saveNet(b).ok);
    const basePlay = makePlay({ speed: 'turbo', saveGames: false });
    let played = 0, lastGame = 0, premise = 0;
    const play = async (row) => { const out = await basePlay(row); played = performance.now(); return out; };
    const rec = await runDuel({ a: a.id, b: b.id, ...DUEL, saveGames: false, league: false, play, onGame: () => { lastGame = performance.now(); premise = Math.max(premise, lastGame - played); } });
    premise = Math.max(premise, performance.now() - lastGame);
    assert.equal(rec.status, 'done');
    assert.ok(premise > 2 * MAX_MS, `premisa: en el proceso, aprender en el duelo tarda como mucho ${Math.round(premise)} ms (hacen falta más de ${2 * MAX_MS})`);

    const r = await api('/api/lab/duels', 'POST', { a: a.id, b: b.id, ...DUEL });
    assert.equal(r.status, 202, r.text);
    const { st, worst } = await watch(`/api/lab/duels/${r.body.id}`);
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms (aprender en el proceso: ${Math.round(premise)} ms)`);
    for (const g of [a, b]) {
      const remote = (await api(`/api/lab/nets/${g.id}`)).body.genome;
      assert.ok(isDeepStrictEqual(remote.weights, store.loadNet(g.id).weights), `pesos distintos (${g.name})`);
      assert.deepEqual(optimOf(SRV_DIR, g.id), optimOf(LOCAL_DIR, g.id), `estado de Adam distinto (${g.name})`);
    }
    console.log(`  (aprender en el proceso: ${Math.round(premise)} ms; respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (hilos c: el servidor aprende en un hilo y contesta siempre)');
process.exit(fails ? 1 : 0);
