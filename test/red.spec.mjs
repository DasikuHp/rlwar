// F2 — La red: genoma, catálogo, validación, cálculo hacia delante y hacia atrás (BPTT).
// Contrato: spec/02-red.md. Escrito ANTES del código y congelado. Sin servidor.
import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const { makeRng } = await import('../shared/rng.js');
const { LIMITS } = await import('../shared/constants.js');
const genomeMod = await import('../shared/genome.js');
const { BLOCKS, validate, normalize, repair, outDims, countParams } = genomeMod;
const { compile, initWeights } = await import('../shared/nn.js');
const { TEMPLATES } = await import('../shared/templates.js');

// ---------- constructores ----------
const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const G = (blocks, wires, extra = {}) => ({ format: 1, id: 'test-net', name: 'Test', blocks, wires, imagination: { n: 5 }, ...extra });
const build = (blocks, wires, seed = 1, extra = {}) => {
  const r = repair(G(blocks, wires, extra), makeRng(seed));
  const v = validate(r.genome);
  if (!v.ok) throw new Error('genoma de test inválido: ' + JSON.stringify(v.errors));
  return r.genome;
};
const N = (genome) => normalize(genome).imagination.n;
const isEye = (b) => b.type.startsWith('eye.');
// observación aleatoria acorde a los ojos del genoma
function obsFor(genome, rng) {
  const dims = outDims(genome);
  const obs = { ctx: {}, cand: {}, move: {}, team: {} };
  const vec = (d) => Float64Array.from({ length: d }, () => rng() * 2 - 1);
  for (const b of genome.blocks) {
    if (isEye(b)) {
      const { stream, dim } = dims[b.id];
      if (stream === 'ctx') obs.ctx[b.id] = vec(dim);
      else if (stream === 'cand') obs.cand[b.id] = Array.from({ length: N(genome) }, () => vec(dim));
      else obs.move[b.id] = Array.from({ length: 9 }, () => vec(dim));
    }
    if (b.type === 'teamMemory') obs.team[b.id] = vec(b.params.units);
  }
  return obs;
}
// coeficientes aleatorios para una pérdida lineal L = Σ c·salida
function coefsFor(out, rng) {
  const o = out.outputs;
  const vec = (d) => Float64Array.from({ length: d }, () => rng() * 2 - 1);
  return {
    choose: o.choose ? vec(o.choose.scores.length) : null,
    adjust: o.adjust ? o.adjust.mu.map((m) => vec(m.length)) : null,
    move: o.move ? { scores: vec(9), mu: o.move.mu ? o.move.mu.map((m) => vec(m.length)) : null } : null,
    value: o.value !== null && o.value !== undefined ? rng() * 2 - 1 : null,
  };
}
function lossOf(out, c) {
  const o = out.outputs; let L = 0;
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  if (c.choose) L += dot(c.choose, o.choose.scores);
  if (c.adjust) for (let i = 0; i < c.adjust.length; i++) L += dot(c.adjust[i], o.adjust.mu[i]);
  if (c.move) { L += dot(c.move.scores, o.move.scores); if (c.move.mu) for (let i = 0; i < 9; i++) L += dot(c.move.mu[i], o.move.mu[i]); }
  if (c.value !== null) L += c.value * o.value;
  return L;
}
// gradiente numérico (diferencias centrales) contra retropropagación, con BPTT de `steps` pasos
function gradCheck(genome, { steps = 1, seed = 3, eps = 1e-6, tol = 1e-6, sample = 80 } = {}) {
  const net = compile(genome);
  const rng = makeRng(seed);
  const obsList = Array.from({ length: steps }, () => obsFor(genome, rng));
  // pasada analítica
  const outs = []; let st = net.zeroState();
  for (let t = 0; t < steps; t++) { const out = net.forward(obsList[t], st); outs.push(out); st = out.state; }
  const coefs = outs.map((o) => coefsFor(o, rng));
  const total = new Float64Array(net.paramCount());
  let sg = null;
  for (let t = steps - 1; t >= 0; t--) {
    const r = net.backward(outs[t].tape, coefs[t], sg);
    sg = r.stateGrad;
    const flat = net.flattenGrads(r.grads);
    for (let i = 0; i < flat.length; i++) total[i] += flat[i];
  }
  const loss = () => { let s = net.zeroState(), L = 0; for (let t = 0; t < steps; t++) { const o = net.forward(obsList[t], s); L += lossOf(o, coefs[t]); s = o.state; } return L; };
  const flat0 = net.getFlat();
  assert.equal(flat0.length, total.length);
  const idx = flat0.length <= sample ? [...flat0.keys()] : Array.from({ length: sample }, () => rng.int(flat0.length));
  let worst = 0, worstI = -1;
  for (const i of idx) {
    const f = Float64Array.from(flat0);
    f[i] = flat0[i] + eps; net.setFlat(f); const lp = loss();
    f[i] = flat0[i] - eps; net.setFlat(f); const lm = loss();
    const num = (lp - lm) / (2 * eps);
    const err = Math.abs(num - total[i]) / (1 + Math.abs(num) + Math.abs(total[i]));
    if (err > worst) { worst = err; worstI = i; }
  }
  net.setFlat(flat0);
  assert.ok(worst < tol, `error ${worst.toExponential(2)} en el parámetro ${worstI} (${describeParam(net, worstI)})`);
  return worst;
}
function describeParam(net, i) {
  let k = i;
  for (const p of net.paramList()) { if (k < p.array.length) return `${p.blockId}.${p.key}[${k}]`; k -= p.array.length; }
  return '?';
}
const ACTS = ['relu', 'tanh', 'sigmoid', 'leaky', 'gelu', 'sine', 'linear'];
const ACT_FN = {
  relu: (x) => Math.max(0, x), tanh: Math.tanh, sigmoid: (x) => 1 / (1 + Math.exp(-x)), leaky: (x) => (x > 0 ? x : 0.01 * x),
  gelu: (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3))), sine: Math.sin, linear: (x) => x,
};
// referencia independiente: y_j = b_j + Σ_i x_i W[i*out+j]
const denseRef = (x, Wm, b, out, act) => Float64Array.from({ length: out }, (_, j) => { let s = b[j]; for (let i = 0; i < x.length; i++) s += x[i] * Wm[i * out + j]; return ACT_FN[act](s); });
const sigm = (x) => 1 / (1 + Math.exp(-x));

