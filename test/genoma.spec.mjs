// F2 — Defaults decididos por el usuario (plan2.md) fijados, y casos de validación que la prueba
// de mutantes mostró sin cubrir. Complementa test/red.spec.mjs. Sin servidor.
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const { makeRng } = await import('../shared/rng.js');
const G = await import('../shared/genome.js');
const { BLOCKS, validate, normalize, repair, newGenome, DEFAULT_TRAITS, DEFAULT_REWARD, DEFAULT_LEARNING, DEFAULT_IMAGINATION, LIMITS } = G;

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const base = () => repair({ format: 1, id: 'base-1', name: 'Base', imagination: { n: 5 },
  blocks: [B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 3 }), B('ch', 'hand.choose')],
  wires: [W('f', 'd'), W('c', 'd'), W('d', 'ch')] }, makeRng(1)).genome;
const codes = (g, o) => validate(g, o).errors.map((e) => e.code);

check('defaults decididos (ronda 2, 7, spec/02 §2, spec/03 §5, spec/04 §1–2) fijados', () => {
  assert.deepEqual(DEFAULT_TRAITS, { temperature: 1.0, pulse: 0.1, teamSpirit: 0.5, character: 'frio' });
  assert.deepEqual(DEFAULT_REWARD, { kill: 1, die: -1, friendlyFire: -1.5, graze: 0.1, win: 2, lose: 0, survive: 0, cover: 0, repeatExpr: 0, nearFriendly: 0, slapCaress: 1, normalize: true, grazeRadius: 2.0, milestones: true });
  assert.deepEqual(DEFAULT_LEARNING, {
    method: 'gradient',
    gradient: { lr: 0.003, gamma: 0.95, entropy: 0.01, clipNorm: 5, batchGames: 4, bpttSteps: 8, baseline: 'value', optimizer: 'adam', adjustLearn: true },
    evolution: { population: 16, sigma: 0.02, lr: 0.01, gamesPerCandidate: 2, antithetic: true, rankNormalize: true },
    both: { gradientGamesPerCycle: 16, evolutionStepsPerCycle: 1 },
    sleep: { lessonThreshold: 0.05 },
  });
  assert.equal(DEFAULT_IMAGINATION.n, 24); assert.equal(DEFAULT_IMAGINATION.targets, 'all'); assert.equal(DEFAULT_IMAGINATION.adaptive, false);
  assert.deepEqual(DEFAULT_IMAGINATION.families.line, { on: true, weight: 6, jitter: [0, 0.03, -0.03, 0.08, -0.08, 0.15, -0.15] });
  assert.deepEqual(DEFAULT_IMAGINATION.families.parabola, { on: true, weight: 6, curvatures: [0.004, -0.004, 0.01, -0.01, 0.02, -0.02, 0.04, -0.04] });
  assert.deepEqual(DEFAULT_IMAGINATION.families.sine, { on: true, weight: 4, amps: [2, -2, 4, -4, 6], periods: [3, 5, 8, 12] });
  assert.deepEqual(DEFAULT_IMAGINATION.families.ode1, { on: true, weight: 2, a: [-2, -1, 1, 2], k: [3, 6, 12], b: [-1, 0, 1] });
  assert.deepEqual(DEFAULT_IMAGINATION.families.artillery, { on: true, weight: 4, gravities: [0.02, 0.04, 0.07, 0.1, 0.15], angles: [10, 20, 30, 40, 50, 60, 70] });
  assert.deepEqual(DEFAULT_IMAGINATION.families.wild, { on: true, weight: 2, a: [-8, -4, -2, 2, 4, 8], k: [1, 3, 6, 12, 20] });
  assert.deepEqual(DEFAULT_IMAGINATION.usage, { line: 0, parabola: 0, sine: 0, ode1: 0, artillery: 0, wild: 0 });
  assert.deepEqual(G.TRAIT_RANGES, { temperature: [0.05, 3], pulse: [0, 1], teamSpirit: [0, 1] });
  assert.deepEqual(G.CHARACTERS, ['frio', 'chulo', 'dramatico', 'desquiciado']);
  assert.deepEqual(G.ACTIVATIONS, ['relu', 'tanh', 'sigmoid', 'leaky', 'gelu', 'sine', 'linear']);
  assert.deepEqual(G.MAP_CHANNELS, ['obstacles', 'enemies', 'allies', 'self', 'trails']);
  assert.deepEqual(G.LEARNING_RANGES['gradient.lr'], [1e-5, 0.1]); assert.deepEqual(G.LEARNING_RANGES['evolution.population'], [2, 128]);
});

