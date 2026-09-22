// Arreglo A4 (spec/07 §13.1; spec/revision-opus.md A4): el boletín mide lo que dice.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-boletin.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const clone = (v) => JSON.parse(JSON.stringify(v));

const exam = await import('../evo/exam.js');
const { TEMPLATES } = await import('../shared/templates.js');

await check('adaptationScore = tasa media × (1 − (máx − mín)): perder todo da 0; ganar igual con todos los tamaños da esa tasa', () => {
  assert.equal(typeof exam.adaptationScore, 'function');
  assert.equal(exam.adaptationScore({ 1: 0, 2: 0, 3: 0, 4: 0 }), 0);
  assert.ok(near(exam.adaptationScore({ 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 }), 0.5));
  assert.ok(near(exam.adaptationScore({ 1: 1, 2: 1, 3: 1, 4: 1 }), 1));
  assert.equal(exam.adaptationScore({ 1: 1, 2: 0, 3: 0, 4: 0 }), 0, 'solo gana con 1 soldado: nada adaptada');
  assert.ok(near(exam.adaptationScore({ 1: 0.75, 2: 0.5, 3: 0.5, 4: 0.25 }), 0.5 * 0.5));
  assert.ok(near(exam.adaptationScore({ 1: 0.25, 2: 0, 3: 0, 4: 0 }), 0.0625 * 0.75));
});

const subject = { ...clone(TEMPLATES.empty.genome), id: 'vacia-b', name: 'Vacía B' };
let bull = null;
await check('boletín de la red vacía: el blanco nunca le impide disparar (40 de 40) ni moverse (30 de 30)', async () => {
  bull = await exam.runBulletin(subject);
  assert.equal(bull.details.aim.length, 40);
  const noShot = bull.details.aim.filter((x) => x.result === null).map((x) => x.seed);
  assert.deepEqual(noShot, [], `escenas sin disparo del examinado: ${noShot}`);
  const noMove = bull.details.cover.filter((x) => x.stayed === null).map((x) => x.seed);
  assert.deepEqual(noMove, [], `escenas sin movimiento: ${noMove}`);
});

await check('adaptación: 16 partidas, 4 por tamaño, 2 a cada lado, semillas 9004 + i; la nota sale de sus tasas', () => {
  const games = bull.details.adaptationGames;
  assert.ok(Array.isArray(games) && games.length === 16, `adaptationGames: ${games && games.length}`);
  games.forEach((g, i) => {
    assert.equal(g.seed, 9004 + i); assert.equal(g.soldiers, 1 + Math.floor(i / 4)); assert.equal(g.side, i % 2 === 0 ? 'left' : 'right');
    assert.ok(g.win === 0 || g.win === 1);
  });
  for (const n of [1, 2, 3, 4]) {
    const mine = games.filter((g) => g.soldiers === n);
    assert.equal(mine.filter((g) => g.side === 'left').length, 2); assert.equal(mine.filter((g) => g.side === 'right').length, 2);
    assert.ok(near(bull.details.adaptation[n], mine.reduce((s, g) => s + g.win, 0) / 4), `tasa con ${n}`);
  }
  assert.ok(near(bull.adaptation, exam.adaptationScore(bull.details.adaptation)));
});

await check('boletín determinista y con el tope correcto de escenas (96 en total)', async () => {
  let scenes = 0;
  const again = await exam.runBulletin(subject, { onScene: () => { scenes++; } });
  assert.equal(scenes, 96);
  assert.deepEqual({ aim: again.aim, cover: again.cover, survival: again.survival, adaptation: again.adaptation }, { aim: bull.aim, cover: bull.cover, survival: bull.survival, adaptation: bull.adaptation });
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: boletín)');
process.exitCode = fails ? 1 : 0;
