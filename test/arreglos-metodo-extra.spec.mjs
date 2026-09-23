// Casos extra del método de aprendizaje (spec/04 §10.2; spec/mutantes.md, R2): los huecos que dejaron los mutantes
// de C3 y C4. Fija con oráculo exacto (1) las semillas, el ruido y el lado de la partida de la red real en un paso
// de evolución de un entreno, (2) `perBlock` y `top` recalculados desde los pesos de antes y de después, (3) que
// tras un duelo la fitness se mide sobre la red y no sobre la rival (semillas y soldados del duelo incluidos) y
// (4) la referencia `value` y la normalización (estadísticas que comparten las partidas de un lote) dentro de
// `learnFromGames`. También `gamesPerCandidate = 1`, el mínimo que admite el genoma. Congelado.
// Uso: node test/arreglos-metodo-extra.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-metodo-extra-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

const { compile } = await import('../shared/nn.js');
const { normalize, BLOCKS } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const R = await import('../shared/reward.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { runDuel } = await import('../evo/duel.js');
const { playGame } = await import('../server/headless.js');

const save = (key, id, patch = {}) => { const g = { ...clone(TEMPLATES[key].genome), id, name: id, ...patch }; const r = store.saveNet(g); assert.ok(r.ok, JSON.stringify(r)); return store.loadNet(id); };
// la plantilla con algunos bloques escalados (p. ej. {v: 0} → todo a cero; {fm: 0.1} → norma < 1)
const saveScaled = (key, id, patch, scales) => {
  const g = normalize({ ...clone(TEMPLATES[key].genome), id, name: id, ...patch }); const net = compile(g); const flat = net.getFlat(); let off = 0;
  for (const p of net.paramList()) { const k = scales[p.blockId]; if (k !== undefined) for (let i = 0; i < p.array.length; i++) flat[off + i] *= k; off += p.array.length; }
  net.setFlat(flat);
  return save(key, id, { ...patch, weights: net.serialize() });
};
const NOPE = { ...TEMPLATES.seer.genome.reward, normalize: false };
const evo = (extra = {}) => ({ ...TEMPLATES.seer.genome.learning, method: 'evolution', evolution: { ...TEMPLATES.seer.genome.learning.evolution, population: 4, sigma: 0.05, lr: 0.05, gamesPerCandidate: 2, antithetic: true, rankNormalize: true, ...extra } });
const flatOf = (genome) => Array.from(compile(genome).getFlat());
const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const sameFlat = (got, want, what) => { assert.equal(got.length, want.length, `${what}: longitud`); got.forEach((v, i) => assert.ok(near(v, want[i]), `${what}: peso ${i} ${v} ≠ ${want[i]}`)); };
// oráculo de perBlock/top (spec/04 §4): por bloque, ‖después − antes‖ / máx(1e-8, ‖antes‖); top = el mayor (el primero si empatan)
const blockChangesOf = (genome, before, after) => {
  const net = compile(genome); const perBlock = {}; let off = 0;
  for (const p of net.paramList()) {
    const b = perBlock[p.blockId] || (perBlock[p.blockId] = { name: BLOCKS[genome.blocks.find((x) => x.id === p.blockId).type].name, d2: 0, w2: 0 });
    for (let i = 0; i < p.array.length; i++) { b.d2 += (after[off + i] - before[off + i]) ** 2; b.w2 += before[off + i] ** 2; }
    off += p.array.length;
  }
  let top = null;
  for (const [id, b] of Object.entries(perBlock)) { b.relChange = Math.sqrt(b.d2) / Math.max(1e-8, Math.sqrt(b.w2)); delete b.d2; delete b.w2; if (!top || b.relChange > top.relChange) top = { blockId: id, name: b.name, relChange: b.relChange }; }
  return { perBlock, top };
};
const samePerBlock = (got, want) => {
  assert.deepEqual(Object.keys(got.perBlock).sort(), Object.keys(want.perBlock).sort(), 'los mismos bloques');
  for (const [id, b] of Object.entries(want.perBlock)) { assert.equal(got.perBlock[id].name, b.name, `nombre de ${id}`); assert.ok(near(got.perBlock[id].relChange, b.relChange), `relChange de ${id}: ${got.perBlock[id].relChange} ≠ ${b.relChange}`); }
  assert.equal(got.top.blockId, want.top.blockId, 'top'); assert.equal(got.top.name, want.top.name); assert.ok(near(got.top.relChange, want.top.relChange), 'relChange de top');
};

save('sniper', 'mx-r');
const S = 7, POP = 4, NG = 2;
const trainCfg = (netId, steps, nG = NG) => ({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'mx-r' }, speed: 'turbo', workers: 1, duration: { games: steps * (POP * nG + 1) }, soldiers: 1, seed: S });
// semilla y lado de la partida de la red real del paso e, leídos de la meta de la partida guardada y de su game.start
const realGameOf = (gameId, netId, e, seed) => {
  const gm = store.loadGame(gameId);
  assert.equal(gm.meta.seed, seed, `semilla del paso ${e}`);
  const [me, rival] = e % 2 === 0 ? [gm.meta.left, gm.meta.right] : [gm.meta.right, gm.meta.left];
  assert.equal(me, netId, `lado de la red en el paso ${e}`); assert.equal(rival, 'mx-r');
  const start = gm.events.find((ev) => ev.type === 'game.start');
  assert.equal(start.data.seed, seed, 'la partida se jugó con esa semilla');
  assert.equal(start.data.players.find((p) => p.netId === netId).team, e % 2 === 0 ? 'left' : 'right');
};

