// Aprendizaje (spec/04 §3–§6, §9.4): gradiente de política (REINFORCE + baseline + BPTT), Adam/SGD,
// evolución (ES antitética), aprendizaje desde partidas y el entrenador (turbo con hilos, x1/x10 en vivo).
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { makeRng, gaussFrom } from '../shared/rng.js';
import { compile } from '../shared/nn.js';
import { normalize, validate, BLOCKS } from '../shared/genome.js';
import { softmaxT } from '../shared/policy.js';
import { assignRewards, returns } from '../shared/reward.js';
import { loadNet, saveNet, netsDir, evoDir, saveGameKept, packGame, loadGame, appendLog, readFeedback, writeFeedback, appendApplied, appendCurve, nextRecordSeq, saveVersion } from './store.js';
import { emotionOf, memoryOf, updateMemory, addEpisode, rewardEvents, emotionEvents } from './truth.js';
import { readThroneFull, pickOpponent } from './league.js';
import { adaptImagination } from './mutate.js';
import { validateRecipe, scheduleValue, progressOf, mergeReward, rewardChanges, createCurriculum, createBestTracker } from './recipe.js';
import { runBulletin } from './exam.js';
import { Pool, threads } from './threads.js';
import { playGame } from '../server/headless.js';
import { heldBy } from './busy.js';
import { createRoom } from '../server/rooms.js';
import { AGENTS } from '../agents/registry.js';

const entropyOf = (p) => { let h = 0; for (const v of p) if (v > 0) h -= v * Math.log(v); return h; };
const logN = (a, mu, sd) => -0.5 * Math.log(2 * Math.PI * sd * sd) - (a - mu) ** 2 / (2 * sd * sd);

// ---------- gradiente de política ----------
export function policyGradient(net, genome, episodes, cfg = {}) {
  const g = normalize(genome);
  const T = g.traits.temperature, pulse = Math.max(1e-6, g.traits.pulse);
  const beta = cfg.entropy ?? 0.01, bptt = Math.max(1, cfg.bpttSteps ?? 8);
  const adjustLearn = cfg.adjustLearn !== false, useValue = cfg.baseline === 'value';
  const total = new Float64Array(net.paramCount());
  const stats = { loss: 0, entropy: 0, valueLoss: 0, steps: 0 };
  for (const ep of episodes) {
    const outs = []; let st = net.zeroState();
    for (const s of ep.steps) { const out = net.forward(s.obs, st); outs.push(out); st = out.state; }
    let sg = null;
    for (let t = ep.steps.length - 1; t >= 0; t--) {
      const s = ep.steps[t], out = outs[t], o = out.outputs;
      const A = s.advantage ?? 0;
      const gradOut = { choose: null, adjust: null, move: null, value: null };
      let H = 0;
      if (s.phase === 'shoot' && o.choose) {
        const p = softmaxT(o.choose.scores, T); H = entropyOf(p);
        const gc = new Float64Array(p.length);
        for (let i = 0; i < p.length; i++) gc[i] = -A * ((i === s.chosen ? 1 : 0) - p[i]) / T - beta * (-(p[i] * (Math.log(p[i]) + H)) / T);
        gradOut.choose = gc;
        stats.loss += -Math.log(p[s.chosen]) * A - beta * H;
        if (adjustLearn && o.adjust && s.adjustSample) {
          const mu = o.adjust.mu[s.chosen];
          gradOut.adjust = o.adjust.mu.map((row, r) => { const gr = new Float64Array(row.length); if (r === s.chosen) for (let i = 0; i < row.length; i++) gr[i] = -A * (s.adjustSample[i] - mu[i]) / (pulse * pulse); return gr; });
          for (let i = 0; i < mu.length; i++) stats.loss += -logN(s.adjustSample[i], mu[i], pulse) * A;
        }
      } else if (s.phase === 'move' && o.move) {
        const p = softmaxT(o.move.scores, T); H = entropyOf(p);
        const gm = new Float64Array(p.length);
        for (let i = 0; i < p.length; i++) gm[i] = -A * ((i === s.chosenMove ? 1 : 0) - p[i]) / T - beta * (-(p[i] * (Math.log(p[i]) + H)) / T);
        let gmu = null;
        if (o.move.mu && s.moveAdjustSample) {
          const mu = o.move.mu[s.chosenMove];
          gmu = o.move.mu.map((row, r) => { const gr = new Float64Array(row.length); if (r === s.chosenMove) for (let i = 0; i < row.length; i++) gr[i] = -A * (s.moveAdjustSample[i] - mu[i]) / (pulse * pulse); return gr; });
          for (let i = 0; i < mu.length; i++) stats.loss += -logN(s.moveAdjustSample[i], mu[i], pulse) * A;
        }
        gradOut.move = { scores: gm, mu: gmu };
        stats.loss += -Math.log(p[s.chosenMove]) * A - beta * H;
      }
      if (useValue && o.value !== null && o.value !== undefined && s.ret !== undefined) {
        gradOut.value = o.value - s.ret;
        stats.loss += 0.5 * (o.value - s.ret) ** 2; stats.valueLoss += 0.5 * (o.value - s.ret) ** 2;
      }
      stats.entropy += H; stats.steps++;
      if ((t + 1) % bptt === 0) sg = null; // frontera de la BPTT truncada: se descarta lo que llega del futuro
      const r = net.backward(out.tape, gradOut, sg);
      sg = r.stateGrad;
      const flat = net.flattenGrads(r.grads);
      for (let i = 0; i < flat.length; i++) total[i] += flat[i];
    }
  }
  return { grads: total, stats };
}

// ret = retornos con γ; ventaja = ret − referencia (value | mean | none)
export function computeAdvantages(episodes, values, cfg = {}, meanState = null) {
  const gamma = cfg.gamma ?? 0.95;
  episodes.forEach((ep, k) => {
    const rewards = Float64Array.from(ep.steps, (s) => s.reward ?? 0);
    const G = returns(rewards, gamma);
    ep.steps.forEach((s, t) => {
      s.ret = G[t];
      if (cfg.baseline === 'value' && values && values[k] && Number.isFinite(values[k][t])) s.advantage = G[t] - values[k][t];
      else if (cfg.baseline === 'mean' && meanState) { s.advantage = G[t] - meanState.mean; meanState.n = (meanState.n || 0) + 1; meanState.mean = (meanState.mean || 0) + 0.05 * (G[t] - (meanState.mean || 0)); }
      else s.advantage = G[t];
    });
  });
  return episodes;
}

