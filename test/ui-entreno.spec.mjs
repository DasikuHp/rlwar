// Entreno (parte 4, spec/prompt-opus-ui.md §3.1; spec/04 §6 y §9.6): lógica pura de public/js/lab/training.js.
// El cuerpo de POST /api/lab/trainings a partir del formulario (con los mismos límites que el servidor y mensajes en
// español), las medias móviles de la curva, las marcas de los ejes y el trazo de una serie. Escrito ANTES del código.
// Uso: node test/ui-entreno.spec.mjs
import { strict as assert } from 'node:assert';
const T = await import('../public/js/lab/training.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const base = { netId: 'hydra', mix: { antagonist: 0.6, hallOfFame: 0.25, self: 0.15 }, antagonistId: '', hard: 2, ghost: 0, speed: 'turbo', workers: 4, durationKind: 'games', games: 200, minutes: 10, window: 50, minGain: 0.02, soldiers: 'random', seed: '', exploiter: false };

check('cuerpo: partidas, turbo con hilos, mezcla de rivales; sin semilla ni rival fijo no se mandan', () => {
  const r = T.trainingBody(base);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.body, { netId: 'hydra', opponents: { antagonist: 0.6, hallOfFame: 0.25, self: 0.15, hard: 2, ghost: 0 }, speed: 'turbo', workers: 4, duration: { games: 200 }, soldiers: 'random' });
});

check('cuerpo: minutos, meseta, x1/x10 sin hilos, soldados fijos, semilla, rival fijo y explotadora', () => {
  assert.deepEqual(T.trainingBody({ ...base, durationKind: 'minutes', minutes: '2.5' }).body.duration, { minutes: 2.5 });
  assert.deepEqual(T.trainingBody({ ...base, durationKind: 'plateau', window: '30', minGain: '0.01' }).body.duration, { plateau: { window: 30, minGain: 0.01 } });
  const x10 = T.trainingBody({ ...base, speed: 'x10', soldiers: '3', seed: '77', antagonistId: 'orca', exploiter: true }).body;
  assert.equal('workers' in x10, false, 'los hilos solo cuentan en turbo');
  assert.deepEqual([x10.speed, x10.soldiers, x10.seed, x10.opponents.antagonistId, x10.exploiter], ['x10', 3, 77, 'orca', true]);
});

check('errores en español con los límites del servidor (y sin cuerpo si hay errores)', () => {
  const bad = (patch, re) => { const r = T.trainingBody({ ...base, ...patch }); assert.equal(r.body, null); assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${r.errors}`); };
  bad({ netId: '' }, /elige la red/i);
  bad({ games: '0' }, /partidas/);
  bad({ games: '2.5' }, /partidas/);
  bad({ durationKind: 'minutes', minutes: '0' }, /minutos/);
  bad({ durationKind: 'plateau', window: '0' }, /ventana/);
  bad({ workers: '33' }, /hilos/);
  bad({ soldiers: '5' }, /soldados/);
  bad({ mix: { antagonist: 0, hallOfFame: 0, self: 0 } }, /rival/);
  bad({ seed: '-1' }, /semilla/);
  assert.deepEqual(T.trainingBody({ ...base, speed: 'x1', workers: '99' }).errors, [], 'los hilos no se miran fuera de turbo');
});

check('media móvil de los últimos n (al principio, de los que haya)', () => {
  assert.deepEqual(T.movingAverage([1, 2, 3, 4, 5], 2), [1, 1.5, 2.5, 3.5, 4.5]);
  assert.deepEqual(T.movingAverage([0, 1, 0, 1], 10), [0, 0.5, 1 / 3, 0.5]);
  assert.deepEqual(T.movingAverage([], 5), []);
});

check('series de la curva: recompensa media y tasa de victorias por partida', () => {
  const curve = [{ game: 1, reward: 1, win: 1 }, { game: 2, reward: -1, win: 0 }, { game: 3, reward: 2, win: 1 }, { game: 4, reward: 0, win: true }];
  const s = T.curveSeries(curve, 2);
  assert.deepEqual(s.games, [1, 2, 3, 4]);
  assert.deepEqual(s.reward, [1, -1, 2, 0]);
  assert.deepEqual(s.rewardAvg, [1, 0, 0.5, 1]);
  assert.deepEqual(s.winRate, [1, 0.5, 0.5, 1]);
  assert.deepEqual(T.curveSeries([], 20), { games: [], reward: [], rewardAvg: [], winRate: [] });
});

check('marcas del eje: números redondos que cubren el rango (incluido un rango plano)', () => {
  const t = T.niceTicks(-0.37, 1.42, 4);
  assert.ok(t[0] <= -0.37 && t.at(-1) >= 1.42, JSON.stringify(t));
  assert.ok(t.length >= 3 && t.length <= 7);
  const step = t[1] - t[0];
  assert.ok(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - step) < 1e-9), 'paso constante');
  assert.ok([1, 2, 2.5, 5].some((m) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - m) < 1e-9), `paso redondo ${step}`);
  const flat = T.niceTicks(0.5, 0.5, 4);
  assert.ok(flat[0] < 0.5 && flat.at(-1) > 0.5);
  assert.deepEqual(T.niceTicks(0, 1, 4), [0, 0.25, 0.5, 0.75, 1]);
});

check('trazo de una serie: M y L con las escalas dadas', () => {
  assert.equal(T.linePath([1, 2, 3], [0, 1, 0.5], (x) => x * 10, (y) => 100 - y * 100), 'M10,100L20,0L30,50');
  assert.equal(T.linePath([], [], (x) => x, (y) => y), '');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (entreno: lógica)');
process.exitCode = fails ? 1 : 0;