// ---------- catálogo ----------
await check('BLOCKS: los 24 tipos del catálogo con nombre, explicación, ejemplo, nivel y parámetros con rango', () => {
  const types = ['eye.map', 'eye.features', 'eye.obstacles', 'eye.history', 'eye.radar', 'eye.clock', 'eye.mates', 'eye.candidates', 'eye.simulator', 'eye.moves',
    'dense', 'concat', 'add', 'mul', 'skip', 'norm', 'attention', 'pool', 'echo', 'gru', 'lstm', 'teamMemory', 'hand.choose', 'hand.adjust', 'foot.move', 'hand.value'];
  for (const t of types) {
    const b = BLOCKS[t];
    assert.ok(b, t);
    assert.ok(b.name && b.explain && b.example && b.icon, `${t} tiene name/explain/example/icon`);
    assert.ok(['aprendiz', 'artesano', 'cientifico'].includes(b.level), `${t} nivel`);
    assert.ok(Array.isArray(b.params), `${t} params`);
    for (const p of b.params) {
      assert.ok(p.key && p.name && p.explain && ['aprendiz', 'artesano', 'cientifico'].includes(p.level), `${t}.${p.key}`);
      if (p.type === 'int' || p.type === 'number') assert.ok(p.min !== undefined && p.max !== undefined && p.default !== undefined, `${t}.${p.key} rango`);
      if (p.type === 'enum') assert.ok(Array.isArray(p.options) && p.options.length, `${t}.${p.key} opciones`);
    }
  }
  assert.deepEqual(BLOCKS.dense.params.find((p) => p.key === 'activation').options.map((o) => o.value), ACTS);
  assert.equal(BLOCKS.dense.params.find((p) => p.key === 'units').max, 512);
  assert.equal(Object.keys(BLOCKS).length, types.length, 'ni más ni menos');
});

await check('LIMITS: bloques 64, cables 256, unidades 512, parámetros 2M, candidatos 4..64, genoma 48 MB', () => {
  assert.equal(LIMITS.blocks, 64); assert.equal(LIMITS.wires, 256); assert.equal(LIMITS.units, 512);
  assert.equal(LIMITS.params, 2_000_000); assert.equal(LIMITS.candidatesMin, 4); assert.equal(LIMITS.candidatesMax, 64);
  assert.equal(LIMITS.genomeBytes, 48 * 1024 * 1024);
  assert.equal(genomeMod.LIMITS, LIMITS);
});

// ---------- dimensiones ----------
await check('outDims: ojos según spec/03 §2 y propagación por el grafo (difusión ctx→cand)', () => {
  const g = build([
    B('f', 'eye.features'), B('o', 'eye.obstacles', { slots: 3 }), B('h', 'eye.history', { depth: 2 }), B('r', 'eye.radar', { rays: 8 }),
    B('k', 'eye.clock'), B('t', 'eye.mates'), B('m', 'eye.map', { cell: 5, channels: ['obstacles', 'enemies'] }),
    B('c', 'eye.candidates'), B('s', 'eye.simulator'), B('mv', 'eye.moves'),
    B('cat', 'concat'), B('d', 'dense', { units: 7, activation: 'tanh' }), B('cd', 'dense', { units: 3, activation: 'relu' }),
    B('ch', 'hand.choose'), B('p', 'pool', { op: 'mean' }), B('v', 'hand.value'), B('md', 'dense', { units: 4 }), B('fm', 'foot.move'),
  ], [W('f', 'cat'), W('o', 'cat'), W('h', 'cat'), W('r', 'cat'), W('k', 'cat'), W('t', 'cat'), W('m', 'cat'), W('cat', 'd'),
    W('d', 'cd'), W('c', 'cd'), W('s', 'cd'), W('cd', 'ch'), W('cd', 'p'), W('p', 'v'), W('mv', 'md'), W('d', 'md'), W('md', 'fm')]);
  const dims = outDims(g);
  assert.deepEqual(dims.f, { stream: 'ctx', dim: 26 });
  assert.deepEqual(dims.o, { stream: 'ctx', dim: 16 });
  assert.deepEqual(dims.h, { stream: 'ctx', dim: 56 });
  assert.deepEqual(dims.r, { stream: 'ctx', dim: 16 });
  assert.deepEqual(dims.k, { stream: 'ctx', dim: 8 });
  assert.deepEqual(dims.t, { stream: 'ctx', dim: 12 });
  assert.deepEqual(dims.m, { stream: 'ctx', dim: 2 * 6 * 10 });
  assert.deepEqual(dims.c, { stream: 'cand', dim: 12 });
  assert.deepEqual(dims.s, { stream: 'cand', dim: 10 });
  assert.deepEqual(dims.mv, { stream: 'move', dim: 9 });
  assert.deepEqual(dims.cat, { stream: 'ctx', dim: 26 + 16 + 56 + 16 + 8 + 12 + 120 });
  assert.deepEqual(dims.d, { stream: 'ctx', dim: 7 });
  assert.deepEqual(dims.cd, { stream: 'cand', dim: 3 });
  assert.deepEqual(dims.ch, { stream: 'cand', dim: 1 });
  assert.deepEqual(dims.p, { stream: 'ctx', dim: 3 });
  assert.deepEqual(dims.v, { stream: 'ctx', dim: 1 });
  assert.deepEqual(dims.md, { stream: 'move', dim: 4 });
  assert.deepEqual(dims.fm, { stream: 'move', dim: 3 });
  assert.equal(countParams(g), (7 + 12 + 10) * 3 + 3 + 254 * 7 + 7 + 3 + 1 + 3 + 1 + (9 + 7) * 4 + 4 + 4 + 1 + 4 * 2 + 2);
});

await check('eye.map: cell 1/2/2.5/5 y canales; imagination.n fija N', () => {
  for (const [cell, W_, H_] of [[1, 50, 30], [2, 25, 15], [2.5, 20, 12], [5, 10, 6]]) {
    const g = build([B('m', 'eye.map', { cell, channels: ['obstacles', 'enemies', 'allies', 'self', 'trails'] }), B('v', 'hand.value')], [W('m', 'v')]);
    assert.equal(outDims(g).m.dim, 5 * W_ * H_, `cell ${cell}`);
  }
  const g = build([B('c', 'eye.candidates'), B('ch', 'hand.choose')], [W('c', 'ch')], 1, { imagination: { n: 12 } });
  assert.equal(N(g), 12);
  const out = compile(g).forward(obsFor(g, makeRng(1)), compile(g).zeroState());
  assert.equal(out.outputs.choose.scores.length, 12);
});