// ---------- optimizador ----------
// disposición de los parámetros (bloque, clave y tamaño, en orden): los momentos de Adam solo valen para la misma
// (spec/04 §11.7)
const layoutOf = (net) => net.paramList().map((p) => `${p.blockId}.${p.key}:${p.array.length}`);
export function adamInit(net) {
  const n = net.paramCount();
  return { m: new Float64Array(n), v: new Float64Array(n), t: 0, mean: { mean: 0, n: 0 }, layout: layoutOf(net) };
}
export function applyUpdate(net, grads, optim, { lr = 0.003, clipNorm = 5, optimizer = 'adam', frozen = [] } = {}) {
  const list = net.paramList();
  const frozenSet = new Set(frozen);
  const g = Float64Array.from(grads);
  let off = 0;
  for (const p of list) { if (frozenSet.has(p.blockId)) g.fill(0, off, off + p.array.length); off += p.array.length; }
  let norm = 0; for (let i = 0; i < g.length; i++) norm += g[i] * g[i]; norm = Math.sqrt(norm);
  const clipped = norm > clipNorm;
  if (clipped) { const s = clipNorm / norm; for (let i = 0; i < g.length; i++) g[i] *= s; }
  const before = net.getFlat();
  const flat = Float64Array.from(before);
  if (optimizer === 'sgd') { for (let i = 0; i < flat.length; i++) flat[i] -= lr * g[i]; }
  else {
    optim.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - b1 ** optim.t, c2 = 1 - b2 ** optim.t;
    for (let i = 0; i < flat.length; i++) {
      optim.m[i] = b1 * optim.m[i] + (1 - b1) * g[i];
      optim.v[i] = b2 * optim.v[i] + (1 - b2) * g[i] * g[i];
      if (g[i] === 0 && frozenSetHas(frozenSet, list, i)) continue;
      flat[i] -= lr * (optim.m[i] / c1) / (Math.sqrt(optim.v[i] / c2) + eps);
    }
  }
  off = 0;
  for (const p of list) { if (frozenSet.has(p.blockId)) for (let i = 0; i < p.array.length; i++) flat[off + i] = before[off + i]; off += p.array.length; }
  net.setFlat(flat);
  const perBlock = {}; off = 0;
  for (const p of list) {
    const b = perBlock[p.blockId] || (perBlock[p.blockId] = { name: BLOCKS[net.genome.blocks.find((x) => x.id === p.blockId).type].name, d2: 0, w2: 0 });
    for (let i = 0; i < p.array.length; i++) { b.d2 += (flat[off + i] - before[off + i]) ** 2; b.w2 += before[off + i] ** 2; }
    off += p.array.length;
  }
  let top = null;
  for (const [id, b] of Object.entries(perBlock)) { b.relChange = Math.sqrt(b.d2) / Math.max(1e-8, Math.sqrt(b.w2)); delete b.d2; delete b.w2; if (!top || b.relChange > top.relChange) top = { blockId: id, name: b.name, relChange: b.relChange }; }
  return { gradNorm: norm, clipped, perBlock, top };
}
function frozenSetHas(frozenSet, list, i) { let off = 0; for (const p of list) { if (i < off + p.array.length) return frozenSet.has(p.blockId); off += p.array.length; } return false; }

// ---------- evolución ----------
// en tres fases (sortear → evaluar → aplicar) para poder evaluar las copias fuera de línea (hilos, partidas)
export function planEvolution(net, cfg = {}, rng = Math.random) {
  const pop = Math.max(2, cfg.population ?? 16), sigma = cfg.sigma ?? 0.02;
  const frozenSet = new Set(cfg.frozen || []);
  const list = net.paramList();
  const mask = new Float64Array(net.paramCount()); let off = 0;
  for (const p of list) { if (!frozenSet.has(p.blockId)) mask.fill(1, off, off + p.array.length); off += p.array.length; }
  const theta = net.getFlat();
  const half = Math.ceil(pop / 2);
  const epsList = [], candidates = [];
  for (let j = 0; j < half; j++) {
    const eps = Float64Array.from(mask, (m) => (m ? sigma * gaussFrom(rng) : 0));
    epsList.push(eps);
    candidates.push(Float64Array.from(theta, (v, i) => v + eps[i]), Float64Array.from(theta, (v, i) => v - eps[i]));
  }
  return { theta, epsList, candidates, sigma };
}
export function evolutionStep(net, fitnessFn, cfg = {}, rng = Math.random) {
  const plan = planEvolution(net, cfg, rng);
  return applyEvolution(net, plan, plan.candidates.map((c) => fitnessFn(c)), cfg);
}
export function applyEvolution(net, { theta, epsList, sigma }, fitness, cfg = {}) {
  const lr = cfg.lr ?? 0.01, half = epsList.length;
  let F = fitness.slice();
  if (cfg.rankNormalize !== false) {
    const order = fitness.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]);
    F = new Array(fitness.length); order.forEach(([, i], rank) => { F[i] = fitness.length > 1 ? rank / (fitness.length - 1) - 0.5 : 0; });
  }
  const upd = new Float64Array(theta.length);
  for (let j = 0; j < half; j++) { const w = F[2 * j] - F[2 * j + 1]; const eps = epsList[j]; for (let i = 0; i < upd.length; i++) upd[i] += w * eps[i]; }
  const scale = lr / (fitness.length * sigma);
  net.setFlat(Float64Array.from(theta, (v, i) => v + scale * upd[i]));
  return { fitness, mean: fitness.reduce((s, f) => s + f, 0) / fitness.length, best: Math.max(...fitness) };
}

// ---------- evolución jugada de verdad (spec/04 §10.2) ----------
const yieldLoop = () => new Promise((r) => setImmediate(r));
// una partida detrás de otra y cediendo el bucle antes de cada una: el servidor responde entre partidas (spec/04 §10.5).
// (lanzadas a la vez con Promise.all, todas las cesiones caían en la misma vuelta del bucle y el servidor se bloqueaba)
let headlessQueue = Promise.resolve();
function playHeadless(spec) {
  const run = headlessQueue.then(async () => { await yieldLoop(); return playOne(spec); });
  headlessQueue = run.catch(() => {});
  return run;
}
// recompensa efectiva media por decisión de la red que aprende en una partida (la magnitud de la curva)
function meanEffectiveOf(g, res, stats) {
  const tr = res && res.trajectories ? res.trajectories[res.playerId] : null;
  if (!tr) return 0;
  const r = assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: res.events, trajectory: tr, playerId: res.playerId, stats });
  return r.entries.length ? r.entries.reduce((s, e) => s + e.effective, 0) / r.entries.length : 0;
}
// cambio relativo por bloque entre `before` y los pesos actuales de la red
function blockChanges(net, before) {
  const after = net.getFlat(); const perBlock = {}; let off = 0;
  for (const p of net.paramList()) {
    const b = perBlock[p.blockId] || (perBlock[p.blockId] = { name: BLOCKS[net.genome.blocks.find((x) => x.id === p.blockId).type].name, d2: 0, w2: 0 });
    for (let i = 0; i < p.array.length; i++) { b.d2 += (after[off + i] - before[off + i]) ** 2; b.w2 += before[off + i] ** 2; }
    off += p.array.length;
  }
  let top = null;
  for (const [id, b] of Object.entries(perBlock)) { b.relChange = Math.sqrt(b.d2) / Math.max(1e-8, Math.sqrt(b.w2)); delete b.d2; delete b.w2; if (!top || b.relChange > top.relChange) top = { blockId: id, name: b.name, relChange: b.relChange }; }
  return { perBlock, top };
}
export async function evolutionRound({ net, genome, rival, soldiers = 1, seeds = [1], cfg = {}, rng = Math.random, play = playHeadless }) {
  const g = normalize(genome);
  const plan = planEvolution(net, { ...cfg, frozen: cfg.frozen ?? g.frozen }, rng);
  const frozenStats = JSON.stringify(g.reward.stats || {}); // todas las copias se miden con la misma normalización
  const scratch = compile(g);
  const specs = [];
  for (const cand of plan.candidates) {
    scratch.setFlat(cand);
    const me = { type: 'net', genome: { ...g, weights: scratch.serialize() }, learn: true };
    seeds.forEach((seed, j) => specs.push({ seed, left: j % 2 === 0 ? me : rival, right: j % 2 === 0 ? rival : me, soldiers: typeof soldiers === 'function' ? soldiers(j) : soldiers }));
  }
  const results = await Promise.all(specs.map((spec) => play(spec)));
  const n = Math.max(1, seeds.length);
  const fitness = plan.candidates.map((_, i) => { let s = 0; for (let j = 0; j < seeds.length; j++) s += meanEffectiveOf(g, results[i * seeds.length + j], JSON.parse(frozenStats)); return s / n; });
  const before = net.getFlat();
  const r = applyEvolution(net, plan, fitness, cfg);
  const { perBlock, top } = blockChanges(net, before);
  const lesson = top ? { blockId: top.blockId, name: top.name, relChange: top.relChange, bulb: top.relChange > g.learning.sleep.lessonThreshold } : null;
  return { fitness, lesson, update: { kind: 'evolution', population: plan.candidates.length, sigma: plan.sigma, games: specs.length, meanFitness: r.mean, bestFitness: r.best, perBlock, top } };
}

