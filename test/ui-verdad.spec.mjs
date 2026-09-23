// Verdad (parte 4, spec/prompt-opus-ui.md §3.1; spec/07 §6, §7, §9, §12.5–§12.8): lógica pura de
// public/js/lab/truthview.js. El radar del boletín (4 ejes, valores recortados a 0..1), los turnos de la moviola en que
// decidió una red, las activaciones de la fila que importa (la candidata elegida, el destino elegido), los rivales de
// la memoria y sus últimos recuerdos. Escrito ANTES del código. Uso: node test/ui-verdad.spec.mjs
import { strict as assert } from 'node:assert';
const V = await import('../public/js/lab/truthview.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

check('radar: puntería arriba, cobertura a la derecha, supervivencia abajo, adaptación a la izquierda', () => {
  const r = V.radar({ aim: 1, cover: 0.5, survival: 0.25, adaptation: 0 }, { cx: 100, cy: 100, r: 80 });
  assert.deepEqual(r.axes.map((a) => a.key), ['aim', 'cover', 'survival', 'adaptation']);
  const p = r.axes.map((a) => [a.x, a.y]);
  assert.ok(near(p[0][0], 100) && near(p[0][1], 20), `puntería ${p[0]}`);
  assert.ok(near(p[1][0], 140) && near(p[1][1], 100), `cobertura ${p[1]}`);
  assert.ok(near(p[2][0], 100) && near(p[2][1], 120), `supervivencia ${p[2]}`);
  assert.ok(near(p[3][0], 100) && near(p[3][1], 100), `adaptación ${p[3]}`);
  assert.equal(r.polygon, '100,20 140,100 100,120 100,100');
  assert.deepEqual(r.axes.map((a) => a.value), [1, 0.5, 0.25, 0]);
  assert.deepEqual(r.axes.map((a) => a.label), ['puntería', 'cobertura', 'supervivencia', 'adaptación']);
});

check('radar: valores fuera de 0..1 o que faltan se recortan (el número real se sigue mostrando aparte)', () => {
  const r = V.radar({ aim: 1.4, cover: -0.2 }, { cx: 0, cy: 0, r: 10 });
  assert.deepEqual(r.axes.map((a) => a.value), [1, 0, 0, 0]);
  assert.deepEqual(r.axes.map((a) => a.raw), [1.4, -0.2, null, null]);
});

const game = {
  events: [
    { id: 1, turn: 0, type: 'game.start', actor: {}, data: {} },
    { id: 2, turn: 0, type: 'decision', actor: { playerId: 'p1', soldierId: 's1', netId: 'hydra' }, data: { phase: 'shoot' } },
    { id: 3, turn: 0, type: 'shot', actor: { playerId: 'p1', soldierId: 's1', netId: 'hydra' }, data: {} },
    { id: 4, turn: 1, type: 'decision', actor: { playerId: 'p1', soldierId: 's1', netId: 'hydra' }, data: { phase: 'move' } },
    { id: 5, turn: 1, type: 'decision', actor: { playerId: 'p2', soldierId: 's2', netId: 'orca' }, data: { phase: 'shoot' } },
    { id: 6, turn: 1, type: 'decision', actor: { playerId: 'p1', soldierId: 's1', netId: 'hydra' }, data: { phase: 'shoot', truncated: true } },
  ],
};
check('moviola: las decisiones de la red en la partida, en orden, sin las recortadas por el tope', () => {
  assert.deepEqual(V.netTurns(game, 'hydra'), [
    { turn: 0, phase: 'shoot', eventId: 2, playerId: 'p1', soldierId: 's1' },
    { turn: 1, phase: 'move', eventId: 4, playerId: 'p1', soldierId: 's1' },
  ]);
  assert.deepEqual(V.netTurns(game, 'orca').map((t) => t.eventId), [5]);
  assert.deepEqual(V.netTurns({ events: [] }, 'x'), []);
});

check('activaciones: de cada bloque la fila que importa (elegida o destino elegido), normalizadas por su máximo absoluto', () => {
  const acts = { f: [0.5, -1, 0.25], c: [[0, 1], [2, -4], [1, 1]], m: [[1], [2], [3], [4], [5], [6], [7], [8], [9]] };
  const shoot = V.activationRows(acts, { phase: 'shoot', chosen: 1, candidates: [{}, {}, {}] });
  assert.deepEqual(shoot.find((r) => r.blockId === 'f'), { blockId: 'f', row: null, values: [0.5, -1, 0.25], norm: [0.5, 1, 0.25], max: 1 });
  assert.deepEqual(shoot.find((r) => r.blockId === 'c'), { blockId: 'c', row: 1, values: [2, -4], norm: [0.5, 1], max: 4 });
  const move = V.activationRows(acts, { phase: 'move', chosenMove: 6, moves: new Array(9).fill({}) });
  assert.deepEqual(move.find((r) => r.blockId === 'm'), { blockId: 'm', row: 6, values: [7], norm: [1], max: 7 });
  assert.equal(move.find((r) => r.blockId === 'c').row, 0, 'filas que no son de destinos: la primera');
  assert.deepEqual(V.activationRows({ z: [0, 0] }, {}).find((r) => r.blockId === 'z').norm, [0, 0], 'todo cero no divide entre cero');
});

check('memoria: rivales por partidas jugadas y los recuerdos más recientes primero', () => {
  const mem = {
    rivals: { orca: { games: 3, wins: 1, killsBy: 2, killsOf: 1, pride: 1, grudge: 2, respect: 0.67 }, lince: { games: 5, wins: 4, killsBy: 0, killsOf: 5, pride: 3, grudge: 0, respect: 0.2 } },
    episodes: [{ ref: { game: 'g1', id: 3 }, gamesAgo: 4, outcome: 'kill' }, { ref: { game: 'g2', id: 7 }, gamesAgo: 0, outcome: 'death' }, { ref: { game: 'g1', id: 9 }, gamesAgo: 4, outcome: 'graze' }],
    recentShots: [1, 0, 0, 1],
  };
  assert.deepEqual(V.rivalRows(mem).map((r) => r.rivalId), ['lince', 'orca']);
  assert.deepEqual(V.rivalRows(mem)[1], { rivalId: 'orca', games: 3, wins: 1, killsBy: 2, killsOf: 1, pride: 1, grudge: 2, respect: 0.67 });
  assert.deepEqual(V.lastEpisodes(mem, 2).map((e) => e.ref.id), [7, 9], 'menos partidas atrás primero; empate, el más reciente del registro');
  assert.deepEqual(V.rivalRows({}), []);
  assert.deepEqual(V.lastEpisodes(null, 5), []);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (verdad: lógica)');
process.exitCode = fails ? 1 : 0;
