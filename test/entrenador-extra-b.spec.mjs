// F4 — Entrenador (evo/train.js), tercera tanda tras la segunda prueba de mutantes: referencia media exacta,
// estadísticas exactas del gradiente (entropía, valueLoss), optim.mean se crea, semilla aleatoria amplia,
// velocidad de las salas x10/x1, mezcla de rivales no normalizada, estadísticas de normalización guardadas.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-extra3-'));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const { normalize, newGenome } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { playGame } = await import('../server/headless.js');
const { rooms } = await import('../server/rooms.js');
const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const clone = (v) => JSON.parse(JSON.stringify(v));
const save = (key, id, patch = {}) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), ...patch, id, name: id }); assert.ok(r.ok, JSON.stringify(r)); return id; };

await check('computeAdvantages (media): el estado lleva n exacto y media móvil 0.05; la ventaja usa la media anterior', () => {
  const eps = [1, 2, 3].map((r) => ({ steps: [{ reward: r }] }));
  const state = { mean: 0, n: 0 };
  T.computeAdvantages(eps, null, { gamma: 1, baseline: 'mean' }, state);
  assert.equal(state.n, 3);
  const m1 = 0.05 * 1, m2 = m1 + 0.05 * (2 - m1), m3 = m2 + 0.05 * (3 - m2);
  assert.ok(near(state.mean, m3), `media ${state.mean} esperada ${m3}`);
  assert.ok(near(eps[0].steps[0].advantage, 1 - 0) && near(eps[1].steps[0].advantage, 2 - m1) && near(eps[2].steps[0].advantage, 3 - m2));
});

await check('policyGradient: con puntuaciones iguales la entropía es ln N por paso, valueLoss = ½(V−G)² y loss = −ln p·A − βH + valueLoss', () => {
  const g = normalize(newGenome({ id: 'exacto-1', name: 'exacto', imagination: { n: 4 },
    blocks: [B('f', 'eye.features'), B('c', 'eye.candidates'), B('ch', 'hand.choose'), B('dv', 'dense', { units: 3, activation: 'tanh' }), B('v', 'hand.value')],
    wires: [W('c', 'ch'), W('f', 'dv'), W('dv', 'v')] }, makeRng(2)));
  g.weights.ch.W = g.weights.ch.W.map(() => 0); g.weights.ch.b = [0];
  const net = compile(g);
  const cand = Array.from({ length: 4 }, (_, i) => Float64Array.from({ length: 12 }, (_, j) => (j === i ? 1 : 0)));
  const f = new Float64Array(26); f[0] = 0.5; f[3] = -0.25;
  const obs = { ctx: { f }, cand: { c: cand }, move: {}, team: {} };
  const V = net.forward(obs, net.zeroState()).outputs.value;
  assert.ok(typeof V === 'number' && Number.isFinite(V));
  const episodes = [{ steps: [{ obs, phase: 'shoot', chosen: 2, reward: 1 }] }];
  T.computeAdvantages(episodes, [Float64Array.from([V])], { gamma: 1, baseline: 'value' });
  assert.ok(near(episodes[0].steps[0].ret, 1) && near(episodes[0].steps[0].advantage, 1 - V));
  const beta = 0.01;
  const { stats } = T.policyGradient(net, g, episodes, { entropy: beta, baseline: 'value', bpttSteps: 8 });
  assert.equal(stats.steps, 1);
  assert.ok(near(stats.entropy, Math.log(4), 1e-9), `entropía ${stats.entropy} esperada ln 4`);
  assert.ok(near(stats.valueLoss, 0.5 * (V - 1) ** 2, 1e-9), `valueLoss ${stats.valueLoss}`);
  assert.ok(near(stats.loss, -Math.log(0.25) * (1 - V) - beta * Math.log(4) + 0.5 * (V - 1) ** 2, 1e-9), `loss ${stats.loss}`);
});

await check('learnFromGames: si optim viene sin mean (fichero antiguo), lo crea y lo actualiza', () => {
  save('seer', 'ex3-v'); const g0 = store.loadNet('ex3-v');
  const r = playGame({ seed: 5, left: { type: 'net', netId: 'ex3-v', learn: true }, right: { type: 'sniper' }, soldiers: 1 });
  const p = r.room.players.find((x) => x.agentType === 'net');
  const net = compile(g0); const optim = T.adamInit(net);
  delete optim.mean; // un optim.json antiguo no traía la referencia media
  const res = T.learnFromGames({ net, genome: g0, games: [{ events: r.events, trajectory: r.trajectories[p.id], playerId: p.id }], optim, cfg: { ...g0.learning.gradient, baseline: 'mean' } });
  assert.ok(res.rewards.steps > 0, 'la partida tiene decisiones');
  assert.ok(optim.mean && optim.mean.n >= 1 && typeof optim.mean.mean === 'number', JSON.stringify(optim.mean));
});

await check('createTrainer: sin semilla, dos entrenadores reciben semillas distintas (rango amplio) y enteras', () => {
  const seeds = Array.from({ length: 4 }, () => T.createTrainer({ netId: 'ex3-v', speed: 'turbo', workers: 1, duration: { games: 1 } }).config.seed);
  assert.ok(seeds.every((s) => Number.isInteger(s) && s >= 0 && s < 2 ** 31));
  assert.ok(new Set(seeds).size >= 3, `semillas ${seeds.join(', ')}`);
});

await check('createTrainer x10 / x1: las salas vivas llevan speed 10 / 1', async () => {
  save('sniper', 'ex3-a'); save('sniper', 'ex3-b'); save('sniper', 'ex3-r');
  for (const [netId, speed, expected] of [['ex3-a', 'x10', 10], ['ex3-b', 'x1', 1]]) {
    const t = T.createTrainer({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'ex3-r' }, speed, workers: 1, duration: { games: 1 }, soldiers: 1, seed: 21 });
    await t.start();
    assert.equal(t.status, 'done'); assert.equal(t.rooms.length, 1);
    const room = rooms.get(t.rooms[0]);
    assert.ok(room, 'la sala sigue registrada'); assert.equal(room.speed, expected, `${speed} → speed ${expected}`);
  }
});

await check('createTrainer: mezcla de rivales sin normalizar (2/0/2) reparte entre antagonista y sí misma; estadísticas de normalización guardadas', async () => {
  save('sniper', 'ex3-m', { reward: { ...clone(TEMPLATES.sniper.genome).reward, normalize: true } });
  const t = T.createTrainer({ netId: 'ex3-m', opponents: { antagonist: 2, hallOfFame: 0, self: 2, antagonistId: 'ex3-r' }, speed: 'turbo', workers: 1, duration: { games: 24 }, soldiers: 1, seed: 5 });
  await t.start();
  assert.equal(t.status, 'done');
  const kinds = new Set(t.curve.map((p) => p.rival));
  assert.ok(kinds.has('antagonist') && kinds.has('self'), `rivales vistos: ${[...kinds].join(', ')}`);
  const saved = store.loadNet('ex3-m');
  assert.ok(saved.reward.stats && Object.values(saved.reward.stats).some((s) => s && s.n >= 1), `reward.stats guardado: ${JSON.stringify(saved.reward.stats).slice(0, 120)}`);
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nentrenador-extra-b OK');
