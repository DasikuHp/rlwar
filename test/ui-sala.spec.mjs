// Sala viva con redes (parte 4, spec/prompt-opus-ui.md §3.1; spec/08 §3, spec/03 §7, spec/07 §2–§4): lógica pura
// de public/js/live.js. Qué se pinta de una decisión (candidatos tenues y la elegida en firme; en la fase de mover, los
// destinos), los candidatos más probables (la elegida siempre visible), la atribución y la frase "miraba sobre todo…",
// que tiene que pasar truth.checkPhrase contra la propia decisión. Escrito ANTES del código.
// Uso: node test/ui-sala.spec.mjs
import { strict as assert } from 'node:assert';
const L = await import('../public/js/live.js');
const { compose, checkPhrase } = await import('../evo/truth.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const pts = (k) => [[-10, k], [0, k + 1], [10, k + 2]];
const shoot = {
  soldierId: 's1', turn: 3, phase: 'shoot', netId: 'lince',
  candidates: [
    { i: 0, family: 'line', expr: '0.1*x', p: 0.1, score: 0.1, points: pts(0) },
    { i: 1, family: 'sine', expr: 'sin(x/3)', p: 0.5, score: 0.5, points: pts(1) },
    { i: 2, family: 'parabola', expr: '0.02*x^2', p: 0.3, score: 0.3, points: pts(2) },
    { i: 3, family: 'wild', expr: '2*tan(x/6)', p: 0.05, score: 0.05, points: pts(3) },
    { i: 4, family: 'ode1', expr: 'sin(x/6)', p: 0.05, score: 0.05, points: pts(4) },
  ],
  chosen: 2, margin: -0.2,
  attribution: [{ blockId: 'f', name: 'Rasgos', drop: 0.0123, share: 0.25 }, { blockId: 'c', name: 'Candidatos', drop: 0.0371, share: 0.75 }, { blockId: 'm', name: 'Destinos', drop: -0.002, share: 0 }],
  confidence: { certainty: 0.2, experience: 0.4, recentAccuracy: 0.5, confidence: 0.08, level: 'novata', sayProbability: 0.3 },
  eventId: 41,
};
const move = { soldierId: 's1', turn: 4, phase: 'move', netId: 'lince', chosenMove: 6, moves: Array.from({ length: 9 }, (_, i) => ({ i, to: { x: i, y: -i }, stay: i === 0, p: i === 6 ? 0.6 : 0.05, score: 0 })), eventId: 44 };

check('dibujo de un disparo: los candidatos tenues (más probable, más visible y encima) y la elegida en firme', () => {
  const o = L.overlay(shoot);
  assert.equal(o.kind, 'shoot');
  assert.deepEqual(o.chosen, { i: 2, points: pts(2), p: 0.3 });
  assert.deepEqual(o.faint.map((c) => c.i), [3, 4, 0, 1], 'de menos a más probable (la última se pinta encima)');
  for (let k = 1; k < o.faint.length; k++) assert.ok(o.faint[k].alpha >= o.faint[k - 1].alpha);
  assert.ok(o.faint.every((c) => c.alpha >= 0.08 && c.alpha <= 0.6), 'tenues de verdad');
  assert.deepEqual(o.faint.find((c) => c.i === 1).points, pts(1));
});

check('sin puntos (sala sin pantalla) no hay nada que pintar; sin decisión, null', () => {
  const headless = { ...shoot, candidates: shoot.candidates.map(({ points, ...c }) => c) };
  assert.deepEqual(L.overlay(headless), { kind: 'shoot', faint: [], chosen: null });
  assert.equal(L.overlay(null), null);
  assert.equal(L.overlay({ phase: 'shoot' }), null);
});

check('dibujo de un movimiento: los 9 destinos con su probabilidad y el elegido', () => {
  const o = L.overlay(move);
  assert.equal(o.kind, 'move');
  assert.equal(o.spots.length, 9);
  assert.deepEqual(o.spots[6], { i: 6, x: 6, y: -6, p: 0.6, stay: false });
  assert.equal(o.chosen, 6);
});

check('candidatos más probables: ordenados por probabilidad y la elegida siempre en la lista', () => {
  assert.deepEqual(L.topCandidates(shoot, 3).map((c) => [c.i, c.chosen]), [[1, false], [2, true], [0, false]]);
  const low = { ...shoot, chosen: 3 };
  const top = L.topCandidates(low, 2);
  assert.deepEqual(top.map((c) => c.i), [1, 2, 3], 'la elegida (improbable) se añade al final');
  assert.deepEqual(top[2], { i: 3, family: 'wild', expr: '2*tan(x/6)', p: 0.05, chosen: true });
  assert.deepEqual(L.topCandidates({ phase: 'move' }), []);
});

check('atribución: bloques por peso (share) con su caída, sin inventar nada', () => {
  assert.deepEqual(L.attributionRows(shoot), [
    { blockId: 'c', name: 'Candidatos', share: 0.75, drop: 0.0371 },
    { blockId: 'f', name: 'Rasgos', share: 0.25, drop: 0.0123 },
    { blockId: 'm', name: 'Destinos', share: 0, drop: -0.002 },
  ]);
  assert.deepEqual(L.attributionRows(move), []);
});

check('frase "miraba sobre todo…": se compone con truth.compose y pasa checkPhrase contra la decisión', () => {
  const ref = { game: 'g-1', id: 41 };
  const f = L.attributionPhrase(shoot, ref);
  const c = compose(f.template, f.slots);
  assert.equal(c.text, 'Miraba sobre todo Candidatos: sin ese ojo, la #2 perdería 0.04 de probabilidad.');
  assert.deepEqual(c.refs, [ref]);
  const events = { 41: { id: 41, turn: 3, type: 'decision', data: shoot } };
  const load = (r) => (r.game === 'g-1' ? events[r.id] : null);
  assert.deepEqual(checkPhrase(c, load), { ok: true, missing: { numbers: [], names: [] } });
  // si la caída redondeada es 0.00, la frase no la dice
  const tiny = { ...shoot, attribution: [{ blockId: 'c', name: 'Candidatos', drop: 0.004, share: 1 }] };
  const t = compose(L.attributionPhrase(tiny, ref).template, L.attributionPhrase(tiny, ref).slots);
  assert.equal(t.text, 'Miraba sobre todo Candidatos.');
  assert.ok(checkPhrase(t, (r) => ({ id: 41, data: tiny })).ok);
  // nadie pesa (todas las caídas ≤ 0) o no hay atribución: no hay frase
  assert.equal(L.attributionPhrase({ ...shoot, attribution: [{ blockId: 'c', name: 'Candidatos', drop: -0.1, share: 0 }] }, ref), null);
  assert.equal(L.attributionPhrase(move, ref), null);
});

check('confianza: nivel con su nombre y las cifras tal cual', () => {
  assert.deepEqual(L.confidenceView(shoot.confidence), { level: 'novata', label: 'novata', certainty: 0.2, experience: 0.4, confidence: 0.08 });
  assert.equal(L.confidenceView({ level: 'veterana', certainty: 1, experience: 1, confidence: 1 }).label, 'veterana');
  assert.equal(L.confidenceView(null), null);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (sala viva: lógica)');
process.exitCode = fails ? 1 : 0;
