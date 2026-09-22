// F4 — Aprendizaje (spec/04): recompensa exacta, gradiente de política contra derivación numérica,
// tareas de resultado conocido (tragaperras, recordar un bit, evolución, Corazonada), determinismo,
// entrenador (turbo, 1 y 2 hilos), parada y meseta, sala x10. Escrito ANTES del código y congelado.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-f4-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const clone = (v) => JSON.parse(JSON.stringify(v));

const C = await import('../shared/constants.js');
const { makeRng, gaussFrom } = await import('../shared/rng.js');
const { compile } = await import('../shared/nn.js');
const { repair, normalize, outDims, validate, DEFAULT_REWARD } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { softmaxT, sampleIndex } = await import('../shared/policy.js');
const R = await import('../shared/reward.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const build = (blocks, wires, seed = 1, extra = {}) => {
  const r = repair({ format: 1, id: 'f4-test', name: 'F4', imagination: { n: 4 }, blocks, wires, ...extra }, makeRng(seed));
  const v = validate(r.genome); if (!v.ok) throw new Error('genoma de test inválido: ' + JSON.stringify(v.errors));
  return r.genome;
};
const N = (g) => normalize(g).imagination.n;
function obsFor(genome, rng) {
  const dims = outDims(genome);
  const obs = { ctx: {}, cand: {}, move: {}, team: {} };
  const vec = (d) => Float64Array.from({ length: d }, () => rng() * 2 - 1);
  for (const b of genome.blocks) {
    if (!b.type.startsWith('eye.')) continue;
    const { stream, dim } = dims[b.id];
    if (stream === 'ctx') obs.ctx[b.id] = vec(dim); else if (stream === 'cand') obs.cand[b.id] = Array.from({ length: N(genome) }, () => vec(dim)); else obs.move[b.id] = Array.from({ length: 9 }, () => vec(dim));
  }
  return obs;
}
const logN = (a, mu, sd) => -0.5 * Math.log(2 * Math.PI * sd * sd) - (a - mu) ** 2 / (2 * sd * sd);
const entropy = (p) => { let h = 0; for (const v of p) if (v > 0) h -= v * Math.log(v); return h; };

// ---------- recompensa ----------
const ev = (id, type, actor, data = {}) => ({ id, t: id, game: 'g', turn: 0, type, actor, data });
function scenario() {
  const p1 = { playerId: 'p1', netId: 'n' }, p2 = { playerId: 'p2', netId: null };
  const events = [
    ev(1, 'game.start', { playerId: null }, {}),
    ev(2, 'decision', { ...p1, soldierId: 's1' }, { phase: 'shoot' }),
    ev(3, 'shot', { ...p1, soldierId: 's1' }, { expr: 'A', result: { type: 'kill', soldierId: 'e1' }, minDist: 0.3, minAllyDist: 5, decisionEventId: 2 }),
    ev(4, 'kill', { ...p1, soldierId: 's1' }, { victimSoldierId: 'e1', shotEventId: 3 }),
    ev(5, 'decision', { ...p1, soldierId: 's1' }, { phase: 'move' }),
    ev(6, 'move', { ...p1, soldierId: 's1' }, { coverBefore: 2, coverAfter: 0, decisionEventId: 5 }),
    ev(7, 'decision', { ...p2, soldierId: 'e2' }, { phase: 'shoot' }),
    ev(8, 'shot', { ...p2, soldierId: 'e2' }, { expr: 'Z', result: { type: 'wall' }, minDist: 9, minAllyDist: 30, decisionEventId: 7 }),
    ev(9, 'decision', { ...p1, soldierId: 's2' }, { phase: 'shoot' }),
    ev(10, 'shot', { ...p1, soldierId: 's2' }, { expr: 'B', result: { type: 'suicide', soldierId: 's1' }, minDist: 4, minAllyDist: 0, decisionEventId: 9 }),
    ev(11, 'friendlyFire', { ...p1, soldierId: 's2' }, { victimSoldierId: 's1', shotEventId: 10 }),
    ev(12, 'death', { ...p1, soldierId: 's1' }, { killerSoldierId: 's2', shotEventId: 10 }),
    ev(13, 'decision', { ...p1, soldierId: 's2' }, { phase: 'move' }),
    ev(14, 'move', { ...p1, soldierId: 's2' }, { coverBefore: 1, coverAfter: 1, decisionEventId: 13 }),
    ev(15, 'decision', { ...p1, soldierId: 's2' }, { phase: 'shoot' }),
    ev(16, 'shot', { ...p1, soldierId: 's2' }, { expr: 'A', result: { type: 'obstacle' }, minDist: 1.5, minAllyDist: 1.0, decisionEventId: 15 }),
    ev(17, 'decision', { ...p1, soldierId: 's2' }, { phase: 'move' }),
    ev(18, 'move', { ...p1, soldierId: 's2' }, { coverBefore: 0, coverAfter: 2, decisionEventId: 17 }),
    ev(19, 'win', { playerId: 'p1' }, { winner: 'left' }),
    ev(20, 'lose', { playerId: 'p2' }, { winner: 'left' }),
  ];
  const step = (turn, phase, eventId, soldierId) => ({ turn, phase, obs: null, decision: { eventId, phase, soldierId, chosen: 0, chosenMove: 0, logp: {} } });
  const trajectory = { netId: 'n', soldiers: { s1: [step(1, 'shoot', 2, 's1'), step(1, 'move', 5, 's1')], s2: [step(3, 'shoot', 9, 's2'), step(3, 'move', 13, 's2'), step(5, 'shoot', 15, 's2'), step(5, 'move', 17, 's2')] } };
  return { events, trajectory };
}
const RW = { ...DEFAULT_REWARD, kill: 1, die: -1, friendlyFire: -1.5, graze: 0.1, win: 2, lose: 0, survive: 0.5, cover: 0.3, repeatExpr: -0.2, nearFriendly: -0.4, normalize: false, grazeRadius: 2 };