// ---------- (1) y (2): el paso de evolución de un entreno ----------
await check('entreno, paso 0: copias con semillas seed + 100003·(e+1) + j y ruido makeRng(seed + 7·(e+1)) → pesos guardados y fitness del sueño del oráculo; perBlock y top recalculados desde los pesos (con un bloque a cero y otro de norma < 1); la red real juega con seed + 100003 + gamesPerCandidate a la izquierda', async () => {
  const g0 = saveScaled('seer', 'mx-t1', { learning: evo(), frozen: ['ch'] }, { v: 0, fm: 0.1 });
  const t = T.createTrainer(trainCfg('mx-t1', 1)); const sleeps = []; t.on('sleep', (d) => sleeps.push(d));
  await t.start();
  assert.equal(t.status, 'done', t.error || ''); assert.equal(t.steps, 1);
  const g = normalize(clone(g0)); const net = compile(g);
  const want = await T.evolutionRound({ net, genome: g, rival: { type: 'net', genome: store.loadNet('mx-r') }, soldiers: 1, seeds: [S + 100003 + 0, S + 100003 + 1], cfg: { ...g.learning.evolution, frozen: g.frozen }, rng: makeRng(S + 7) });
  const saved = store.loadNet('mx-t1');
  sameFlat(flatOf(saved), Array.from(net.getFlat()), 'pesos tras el paso 0');
  assert.equal(sleeps.length, 1); const up = sleeps[0].update;
  assert.equal(up.kind, 'evolution'); assert.equal(up.step, 0); assert.equal(up.population, POP); assert.equal(up.games, POP * NG);
  assert.ok(near(up.meanFitness, want.update.meanFitness) && near(up.bestFitness, want.update.bestFitness), `fitness ${up.meanFitness}/${up.bestFitness} ≠ ${want.update.meanFitness}/${want.update.bestFitness}`);
  const oracle = blockChangesOf(g, flatOf(g0), flatOf(saved));
  samePerBlock(up, oracle);
  assert.equal(oracle.perBlock.ch.relChange, 0, 'el bloque congelado no cambia');
  const normOf = (id) => { const n0 = compile(g0); const f = n0.getFlat(); let off = 0, w2 = 0; for (const q of n0.paramList()) { if (q.blockId === id) for (let i = 0; i < q.array.length; i++) w2 += f[off + i] ** 2; off += q.array.length; } return Math.sqrt(w2); };
  assert.equal(normOf('v'), 0, 'el bloque v empieza a cero'); assert.ok(normOf('fm') > 0 && normOf('fm') < 1, `el bloque fm tiene norma < 1 (${normOf('fm')})`);
  assert.ok(oracle.perBlock.v.relChange > 1e3, 'con norma 0, el cambio relativo se divide entre 1e-8');
  const lesson = logOf().find((e) => e.type === 'lesson' && e.netId === 'mx-t1');
  assert.ok(lesson, 'hay lección'); assert.equal(lesson.blockId, oracle.top.blockId); assert.ok(near(lesson.relChange, oracle.top.relChange));
  assert.equal(lesson.bulb, oracle.top.relChange > g.learning.sleep.lessonThreshold, 'bombilla = relChange > umbral');
  assert.equal(t.sampleGames.length, 1); realGameOf(t.sampleGames[0], 'mx-t1', 0, S + 100003 + NG);
});

