// Entreno, hilos (M12): lo que dejó la pasada de mutantes sobre threadNote (spec/04 §9.7). Un lote de 1 partida usa
// 1 hilo, y con "los dos" el aviso dice que el límite es solo en la parte de gradiente (en la de evolución se usan todos).
// Lógica pura de public/js/lab/training.js. Uso: node test/ui-entreno-hilos-b.spec.mjs
import { strict as assert } from 'node:assert';
const T = await import('../public/js/lab/training.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('lote de 1 partida con 4 hilos: se usa 1', () => {
  const n = T.threadNote({ method: 'gradient', gradient: { batchGames: 1 } }, 4, 'turbo');
  assert.deepEqual({ used: n.used, asked: n.asked }, { used: 1, asked: 4 });
  assert.match(n.text, /1 de los 4 hilos/);
});

check('"los dos": el límite es de la parte de gradiente; con gradiente solo, no se habla de partes', () => {
  const both = T.threadNote({ method: 'both', gradient: { batchGames: 2 } }, 6, 'turbo');
  assert.match(both.text, /parte de gradiente/);
  assert.match(both.text, /2 de los 6 hilos/);
  assert.match(both.text, /en la de evolución, todos/);
  const grad = T.threadNote({ method: 'gradient', gradient: { batchGames: 2 } }, 6, 'turbo');
  assert.doesNotMatch(grad.text, /parte de gradiente/);
  assert.doesNotMatch(grad.text, /en la de evolución, todos/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (entreno: hilos, casos extra)');
process.exitCode = fails ? 1 : 0;