// ---------- fórmulas exactas ----------
await check('dense: y = act(Wx + b) con la disposición W[i*out+j], para las 7 activaciones', () => {
  for (const act of ACTS) {
    const g = build([B('f', 'eye.features'), B('d', 'dense', { units: 4, activation: act }), B('v', 'hand.value')], [W('f', 'd'), W('d', 'v')], 2);
    const net = compile(g);
    const obs = obsFor(g, makeRng(5));
    const out = net.forward(obs, net.zeroState());
    const ref = denseRef(obs.ctx.f, g.weights.d.W, g.weights.d.b, 4, act);
    for (let j = 0; j < 4; j++) assert.ok(near(out.activations.d[j], ref[j], 1e-12), `${act} unidad ${j}`);
    const vref = denseRef(ref, g.weights.v.W, g.weights.v.b, 1, 'linear')[0];
    assert.ok(near(out.outputs.value, vref, 1e-12), `${act} valor`);
    assert.ok(out.outputs.choose === null && out.outputs.adjust === null && out.outputs.move === null);
  }
});

await check('hand.choose / hand.adjust / foot.move: cabezas lineales por candidato y por destino', () => {
  const g = build([B('c', 'eye.candidates'), B('d', 'dense', { units: 3, activation: 'tanh' }), B('ch', 'hand.choose'), B('aj', 'hand.adjust', { params: 2 }),
    B('m', 'eye.moves'), B('md', 'dense', { units: 3, activation: 'linear' }), B('fm', 'foot.move', { adjust: true })],
  [W('c', 'd'), W('d', 'ch'), W('d', 'aj'), W('m', 'md'), W('md', 'fm')], 4);
  const net = compile(g);
  const obs = obsFor(g, makeRng(6));
  const out = net.forward(obs, net.zeroState());
  assert.equal(out.outputs.choose.scores.length, 5);
  assert.equal(out.outputs.adjust.mu.length, 5); assert.equal(out.outputs.adjust.mu[0].length, 2);
  assert.equal(out.outputs.move.scores.length, 9); assert.equal(out.outputs.move.mu.length, 9); assert.equal(out.outputs.move.mu[0].length, 2);
  for (let i = 0; i < 5; i++) {
    const h = denseRef(obs.cand.c[i], g.weights.d.W, g.weights.d.b, 3, 'tanh');
    assert.ok(near(out.outputs.choose.scores[i], denseRef(h, g.weights.ch.W, g.weights.ch.b, 1, 'linear')[0], 1e-12), `score ${i}`);
    const mu = denseRef(h, g.weights.aj.W, g.weights.aj.b, 2, 'linear');
    assert.ok(near(out.outputs.adjust.mu[i][0], mu[0], 1e-12) && near(out.outputs.adjust.mu[i][1], mu[1], 1e-12), `mu ${i}`);
    assert.ok(near(out.activations.d[i][0], h[0], 1e-12), 'activaciones por candidato');
  }
  for (let k = 0; k < 9; k++) {
    const h = denseRef(obs.move.m[k], g.weights.md.W, g.weights.md.b, 3, 'linear');
    assert.ok(near(out.outputs.move.scores[k], denseRef(h, g.weights.fm.W, g.weights.fm.b, 1, 'linear')[0], 1e-12), `move ${k}`);
    const mu = denseRef(h, g.weights.fm.Wa, g.weights.fm.ba, 2, 'linear');
    assert.ok(near(out.outputs.move.mu[k][0], mu[0], 1e-12) && near(out.outputs.move.mu[k][1], mu[1], 1e-12), `move mu ${k}`);
  }
  const g2 = build([B('m', 'eye.moves'), B('fm', 'foot.move', { adjust: false })], [W('m', 'fm')]);
  const o2 = compile(g2).forward(obsFor(g2, makeRng(1)), compile(g2).zeroState());
  assert.equal(o2.outputs.move.mu, null); assert.equal(g2.weights.fm.Wa, undefined);
});

await check('concat con difusión ctx→cand, add, mul, skip: exactos', () => {
  const g = build([B('f', 'eye.features'), B('c', 'eye.candidates'), B('cat', 'concat'), B('d', 'dense', { units: 2, activation: 'linear' }), B('ch', 'hand.choose')],
    [W('f', 'cat'), W('c', 'cat'), W('cat', 'd'), W('d', 'ch')], 3);
  assert.equal(outDims(g).cat.dim, 26 + 12);
  const net = compile(g); const obs = obsFor(g, makeRng(2)); const out = net.forward(obs, net.zeroState());
  for (let i = 0; i < 5; i++) {
    const x = Float64Array.from([...obs.ctx.f, ...obs.cand.c[i]]);
    const h = denseRef(x, g.weights.d.W, g.weights.d.b, 2, 'linear');
    assert.ok(near(out.outputs.choose.scores[i], denseRef(h, g.weights.ch.W, g.weights.ch.b, 1, 'linear')[0], 1e-12), `cand ${i}`);
  }
  const g2 = build([B('f', 'eye.features'), B('a', 'dense', { units: 3, activation: 'tanh' }), B('b', 'dense', { units: 3, activation: 'linear' }),
    B('add', 'add'), B('mul', 'mul'), B('sk', 'skip'), B('cat', 'concat'), B('v', 'hand.value')],
  [W('f', 'a'), W('f', 'b'), W('a', 'add'), W('b', 'add'), W('a', 'mul'), W('b', 'mul'), W('add', 'sk'), W('sk', 'cat'), W('mul', 'cat'), W('cat', 'v')], 3);
  const net2 = compile(g2); const obs2 = obsFor(g2, makeRng(9)); const o2 = net2.forward(obs2, net2.zeroState());
  const a = denseRef(obs2.ctx.f, g2.weights.a.W, g2.weights.a.b, 3, 'tanh'), b = denseRef(obs2.ctx.f, g2.weights.b.W, g2.weights.b.b, 3, 'linear');
  for (let j = 0; j < 3; j++) {
    assert.ok(near(o2.activations.add[j], a[j] + b[j], 1e-12)); assert.ok(near(o2.activations.mul[j], a[j] * b[j], 1e-12)); assert.ok(near(o2.activations.sk[j], a[j] + b[j], 1e-12));
  }
  assert.equal(o2.activations.cat.length, 6);
});

