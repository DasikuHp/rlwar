// F4 — Entrenador (evo/train.js), segunda tanda de casos que destapó la prueba de mutantes tras
// aprendizaje-extra (congelado): congelado intermedio exacto, clipNorm por defecto, momento de Adam con
// gradiente 0, fórmula exacta de la evolución y sus valores por defecto, valueLoss finito con Corazonada.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-extra2-'));
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const { normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { playGame } = await import('../server/headless.js');
const paramRanges = (net) => { const out = {}; let off = 0; for (const p of net.paramList()) { (out[p.blockId] ||= []).push([off, off + p.array.length]); off += p.array.length; } return out; };

check('applyUpdate: congelar un bloque intermedio deja exactamente ese bloque quieto y mueve todos los demás −lr·g; clipNorm por defecto 5', () => {
  const g = normalize(TEMPLATES.sniper.genome);
  const n1 = compile({ ...g, frozen: ['d'] }); const b1 = n1.getFlat(); const rg = paramRanges(n1);
  T.applyUpdate(n1, Float64Array.from(b1, () => 1), T.adamInit(n1), { lr: 0.1, clipNorm: 1e9, optimizer: 'sgd', frozen: ['d'] });
  const a1 = n1.getFlat();
  const inD = new Set(); for (const [lo, hi] of rg.d) for (let i = lo; i < hi; i++) inD.add(i);
  for (let i = 0; i < a1.length; i++) {
    if (inD.has(i)) assert.equal(a1[i], b1[i], `d[${i}] congelado`);
    else assert.ok(near(a1[i], b1[i] - 0.1, 1e-12), `parámetro ${i} debe moverse −0.1 (${a1[i] - b1[i]})`);
  }
  const n2 = compile(g); const b2 = n2.getFlat();
  const small = Float64Array.from(b2, () => 1 / Math.sqrt(b2.length)); // norma 1 < 5: sin recorte por defecto
  const r = T.applyUpdate(n2, small, T.adamInit(n2), { lr: 0.1, optimizer: 'sgd' });
  assert.equal(r.clipped, false);
  const a2 = n2.getFlat();
  for (let i = 0; i < a2.length; i++) assert.ok(near(a2[i], b2[i] - 0.1 * small[i], 1e-12), 'sin recorte con la norma por defecto (5)');
});

check('applyUpdate (Adam): un parámetro con gradiente 0 sigue moviéndose por su momento anterior', () => {
  const g = normalize(TEMPLATES.sniper.genome);
  const net = compile(g); const optim = T.adamInit(net);
  const ones = Float64Array.from(net.getFlat(), () => 1);
  T.applyUpdate(net, ones, optim, { lr: 0.01, clipNorm: 1e9, optimizer: 'adam', frozen: [] });
  const mid = net.getFlat();
  T.applyUpdate(net, new Float64Array(ones.length), optim, { lr: 0.01, clipNorm: 1e9, optimizer: 'adam', frozen: [] });
  const after = net.getFlat();
  let moved = 0; for (let i = 0; i < after.length; i++) if (after[i] !== mid[i]) moved++;
  assert.equal(moved, after.length, `con gradiente 0 y momento, Adam mueve todos los parámetros (movidos ${moved}/${after.length})`);
});

check('evolutionStep: actualización exacta lr/(pop·σ)·Σ (F⁺−F⁻)·ε con parejas antitéticas (sin ranking); valores por defecto σ 0.02, lr 0.01', () => {
  const g = normalize(TEMPLATES.sniper.genome);
  const net = compile(g); const base = net.getFlat();
  const calls = [];
  const fit = (theta) => { calls.push(Float64Array.from(theta)); return [0, 0, 1, 0][calls.length - 1]; };
  T.evolutionStep(net, fit, { population: 4, sigma: 0.1, lr: 0.05, antithetic: true, rankNormalize: false, frozen: [] }, makeRng(3));
  assert.equal(calls.length, 4);
  for (let i = 0; i < base.length; i++) assert.ok(near(calls[1][i] - base[i], -(calls[0][i] - base[i]), 1e-12) && near(calls[3][i] - base[i], -(calls[2][i] - base[i]), 1e-12), 'parejas antitéticas');
  const eps1 = Array.from(calls[2], (v, i) => v - base[i]);
  const scale = 0.05 / (4 * 0.1);
  const after = net.getFlat();
  let moved = 0;
  for (let i = 0; i < after.length; i++) { assert.ok(near(after[i] - base[i], scale * eps1[i], 1e-12), `Δθ[${i}] = ${after[i] - base[i]} esperado ${scale * eps1[i]}`); if (after[i] !== base[i]) moved++; }
  assert.ok(moved > 0);
  const n2 = compile(g); const b2 = n2.getFlat(); let maxDev = 0;
  const fit2 = (theta) => { for (let i = 0; i < theta.length; i++) maxDev = Math.max(maxDev, Math.abs(theta[i] - b2[i])); return theta.reduce((s, v) => s + v, 0); };
  T.evolutionStep(n2, fit2, {}, makeRng(4));
  assert.ok(maxDev > 0.005 && maxDev <= 0.02 * 5.5, `σ por defecto 0.02: desvío máximo ${maxDev}`);
  const sumDelta = Array.from(n2.getFlat()).reduce((s, v, i) => s + (v - b2[i]), 0);
  assert.ok(sumDelta > 0 && sumDelta < 0.01 * b2.length, `lr por defecto 0.01 y positivo: Σ Δθ = ${sumDelta}`);
});

check('learnFromGames con Corazonada: valueLoss finito y > 0 (los valores de la decisión entran en la referencia)', () => {
  const r0 = store.saveNet({ ...JSON.parse(JSON.stringify(TEMPLATES.seer.genome)), id: 'ex-v', name: 'ex-v' }); assert.ok(r0.ok);
  const g0 = store.loadNet('ex-v');
  const r = playGame({ seed: 5, left: { type: 'net', netId: 'ex-v', learn: true }, right: { type: 'sniper' }, soldiers: 1 });
  const p = r.room.players.find((x) => x.agentType === 'net');
  const game = { events: r.events, trajectory: r.trajectories[p.id], playerId: p.id };
  const net = compile(g0);
  const res = T.learnFromGames({ net, genome: g0, games: [game], optim: T.adamInit(net), cfg: { ...g0.learning.gradient, baseline: 'value' } });
  assert.ok(Number.isFinite(res.update.valueLoss) && res.update.valueLoss > 0, `valueLoss = ${res.update.valueLoss}`);
  assert.ok(Number.isFinite(res.update.loss));
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nentrenador-extra OK');