await check('assignRewards: cada término va a la decisión que dice la tabla (kill, die, fuego amigo, roce, repetir, casi fuego amigo, cubrirse, ganar, sobrevivir)', () => {
  const { events, trajectory } = scenario();
  const r = R.assignRewards({ reward: RW, teamSpirit: 0, events, trajectory, playerId: 'p1' });
  const by = Object.fromEntries(r.entries.map((e) => [e.decision.eventId, e]));
  assert.deepEqual(Object.keys(by).map(Number).sort((a, b) => a - b), [2, 5, 9, 13, 15, 17]);
  assert.deepEqual(by[2].terms, { kill: 1 }); assert.ok(near(by[2].own, 1));
  assert.deepEqual(by[5].terms, { cover: 0.6, die: -1, win: 2 }); assert.ok(near(by[5].own, 1.6));
  assert.deepEqual(by[9].terms, { friendlyFire: -1.5 }); assert.ok(near(by[9].own, -1.5), 'suicidio no roza');
  assert.deepEqual(by[13].terms, {}); assert.equal(by[13].own, 0);
  assert.deepEqual(by[15].terms, { graze: 0.1, repeatExpr: -0.2, nearFriendly: -0.4 }); assert.ok(near(by[15].own, -0.5));
  assert.deepEqual(by[17].terms, { win: 2, survive: 0.5 }); assert.ok(near(by[17].own, 2.5));
  const mean = (1 + 1.6 - 1.5 + 0 - 0.5 + 2.5) / 6;
  for (const e of r.entries) { assert.ok(near(e.team, mean)); assert.ok(near(e.effective, e.own), 'τ = 0 → propia'); }
  const r5 = R.assignRewards({ reward: RW, teamSpirit: 0.5, events, trajectory, playerId: 'p1' });
  for (const e of r5.entries) assert.ok(near(e.effective, 0.5 * e.own + 0.5 * mean));
  const r1 = R.assignRewards({ reward: RW, teamSpirit: 1, events, trajectory, playerId: 'p1' });
  assert.ok(r1.entries.every((e) => near(e.effective, mean)));
  assert.ok(r.entries.every((e) => e.soldierId && typeof e.turn === 'number' && e.phase && e.decision), 'cada entrada conserva su decisión');
});

await check('assignRewards: perder, radio de roce, sin roce si mata, sin cubrirse si empeora; decisiones de fallback ignoradas', () => {
  const { events, trajectory } = scenario();
  const lost = clone(events); lost[18] = ev(19, 'lose', { playerId: 'p1' }, {}); lost[19] = ev(20, 'win', { playerId: 'p2' }, {});
  const r = R.assignRewards({ reward: { ...RW, lose: -3 }, teamSpirit: 0, events: lost, trajectory, playerId: 'p1' });
  const by = Object.fromEntries(r.entries.map((e) => [e.decision.eventId, e]));
  assert.deepEqual(by[17].terms, { lose: -3, survive: 0.5 }); assert.deepEqual(by[5].terms, { cover: 0.6, die: -1, lose: -3 });
  const tight = R.assignRewards({ reward: { ...RW, grazeRadius: 1 }, teamSpirit: 0, events, trajectory, playerId: 'p1' });
  assert.deepEqual(Object.fromEntries(tight.entries.map((e) => [e.decision.eventId, e]))[15].terms, { repeatExpr: -0.2, nearFriendly: -0.4 }, 'a 1.5 u no roza con radio 1');
  const t2 = clone(trajectory); t2.soldiers.s2[0].decision.error = 'rota';
  const r2 = R.assignRewards({ reward: RW, teamSpirit: 0, events, trajectory: t2, playerId: 'p1' });
  assert.equal(r2.entries.length, 5); assert.ok(!r2.entries.some((e) => e.decision.eventId === 9));
});

