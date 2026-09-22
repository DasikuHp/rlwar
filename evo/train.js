// Aprendizaje (spec/04 §3–§6, §9.4): gradiente de política (REINFORCE + baseline + BPTT), Adam/SGD,
// evolución (ES antitética), aprendizaje desde partidas y el entrenador (turbo con hilos, x1/x10 en vivo).
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { makeRng, gaussFrom } from '../shared/rng.js';
import { compile } from '../shared/nn.js';
import { normalize, validate, BLOCKS } from '../shared/genome.js';
import { softmaxT } from '../shared/policy.js';
import { assignRewards, returns } from '../shared/reward.js';
import { loadNet, saveNet, netsDir, saveGame, appendLog, readFeedback, writeFeedback } from './store.js';
import { emotionOf, memoryOf, updateMemory, rewardEvents, emotionEvents } from './truth.js';
import { readThroneFull, pickOpponent } from './league.js';
import { adaptImagination } from './mutate.js';
import { playGame } from '../server/headless.js';
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
export function adamInit(net) {
  const n = net.paramCount();
  return { m: new Float64Array(n), v: new Float64Array(n), t: 0, mean: { mean: 0, n: 0 } };
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
export function evolutionStep(net, fitnessFn, cfg = {}, rng = Math.random) {
  const pop = Math.max(2, cfg.population ?? 16), sigma = cfg.sigma ?? 0.02, lr = cfg.lr ?? 0.01;
  const frozenSet = new Set(cfg.frozen || []);
  const list = net.paramList();
  const mask = new Float64Array(net.paramCount()); let off = 0;
  for (const p of list) { if (!frozenSet.has(p.blockId)) mask.fill(1, off, off + p.array.length); off += p.array.length; }
  const theta = net.getFlat();
  const half = Math.ceil(pop / 2);
  const epsList = [], fitness = [];
  for (let j = 0; j < half; j++) {
    const eps = Float64Array.from(mask, (m) => (m ? sigma * gaussFrom(rng) : 0));
    epsList.push(eps);
    fitness.push(fitnessFn(Float64Array.from(theta, (v, i) => v + eps[i])));
    fitness.push(fitnessFn(Float64Array.from(theta, (v, i) => v - eps[i])));
  }
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

// ---------- aprender de partidas ----------
function episodesFromRewards(entries) {
  const bySoldier = {};
  for (const e of entries) (bySoldier[e.soldierId] ||= []).push(e);
  const episodes = [], values = [];
  for (const list of Object.values(bySoldier)) {
    list.sort((a, b) => a.decision.eventId - b.decision.eventId);
    episodes.push({ steps: list.map((e) => ({ decisionEventId: e.decision.eventId, value: e.decision.value === null || e.decision.value === undefined ? null : e.decision.value, obs: e.obs, phase: e.phase, chosen: e.decision.chosen, chosenMove: e.decision.chosenMove, adjustSample: e.decision.adjust ? e.decision.adjust.sample : null, moveAdjustSample: e.decision.moveAdjust ? e.decision.moveAdjust.sample : null, reward: e.effective })) });
    values.push(Float64Array.from(list, (e) => (e.decision.value === null || e.decision.value === undefined ? NaN : e.decision.value)));
  }
  return { episodes, values };
}
export function learnFromGames({ net, genome, games, optim, cfg = {} }) {
  const g = normalize(genome);
  const lc = { ...g.learning.gradient, ...cfg };
  const allEntries = [];
  let steps = 0, sumEff = 0;
  for (const game of games) {
    const r = game.rewards || assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectory, playerId: game.playerId, stats: g.reward.stats || (g.reward.stats = {}) });
    game.rewards = r;
    for (const e of r.entries) { allEntries.push(e); steps++; sumEff += e.effective; }
  }
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
    emotions.push({ decisionEventId: s.decisionEventId, ...emotionOf({ V, A: s.advantage ?? 0, valueSource: baseline === 'none' ? 'none' : baseline }) });
  }
  const pg = policyGradient(net, g, episodes, { ...lc, baseline });
  const update = applyUpdate(net, pg.grads, optim, { lr: lc.lr, clipNorm: lc.clipNorm, optimizer: lc.optimizer, frozen: g.frozen });
  const threshold = g.learning.sleep.lessonThreshold;
  const lesson = update.top ? { blockId: update.top.blockId, name: update.top.name, relChange: update.top.relChange, bulb: update.top.relChange > threshold } : null;
  return { imagination, emotions, update: { loss: pg.stats.loss, entropy: pg.stats.entropy, valueLoss: pg.stats.valueLoss, gradNorm: update.gradNorm, clipped: update.clipped, perBlock: update.perBlock, top: update.top, steps: pg.stats.steps }, lesson, rewards: { steps, meanEffective: steps ? sumEff / steps : 0 }, stats: pg.stats };
}

