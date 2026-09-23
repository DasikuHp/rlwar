// Receta de entreno (spec/04 §11, ronda 17): lógica pura de evo/recipe.js. Escrito ANTES del código.
// validateRecipe (aprendizaje mezclado, programas, recompensa de práctica, congelar, currículo, examen, mejor versión),
// scheduleValue, progressOf, mergeReward, createCurriculum y createBestTracker.
// Uso: node test/receta.spec.mjs
import { strict as assert } from 'node:assert';
const R = await import('../evo/recipe.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const net = () => normalize({ ...clone(TEMPLATES.sniper.genome), id: 'n1', name: 'N1', frozen: ['md'] });
const G = { games: 100 };
const ok = (body, g = net()) => { const r = R.validateRecipe({ duration: G, ...body }, g); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.recipe; };
const bad = (body, re, g = net()) => {
  const r = R.validateRecipe({ duration: G, ...body }, g);
  assert.equal(r.ok, false, `debería fallar: ${JSON.stringify(body)}`);
  assert.ok(r.errors.length && r.errors.every((e) => typeof e.message === 'string' && e.message && typeof e.example === 'string'), 'cada error con mensaje y ejemplo');
  assert.ok(r.errors.some((e) => re.test(e.message) || re.test(e.field || '')), `${JSON.stringify(body)} → ${r.errors.map((e) => e.message).join(' | ')}`);
};

// ---------- aprendizaje (learnCfg) ----------
check('sin receta: el aprendizaje es el de la red y nada más cambia', () => {
  const g = net();
  const r = ok({}, g);
  assert.deepEqual(r.learning, g.learning);
  assert.deepEqual([r.schedule, r.reward, r.frozen, r.curriculum, r.exam, r.keepBest], [{}, null, [], null, false, false]);
});
check('learning se mezcla por secciones sobre el de la red y la red no cambia', () => {
  const g = net(); const before = clone(g.learning);
  const r = ok({ learning: { method: 'both', gradient: { lr: 0.01, batchGames: 8 }, evolution: { sigma: 0.05 } } }, g);
  assert.equal(r.learning.method, 'both');
  assert.deepEqual(r.learning.gradient, { ...before.gradient, lr: 0.01, batchGames: 8 });
  assert.deepEqual(r.learning.evolution, { ...before.evolution, sigma: 0.05 });
  assert.deepEqual(r.learning.both, before.both);
  assert.deepEqual(g.learning, before, 'la red no cambia');
});
check('learning: rangos, enteros, valores y claves desconocidas son errores', () => {
  bad({ learning: { gradient: { lr: 0.5 } } }, /lr/);
  bad({ learning: { gradient: { batchGames: 2.5 } } }, /batchGames/);
  bad({ learning: { evolution: { population: 1 } } }, /population/);
  bad({ learning: { gradient: { baseline: 'media' } } }, /baseline/);
  bad({ learning: { gradient: { optimizer: 'rmsprop' } } }, /optimizer/);
  bad({ learning: { gradient: { adjustLearn: 'sí' } } }, /adjustLearn/);
  bad({ learning: { method: 'magia' } }, /method/);
  bad({ learning: { gradient: { lR: 0.01 } } }, /lR/);
  bad({ learning: { turbo: {} } }, /turbo/);
  bad({ learning: 7 }, /learning/);
});

// ---------- programas ----------
check('programas: from por defecto sale del aprendizaje mezclado o de la temperatura de la red', () => {
  const g = net(); g.traits.temperature = 1.2;
  const r = ok({ learning: { gradient: { lr: 0.01 } }, schedule: { lr: { shape: 'linear', to: 0.001 }, entropy: { shape: 'constant', to: 0 }, temperature: { shape: 'cosine', to: 0.5 }, sigma: { shape: 'linear', to: 0.005 } } }, g);
  assert.deepEqual(r.schedule.lr, { shape: 'linear', from: 0.01, to: 0.001 });
  assert.deepEqual(r.schedule.entropy, { shape: 'constant', from: g.learning.gradient.entropy, to: 0 });
  assert.deepEqual(r.schedule.temperature, { shape: 'cosine', from: 1.2, to: 0.5 });
  assert.deepEqual(r.schedule.sigma, { shape: 'linear', from: g.learning.evolution.sigma, to: 0.005 });
  assert.equal(ok({ schedule: { temperature: { shape: 'linear', from: 2, to: 1 } } }).schedule.temperature.from, 2);
});
check('programas: forma, rangos y meseta son errores', () => {
  bad({ schedule: { lr: { shape: 'exponencial', to: 0.001 } } }, /shape|forma/);
  bad({ schedule: { lr: { shape: 'linear', to: 1 } } }, /lr/);
  bad({ schedule: { temperature: { shape: 'linear', to: 5 } } }, /temperatur/);
  bad({ schedule: { sigma: { shape: 'linear', from: 0, to: 0.01 } } }, /sigma/);
  bad({ schedule: { gamma: { shape: 'linear', to: 0.9 } } }, /gamma/);
  bad({ schedule: { lr: { shape: 'linear' } } }, /to/);
  bad({ duration: { plateau: { window: 20 } }, schedule: { lr: { shape: 'linear', to: 0.001 } } }, /cuánto dura|partidas o minutos/);
});
check('scheduleValue: constante, línea recta y coseno (y p fuera de [0, 1] se recorta)', () => {
  const lin = { shape: 'linear', from: 1, to: 0 }, cos = { shape: 'cosine', from: 1, to: 0 }, con = { shape: 'constant', from: 0.7, to: 0 };
  assert.equal(R.scheduleValue(lin, 0), 1); assert.equal(R.scheduleValue(lin, 0.25), 0.75); assert.equal(R.scheduleValue(lin, 1), 0);
  assert.ok(Math.abs(R.scheduleValue(cos, 0.5) - 0.5) < 1e-12); assert.equal(R.scheduleValue(cos, 0), 1); assert.ok(Math.abs(R.scheduleValue(cos, 1)) < 1e-12);
  assert.ok(Math.abs(R.scheduleValue(cos, 0.25) - (1 + Math.cos(Math.PI / 4)) / 2) < 1e-12);
  assert.equal(R.scheduleValue(con, 0.9), 0.7);
  assert.equal(R.scheduleValue(lin, 2), 0); assert.equal(R.scheduleValue(lin, -1), 1);
});
check('progressOf: partidas jugadas entre el total, tiempo entre el total; con meseta, null', () => {
  assert.equal(R.progressOf({ games: 8 }, { games: 4, elapsedMs: 0 }), 0.5);
  assert.equal(R.progressOf({ games: 8 }, { games: 20, elapsedMs: 0 }), 1);
  assert.equal(R.progressOf({ minutes: 2 }, { games: 0, elapsedMs: 30000 }), 0.25);
  assert.equal(R.progressOf({ plateau: { window: 20 } }, { games: 5, elapsedMs: 1 }), null);
});

// ---------- recompensa de práctica ----------
check('recompensa: sustituye pesos de términos; cualquier otra clave o un peso fuera de −5..5 es un error', () => {
  assert.deepEqual(ok({ reward: { graze: 0.5, kill: 2 } }).reward, { graze: 0.5, kill: 2 });
  bad({ reward: { graze: 9 } }, /graze/);
  bad({ reward: { normalize: false } }, /normalize/);
  bad({ reward: [] }, /reward|recompensa/);
});
check('mergeReward: capas de menos a más prioridad; estadísticas nuevas para lo que cambia, copia para lo demás', () => {
  const base = { ...clone(TEMPLATES.sniper.genome.reward), stats: { kill: { n: 30, mean: 1, var: 0.1 }, graze: { n: 25, mean: 0.1, var: 0.01 }, die: { n: 21, mean: -1, var: 0 } } };
  const snapshot = clone(base);
  const m = R.mergeReward(base, { graze: 0.5, kill: 1 }, { die: -3 });
  assert.deepEqual([m.reward.graze, m.reward.kill, m.reward.die, m.reward.win], [0.5, 1, -3, base.win]);
  assert.deepEqual(m.stats.kill, base.stats.kill, 'kill queda con el mismo peso: copia');
  assert.notEqual(m.stats.kill, base.stats.kill, 'copia, no el mismo objeto');
  assert.equal('graze' in m.stats, false); assert.equal('die' in m.stats, false);
  m.stats.kill.n = 99;
  assert.deepEqual(base, snapshot, 'la recompensa de la red no cambia');
  assert.equal(m.reward.stats, m.stats, 'la recompensa mezclada lleva sus propias estadísticas');
  const same = R.mergeReward(base);
  assert.deepEqual(same.reward, base, 'sin capas: los mismos pesos y las mismas estadísticas…');
  assert.notEqual(same.stats, base.stats, '…pero copiadas');
});

// ---------- congelar ----------
check('congelar: los de la red más los de la receta; ids que no existen, sin pesos o todos son errores', () => {
  const r = ok({ frozen: ['d'] });
  assert.deepEqual(r.frozen, ['d']);
  assert.deepEqual(r.frozenAll.slice().sort(), ['d', 'md']);
  bad({ frozen: ['nadie'] }, /nadie/);
  bad({ frozen: ['f'] }, /pesos/);
  bad({ frozen: ['d', 'ch', 'fm'] }, /nada que aprender/);
  bad({ frozen: 'd' }, /frozen|congel/);
});

// ---------- currículo ----------
const L = (over = {}) => ({ name: 'Lección', ...over });
check('currículo: de 1 a 16 lecciones con nombre; soldados 1–4 o al azar; opponents y reward validados', () => {
  const r = ok({ curriculum: [L({ soldiers: 1, until: { games: 3 } }), L({ soldiers: 'random', opponents: { antagonist: 0, hallOfFame: 0, self: 1 } })] });
  assert.equal(r.curriculum.length, 2);
  assert.deepEqual(r.curriculum[0].until, { kind: 'games', n: 3 });
  assert.equal(r.curriculum[1].until, null);
  bad({ curriculum: [] }, /lecci/);
  bad({ curriculum: Array.from({ length: 17 }, () => L()) }, /16/);
  bad({ curriculum: [{ soldiers: 1 }] }, /nombre|name/);
  bad({ curriculum: [L({ name: 'x'.repeat(41) })] }, /40/);
  bad({ curriculum: [L({ soldiers: 5 })] }, /soldados|soldiers/);
  bad({ curriculum: [L({ reward: { graze: 7 } })] }, /graze/);
  bad({ curriculum: [L({ opponents: { antagonist: 0, hallOfFame: 0, self: 0 } })] }, /rival|opponents/);
});
check('currículo: reglas de paso (partidas, tasa de victorias, recompensa) con sus límites', () => {
  const u = (until) => ok({ curriculum: [L({ until }), L()] }).curriculum[0].until;
  assert.deepEqual(u({ winRate: 0.6 }), { kind: 'winRate', threshold: 0.6, window: 20, minGames: 20 });
  assert.deepEqual(u({ winRate: 0.6, window: 10, minGames: 30 }), { kind: 'winRate', threshold: 0.6, window: 10, minGames: 30 });
  assert.deepEqual(u({ reward: 0.2, window: 5 }), { kind: 'reward', threshold: 0.2, window: 5, minGames: 5 });
  const badU = (until, re) => bad({ curriculum: [L({ until }), L()] }, re);
  badU({ games: 0 }, /games|partidas/);
  badU({ winRate: 1.5 }, /winRate|tasa/);
  badU({ winRate: 0.5, window: 3 }, /window|ventana/);
  badU({ winRate: 0.5, window: 20, minGames: 10 }, /minGames|mínimo/);
  badU({ algo: 1 }, /until|regla/);
});
check('currículo con la explotadora: ninguna lección puede traer rivales', () => {
  bad({ exploiter: true, curriculum: [L({ opponents: { antagonist: 1, hallOfFame: 0, self: 0 } })] }, /explotadora/);
  ok({ exploiter: true, curriculum: [L({ soldiers: 1 })] });
});
check('createCurriculum: pasa de lección al cumplir la regla con las partidas de esa lección; la última no pasa', () => {
  const lessons = ok({ curriculum: [L({ name: 'A', until: { games: 3 } }), L({ name: 'B', until: { winRate: 0.6, window: 5, minGames: 5 } }), L({ name: 'C', until: { games: 1 } })] }).curriculum;
  const c = R.createCurriculum(lessons);
  assert.deepEqual([c.index(), c.lesson().name], [0, 'A']);
  assert.equal(c.record({ game: 0, win: 0, reward: 0 }), null);
  assert.equal(c.record({ game: 1, win: 1, reward: 0 }), null);
  const a = c.record({ game: 2, win: 0, reward: 0 });
  assert.deepEqual({ from: a.from, to: a.to, games: a.games }, { from: 0, to: 1, games: 3 });
  assert.equal(c.index(), 1);
  // B: 5 partidas como mínimo y 3 de 5 ganadas en las últimas 5 (las de A no cuentan)
  for (const [k, w] of [[3, 1], [4, 1], [5, 1], [6, 0]]) assert.equal(c.record({ game: k, win: w, reward: 0 }), null, `partida ${k}`);
  const b = c.record({ game: 7, win: 0, reward: 0 });
  assert.ok(b && b.to === 2 && Math.abs(b.measure - 0.6) < 1e-12, JSON.stringify(b));
  assert.equal(c.record({ game: 8, win: 1, reward: 0 }), null, 'la última no pasa aunque cumpla');
  const sum = c.summary();
  assert.deepEqual(sum.map((x) => [x.name, x.from, x.to, x.met]), [['A', 0, 2, true], ['B', 3, 7, true], ['C', 8, null, false]]);
});
check('createCurriculum: la regla de recompensa usa la media de las últimas `window` partidas de la lección', () => {
  const c = R.createCurriculum(ok({ curriculum: [L({ until: { reward: 0.5, window: 5, minGames: 6 } }), L()] }).curriculum);
  for (const [k, r] of [[0, 2.5], [1, 0], [2, 0], [3, 0], [4, 0]]) assert.equal(c.record({ game: k, win: 0, reward: r }), null, `partida ${k}: menos del mínimo`);
  assert.equal(c.record({ game: 5, win: 0, reward: 0 }), null, 'media de las 5 últimas = 0 (la primera ya no cuenta)');
  const m = c.record({ game: 6, win: 0, reward: 2.5 });
  assert.ok(m && Math.abs(m.measure - 0.5) < 1e-12, 'media de las 5 últimas = 0,5');
});

// ---------- quedarse con la mejor ----------
check('createBestTracker: tasa de las 20 últimas; mejora solo si supera; resultado con la mejor, la final y cuándo', () => {
  const t = R.createBestTracker(20);
  const wins = [...Array(20).fill(1).map((_, i) => (i < 12 ? 1 : 0)), 1, 1, 0, 0, 0, 0, 0, 0];
  const improved = wins.map((w, k) => t.record(w, k));
  assert.deepEqual(improved.slice(0, 19), Array(19).fill(false), 'con menos de 20 partidas no hay tasa');
  assert.equal(improved[19], true);
  const r = t.result();
  assert.equal(r.best, 12 / 20); assert.equal(r.atGame, 19);
  assert.ok(Math.abs(r.final - (wins.slice(-20).reduce((s, w) => s + w, 0) / 20)) < 1e-12);
  assert.equal(R.createBestTracker(20).result(), null);
});

// ---------- examen y mejor versión ----------
check('exam y keepBest: sí/no', () => {
  const r = ok({ exam: true, keepBest: true });
  assert.deepEqual([r.exam, r.keepBest], [true, true]);
  bad({ exam: 'sí' }, /exam/);
  bad({ keepBest: 1 }, /keepBest/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (receta de entreno: lógica pura)');
process.exitCode = fails ? 1 : 0;
