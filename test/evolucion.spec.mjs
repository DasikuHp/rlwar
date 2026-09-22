// F5 — Evolución (spec/05 §1–§6, §9, §10): mutación siempre válida, determinismo, efecto exacto de cada op,
// textos "exactos", nombres, congelados, diferencias padre → hijo, pre-torneo justo y ordenado, Imaginación
// por uso. Escrito ANTES del código y congelado. Sin servidor.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const clone = (v) => JSON.parse(JSON.stringify(v));

const { LIMITS } = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const G = await import('../shared/genome.js');
const { validate, normalize, countParams, outDims, weightShapes, analyzeGenome, newGenome, ACTIVATIONS, CHARACTERS, TRAIT_RANGES, FAMILIES, BLOCKS, DEFAULT_IMAGINATION } = G;
const { TEMPLATES } = await import('../shared/templates.js');
const M = await import('../evo/mutate.js');
const { DEFAULT_MUTATION, mutate, childName, adaptImagination } = M;
const { diffGenomes } = await import('../evo/diff.js');
const { rankChildren, runPretournament } = await import('../evo/children.js');

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const build = (id, blocks, wires, seed = 1, extra = {}) => newGenome({ id, name: id, blocks, wires, ...extra }, makeRng(seed));
// G1: un solo Instinto (d, 8) → las ops de neuronas/activación solo pueden elegirlo a él
const G1 = () => build('uno-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 8, activation: 'tanh' }), B('ch', 'hand.choose'), B('m', 'eye.moves'), B('fm', 'foot.move', { adjust: false })],
  [W('f', 'd'), W('c', 'd'), W('d', 'ch'), W('m', 'fm')], 3);
// G2: con Radar (único ojo con parámetros)
const G2 = () => build('radar-1', [B('f', 'eye.features'), B('r', 'eye.radar', { rays: 16 }), B('c', 'eye.candidates'), B('d', 'dense', { units: 8, activation: 'tanh' }), B('ch', 'hand.choose')],
  [W('f', 'd'), W('r', 'd'), W('c', 'd'), W('d', 'ch')], 4);
// G2x: G2 con un cable redundante f→ch (así hay cables que se pueden quitar sin dejar nada suelto)
const G2x = () => build('radar-2', [B('f', 'eye.features'), B('r', 'eye.radar', { rays: 16 }), B('c', 'eye.candidates'), B('d', 'dense', { units: 8, activation: 'tanh' }), B('ch', 'hand.choose')],
  [W('f', 'd'), W('r', 'd'), W('c', 'd'), W('d', 'ch'), W('f', 'ch')], 4);
// G5: con un Normalizar quitable
const G5 = () => build('norm-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('n', 'norm'), B('d', 'dense', { units: 8, activation: 'tanh' }), B('ch', 'hand.choose')],
  [W('f', 'n'), W('n', 'd'), W('c', 'd'), W('d', 'ch')], 5);