await check('norm (LayerNorm), pool mean/max, attention (pesos softmax que suman 1): exactos', () => {
  const g = build([B('f', 'eye.features'), B('n', 'norm'), B('v', 'hand.value')], [W('f', 'n'), W('n', 'v')]);
  const net = compile(g); const obs = obsFor(g, makeRng(4)); const out = net.forward(obs, net.zeroState());
  const x = obs.ctx.f, mean = x.reduce((s, v) => s + v, 0) / x.length, vr = x.reduce((s, v) => s + (v - mean) ** 2, 0) / x.length;
  for (let j = 0; j < x.length; j++) assert.ok(near(out.activations.n[j], g.weights.n.g[j] * (x[j] - mean) / Math.sqrt(vr + 1e-5) + g.weights.n.b[j], 1e-12));
  assert.ok(g.weights.n.g.every((v) => v === 1) && g.weights.n.b.every((v) => v === 0), 'init g=1 b=0');
  for (const op of ['mean', 'max']) {
    const gp = build([B('c', 'eye.candidates'), B('p', 'pool', { op }), B('v', 'hand.value')], [W('c', 'p'), W('p', 'v')]);
    const np = compile(gp); const ob = obsFor(gp, makeRng(4)); const o = np.forward(ob, np.zeroState());
    for (let j = 0; j < 12; j++) {
      const col = ob.cand.c.map((r) => r[j]);
      assert.ok(near(o.activations.p[j], op === 'mean' ? col.reduce((s, v) => s + v, 0) / 5 : Math.max(...col), 1e-12), `${op} ${j}`);
    }
  }
  const ga = build([B('f', 'eye.features'), B('q', 'dense', { units: 6, activation: 'tanh' }), B('c', 'eye.candidates'), B('at', 'attention', { heads: 2, keyDim: 4 }), B('v', 'hand.value')],
    [W('f', 'q'), W('q', 'at'), W('c', 'at'), W('at', 'v')], 5);
  assert.deepEqual(outDims(ga).at, { stream: 'ctx', dim: 8 });
  const na = compile(ga); const oa = obsFor(ga, makeRng(7)); const o = na.forward(oa, na.zeroState());
  const q = denseRef(oa.ctx.f, ga.weights.q.W, ga.weights.q.b, 6, 'tanh');
  const Wq = ga.weights.at.Wq, Wk = ga.weights.at.Wk, Wv = ga.weights.at.Wv;
  assert.equal(Wq.length, 6 * 8); assert.equal(Wk.length, 12 * 8); assert.equal(Wv.length, 12 * 8);
  const qv = denseRef(q, Wq, new Float64Array(8), 8, 'linear');
  const kv = oa.cand.c.map((r) => denseRef(r, Wk, new Float64Array(8), 8, 'linear')), vv = oa.cand.c.map((r) => denseRef(r, Wv, new Float64Array(8), 8, 'linear'));
  assert.equal(o.attention.at.length, 2);
  for (let h = 0; h < 2; h++) {
    const sc = kv.map((k) => { let s = 0; for (let d = 0; d < 4; d++) s += qv[h * 4 + d] * k[h * 4 + d]; return s / 2; });
    const mx = Math.max(...sc), ex = sc.map((s) => Math.exp(s - mx)), z = ex.reduce((s, v) => s + v, 0);
    let sum = 0;
    for (let i = 0; i < 5; i++) { assert.ok(near(o.attention.at[h][i], ex[i] / z, 1e-12), `peso ${h},${i}`); sum += o.attention.at[h][i]; }
    assert.ok(near(sum, 1, 1e-12));
    for (let d = 0; d < 4; d++) { let s = 0; for (let i = 0; i < 5; i++) s += ex[i] / z * vv[i][h * 4 + d]; assert.ok(near(o.activations.at[h * 4 + d], s, 1e-12)); }
  }
  // sin consulta de contexto: q0 aprendido
  const gb = build([B('c', 'eye.candidates'), B('at', 'attention', { heads: 1, keyDim: 3 }), B('v', 'hand.value')], [W('c', 'at'), W('at', 'v')]);
  assert.equal(gb.weights.at.q0.length, 3); assert.equal(gb.weights.at.Wq, undefined);
  assert.deepEqual(outDims(gb).at, { stream: 'ctx', dim: 3 });
});