await check('normalizeStats: sin normalizar los 20 primeros; luego valor/σ con σ ≥ 0.1; returns con γ', () => {
  const stats = {};
  for (let i = 0; i < 19; i++) assert.equal(R.normalizeStats(stats, 'kill', i % 2), i % 2, 'crudo al principio');
  assert.equal(stats.kill.n, 19);
  let last = 0; for (let i = 0; i < 400; i++) last = R.normalizeStats(stats, 'kill', i % 2);
  assert.ok(last > 1.7 && last < 2.3, `1/σ con σ≈0.5: ${last}`);
  const s2 = {}; let c = 0; for (let i = 0; i < 60; i++) c = R.normalizeStats(s2, 'win', 5);
  assert.ok(near(c, 50, 1e-6), 'constante → σ mínima 0.1 → 5/0.1');
  const g = R.returns(Float64Array.from([1, 0, 0, 2]), 0.5);
  assert.deepEqual(Array.from(g), [1 + 0.25 * 2, 0.5 * 2, 2, 2].map((v, i) => [1.25, 0.5, 1, 2][i]));
  assert.deepEqual(Array.from(R.returns(Float64Array.from([1, 1, 1]), 1)), [3, 2, 1]);
  const { events, trajectory } = scenario();
  const rn = R.assignRewards({ reward: { ...RW, normalize: true }, teamSpirit: 0, events, trajectory, playerId: 'p1', stats: {} });
  assert.ok(rn.stats && rn.stats.kill && rn.stats.kill.n === 1, 'las estadísticas se llevan por término');
});

