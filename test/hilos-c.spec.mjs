// Aprender en un hilo (spec/11; decisión del usuario en la sesión 5 del 2026-09-24, "aprender en un hilo, ahora"; alcance
// y premisas cerrados en la sesión 6). Con grupo de hilos, el servidor solo coordina: el sueño del entreno (gradiente y
// empaquetado de las partidas de muestra), el aprendizaje de los duelos y el de las exhibiciones van a un hilo, a cualquier
// velocidad, así que el servidor contesta SIEMPRE, también mientras aprende, y el resultado es bit a bit el de aprender
// en el proceso. Se cronometran todas las peticiones (estado y salud), desde el POST hasta el final.
// Premisas medidas aquí mismo, en el proceso del test (sin grupo de hilos: juega y aprende en su hilo principal), con
// redes "lentas para aprender": Vidente con 64 candidatos, Simulador fino y su capa de Instinto a 256 neuronas (medido en
// la sesión 6 con la máquina libre: sueño de un lote de 8 = 1,07–1,73 s; repaso de un duelo "mix" = 1,5 s; con la capa de
// 32 neuronas y lote 4, solo 0,15–0,5 s). Lo que no se puede cronometrar (entreno x10, paso de evolución, exhibición,
// un hilo que falla) se comprueba con un espía en el grupo de hilos del propio test: qué mensajes le llegan.
// Escrito ANTES del arreglo y congelado. Uso: node test/hilos-c.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
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
const clone = (x) => JSON.parse(JSON.stringify(x));