await check('entreno con gamesPerCandidate = 1, tres pasos: POP partidas de copias por paso; pesos del oráculo encadenando los tres pasos (semillas seed + 100003·(e+1), ruido makeRng(seed + 7·(e+1))); la red real juega con seed + 100003·(e+1) + 1, a la izquierda en los pasos pares (0 y 2) y a la derecha en el impar', async () => {
  const g0 = save('seer', 'mx-t2', { learning: evo({ gamesPerCandidate: 1 }), frozen: ['ch'], reward: NOPE });
  const t = T.createTrainer(trainCfg('mx-t2', 3, 1)); const sleeps = []; t.on('sleep', (d) => sleeps.push(d));
  await t.start();
  assert.equal(t.status, 'done', t.error || ''); assert.equal(t.steps, 3); assert.equal(t.games, 3 * (POP + 1));
  assert.deepEqual(sleeps.map((d) => d.update.games), [POP, POP, POP]);
  assert.equal(t.sampleGames.length, 3);
  for (const e of [0, 1, 2]) realGameOf(t.sampleGames[e], 'mx-t2', e, S + 100003 * (e + 1) + 1);
  // sin normalización, lo que la red real deja entre paso y paso (memoria, stats) no cambia cómo juegan las copias
  const g = normalize(clone(g0)); const net = compile(g); const rival = { type: 'net', genome: store.loadNet('mx-r') };
  for (const e of [0, 1, 2]) await T.evolutionRound({ net, genome: g, rival, soldiers: 1, seeds: [S + 100003 * (e + 1)], cfg: { ...g.learning.evolution, frozen: g.frozen }, rng: makeRng(S + 7 * (e + 1)) });
  sameFlat(flatOf(store.loadNet('mx-t2')), Array.from(net.getFlat()), 'pesos tras los tres pasos');
});

// ---------- (3) tras un duelo: fitness de la red, no de la rival ----------
await check('duelo: el paso del final usa semillas duelSeed + 100003 + j, soldados 1 + makeRng(duelSeed + 100003 + j).int(4) si son "random", ruido makeRng(duelSeed + 7) y la rival con learn:false → pesos y fitness del oráculo (medida sobre la red)', async () => {
  const pre = save('seer', 'mx-d', { learning: evo() });
  save('seer', 'mx-g');
  const seed = 9;
  const rec = await runDuel({ a: 'mx-d', b: 'mx-g', learning: 'frozen', speed: 'turbo', soldiers: 'random', seed });
  assert.equal(rec.status, 'done');
  const after = store.loadNet('mx-d');
  // la red tal como estaba al dar el paso: lo de después (memoria, estadísticas) con los pesos de antes (no cambian en el duelo)
  const g = normalize({ ...clone(after), weights: clone(pre.weights) }); const net = compile(g);
  const rivalEnd = store.loadNet('mx-g');
  const want = await T.evolutionRound({ net, genome: g, rival: { type: 'net', genome: rivalEnd, name: rivalEnd.name, learn: false }, soldiers: (j) => 1 + makeRng(seed + 100003 + j).int(4), seeds: [seed + 100003, seed + 100003 + 1], cfg: { ...g.learning.evolution, frozen: g.frozen }, rng: makeRng(seed + 7) });
  sameFlat(flatOf(after), Array.from(net.getFlat()), 'pesos tras el paso del duelo');
  const up = logOf().find((e) => e.type === 'update' && e.netId === 'mx-d' && e.duelId === rec.id);
  assert.ok(up, 'línea update del paso'); assert.equal(up.kind, 'evolution'); assert.equal(up.games, POP * NG);
  assert.ok(near(up.meanFitness, want.update.meanFitness) && near(up.bestFitness, want.update.bestFitness), `fitness ${up.meanFitness}/${up.bestFitness} ≠ ${want.update.meanFitness}/${want.update.bestFitness}`);
  assert.equal(want.fitness.length, POP);
});

