// Auditoría de la sesión 5 (sesión 6, 2026-09-24): huecos de los mutantes de `evo/train.js` 103, 264 y 293 — el estado
// inicial de Adam (`t`) y de la base "media" de la ventaja (`mean`), recién creado o leído de `optim.json`. Oráculos
// independientes del código: el Adam de libro (Kingma y Ba, "Adam: A Method for Stochastic Optimization", ICLR 2015,
// arXiv:1412.6980, Algoritmo 1: β₁ 0,9, β₂ 0,999, ε 1e-8, t empieza en 0 y el primer paso es t = 1, así que el primer
// paso mueve cada parámetro −lr·g/(|g|+ε)) y la ventaja de spec/04 §2 con la media móvil EMA 0,05 que empieza en 0
// (primera ventaja = G − 0; decisión del usuario, sesión 6), calculada a mano. Escrito DESPUÉS del código (cubre
// supervivientes) y congelado. En proceso, sin servidor. Uso: node test/huecos-s5.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s5-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const T = await import('../evo/train.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');

const sniper = () => normalize(JSON.parse(JSON.stringify(TEMPLATES.sniper.genome)));
const gradsOf = (n, seed) => { const r = makeRng(seed); return Float64Array.from({ length: n }, () => (r() - 0.5) * (r() < 0.5 ? 1e-3 : 3)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
// Adam de libro (Kingma y Ba 2015, Algoritmo 1), escrito aquí aparte: devuelve los parámetros tras cada paso
function textbookAdam(theta0, gradList, lr) {
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const theta = Float64Array.from(theta0), m = new Float64Array(theta.length), v = new Float64Array(theta.length);
  const out = [];
  gradList.forEach((g, k) => {
    const t = k + 1;
    for (let i = 0; i < theta.length; i++) {
      m[i] = b1 * m[i] + (1 - b1) * g[i];
      v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
      const mh = m[i] / (1 - b1 ** t), vh = v[i] / (1 - b2 ** t);
      theta[i] -= lr * mh / (Math.sqrt(vh) + eps);
    }
    out.push(Float64Array.from(theta));
  });
  return out;
}
const NO_CLIP = { lr: 0.01, clipNorm: 1e12, optimizer: 'adam', frozen: [] };

await check('Adam recién creado: el primer paso mueve cada parámetro −lr·g/(|g|+ε) (de libro: t empieza en 0)', () => {
  const net = compile(sniper());
  const optim = T.adamInit(net);
  assert.equal(optim.t, 0, 't empieza en 0');
  const before = net.getFlat(), g = gradsOf(before.length, 3);
  T.applyUpdate(net, g, optim, NO_CLIP);
  const after = net.getFlat();
  assert.equal(optim.t, 1);
  for (let i = 0; i < g.length; i++) assert.ok(near(after[i] - before[i], -0.01 * g[i] / (Math.abs(g[i]) + 1e-8), 1e-9), `parámetro ${i}: Δ ${after[i] - before[i]}, g ${g[i]}`);
});

await check('Adam: tres pasos seguidos dan lo mismo que el Adam de libro escrito aparte', () => {
  const net = compile(sniper());
  const optim = T.adamInit(net);
  const theta0 = net.getFlat();
  const gl = [gradsOf(theta0.length, 11), gradsOf(theta0.length, 12), gradsOf(theta0.length, 13)];
  const want = textbookAdam(theta0, gl, 0.01);
  gl.forEach((g, k) => {
    T.applyUpdate(net, g, optim, NO_CLIP);
    const got = net.getFlat();
    for (let i = 0; i < got.length; i++) assert.ok(near(got[i], want[k][i], 1e-9), `paso ${k + 1}, parámetro ${i}: ${got[i]} ≠ ${want[k][i]}`);
  });
});

await check('Adam leído de un optim.json recién guardado (t = 0): el primer paso sigue siendo el de libro', () => {
  const net = compile(sniper());
  const dir = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s5-optim-'));
  T.saveOptim(T.adamInit(net), dir);
  const optim = T.loadOptim(net, dir);
  assert.equal(optim.t, 0);
  const before = net.getFlat(), g = gradsOf(before.length, 5);
  T.applyUpdate(net, g, optim, NO_CLIP);
  const after = net.getFlat();
  for (let i = 0; i < g.length; i++) assert.ok(near(after[i] - before[i], -0.01 * g[i] / (Math.abs(g[i]) + 1e-8), 1e-9), `parámetro ${i}`);
});

await check('Adam guardado tras dos pasos y leído: sigue en t = 2 y el tercer paso es el de libro', () => {
  const net = compile(sniper());
  const theta0 = net.getFlat();
  const gl = [gradsOf(theta0.length, 21), gradsOf(theta0.length, 22), gradsOf(theta0.length, 23)];
  const want = textbookAdam(theta0, gl, 0.01);
  const optim = T.adamInit(net);
  T.applyUpdate(net, gl[0], optim, NO_CLIP); T.applyUpdate(net, gl[1], optim, NO_CLIP);
  const dir = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s5-optim-'));
  T.saveOptim(optim, dir);
  const again = T.loadOptim(net, dir);
  assert.equal(again.t, 2);
  T.applyUpdate(net, gl[2], again, NO_CLIP);
  const got = net.getFlat();
  for (let i = 0; i < got.length; i++) assert.ok(near(got[i], want[2][i], 1e-9), `parámetro ${i}`);
});

// tres decisiones de un soldado con recompensas 1, 2, −1 y γ = 0,5: G = 1,75, 1,5, −1. Media EMA 0,05 desde 0:
// A₀ = 1,75 − 0 = 1,75 · media 0,0875 · A₁ = 1,5 − 0,0875 = 1,4125 · media 0,158125 · A₂ = −1 − 0,158125 = −1,158125
const EP = () => [{ steps: [{ reward: 1 }, { reward: 2 }, { reward: -1 }] }];
const WANT_A = [1.75, 1.4125, -1.158125];

await check('base "media" recién creada: la primera ventaja es G − 0 y la media sigue la EMA 0,05 desde 0', () => {
  const optim = T.adamInit(compile(sniper()));
  const eps = T.computeAdvantages(EP(), null, { gamma: 0.5, baseline: 'mean' }, optim.mean);
  eps[0].steps.forEach((s, i) => assert.ok(near(s.advantage, WANT_A[i], 1e-12), `A${i} = ${s.advantage}, esperaba ${WANT_A[i]}`));
  assert.ok(near(optim.mean.mean, 0.158125 + 0.05 * (-1 - 0.158125), 1e-12), `media final ${optim.mean.mean}`);
});

await check('base "media" leída de un optim.json antiguo sin `mean` (misma disposición): empieza en 0', () => {
  const net = compile(sniper());
  const dir = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s5-optim-'));
  const o = T.adamInit(net);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'optim.json'), JSON.stringify({ m: Array.from(o.m), v: Array.from(o.v), t: 0, layout: o.layout }));
  const optim = T.loadOptim(net, dir);
  assert.ok(optim.mean && optim.mean.mean === 0, JSON.stringify(optim.mean));
  const eps = T.computeAdvantages(EP(), null, { gamma: 0.5, baseline: 'mean' }, optim.mean);
  eps[0].steps.forEach((s, i) => assert.ok(near(s.advantage, WANT_A[i], 1e-12), `A${i} = ${s.advantage}`));
});