// ---------- gradiente de política vs numérico ----------
const pgGenome = () => build([B('f', 'eye.features'), B('c', 'eye.candidates'), B('m', 'eye.moves'), B('g', 'gru', { units: 4 }), B('d', 'dense', { units: 5, activation: 'tanh' }), B('v', 'hand.value'),
  B('cd', 'dense', { units: 4, activation: 'tanh' }), B('ch', 'hand.choose'), B('aj', 'hand.adjust', { params: 2 }), B('md', 'dense', { units: 3, activation: 'tanh' }), B('fm', 'foot.move', { adjust: true })],
[W('f', 'g'), W('g', 'd'), W('d', 'v'), W('d', 'cd'), W('c', 'cd'), W('cd', 'ch'), W('cd', 'aj'), W('m', 'md'), W('d', 'md'), W('md', 'fm')], 3, { traits: { temperature: 0.7, pulse: 0.2 } });
function lossOf(net, g, episodes, cfg) {
  const T_ = g.traits.temperature, pulse = g.traits.pulse; let L = 0;
  for (const ep of episodes) {
    let st = net.zeroState();
    for (const s of ep.steps) {
      const out = net.forward(s.obs, st); st = out.state;
      let logp = 0, H = 0;
      if (s.phase === 'shoot') {
        const p = softmaxT(out.outputs.choose.scores, T_); logp += Math.log(p[s.chosen]); H = entropy(p);
        if (cfg.adjustLearn !== false && out.outputs.adjust) { const mu = out.outputs.adjust.mu[s.chosen]; for (let i = 0; i < mu.length; i++) logp += logN(s.adjustSample[i], mu[i], pulse); }
      } else {
        const p = softmaxT(out.outputs.move.scores, T_); logp += Math.log(p[s.chosenMove]); H = entropy(p);
        if (out.outputs.move.mu) { const mu = out.outputs.move.mu[s.chosenMove]; for (let i = 0; i < 2; i++) logp += logN(s.moveAdjustSample[i], mu[i], pulse); }
      }
      L += -logp * s.advantage - cfg.entropy * H;
      if (out.outputs.value !== null && cfg.baseline === 'value') L += 0.5 * (out.outputs.value - s.ret) ** 2;
    }
  }
  return L;
}
function episodesFor(g, rng, nEp = 2, len = 4) {
  return Array.from({ length: nEp }, () => ({ steps: Array.from({ length: len }, (_, t) => ({
    obs: obsFor(g, rng), phase: t % 2 === 0 ? 'shoot' : 'move', chosen: rng.int(4), chosenMove: rng.int(9),
    adjustSample: [rng() * 2 - 1, rng() * 2 - 1], moveAdjustSample: [rng() * 2 - 1, rng() * 2 - 1], advantage: rng() * 2 - 1, ret: rng() * 2 - 1,
  })) }));
}
await check('policyGradient = derivada numérica de L (elegir + ajustar + mover + valor + entropía) con BPTT por la GRU', () => {
  const g = pgGenome(); const net = compile(g); const rng = makeRng(9);
  net.setFlat(Float64Array.from(net.getFlat(), (v) => v + (rng() * 2 - 1) * 0.3));
  const eps = episodesFor(g, rng);
  const cfg = { entropy: 0.05, baseline: 'value', bpttSteps: 64, adjustLearn: true };
  const { grads, stats } = T.policyGradient(net, g, eps, cfg);
  assert.equal(grads.length, net.paramCount()); assert.equal(stats.steps, 8);
  assert.ok(near(stats.loss, lossOf(net, g, eps, cfg), 1e-9), `loss ${stats.loss} vs ${lossOf(net, g, eps, cfg)}`);
  const flat0 = net.getFlat(); let worst = 0;
  for (let i = 0; i < flat0.length; i++) {
    const f = Float64Array.from(flat0); f[i] += 1e-6; net.setFlat(f); const lp = lossOf(net, g, eps, cfg);
    f[i] = flat0[i] - 1e-6; net.setFlat(f); const lm = lossOf(net, g, eps, cfg);
    const num = (lp - lm) / 2e-6; worst = Math.max(worst, Math.abs(num - grads[i]) / (1 + Math.abs(num) + Math.abs(grads[i])));
  }
  net.setFlat(flat0);
  assert.ok(worst < 1e-6, `error máximo ${worst.toExponential(2)}`);
  const noAdj = T.policyGradient(net, g, eps, { ...cfg, adjustLearn: false }).grads;
  assert.ok(Array.from(noAdj).some((v, i) => Math.abs(v - grads[i]) > 1e-9), 'adjustLearn:false cambia el gradiente');
  assert.ok(near(T.policyGradient(net, g, eps, { ...cfg, adjustLearn: false }).stats.loss, lossOf(net, g, eps, { ...cfg, adjustLearn: false }), 1e-9));
  const trunc = T.policyGradient(net, g, eps, { ...cfg, bpttSteps: 1 }).grads;
  assert.ok(Array.from(trunc).some((v, i) => Math.abs(v - grads[i]) > 1e-9), 'truncar la BPTT cambia el gradiente cuando hay memoria');
  const gm = build([B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 3 }), B('ch', 'hand.choose')], [W('f', 'd'), W('c', 'd'), W('d', 'ch')], 4);
  const nm = compile(gm); const em = episodesFor(gm, makeRng(2), 1, 2).map((e) => ({ steps: e.steps.map((s) => ({ ...s, phase: 'shoot' })) }));
  const a = T.policyGradient(nm, gm, em, { entropy: 0, baseline: 'none', bpttSteps: 64 }).grads, b = T.policyGradient(nm, gm, em, { entropy: 0, baseline: 'none', bpttSteps: 1 }).grads;
  assert.deepEqual(Array.from(a), Array.from(b), 'sin memoria, truncar no cambia nada');
});

await check('computeAdvantages: retorno con γ y referencia value / mean / none', () => {
  const g = pgGenome(); const net = compile(g); const rng = makeRng(5);
  const eps = episodesFor(g, rng, 1, 4).map((e) => ({ steps: e.steps.map((s, t) => ({ ...s, reward: [1, 0, 0, 2][t] })) }));
  const none = T.computeAdvantages(clone(eps).map((e) => ({ steps: e.steps.map((s) => ({ ...s, obs: eps[0].steps[e.steps.indexOf(s)].obs })) })), null, { gamma: 0.5, baseline: 'none' });
  assert.deepEqual(none[0].steps.map((s) => s.ret), [1.25, 0.5, 1, 2]); assert.deepEqual(none[0].steps.map((s) => s.advantage), [1.25, 0.5, 1, 2]);
  const values = [Float64Array.from([0.5, 0.5, 0.5, 0.5])];
  const val = T.computeAdvantages(eps.map((e) => ({ steps: e.steps.map((s) => ({ ...s })) })), values, { gamma: 0.5, baseline: 'value' });
  assert.deepEqual(val[0].steps.map((s) => s.advantage), [0.75, 0, 0.5, 1.5]);
  const meanState = { mean: 0, n: 0 };
  const m = T.computeAdvantages(eps.map((e) => ({ steps: e.steps.map((s) => ({ ...s })) })), null, { gamma: 1, baseline: 'mean' }, meanState);
  assert.ok(near(m[0].steps[0].ret, 3)); assert.ok(meanState.n === 4 && meanState.mean > 0, 'la media EMA avanza');
});