const only = (op, extra = {}) => {
  const cfg = clone(DEFAULT_MUTATION);
  for (const k of Object.keys(cfg)) cfg[k].on = false;
  cfg[op] = { ...cfg[op], on: true, ...(cfg[op].rate !== undefined ? { rate: 1 } : {}), ...extra };
  return cfg;
};
// etiquetas de entrada de un bloque en genomas SIN bloques de paso (concat/skip/norm): "origen:k" en orden de cables
const inLabels = (g, id) => {
  const dims = outDims(g);
  const out = [];
  for (const w of g.wires) if (w.to === id) for (let k = 0; k < dims[w.from].dim; k++) out.push(`${w.from}:${k}`);
  return out;
};
const rowsByLabel = (g, id, key, cols) => { // fila etiquetada → array de `cols` pesos
  const labels = inLabels(g, id), Wt = g.weights[id][key], m = new Map();
  labels.forEach((lab, i) => m.set(lab, Wt.slice(i * cols, (i + 1) * cols)));
  return m;
};
const xavierLim = (fi, fo) => Math.sqrt(6 / (fi + fo));
const NUM_RE = /(?<![A-Za-z0-9_#:])-?\d+(?:\.\d+)?(?![A-Za-z0-9_#:])/g;
const flatNums = (v, out = []) => { if (typeof v === 'number') out.push(v); else if (Array.isArray(v)) v.forEach((x) => flatNums(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => flatNums(x, out)); return out; };
const textIsExact = (op) => {
  const nums = flatNums([op.before, op.after]);
  const ok = new Set(); for (const n of nums) { ok.add(String(n)); ok.add(n.toFixed(2)); ok.add(String(Math.round(n))); }
  for (const tok of op.text.match(NUM_RE) || []) if (!ok.has(tok)) return `"${tok}" de "${op.text}" no está en ${JSON.stringify([op.before, op.after]).slice(0, 200)}`;
  return null;
};

check('DEFAULT_MUTATION es exactamente la tabla de spec/05 §1', () => {
  assert.deepEqual(DEFAULT_MUTATION, {
    weights: { on: true, sigma: 0.05, fraction: 0.3 }, addNeurons: { on: true, rate: 0.3, max: 8 }, removeNeurons: { on: true, rate: 0.2, max: 4 },
    addWire: { on: true, rate: 0.3 }, removeWire: { on: true, rate: 0.2 },
    addBlock: { on: true, rate: 0.2, types: ['dense', 'norm', 'skip', 'attention', 'pool', 'echo', 'gru', 'lstm', 'teamMemory', 'eye.*'] },
    removeBlock: { on: true, rate: 0.1 }, activation: { on: true, rate: 0.2 }, eyeParams: { on: true, rate: 0.2 },
    imagination: { on: true, rate: 0.3, sigma: 0.2 }, traits: { on: true, sigma: 0.15 }, emblem: { on: true },
  });
});

check('mutate: 2 000 cadenas de 5 pasos (semillas 1..2000) → siempre válido, dentro de límites, linaje correcto', () => {
  const keys = ['sniper', 'turtle', 'seer', 'empty'];
  let undone = 0, total = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    let g = normalize(TEMPLATES[keys[seed % 4]].genome);
    const rng = makeRng(seed);
    for (let step = 0; step < 5; step++) {
      const { child, ops } = mutate(g, DEFAULT_MUTATION, rng, { sibling: 0, existingIds: new Set([g.id]), now: '2026-09-22T12:00:00.000Z' });
      const v = validate(child);
      assert.ok(v.ok, `semilla ${seed} paso ${step}: ${JSON.stringify(v.errors[0])} ops=${JSON.stringify(ops).slice(0, 300)}`);
      assert.ok(countParams(child) <= LIMITS.params && child.blocks.length <= LIMITS.blocks && child.wires.length <= LIMITS.wires);
      assert.equal(child.lineage.generation, g.lineage.generation + 1);
      assert.deepEqual(child.lineage.parents, [g.id]);
      assert.equal(child.lineage.born, '2026-09-22T12:00:00.000Z');
      assert.deepEqual(child.lineage.mutations, ops);
      assert.deepEqual(child.stats, { games: 0, wins: 0, kills: 0, deaths: 0, reigns: 0 });
      assert.deepEqual(child.memory, []);
      assert.ok(Array.isArray(ops) && ops.every((o) => o.op && o.text && o.before !== undefined && o.after !== undefined));
      for (const o of ops) { total++; if (o.undone) { undone++; assert.ok(typeof o.reason === 'string' && o.reason.length, 'deshecha con motivo'); } }
      g = child;
    }
  }
  assert.ok(total > 5000, `ops totales ${total}`);
  assert.ok(undone < total * 0.5, `demasiadas deshechas: ${undone}/${total}`);
});

check('mutate: determinismo — misma semilla → mismo hijo (JSON idéntico); semilla distinta → distinto', () => {
  for (const key of ['sniper', 'turtle', 'seer']) {
    const p = normalize(TEMPLATES[key].genome);
    const opts = { sibling: 0, existingIds: new Set(), now: '2026-01-01T00:00:00.000Z' };
    const a = mutate(p, DEFAULT_MUTATION, makeRng(77), opts), b = mutate(p, DEFAULT_MUTATION, makeRng(77), opts);
    assert.equal(JSON.stringify(a), JSON.stringify(b), key);
    const c = mutate(p, DEFAULT_MUTATION, makeRng(78), opts);
    assert.notEqual(JSON.stringify(a.child.weights), JSON.stringify(c.child.weights), key);
    assert.equal(JSON.stringify(p), JSON.stringify(normalize(TEMPLATES[key].genome)), 'el padre no se toca');
  }
});

check('op addNeurons: unidades +k (1..max), pesos viejos en su sitio, columnas nuevas Xavier×0.1, sesgos 0, filas nuevas del consumidor a 0', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const p = G1();
    const { child, ops } = mutate(p, only('addNeurons', { max: 5 }), makeRng(seed));
    assert.equal(ops.length, 1); const op = ops[0];
    assert.equal(op.op, 'addNeurons'); assert.equal(op.blockId, 'd'); assert.ok(!op.undone);
    const k = op.after.added, u0 = 8, u1 = op.after.units;
    assert.ok(k >= 1 && k <= 5 && u1 === u0 + k && op.before.units === u0, JSON.stringify(op));
    assert.equal(child.blocks.find((b) => b.id === 'd').params.units, u1);
    const W0 = p.weights.d.W, W1 = child.weights.d.W, inDim = 38;
    assert.equal(W1.length, inDim * u1);
    const lim = xavierLim(inDim, u1) * 0.1;
    let nonzero = 0;
    for (let i = 0; i < inDim; i++) for (let j = 0; j < u1; j++) {
      if (j < u0) assert.equal(W1[i * u1 + j], W0[i * u0 + j]);
      else { assert.ok(Math.abs(W1[i * u1 + j]) <= lim + 1e-12, 'columna nueva pequeña'); if (W1[i * u1 + j] !== 0) nonzero++; }
    }
    assert.ok(nonzero > 0, 'las columnas nuevas no son todo ceros');
    assert.deepEqual(child.weights.d.b, [...p.weights.d.b, ...new Array(k).fill(0)]);
    assert.deepEqual(child.weights.ch.W, [...p.weights.ch.W, ...new Array(k).fill(0)], 'Elegir: filas nuevas a 0');
    assert.deepEqual(child.weights.ch.b, p.weights.ch.b);
    assert.ok(validate(child).ok);
    assert.equal(textIsExact(op), null, textIsExact(op));
    assert.ok(op.text.includes(`${u0} → ${u1}`) && op.text.includes(String(k)), op.text);
  }
});