await check('echo, gru, lstm, teamMemory: un paso exacto contra la referencia; estado inmutable', () => {
  const inv = 26;
  // echo
  const ge = build([B('f', 'eye.features'), B('e', 'echo', { units: 3 }), B('v', 'hand.value')], [W('f', 'e'), W('e', 'v')], 8);
  const ne = compile(ge); const obs = obsFor(ge, makeRng(3));
  const s0 = ne.zeroState(); assert.equal(s0.e.length, 3); assert.ok(Array.from(s0.e).every((v) => v === 0));
  const h0 = Float64Array.from([0.3, -0.2, 0.5]);
  const oe = ne.forward(obs, { e: h0 });
  const we = ge.weights.e;
  for (let j = 0; j < 3; j++) {
    let s = we.b[j]; for (let i = 0; i < inv; i++) s += obs.ctx.f[i] * we.Wx[i * 3 + j]; for (let i = 0; i < 3; i++) s += h0[i] * we.Wh[i * 3 + j];
    assert.ok(near(oe.state.e[j], Math.tanh(s), 1e-12), `echo ${j}`); assert.ok(near(oe.activations.e[j], Math.tanh(s), 1e-12));
  }
  assert.equal(h0[0], 0.3, 'el estado de entrada no se modifica');
  // gru (Cho 2014): z, r, h~
  const gg = build([B('f', 'eye.features'), B('g', 'gru', { units: 2 }), B('v', 'hand.value')], [W('f', 'g'), W('g', 'v')], 8);
  const ng = compile(gg); const hg = Float64Array.from([0.1, -0.4]); const og = ng.forward(obs, { g: hg }); const wg = gg.weights.g;
  const cat = Float64Array.from([...obs.ctx.f, ...hg]);
  const lin = (Wm, b, x) => denseRef(x, Wm, b, 2, 'linear');
  const z = lin(wg.Wz, wg.bz, cat).map(sigm), r = lin(wg.Wr, wg.br, cat).map(sigm);
  const cat2 = Float64Array.from([...obs.ctx.f, ...hg.map((v, i) => r[i] * v)]);
  const ht = lin(wg.Wh, wg.bh, cat2).map(Math.tanh);
  for (let j = 0; j < 2; j++) assert.ok(near(og.state.g[j], (1 - z[j]) * hg[j] + z[j] * ht[j], 1e-12), `gru ${j}`);
  assert.equal(wg.Wz.length, (inv + 2) * 2);
  // lstm
  const gl = build([B('f', 'eye.features'), B('l', 'lstm', { units: 2 }), B('v', 'hand.value')], [W('f', 'l'), W('l', 'v')], 8);
  const nl = compile(gl); const wl = gl.weights.l;
  assert.ok(wl.bf.every((v) => v === 1), 'bf a 1'); assert.ok(wl.bi.every((v) => v === 0));
  const st = { l: { h: Float64Array.from([0.2, 0.1]), c: Float64Array.from([-0.3, 0.6]) } };
  const ol = nl.forward(obs, st); const catl = Float64Array.from([...obs.ctx.f, ...st.l.h]);
  const i_ = lin(wl.Wi, wl.bi, catl).map(sigm), f_ = lin(wl.Wf, wl.bf, catl).map(sigm), o_ = lin(wl.Wo, wl.bo, catl).map(sigm), g_ = lin(wl.Wg, wl.bg, catl).map(Math.tanh);
  for (let j = 0; j < 2; j++) {
    const c = f_[j] * st.l.c[j] + i_[j] * g_[j];
    assert.ok(near(ol.state.l.c[j], c, 1e-12), `lstm c ${j}`); assert.ok(near(ol.state.l.h[j], o_[j] * Math.tanh(c), 1e-12), `lstm h ${j}`);
  }
  assert.equal(st.l.c[0], -0.3);
  // teamMemory: lee la media del equipo (obs.team) si existe; si no, su propio h
  const gt = build([B('f', 'eye.features'), B('t', 'teamMemory', { units: 3 }), B('v', 'hand.value')], [W('f', 't'), W('t', 'v')], 8);
  const nt = compile(gt); const wt = gt.weights.t; const own = Float64Array.from([0.3, -0.2, 0.5]); const team = Float64Array.from([-0.1, 0.4, 0.2]);
  const withTeam = nt.forward({ ...obs, team: { t: team } }, { t: own });
  const noTeam = nt.forward({ ...obs, team: {} }, { t: own });
  const ownAsTeam = nt.forward({ ...obs, team: { t: own } }, { t: own });
  for (let j = 0; j < 3; j++) {
    let s = wt.b[j]; for (let i = 0; i < inv; i++) s += obs.ctx.f[i] * wt.Wx[i * 3 + j]; for (let i = 0; i < 3; i++) s += team[i] * wt.Wh[i * 3 + j];
    assert.ok(near(withTeam.state.t[j], Math.tanh(s), 1e-12), `team ${j}`);
    assert.ok(near(noTeam.state.t[j], ownAsTeam.state.t[j], 1e-12), 'sin equipo lee la suya');
  }
  assert.ok(Array.from(withTeam.state.t).some((v, j) => !near(v, noTeam.state.t[j], 1e-9)), 'la lectura de equipo cambia el resultado');
});