check('catálogo: defaults y rangos de los parámetros clave (spec/02 §4)', () => {
  const p = (t, k) => BLOCKS[t].params.find((q) => q.key === k);
  assert.equal(p('eye.map', 'cell').default, 2); assert.deepEqual(p('eye.map', 'cell').options.map((o) => o.value), [1, 2, 2.5, 5]);
  assert.deepEqual(p('eye.map', 'channels').default, ['obstacles', 'enemies', 'allies', 'self']);
  assert.deepEqual([p('eye.obstacles', 'slots').min, p('eye.obstacles', 'slots').max, p('eye.obstacles', 'slots').default], [1, 8, 6]);
  assert.deepEqual([p('eye.history', 'depth').min, p('eye.history', 'depth').max, p('eye.history', 'depth').default], [1, 8, 4]);
  assert.deepEqual(p('eye.radar', 'rays').options.map((o) => o.value), [8, 16, 32]); assert.equal(p('eye.radar', 'rays').default, 16);
  assert.equal(p('eye.simulator', 'fine').default, false);
  assert.deepEqual([p('dense', 'units').min, p('dense', 'units').max, p('dense', 'units').default], [1, 512, 32]);
  assert.equal(p('dense', 'activation').default, 'tanh');
  assert.deepEqual([p('norm', 'eps').min, p('norm', 'eps').max, p('norm', 'eps').default], [1e-8, 1e-2, 1e-5]);
  assert.deepEqual([p('attention', 'heads').min, p('attention', 'heads').max, p('attention', 'heads').default], [1, 8, 1]);
  assert.deepEqual([p('attention', 'keyDim').min, p('attention', 'keyDim').max, p('attention', 'keyDim').default], [4, 128, 16]);
  assert.equal(p('pool', 'op').default, 'mean');
  for (const t of ['echo', 'gru', 'lstm', 'teamMemory']) assert.deepEqual([p(t, 'units').min, p(t, 'units').max, p(t, 'units').default], [1, 512, 16]);
  assert.deepEqual([p('hand.adjust', 'params').min, p('hand.adjust', 'params').max, p('hand.adjust', 'params').default], [1, 3, 3]);
  assert.equal(p('foot.move', 'adjust').default, true);
  assert.equal(BLOCKS['eye.features'].params.length, 0);
  assert.deepEqual(BLOCKS.attention.streams, { in: ['ctx', 'cand', 'move'], out: 'ctx' });
  assert.deepEqual(BLOCKS.pool.streams, { in: ['cand', 'move'], out: 'ctx' });
  assert.deepEqual(BLOCKS.echo.streams, { in: ['ctx'], out: 'ctx' });
  assert.deepEqual(BLOCKS['hand.choose'].streams, { in: ['cand'], out: 'cand' });
  assert.deepEqual(BLOCKS['foot.move'].streams, { in: ['move'], out: 'move' });
  assert.equal(LIMITS.moves, 9);
});

