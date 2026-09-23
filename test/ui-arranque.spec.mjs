// Ayudas de arranque (plan2 ronda 4 ✅; spec/08 §9.1 whatif): lógica pura de public/js/lab/whatif.js. Las escenas
// congeladas del "¿qué pasaría si…?" (dentro del plano y válidas para POST /nets/:id/whatif), la comparación entre la
// red guardada y la que se edita, y los primeros pasos con su avance sacado de datos reales. Escrito ANTES del código.
// Uso: node test/ui-arranque.spec.mjs
import { strict as assert } from 'node:assert';
const W = await import('../public/js/lab/whatif.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('escenas: al menos 3, con nombre, soldados dentro del plano, obstáculos válidos y quien decide a la izquierda', () => {
  assert.ok(W.SCENES.length >= 3);
  for (const s of W.SCENES) {
    assert.ok(s.key && s.name && s.explain, s.key);
    assert.ok(s.scene.soldiers.length >= 2 && s.scene.soldiers.length <= 32);
    for (const x of s.scene.soldiers) {
      assert.ok(typeof x.id === 'string' && ['left', 'right'].includes(x.team), `${s.key} ${x.id}`);
      assert.ok(Math.abs(x.x) <= 25 && Math.abs(x.y) <= 15, `${s.key} ${x.id} fuera del plano`);
    }
    for (const o of s.scene.obstacles) assert.ok([o.x, o.y, o.w, o.h].every(Number.isFinite) && o.w > 0 && o.h > 0, s.key);
    const me = s.scene.soldiers.find((x) => x.id === s.scene.soldierId);
    assert.ok(me && me.team === 'left', `${s.key}: quien decide`);
    assert.ok(s.scene.soldiers.some((x) => x.team === 'right'), `${s.key}: hay enemigos`);
  }
  assert.equal(new Set(W.SCENES.map((s) => s.key)).size, W.SCENES.length, 'claves únicas');
});

check('cuerpo de whatif: escena, fase y semilla; con genoma solo si se da', () => {
  const s = W.SCENES[0];
  assert.deepEqual(W.whatifBody(s, 'shoot', 7), { scene: s.scene, phase: 'shoot', seed: 7 });
  const g = { id: 'x' };
  assert.deepEqual(W.whatifBody(s, 'move', 1, g), { scene: s.scene, phase: 'move', seed: 1, genome: g });
});

const dec = (chosen, ps) => ({ phase: 'shoot', chosen, candidates: ps.map((p, i) => ({ i, p, family: i % 2 ? 'sine' : 'line', expr: `e${i}` })) });
check('comparar: misma elección o no, la elegida de cada una y lo decidida que estaba (favorita − segunda)', () => {
  const c = W.compare(dec(1, [0.125, 0.625, 0.25]), dec(2, [0.125, 0.125, 0.75]));
  assert.equal(c.same, false);
  assert.deepEqual(c.before, { i: 1, family: 'sine', expr: 'e1', p: 0.625, certainty: 0.375 });
  assert.deepEqual(c.after, { i: 2, family: 'line', expr: 'e2', p: 0.75, certainty: 0.625 });
  assert.equal(W.compare(dec(0, [1]), dec(0, [1])).same, true);
  assert.equal(W.compare(dec(0, [1]), dec(0, [1])).after.certainty, 1, 'un solo candidato: decidida del todo');
  assert.equal(W.compare(null, dec(0, [1])).before, null);
});

check('primeros pasos: el avance sale de los datos (redes, partidas jugadas, entrenos, reina)', () => {
  const none = W.tutorialSteps({ nets: [], trainings: [], throne: {} });
  assert.deepEqual(none.map((s) => s.done), [false, false, false, false]);
  assert.deepEqual(none.map((s) => s.href), ['#editor', '/', '#entreno', '#trono']);
  const some = W.tutorialSteps({ nets: [{ id: 'a', stats: { games: 0 } }], trainings: [], throne: { queen: null } });
  assert.deepEqual(some.map((s) => s.done), [true, false, false, false]);
  const all = W.tutorialSteps({ nets: [{ id: 'a', stats: { games: 3 } }], trainings: [{ id: 't1', status: 'done' }], throne: { queen: 'a' } });
  assert.deepEqual(all.map((s) => s.done), [true, true, true, true]);
  assert.ok(all.every((s) => s.title && s.text));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (ayudas de arranque: lógica)');
process.exitCode = fails ? 1 : 0;
