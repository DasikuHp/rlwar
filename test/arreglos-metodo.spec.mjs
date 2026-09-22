// Arreglo C3 (spec/04 §10.2; spec/revision-opus.md C3): "cómo aprende" (gradiente, evolución o ambos) de verdad.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-metodo.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-c3-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const { compile } = await import('../shared/nn.js');
const { normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const R = await import('../shared/reward.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { runDuel } = await import('../evo/duel.js');
const { playGame } = await import('../server/headless.js');

const NOPE = { ...TEMPLATES.seer.genome.reward, normalize: false };
const save = (key, id, patch = {}) => { const g = { ...clone(TEMPLATES[key].genome), id, name: id, ...patch }; const r = store.saveNet(g); assert.ok(r.ok, JSON.stringify(r)); return store.loadNet(id); };
const evo = (extra = {}) => ({ ...TEMPLATES.seer.genome.learning, method: 'evolution', evolution: { ...TEMPLATES.seer.genome.learning.evolution, population: 4, sigma: 0.05, lr: 0.05, gamesPerCandidate: 2, antithetic: true, rankNormalize: true, ...extra } });
const flatOf = (genome) => Array.from(compile(genome).getFlat());
const blockSlice = (genome, blockId) => { const net = compile(genome); const flat = net.getFlat(); let off = 0; for (const p of net.paramList()) { if (p.blockId === blockId) return Array.from(flat.slice(off, off + p.array.length)); off += p.array.length; } return []; };
const effMean = (genome, res) => {
  const r = R.assignRewards({ reward: genome.reward, teamSpirit: genome.traits.teamSpirit, events: res.events, trajectory: res.trajectories[res.playerId], playerId: res.playerId, stats: {} });
  return r.entries.length ? r.entries.reduce((s, e) => s + e.effective, 0) / r.entries.length : 0;
};
const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };

save('sniper', 'es-r');

await check('evolutionRound con partidas inyectadas: orden, semillas, lados, rival, antitéticas, congelados y la actualización exacta', async () => {
  const g = normalize({ ...clone(TEMPLATES.seer.genome), id: 'es-o', name: 'ES', frozen: ['ch'], reward: NOPE });
  // dos partidas reales de referencia (la red aprende a la izquierda) cuyas recompensas calcula el propio test
  const canned = [3, 4].map((seed) => { const r = playGame({ seed, left: { type: 'net', genome: g, learn: true }, right: { type: 'sniper' }, soldiers: 2 }); const p = r.room.players.find((x) => x.learn); return { playerId: p.id, events: r.events, trajectories: r.trajectories, result: r.result }; });
  const eff = canned.map((c) => effMean(g, c));
  assert.ok(eff[0] !== eff[1], `las dos partidas de referencia dan recompensas distintas (${eff})`);
  const net = compile(g); const theta = Array.from(net.getFlat());
  const rival = { type: 'sniper', level: 2 };
  const seeds = [101, 202, 303];
  const calls = [];
  const pick = (i) => (i % 3 === 0 ? 0 : 1); // la copia i recibe siempre la misma partida de referencia
  const play = async (spec) => { const i = Math.floor(calls.length / seeds.length); calls.push(spec); return canned[pick(i)]; };
  const cfg = { population: 6, sigma: 0.03, lr: 0.02, gamesPerCandidate: seeds.length, antithetic: true, rankNormalize: false, frozen: ['ch'] };
  const res = await T.evolutionRound({ net, genome: g, rival, soldiers: (j) => 1 + j, seeds, cfg, rng: makeRng(5), play });
  assert.equal(calls.length, 6 * seeds.length);
  const cands = [];
  calls.forEach((spec, c) => {
    const j = c % seeds.length;
    assert.equal(spec.seed, seeds[j], `semilla de la llamada ${c}`);
    assert.equal(spec.soldiers, 1 + j);
    const mine = j % 2 === 0 ? spec.left : spec.right, other = j % 2 === 0 ? spec.right : spec.left;
    assert.equal(mine.type, 'net'); assert.equal(mine.learn, true); assert.deepEqual(other, rival);
    if (j === 0) cands.push(flatOf(mine.genome)); else assert.deepEqual(flatOf(mine.genome), cands[cands.length - 1], 'la misma copia en todas sus partidas');
  });
  const chIdx = []; { const nn = compile(g); let off = 0; for (const p of nn.paramList()) { if (p.blockId === 'ch') for (let i = 0; i < p.array.length; i++) chIdx.push(off + i); off += p.array.length; } }
  for (const c of cands) for (const i of chIdx) assert.equal(c[i], theta[i], 'el bloque congelado no se perturba');
  for (let k = 0; k < 3; k++) cands[2 * k].forEach((v, i) => assert.ok(near(v + cands[2 * k + 1][i], 2 * theta[i], 1e-12), 'parejas antitéticas'));
  const F = cands.map((_, i) => eff[pick(i)]);
  assert.deepEqual(res.fitness.map((f) => +f.toFixed(12)), F.map((f) => +f.toFixed(12)), 'fitness = recompensa efectiva media');
  const expected = theta.map((v, i) => { let u = 0; for (let k = 0; k < 3; k++) u += (F[2 * k] - F[2 * k + 1]) * (cands[2 * k][i] - v); return v + (0.02 / (6 * 0.03)) * u; });
  const after = Array.from(net.getFlat());
  after.forEach((v, i) => assert.ok(near(v, expected[i], 1e-12), `peso ${i}: ${v} ≠ ${expected[i]}`));
  assert.equal(res.update.kind, 'evolution'); assert.equal(res.update.population, 6); assert.equal(res.update.games, 18);
  assert.ok(near(res.update.meanFitness, F.reduce((s, f) => s + f, 0) / 6, 1e-12) && near(res.update.bestFitness, Math.max(...F), 1e-12));
  assert.ok(res.lesson && typeof res.lesson.relChange === 'number' && res.lesson.blockId !== 'ch');
});

await check('evolutionRound: las estadísticas de normalización no se mueven durante el paso (todas las copias se miden igual)', async () => {
  const g = normalize({ ...clone(TEMPLATES.seer.genome), id: 'es-n', name: 'ESN' });
  g.reward.stats = { kill: { n: 7, mean: 0.3, m2: 1.2 } };
  const before = clone(g.reward.stats);
  const r = playGame({ seed: 8, left: { type: 'net', genome: g, learn: true }, right: { type: 'sniper' }, soldiers: 1 });
  const p = r.room.players.find((x) => x.learn);
  const game = { playerId: p.id, events: r.events, trajectories: r.trajectories, result: r.result };
  const res = await T.evolutionRound({ net: compile(g), genome: g, rival: { type: 'sniper' }, soldiers: 1, seeds: [1], cfg: { population: 4, sigma: 0.02, lr: 0.01, gamesPerCandidate: 1, frozen: [] }, rng: makeRng(1), play: async () => game });
  assert.deepEqual(g.reward.stats, before);
  assert.ok(res.fitness.every((f) => f === res.fitness[0]), 'misma partida, misma normalización → misma fitness');
});

await check('entreno con método evolución (turbo): pasos con copias + partida de la red real; curva solo de la real; nada de gradiente; congelados intactos; determinista', async () => {
  const mk = (id) => save('seer', id, { learning: evo(), frozen: ['ch'] });
  const g0 = mk('es-t1'); mk('es-t2');
  const cfg = (netId, workers = 1) => ({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'es-r' }, speed: 'turbo', workers, duration: { games: 18 }, soldiers: 1, seed: 7 });
  const t = T.createTrainer(cfg('es-t1')); const got = []; for (const ev of ['sleep', 'curve', 'lesson']) t.on(ev, (d) => got.push({ ev, d }));
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.equal(t.games, 18, 'copias (4×2) + red real, dos pasos'); assert.equal(t.steps, 2);
  const sleeps = got.filter((x) => x.ev === 'sleep');
  assert.equal(sleeps.length, 2); assert.ok(sleeps.every((s) => s.d.update.kind === 'evolution' && s.d.update.population === 4 && s.d.update.games === 8), JSON.stringify(sleeps.map((s) => s.d.update && s.d.update.kind)));
  assert.equal(t.curve.length, 2); assert.ok(t.curve.every((p) => p.kind === 'showcase'));
  assert.equal(t.sampleGames.length, 2, 'cada partida de la red real se guarda');
  for (const id of t.sampleGames) { const gm = store.loadGame(id); const types = new Set(gm.events.map((e) => e.type)); assert.ok(types.has('reward') && types.has('emotion'), `${id}: ${[...types]}`); }
  const saved = store.loadNet('es-t1');
  assert.deepEqual(blockSlice(saved, 'ch'), blockSlice(g0, 'ch'), 'el bloque congelado no cambia');
  assert.ok(flatOf(saved).some((v, i) => v !== flatOf(g0)[i]), 'la evolución cambia algo');
  assert.equal(saved.stats.games, 2, 'stats cuenta las partidas de la red real');
  const ups = logOf().filter((e) => e.type === 'update' && e.netId === 'es-t1');
  assert.equal(ups.length, 2); assert.ok(ups.every((e) => e.kind === 'evolution'), 'sin pasos de gradiente');
  const t2 = T.createTrainer(cfg('es-t2')); await t2.start();
  assert.deepEqual(flatOf(store.loadNet('es-t2')), flatOf(saved), 'misma semilla, mismos pesos');
});