await check('makeLearner.evolve con gamesPerCandidate = 1: una partida por copia, con semilla seed + 100003, sus soldados y la rival tal cual', async () => {
  const L = T.makeLearner(save('seer', 'mx-e1', { learning: evo({ gamesPerCandidate: 1 }) }));
  const rival = { type: 'greedy', level: 1 };
  const calls = [];
  const play = async (spec) => { calls.push(spec); return { playerId: null, events: [], trajectories: {} }; };
  const out = await L.evolve({ rival, seed: 40, soldiers: 2, play });
  assert.equal(calls.length, POP); assert.equal(out.update.games, POP);
  for (const c of calls) {
    assert.equal(c.seed, 40 + 100003); assert.equal(c.soldiers, 2);
    assert.equal(c.left.type, 'net'); assert.equal(c.left.learn, true); assert.deepEqual(c.right, rival);
  }
});

// ---------- (4) learnFromGames: la referencia value y la normalización ----------
await check('learnFromGames con baseline value y catorce partidas en el lote: V = el value de cada decisión y ventaja = retorno − value; las recompensas se normalizan con estadísticas nuevas que comparten las partidas, en orden (el lote pasa de 20 observaciones de un término, así que la normalización actúa)', async () => {
  const g = normalize({ ...clone(TEMPLATES.seer.genome), id: 'mx-v', name: 'MX V' });
  assert.equal(g.learning.gradient.baseline, 'value'); assert.ok(g.reward.normalize, 'la plantilla normaliza');
  assert.equal(g.reward.stats, undefined, 'sin estadísticas todavía');
  // cambio (P1, 2026-09-24; misma causa que la semilla 5, con el arreglo aprobado para ella): con el mapa de círculos,
  // las semillas fijas daban partidas cortas o empatadas por el tope y el lote no pasaba de 20 observaciones de ningún
  // término; se toman las 14 primeras partidas desde la 3 en las que los dos soldados de la red deciden y mueren (pierde):
  // así "perder" y "morir" se observan 28 veces y la normalización actúa
  const games = [];
  for (let seed = 3; games.length < 14 && seed < 300; seed++) {
    const r = playGame({ seed, left: { type: 'net', genome: g, learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 2 });
    const p = r.room.players.find((x) => x.learn);
    const sol = r.trajectories[p.id].soldiers;
    const deciders = Object.keys(sol).filter((id) => sol[id].length);
    const dead = new Set(r.events.filter((e) => e.type === 'death' && e.actor.playerId === p.id).map((e) => e.actor.soldierId));
    if (deciders.length === 2 && deciders.every((id) => dead.has(id))) games.push({ events: r.events, trajectory: r.trajectories[p.id], playerId: p.id });
  }
  assert.equal(games.length, 14, 'premisa: 14 partidas en las que los dos soldados de la red deciden y mueren');
  const stats = {}; // las comparten las partidas del lote, en orden
  const want = new Map();
  games.forEach((game, gi) => {
    const oracle = R.assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectory, playerId: game.playerId, stats });
    assert.ok(oracle.entries.length >= 3, `decisiones suficientes en la partida ${gi} (${oracle.entries.length})`);
    const bySoldier = {};
    for (const e of oracle.entries) (bySoldier[e.soldierId] ||= []).push(e);
    for (const list of Object.values(bySoldier)) {
      list.sort((a, b) => a.decision.eventId - b.decision.eventId);
      const G = R.returns(Float64Array.from(list, (e) => e.effective), g.learning.gradient.gamma);
      list.forEach((e, t) => { assert.equal(typeof e.decision.value, 'number'); want.set(`${gi}|${e.decision.eventId}`, { V: e.decision.value, A: G[t] - e.decision.value }); });
    }
  });
  const most = Math.max(...Object.values(stats).map((s) => s.n));
  assert.ok(most > 22, `el lote pasa de 20 observaciones de un término con margen (${most}); si no, normalizeStats no normaliza`);
  const net = compile(g);
  const out = T.learnFromGames({ net, genome: g, games, optim: T.adamInit(net) });
  assert.equal(out.emotions.length, want.size);
  for (const em of out.emotions) {
    const w = want.get(`${em.game}|${em.decisionEventId}`);
    assert.ok(w, `decisión ${em.game}|${em.decisionEventId}`);
    assert.equal(em.valueSource, 'value');
    assert.equal(em.V, w.V, `V de ${em.decisionEventId}`);
    assert.ok(near(em.advantage, w.A), `ventaja de ${em.decisionEventId}: ${em.advantage} ≠ ${w.A}`);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: método de aprendizaje, casos extra)');
process.exitCode = fails ? 1 : 0;