// ---------- aprender de partidas ----------
// entries = [{game, entry}]: un episodio por (partida, soldado); dos partidas nunca se mezclan (spec/04 §10.1)
function episodesFromRewards(entries) {
  const bySoldier = {};
  for (const { game, entry } of entries) (bySoldier[`${game}|${entry.soldierId}`] ||= { game, soldierId: entry.soldierId, list: [] }).list.push(entry);
  const episodes = [], values = [];
  for (const { game, soldierId, list } of Object.values(bySoldier)) {
    list.sort((a, b) => a.decision.eventId - b.decision.eventId);
    episodes.push({ game, soldierId, steps: list.map((e) => ({ decisionEventId: e.decision.eventId, value: e.decision.value === null || e.decision.value === undefined ? null : e.decision.value, obs: e.obs, phase: e.phase, chosen: e.decision.chosen, chosenMove: e.decision.chosenMove, adjustSample: e.decision.adjust ? e.decision.adjust.sample : null, moveAdjustSample: e.decision.moveAdjust ? e.decision.moveAdjust.sample : null, reward: e.effective })) });
    values.push(Float64Array.from(list, (e) => (e.decision.value === null || e.decision.value === undefined ? NaN : e.decision.value)));
  }
  return { episodes, values };
}
// fase 1: recompensas, episodios, ventajas y emociones (sin tocar pesos); fase 2: el paso de gradiente
export function prepareExperience({ genome, games, optim, cfg = {} }) {
  const g = normalize(genome);
  const lc = { ...g.learning.gradient, ...cfg };
  const allEntries = [];
  let steps = 0, sumEff = 0;
  games.forEach((game, gi) => {
    const r = game.rewards || assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectory, playerId: game.playerId, stats: g.reward.stats || (g.reward.stats = {}) });
    game.rewards = r;
    for (const e of r.entries) { allEntries.push({ game: gi, entry: e }); steps++; sumEff += e.effective; }
  });
  // 🎲 Imaginación por uso (spec/05 §10.6): familias elegidas en las últimas 200 decisiones de disparo del lote
  const decisions = [];
  for (const game of games) {
    const tr = game.trajectory && game.trajectory.soldiers ? game.trajectory.soldiers : {};
    const steps = Object.values(tr).flat().filter((s) => s && s.decision && Number.isInteger(s.decision.eventId)).sort((x, y) => x.decision.eventId - y.decision.eventId);
    for (const s of steps) decisions.push(s.decision);
  }
  const imagination = adaptImagination(g.imagination, decisions);
  const { episodes, values } = episodesFromRewards(allEntries);
  const hasValue = g.blocks.some((b) => b.type === 'hand.value');
  const baseline = lc.baseline === 'value' && !hasValue ? 'mean' : lc.baseline;
  computeAdvantages(episodes, values, { gamma: lc.gamma, baseline }, optim.mean || (optim.mean = { mean: 0, n: 0 }));
  // emociones calculadas del RL (spec/07 §5, §12.4)
  const meanV = optim.mean ? optim.mean.mean : null;
  const emotions = [];
  for (const ep of episodes) for (const s of ep.steps) {
    if (!Number.isInteger(s.decisionEventId)) continue;
    const V = baseline === 'value' ? s.value : baseline === 'mean' ? meanV : null;
    emotions.push({ game: ep.game, decisionEventId: s.decisionEventId, ...emotionOf({ V, A: s.advantage ?? 0, valueSource: baseline === 'none' ? 'none' : baseline }) });
  }
  return { g, lc, baseline, imagination, episodes, emotions, steps, sumEff };
}
export function learnFromGames({ net, genome, games, optim, cfg = {} }) {
  const { g, lc, baseline, imagination, episodes, emotions, steps, sumEff } = prepareExperience({ genome, games, optim, cfg });
  const pg = policyGradient(net, g, episodes, { ...lc, baseline });
  const update = applyUpdate(net, pg.grads, optim, { lr: lc.lr, clipNorm: lc.clipNorm, optimizer: lc.optimizer, frozen: g.frozen });
  const threshold = g.learning.sleep.lessonThreshold;
  const lesson = update.top ? { blockId: update.top.blockId, name: update.top.name, relChange: update.top.relChange, bulb: update.top.relChange > threshold } : null;
  return { imagination, emotions, episodes: episodes.map((ep) => ({ game: ep.game, soldierId: ep.soldierId, steps: ep.steps.length })), update: { kind: 'gradient', loss: pg.stats.loss, entropy: pg.stats.entropy, valueLoss: pg.stats.valueLoss, gradNorm: update.gradNorm, clipped: update.clipped, perBlock: update.perBlock, top: update.top, steps: pg.stats.steps }, lesson, rewards: { steps, meanEffective: steps ? sumEff / steps : 0 }, stats: pg.stats };
}

// ---------- aprender en un hilo (spec/11) ----------
// la partida de muestra con sus recompensas y sus emociones dentro, empaquetada para guardarla (spec/04 §6, spec/07 §12.1);
// `sample` = {index, meta, events, playerId, netId, tau, normalized, genomes}, `game` = la del lote (rewards, trajectory)
export function packSample(sample, game, emotions) {
  const ids = new Set(Object.values(game.trajectory && game.trajectory.soldiers ? game.trajectory.soldiers : {}).flat().map((s) => s.decision && s.decision.eventId));
  const events = sample.events.map((e) => ({ ...e }));
  rewardEvents(events, game.rewards, { playerId: sample.playerId, netId: sample.netId, tau: sample.tau, normalized: sample.normalized });
  emotionEvents(events, emotions.filter((em) => em.game === sample.index && ids.has(em.decisionEventId)), { playerId: sample.playerId, netId: sample.netId }); // solo las de esta partida (spec/04 §10.1)
  return { index: sample.index, ...packGame(sample.meta, events, { [sample.playerId]: game.trajectory }, sample.genomes) };
}
// lo que hace el hilo con el mensaje `learn`: la red desde el genoma y los pesos, un sueño y las muestras empaquetadas
export function learnBatch({ genome, weights, optim, games, cfg, samples = [] }) {
  const net = compile(genome);
  net.setFlat(weights);
  const o = { m: optim.m, v: optim.v, t: optim.t, mean: optim.mean };
  const result = learnFromGames({ net, genome, games, optim: o, cfg });
  const packed = samples.map((s) => packSample(s, games[s.index], result.emotions));
  return { weights: net.getFlat(), optim: { m: o.m, v: o.v, t: o.t, mean: o.mean }, result, packed };
}
// un sueño: con `pool`, en un hilo (el hilo principal solo aplica lo que vuelve); sin él, aquí mismo. Mismo resultado
export async function learnInThread({ pool = null, net, genome, games, optim, cfg, samples = [] }) {
  if (!pool) {
    const result = learnFromGames({ net, genome, games, optim, cfg });
    return { result, packed: samples.map((s) => packSample(s, games[s.index], result.emotions)) };
  }
  const m = await pool.run({ type: 'learn', genome, weights: net.getFlat(), optim: { m: optim.m, v: optim.v, t: optim.t, mean: optim.mean }, games: games.map((x) => ({ rewards: x.rewards, trajectory: x.trajectory })), cfg, samples });
  net.setFlat(m.weights);
  optim.m = m.optim.m; optim.v = m.optim.v; optim.t = m.optim.t; optim.mean = m.optim.mean;
  return { result: m.result, packed: m.packed };
}