await check('applyUpdate: Adam mueve los pesos, recorta la norma, respeta frozen, informa por bloque; SGD también', () => {
  const g = pgGenome(); const net = compile(g); const optim = T.adamInit(net);
  const before = net.getFlat();
  const grads = Float64Array.from(before, (_, i) => (i % 3) - 1);
  const r = T.applyUpdate(net, grads, optim, { lr: 0.01, clipNorm: 1, optimizer: 'adam', frozen: [] });
  assert.ok(r.clipped === true && r.gradNorm > 1);
  const after = net.getFlat();
  assert.ok(Array.from(after).some((v, i) => v !== before[i]));
  assert.ok(r.top && r.perBlock[r.top.blockId] && r.perBlock[r.top.blockId].name);
  const gf = { ...g, frozen: ['d'] }; const nf = compile(gf); const of = T.adamInit(nf); const b2 = nf.getFlat();
  T.applyUpdate(nf, Float64Array.from(b2, () => 1), of, { lr: 0.01, clipNorm: 100, optimizer: 'adam', frozen: ['d'] });
  const a2 = nf.getFlat();
  const dParams = nf.paramList().filter((p) => p.blockId === 'd').reduce((s, p) => s + p.array.length, 0);
  let unchanged = 0, off = 0;
  for (const p of nf.paramList()) { for (let i = 0; i < p.array.length; i++) { if (p.blockId === 'd') unchanged += a2[off + i] === b2[off + i] ? 1 : 0; } off += p.array.length; }
  assert.equal(unchanged, dParams, 'el bloque congelado no cambia'); assert.equal(T.applyUpdate(nf, Float64Array.from(b2, () => 1), of, { lr: 0.01, clipNorm: 100, optimizer: 'adam', frozen: ['d'] }).perBlock.d.relChange, 0);
  const ns = compile(g); const bs = ns.getFlat();
  T.applyUpdate(ns, Float64Array.from(bs, () => 2), T.adamInit(ns), { lr: 0.1, clipNorm: 1e9, optimizer: 'sgd', frozen: [] });
  assert.ok(Array.from(ns.getFlat()).every((v, i) => near(v, bs[i] - 0.2, 1e-12)), 'SGD: θ − lr·g');
});

// ---------- tareas de resultado conocido ----------
const banditGenome = () => build([B('c', 'eye.candidates'), B('ch', 'hand.choose')], [W('c', 'ch')], 7);
const onehotObs = () => ({ ctx: {}, cand: { c: Array.from({ length: 4 }, (_, i) => Float64Array.from({ length: 12 }, (_, j) => (j === i ? 1 : 0))) }, move: {}, team: {} });
function runBandit(seed, entropyBeta) {
  const g = banditGenome(); const net = compile(g); const optim = T.adamInit(net); const rng = makeRng(seed);
  const probs = [0.1, 0.2, 0.8, 0.3]; const obs = onehotObs(); const mean = { mean: 0, n: 0 };
  for (let it = 0; it < 2000; it++) {
    const p = softmaxT(net.forward(obs, net.zeroState()).outputs.choose.scores, 1);
    const a = sampleIndex(p, rng); const r = rng() < probs[a] ? 1 : 0;
    const eps = T.computeAdvantages([{ steps: [{ obs, phase: 'shoot', chosen: a, reward: r }] }], null, { gamma: 1, baseline: 'mean' }, mean);
    const { grads } = T.policyGradient(net, g, eps, { entropy: entropyBeta, baseline: 'mean', bpttSteps: 8 });
    T.applyUpdate(net, grads, optim, { lr: 0.01, clipNorm: 5, optimizer: 'adam', frozen: [] });
  }
  return softmaxT(net.forward(obs, net.zeroState()).outputs.choose.scores, 1)[2];
}
await check('tragaperras: 4 brazos (0.1, 0.2, 0.8, 0.3) → p(mejor) > 0.9 tras 2 000 actualizaciones en 3 semillas; con curiosidad 0.5 se queda < 0.6', () => {
  for (const seed of [1, 2, 3]) { const p = runBandit(seed, 0.01); assert.ok(p > 0.9, `seed ${seed}: p(mejor) = ${p.toFixed(3)}`); }
  const pc = runBandit(1, 0.5); assert.ok(pc < 0.6, `curiosidad alta: ${pc.toFixed(3)}`);
});

const bitGenome = (memory) => build([B('f', 'eye.features'), B('c', 'eye.candidates'), ...(memory ? [B('g', 'gru', { units: 8 })] : []), B('d', 'dense', { units: 8, activation: 'tanh' }), B('cd', 'dense', { units: 6, activation: 'tanh' }), B('ch', 'hand.choose')],
  [W('f', memory ? 'g' : 'd'), ...(memory ? [W('g', 'd')] : []), W('d', 'cd'), W('c', 'cd'), W('cd', 'ch')], 11);
