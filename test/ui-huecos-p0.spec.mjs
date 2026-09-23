// Auditoría P0 (2026-09-23): mutantes de la parte 4 que se dieron por equivalentes y no lo eran (spec/mutantes.md,
// "Parte 4"). El código ya existe y es correcto: este test cierra cobertura contra el contrato de cada función.
// - model.setParam cambia un ajuste y deja los demás del bloque como estaban (si no, al cambiar las neuronas se
//   perdería la activación).
// - training.trainingBody acepta y rechaza en los mismos límites que el servidor (spec/04 §6, spec/08 §10.2): hilos
//   1–32, soldados 1–4 o al azar, semilla 0 … 2³¹−1, partidas ≥ 1, ventana de meseta ≥ 1, minutos > 0, y una mezcla
//   de rivales con un solo tipo distinto de cero es válida.
// - whatif: la certeza con dos candidatos es la diferencia entre los dos; "Ponla a jugar" se cumple con una partida.
// Uso: node test/ui-huecos-p0.spec.mjs
import { strict as assert } from 'node:assert';
const M = await import('../public/js/lab/model.js');
const T = await import('../public/js/lab/training.js');
const W = await import('../public/js/lab/whatif.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('setParam: cambia solo ese ajuste; los demás del bloque siguen igual', () => {
  const g = { blocks: [{ id: 'd', type: 'dense', params: { units: 32, activation: 'tanh', dropout: 0.1 } }], wires: [] };
  const units = { key: 'units', type: 'int', min: 1, max: 512 };
  const out = M.setParam(g, 'd', units, '16');
  assert.deepEqual(out.blocks[0].params, { units: 16, activation: 'tanh', dropout: 0.1 });
  assert.deepEqual(g.blocks[0].params, { units: 32, activation: 'tanh', dropout: 0.1 }, 'el original no cambia');
});

const form = (over = {}) => ({ netId: 'n1', mix: { antagonist: 0.6, hallOfFame: 0.25, self: 0.15 }, hard: 2, ghost: 0, speed: 'turbo', workers: 4, durationKind: 'games', games: 10, minutes: 10, window: 50, minGain: 0.02, soldiers: 'random', seed: '', exploiter: false, ...over });
const ok = (f) => { const r = T.trainingBody(f); assert.deepEqual(r.errors, [], JSON.stringify(f)); return r.body; };
const bad = (f) => { const r = T.trainingBody(f); assert.ok(r.errors.length > 0 && r.body === null, `debería rechazar ${JSON.stringify(f)}`); };

check('hilos: 1 y 32 valen; 0 y 33 no (solo en turbo)', () => {
  assert.equal(ok(form({ workers: 1 })).workers, 1);
  assert.equal(ok(form({ workers: 32 })).workers, 32);
  bad(form({ workers: 0 })); bad(form({ workers: 33 }));
});
check('soldados: 1 y 4 valen; 0 y 5 no; "random" vale', () => {
  assert.equal(ok(form({ soldiers: '1' })).soldiers, 1);
  assert.equal(ok(form({ soldiers: '4' })).soldiers, 4);
  assert.equal(ok(form({ soldiers: 'random' })).soldiers, 'random');
  bad(form({ soldiers: '0' })); bad(form({ soldiers: '5' }));
});
check('semilla: 0 y 2147483647 valen; −1 y 2147483648 no; vacía = al azar (no se manda)', () => {
  assert.equal(ok(form({ seed: '0' })).seed, 0);
  assert.equal(ok(form({ seed: '2147483647' })).seed, 2147483647);
  bad(form({ seed: '-1' })); bad(form({ seed: '2147483648' }));
  assert.equal('seed' in ok(form({ seed: '' })), false);
});
check('duración: 1 partida vale y 0 no; ventana de meseta 1 vale y 0 no; minutos 0,5 valen y 0 no', () => {
  assert.deepEqual(ok(form({ games: '1' })).duration, { games: 1 });
  bad(form({ games: '0' }));
  assert.equal(ok(form({ durationKind: 'plateau', window: '1', minGain: '0.01' })).duration.plateau.window, 1);
  bad(form({ durationKind: 'plateau', window: '0' }));
  assert.deepEqual(ok(form({ durationKind: 'minutes', minutes: '0.5' })).duration, { minutes: 0.5 });
  bad(form({ durationKind: 'minutes', minutes: '0' }));
});
check('mezcla de rivales: un solo tipo distinto de cero vale (solo sala de la fama, solo ella misma)', () => {
  assert.deepEqual(ok(form({ mix: { antagonist: 0, hallOfFame: 1, self: 0 } })).opponents, { antagonist: 0, hallOfFame: 1, self: 0, hard: 2, ghost: 0 });
  ok(form({ mix: { antagonist: 0, hallOfFame: 0, self: 1 } }));
  bad(form({ mix: { antagonist: 0, hallOfFame: 0, self: 0 } }));
});

const dec = (ps, chosen) => ({ chosen, candidates: ps.map((p, i) => ({ i, p, family: 'line', expr: `${i}*x` })) });
check('whatif: con dos candidatos, la certeza es la diferencia entre los dos', () => {
  const c = W.compare(dec([0.7, 0.3], 0), dec([0.55, 0.45], 0));
  assert.ok(Math.abs(c.before.certainty - 0.4) < 1e-12 && Math.abs(c.after.certainty - 0.1) < 1e-12, JSON.stringify(c));
});
check('primeros pasos: "Ponla a jugar" se cumple en cuanto una red ha jugado una partida', () => {
  const steps = W.tutorialSteps({ nets: [{ id: 'a', stats: { games: 1 } }] });
  assert.equal(steps[1].done, true);
  assert.equal(W.tutorialSteps({ nets: [{ id: 'a', stats: { games: 0 } }] })[1].done, false);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: huecos de la parte 4)');
process.exitCode = fails ? 1 : 0;
