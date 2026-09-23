// Auditoría P0 (2026-09-23), arreglos de lógica pura de la interfaz con OK del usuario ("arréglalos todos: siendo un
// juego de RL no podemos hacer fallos"). Escrito ANTES del código.
// - spec/04 §9.7 (corrección P0): threadNote con "los dos" mira también gradientGamesPerCycle, y la parte de
//   evolución (y la evolución sola) usa como mucho 2·⌈population/2⌉ × gamesPerCandidate hilos.
// - spec/08 §12: "¿qué pasaría si…?" compara el candidato elegido por su modo, familia, expresión y ángulo, no por su
//   número; el formulario de entreno no manda los opcionales vacíos (dureza, fantasmas, ganancia mínima).
// Uso: node test/ui-arreglos-p0.spec.mjs
import { strict as assert } from 'node:assert';
const T = await import('../public/js/lab/training.js');
const W = await import('../public/js/lab/whatif.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// ---------- hilos ----------
check('"los dos" con 2 partidas de gradiente por ciclo y lote 4, 8 hilos: se usan 2 (no 4) en la parte de gradiente', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 4 }, both: { gradientGamesPerCycle: 2 } }, 8, 'turbo');
  assert.ok(n, 'hay aviso');
  assert.deepEqual({ used: n.used, asked: n.asked }, { used: 2, asked: 8 });
  assert.match(n.text, /parte de gradiente se usan como mucho 2 de los 8 hilos/);
  assert.match(n.text, /en la de evolución, todos/, 'con 16 × 2 copias la evolución llena los 8');
});
check('"los dos" con 3 hilos y 2 partidas de gradiente por ciclo: avisa (se usan 2), aunque el lote sea de 4', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 4 }, both: { gradientGamesPerCycle: 2 } }, 3, 'turbo');
  assert.ok(n, 'hay aviso');
  assert.equal(n.used, 2);
});
check('"los dos": si la parte de evolución no llena los hilos, dice cuántos usa en vez de "todos"', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 2 }, evolution: { population: 2, gamesPerCandidate: 1 } }, 6, 'turbo');
  assert.equal(n.used, 2);
  assert.match(n.text, /en la de evolución, 2\b/);
  assert.doesNotMatch(n.text, /todos/);
});
check('evolución sola: 2 copias × 1 partida con 8 hilos → se usan 2; con población 3 son 4 copias (parejas antitéticas)', () => {
  const n = T.threadNote({ method: 'evolution', evolution: { population: 2, gamesPerCandidate: 1 } }, 8, 'turbo');
  assert.ok(n, 'hay aviso');
  assert.deepEqual({ used: n.used, asked: n.asked }, { used: 2, asked: 8 });
  assert.match(n.text, /2 de los 8 hilos/);
  assert.equal(T.threadNote({ method: 'evolution', evolution: { population: 3, gamesPerCandidate: 1 } }, 4, 'turbo'), null, '4 copias llenan 4 hilos');
  assert.equal(T.threadNote({ method: 'evolution', evolution: { population: 3, gamesPerCandidate: 1 } }, 5, 'turbo').used, 4);
});
check('evolución con los valores por defecto (16 × 2) y 8 hilos: nada que avisar', () => {
  assert.equal(T.threadNote({ method: 'evolution' }, 8, 'turbo'), null);
});

// ---------- formulario ----------
const form = (over = {}) => ({ netId: 'n1', mix: { antagonist: 0.6, hallOfFame: 0.25, self: 0.15 }, hard: 2, ghost: 0, speed: 'turbo', workers: 4, durationKind: 'games', games: 10, minutes: 10, window: 50, minGain: 0.02, soldiers: 'random', seed: '', exploiter: false, ...over });
check('dureza y fantasmas vacíos no se mandan (el servidor pone 2 y 0); con valor, sí (también 0)', () => {
  const b = T.trainingBody(form({ hard: '', ghost: '' })).body;
  assert.equal('hard' in b.opponents, false);
  assert.equal('ghost' in b.opponents, false);
  const c = T.trainingBody(form({ hard: '0', ghost: '0.2' })).body;
  assert.deepEqual([c.opponents.hard, c.opponents.ghost], [0, 0.2]);
});
check('meseta con la ganancia mínima vacía: no se manda (el servidor pone 0,02)', () => {
  const b = T.trainingBody(form({ durationKind: 'plateau', window: '20', minGain: '' })).body;
  assert.deepEqual(b.duration, { plateau: { window: 20 } });
});

// ---------- ¿qué pasaría si…? ----------
const cand = (i, family, expr, p, extra = {}) => ({ i, family, expr, p, mode: family === 'artillery' ? 'ode2' : 'function', angle: family === 'artillery' ? 30 : null, ...extra });
check('mismo candidato con otro número (la Imaginación cambió): misma elección', () => {
  const before = { chosen: 3, candidates: [cand(0, 'line', '0.1*x', 0.1), cand(3, 'sine', 'sin(x/3)', 0.6), cand(5, 'line', '0.3*x', 0.3)] };
  const after = { chosen: 1, candidates: [cand(0, 'line', '0.3*x', 0.2), cand(1, 'sine', 'sin(x/3)', 0.7), cand(2, 'parabola', 'x^2/50', 0.1)] };
  const c = W.compare(before, after);
  assert.equal(c.same, true);
  assert.deepEqual([c.before.i, c.after.i], [3, 1]);
});
check('mismo número, otro tiro: no es la misma elección', () => {
  const before = { chosen: 2, candidates: [cand(0, 'line', '0.1*x', 0.2), cand(1, 'line', '0.2*x', 0.2), cand(2, 'sine', 'sin(x/3)', 0.6)] };
  const after = { chosen: 2, candidates: [cand(0, 'line', '0.1*x', 0.2), cand(1, 'line', '0.2*x', 0.2), cand(2, 'parabola', 'x^2/50', 0.6)] };
  assert.equal(W.compare(before, after).same, false);
});
check('artillería: misma gravedad con otro ángulo no es la misma elección', () => {
  const before = { chosen: 0, candidates: [cand(0, 'artillery', '-0.05', 0.9, { angle: 30 }), cand(1, 'line', 'x', 0.1)] };
  const after = { chosen: 0, candidates: [cand(0, 'artillery', '-0.05', 0.9, { angle: 40 }), cand(1, 'line', 'x', 0.1)] };
  assert.equal(W.compare(before, after).same, false);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: arreglos de la interfaz)');
process.exitCode = fails ? 1 : 0;