// ---------- gradiente numérico vs retropropagación ----------
await check('gradiente: dense con cada activación (ctx→value y cand→choose)', () => {
  for (const act of ACTS) {
    gradCheck(build([B('f', 'eye.features'), B('d', 'dense', { units: 5, activation: act }), B('d2', 'dense', { units: 3, activation: act }), B('v', 'hand.value')],
      [W('f', 'd'), W('d', 'd2'), W('d2', 'v')], 11));
    gradCheck(build([B('c', 'eye.candidates'), B('d', 'dense', { units: 4, activation: act }), B('ch', 'hand.choose'), B('aj', 'hand.adjust', { params: 3 })],
      [W('c', 'd'), W('d', 'ch'), W('d', 'aj')], 12));
  }
});
await check('gradiente: concat con difusión, add, mul, skip, norm, pool, atención (con y sin consulta)', () => {
  gradCheck(build([B('f', 'eye.features'), B('c', 'eye.candidates'), B('cat', 'concat'), B('d', 'dense', { units: 4, activation: 'tanh' }), B('ch', 'hand.choose')],
    [W('f', 'cat'), W('c', 'cat'), W('cat', 'd'), W('d', 'ch')], 13));
  gradCheck(build([B('f', 'eye.features'), B('a', 'dense', { units: 3, activation: 'tanh' }), B('b', 'dense', { units: 3, activation: 'sigmoid' }),
    B('add', 'add'), B('mul', 'mul'), B('sk', 'skip'), B('cat', 'concat'), B('n', 'norm'), B('v', 'hand.value')],
  [W('f', 'a'), W('f', 'b'), W('a', 'add'), W('b', 'add'), W('a', 'mul'), W('b', 'mul'), W('add', 'sk'), W('sk', 'cat'), W('mul', 'cat'), W('cat', 'n'), W('n', 'v')], 14));
  for (const op of ['mean', 'max']) gradCheck(build([B('c', 'eye.candidates'), B('d', 'dense', { units: 4, activation: 'tanh' }), B('p', 'pool', { op }), B('d2', 'dense', { units: 3, activation: 'gelu' }), B('v', 'hand.value')],
    [W('c', 'd'), W('d', 'p'), W('p', 'd2'), W('d2', 'v')], 15));
  gradCheck(build([B('f', 'eye.features'), B('q', 'dense', { units: 5, activation: 'tanh' }), B('c', 'eye.candidates'), B('cd', 'dense', { units: 6, activation: 'tanh' }),
    B('at', 'attention', { heads: 2, keyDim: 3 }), B('cat', 'concat'), B('v', 'hand.value'), B('ch', 'hand.choose')],
  [W('f', 'q'), W('c', 'cd'), W('q', 'at'), W('cd', 'at'), W('q', 'cat'), W('at', 'cat'), W('cat', 'v'), W('cd', 'ch')], 16));
  gradCheck(build([B('m', 'eye.moves'), B('at', 'attention', { heads: 1, keyDim: 4 }), B('v', 'hand.value'), B('md', 'dense', { units: 3, activation: 'leaky' }), B('fm', 'foot.move', { adjust: true })],
    [W('m', 'at'), W('at', 'v'), W('m', 'md'), W('at', 'md'), W('md', 'fm')], 17));
});
await check('gradiente con BPTT (3 pasos): echo, gru, lstm, teamMemory, y truncado a 1 paso difiere', () => {
  for (const [type, units] of [['echo', 4], ['gru', 3], ['lstm', 3], ['teamMemory', 4]]) {
    gradCheck(build([B('f', 'eye.features'), B('m', type, { units }), B('d', 'dense', { units: 3, activation: 'tanh' }), B('v', 'hand.value')],
      [W('f', 'm'), W('m', 'd'), W('d', 'v')], 18), { steps: 3 });
  }
  // dos memorias encadenadas con un atajo
  gradCheck(build([B('f', 'eye.features'), B('e', 'echo', { units: 3 }), B('g', 'gru', { units: 3 }), B('add', 'add'), B('v', 'hand.value')],
    [W('f', 'e'), W('e', 'g'), W('e', 'add'), W('g', 'add'), W('add', 'v')], 19), { steps: 3 });
  // el gradiente que llega del futuro (stateGradNext) importa: ignorarlo cambia el resultado
  const g = build([B('f', 'eye.features'), B('e', 'echo', { units: 3 }), B('v', 'hand.value')], [W('f', 'e'), W('e', 'v')], 20);
  const net = compile(g); const rng = makeRng(21); const o1 = net.forward(obsFor(g, rng), net.zeroState()); const o2 = net.forward(obsFor(g, rng), o1.state);
  const c2 = coefsFor(o2, rng); const r2 = net.backward(o2.tape, c2, null);
  const c1 = { ...coefsFor(o1, rng), value: 0 };
  const withFuture = net.flattenGrads(net.backward(o1.tape, c1, r2.stateGrad).grads), without = net.flattenGrads(net.backward(o1.tape, c1, null).grads);
  assert.ok(Array.from(withFuture).some((v, i) => Math.abs(v - without[i]) > 1e-9));
  assert.ok(Array.from(without).every((v) => Math.abs(v) < 1e-15), 'sin pérdida y sin futuro, gradiente cero');
});
function randomGraph(rng) {
  const blocks = [B('f', 'eye.features'), B('c', 'eye.candidates'), B('m', 'eye.moves')];
  const wires = [];
  let last = 'f';
  const n = 1 + rng.int(3);
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(['dense', 'dense', 'norm', 'echo', 'gru', 'lstm', 'skip', 'teamMemory']);
    const id = 'x' + i;
    blocks.push(B(id, kind, kind === 'dense' ? { units: 2 + rng.int(8), activation: rng.pick(ACTS) } : (kind === 'norm' || kind === 'skip') ? {} : { units: 2 + rng.int(6) }));
    wires.push(W(last, id)); last = id;
  }
  const roll = rng();
  if (roll < 0.4) { blocks.push(B('at', 'attention', { heads: 1 + rng.int(2), keyDim: 2 + rng.int(4) }), B('cat', 'concat')); wires.push(W(last, 'at'), W('c', 'at'), W(last, 'cat'), W('at', 'cat')); last = 'cat'; }
  else if (roll < 0.7) { blocks.push(B('pl', 'pool', { op: rng.pick(['mean', 'max']) }), B('cat', 'concat')); wires.push(W('c', 'pl'), W(last, 'cat'), W('pl', 'cat')); last = 'cat'; }
  blocks.push(B('v', 'hand.value')); wires.push(W(last, 'v'));
  blocks.push(B('cd', 'dense', { units: 2 + rng.int(6), activation: rng.pick(ACTS) })); wires.push(W(last, 'cd'), W('c', 'cd'));
  blocks.push(B('ch', 'hand.choose')); wires.push(W('cd', 'ch'));
  if (rng() < 0.5) { blocks.push(B('aj', 'hand.adjust', { params: 1 + rng.int(3) })); wires.push(W('cd', 'aj')); }
  blocks.push(B('md', 'dense', { units: 2 + rng.int(5), activation: rng.pick(ACTS) })); wires.push(W('m', 'md')); if (rng() < 0.5) wires.push(W(last, 'md'));
  blocks.push(B('fm', 'foot.move', { adjust: rng() < 0.5 })); wires.push(W('md', 'fm'));
  return { blocks, wires };
}
await check('20 grafos aleatorios válidos: compilan, validan y pasan el gradiente numérico con 2 pasos', () => {
  for (let k = 1; k <= 20; k++) {
    const rng = makeRng(1000 + k);
    const { blocks, wires } = randomGraph(rng);
    const g = build(blocks, wires, 2000 + k);
    assert.ok(validate(g, { forPlay: true }).ok, `grafo ${k}`);
    gradCheck(g, { steps: 2, seed: 3000 + k, sample: 60 });
  }
});