check('op removeNeurons: quita las k de menor norma saliente (empate → índice mayor), mínimo 1 unidad; recorta filas y columnas', () => {
  const p = G1();
  p.weights.ch.W = [3, 3, 1, 1, 2, 2, 4, 4]; // normas salientes por unidad
  const order = [3, 2, 5, 4, 1, 0, 7, 6];  // por norma ↑ y, a igual norma, índice ↓
  for (let seed = 1; seed <= 8; seed++) {
    const { child, ops } = mutate(p, only('removeNeurons', { max: 3 }), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'removeNeurons'); assert.equal(op.blockId, 'd'); assert.ok(!op.undone, JSON.stringify(op));
    const k = op.after.removed.length;
    assert.ok(k >= 1 && k <= 3 && op.after.units === 8 - k && op.before.units === 8);
    assert.deepEqual(op.after.removed, order.slice(0, k).sort((a, b) => a - b));
    assert.deepEqual(op.before.norms.map((n) => Math.round(n * 1000) / 1000), [3, 3, 1, 1, 2, 2, 4, 4]);
    const kept = [0, 1, 2, 3, 4, 5, 6, 7].filter((u) => !op.after.removed.includes(u));
    const u1 = kept.length, W0 = p.weights.d.W, W1 = child.weights.d.W;
    assert.equal(W1.length, 38 * u1);
    for (let i = 0; i < 38; i++) kept.forEach((u, j) => assert.equal(W1[i * u1 + j], W0[i * 8 + u]));
    assert.deepEqual(child.weights.d.b, kept.map((u) => p.weights.d.b[u]));
    assert.deepEqual(child.weights.ch.W, kept.map((u) => p.weights.ch.W[u]));
    assert.ok(validate(child).ok);
    assert.equal(textIsExact(op), null, textIsExact(op));
  }
  const one = build('mini-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 1 }), B('ch', 'hand.choose')], [W('f', 'd'), W('c', 'd'), W('d', 'ch')], 9);
  const r = mutate(one, only('removeNeurons', { max: 3 }), makeRng(1));
  assert.ok(r.ops[0].undone && r.child.blocks.find((b) => b.id === 'd').params.units === 1, 'con 1 unidad no se puede quitar: se deshace');
});

check('op activation: cambia la activación de un Instinto a otra distinta; pesos intactos', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const p = G1();
    const { child, ops } = mutate(p, only('activation'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'activation'); assert.equal(op.blockId, 'd'); assert.ok(!op.undone);
    assert.equal(op.before.activation, 'tanh');
    assert.ok(ACTIVATIONS.includes(op.after.activation) && op.after.activation !== 'tanh');
    assert.equal(child.blocks.find((b) => b.id === 'd').params.activation, op.after.activation);
    assert.deepEqual(child.weights, p.weights);
    seen.add(op.after.activation);
    assert.ok(op.text.includes('tanh') && op.text.includes(op.after.activation));
  }
  assert.ok(seen.size >= 4, `variedad de activaciones: ${[...seen]}`);
});

check('op eyeParams: cambia un parámetro del Radar (16 → 8 o 32); el Instinto receptor casa por índice (nuevas a 0 / recorte)', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 10; seed++) {
    const p = G2();
    const { child, ops } = mutate(p, only('eyeParams'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'eyeParams'); assert.equal(op.blockId, 'r'); assert.ok(!op.undone, JSON.stringify(op));
    assert.equal(op.before.rays, 16); assert.ok([8, 32].includes(op.after.rays), JSON.stringify(op.after));
    const rays = op.after.rays; seen.add(rays);
    assert.equal(child.blocks.find((b) => b.id === 'r').params.rays, rays);
    const before = rowsByLabel(p, 'd', 'W', 8), after = rowsByLabel(child, 'd', 'W', 8);
    assert.equal(after.size, 26 + 2 * rays + 12);
    for (const [lab, row] of after) {
      if (before.has(lab)) assert.deepEqual(row, before.get(lab), lab);
      else assert.ok(row.every((v) => v === 0), `fila nueva ${lab} a 0`);
    }
    assert.deepEqual(child.weights.d.b, p.weights.d.b); assert.deepEqual(child.weights.ch, p.weights.ch);
    assert.ok(validate(child).ok);
    assert.equal(textIsExact(op), null, textIsExact(op));
  }
  assert.equal(seen.size, 2, 'salen las dos opciones');
});