function runBit(seed, memory, bptt, episodes = 4000, delay = 3) {
  const g = bitGenome(memory); const net = compile(g); const optim = T.adamInit(net); const rng = makeRng(seed);
  const cand = onehotObs().cand; const mean = { mean: 0, n: 0 };
  let hits = 0, seen = 0;
  for (let it = 0; it < episodes; it++) {
    const bit = rng() < 0.5 ? 0 : 1;
    const steps = []; let st = net.zeroState();
    for (let t = 0; t <= delay; t++) {
      const f = new Float64Array(26); if (t === 0) f[0] = bit ? 1 : -1; f[1] = t / delay;
      const obs = { ctx: { f }, cand, move: {}, team: {} };
      const out = net.forward(obs, st); st = out.state;
      const a = sampleIndex(softmaxT(out.outputs.choose.scores, 1), rng);
      const r = t === delay ? (a === bit ? 1 : 0) : 0;
      steps.push({ obs, phase: 'shoot', chosen: a, reward: r });
      if (t === delay && it >= episodes - 500) { seen++; hits += r; }
    }
    const eps = T.computeAdvantages([{ steps }], null, { gamma: 1, baseline: 'mean' }, mean);
    const { grads } = T.policyGradient(net, g, eps, { entropy: 0.01, baseline: 'mean', bpttSteps: bptt });
    T.applyUpdate(net, grads, optim, { lr: 0.01, clipNorm: 5, optimizer: 'adam', frozen: [] });
  }
  return hits / seen;
}
await check('recordar un bit 3 turnos: con GRU (BPTT 8) > 90 % en las últimas 500; sin memoria ≤ 65 %; con BPTT truncada a 1 ≤ 65 %', () => {
  const acc = runBit(1, true, 8); assert.ok(acc > 0.9, `GRU: ${acc.toFixed(3)}`);
  const noMem = runBit(1, false, 8); assert.ok(noMem <= 0.65, `sin memoria: ${noMem.toFixed(3)}`);
  const trunc = runBit(1, true, 1); assert.ok(trunc <= 0.65, `truncada: ${trunc.toFixed(3)}`);
});

await check('evolutionStep: dense(1) maximiza −(w−0.7)² en 100 pasos; congelado no cambia; determinista', () => {
  const g = build([B('f', 'eye.features'), B('v', 'hand.value')], [W('f', 'v')], 5);
  const run = (seed, frozen) => {
    const net = compile({ ...g, frozen }); const rng = makeRng(seed);
    const fit = (theta) => -((theta[0] - 0.7) ** 2);
    let last = null;
    for (let i = 0; i < 100; i++) last = T.evolutionStep(net, fit, { population: 16, sigma: 0.1, lr: 0.05, antithetic: true, rankNormalize: true, frozen }, rng);
    return { w: net.getFlat()[0], last, flat: net.getFlat() };
  };
  const a = run(1, []);
  assert.ok(Math.abs(a.w - 0.7) < 0.05, `w = ${a.w}`); assert.ok(a.last.fitness.length === 16 && typeof a.last.mean === 'number' && typeof a.last.best === 'number');
  assert.deepEqual(Array.from(run(1, []).flat), Array.from(a.flat), 'misma semilla, mismos pesos');
  const f = run(1, ['v']); assert.ok(near(f.w, compile(g).getFlat()[0]), 'congelado: no se mueve');
});

await check('Corazonada: con recompensa constante 1, V → 1 ± 0.01', () => {
  const g = build([B('f', 'eye.features'), B('d', 'dense', { units: 4 }), B('v', 'hand.value')], [W('f', 'd'), W('d', 'v')], 6);
  const net = compile(g); const optim = T.adamInit(net); const obs = { ctx: { f: Float64Array.from({ length: 26 }, (_, i) => Math.sin(i)) }, cand: {}, move: {}, team: {} };
  for (let i = 0; i < 400; i++) {
    const eps = [{ steps: [{ obs, phase: 'shoot', chosen: 0, ret: 1, advantage: 0 }] }];
    const { grads } = T.policyGradient(net, g, eps, { entropy: 0, baseline: 'value', bpttSteps: 8 });
    T.applyUpdate(net, grads, optim, { lr: 0.05, clipNorm: 100, optimizer: 'adam', frozen: [] });
  }
  assert.ok(Math.abs(net.forward(obs, net.zeroState()).outputs.value - 1) < 0.01);
});

