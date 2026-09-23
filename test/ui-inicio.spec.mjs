// Laboratorio, vista de inicio (parte 4, spec/prompt-opus-ui.md §3.1; spec/06 §2, spec/08 §4): lógica pura de
// public/js/lab/home.js. Filas de redes (la reina primero, luego las campeonas, luego las más recientes; etiquetas y
// tasa de victorias solo con partidas), el reinado actual sacado del registro del trono, los últimos retos con las
// mismas palabras que el diario (spec/07 §12, M5) y duraciones legibles. Escrito ANTES del código.
// Uso: node test/ui-inicio.spec.mjs
import { strict as assert } from 'node:assert';
const H = await import('../public/js/lab/home.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const net = (id, extra = {}) => ({ id, name: id.toUpperCase(), emblem: 7, traits: {}, stats: { games: 0, wins: 0, kills: 0, deaths: 0, reigns: 0 }, generation: 0, paramCount: 100, blocks: 5, playable: true, updatedAt: 1000, isQueen: false, house: null, training: false, ...extra });
const throne = {
  queen: 'hydra', since: 5000,
  reigns: [{ netId: 'orca', from: 1000, to: 5000, defenses: 2, won: 2, lost: 1 }, { netId: 'hydra', from: 5000, to: null, defenses: 3, won: 3, lost: 0 }],
  challenges: [
    { id: 'c1', challenger: 'hydra', queen: 'orca', duelId: 'd1', result: 'queen', ts: 3000 },
    { id: 'c2', challenger: 'hydra', queen: 'orca', duelId: 'd2', result: 'challenger', ts: 5000 },
    { id: 'c3', challenger: 'lince', queen: 'hydra', duelId: 'd3', result: 'tie', ts: 6000 },
    { id: 'c4', challenger: 'lince', queen: 'hydra', duelId: 'd4', result: 'void', ts: 7000 },
  ],
  hallOfFame: [{ netId: 'orca', snapshot: 'nets/orca/hof-1.json', reignIdx: 0, reignGames: 3 }],
  league: { pairs: {} }, dynasties: { A: { name: 'Casa del Norte', champion: 'lince' }, B: null }, genealogy: {}, queenName: 'Hydra',
};

check('filas: la reina primero, después las campeonas de casa y después las más recientes', () => {
  const nets = [net('viejo', { updatedAt: 1 }), net('lince', { house: 'A', updatedAt: 5 }), net('nuevo', { updatedAt: 9 }), net('hydra', { isQueen: true, updatedAt: 2 })];
  assert.deepEqual(H.netRows(nets).map((r) => r.id), ['hydra', 'lince', 'nuevo', 'viejo']);
  assert.deepEqual(H.netRows([]), []);
});

check('filas: etiquetas con su significado (reina, campeona de la casa, entrenando, no puede jugar)', () => {
  const rows = H.netRows([net('a', { isQueen: true }), net('b', { house: 'B', training: true }), net('c', { playable: false })]);
  assert.deepEqual(rows.map((r) => r.tags), [['reina'], ['campeona de la casa B', 'entrenando'], ['no puede jugar']]);
});

check('filas: tasa de victorias solo si ha jugado; los números salen tal cual de la API', () => {
  const [a, b] = H.netRows([net('a', { stats: { games: 8, wins: 6, kills: 10, deaths: 4, reigns: 1 }, updatedAt: 2 }), net('b')]);
  assert.equal(a.winRate, 0.75); assert.equal(a.games, 8); assert.equal(a.wins, 6); assert.equal(a.kills, 10); assert.equal(a.deaths, 4);
  assert.equal(b.winRate, null, 'sin partidas no hay tasa (no es 0 %)');
  assert.equal(a.paramCount, 100); assert.equal(a.generation, 0); assert.equal(a.name, 'A');
  const noStats = H.netRows([net('c', { stats: undefined })])[0];
  assert.deepEqual([noStats.games, noStats.wins, noStats.winRate], [0, 0, null]);
});

check('reinado actual: el abierto de la reina (defensas, ganados, perdidos, desde cuándo); sin reina, null', () => {
  assert.deepEqual(H.reignOf(throne, 9000), { queen: 'hydra', queenName: 'Hydra', since: 5000, ms: 4000, defenses: 3, won: 3, lost: 0, number: 2 });
  assert.equal(H.reignOf({ ...throne, queen: null, since: null }, 9000), null);
  assert.equal(H.reignOf({ queen: 'x', since: 1, reigns: [] }, 5).defenses, 0, 'sin registro de reinado, a cero');
});

check('últimos retos: el más reciente primero, con las palabras del diario (M5)', () => {
  const list = H.lastChallenges(throne, 3);
  assert.deepEqual(list.map((c) => c.id), ['c4', 'c3', 'c2']);
  assert.deepEqual(list.map((c) => c.text), ['reto anulado', 'empate, la reina conserva el trono', 'ganó la retadora']);
  assert.equal(H.lastChallenges(throne, 10).at(-1).text, 'la reina defendió el trono');
  assert.deepEqual(H.lastChallenges({ challenges: [] }), []);
  assert.deepEqual(list[0], { id: 'c4', challenger: 'lince', queen: 'hydra', duelId: 'd4', result: 'void', ts: 7000, text: 'reto anulado' });
});

check('duraciones legibles: segundos, minutos, horas y días', () => {
  assert.equal(H.duration(0), 'menos de 1 min');
  assert.equal(H.duration(59_000), 'menos de 1 min');
  assert.equal(H.duration(60_000), '1 min');
  assert.equal(H.duration(3 * 3600_000 + 12 * 60_000 + 5_000), '3 h 12 min');
  assert.equal(H.duration(2 * 86400_000 + 5 * 3600_000), '2 d 5 h');
  assert.equal(H.duration(86400_000), '1 d');
  assert.equal(H.duration(-5), 'menos de 1 min');
});

check('casas: fundadas o no, con su campeona', () => {
  assert.deepEqual(H.housesOf(throne), [{ key: 'A', name: 'Casa del Norte', champion: 'lince' }, { key: 'B', name: null, champion: null }]);
  assert.deepEqual(H.housesOf({}), [{ key: 'A', name: null, champion: null }, { key: 'B', name: null, champion: null }]);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (laboratorio: inicio)');
process.exitCode = fails ? 1 : 0;
