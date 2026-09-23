// Auditoría P0 (2026-09-23): lo que dejó la pasada de mutantes sobre el aviso de hilos nuevo (spec/04 §9.7,
// corrección P0). Casos en el límite exacto (hilos = tope) y con dos partidas por copia. Escrito después del código,
// como los demás "extra" que salen de los mutantes; prueba la spec, no el código.
// Uso: node test/ui-arreglos-p0-b.spec.mjs
import { strict as assert } from 'node:assert';
const T = await import('../public/js/lab/training.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('evolución con 2 partidas por copia: 4 copias × 2 = 8 hilos de tope; con 10 hilos se usan 8', () => {
  const n = T.threadNote({ method: 'evolution', evolution: { population: 4, gamesPerCandidate: 2 } }, 10, 'turbo');
  assert.deepEqual({ used: n.used, asked: n.asked }, { used: 8, asked: 10 });
  assert.match(n.text, /4 copias × 2 partidas/);
});
check('"los dos" con los hilos justo en el tope de cada parte: nada que avisar', () => {
  assert.equal(T.threadNote({ method: 'both', gradient: { batchGames: 2 }, both: { gradientGamesPerCycle: 16 }, evolution: { population: 16, gamesPerCandidate: 2 } }, 2, 'turbo'), null, 'justo en el tope del gradiente');
  assert.equal(T.threadNote({ method: 'both', gradient: { batchGames: 8 }, both: { gradientGamesPerCycle: 16 }, evolution: { population: 4, gamesPerCandidate: 1 } }, 4, 'turbo'), null, 'justo en el tope de la evolución');
});
check('"los dos": la evolución llena justo los hilos → "todos"; el gradiente, no → se avisa', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 1 }, evolution: { population: 4, gamesPerCandidate: 1 } }, 4, 'turbo');
  assert.equal(n.used, 1);
  assert.match(n.text, /en la de evolución, todos/);
});
check('"los dos": el gradiente llena justo los hilos y la evolución no → la parte de gradiente usa todos y no se explica el lote', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 4 }, both: { gradientGamesPerCycle: 16 }, evolution: { population: 2, gamesPerCandidate: 1 } }, 4, 'turbo');
  assert.equal(n.used, 2);
  assert.match(n.text, /parte de gradiente se usan los 4 hilos/);
  assert.doesNotMatch(n.text, /como mucho 4 de los 4|cada lote se juegan|cada ciclo solo/);
});
check('"los dos" con tantas partidas por ciclo como el lote: el motivo es el lote, no el ciclo', () => {
  const n = T.threadNote({ method: 'both', gradient: { batchGames: 4 }, both: { gradientGamesPerCycle: 4 } }, 8, 'turbo');
  assert.match(n.text, /las 4 partidas de cada lote se juegan con los mismos pesos/);
  assert.doesNotMatch(n.text, /cada ciclo solo/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: aviso de hilos, casos extra)');
process.exitCode = fails ? 1 : 0;
