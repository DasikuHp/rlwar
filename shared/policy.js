// Política (spec/03 §7, §9.2): la red decide disparo (+ajuste) y movimiento; log-probabilidades,
// atribución "tapar y comparar", registro `decision` para el overlay y el aprendizaje.
import { gaussFrom, makeRng } from './rng.js';
import { normalize, BLOCKS } from './genome.js';
import { observeNormalized, generateCandidates, applyAdjust, adjustScales, simulateCandidate, toLocal, toWorld } from './percept.js';
import { slideMove } from './geometry.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const logN = (a, mu, sd) => -0.5 * Math.log(2 * Math.PI * sd * sd) - (a - mu) ** 2 / (2 * sd * sd);

export function softmaxT(scores, temperature = 1) {
  const T = Math.max(1e-6, temperature);
  const n = scores.length; const out = new Float64Array(n);
  let mx = -Infinity; for (let i = 0; i < n; i++) mx = Math.max(mx, scores[i] / T);
  let z = 0; for (let i = 0; i < n; i++) { out[i] = Math.exp(scores[i] / T - mx); z += out[i]; }
  for (let i = 0; i < n; i++) out[i] /= z;
  return out;
}
export function sampleIndex(probs, rng) {
  const r = rng(); let acc = 0;
  for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (r <= acc) return i; }
  return probs.length - 1;
}
// semilla de la Imaginación: depende del estado, no del rng de la decisión (spec/03 §9.2)
function candSeed(state, soldierId) {
  const idx = Math.max(0, state.soldiers.findIndex((s) => s.id === soldierId));
  return ((((state.stats && state.stats.shots) || 0) * 1000003) + idx * 7919) % 2147483647;
}
function summarize(net, out) {
  const s = {};
  for (const id of net.order) {
    if (net.genome.blocks.find((b) => b.id === id).type.startsWith('eye.')) continue;
    const a = out.activations[id]; if (!a) continue;
    const flat = Array.isArray(a) ? Float64Array.from(a.flatMap((r) => Array.from(r))) : a;
    let m = 0; for (let i = 0; i < flat.length; i++) m += Math.abs(flat[i]); m = flat.length ? m / flat.length : 0;
    const k = Math.min(32, flat.length); const sample = [];
    for (let i = 0; i < k; i++) sample.push(flat[Math.floor(i * flat.length / k)]);
    s[id] = { mean: m, sample };
  }
  return s;
}
const attentionOf = (out) => { const keys = Object.keys(out.attention); if (!keys.length) return null; const o = {}; for (const k of keys) o[k] = out.attention[k].map((h) => Array.from(h)); return o; };
const withTeam = (obs, team) => ({ ...obs, team: team || {} });

function chosenProb(net, obs, memory, chosen, phase, T) {
  const out = net.forward(obs, memory);
  const scores = phase === 'shoot' ? out.outputs.choose && out.outputs.choose.scores : out.outputs.move && out.outputs.move.scores;
  if (!scores) return 0;
  return softmaxT(scores, T)[chosen];
}
export function attribute(net, obs, memory, chosen, phase = 'shoot') {
  const g = net.genome, T = g.traits.temperature;
  const base = chosenProb(net, obs, memory, chosen, phase, T);
  const rows = [];
  for (const b of g.blocks.filter((x) => x.type.startsWith('eye.'))) {
    const blind = { ...obs, ctx: { ...obs.ctx }, cand: { ...obs.cand }, move: { ...obs.move } };
    if (obs.ctx[b.id]) blind.ctx[b.id] = new Float64Array(obs.ctx[b.id].length);
    if (obs.cand[b.id]) blind.cand[b.id] = obs.cand[b.id].map((r) => new Float64Array(r.length));
    if (obs.move[b.id]) blind.move[b.id] = obs.move[b.id].map((r) => new Float64Array(r.length));
    rows.push({ blockId: b.id, name: BLOCKS[b.type].name, drop: base - chosenProb(net, blind, memory, chosen, phase, T), share: 0 });
  }
  const pos = rows.reduce((s, r) => s + Math.max(0, r.drop), 0);
  if (pos > 0) for (const r of rows) r.share = Math.max(0, r.drop) / pos;
  return rows;
}