// ---------- partidas reales: eventos, trayectorias, learnFromGames ----------
const saveTemplate = (key, id) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), id, name: id }); assert.ok(r.ok, JSON.stringify(r)); return id; };
await check('playGame con una red: eventos (§9.1) y trayectorias (§9.2) exactos y enlazados', () => {
  saveTemplate('seer', 'vid-a');
  const g = playGame({ seed: 40, left: { type: 'net', netId: 'vid-a' }, right: { type: 'sniper' }, soldiers: 2 });
  const ev = g.events;
  assert.ok(ev.length > 5 && ev[0].type === 'game.start' && ev[0].id === 1 && ev.every((e, i) => e.id === i + 1 && e.game === g.room.gameId));
  assert.ok(/^g-40-/.test(g.room.gameId));
  const p = g.room.players.find((x) => x.agentType === 'net');
  const tr = g.trajectories[p.id];
  assert.ok(tr && tr.netId === 'vid-a' && Object.keys(tr.soldiers).length === 2);
  const decisions = ev.filter((e) => e.type === 'decision' && e.actor.playerId === p.id);
  const steps = Object.values(tr.soldiers).flat();
  assert.equal(steps.length, decisions.length, 'una entrada por decisión');
  for (const s of steps) {
    assert.ok(s.obs && s.obs.ctx && s.decision && Number.isInteger(s.decision.eventId), 'obs y decisión con eventId');
    const d = ev[s.decision.eventId - 1]; assert.equal(d.type, 'decision'); assert.equal(d.data.phase, s.phase); assert.equal(d.actor.soldierId, s.decision.soldierId);
  }
  for (const s of ev.filter((e) => e.type === 'shot')) {
    assert.ok(typeof s.data.minDist === 'number' && typeof s.data.minAllyDist === 'number' && s.data.family && s.data.decisionEventId === null || typeof s.data.decisionEventId === 'number');
    if (s.actor.playerId === p.id) assert.equal(ev[s.data.decisionEventId - 1].type, 'decision');
  }
  for (const m of ev.filter((e) => e.type === 'move')) assert.ok(Number.isInteger(m.data.coverBefore) && Number.isInteger(m.data.coverAfter) && m.data.to);
  const ends = ev.filter((e) => ['win', 'lose', 'draw'].includes(e.type));
  assert.equal(ends.length, 2, 'un evento de fin por jugador');
  const kills = ev.filter((e) => e.type === 'kill'), deaths = ev.filter((e) => e.type === 'death');
  assert.equal(kills.length + ev.filter((e) => e.type === 'friendlyFire').length, deaths.length);
  for (const k of kills) assert.equal(ev[k.data.shotEventId - 1].type, 'shot');
  const g2 = playGame({ seed: 40, left: { type: 'net', netId: 'vid-a' }, right: { type: 'sniper' }, soldiers: 2 });
  assert.deepEqual(g2.events.map((e) => [e.type, e.actor.soldierId]), ev.map((e) => [e.type, e.actor.soldierId]), 'determinista');
});

await check('learnFromGames: asigna recompensas, un paso de gradiente, lección y estadísticas; determinista', () => {
  const g0 = store.loadNet('vid-a');
  const games = [40, 41].map((seed) => { const r = playGame({ seed, left: { type: 'net', netId: 'vid-a' }, right: { type: 'greedy' }, soldiers: 1 }); const p = r.room.players.find((x) => x.agentType === 'net'); return { events: r.events, trajectory: r.trajectories[p.id], playerId: p.id, result: r.result, team: p.team }; });
  const run = () => { const net = compile(g0); const optim = T.adamInit(net); const r = T.learnFromGames({ net, genome: g0, games, optim, cfg: normalize(g0).learning.gradient }); return { r, flat: net.getFlat() }; };
  const a = run(), b = run();
  assert.deepEqual(Array.from(a.flat), Array.from(b.flat), 'mismo lote, mismos pesos');
  assert.ok(Array.from(a.flat).some((v, i) => v !== compile(g0).getFlat()[i]), 'los pesos cambian');
  assert.ok(a.r.update && typeof a.r.update.loss === 'number' && typeof a.r.update.gradNorm === 'number' && a.r.update.perBlock);
  assert.ok(a.r.lesson && a.r.lesson.blockId && a.r.lesson.name && typeof a.r.lesson.relChange === 'number' && typeof a.r.lesson.bulb === 'boolean');
  assert.ok(a.r.rewards && a.r.rewards.steps > 0 && typeof a.r.rewards.meanEffective === 'number');
  assert.ok(a.r.stats && a.r.stats.entropy >= 0);
});

