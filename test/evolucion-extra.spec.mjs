// F5 — Evolución, casos que la prueba de mutantes de evo/mutate.js mostró sin cubrir en evolucion.spec (congelado):
// removeWire nunca deja un bloque sin su única entrada ni un origen sin salida y sí admite destinos con
// exactamente 2 entradas; eyeParams cambia enteros en ±1 y ±2 en ambos sentidos; imagination sube y baja n hasta 4.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const { makeRng } = await import('../shared/rng.js');
const { newGenome, normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { DEFAULT_MUTATION, mutate } = await import('../evo/mutate.js');
const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const build = (id, blocks, wires, seed = 1, extra = {}) => newGenome({ id, name: id, blocks, wires, ...extra }, makeRng(seed));
const only = (op, extra = {}) => {
  const cfg = clone(DEFAULT_MUTATION);
  for (const k of Object.keys(cfg)) cfg[k].on = false;
  cfg[op] = { ...cfg[op], on: true, ...(cfg[op].rate !== undefined ? { rate: 1 } : {}), ...extra };
  return cfg;
};

check('removeWire: con f→d (única entrada de d) y f→ch (ch tiene d y f), solo se puede quitar f→ch; nunca deja a d sin entrada', () => {
  // f tiene 2 salidas (f→d, f→ch); d tiene 1 entrada (f); ch tiene 2 entradas (d, f, más c); c→ch es la única salida de c
  const g = build('cable-1', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 6 }), B('ch', 'hand.choose')],
    [W('f', 'd'), W('c', 'ch'), W('d', 'ch'), W('f', 'ch')], 3);
  const removed = new Set();
  for (let seed = 1; seed <= 25; seed++) {
    const { child, ops } = mutate(g, only('removeWire'), makeRng(seed));
    const op = ops[0];
    assert.ok(!op.undone, JSON.stringify(op));
    removed.add(op.wire);
    assert.ok(child.wires.some((w) => w.from === 'f' && w.to === 'd'), 'f→d (única entrada de d) se conserva siempre');
    assert.ok(child.wires.some((w) => w.from === 'c' && w.to === 'ch'), 'c→ch (única salida de c) se conserva siempre');
    assert.ok(child.wires.some((w) => w.from === 'd' && w.to === 'ch'), 'd→ch (única salida de d) se conserva siempre');
  }
  assert.deepEqual([...removed], ['f→ch']);
});

check('removeWire: un destino con exactamente 2 entradas es elegible (ambos cables redundantes se quitan alguna vez)', () => {
  // f→d, c→d, f→ch, c→ch, d→ch: f y c tienen 2 salidas; d tiene 2 entradas; ch tiene 3
  const g = build('cable-2', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 6 }), B('ch', 'hand.choose')],
    [W('f', 'd'), W('c', 'd'), W('f', 'ch'), W('c', 'ch'), W('d', 'ch')], 4);
  const removed = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { ops } = mutate(g, only('removeWire'), makeRng(seed));
    if (!ops[0].undone) removed.add(ops[0].wire);
  }
  assert.ok(removed.has('f→d') && removed.has('c→d') && removed.has('f→ch') && removed.has('c→ch'), `quitados: ${[...removed].join(', ')}`);
  assert.ok(!removed.has('d→ch'));
});

check('eyeParams (entero): Obstáculos con 4 huecos cambia en ±1 y ±2, y en los dos sentidos; nunca fuera de 1..8', () => {
  const g = build('huecos-1', [B('f', 'eye.features'), B('o', 'eye.obstacles', { slots: 4 }), B('c', 'eye.candidates'), B('d', 'dense', { units: 6 }), B('ch', 'hand.choose')],
    [W('f', 'd'), W('o', 'd'), W('c', 'd'), W('d', 'ch')], 5);
  const deltas = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { child, ops } = mutate(g, only('eyeParams'), makeRng(seed));
    const op = ops[0];
    assert.ok(!op.undone && op.blockId === 'o', JSON.stringify(op));
    const v = op.after.slots;
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 8 && v !== 4, `slots ${v}`);
    assert.equal(child.blocks.find((b) => b.id === 'o').params.slots, v);
    deltas.add(v - 4);
  }
  assert.deepEqual([...deltas].sort((a, b) => a - b), [-2, -1, 1, 2], `deltas vistos: ${[...deltas]}`);
});

check('imagination: en 60 semillas n sube y baja, |Δn| llega a 4 y a veces no cambia (rng.int(0..4))', () => {
  const p = normalize(TEMPLATES.sniper.genome);
  const deltas = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const { child, ops } = mutate(p, only('imagination'), makeRng(seed));
    const d = child.imagination.n - p.imagination.n;
    assert.ok(Math.abs(d) <= 4); assert.equal(ops[0].after.n, child.imagination.n);
    deltas.add(d);
  }
  assert.ok(deltas.has(0) && [...deltas].some((d) => d > 0) && [...deltas].some((d) => d < 0) && (deltas.has(4) || deltas.has(-4)), `Δn vistos: ${[...deltas].sort((a, b) => a - b)}`);
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nevolucion-extra OK');