// una partida sintética para prepareExperience: las recompensas ya asignadas (efectivas 1, 2, −1) de un soldado
const gameOf = (rewards) => ({
  trajectory: { soldiers: {} },
  rewards: { entries: rewards.map((r, i) => ({ soldierId: 's0', turn: i, phase: 'shoot', obs: null, decision: { eventId: 10 + i, value: null, chosen: 0, chosenMove: null, adjust: null, moveAdjust: null }, effective: r })) },
});

await check('base "media" en el aprendizaje de verdad (red sin Corazonada: la base cae a "media"): empieza en 0 y no se reinicia de un lote al siguiente', () => {
  const g = sniper();
  assert.ok(!g.blocks.some((b) => b.type === 'hand.value'), 'premisa: el Francotirador no tiene Corazonada');
  const optim = T.adamInit(compile(g));
  const x1 = T.prepareExperience({ genome: g, games: [gameOf([1, 2, -1])], optim, cfg: { gamma: 0.5, baseline: 'value' } });
  assert.equal(x1.baseline, 'mean');
  x1.episodes[0].steps.forEach((s, i) => assert.ok(near(s.advantage, WANT_A[i], 1e-12), `lote 1, A${i} = ${s.advantage}`));
  const m = optim.mean.mean;
  const x2 = T.prepareExperience({ genome: g, games: [gameOf([3])], optim, cfg: { gamma: 0.5, baseline: 'value' } });
  assert.ok(near(x2.episodes[0].steps[0].advantage, 3 - m, 1e-12), `lote 2: A = ${x2.episodes[0].steps[0].advantage}, esperaba ${3 - m} (la media sigue donde quedó)`);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (huecos s5: estado inicial de Adam y de la base "media")');
process.exit(fails ? 1 : 0);