check('validate: casos sin cubrir — no objeto, familias, grazeRadius, número/conjunto, 64 bloques justos, ids, nombre vacío', () => {
  const g = base();
  assert.ok(codes(5).includes('format') && codes(null).includes('format') && codes([]).includes('format'));
  assert.ok(codes({ ...g, imagination: { families: { laser: {} } } }).includes('imagination'), 'familia desconocida');
  assert.ok(codes({ ...g, imagination: { families: { line: { weight: 101 } } } }).includes('imagination'), 'peso fuera de rango');
  assert.ok(codes({ ...g, imagination: { families: 3 } }).includes('imagination'));
  assert.ok(codes({ ...g, imagination: { targets: 'todos' } }).includes('imagination'));
  assert.ok(codes({ ...g, imagination: 'x' }).includes('imagination'));
  assert.ok(validate({ ...g, imagination: { n: 8, targets: 'nearest', families: { line: { on: false, weight: 3 } }, adaptive: true } }).ok, 'imaginación válida');
  assert.ok(codes({ ...g, reward: { grazeRadius: 0.1 } }).includes('reward'));
  assert.ok(codes({ ...g, reward: { potato: 1 } }).includes('reward'));
  assert.ok(codes({ ...g, reward: 'x' }).includes('reward'));
  assert.ok(validate({ ...g, reward: { ...DEFAULT_REWARD, kill: 5, survive: -5, grazeRadius: 10 } }).ok, 'recompensa válida en los extremos');
  assert.ok(codes({ ...g, traits: 'x' }).includes('traits'));
  assert.ok(codes({ ...g, traits: { character: 'timido' } }).includes('traits'));
  assert.ok(validate({ ...g, traits: { temperature: 3, pulse: 0, teamSpirit: 1, character: 'desquiciado' } }).ok);
  assert.ok(codes({ ...g, learning: 'x' }).includes('learning'));
  assert.ok(codes({ ...g, learning: { method: 'magia' } }).includes('learning'));
  assert.ok(codes({ ...g, learning: { gradient: { baseline: 'oráculo' } } }).includes('learning'));
  assert.ok(codes({ ...g, learning: { gradient: { optimizer: 'rmsprop' } } }).includes('learning'));
  assert.ok(codes({ ...g, learning: { evolution: { population: 129 } } }).includes('learning'));
  assert.ok(validate({ ...g, learning: DEFAULT_LEARNING }).ok, 'aprendizaje por defecto completo válido');
  assert.ok(validate({ ...g, learning: { method: 'both', gradient: { lr: 0.1, gamma: 1, baseline: 'none', optimizer: 'sgd' }, evolution: { population: 2, sigma: 1 } } }).ok);
  assert.ok(codes({ ...g, frozen: 'd' }).includes('format'));
  assert.ok(validate({ ...g, frozen: ['nadie'] }).warnings.some((w) => w.code === 'frozen-ref'));
  assert.ok(codes({ ...g, blocks: g.blocks.map((b) => (b.id === 'd' ? { ...b, params: { units: 3, activation: 'tanh' } } : b)), weights: g.weights }).length === 0);
  const withNorm = repair({ ...g, blocks: [...g.blocks, B('n', 'norm', { eps: 0.5 })], wires: [...g.wires, W('f', 'n')] }, makeRng(1)).genome;
  assert.ok(codes(withNorm).includes('block-param'), 'eps fuera de rango');
  const eps0 = repair({ ...g, blocks: [...g.blocks, B('n', 'norm', { eps: 1e-8 })], wires: [...g.wires, W('f', 'n')] }, makeRng(1)).genome;
  assert.ok(validate(eps0).ok, 'eps en el mínimo vale');
  const mapOf = (channels) => ({ ...g, blocks: [...g.blocks, B('m', 'eye.map', { cell: 5, channels })] });
  assert.ok(codes(mapOf([])).includes('block-param'), 'sin canales');
  assert.ok(codes(mapOf(['obstacles', 'obstacles'])).includes('block-param'), 'canal repetido');
  assert.ok(codes(mapOf(['laser'])).includes('block-param'), 'canal desconocido');
  assert.ok(codes(mapOf('obstacles')).includes('block-param'), 'no es lista');
  assert.ok(codes({ ...g, blocks: [...g.blocks, B('m', 'eye.map', { cell: 3 })] }).includes('block-param'), 'celda fuera de las opciones');
  assert.ok(codes({ ...g, blocks: [...g.blocks, B('s', 'eye.simulator', { fine: 'sí' })] }).includes('block-param'), 'bool');
  assert.ok(codes({ ...g, blocks: [...g.blocks, B('d2', 'dense', { units: 2.5 })] }).includes('block-param'), 'entero');
  assert.ok(codes({ ...g, blocks: [...g.blocks, 'no-bloque'] }).includes('id'));
  assert.ok(codes({ ...g, blocks: [...g.blocks, B('con espacios', 'skip')] }).includes('id'));
  assert.ok(codes({ ...g, name: '' }).includes('name'));
  assert.ok(codes({ ...g, id: 'ab' }).includes('id') && codes({ ...g, id: 'Mayus' }).includes('id'));
  assert.ok(codes({ ...g, wires: [...g.wires, 'x'] }).includes('wire-ref'));
  assert.ok(validate({ ...g, wires: [...g.wires, W('f', 'd')] }).warnings.some((w) => w.code === 'duplicate-wire'));
  // exactamente 64 bloques y 256 cables: válido; 65 / 257: límite
  const many = (n) => { const blocks = [...g.blocks], wires = [...g.wires]; for (let i = 0; i < n; i++) { blocks.push(B('s' + i, 'skip')); wires.push(W(i ? 's' + (i - 1) : 'f', 's' + i)); } return { ...g, blocks, wires }; };
  assert.ok(validate(many(60)).ok, '64 bloques justos');
  assert.ok(codes(many(61)).includes('limit'));
  const wired = { ...g, wires: [...g.wires, ...Array.from({ length: 253 }, () => W('f', 'd'))] };
  assert.ok(!codes(wired).includes('limit') && validate(wired).warnings.length >= 200, '256 cables justos (repetidos: aviso)');
  const wired2 = { ...g, wires: [...g.wires, ...Array.from({ length: 254 }, () => W('f', 'd'))] };
  assert.ok(codes(wired2).includes('limit'));
});