check('op addWire: cable nuevo válido; el destino conserva sus filas y pone a 0 las nuevas', () => {
  let done = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = G1();
    const { child, ops } = mutate(p, only('addWire'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'addWire');
    if (op.undone) continue;
    done++;
    assert.equal(child.wires.length, p.wires.length + 1);
    const nw = child.wires.find((w) => !p.wires.some((x) => x.from === w.from && x.to === w.to));
    assert.ok(nw && op.wire === `${nw.from}→${nw.to}`, JSON.stringify(op));
    assert.ok(validate(child).ok);
    const dst = nw.to;
    if (child.weights[dst] && child.weights[dst].W) {
      const cols = weightShapes(child.blocks.find((b) => b.id === dst), analyzeGenome(child).dims[dst]).W / inLabels(child, dst).length;
      const before = rowsByLabel(p, dst, 'W', cols), after = rowsByLabel(child, dst, 'W', cols);
      for (const [lab, row] of after) {
        if (before.has(lab)) assert.deepEqual(row, before.get(lab), lab); else assert.ok(row.every((v) => v === 0), `fila nueva ${lab} a 0`);
      }
    }
    for (const id of Object.keys(p.weights)) if (id !== dst) assert.deepEqual(child.weights[id], p.weights[id], `otros bloques intactos (${id})`);
  }
  assert.ok(done >= 10, `cables añadidos en ${done}/20`);
});

check('op removeWire: quita un cable dejando entradas y salidas, o se deshace; filas recortadas', () => {
  let done = 0, undone = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = G2x();
    const { child, ops } = mutate(p, only('removeWire'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'removeWire');
    if (op.undone) { undone++; assert.deepEqual(child.wires, p.wires); continue; }
    done++;
    assert.equal(child.wires.length, p.wires.length - 1);
    const gone = p.wires.find((w) => !child.wires.some((x) => x.from === w.from && x.to === w.to));
    assert.equal(op.wire, `${gone.from}→${gone.to}`);
    for (const b of child.blocks) {
      const ins = child.wires.filter((w) => w.to === b.id).length, outs = child.wires.filter((w) => w.from === b.id).length;
      if (!b.type.startsWith('eye.')) assert.ok(ins >= 1, `${b.id} sin entradas`);
      if (!b.type.startsWith('hand.') && !b.type.startsWith('foot.')) assert.ok(outs >= 1, `${b.id} sin salidas`);
    }
    assert.ok(validate(child).ok);
    if (gone.to === 'd') {
      const before = rowsByLabel(p, 'd', 'W', 8), after = rowsByLabel(child, 'd', 'W', 8);
      for (const [lab, row] of after) assert.deepEqual(row, before.get(lab), lab);
      assert.equal(after.size, before.size - outDims(p)[gone.from].dim);
    }
  }
  assert.ok(done >= 15, `cables quitados en ${done}/20 (deshechos ${undone})`);
  assert.ok(mutate(G2(), only('removeWire'), makeRng(1)).ops[0].undone, 'sin cable redundante: todos dejarían algo suelto → se deshace');
});