export function decideShot({ net, genome, state, soldierId, memory, team = null, rng, attribution = false, sims = null }) {
  const t0 = performance.now();
  const g = normalize(genome); const T = g.traits.temperature, pulse = Math.max(1e-6, g.traits.pulse);
  const soldier = state.soldiers.find((s) => s.id === soldierId);
  const cands = generateCandidates(state, soldier, g.imagination, makeRng(candSeed(state, soldierId)));
  const ctx = { soldiers: state.soldiers, obstacles: state.obstacles, bites: state.bites || [], soldier, team: soldier.team };
  const obs = withTeam(observeNormalized(state, soldierId, g, { phase: 'shoot', cands, sims }), team);
  const out = net.forward(obs, memory);
  if (!out.outputs.choose) throw new Error('la red no tiene el bloque Elegir');
  const scores = out.outputs.choose.scores;
  const p = softmaxT(scores, T);
  const chosen = sampleIndex(p, rng);
  let second = -Infinity; for (let i = 0; i < p.length; i++) if (i !== chosen) second = Math.max(second, p[i]);
  const margin = p.length > 1 ? p[chosen] - second : 1;
  // simulación de todos los candidatos para el overlay (la red solo la ve si tiene 🔮)
  const simAll = obs.sims || cands.map((c) => simulateSafe(c, ctx));
  let choice = cands[chosen], adjust = null, logAdjust = null;
  if (out.outputs.adjust) {
    const mu = Array.from(out.outputs.adjust.mu[chosen]);
    const sample = mu.map((m) => clamp(m + pulse * gaussFrom(rng), -3, 3));
    logAdjust = sample.reduce((s, a, i) => s + logN(a, mu[i], pulse), 0);
    const adjusted = applyAdjust(cands[chosen], sample);
    adjust = { mu, sample, scales: adjustScales(cands[chosen]), paramsBefore: cands[chosen].params.slice(), paramsAfter: adjusted.params.slice(), exprLocal: adjusted.exprLocal, expr: adjusted.expr };
    choice = adjusted;
  }
  const decision = {
    soldierId, turn: (state.stats && state.stats.shots) || 0, phase: 'shoot', netId: g.id, ms: 0,
    candidates: cands.map((c, i) => ({ i, family: c.family, params: c.params.slice(), mode: c.mode, exprLocal: c.exprLocal, expr: c.expr, angle: c.angle, team: c.team,
      score: scores[i], p: p[i], sim: obs.sims ? pickSim(obs.sims[i]) : null, points: simAll[i].polyline })),
    chosen, margin, adjust, moves: null, chosenMove: null, moveAdjust: null,
    value: out.outputs.value === null || out.outputs.value === undefined ? null : out.outputs.value,
    attention: attentionOf(out), attribution: attribution ? attribute(net, obs, memory, chosen, 'shoot') : null,
    logp: { choose: Math.log(p[chosen]), adjust: logAdjust, move: null, moveAdjust: null },
    activationsSummary: summarize(net, out),
  };
  decision.ms = performance.now() - t0;
  return { choice: { mode: choice.mode, expr: choice.expr, angle: choice.mode === 'ode2' ? choice.angle : null, family: choice.family, params: choice.params.slice(), exprLocal: choice.exprLocal }, decision, memory: out.state, obs };
}
function simulateSafe(c, ctx) { try { return simulateCandidate(c, ctx, false); } catch { return { polyline: [[0, 0], [0, 0]] }; } }
const pickSim = (s) => ({ type: s.type, minDist: s.minDist, endX: s.endX, endY: s.endY, victimId: s.victimId });

export function decideMove({ net, genome, state, soldierId, memory, team = null, rng, shot = null }) {
  const t0 = performance.now();
  const g = normalize(genome); const T = g.traits.temperature, pulse = Math.max(1e-6, g.traits.pulse);
  const soldier = state.soldiers.find((s) => s.id === soldierId);
  const obs = withTeam(observeNormalized(state, soldierId, g, { phase: 'move' }), team);
  const out = net.forward(obs, memory);
  const decision = {
    soldierId, turn: (state.stats && state.stats.shots) || 0, phase: 'move', netId: g.id, ms: 0,
    candidates: null, chosen: null, margin: null, adjust: null, moves: null, chosenMove: null, moveAdjust: null,
    value: out.outputs.value === null || out.outputs.value === undefined ? null : out.outputs.value,
    attention: attentionOf(out), attribution: null,
    logp: { choose: null, adjust: null, move: null, moveAdjust: null }, activationsSummary: summarize(net, out),
    shot: shot ? { type: shot.result && shot.result.type } : null,
  };
  let move = 'stay';
  if (out.outputs.move) {
    const scores = out.outputs.move.scores;
    const p = softmaxT(scores, T);
    const k = sampleIndex(p, rng);
    const dests = obs.destinations;
    decision.moves = dests.map((d, i) => ({ i, to: { x: d.to.x, y: d.to.y }, stay: d.stay, impossible: d.impossible, why: d.why, cover: d.cover, distEnemy: d.distEnemy, los: d.los, score: scores[i], p: p[i] }));
    decision.chosenMove = k;
    decision.logp.move = Math.log(p[k]);
    const chosen = dests[k];
    if (out.outputs.move.mu) {
      const mu = Array.from(out.outputs.move.mu[k]);
      const sample = mu.map((m) => clamp(m + pulse * gaussFrom(rng), -3, 3));
      decision.logp.moveAdjust = sample.reduce((s, a, i) => s + logN(a, mu[i], pulse), 0);
      const tl = toLocal(chosen.to, soldier.team);
      const target = toWorld({ x: tl.x + 0.5 * sample[0], y: tl.y + 0.5 * sample[1] }, soldier.team);
      // se pide tal cual (spec/10 §4): si es imposible, la sala lo rechaza y la red recibe el castigo; aquí solo se anota
      // lo que pasará
      const r = slideMove({ from: { x: soldier.x, y: soldier.y }, requested: target, soldiers: state.soldiers, obstacles: state.obstacles, bites: state.bites || [], selfId: soldierId });
      decision.moveAdjust = { mu, sample, scales: [0.5, 0.5], target, to: { x: r.to.x, y: r.to.y }, reason: r.reason, why: r.why };
      move = { x: target.x, y: target.y };
    } else move = chosen.stay ? 'stay' : { x: chosen.to.x, y: chosen.to.y };
  }
  decision.ms = performance.now() - t0;
  return { move, decision, memory: out.state, obs };
}
