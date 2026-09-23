// Entreno: cuántos hilos se usan de verdad (M12, medido el 2026-09-23; spec/04 §9.7). Con gradiente (o "ambos") las
// partidas de un lote se juegan con los mismos pesos, así que corren a la vez como mucho `batchGames`; con evolución,
// todos. Lógica pura de public/js/lab/training.js (threadNote). Escrito ANTES del código.
// Uso: node test/ui-entreno-hilos.spec.mjs
import { strict as assert } from 'node:assert';
const T = await import('../public/js/lab/training.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('gradiente con más hilos que partidas por lote: se usan tantos como el lote, y se dice cómo usar más', () => {
  const n = T.threadNote({ method: 'gradient', gradient: { batchGames: 4 } }, 8, 'turbo');
  assert.deepEqual({ used: n.used, asked: n.asked }, { used: 4, asked: 8 });
  assert.match(n.text, /4 de los 8 hilos/);
  assert.match(n.text, /Partidas por lote/);
  assert.match(n.text, /evolución/);
});

check('"ambos" se limita igual que el gradiente; evolución usa todos; hasta el lote, sin aviso', () => {
  assert.equal(T.threadNote({ method: 'both', gradient: { batchGames: 2 } }, 6, 'turbo').used, 2);
  assert.equal(T.threadNote({ method: 'evolution', gradient: { batchGames: 4 } }, 8, 'turbo'), null);
  assert.equal(T.threadNote({ method: 'gradient', gradient: { batchGames: 4 } }, 4, 'turbo'), null);
  assert.equal(T.threadNote({ method: 'gradient', gradient: { batchGames: 8 } }, 8, 'turbo'), null);
});

check('fuera de turbo los hilos no cuentan; sin datos de aprendizaje, el lote por defecto (4)', () => {
  assert.equal(T.threadNote({ method: 'gradient', gradient: { batchGames: 4 } }, 8, 'x10'), null);
  assert.equal(T.threadNote(null, 8, 'turbo').used, 4);
  assert.equal(T.threadNote({}, 8, 'turbo').used, 4);
  assert.equal(T.threadNote({ method: 'gradient' }, '6', 'turbo').asked, 6);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (entreno: hilos que se usan)');
process.exitCode = fails ? 1 : 0;