// ---------- validación ----------
const minimal = () => build([B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 3, activation: 'tanh' }), B('ch', 'hand.choose')], [W('f', 'd'), W('c', 'd'), W('d', 'ch')]);
const codesOf = (g, opts) => validate(g, opts).errors.map((e) => e.code);
await check('validate: cada código de error con un caso mínimo, mensaje en español y ejemplo', () => {
  const g = minimal();
  assert.ok(validate(g).ok && validate(g, { forPlay: true }).ok);
  const cases = [
    ['format', { ...g, format: 2 }],
    ['format', 'esto no es json'],
    ['id', { ...g, id: 'Mal Id!' }],
    ['name', { ...g, name: 'x'.repeat(33) }],
    ['unknown-field', { ...g, sorpresa: 1 }],
    ['block-type', { ...g, blocks: [...g.blocks, B('z', 'eye.laser')] }],
    ['block-param', { ...g, blocks: g.blocks.map((b) => (b.id === 'd' ? B('d', 'dense', { units: 513, activation: 'tanh' }) : b)) }],
    ['block-param', { ...g, blocks: g.blocks.map((b) => (b.id === 'd' ? B('d', 'dense', { units: 3, activation: 'swish' }) : b)) }],
    ['block-param', { ...g, blocks: g.blocks.map((b) => (b.id === 'd' ? B('d', 'dense', { units: 3, activation: 'tanh', color: 'rojo' }) : b)) }],
    ['wire-ref', { ...g, wires: [...g.wires, W('d', 'nadie')] }],
    ['duplicate-hand', { ...g, blocks: [...g.blocks, B('ch2', 'hand.choose')], wires: [...g.wires, W('d', 'ch2')] }],
    ['traits', { ...g, traits: { temperature: 5 } }],
    ['imagination', { ...g, imagination: { n: 100 } }],
    ['reward', { ...g, reward: { kill: 9 } }],
    ['learning', { ...g, learning: { gradient: { lr: 1 } } }],
    ['weights-shape', { ...g, weights: { ...g.weights, d: { W: g.weights.d.W.slice(1), b: g.weights.d.b } } }],
    ['weights-shape', { ...g, weights: { ch: g.weights.ch } }],
    ['weights-nan', { ...g, weights: { ...g.weights, d: { W: g.weights.d.W.map((v, i) => (i === 0 ? NaN : v)), b: g.weights.d.b } } }],
  ];
  for (const [code, bad] of cases) {
    const v = validate(bad);
    assert.equal(v.ok, false, code);
    assert.ok(v.errors.some((e) => e.code === code), `${code}: ${JSON.stringify(v.errors.map((e) => e.code))}`);
    for (const e of v.errors) assert.ok(typeof e.message === 'string' && e.message.length > 10 && typeof e.example === 'string' && e.example.length > 3, `${code} mensaje/ejemplo`);
  }
  // errores de grafo (distinta fase)
  const streamMix = build([B('c', 'eye.candidates'), B('m', 'eye.moves'), B('ch', 'hand.choose'), B('fm', 'foot.move')], [W('c', 'ch'), W('m', 'fm')]);
  assert.ok(codesOf({ ...streamMix, blocks: [...streamMix.blocks, B('cat', 'concat')], wires: [...streamMix.wires, W('c', 'cat'), W('m', 'cat')] }).includes('stream-mix'), 'cand + move');
  assert.ok(codesOf({ ...streamMix, blocks: [...streamMix.blocks, B('e', 'echo', { units: 2 })], wires: [...streamMix.wires, W('c', 'e')] }).includes('stream-mix'), 'memoria en cand');
  assert.ok(codesOf({ ...streamMix, blocks: [...streamMix.blocks, B('v', 'hand.value')], wires: [...streamMix.wires, W('c', 'v')] }).includes('stream-mix'), 'value con cand');
  assert.ok(codesOf({ ...streamMix, blocks: [...streamMix.blocks, B('v', 'hand.choose')], wires: [...streamMix.wires, W('m', 'v')] }).some((c) => c === 'stream-mix' || c === 'duplicate-hand'), 'choose con move');
  const cyc = { ...g, blocks: [...g.blocks, B('a', 'dense', { units: 2 }), B('b', 'dense', { units: 2 })], wires: [...g.wires, W('f', 'a'), W('a', 'b'), W('b', 'a')] };
  const vc = validate(cyc);
  assert.ok(vc.errors.some((e) => e.code === 'cycle' && /a|b/.test(e.message)), 'ciclo con los bloques nombrados');
  const dimErr = { ...g, blocks: [...g.blocks, B('a', 'dense', { units: 2 }), B('b', 'dense', { units: 3 }), B('s', 'add')], wires: [...g.wires, W('f', 'a'), W('f', 'b'), W('a', 's'), W('b', 's')] };
  assert.ok(codesOf(dimErr).includes('dim'));
  assert.ok(codesOf({ ...g, blocks: g.blocks.filter((b) => b.id !== 'ch'), wires: g.wires.filter((w) => w.to !== 'ch') }, { forPlay: true }).includes('missing-choose'));
  assert.ok(validate({ ...g, blocks: g.blocks.filter((b) => b.id !== 'ch'), wires: g.wires.filter((w) => w.to !== 'ch') }).ok, 'sin forPlay, una red sin Elegir vale como pieza');
  const loose = validate({ ...g, blocks: [...g.blocks, B('solo', 'dense', { units: 2 })], weights: { ...g.weights, solo: { W: new Array(0), b: [0, 0] } } });
  assert.ok(loose.warnings.some((w) => w.code === 'unconnected' && w.blockId === 'solo'), 'bloque suelto → aviso');
});

await check('validate: límites (65 bloques, 2 000 001 parámetros, 49 MB) se rechazan en < 50 ms cada uno, sin reservar memoria', () => {
  const g = minimal();
  const many = { ...g, blocks: [...g.blocks, ...Array.from({ length: 61 }, (_, i) => B('s' + i, 'skip'))], wires: [...g.wires, ...Array.from({ length: 61 }, (_, i) => W(i ? 's' + (i - 1) : 'f', 's' + i))] };
  let t0 = performance.now();
  assert.ok(codesOf(many).includes('limit')); assert.ok(performance.now() - t0 < 50);
  const big = { ...g, blocks: [...g.blocks, ...Array.from({ length: 9 }, (_, i) => B('b' + i, 'dense', { units: 512, activation: 'relu' }))], wires: [...g.wires, ...Array.from({ length: 9 }, (_, i) => W(i ? 'b' + (i - 1) : 'f', 'b' + i))] };
  t0 = performance.now();
  const vb = validate(big);
  assert.ok(vb.errors.some((e) => e.code === 'limit' && /par[aá]metros/.test(e.message)), JSON.stringify(vb.errors));
  assert.ok(performance.now() - t0 < 50);
  t0 = performance.now();
  assert.ok(codesOf('x'.repeat(49 * 1024 * 1024)).includes('limit')); assert.ok(performance.now() - t0 < 50);
  const ok = validate(JSON.stringify(g));
  assert.ok(ok.ok, 'como texto también valida');
});

await check('normalize/repair/initWeights/newGenome: defaults, pesos que faltan, cables sueltos, determinismo', () => {
  const raw = G([B('f', 'eye.features'), B('d', 'dense', { units: 3 }), B('v', 'hand.value')], [W('f', 'd'), W('d', 'v'), W('d', 'fantasma')]);
  const n = normalize(raw);
  assert.equal(n.traits.temperature, 1); assert.equal(n.traits.pulse, 0.1); assert.equal(n.traits.teamSpirit, 0.5); assert.equal(n.traits.character, 'frio');
  assert.equal(n.imagination.n, 5); assert.equal(n.imagination.families.line.weight, 6); assert.equal(n.reward.kill, 1); assert.equal(n.reward.friendlyFire, -1.5);
  assert.equal(n.learning.method, 'gradient'); assert.equal(n.learning.gradient.lr, 0.003); assert.deepEqual(n.frozen, []); assert.equal(n.lineage.generation, 0);
  assert.equal(n.blocks.find((b) => b.id === 'd').params.activation, 'tanh', 'parámetro por defecto');
  assert.equal(raw.traits, undefined, 'normalize no muta');
  const r1 = repair(raw, makeRng(5)), r2 = repair(raw, makeRng(5)), r3 = repair(raw, makeRng(6));
  assert.ok(validate(r1.genome).ok);
  assert.deepEqual(r1.genome, r2.genome); assert.notDeepEqual(r1.genome.weights.d.W, r3.genome.weights.d.W);
  assert.ok(r1.fixes.some((f) => /fantasma/.test(f)) && r1.fixes.some((f) => /d/.test(f)), JSON.stringify(r1.fixes));
  assert.equal(r1.genome.wires.length, 2);
  const again = repair(r1.genome, makeRng(9));
  assert.deepEqual(again.genome, r1.genome); assert.deepEqual(again.fixes, [], 'nada que arreglar → nada cambia');
  const w = initWeights(B('d', 'dense', { units: 4, activation: 'relu' }), 10, makeRng(1));
  assert.equal(w.W.length, 40); assert.equal(w.b.length, 4); assert.ok(w.b.every((v) => v === 0));
  const lim = Math.sqrt(6 / (10 + 4));
  assert.ok(w.W.every((v) => Math.abs(v) <= lim) && w.W.some((v) => Math.abs(v) > lim * 0.5), 'Xavier uniforme');
  assert.deepEqual(w, initWeights(B('d', 'dense', { units: 4, activation: 'relu' }), 10, makeRng(1)));
  const ng = genomeMod.newGenome({ id: 'nueva-1', name: 'Nueva', blocks: raw.blocks, wires: raw.wires.slice(0, 2) }, makeRng(2));
  assert.ok(validate(ng).ok && ng.id === 'nueva-1' && ng.weights.d.W.length === 26 * 3);
});

