// Etapa 1 · Crear (P6, sesión 10): la guía «Tu primera red» (coach.js) y "+ Añadir capa" sobre un cable (model.js,
// hints.js). La guía va paso a paso sobre la red de verdad: cada paso se cumple con el genoma (o con lo que hace quien
// juega: apostar, cambiar de escena, guardar y probar) y el "Hazlo por mí" de cada paso lo cumple de verdad.
// Uso: node test/ui-coach.spec.mjs
import { strict as assert } from 'node:assert';
const { catalog } = await import('../evo/api.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { newGenome, validate } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const M = await import('../public/js/lab/model.js');
const H = await import('../public/js/lab/hints.js');
const Co = await import('../public/js/lab/coach.js');

const CAT = catalog();
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));
const blank = () => newGenome({ id: 'mi-red', name: 'Mi red', blocks: [], wires: [] }, makeRng(1));
const ctx = (g, extra = {}) => ({ readiness: H.readiness(g, CAT), scene: 'abierto', ...extra });
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const idOf = (g, t) => (g.blocks.find((b) => b.type === t) || {}).id;

// ---------- añadir capa sobre un cable ----------
check('insertOnWire: A → B pasa a A → nuevo → B y B conserva el orden de sus entradas', () => {
  const g = tpl('sniper'); // d recibe f (cable 0) y c (cable 1)
  const i = g.wires.findIndex((w) => w.from === 'c' && w.to === 'd');
  const r = M.insertOnWire(g, i, 'dense', CAT);
  assert.equal(r.error, null);
  assert.deepEqual(r.genome.wires[i], { from: r.id, to: 'd' });
  assert.ok(r.genome.wires.some((w) => w.from === 'c' && w.to === r.id));
  assert.ok(!r.genome.wires.some((w) => w.from === 'c' && w.to === 'd'));
  const into = (gg) => gg.wires.filter((w) => w.to === 'd').map((w) => w.from);
  assert.deepEqual(into(r.genome), ['f', r.id]);
  assert.equal(validate({ ...r.genome, weights: {} }).errors.filter((e) => !String(e.code).startsWith('weights-')).length, 0);
  assert.match(M.insertOnWire(g, 99, 'dense', CAT).error, /ya no existe/);
});
check('insertOptions: una memoria cabe en un cable de contexto pero no en el de candidatos, y dice por qué', () => {
  const g = tpl('sniper');
  const ctxWire = g.wires.findIndex((w) => w.from === 'f'), candWire = g.wires.findIndex((w) => w.from === 'c');
  const at = (i, t) => H.insertOptions(g, CAT, i, 'cientifico').find((o) => o.type === t);
  assert.ok(at(ctxWire, 'gru').ok);
  assert.ok(!at(candWire, 'gru').ok);
  assert.match(at(candWire, 'gru').why, /contexto/);
  assert.ok(at(candWire, 'dense').ok);
  assert.ok(H.insertOptions(g, CAT, candWire, 'aprendiz').every((o) => ['instinct', 'memory'].includes(o.group)));
});

// ---------- la guía ----------
check('red vacía: la guía empieza en el paso 1 (Candidatos) y no da nada por hecho', () => {
  const st = Co.coachState(blank(), ctx(blank()), []);
  assert.equal(st.i, 0); assert.equal(st.step.key, 'ojos'); assert.equal(st.finished, false);
  assert.ok(Co.helpOffered(0) && Co.helpOffered(2) && !Co.helpOffered(3), 'la ayuda completa se retira tras los tres primeros');
});
check('recorrido entero con "Hazlo por mí" (lo que haría el editor): cada paso se cumple y la red queda lista para jugar', () => {
  let g = blank(), marked = [];
  const extra = {};
  const id = (t) => idOf(g, t);
  for (let guard = 0; guard < 20; guard++) {
    const st = Co.coachState(g, ctx(g, extra), marked);
    marked = st.doneKeys;
    if (st.finished) break;
    const h = st.step.help;
    if (st.step.bet) { extra.bet = 'no'; continue; }
    if (!h) { extra.saved = true; extra.probed = true; continue; }
    if (h.scene) { extra.scene = h.scene; continue; }
    for (const t of h.add || []) if (!id(t)) g = M.addBlock(g, t, CAT).genome;
    const thinkId = () => { const ch = id('hand.choose'); const w = g.wires.find((x) => x.to === ch && (g.blocks.find((z) => z.id === x.from) || {}).type === 'dense'); return w && w.from; };
    for (const pair of [h.wire, h.wire2].filter(Boolean)) {
      const A = id(pair[0]), B = pair[1] === 'dense' ? thinkId() : id(pair[1]);
      const r = M.connect(g, A, B); assert.equal(r.error, null, `${pair}`); g = r.genome;
    }
    if (h.insert) { const ch = id('hand.choose'); const i = g.wires.findIndex((w) => w.to === ch); g = M.insertOnWire(g, i, h.insert, CAT).genome; }
    const after = Co.coachState(g, ctx(g, extra), marked);
    assert.ok(after.doneKeys.includes(st.step.key), `"Hazlo por mí" no cumple el paso ${st.step.key}`);
  }
  const end = Co.coachState(g, ctx(g, extra), marked);
  assert.ok(end.finished, `acaba en ${end.step && end.step.key}`);
  assert.deepEqual(end.doneKeys, Co.STEPS.map((s) => s.key));
  assert.ok(H.readiness(g, CAT).every((r) => r.ok), 'todo lo recomendable, hecho');
  assert.equal(validate({ ...g, weights: {} }, { forPlay: true }).errors.filter((e) => !String(e.code).startsWith('weights-')).length, 0);
});
check('un paso hecho se queda hecho: quitar Candidatos después no hace volver a la guía', () => {
  let g = blank();
  g = M.addBlock(g, 'eye.candidates', CAT).genome;
  const st = Co.coachState(g, ctx(g), []);
  assert.deepEqual(st.doneKeys, ['ojos']);
  const g2 = M.removeBlock(g, idOf(g, 'eye.candidates'));
  assert.equal(Co.coachState(g2, ctx(g2), st.doneKeys).step.key, 'manos');
});
check('en orden: una red de plantilla completa se salta lo que ya tiene, pero se para en la apuesta', () => {
  const g = tpl('turtle');
  const st = Co.coachState(g, ctx(g), []);
  assert.equal(st.step.key, 'apuesta');
  assert.deepEqual(st.doneKeys, ['ojos', 'manos', 'cable']);
});
check('lo que explica cada paso sale de los números reales que le pasa el editor', () => {
  const s = (k) => Co.STEPS.find((x) => x.key === k);
  assert.match(s('ojos').after({ cands: 24, candDim: 12 }), /24 tiros.*12 números/);
  assert.match(s('apuesta').after({ bet: 'no', pick: { certainty: 0.031 } }), /certeza es 0,03/);
  assert.match(s('pensar').after({ think: 32 }), /32 neuronas/);
  for (const k of Co.STEPS) { assert.ok(k.ask.length > 20 && k.todo.length > 5, k.key); assert.equal(typeof k.after({}), 'string'); }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (guía «Tu primera red» y añadir capa sobre un cable)');
process.exitCode = fails ? 1 : 0;