// ---------- estado de Adam en disco y aprendiz reutilizable (entrenador y duelos) ----------
export function loadOptim(net, dir) {
  let optim = adamInit(net);
  const file = join(dir, 'optim.json');
  try {
    if (existsSync(file)) {
      const o = JSON.parse(readFileSync(file, 'utf8'));
      if (o.m && o.m.length === optim.m.length) optim = { m: Float64Array.from(o.m), v: Float64Array.from(o.v), t: o.t || 0, mean: o.mean || { mean: 0, n: 0 } };
    }
  } catch { /* fichero roto: se empieza de cero */ }
  return optim;
}
export function saveOptim(optim, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, 'optim.json'), tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ m: Array.from(optim.m), v: Array.from(optim.v), t: optim.t, mean: optim.mean }));
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
  const learn = (games, { lrScale = 1 } = {}) => {
    const lc = { ...g.learning.gradient, lr: g.learning.gradient.lr * lrScale };
    for (const game of games) if (!game.rewards) { const gameId = game.events && game.events[0] ? game.events[0].game : null; game.rewards = assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectory, playerId: game.playerId, stats: g.reward.stats || (g.reward.stats = {}), extraTerms: gameId ? takeFeedback(g.id, gameId, g.reward.slapCaress ?? 1) : null }); absorbGame(g, game); }
    const r = learnFromGames({ net, genome: g, games, optim, cfg: lc });
    applyImagination(g, r.imagination);
    g.weights = net.serialize();
    return r;
  };
  return {
    net, genome: g, optim, learn,
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
const WORKER_FILE = fileURLToPath(new URL('./worker.js', import.meta.url));
class Pool {
  constructor(n) { this.workers = Array.from({ length: n }, () => new Worker(WORKER_FILE)); this.free = this.workers.slice(); this.queue = []; }
  run(msg) {
    return new Promise((resolve, reject) => {
      const go = (w) => {
        const onMsg = (m) => { w.off('message', onMsg); w.off('error', onErr); this.free.push(w); this.pump(); if (m.type === 'error') reject(new Error(m.message)); else resolve(m); };
        const onErr = (e) => { w.off('message', onMsg); w.off('error', onErr); this.free.push(w); this.pump(); reject(e); };
        w.on('message', onMsg); w.on('error', onErr); w.postMessage(msg);
      };
      this.queue.push(go); this.pump();
    });
  }
  pump() { while (this.free.length && this.queue.length) this.queue.shift()(this.free.pop()); }
  close() { for (const w of this.workers) w.terminate(); }
}

// ---------- entrenador ----------
let trainerSeq = 1;
export function createTrainer(opts = {}) {
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
    learn: opts.learn || {},
  };
  const tr = {
    id: `t${trainerSeq++}`, netId: cfg.netId, config: cfg, status: 'queued', games: 0, updates: 0, curve: [], rooms: [], sampleGames: [], startedAt: null, lastLesson: null, error: null,
    _stop: false, _paused: false, on,
    stop() { this._stop = true; this._paused = false; if (['queued', 'running', 'paused'].includes(this.status)) { this.status = 'stopped'; emit('training', this.info()); } },
    pause() { if (this.status === 'running') { this._paused = true; this.status = 'paused'; emit('training', this.info()); } },
    resume() { if (this.status === 'paused') { this._paused = false; this.status = 'running'; emit('training', this.info()); } },
    info() { return { id: this.id, netId: this.netId, status: this.status, games: this.games, updates: this.updates, startedAt: this.startedAt }; },
    async start() { return run(this); },
  };
  async function run(t) {
    t.startedAt = Date.now();
    const fail = (message) => { t.status = 'error'; t.error = message; emit('error', { id: t.id, message }); emit('training', t.info()); emit('done', { id: t.id, reason: 'error', message }); };
    const g = cfg.genome ? normalize(cfg.genome) : loadNet(cfg.netId);
    if (!g) return fail(`red no encontrada: ${cfg.netId}`);
    if (!validate(g, { forPlay: true }).ok) return fail('la red no puede jugar (falta Elegir)');
    const net = compile(g);
    const dir = join(netsDir(), g.id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let optim = loadOptim(net, dir);
    const lc = { ...g.learning.gradient, ...cfg.learn };
    const batchSize = Math.max(1, lc.batchGames);
    const pool = cfg.speed === 'turbo' && cfg.workers > 1 ? new Pool(cfg.workers) : null;
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
    for (const h of throne.hallOfFame) { try { const snap = normalize(JSON.parse(readFileSync(h.snapshot, 'utf8'))); if (snap.id !== g.id) rivals.hall.push({ type: 'net', genome: snap, kind: 'hallOfFame' }); } catch { /* copia ilegible */ } }
    const hallEntries = rivals.hall.map((spec) => ({ netId: spec.genome.id, kind: spec.kind || 'milestone', spec }));
    const pickRival = (k) => {
      const mix = { ...cfg.opponents, antagonistId: rivals.antagonist ? (antagonistId || 'antagonist') : null };
      const pick = pickOpponent(g.id, mix, makeRng(cfg.seed + 1000003 * k), { throne, hall: hallEntries });
      if (pick.kind === 'antagonist') return rivals.antagonist ? { kind: 'antagonist', spec: rivals.antagonist } : { kind: 'self', spec: rivals.self };
      if (pick.kind === 'hallOfFame' || pick.kind === 'ghost') return { kind: pick.kind, spec: pick.spec };
      return { kind: 'self', spec: rivals.self };
    };
    const soldiersFor = (k) => (cfg.soldiers === 'random' ? 1 + makeRng(cfg.seed + 31 * k + 1).int(4) : cfg.soldiers);
    const wins = [];
    let bestWinRate = -1, milestoneN = 0, batch = [];
    const saveAll = () => {
      g.weights = net.serialize();
      // tras stop() el usuario ya puede editar la red: no pisar su nombre, nombres de neuronas ni congelados
      if (t._stop) { const disk = loadNet(g.id); if (disk) { g.name = disk.name; g.names = disk.names; g.frozen = disk.frozen; } }
      saveNet(g);
      saveOptim(optim, dir);
    };
    const sleep = () => {
      if (!batch.length) return;
      const r = learnFromGames({ net, genome: g, games: batch, optim, cfg: lc });
      t.updates++;
      // partidas de muestra (spec/04 §6, spec/07 §12.1): recompensa y emoción dentro del registro de la partida
      const byGame = new Map();
      for (const game of batch) if (game.sample) byGame.set(game, new Set(Object.values(game.trajectory && game.trajectory.soldiers ? game.trajectory.soldiers : {}).flat().map((s) => s.decision && s.decision.eventId)));
      for (const [game, ids] of byGame) {
        const events = game.events.map((e) => ({ ...e }));
        rewardEvents(events, game.rewards, { playerId: game.playerId, netId: g.id, tau: g.traits.teamSpirit, normalized: !!g.reward.normalize });
        emotionEvents(events, r.emotions.filter((em) => ids.has(em.decisionEventId)), { playerId: game.playerId, netId: g.id });
        const gameId = events[0] ? events[0].game : `g-${game.seed}-t${t.id}`;
        const start = events.find((e) => e.type === 'game.start');
        const nets = start && start.data && Array.isArray(start.data.players) ? start.data.players.map((p) => p.netId).filter(Boolean) : [g.id];
        const winner = game.win ? g.id : (start && start.data.players.find((p) => p.playerId !== game.playerId) || {}).netId || null;
        saveGame({ gameId, kind: 'training', trainingId: t.id, seed: game.seed, soldiers: game.soldiers, left: start ? (start.data.players.find((p) => p.team === 'left') || {}).netId || null : null, right: start ? (start.data.players.find((p) => p.team === 'right') || {}).netId || null : null, nets: [...new Set(nets)], winner, kills: { [g.id]: game.kills }, rival: game.rivalKind, ts: Date.now() }, events, { [game.playerId]: game.trajectory });
        t.sampleGames.push(gameId);
      }
      const refs = batch.map((game) => ({ game: game.events && game.events[0] ? game.events[0].game : null })).filter((x) => x.game);
      appendLog({ type: 'update', netId: g.id, trainingId: t.id, games: batch.length, loss: r.update.loss, entropy: r.update.entropy, gradNorm: r.update.gradNorm, top: r.update.top, refs });
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
      const rival = pickRival(k);
      const me = { type: 'net', genome: { ...g, weights: net.serialize() }, learn: true };
      const left = k % 2 ? rival.spec : me, right = k % 2 ? me : rival.spec;
      return { seed: cfg.seed + k, left, right, soldiers: soldiersFor(k), rivalKind: rival.kind };
    };
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
    const record = (k, res) => {
      const traj = res.trajectories[res.playerId];
      const gameId = res.events && res.events[0] ? res.events[0].game : null;
      const rewards = assignRewards({ reward: g.reward, teamSpirit: g.traits.teamSpirit, events: res.events, trajectory: traj, playerId: res.playerId, stats: g.reward.stats || (g.reward.stats = {}), extraTerms: gameId ? takeFeedback(g.id, gameId, g.reward.slapCaress ?? 1) : null });
      absorbGame(g, { playerId: res.playerId, events: res.events, rewards });
      const eff = rewards.entries.length ? rewards.entries.reduce((s, e) => s + e.effective, 0) / rewards.entries.length : 0;
      batch.push({ events: res.events, trajectory: traj, playerId: res.playerId, rewards, sample: k % 20 === 0, k, seed: cfg.seed + k, soldiers: res.soldiers, rivalKind: res.rivalKind, rivalId: res.rivalId || null, win: res.win, kills: res.kills, deaths: res.deaths });
      t.games++;
      g.stats.games++; g.stats.wins += res.win; g.stats.kills += res.kills; g.stats.deaths += res.deaths;
      wins.push(res.win);
      const point = { game: t.games, reward: eff, win: res.win, kills: res.kills, deaths: res.deaths, seed: cfg.seed + k, rival: res.rivalKind };
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
    };
    const doneBy = () => {
      const d = cfg.duration;
      if (d.games && t.games >= d.games) return 'games';
      if (d.minutes && Date.now() - t.startedAt >= d.minutes * 60000) return 'minutes';
      if (d.plateau) {
        const w = Math.max(1, d.plateau.window || 50), gain = d.plateau.minGain ?? 0.02;
        if (t.curve.length >= 2 * w) {
          const mean = (arr) => arr.reduce((s, p) => s + p.reward, 0) / arr.length;
          if (mean(t.curve.slice(-w)) - mean(t.curve.slice(-2 * w, -w)) < gain) return 'plateau';
        }
      }
      return null;
    };
    let reason = null, k = 0;
    try {
      while (!reason) {
        while (t._paused && !t._stop) await new Promise((r) => setTimeout(r, 50));
        if (t._stop) { reason = 'stopped'; break; }
        if (cfg.speed !== 'turbo') { const spec = playSpec(k); const res = await playLive(spec); record(k, { ...res, rivalKind: spec.rivalKind }); k++; }
        else if (!pool) { await new Promise((r) => setImmediate(r)); const spec = playSpec(k); const res = playOne(spec); record(k, { ...res, rivalKind: spec.rivalKind }); k++; } // cede el bucle de eventos: el servidor sigue respondiendo
        else {
          const n = Math.min(cfg.workers, batchSize - batch.length || batchSize);
          const specs = Array.from({ length: n }, (_, i) => playSpec(k + i));
          const results = await Promise.all(specs.map((spec) => pool.run({ type: 'play', seed: spec.seed, left: spec.left, right: spec.right, soldiers: spec.soldiers })));
          results.forEach((res, i) => { if (!reason && !t._stop) { record(k + i, { ...res, rivalKind: specs[i].rivalKind }); reason = doneBy(); } });
          k += n;
          if (batch.length >= batchSize) sleep();
          if (reason) break;
          continue;
        }
        if (batch.length >= batchSize) sleep();
        reason = doneBy();
        if (!reason && t._stop) reason = 'stopped';
      }
      if (t._stop && reason !== 'stopped') reason = 'stopped';
      sleep();
      saveAll();
    } catch (e) {
      if (pool) pool.close();
      return fail(e.message);
    }
    if (pool) pool.close();
    t.status = reason === 'stopped' ? 'stopped' : 'done';
    emit('training', t.info());
    emit('done', { id: t.id, reason });
    return t;
  }
  return tr;
}