check('op addBlock: inserta en un cable (A→X→B) o añade un ojo cableado; id nuevo tipo+número; pesos nuevos pequeños; válido', () => {
  const kinds = { inserted: 0, eye: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const p = normalize(TEMPLATES.turtle.genome);
    const { child, ops } = mutate(p, only('addBlock'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'addBlock');
    if (op.undone) continue;
    assert.equal(child.blocks.length, p.blocks.length + 1);
    const nb = child.blocks.find((b) => !p.blocks.some((x) => x.id === b.id));
    assert.ok(nb && op.blockId === nb.id && /^[a-z]+\d+$/i.test(nb.id), JSON.stringify(op));
    assert.equal(op.after.type, nb.type);
    assert.ok(validate(child).ok, JSON.stringify(validate(child).errors[0]));
    if (nb.type.startsWith('eye.')) {
      kinds.eye++;
      const outs = child.wires.filter((w) => w.from === nb.id);
      assert.equal(outs.length, 1);
      assert.ok(['dense', 'concat'].includes(child.blocks.find((b) => b.id === outs[0].to).type));
      assert.equal(child.wires.length, p.wires.length + 1);
    } else {
      kinds.inserted++;
      const ins = child.wires.filter((w) => w.to === nb.id), outs = child.wires.filter((w) => w.from === nb.id);
      assert.equal(ins.length, 1); assert.equal(outs.length, 1);
      assert.ok(p.wires.some((w) => w.from === ins[0].from && w.to === outs[0].to), 'sustituye un cable existente');
      assert.ok(!child.wires.some((w) => w.from === ins[0].from && w.to === outs[0].to), 'el cable directo desaparece');
      assert.equal(child.wires.length, p.wires.length + 1);
      const idx = child.blocks.findIndex((b) => b.id === nb.id);
      assert.equal(child.blocks[idx - 1].id, ins[0].from, 'se coloca justo después del origen');
      if (child.weights[nb.id]) {
        const dims = analyzeGenome(child).dims[nb.id];
        for (const [key, arr] of Object.entries(child.weights[nb.id])) {
          if (/^(b|ba|bz|br|bh|bi|bf|bo|bg|g)$/.test(key)) continue;
          const lim = xavierLim(dims.in + (['gru', 'lstm'].includes(nb.type) ? nb.params.units : 0), nb.params.units || nb.params.heads * nb.params.keyDim || 1) * 0.1;
          assert.ok(arr.every((v) => Math.abs(v) <= lim * 3), `pesos nuevos pequeños (${key})`);
        }
      }
    }
    for (const b of p.blocks) assert.deepEqual(child.blocks.find((x) => x.id === b.id).params, b.params, 'los demás bloques no cambian de parámetros');
  }
  assert.ok(kinds.inserted >= 5 && kinds.eye >= 5, JSON.stringify(kinds));
});

check('op removeBlock: quita un bloque (ni Mano/Pie ni ojo único de su corriente) reconectando entradas a salidas', () => {
  let done = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = G5();
    const { child, ops } = mutate(p, only('removeBlock'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'removeBlock');
    if (op.undone) continue;
    done++;
    assert.ok(['n', 'd'].includes(op.blockId), op.blockId);
    assert.equal(child.blocks.length, p.blocks.length - 1);
    assert.ok(!child.blocks.some((b) => b.id === op.blockId) && !(op.blockId in child.weights));
    const ins = p.wires.filter((w) => w.to === op.blockId).map((w) => w.from), outs = p.wires.filter((w) => w.from === op.blockId).map((w) => w.to);
    for (const a of ins) for (const b of outs) assert.ok(child.wires.some((w) => w.from === a && w.to === b), `${a}→${b} reconectado`);
    assert.ok(!child.wires.some((w) => w.from === op.blockId || w.to === op.blockId));
    assert.ok(validate(child).ok, JSON.stringify(validate(child).errors[0]));
    assert.equal(op.before.type, p.blocks.find((b) => b.id === op.blockId).type);
  }
  assert.ok(done >= 10, `quitados en ${done}/20`);
  const only2 = build('ojos-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('ch', 'hand.choose')], [W('f', 'ch'), W('c', 'ch')], 2);
  const r = mutate(only2, only('removeBlock'), makeRng(1));
  assert.ok(r.ops[0].undone, 'sin candidatos: se deshace con motivo');
});

check('op imagination: n ± 0..4 recortado, pesos × e^(σN) recortados 0.1..20, a lo sumo una familia cambia de on y nunca todas apagadas', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const p = normalize(TEMPLATES.sniper.genome);
    p.imagination.families.line.weight = 19; p.imagination.families.wild.weight = 0.11; p.imagination.n = 62;
    const { child, ops } = mutate(p, only('imagination', { sigma: 0.2 }), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'imagination'); assert.ok(!op.undone);
    const a = p.imagination, b = child.imagination;
    assert.ok(Math.abs(b.n - a.n) <= 4 && b.n >= LIMITS.candidatesMin && b.n <= LIMITS.candidatesMax, `n ${a.n} → ${b.n}`);
    let toggles = 0;
    for (const f of FAMILIES) {
      const r = b.families[f].weight / a.families[f].weight;
      assert.ok(b.families[f].weight >= 0.1 && b.families[f].weight <= 20);
      assert.ok(r > Math.exp(-0.2 * 5) - 1e-9 && r < Math.exp(0.2 * 5) + 1e-9 || b.families[f].weight === 0.1 || b.families[f].weight === 20, `${f}: ${r}`);
      if (b.families[f].on !== a.families[f].on) toggles++;
      assert.deepEqual({ ...b.families[f], on: 0, weight: 0 }, { ...a.families[f], on: 0, weight: 0 }, 'las listas de valores no cambian');
    }
    assert.ok(toggles <= 1);
    assert.ok(FAMILIES.some((f) => b.families[f].on));
    assert.equal(textIsExact(op), null, textIsExact(op));
  }
  const p2 = normalize(TEMPLATES.sniper.genome);
  for (const f of FAMILIES) p2.imagination.families[f].on = f === 'line';
  for (let seed = 1; seed <= 30; seed++) assert.ok(mutate(p2, only('imagination'), makeRng(seed)).child.imagination.families.line.on, 'la última encendida no se apaga');
});