// ---------- estado de Adam en disco y aprendiz reutilizable (entrenador y duelos) ----------
export function loadOptim(net, dir) {
  let optim = adamInit(net);
  const file = join(dir, 'optim.json');
  try {
    if (existsSync(file)) {
      const o = JSON.parse(readFileSync(file, 'utf8'));
      // si la estructura cambió (otra disposición, o un fichero antiguo que no la guardaba), Adam empieza de cero
      const sameLayout = Array.isArray(o.layout) && o.layout.join('|') === optim.layout.join('|');
      if (o.m && o.m.length === optim.m.length && sameLayout) optim = { m: Float64Array.from(o.m), v: Float64Array.from(o.v), t: o.t || 0, mean: o.mean || { mean: 0, n: 0 }, layout: optim.layout };
    }
  } catch { /* fichero roto: se empieza de cero */ }
  return optim;
}
export function saveOptim(optim, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, 'optim.json'), tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ m: Array.from(optim.m), v: Array.from(optim.v), t: optim.t, mean: optim.mean, layout: optim.layout }));
  renameSync(tmp, file);
}
// aplica a la red lo que learnFromGames decidió sobre la Imaginación por uso
export function applyImagination(g, im) {
  if (!im) return;
  g.imagination.usage = { ...im.usage };
  if (im.changed) for (const f of Object.keys(im.weights)) g.imagination.families[f].weight = im.weights[f];
}
// makeLearner(genome) → {net, genome, optim, learn(games, {lrScale}), review(games), addStats(s), save()} (spec/06 §6.2)
// memoria episódica (spec/07 §6): la red absorbe una partida (episodios, rivales, tiros recientes)
export function absorbGame(g, game, extra = []) {
  const mem = memoryOf(g);
  updateMemory(mem, { netId: g.id, playerId: game.playerId, events: game.events || [], rewards: game.rewards || null, extra });
  g.memory = mem;
  return mem;
}
// ---------- bofetada y caricia con efecto inmediato (spec/04 §10.4) ----------
// ¿esta decisión es de esta red y la partida guarda lo que vio? → {dec, steps, index} | {status, error}
export function feedbackTarget(game, decisionEventId, netId) {
  const dec = game.events.find((e) => e.type === 'decision' && e.id === decisionEventId);
  if (!dec) return { status: 404, error: `La partida no tiene la decisión ${decisionEventId}` };
  if (dec.actor.netId !== netId) return { status: 400, error: `Esa decisión es de ${dec.actor.netId || 'un jugador que no es una red'}, no de ${netId}: la bofetada o la caricia tiene que ir a quien decidió.` };
  const tr = game.trajectories && game.trajectories[dec.actor.playerId];
  const steps = tr && tr.soldiers ? tr.soldiers[dec.actor.soldierId] : null;
  const index = steps ? steps.findIndex((s) => s && s.decision && s.decision.eventId === dec.id) : -1;
  if (index < 0) return { status: 400, error: 'Esta partida no guarda lo que vio la red en esa decisión (su trayectoria), así que no se le puede enseñar nada con ella.' };
  return { dec, steps, index };
}
// un paso de gradiente solo sobre esa decisión (ventaja = reward, sin entropía ni valor), con Adam recién empezado:
// así la dirección es siempre la de la bofetada o la caricia, sin la inercia del entreno
export function feedbackStep({ net, genome, steps, index, reward }) {
  const g = normalize(genome);
  const T = g.traits.temperature;
  const pOf = () => {
    let st = net.zeroState(), out = null;
    for (let i = 0; i <= index; i++) { out = net.forward(steps[i].obs, st); st = out.state; }
    const d = steps[index].decision;
    return d.phase === 'move' ? softmaxT(out.outputs.move.scores, T)[d.chosenMove] : softmaxT(out.outputs.choose.scores, T)[d.chosen];
  };
  const pBefore = pOf();
  const episode = { steps: steps.slice(0, index + 1).map((s, i) => ({ obs: s.obs, phase: s.phase, chosen: s.decision.chosen, chosenMove: s.decision.chosenMove, adjustSample: s.decision.adjust ? s.decision.adjust.sample : null, moveAdjustSample: s.decision.moveAdjust ? s.decision.moveAdjust.sample : null, advantage: i === index ? reward : 0 })) };
  const lc = g.learning.gradient;
  const pg = policyGradient(net, g, [episode], { ...lc, entropy: 0, baseline: 'none' });
  const up = applyUpdate(net, pg.grads, adamInit(net), { lr: lc.lr, clipNorm: lc.clipNorm, optimizer: lc.optimizer, frozen: g.frozen });
  return { pBefore, pAfter: pOf(), relChange: up.top ? up.top.relChange : 0, top: up.top };
}
// aplica una bofetada/caricia a la red (pesos + recuerdo de vergüenza u orgullo); `g` es el genoma vivo de `net`
export function feedbackFromGame({ net, genome: g, game, decisionEventId, reward, kind, eventId }) {
  const target = feedbackTarget(game, decisionEventId, g.id);
  if (target.error) return target;
  const out = feedbackStep({ net, genome: g, steps: target.steps, index: target.index, reward });
  g.weights = net.serialize();
  const start = game.events.find((e) => e.type === 'game.start');
  const rival = start && start.data && Array.isArray(start.data.players) ? start.data.players.find((p) => p.playerId !== target.dec.actor.playerId) : null;
  const d = target.dec.data;
  const family = d.phase === 'shoot' && Array.isArray(d.candidates) && d.candidates[d.chosen] ? d.candidates[d.chosen].family || null : null;
  const mem = memoryOf(g);
  addEpisode(mem, { ref: { game: game.meta.gameId, id: eventId }, rivalId: rival ? rival.netId || rival.agentType || rival.name : null, biome: start && start.data.map ? start.data.map.biome : null, family, outcome: kind, emotion: kind === 'slap' ? 'shame' : 'pride', intensity: Math.min(1, Math.abs(reward)), gamesAgo: 0 });
  g.memory = mem;
  return { ok: true, ...out };
}
// bofetadas y caricias en cola → aplicadas ya sobre (net, genome), con el paso de feedbackFromGame (spec/04 §10.4)
export function applyQueuedFeedback({ net, genome: g, trainingId = null }) {
  const queued = readFeedback(g.id);
  if (!queued.length) return;
  writeFeedback(g.id, []);
  for (const f of queued) {
    const game = loadGame(f.game);
    if (!game) continue;
    const reward = (f.kind === 'slap' ? -1 : 1) * (f.amount || 1) * (g.reward.slapCaress ?? 1);
    const out = feedbackFromGame({ net, genome: g, game, decisionEventId: f.decisionEventId, reward, kind: f.kind, eventId: f.eventId ?? null });
    if (out.ok) appendApplied(g.id, { kind: f.kind, game: f.game, decisionEventId: f.decisionEventId, amount: f.amount || 1, reward, pBefore: out.pBefore, pAfter: out.pAfter, relChange: out.relChange, trainingId, ts: Date.now() });
  }
}
// al soltar una red ocupada (spec/04 §10.5): si nadie más la tiene, lo que quedó en cola se aplica ya y se guarda
export function settleFeedback(netId) {
  if (heldBy(netId) || !readFeedback(netId).length) return;
  const disk = loadNet(netId);
  if (!disk) return;
  const L = makeLearner(disk);
  applyQueuedFeedback({ net: L.net, genome: L.genome });
  L.save();
}
// bofetadas y caricias pendientes de esta partida → términos extra para assignRewards
export function takeFeedback(netId, gameId, slapCaress = 1) {
  const pending = readFeedback(netId);
  const mine = pending.filter((f) => f.game === gameId);
  if (!mine.length) return null;
  writeFeedback(netId, pending.filter((f) => f.game !== gameId));
  const extra = {};
  for (const f of mine) { const t = (extra[f.decisionEventId] ||= {}); t.slapCaress = (t.slapCaress || 0) + (f.kind === 'slap' ? -1 : 1) * (f.amount || 1) * slapCaress; }
  return extra;
}
export function makeLearner(genome) {
  const g = normalize(genome);
  const net = compile(g);
  const dir = join(netsDir(), g.id);
  const optim = loadOptim(net, dir);
  const method = g.learning.method || 'gradient';
  // recompensas (con bofetadas pendientes) y memoria de las partidas que aún no se han mirado
  const absorb = (games) => {
    for (const game of games) if (!game.rewards) { const gameId = game.events && game.events[0] ? game.events[0].game : null; game.rewards = assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectory, playerId: game.playerId, stats: g.reward.stats || (g.reward.stats = {}), extraTerms: gameId ? takeFeedback(g.id, gameId, g.reward.slapCaress ?? 1) : null }); absorbGame(g, game); }
  };
  const learn = (games, { lrScale = 1 } = {}) => {
    const lc = { ...g.learning.gradient, lr: g.learning.gradient.lr * lrScale };
    absorb(games);
    if (method === 'evolution') return null; // la evolución no aprende partida a partida (spec/04 §10.2); la memoria sí
    const r = learnFromGames({ net, genome: g, games, optim, cfg: lc });
    applyImagination(g, r.imagination);
    g.weights = net.serialize();
    return r;
  };
  // lo mismo, aprendiendo en un hilo del grupo del servidor si lo hay (spec/11): absorbe aquí, aprende allí
  const learnAsync = async (games, { lrScale = 1 } = {}, pool = threads()) => {
    const lc = { ...g.learning.gradient, lr: g.learning.gradient.lr * lrScale };
    absorb(games);
    if (method === 'evolution') return null;
    const { result: r } = await learnInThread({ pool, net, genome: g, games, optim, cfg: lc });
    applyImagination(g, r.imagination);
    g.weights = net.serialize();
    return r;
  };
  // paso de evolución tras un duelo o una exhibición (spec/04 §10.2): copias contra esa misma rival
  const evolve = async ({ rival, seed = 0, soldiers = 1, play } = {}) => {
    const ev = g.learning.evolution;
    const seeds = Array.from({ length: Math.max(1, ev.gamesPerCandidate || 1) }, (_, j) => seed + 100003 + j);
    const sold = (j) => (soldiers === 'random' ? 1 + makeRng(seed + 100003 + j).int(4) : soldiers);
    const out = await evolutionRound({ net, genome: g, rival, soldiers: sold, seeds, cfg: { ...ev, frozen: g.frozen }, rng: makeRng(seed + 7), play });
    g.weights = net.serialize();
    return out;
  };
  return {
    net, genome: g, optim, learn, learnAsync, method, evolve, absorb,
    review: (games) => learn(games, { lrScale: 1 }),
    addStats: (s) => { g.stats.games += s.games || 0; g.stats.wins += s.wins || 0; g.stats.kills += s.kills || 0; g.stats.deaths += s.deaths || 0; },
    save: () => {
      g.weights = net.serialize();
      // el usuario puede estar editando la red mientras dura el duelo: no pisar nombre, nombres de neuronas ni congelados
      const disk = loadNet(g.id); if (disk) { g.name = disk.name; g.names = disk.names; g.frozen = disk.frozen; }
      saveNet(g); saveOptim(optim, dir);
    },
  };
}