await check('evolución con 2 hilos: mismos pesos que con 1', async () => {
  save('seer', 'es-w2', { learning: evo(), frozen: ['ch'] });
  const t = T.createTrainer({ netId: 'es-w2', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'es-r' }, speed: 'turbo', workers: 2, duration: { games: 18 }, soldiers: 1, seed: 7 });
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.deepEqual(flatOf(store.loadNet('es-w2')), flatOf(store.loadNet('es-t1')));
});

await check('evolución a x10: la partida de la red real se juega en una sala viva espectable', async () => {
  save('seer', 'es-x', { learning: evo({ population: 2, gamesPerCandidate: 1 }) });
  const t = T.createTrainer({ netId: 'es-x', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'es-r' }, speed: 'x10', duration: { games: 3 }, soldiers: 1, seed: 3 });
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.equal(t.steps, 1); assert.equal(t.rooms.length, 1, 'una sala viva: la de la red real'); assert.equal(t.curve.length, 1);
});

await check('método ambos: ciclo = partidas con gradiente + pasos de evolución', async () => {
  const learning = { ...evo({ population: 4, gamesPerCandidate: 1 }), method: 'both', both: { gradientGamesPerCycle: 4, evolutionStepsPerCycle: 1 }, gradient: { ...TEMPLATES.seer.genome.learning.gradient, batchGames: 4 } };
  save('seer', 'es-b', { learning });
  const t = T.createTrainer({ netId: 'es-b', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'es-r' }, speed: 'turbo', workers: 1, duration: { games: 9 }, soldiers: 1, seed: 11 });
  const kinds = []; t.on('sleep', (d) => kinds.push(d.update.kind));
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.equal(t.games, 9, '4 con gradiente + 4 copias + 1 de la red real');
  assert.deepEqual(kinds, ['gradient', 'evolution']);
  assert.equal(t.curve.length, 5); assert.equal(t.curve.filter((p) => p.kind === 'showcase').length, 1);
});