const store = await import('../evo/store.js');
const { createTrainer, makeLearner } = await import('../evo/train.js');
const { runDuel, makePlay } = await import('../evo/duel.js');
const { LIMITS } = await import('../shared/constants.js');
const { repair } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { playGame } = await import('../server/headless.js');
const busy = await import('../evo/busy.js');

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
// una red lenta para aprender (por la API, y la misma en el almacén del test): 64 candidatos, Simulador fino y la capa de
// Instinto a 256 neuronas (sus pesos, y los de Elegir y Ajustar que cuelgan de ella, rellenados con semilla fija)
const mkSlow = async (name) => {
  const r = await api('/api/lab/nets', 'POST', { template: 'seer', name });
  assert.equal(r.status, 201, r.text);
  const g = (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
  g.imagination = { ...g.imagination, n: LIMITS.candidatesMax };
  for (const b of g.blocks) if (b.type === 'eye.simulator') b.params = { ...b.params, fine: true };
  g.blocks.find((b) => b.id === 'cd').params.units = 256;
  for (const id of ['cd', 'ch', 'aj']) delete g.weights[id];
  const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', repair(g, makeRng(1)).genome);
  assert.equal(p.status, 200, p.text);
  const out = (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
  assert.ok(store.saveNet(out).ok);
  return out;
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
// vuelve a dejar una red del almacén del test como estaba (sin estado de Adam)
const restore = (genome) => { assert.ok(store.saveNet(genome).ok); const f = join(store.netsDir(), genome.id, 'optim.json'); if (existsSync(f)) rmSync(f); };

// entreno de los puntos 1 y 2: 16 partidas en lotes de 8 (dos sueños; el primero con la partida de muestra 0)
const TRAIN = { speed: 'turbo', workers: 1, duration: { games: 16 }, soldiers: 3, seed: 17, learning: { gradient: { batchGames: 8 } } };
const DUEL = { learning: 'mix', speed: 'turbo', soldiers: 3, seed: 29 };
const local = {};

try {
  // ---------- 1. entreno turbo de 1 hilo (grupo del servidor) ----------
  await check(`entreno turbo de 1 hilo, redes lentas, lotes de 8: aprender en el proceso tarda más de ${2 * MAX_MS} ms y el servidor contesta siempre en menos de ${MAX_MS} ms; pesos, Adam, estadísticas, Imaginación y partidas de muestra, bit a bit`, async () => {
    const slow = await mkSlow('Hilo C Lenta'), slow2 = await mkSlow('Hilo C Lenta Dos');
    const cfg = { ...TRAIN, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2.id } };

    // premisa y oráculo: el mismo entreno en el proceso; lo que tarda aprender = de la última partida del lote al sueño
    const t = createTrainer({ netId: slow.id, ...cfg });
    let lastCurve = null, premise = 0;
    t.on('curve', () => { lastCurve = performance.now(); });
    t.on('sleep', () => { if (lastCurve !== null) premise = Math.max(premise, performance.now() - lastCurve); });
    await t.start();
    assert.equal(t.status, 'done', t.error || '');
    assert.equal(t.updates, 2, 'premisa: dos sueños');
    assert.ok(premise > 2 * MAX_MS, `premisa: en el proceso, aprender tarda como mucho ${Math.round(premise)} ms (hacen falta más de ${2 * MAX_MS})`);
    assert.ok(t.sampleGames.length >= 1, 'premisa: hay partida de muestra');
    local.trainPremise = premise;

    // por la API, desde el POST hasta el final
    const r = await api('/api/lab/trainings', 'POST', { netId: slow.id, ...cfg });
    assert.equal(r.status, 202, r.text);
    const { st, worst } = await watch(`/api/lab/trainings/${r.body.id}`);
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms (aprender en el proceso: ${Math.round(premise)} ms)`);

    // bit a bit
    const remote = (await api(`/api/lab/nets/${slow.id}`)).body.genome;
    assert.ok(isDeepStrictEqual(learnedPart(remote), learnedPart(store.loadNet(slow.id))), 'pesos, reward.stats o Imaginación distintos');
    assert.deepEqual(optimOf(SRV_DIR, slow.id), optimOf(LOCAL_DIR, slow.id), 'estado de Adam distinto');
    assert.equal(st.sampleGames.length, t.sampleGames.length);
    for (let i = 0; i < st.sampleGames.length; i++) {
      const gs = (await api(`/api/lab/games/${st.sampleGames[i]}`)).body, gl = store.loadGame(t.sampleGames[i]);
      assert.ok(rewardAndEmotion(gs.events).length > 0, 'premisa: la partida de muestra trae recompensas y emociones');
      assert.deepEqual(rewardAndEmotion(gs.events), rewardAndEmotion(gl.events), `partida de muestra ${i}`);
    }
    console.log(`  (aprender en el proceso: ${Math.round(premise)} ms; respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });

  // ---------- 2. entreno turbo de 2 hilos (grupo propio) ----------
  await check(`entreno turbo de 2 hilos (grupo propio), redes lentas, lotes de 8: el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    assert.ok(local.trainPremise > 2 * MAX_MS, 'premisa: la del punto anterior (mismo aprendizaje)');
    const slow = await mkSlow('Hilo C Lenta Tres'), slow2 = await mkSlow('Hilo C Lenta Cuatro');
    const r = await api('/api/lab/trainings', 'POST', { netId: slow.id, ...TRAIN, workers: 2, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2.id } });
    assert.equal(r.status, 202, r.text);
    const { st, worst } = await watch(`/api/lab/trainings/${r.body.id}`);
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms`);
    console.log(`  (respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });

  // ---------- 3. duelo turbo "mix" ----------
  await check(`duelo turbo "mix" entre redes lentas: aprender en el proceso tarda más de ${2 * MAX_MS} ms y el servidor contesta siempre en menos de ${MAX_MS} ms; pesos y Adam de las dos, bit a bit`, async () => {
    const a = await mkSlow('Hilo C Duelo A'), b = await mkSlow('Hilo C Duelo B');
    // premisa y oráculo: el mismo duelo en el proceso; lo que tarda aprender = de acabar cada partida a `onGame`, y el
    // repaso final = del último `onGame` a que acaba el duelo
    const basePlay = makePlay({ speed: 'turbo', saveGames: false });
    let played = 0, lastGame = 0, premise = 0;
    const play = async (row) => { const out = await basePlay(row); played = performance.now(); return out; };
    const rec = await runDuel({ a: a.id, b: b.id, ...DUEL, saveGames: false, play, onGame: () => { lastGame = performance.now(); premise = Math.max(premise, lastGame - played); } });
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

// ---------- 4–7. en el proceso: oráculos sin grupo de hilos y, después, un grupo con espía ----------
const mkFast = (id, template = 'seer', patch = {}) => { const g = { ...clone(TEMPLATES[template].genome), id, name: id, ...patch }; assert.ok(store.saveNet(g).ok); return store.loadNet(id); };
const X10 = { speed: 'x10', duration: { games: 2 }, soldiers: 1, seed: 7, learning: { gradient: { batchGames: 1 } } };
const x10a = mkFast('hc-x10-a'), x10b = mkFast('hc-x10-b', 'sniper');
const evoA = mkFast('hc-evo-a', 'seer', { learning: { ...clone(TEMPLATES.seer.genome).learning, method: 'evolution', evolution: { ...clone(TEMPLATES.seer.genome).learning.evolution, population: 2, gamesPerCandidate: 1 } } });
const EVO = { speed: 'turbo', workers: 1, duration: { games: 1 }, soldiers: 1, seed: 14 }; // con la 13 la red no llega a decidir en la muestra
const oracle = {};
await check('oráculos en el proceso, sin grupo de hilos: un entreno x10 y un paso de evolución (con su partida de muestra)', async () => {
  const t = createTrainer({ netId: x10a.id, ...X10, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: x10b.id } });
  await t.start();
  assert.equal(t.status, 'done', t.error || ''); assert.equal(t.updates, 2);
  oracle.x10 = { weights: clone(store.loadNet(x10a.id).weights), optim: optimOf(LOCAL_DIR, x10a.id) };
  const e = createTrainer({ netId: evoA.id, ...EVO, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: x10b.id } });
  await e.start();
  assert.equal(e.status, 'done', e.error || ''); assert.equal(e.sampleGames.length, 1, 'premisa: el paso de evolución guarda su partida de muestra');
  oracle.evo = { weights: clone(store.loadNet(evoA.id).weights), sample: rewardAndEmotion(store.loadGame(e.sampleGames[0]).events) };
  assert.ok(oracle.evo.sample.length > 0, 'premisa: la muestra trae recompensas y emociones');
});

const { useThreads } = await import('../evo/threads.js');
const pool = useThreads(2);
const sent = [];
let tamper = null;
const run0 = pool.run.bind(pool);
pool.run = (msg, onProgress) => { sent.push(msg.type); return run0(tamper ? tamper(msg) : msg, onProgress); };
const count = (type) => sent.filter((x) => x === type).length;

await check('entreno x10 con grupo de hilos: cada sueño va al grupo (un mensaje "learn" por sueño) y el resultado es bit a bit el de aprender en el proceso', async () => {
  restore(x10a); sent.length = 0;
  const t = createTrainer({ netId: x10a.id, ...X10, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: x10b.id } });
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.equal(count('learn'), t.updates, `mensajes: ${sent.join(', ')}`);
  assert.equal(t.updates, 2);
  assert.ok(isDeepStrictEqual(store.loadNet(x10a.id).weights, oracle.x10.weights), 'pesos distintos');
  assert.deepEqual(optimOf(LOCAL_DIR, x10a.id), oracle.x10.optim, 'estado de Adam distinto');
});

await check('paso de evolución con grupo de hilos: la partida de muestra se empaqueta en el grupo (mensaje "pack") y sale igual que en el proceso', async () => {
  restore(evoA); sent.length = 0;
  const e = createTrainer({ netId: evoA.id, ...EVO, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: x10b.id } });
  await e.start();
  assert.equal(e.status, 'done', e.error || '');
  assert.equal(count('pack'), 1, `mensajes: ${sent.join(', ')}`);
  assert.ok(isDeepStrictEqual(store.loadNet(evoA.id).weights, oracle.evo.weights), 'pesos distintos');
  assert.deepEqual(rewardAndEmotion(store.loadGame(e.sampleGames[0]).events), oracle.evo.sample, 'partida de muestra distinta');
});

await check('exhibición con learn:true y grupo de hilos: aprende en el grupo ("learn"), la red queda ocupada mientras tanto y acaba con los pesos de aprender en el proceso', async () => {
  const lab = await import('../evo/api.js');
  let got = null;
  for (let seed = 31; seed < 51 && !got; seed++) {
    const id = `hc-exh-${seed}`;
    const before = mkFast(id);
    const r = playGame({ seed, left: { type: 'net', netId: id, learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
    const players = r.room.players.filter((p) => p.agentType === 'net' && p.netId === id);
    const games = players.map((p) => ({ events: r.room.events, trajectory: { netId: id, soldiers: r.room.agents[p.id].trajectories }, playerId: p.id }));
    if (!games.some((g) => Object.values(g.trajectory.soldiers).some((s) => s.length))) continue; // la red no llegó a decidir
    const L = makeLearner(clone(before)); L.learn(games.map((g) => ({ ...g })));
    got = { id, want: clone(L.genome.weights), room: r.room };
  }
  assert.ok(got, 'premisa: en alguna semilla de 31 a 50 la red llega a decidir');
  sent.length = 0;
  lab.onExhibitionOver(got.room);
  assert.deepEqual(busy.heldBy(got.id), { kind: 'exhibition', id: got.room.code }, 'mientras aprende, la red está ocupada');
  const t1 = Date.now();
  while (busy.heldBy(got.id) && Date.now() - t1 < 60000) await sleep(20);
  assert.equal(busy.heldBy(got.id), null, 'al acabar queda libre');
  assert.equal(count('learn'), 1, `mensajes: ${sent.join(', ')}`);
  assert.ok(isDeepStrictEqual(store.loadNet(got.id).weights, got.want), 'pesos distintos de aprender en el proceso');
});

await check('un hilo que falla al aprender: el entreno acaba en "error" con el mensaje; el duelo falla y suelta las dos redes', async () => {
  tamper = (msg) => (msg.type === 'learn' ? { ...msg, genome: null } : msg);
  try {
    restore(x10a);
    const t = createTrainer({ netId: x10a.id, ...X10, speed: 'turbo', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: x10b.id } });
    await t.start();
    assert.equal(t.status, 'error', `estado ${t.status}`);
    assert.ok(typeof t.error === 'string' && t.error.length > 0, 'con el mensaje');
    const a = mkFast('hc-err-a'), b = mkFast('hc-err-b', 'sniper');
    await assert.rejects(runDuel({ a: a.id, b: b.id, learning: 'hot', speed: 'turbo', soldiers: 1, seed: 3, saveGames: false }));
    assert.equal(busy.heldBy(a.id), null); assert.equal(busy.heldBy(b.id), null);
  } finally { tamper = null; }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (hilos c: el servidor aprende en un hilo y contesta siempre)');
process.exit(fails ? 1 : 0);