await check('serialize → compile → serialize idéntico; forward determinista; getFlat/setFlat/paramCount coherentes', () => {
  const g = build(randomGraph(makeRng(77)).blocks, randomGraph(makeRng(77)).wires, 78);
  const net = compile(g);
  const s1 = JSON.stringify(net.serialize());
  assert.equal(s1, JSON.stringify(g.weights));
  const net2 = compile({ ...g, weights: JSON.parse(s1) });
  assert.equal(JSON.stringify(net2.serialize()), s1);
  const obs = obsFor(g, makeRng(1));
  const a = net.forward(obs, net.zeroState()), b = net2.forward(obs, net2.zeroState());
  assert.deepEqual(Array.from(a.outputs.choose.scores), Array.from(b.outputs.choose.scores));
  assert.equal(a.outputs.value, b.outputs.value);
  const flat = net.getFlat();
  assert.equal(flat.length, net.paramCount()); assert.equal(net.paramCount(), countParams(g));
  assert.equal(net.paramList().reduce((s, p) => s + p.array.length, 0), flat.length);
  const f2 = Float64Array.from(flat, (v) => v * 2); net.setFlat(f2);
  assert.ok(near(net.getFlat()[0], flat[0] * 2)); assert.ok(near(net.serialize()[net.paramList()[0].blockId][net.paramList()[0].key][0], flat[0] * 2));
  assert.equal(g.weights[net.paramList()[0].blockId][net.paramList()[0].key][0], flat[0], 'setFlat no toca el genoma de origen');
});

await check('compile lanza GenomeError con código y bloque; forward nunca devuelve NaN con entradas finitas', () => {
  const g = minimal();
  let err = null;
  try { compile({ ...g, blocks: [...g.blocks, B('z', 'eye.laser')] }); } catch (e) { err = e; }
  assert.ok(err && err.name === 'GenomeError' && err.code === 'block-type' && err.blockId === 'z', String(err));
  const big = build([B('f', 'eye.features'), B('d', 'dense', { units: 8, activation: 'sine' }), B('n', 'norm'), B('l', 'lstm', { units: 4 }), B('v', 'hand.value')], [W('f', 'd'), W('d', 'n'), W('n', 'l'), W('l', 'v')]);
  const net = compile(big); net.setFlat(Float64Array.from(net.getFlat(), () => 50));
  const out = net.forward(obsFor(big, makeRng(1)), net.zeroState());
  assert.ok(Number.isFinite(out.outputs.value));
});

await check('plantillas: sniper, turtle, seer, empty validan (forPlay), compilan y disparan con salidas finitas', () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), ['empty', 'seer', 'sniper', 'turtle']);
  for (const [key, t] of Object.entries(TEMPLATES)) {
    assert.ok(t.why && t.name, `${key} explica por qué`);
    const g = t.genome;
    const v = validate(g, { forPlay: true });
    assert.ok(v.ok, `${key}: ${JSON.stringify(v.errors)}`);
    const net = compile(g);
    const out = net.forward(obsFor(g, makeRng(3)), net.zeroState());
    assert.ok(out.outputs.choose && Array.from(out.outputs.choose.scores).every(Number.isFinite), key);
    if (key !== 'empty') assert.ok(out.outputs.move && Array.from(out.outputs.move.scores).every(Number.isFinite), `${key} pies`);
  }
  assert.ok(TEMPLATES.seer.genome.blocks.some((b) => b.type === 'eye.simulator') && TEMPLATES.seer.genome.blocks.some((b) => b.type === 'hand.value'));
  assert.ok(TEMPLATES.turtle.genome.blocks.some((b) => b.type === 'gru') && TEMPLATES.turtle.genome.reward.survive === 0.5);
  assert.ok(!TEMPLATES.sniper.genome.blocks.some((b) => b.type === 'eye.simulator'));
});

await check('rendimiento: red de ~100 k parámetros con N = 24 → forward medio < 20 ms (objetivo 5 ms)', () => {
  const g = build([B('f', 'eye.features'), B('k', 'eye.clock'), B('cat', 'concat'), B('d1', 'dense', { units: 256, activation: 'tanh' }), B('d2', 'dense', { units: 256, activation: 'relu' }),
    B('v', 'hand.value'), B('c', 'eye.candidates'), B('cd', 'dense', { units: 64, activation: 'tanh' }), B('ch', 'hand.choose'), B('m', 'eye.moves'), B('md', 'dense', { units: 32 }), B('fm', 'foot.move')],
  [W('f', 'cat'), W('k', 'cat'), W('cat', 'd1'), W('d1', 'd2'), W('d2', 'v'), W('d2', 'cd'), W('c', 'cd'), W('cd', 'ch'), W('m', 'md'), W('d2', 'md'), W('md', 'fm')], 1, { imagination: { n: 24 } });
  assert.ok(countParams(g) > 90_000, String(countParams(g)));
  const net = compile(g); const obs = obsFor(g, makeRng(1));
  net.forward(obs, net.zeroState());
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) net.forward(obs, net.zeroState());
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 20, `${ms.toFixed(2)} ms`);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (red F2)');
process.exit(fails ? 1 : 0);