// ---------- partidas (en proceso o en hilo) ----------
export function gameSummary(res, playerId) {
  const ev = res.events;
  return {
    result: res.result, events: ev, trajectories: res.trajectories,
    kills: ev.filter((e) => e.type === 'kill' && e.actor.playerId === playerId).length,
    deaths: ev.filter((e) => e.type === 'death' && e.actor.playerId === playerId).length,
    win: ev.some((e) => e.type === 'win' && e.actor.playerId === playerId) ? 1 : 0,
  };
}
export function playOne({ seed, left, right, soldiers }) {
  const r = playGame({ seed, left, right, soldiers });
  const me = r.room.players.find((p) => p.agentType === 'net' && p.learn);
  return { playerId: me ? me.id : null, ...gameSummary(r, me ? me.id : null) };
}

// ---------- entrenador ----------
let trainerSeq = null; // se inicia detrás de los entrenos guardados: tras reiniciar no se repiten (M9)
export function resetTrainerSeq() { trainerSeq = null; } // otro mundo (spec/09 §4): sigue detrás de lo guardado en él
// {netId: genoma} de las redes de una partida, tal como jugaron (M2); si comparten id, la que aprende
const genomesOf = (spec) => { const out = {}; for (const s of [spec.left, spec.right].sort((a, b) => (a && a.learn ? 1 : 0) - (b && b.learn ? 1 : 0))) if (s && s.type === 'net' && s.genome && s.genome.id) out[s.genome.id] = s.genome; return out; };
export function createTrainer(opts = {}) {
  if (trainerSeq === null) trainerSeq = nextRecordSeq('trainings', 't');
  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
  const emit = (ev, data) => { for (const fn of listeners[ev] || []) { try { fn(data); } catch { /* ignorar */ } } };
  const cfg = {
    netId: opts.netId, genome: opts.genome || null,
    opponents: opts.exploiter
      ? { antagonist: 1, hallOfFame: 0, self: 0, ghost: 0, hard: 2, ...(opts.opponents || {}), antagonist: 1, hallOfFame: 0, self: 0, antagonistId: (opts.opponents && opts.opponents.antagonistId) || readThroneFull().queen || null }
      : { antagonist: 0.6, hallOfFame: 0.25, self: 0.15, ghost: 0, hard: 2, antagonistId: null, ...(opts.opponents || {}) },
    exploiter: !!opts.exploiter,
    speed: opts.speed || 'turbo', workers: Math.max(1, Math.min(32, opts.workers || 1)),
    duration: opts.duration || { games: 100 }, soldiers: opts.soldiers ?? 'random', seed: Number.isInteger(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 30),
    recipe: { learning: opts.learning, schedule: opts.schedule, reward: opts.reward, frozen: opts.frozen, curriculum: opts.curriculum, exam: opts.exam, keepBest: opts.keepBest },
  };
  const tr = {
    id: `t${trainerSeq++}`, netId: cfg.netId, config: cfg, status: 'queued', games: 0, updates: 0, steps: 0, curve: [], rooms: [], sampleGames: [], startedAt: null, endedAt: null, lastLesson: null, error: null,
    phase: 'queued', recipe: {}, lesson: null, applied: null, exam: null, versionBefore: null, keptBest: null, curriculum: null,
    _stop: false, _paused: false, on,
    stop() { this._stop = true; this._paused = false; if (['queued', 'running', 'paused'].includes(this.status)) { this.status = 'stopped'; emit('training', this.info()); } },
    pause() { if (this.status === 'running') { this._paused = true; this.status = 'paused'; emit('training', this.info()); } },
    resume() { if (this.status === 'paused') { this._paused = false; this.status = 'running'; emit('training', this.info()); } },
    info() { return { id: this.id, netId: this.netId, status: this.status, games: this.games, updates: this.updates, steps: this.steps, startedAt: this.startedAt }; },
    async start() { return run(this); },
  };
  async function run(t) {
    t.startedAt = Date.now();
    const fail = (message) => { t.status = 'error'; t.phase = 'error'; t.error = message; t.endedAt = Date.now(); emit('error', { id: t.id, message }); emit('training', t.info()); emit('done', { id: t.id, reason: 'error', message }); };
    const g = cfg.genome ? normalize(cfg.genome) : loadNet(cfg.netId);
    if (!g) return fail(`red no encontrada: ${cfg.netId}`);
    if (!validate(g, { forPlay: true }).ok) return fail('la red no puede jugar (falta Elegir)');
    // receta (spec/04 §11): todo se valida antes de jugar; la red en disco (`g`) nunca recibe la receta
    const V = validateRecipe({ ...cfg.recipe, duration: cfg.duration, exploiter: cfg.exploiter }, g);
    if (!V.ok) return fail(V.errors[0].message);
    const R = V.recipe;
    t.recipe = R.given;
    const net = compile(g);
    const dir = join(netsDir(), g.id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let optim = loadOptim(net, dir);
    const lc = { ...R.learning.gradient };
    const batchSize = Math.max(1, lc.batchGames);
    // turbo: las partidas en hilos; con 1 hilo, en el grupo del servidor si lo hay (auditoría s3), si no, aquí mismo
    const own = cfg.speed === 'turbo' && cfg.workers > 1 ? new Pool(cfg.workers) : null;
    const pool = own || (cfg.speed === 'turbo' ? threads() : null);
    t.status = 'running'; emit('training', t.info());
    await new Promise((r) => setImmediate(r));
    const rivals = { antagonist: null, self: null, hall: [] };
    const throne = readThroneFull();
    const antagonistId = cfg.opponents.antagonistId || (throne.queen && throne.queen !== g.id ? throne.queen : null);
    if (antagonistId) { const a = loadNet(antagonistId); if (a) rivals.antagonist = { type: 'net', genome: a }; else if (AGENTS[antagonistId]) rivals.antagonist = { type: antagonistId, level: 3 }; }
    const mDir = join(dir, 'milestones');
    if (existsSync(mDir)) for (const f of readdirSync(mDir).filter((x) => x.endsWith('.json')).sort()) { try { rivals.hall.push({ type: 'net', genome: normalize(JSON.parse(readFileSync(join(mDir, f), 'utf8'))) }); } catch { /* ignorar */ } }
    const snapshotSelf = () => ({ type: 'net', genome: { ...g, weights: net.serialize() } });
    rivals.self = snapshotSelf();
    // sala de la fama = hitos propios + ex-reinas del trono (copias congeladas)
    // (las rutas relativas son de la carpeta de datos; las absolutas, de antes de B3)
    for (const h of throne.hallOfFame) {
      try { const snap = normalize(JSON.parse(readFileSync(isAbsolute(h.snapshot) ? h.snapshot : join(evoDir(), h.snapshot), 'utf8'))); if (snap.id !== g.id) rivals.hall.push({ type: 'net', genome: snap, kind: 'hallOfFame' }); }
      catch { appendLog({ type: 'warning', netId: g.id, snapshot: h.snapshot, message: `No encuentro la copia del salón de la fama de ${h.netId} (${h.snapshot}): no jugará contra ella.` }); }
    }
    const hallEntries = rivals.hall.map((spec) => ({ netId: spec.genome.id, kind: spec.kind || 'milestone', spec }));
    // la copia de sí misma juega con la temperatura del lote (es ella misma en ese lote); las demás rivales, con la suya
    const selfAt = (T) => (T === undefined || T === rivals.self.genome.traits.temperature ? rivals.self : { ...rivals.self, genome: { ...rivals.self.genome, traits: { ...rivals.self.genome.traits, temperature: T } } });
    const pickRival = (k, li = null, T = undefined) => {
      const l = lessonAt(li);
      const mix = { ...cfg.opponents, ...(l && l.opponents ? l.opponents : {}), antagonistId: rivals.antagonist ? (antagonistId || 'antagonist') : null };
      const pick = pickOpponent(g.id, mix, makeRng(cfg.seed + 1000003 * k), { throne, hall: hallEntries });
      if (pick.kind === 'antagonist') return rivals.antagonist ? { kind: 'antagonist', spec: rivals.antagonist } : { kind: 'self', spec: selfAt(T) };
      if (pick.kind === 'hallOfFame' || pick.kind === 'ghost') return { kind: pick.kind, spec: pick.spec };
      return { kind: 'self', spec: selfAt(T) };
    };
    const cur = R.curriculum ? createCurriculum(R.curriculum) : null;
    const lessonAt = (i) => (cur && i !== null && i !== undefined ? R.curriculum[i] : null);
    const soldiersFor = (k, li = null) => {
      const l = lessonAt(li);
      const s = l && l.soldiers !== undefined ? l.soldiers : cfg.soldiers;
      return s === 'random' ? 1 + makeRng(cfg.seed + 31 * k + 1).int(4) : s;
    };
    // la recompensa de una partida: la de la red, o la de práctica (receta y lección) con sus estadísticas aparte
    const rewardCache = new Map();
    const rewardFor = (li = null) => {
      const lr = lessonAt(li) ? lessonAt(li).reward : null;
      if (!rewardChanges(g.reward, R.reward, lr)) return g.reward;
      const key = JSON.stringify([R.reward, lr]);
      if (!rewardCache.has(key)) rewardCache.set(key, mergeReward(g.reward, R.reward, lr).reward);
      return rewardCache.get(key);
    };
    // la red tal como juega y aprende en este entreno
    const view = (T, li = null) => ({ ...g, learning: R.learning, traits: { ...g.traits, temperature: T }, reward: rewardFor(li), frozen: R.frozenAll });
    // reloj del entreno (spec/04 §11.2, A1): empieza tras el examen de antes y no cuenta las pausas; startedAt y elapsedMs
    // siguen siendo la duración total (§9.8)
    let clockStart = null, pausedMs = 0;
    const trainedMs = () => (clockStart === null ? 0 : Date.now() - clockStart - pausedMs);
    const progress = () => progressOf(cfg.duration, { games: t.games, elapsedMs: trainedMs() }) ?? 0;
    const at = (key, base, p) => (R.schedule[key] ? scheduleValue(R.schedule[key], p) : base);
    let batchApplied = null, batchOpen = false; // lo que vale para el lote en curso: se fija al empezar el lote
    const openBatch = () => {
      if (batchOpen) return;
      const p = progress();
      batchApplied = { lr: at('lr', lc.lr, p), entropy: at('entropy', lc.entropy, p), temperature: at('temperature', g.traits.temperature, p) };
      batchOpen = true;
    };
    // las bofetadas y caricias de durante el entreno respetan también los congelados de la receta
    const withTrainingFrozen = (fn) => { const keep = g.frozen; g.frozen = R.frozenAll; try { fn(); } finally { g.frozen = keep; } };
    const best = createBestTracker(20);
    let bestFlat = null;
    const lessonEvent = (reason, index, games, measure = null) => {
      const l = R.curriculum[index];
      t.lesson = reason === 'start' ? { index, name: l.name } : t.lesson;
      const d = { id: t.id, trainingId: t.id, netId: g.id, lesson: index, name: l.name, reason, games, ...(measure !== null ? { measure } : {}) };
      appendLog({ type: 'curriculum', ...d, id: undefined });
      emit('curriculum', d);
    };
    const scores4 = (b) => ({ aim: b.aim, cover: b.cover, survival: b.survival, adaptation: b.adaptation });
    const examNow = async (when) => {
      const subject = { ...g, weights: net.serialize() }; // la red tal como es, con su temperatura
      const res = await runBulletin(subject);
      if (when === 'after' && t._stop) return; // parar es parar (spec/04 §11.6): el examen de después no cuenta
      t.exam = { ...(t.exam || {}), [when]: scores4(res) };
      if (when === 'after') {
        const file = join(dir, 'bulletin.json'), tmp = file + '.tmp';
        writeFileSync(tmp, JSON.stringify({ netId: g.id, ts: Date.now(), ...scores4(res), details: res.details, seeds: res.seeds })); renameSync(tmp, file);
      }
      appendLog({ type: 'exam', netId: g.id, trainingId: t.id, when, ...scores4(res), seeds: res.seeds });
      emit('exam', { id: t.id, trainingId: t.id, netId: g.id, when, ...scores4(res) });
    };
    const wins = [];
    let bestWinRate = -1, milestoneN = 0, batch = [];
    let flushedGame = 0; // último punto de la curva ya escrito en disco (spec/08 §9.1)
    const saveAll = () => {
      const fresh = t.curve.filter((p) => p.game > flushedGame);
      if (fresh.length) { appendCurve(g.id, t.id, fresh); flushedGame = fresh[fresh.length - 1].game; }
      g.weights = net.serialize();
      // tras stop() el usuario ya puede editar la red: no pisar su nombre, nombres de neuronas ni congelados
      if (t._stop) { const disk = loadNet(g.id); if (disk) { g.name = disk.name; g.names = disk.names; g.frozen = disk.frozen; } }
      saveNet(g);
      saveOptim(optim, dir);
    };
    // partida de muestra (spec/04 §6, spec/07 §12.1): recompensa y emoción dentro del registro de la partida. Se empaqueta
    // con el sueño, en su hilo si lo hay (spec/11: `packSample`); aquí solo se escribe
    const sampleOf = (game, index) => {
      const events = game.events;
      const gameId = events[0] ? events[0].game : `g-${game.seed}-t${t.id}`;
      const start = events.find((e) => e.type === 'game.start');
      const nets = start && start.data && Array.isArray(start.data.players) ? start.data.players.map((p) => p.netId).filter(Boolean) : [g.id];
      const winner = game.win ? g.id : (start && start.data.players.find((p) => p.playerId !== game.playerId) || {}).netId || null;
      const meta = { gameId, kind: 'training', trainingId: t.id, seed: game.seed, soldiers: game.soldiers, left: start ? (start.data.players.find((p) => p.team === 'left') || {}).netId || null : null, right: start ? (start.data.players.find((p) => p.team === 'right') || {}).netId || null : null, nets: [...new Set(nets)], winner, kills: { [g.id]: game.kills }, rival: game.rivalKind, ts: Date.now() };
      return { index, meta, events, playerId: game.playerId, netId: g.id, tau: g.traits.teamSpirit, normalized: !!g.reward.normalize, genomes: game.genomes };
    };
    const keepSample = (p, game) => { saveGameKept(p.meta, null, null, { genomes: game.genomes, packed: p }); t.sampleGames.push(p.meta.gameId); };
    // bofetadas y caricias que llegaron mientras entrenaba: las aplica el siguiente sueño (spec/04 §10.4)
    const applyQueued = () => withTrainingFrozen(() => applyQueuedFeedback({ net, genome: g, trainingId: t.id }));
    // el sueño aprende en un hilo si hay grupo (spec/11), a cualquier velocidad: el del entreno si tiene más de 1 hilo; si
    // no, el del servidor. El lote siguiente espera a que vuelva y se aplique
    const learnPool = own || threads();
    const sleep = async () => {
      applyQueued();
      if (!batch.length) { batchOpen = false; return; }
      const A = batchApplied || { lr: lc.lr, entropy: lc.entropy, temperature: g.traits.temperature };
      const samples = batch.map((game, i) => (game.sample ? sampleOf(game, i) : null)).filter(Boolean);
      const { result: r, packed } = await learnInThread({ pool: learnPool, net, genome: view(A.temperature, cur ? cur.index() : null), games: batch, optim, cfg: { ...lc, lr: A.lr, entropy: A.entropy }, samples });
      r.update.applied = { ...A };
      t.applied = { ...A };
      batchOpen = false;
      t.updates++;
      for (const p of packed) keepSample(p, batch[p.index]);
      const refs = batch.map((game) => ({ game: game.events && game.events[0] ? game.events[0].game : null })).filter((x) => x.game);
      appendLog({ type: 'update', netId: g.id, trainingId: t.id, games: batch.length, loss: r.update.loss, entropy: r.update.entropy, gradNorm: r.update.gradNorm, top: r.update.top, applied: r.update.applied, refs });
      if (r.lesson) appendLog({ type: 'lesson', netId: g.id, trainingId: t.id, blockId: r.lesson.blockId, name: r.lesson.name, relChange: r.lesson.relChange, bulb: r.lesson.bulb, refs });
      applyImagination(g, r.imagination);
      const last = t.curve[t.curve.length - 1];
      if (last) { last.loss = r.update.loss; last.entropy = r.update.entropy; }
      t.lastLesson = r.lesson;
      emit('sleep', { id: t.id, netId: g.id, games: batch.length, update: r.update });
      if (r.lesson) emit('lesson', { id: t.id, netId: g.id, lesson: r.lesson });
      batch = [];
      saveAll();
      rivals.self = snapshotSelf();
    };
    const playSpec = (k) => {
      openBatch();
      const li = cur ? cur.index() : null;
      const rival = pickRival(k, li, batchApplied.temperature);
      const me = { type: 'net', genome: { ...view(batchApplied.temperature, li), weights: net.serialize() }, learn: true };
      const left = k % 2 ? rival.spec : me, right = k % 2 ? me : rival.spec;
      return { seed: cfg.seed + k, left, right, soldiers: soldiersFor(k, li), rivalKind: rival.kind, lesson: li };
    };
    const extraOf = (spec) => ({ rivalKind: spec.rivalKind, genomes: genomesOf(spec), soldiers: spec.soldiers, lesson: spec.lesson });
    const playLive = async (spec) => {
      const room = createRoom(`entreno ${g.name}`, { soldiersPerPlayer: spec.soldiers, seed: spec.seed, speed: cfg.speed === 'x10' ? 10 : 1 });
      const seat = (s, team) => room.addAgent(s.type, { level: s.level ?? 3, team, genome: s.genome ?? null, learn: !!s.learn });
      seat(spec.left, 'left'); seat(spec.right, 'right');
      t.rooms.push(room.code);
      room.start();
      while (room.phase === 'playing' && !t._stop) await new Promise((r) => setTimeout(r, 200));
      if (room.phase === 'playing') room.gameOver(true);
      const me = room.players.find((p) => p.agentType === 'net' && p.learn);
      const trajectories = {}; for (const p of room.players) if (p.agentType === 'net') trajectories[p.id] = { netId: p.netId, soldiers: room.agents[p.id].trajectories };
      return { playerId: me.id, ...gameSummary({ result: room.result, events: room.events, trajectories }, me.id) };
    };
    // registra una partida de la red real; opts: intoBatch (lote del gradiente), kind y semilla/soldados propios
    const record = (k, res, opts = {}) => {
      const traj = res.trajectories[res.playerId];
      const gameId = res.events && res.events[0] ? res.events[0].game : null;
      const rw = rewardFor(res.lesson ?? null);
      const rewards = assignRewards({ reward: rw, teamSpirit: g.traits.teamSpirit, events: res.events, trajectory: traj, playerId: res.playerId, stats: rw.stats || (rw.stats = {}), extraTerms: gameId ? takeFeedback(g.id, gameId, rw.slapCaress ?? 1) : null });
      absorbGame(g, { playerId: res.playerId, events: res.events, rewards });
      const eff = rewards.entries.length ? rewards.entries.reduce((s, e) => s + e.effective, 0) / rewards.entries.length : 0;
      const item = { events: res.events, trajectory: traj, playerId: res.playerId, genomes: res.genomes || null, rewards, sample: opts.sample ?? k % 20 === 0, k, seed: opts.seed ?? cfg.seed + k, soldiers: opts.soldiers ?? res.soldiers, rivalKind: res.rivalKind, rivalId: res.rivalId || null, win: res.win, kills: res.kills, deaths: res.deaths };
      if (opts.intoBatch !== false) batch.push(item);
      t.games++;
      g.stats.games++; g.stats.wins += res.win; g.stats.kills += res.kills; g.stats.deaths += res.deaths;
      wins.push(res.win);
      const point = { game: t.games, reward: eff, win: res.win, kills: res.kills, deaths: res.deaths, seed: item.seed, rival: res.rivalKind, ...(opts.kind ? { kind: opts.kind } : {}) };
      t.curve.push(point); if (t.curve.length > 5000) t.curve.shift();
      emit('curve', { id: t.id, trainingId: t.id, netId: g.id, point });
      if (wins.length >= 20) {
        const rate = wins.slice(-20).reduce((s, w) => s + w, 0) / 20;
        if (rate > bestWinRate && g.reward.milestones) {
          bestWinRate = rate; milestoneN++;
          if (!existsSync(mDir)) mkdirSync(mDir, { recursive: true });
          writeFileSync(join(mDir, `${String(milestoneN).padStart(3, '0')}.json`), JSON.stringify({ ...g, weights: net.serialize() }));
          rivals.hall.push({ type: 'net', genome: { ...g, weights: net.serialize() } });
          emit('milestone', { id: t.id, netId: g.id, kind: 'winrate', value: rate, n: milestoneN });
          appendLog({ type: 'milestone', netId: g.id, trainingId: t.id, kind: 'winrate', value: rate, n: 20, snapshot: milestoneN });
        }
      }
      if (R.keepBest && best.record(res.win, t.games - 1)) bestFlat = Float64Array.from(net.getFlat());
      // currículo: cuenta para la lección en la que se jugó (con hilos, una partida ya lanzada al cambiar no cuenta)
      if (cur && res.lesson === cur.index()) {
        const adv = cur.record({ game: t.games - 1, win: res.win, reward: eff });
        if (adv) { lessonEvent('met', adv.from, adv.games, adv.measure); lessonEvent('start', adv.to, t.games); }
        t.curriculum = cur.summary();
      }
      return item;
    };
    const doneBy = () => {
      const d = cfg.duration;
      if (d.games && t.games >= d.games) return 'games';
      if (d.minutes && trainedMs() >= d.minutes * 60000) return 'minutes';
      if (d.plateau) {
        const w = Math.max(1, d.plateau.window || 50), gain = d.plateau.minGain ?? 0.02;
        if (t.curve.length >= 2 * w) {
          const mean = (arr) => arr.reduce((s, p) => s + p.reward, 0) / arr.length;
          if (mean(t.curve.slice(-w)) - mean(t.curve.slice(-2 * w, -w)) < gain) return 'plateau';
        }
      }
      return null;
    };
    // ---- cómo aprende (spec/04 §10.2): gradiente, evolución o ambos ----
    const method = R.learning.method || 'gradient';
    const evoCfg = R.learning.evolution, bothCfg = R.learning.both;
    const playAsync = pool ? (spec) => pool.run({ type: 'play', seed: spec.seed, left: spec.left, right: spec.right, soldiers: spec.soldiers }) : playHeadless;
    let cycleGames = 0, cycleSteps = 0;
    const runEvolutionStep = async () => {
      const e = t.steps;
      const li = cur ? cur.index() : null;
      const p = progress();
      const A = { sigma: at('sigma', evoCfg.sigma, p), temperature: at('temperature', g.traits.temperature, p) };
      const vg = view(A.temperature, li);
      const rival = pickRival(e, li, A.temperature);
      const nG = Math.max(1, evoCfg.gamesPerCandidate || 1);
      const base = cfg.seed + 100003 * (e + 1);
      const sold = soldiersFor(e, li);
      applyQueued();
      const out = await evolutionRound({ net, genome: vg, rival: rival.spec, soldiers: sold, seeds: Array.from({ length: nG }, (_, j) => base + j), cfg: { ...evoCfg, sigma: A.sigma, frozen: R.frozenAll }, rng: makeRng(cfg.seed + 7 * (e + 1)), play: playAsync });
      out.update.applied = { ...A };
      t.applied = { ...A };
      t.games += out.update.games; t.steps++; t.updates++;
      // la red real contra el mismo rival: cuenta en la curva y se guarda (a x1/x10, en una sala viva)
      const me = { type: 'net', genome: { ...vg, weights: net.serialize() }, learn: true };
      const spec = { seed: base + nG, left: e % 2 ? rival.spec : me, right: e % 2 ? me : rival.spec, soldiers: sold, rivalKind: rival.kind, lesson: li };
      const res = cfg.speed !== 'turbo' ? await playLive(spec) : await playAsync(spec);
      const game = record(t.games, { ...res, ...extraOf(spec) }, { intoBatch: false, kind: 'showcase', sample: true, seed: spec.seed, soldiers: sold });
      const x = prepareExperience({ genome: vg, games: [game], optim, cfg: lc });
      const s = sampleOf(game, 0);
      keepSample(learnPool ? (await learnPool.run({ type: 'pack', sample: s, game: { rewards: game.rewards, trajectory: game.trajectory }, emotions: x.emotions })).packed : packSample(s, game, x.emotions), game); // en un hilo si lo hay (spec/11)
      const refs = game.events && game.events[0] ? [{ game: game.events[0].game }] : [];
      appendLog({ type: 'update', kind: 'evolution', netId: g.id, trainingId: t.id, step: e, games: out.update.games, meanFitness: out.update.meanFitness, bestFitness: out.update.bestFitness, top: out.update.top, applied: out.update.applied, refs });
      if (out.lesson) appendLog({ type: 'lesson', netId: g.id, trainingId: t.id, blockId: out.lesson.blockId, name: out.lesson.name, relChange: out.lesson.relChange, bulb: out.lesson.bulb, refs });
      t.lastLesson = out.lesson;
      emit('sleep', { id: t.id, netId: g.id, games: out.update.games, update: { ...out.update, step: e } });
      if (out.lesson) emit('lesson', { id: t.id, netId: g.id, lesson: out.lesson });
      saveAll();
      rivals.self = snapshotSelf();
    };
    const evolutionTurn = () => method === 'evolution' || (method === 'both' && cycleGames >= Math.max(0, bothCfg.gradientGamesPerCycle));
    let reason = null, k = 0;
    try {
      t.versionBefore = saveVersion(g, { reason: `antes del entreno ${t.id}`, trainingId: t.id });
      if (cur) { lessonEvent('start', 0, 0); t.curriculum = cur.summary(); }
      if (R.exam) { t.phase = 'exam-before'; emit('training', t.info()); await examNow('before'); }
      t.phase = 'training';
      clockStart = Date.now();
      while (!reason) {
        if (t._paused && !t._stop) {
          const p0 = Date.now();
          while (t._paused && !t._stop) await new Promise((r) => setTimeout(r, 50));
          pausedMs += Date.now() - p0;
        }
        if (t._stop) { reason = 'stopped'; break; }
        if (evolutionTurn()) {
          if (batch.length) await sleep(); // en 'ambos', el gradiente pendiente va antes que la evolución
          await runEvolutionStep();
          if (method === 'both' && ++cycleSteps >= Math.max(1, bothCfg.evolutionStepsPerCycle)) { cycleGames = 0; cycleSteps = 0; }
          reason = doneBy();
          if (!reason && t._stop) reason = 'stopped';
          continue;
        }
        if (cfg.speed !== 'turbo') { const spec = playSpec(k); const res = await playLive(spec); record(k, { ...res, ...extraOf(spec) }); k++; cycleGames++; }
        else if (!pool) { await new Promise((r) => setImmediate(r)); const spec = playSpec(k); const res = playOne(spec); record(k, { ...res, ...extraOf(spec) }); k++; cycleGames++; } // cede el bucle de eventos: el servidor sigue respondiendo
        else {
          const n = Math.min(cfg.workers, batchSize - batch.length || batchSize, method === 'both' ? Math.max(1, bothCfg.gradientGamesPerCycle - cycleGames) : Infinity);
          const specs = Array.from({ length: n }, (_, i) => playSpec(k + i));
          const results = await Promise.all(specs.map((spec) => pool.run({ type: 'play', seed: spec.seed, left: spec.left, right: spec.right, soldiers: spec.soldiers })));
          results.forEach((res, i) => { if (!reason && !t._stop) { record(k + i, { ...res, ...extraOf(specs[i]) }); reason = doneBy(); } });
          k += n; cycleGames += n;
          if (batch.length >= batchSize) await sleep();
          if (reason) break;
          continue;
        }
        if (batch.length >= batchSize) await sleep();
        reason = doneBy();
        if (!reason && t._stop) reason = 'stopped';
      }
      if (t._stop && reason !== 'stopped') reason = 'stopped';
      await sleep();
      if (R.keepBest) {
        const b = best.result();
        if (!b) t.keptBest = { restored: false, reason: 'menos de 20 partidas' };
        else {
          const restored = b.final < b.best;
          if (restored) net.setFlat(bestFlat);
          t.keptBest = { best: b.best, final: b.final, atGame: b.atGame, restored };
          appendLog({ type: 'keepBest', netId: g.id, trainingId: t.id, ...t.keptBest });
        }
      }
      saveAll();
      if (R.exam && !t._stop) { t.phase = 'exam-after'; emit('training', t.info()); await examNow('after'); }
    } catch (e) {
      if (own) own.close();
      return fail(e.message);
    }
    if (own) own.close();
    t.endedAt = Date.now(); // la duración deja de contar (spec/04 §9.8)
    if (t._stop) reason = 'stopped'; // también si se paró después del bucle (durante el examen de después)
    t.status = reason === 'stopped' ? 'stopped' : 'done';
    t.phase = t.status;
    emit('training', t.info());
    emit('done', { id: t.id, reason });
    return t;
  }
  return tr;
}