check('op traits: temperatura y pulso × e^(σN), teamSpirit + σN, recortes; carácter cambia con prob. σ a otro', () => {
  let charChanges = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const p = normalize(TEMPLATES.sniper.genome);
    p.traits = { temperature: 1, pulse: 0.1, teamSpirit: 0.5, character: 'frio' };
    const { child, ops } = mutate(p, only('traits', { sigma: 0.15 }), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'traits'); assert.ok(!op.undone);
    const t = child.traits;
    for (const k of ['temperature', 'pulse', 'teamSpirit']) assert.ok(t[k] >= TRAIT_RANGES[k][0] && t[k] <= TRAIT_RANGES[k][1], k);
    assert.ok(t.temperature > Math.exp(-0.15 * 5) && t.temperature < Math.exp(0.15 * 5));
    assert.ok(Math.abs(t.teamSpirit - 0.5) <= 0.15 * 5);
    assert.ok(CHARACTERS.includes(t.character));
    if (t.character !== 'frio') charChanges++;
    assert.deepEqual(op.before, p.traits); assert.deepEqual(op.after, t);
    assert.equal(textIsExact(op), null, textIsExact(op));
  }
  assert.ok(charChanges >= 10 && charChanges <= 60, `cambios de carácter ${charChanges}/200 (esperado ≈ 30)`);
});

check('op weights: una fracción de los pesos (≈ fraction) recibe + σ·N·(1+|w|); el resto idéntico; congelados intactos', () => {
  const p = normalize(TEMPLATES.seer.genome);
  p.frozen = ['dv'];
  let changed = 0, total = 0, maxRel = 0;
  const { child, ops } = mutate(p, only('weights', { sigma: 0.05, fraction: 0.3 }), makeRng(5));
  const op = ops[0];
  assert.equal(op.op, 'weights'); assert.ok(!op.undone);
  for (const id of Object.keys(p.weights)) for (const key of Object.keys(p.weights[id])) {
    const a = p.weights[id][key], b = child.weights[id][key];
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      if (id === 'dv') { assert.equal(a[i], b[i], 'congelado'); continue; }
      total++;
      if (a[i] !== b[i]) { changed++; maxRel = Math.max(maxRel, Math.abs(b[i] - a[i]) / (1 + Math.abs(a[i]))); }
    }
  }
  assert.ok(changed / total > 0.25 && changed / total < 0.35, `fracción cambiada ${(changed / total).toFixed(3)}`);
  assert.ok(maxRel < 0.05 * 5, `ruido acotado: ${maxRel}`);
  assert.equal(op.after.changed, changed);
  assert.equal(textIsExact(op), null, textIsExact(op));
  assert.deepEqual(child.weights.dv, p.weights.dv);
});

check('op emblem: entero en [0, 2³¹); nueva semilla o 4 bits volteados', () => {
  const p = normalize(TEMPLATES.sniper.genome);
  let differ = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { child, ops } = mutate(p, only('emblem'), makeRng(seed));
    const op = ops[0];
    assert.equal(op.op, 'emblem');
    assert.ok(Number.isInteger(child.emblem) && child.emblem >= 0 && child.emblem < 2 ** 31);
    assert.equal(op.before.emblem, p.emblem); assert.equal(op.after.emblem, child.emblem);
    if (child.emblem !== p.emblem) differ++;
  }
  assert.ok(differ >= 30, `emblemas distintos ${differ}/40`);
});

check('"exacto": cada número de ops[].text está en before/after (300 cadenas completas)', () => {
  let n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const p = normalize(TEMPLATES[['sniper', 'turtle', 'seer'][seed % 3]].genome);
    const { ops } = mutate(p, DEFAULT_MUTATION, makeRng(seed));
    for (const op of ops) { n++; const bad = textIsExact(op); assert.equal(bad, null, bad); assert.ok(/[a-záéíóúñ]/i.test(op.text), 'texto en español'); }
  }
  assert.ok(n > 300);
});

check('nombres 🧭: Hydra-7 → Hydra-8a / Hydra-8b; Hydra (gen 0) → Hydra-1a; id = nombre en minúsculas; colisión → sufijo', () => {
  assert.equal(childName('Hydra-7', 8, 0), 'Hydra-8a');
  assert.equal(childName('Hydra-7', 8, 1), 'Hydra-8b');
  assert.equal(childName('Hydra-8a', 9, 2), 'Hydra-9c');
  assert.equal(childName('Hydra', 1, 0), 'Hydra-1a');
  assert.equal(childName('Tortuga con memoria', 1, 25), 'Tortuga con memoria-1z');
  const p = normalize(TEMPLATES.sniper.genome); p.name = 'Hydra-7'; p.id = 'hydra-7'; p.lineage.generation = 7;
  const a = mutate(p, DEFAULT_MUTATION, makeRng(1), { sibling: 0, existingIds: new Set(['hydra-7']) }).child;
  assert.equal(a.name, 'Hydra-8a'); assert.equal(a.id, 'hydra-8a'); assert.equal(a.lineage.generation, 8);
  const b = mutate(p, DEFAULT_MUTATION, makeRng(1), { sibling: 1, existingIds: new Set(['hydra-7', 'hydra-8b']) }).child;
  assert.equal(b.name, 'Hydra-8b'); assert.equal(b.id, 'hydra-8b-2');
  const c = mutate(p, DEFAULT_MUTATION, makeRng(1)).child;
  assert.equal(c.id, 'hydra-8a', 'sin opts: hermano a');
  assert.ok(typeof c.lineage.born === 'string' && !Number.isNaN(Date.parse(c.lineage.born)), 'born es una fecha ISO');
});