await check('duelo: la red de evolución no aprende partida a partida (ni en modo hot) y hace un paso de evolución al final; la de gradiente sigue igual', async () => {
  const ge = save('seer', 'es-d', { learning: evo() });
  const gg = save('seer', 'es-g', { reward: NOPE });
  const snaps = [];
  const rec = await runDuel({ a: 'es-d', b: 'es-g', learning: 'hot', speed: 'turbo', soldiers: 1, seed: 9, onGame: () => snaps.push({ d: flatOf(store.loadNet('es-d')), g: flatOf(store.loadNet('es-g')) }) });
  assert.equal(rec.status, 'done'); assert.equal(snaps.length, 6);
  for (const s of snaps) assert.deepEqual(s.d, flatOf(ge), 'durante el duelo la red de evolución no cambia');
  assert.ok(snaps[0].g.some((v, i) => v !== flatOf(gg)[i]), 'la de gradiente aprende en caliente tras la 1.ª');
  const after = store.loadNet('es-d');
  assert.ok(flatOf(after).some((v, i) => v !== flatOf(ge)[i]), 'tras el duelo, un paso de evolución');
  const ups = logOf().filter((e) => e.type === 'update' && e.netId === 'es-d');
  assert.equal(ups.length, 1); assert.equal(ups[0].kind, 'evolution'); assert.equal(ups[0].duelId, rec.id);
  const mem = after.memory && after.memory.rivals ? after.memory.rivals['es-g'] : null;
  assert.ok(mem && mem.games === 6, 'las 6 partidas del duelo entran en su memoria');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: gradiente, evolución o ambos)');
process.exitCode = fails ? 1 : 0;