// ---------- entrenador ----------
const collect = (trainer) => { const got = []; for (const ev of ['training', 'curve', 'sleep', 'lesson', 'milestone', 'done', 'error']) trainer.on(ev, (d) => got.push({ ev, d })); return got; };
await check('createTrainer turbo (1 hilo): 4 partidas → 1 sueño, curva, lección, red guardada con stats y optim; determinista', async () => {
  saveTemplate('seer', 'vid-b'); saveTemplate('seer', 'vid-c'); saveTemplate('sniper', 'rival-1');
  const cfg = (netId) => ({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'rival-1' }, speed: 'turbo', workers: 1, duration: { games: 4 }, soldiers: 1, seed: 100 });
  const t1 = T.createTrainer(cfg('vid-b')); const got = collect(t1);
  assert.equal(t1.status, 'queued');
  await t1.start();
  assert.equal(t1.status, 'done'); assert.equal(t1.games, 4); assert.equal(t1.updates, 1);
  assert.equal(got.filter((x) => x.ev === 'curve').length, 4); assert.equal(got.filter((x) => x.ev === 'sleep').length, 1); assert.equal(got.filter((x) => x.ev === 'lesson').length, 1);
  assert.ok(got.some((x) => x.ev === 'done' && x.d.reason === 'games'));
  const c = t1.curve[0]; assert.ok(typeof c.game === 'number' && typeof c.reward === 'number' && [0, 1].includes(c.win) && typeof c.kills === 'number' && typeof c.deaths === 'number');
  assert.ok(t1.curve[3].loss !== undefined && t1.curve[3].entropy !== undefined, 'tras el sueño, la curva lleva loss y entropía');
  const saved = store.loadNet('vid-b');
  assert.equal(saved.stats.games, 4); assert.ok(saved.stats.wins + saved.stats.kills + saved.stats.deaths >= 0);
  assert.ok(existsSync(join(store.netsDir(), 'vid-b', 'optim.json')), 'estado de Adam guardado');
  assert.ok(Array.from(compile(saved).getFlat()).some((v, i) => v !== compile(TEMPLATES.seer.genome).getFlat()[i]), 'aprendió algo');
  const t2 = T.createTrainer(cfg('vid-c')); await t2.start();
  assert.deepEqual(Array.from(compile(store.loadNet('vid-c')).getFlat()), Array.from(compile(saved).getFlat()), 'misma semilla, mismos pesos');
});

await check('createTrainer con 2 hilos: mismos pesos que con 1 (actualizaciones en orden de semilla)', async () => {
  saveTemplate('seer', 'vid-d');
  const t = T.createTrainer({ netId: 'vid-d', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'rival-1' }, speed: 'turbo', workers: 2, duration: { games: 4 }, soldiers: 1, seed: 100 });
  await t.start();
  assert.equal(t.status, 'done'); assert.equal(t.games, 4);
  assert.deepEqual(Array.from(compile(store.loadNet('vid-d')).getFlat()), Array.from(compile(store.loadNet('vid-b')).getFlat()));
});

await check('stop a mitad deja la red válida y guardada; plateau para solo; self y hallOfFame sin hitos caen a sí misma', async () => {
  saveTemplate('seer', 'vid-e');
  const t = T.createTrainer({ netId: 'vid-e', opponents: { antagonist: 0, hallOfFame: 0.5, self: 0.5 }, speed: 'turbo', workers: 1, duration: { games: 40 }, soldiers: 1, seed: 7 });
  const got = collect(t);
  t.on('curve', () => { if (t.games === 2) t.stop(); });
  await t.start();
  assert.equal(t.status, 'stopped'); assert.ok(t.games >= 2 && t.games < 40);
  assert.ok(got.some((x) => x.ev === 'done' && x.d.reason === 'stopped'));
  const saved = store.loadNet('vid-e'); assert.ok(saved && validate(saved).ok);
  saveTemplate('seer', 'vid-f');
  const tp = T.createTrainer({ netId: 'vid-f', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'rival-1' }, speed: 'turbo', workers: 1, duration: { plateau: { window: 2, minGain: 1000 } }, soldiers: 1, seed: 8 });
  const gp = collect(tp); await tp.start();
  assert.equal(tp.status, 'done'); assert.ok(tp.games >= 2 && tp.games <= 6, String(tp.games)); assert.ok(gp.some((x) => x.ev === 'done' && x.d.reason === 'plateau'));
  const bad = T.createTrainer({ netId: 'no-existe', speed: 'turbo', workers: 1, duration: { games: 1 } });
  const gb = collect(bad); await bad.start();
  assert.equal(bad.status, 'error'); assert.ok(gb.some((x) => x.ev === 'error'));
});

await check('sala x10: config.speed, sin humanos; x1 por defecto', () => {
  const r = new Room('x', { speed: 10, seed: 1 });
  assert.equal(r.snapshot().config.speed, 10); assert.ok(r.addPlayer('yo').error, 'x10 solo para agentes');
  assert.equal(new Room('y').snapshot().config.speed, 1);
  assert.equal(new Room('z', { speed: 7 }).snapshot().config.speed, 1, 'solo 1 o 10');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (aprendizaje F4)');
process.exit(fails ? 1 : 0);