check('congelados: en 300 cadenas el bloque frozen conserva pesos y parámetros; las ops que lo tocarían se deshacen con motivo', () => {
  let undoneFrozen = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let g = G1(); g.frozen = ['d'];
    const rng = makeRng(seed);
    for (let step = 0; step < 5; step++) {
      const { child, ops } = mutate(g, DEFAULT_MUTATION, rng);
      assert.ok(validate(child).ok);
      assert.deepEqual(child.weights.d, g.weights.d, `semilla ${seed} paso ${step}: pesos de d`);
      assert.deepEqual(child.blocks.find((b) => b.id === 'd').params, g.blocks.find((b) => b.id === 'd').params);
      assert.deepEqual(child.frozen, ['d']);
      for (const op of ops) if (op.undone && /congelad/i.test(op.reason)) undoneFrozen++;
      for (const op of ops) if (!op.undone) assert.ok(!(['addNeurons', 'removeNeurons', 'activation'].includes(op.op) && op.blockId === 'd'), 'no se elige el congelado');
      g = child;
    }
  }
  assert.ok(undoneFrozen > 0, 'alguna op se deshizo por el congelado');
});

check('diffGenomes: same / changed / added / removed, relChange, heat (≤ 64, máx 1), cables, rasgos, imaginación, textos', () => {
  const p = normalize(TEMPLATES.sniper.genome);
  const same = diffGenomes(p, p);
  assert.deepEqual(same.blocks.map((b) => b.status), p.blocks.map(() => 'same'));
  assert.ok(same.blocks.every((b) => b.relChange === 0 && b.heat.every((h) => h === 0)));
  assert.deepEqual(same.wires, { added: [], removed: [] }); assert.deepEqual(same.text, []);
  const { child, ops } = mutate(p, only('addNeurons', { max: 3 }), makeRng(2));
  const d = diffGenomes(child, p);
  const bid = ops[0].blockId;
  const row = d.blocks.find((b) => b.blockId === bid);
  assert.equal(row.status, 'changed'); assert.ok(row.relChange > 0 && row.heat.length === child.blocks.find((b) => b.id === bid).params.units && Math.max(...row.heat) === 1);
  assert.equal(row.name, `${BLOCKS.dense.name} ${bid}`);
  for (const b of d.blocks) if (b.blockId !== bid && !p.wires.some((w) => w.from === bid && w.to === b.blockId)) assert.equal(b.status, 'same', b.blockId);
  assert.deepEqual(d.text, ops.map((o) => o.text));
  assert.deepEqual(d.traits, { before: p.traits, after: child.traits }); assert.deepEqual(d.imagination, { before: p.imagination, after: child.imagination });
  const c2 = mutate(p, only('addBlock'), makeRng(3));
  if (!c2.ops[0].undone) {
    const d2 = diffGenomes(c2.child, p);
    assert.ok(d2.blocks.some((b) => b.blockId === c2.ops[0].blockId && b.status === 'added'));
    assert.ok(d2.wires.added.length >= 1);
    const back = diffGenomes(p, c2.child);
    assert.ok(back.blocks.some((b) => b.blockId === c2.ops[0].blockId && b.status === 'removed'));
    assert.ok(back.wires.removed.length >= 1); assert.deepEqual(back.text, []);
  }
  const big = build('grande-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 100 }), B('ch', 'hand.choose')], [W('f', 'd'), W('c', 'd'), W('d', 'ch')], 8);
  const bigChild = mutate(big, only('weights'), makeRng(1)).child;
  const h = diffGenomes(bigChild, big).blocks.find((b) => b.blockId === 'd').heat;
  assert.equal(h.length, 64, 'más de 64 unidades → 64 tramos');
  const ch = diffGenomes(bigChild, big).blocks.find((b) => b.blockId === 'ch');
  assert.equal(ch.heat.length, 64, 'Elegir: una por posición de entrada (100 → 64 tramos)');
  const p2 = clone(p); p2.traits.temperature = 2; p2.weights = clone(p.weights); p2.weights.d.W = p.weights.d.W.map((v) => v * 2);
  const d3 = diffGenomes(p2, p);
  assert.ok(near(d3.blocks.find((b) => b.blockId === 'd').relChange, Math.sqrt(p.weights.d.W.reduce((s, v) => s + v * v, 0)) / (Math.sqrt(p.weights.d.W.reduce((s, v) => s + v * v, 0) + p.weights.d.b.reduce((s, v) => s + v * v, 0)) + 1e-9), 1e-9), 'relChange = ‖Δ‖/‖padre‖');
});

check('rankChildren: victorias ↓, diferencia de kills ↓, kills ↓, nombre ↑', () => {
  const rows = [
    { id: 'c', name: 'C', wins: 1, killDiff: 2, kills: 3, deaths: 1 }, { id: 'a', name: 'A', wins: 2, killDiff: -1, kills: 1, deaths: 2 },
    { id: 'd', name: 'D', wins: 1, killDiff: 2, kills: 4, deaths: 2 }, { id: 'b', name: 'B', wins: 2, killDiff: 0, kills: 0, deaths: 0 },
    { id: 'e', name: 'E', wins: 1, killDiff: 2, kills: 4, deaths: 2 },
  ];
  assert.deepEqual(rankChildren(rows).map((r) => r.id), ['b', 'a', 'd', 'e', 'c']);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'd', 'b', 'e'], 'no muta la entrada');
});