check('avisos unconnected: alcanzado pero sin salida a mano/pie, y con salida pero sin ojo detrás', () => {
  const g = base();
  const deadEnd = repair({ ...g, blocks: [...g.blocks, B('x', 'dense', { units: 2 })], wires: [...g.wires, W('f', 'x')] }, makeRng(1)).genome;
  const v1 = validate(deadEnd);
  assert.ok(v1.ok && v1.warnings.some((w) => w.code === 'unconnected' && w.blockId === 'x'));
  const noEye = repair({ ...g, blocks: [...g.blocks, B('y', 'dense', { units: 2 }), B('v', 'hand.value')], wires: [...g.wires, W('y', 'v')] }, makeRng(1)).genome;
  const v2 = validate(noEye);
  assert.ok(v2.ok && v2.warnings.some((w) => w.code === 'unconnected' && w.blockId === 'y') && v2.warnings.some((w) => w.code === 'unconnected' && w.blockId === 'v'));
  assert.ok(!validate(g).warnings.some((w) => w.code === 'unconnected'), 'el genoma base no tiene sueltos');
  const extra = validate({ ...g, weights: { ...g.weights, f: { W: [1] } } });
  assert.ok(extra.ok && extra.warnings.some((w) => w.code === 'weights-extra'));
  const extraKey = validate({ ...g, weights: { ...g.weights, d: { ...g.weights.d, Z: [1] } } });
  assert.ok(extraKey.ok && extraKey.warnings.some((w) => w.code === 'weights-extra' && w.blockId === 'd'));
});

check('normalize/newGenome: nombre por defecto = id, emblema derivado del id, secciones intactas si ya existen', () => {
  const g = newGenome({ id: 'sin-nombre', blocks: [B('f', 'eye.features'), B('v', 'hand.value')], wires: [W('f', 'v')] }, makeRng(3));
  assert.equal(g.name, 'sin-nombre');
  assert.ok(Number.isInteger(g.emblem) && g.emblem === normalize({ id: 'sin-nombre', blocks: [], wires: [] }).emblem, 'emblema determinista por id');
  assert.notEqual(g.emblem, normalize({ id: 'otro-id', blocks: [], wires: [] }).emblem);
  const n = normalize({ id: 'x', blocks: [], wires: [], emblem: 7, traits: { temperature: 2 }, frozen: ['a'], lineage: { generation: 3 } });
  assert.equal(n.emblem, 7); assert.equal(n.traits.temperature, 2); assert.equal(n.traits.pulse, 0.1); assert.deepEqual(n.frozen, ['a']); assert.equal(n.lineage.generation, 3); assert.deepEqual(n.lineage.parents, []);
  assert.deepEqual(n.stats, { games: 0, wins: 0, kills: 0, deaths: 0, reigns: 0 });
  assert.equal(normalize({ id: 'x', blocks: [B('d', 'dense', { units: 4 })], wires: [] }).blocks[0].params.activation, 'tanh');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (genoma F2: defaults y validación)');
process.exit(fails ? 1 : 0);