check('runPretournament: mismas semillas y soldados para todos, lados alternos, filas con opsText, orden', () => {
  const mk = (id, name, texts) => ({ id, name, lineage: { mutations: texts.map((t) => ({ text: t })) } });
  const children = [mk('h-1a', 'H-1a', ['x']), mk('h-1b', 'H-1b', ['y', 'z'])];
  const opponent = { id: 'reina', name: 'Reina' };
  const calls = [];
  const play = ({ seed, child, opponent: op, childSide, soldiers }) => {
    calls.push({ seed, child: child.id, op: op.id, childSide, soldiers });
    const j = seed - 1010;
    return child.id === 'h-1b' ? { win: j === 0 ? 1 : 0, kills: 1, deaths: 1 } : { win: j <= 1 ? 1 : 0, kills: 2, deaths: 0 };
  };
  const r = runPretournament({ children, opponent, games: 3, seed: 10, soldiers: 'random', play });
  const sold = 1 + makeRng(10).int(4);
  assert.equal(r.soldiers, sold); assert.deepEqual(r.seeds, [1010, 1011, 1012]);
  assert.equal(calls.length, 6);
  for (const c of children) {
    const mine = calls.filter((x) => x.child === c.id);
    assert.deepEqual(mine.map((x) => x.seed), [1010, 1011, 1012]);
    assert.deepEqual(mine.map((x) => x.childSide), ['left', 'right', 'left']);
    assert.ok(mine.every((x) => x.soldiers === sold && x.op === 'reina'));
  }
  assert.deepEqual(r.ranking, [
    { id: 'h-1a', name: 'H-1a', wins: 2, killDiff: 6, kills: 6, deaths: 0, opsText: ['x'] },
    { id: 'h-1b', name: 'H-1b', wins: 1, killDiff: 0, kills: 3, deaths: 3, opsText: ['y', 'z'] },
  ]);
  const r2 = runPretournament({ children, opponent, games: 2, seed: 10, soldiers: 3, play });
  assert.equal(r2.soldiers, 3); assert.deepEqual(r2.seeds, [1010, 1011]);
  const r0 = runPretournament({ children, opponent, games: 0, seed: 1, soldiers: 2, play: () => { throw new Error('no debe jugar'); } });
  assert.deepEqual(r0.ranking.map((x) => [x.id, x.wins, x.kills]), [['h-1a', 0, 0], ['h-1b', 0, 0]]);
});

check('adaptImagination: usage = familias de las últimas 200 decisiones de disparo; adaptive → 0.9·w + 0.1·(u/Σu)·Σw recortado', () => {
  const dec = (family) => ({ phase: 'shoot', chosen: 1, candidates: [{ family: 'wild' }, { family }] });
  const decisions = [...Array.from({ length: 50 }, () => dec('line')), ...Array.from({ length: 200 }, (_, i) => dec(i % 2 ? 'parabola' : 'sine')),
    { phase: 'move', chosenMove: 0 }, { phase: 'shoot', error: 'rota' }];
  const im = clone(DEFAULT_IMAGINATION);
  const r = adaptImagination(im, decisions);
  assert.deepEqual(r.usage, { line: 0, parabola: 100, sine: 100, ode1: 0, artillery: 0, wild: 0 });
  assert.equal(r.changed, false);
  assert.deepEqual(r.weights, Object.fromEntries(FAMILIES.map((f) => [f, im.families[f].weight])), 'sin adaptive no cambian');
  assert.deepEqual(im, DEFAULT_IMAGINATION, 'pura: no toca la entrada');
  const im2 = { ...clone(DEFAULT_IMAGINATION), adaptive: true };
  im2.families.line.weight = 0.1;
  const r2 = adaptImagination(im2, decisions);
  const sum = 0.1 + 6 + 4 + 2 + 4 + 2;
  assert.ok(near(r2.weights.parabola, 0.9 * 6 + 0.1 * 0.5 * sum, 1e-9) && near(r2.weights.sine, 0.9 * 4 + 0.1 * 0.5 * sum, 1e-9));
  assert.ok(near(r2.weights.ode1, 1.8, 1e-9) && near(r2.weights.line, 0.1, 1e-9), 'recorte inferior 0.1');
  assert.equal(r2.changed, true);
  const r3 = adaptImagination(im2, []);
  assert.equal(r3.changed, false); assert.deepEqual(r3.usage, { line: 0, parabola: 0, sine: 0, ode1: 0, artillery: 0, wild: 0 });
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nevolucion OK');
