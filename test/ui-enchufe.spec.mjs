// Etapa 1 · Crear (sesión 12, spec/12 §5): enchufar y desenchufar cables con los gestos de Blender y Unreal
// (public/js/lab/plug.js). Lógica pura: qué coges al pulsar, dónde vale soltarlo y qué pasa al soltar.
// Uso: node test/ui-enchufe.spec.mjs
import { strict as assert } from 'node:assert';
const { catalog } = await import('../evo/api.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { newGenome, validate } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const M = await import('../public/js/lab/model.js');
const H = await import('../public/js/lab/hints.js');
const P = await import('../public/js/lab/plug.js');

const CAT = catalog();
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));
const blank = () => newGenome({ id: 'mi-red', name: 'Mi red', blocks: [], wires: [] }, makeRng(1));
const build = (types, wires) => {
  let g = blank();
  for (const t of types) g = M.addBlock(g, t, CAT).genome;
  return { ...g, wires: wires.map(([from, to]) => ({ from, to })) };
};
const errs = (g) => validate({ ...g, weights: {} }).errors.filter((e) => !String(e.code).startsWith('weights-'));
const ws = (g) => g.wires.map((w) => `${w.from}>${w.to}`).join(' ');
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// ---------- qué coges al pulsar ----------
check('grab: salida → cable nuevo; entrada vacía → cable nuevo al revés; entrada con cables → la punta del último', () => {
  const g = tpl('sniper'); // d recibe f (cable 0) y c (cable 1)
  assert.deepEqual(P.grab(g, CAT, { port: 'out', id: 'c' }), { kind: 'from', from: 'c' });
  assert.deepEqual(P.grab(g, CAT, { port: 'in', id: 'd' }), { kind: 'end', index: 1, from: 'c', to: 'd' });
  const e = build(['eye.candidates', 'hand.choose'], []);
  assert.deepEqual(P.grab(e, CAT, { port: 'in', id: 'ch' }), { kind: 'to', to: 'ch' });
  assert.deepEqual(P.grab(g, CAT, { card: 'd' }), { kind: 'card', id: 'd' });
});
check('grab: los ojos no tienen entrada y las manos y los pies no tienen salida', () => {
  const g = tpl('sniper');
  assert.equal(P.grab(g, CAT, { port: 'in', id: 'c' }), null);
  assert.equal(P.grab(g, CAT, { port: 'out', id: 'ch' }), null);
  assert.equal(P.grab(g, CAT, { port: 'out', id: 'fm' }), null);
  assert.equal(P.grab(g, CAT, { port: 'out', id: 'nadie' }), null);
});

// ---------- enchufar ----------
check('desde una salida: soltar en una tarjeta que vale une los dos bloques, sin errores nuevos', () => {
  const g = build(['eye.candidates', 'hand.choose'], []);
  const held = P.grab(g, CAT, { port: 'out', id: 'c' });
  assert.equal(P.targets(g, CAT, held).get('ch').ok, true);
  const r = P.drop(g, CAT, held, { node: 'ch' });
  assert.equal(r.action, 'connect');
  assert.equal(ws(r.genome), 'c>ch');
  assert.equal(errs(r.genome).length, 0);
  assert.match(r.text, /Candidatos \(c\).*Elegir \(ch\)/);
  assert.match(r.will, /^Suelta para unir Candidatos \(c\) → Elegir \(ch\)/);
});
check('al revés: desde la entrada vacía de Elegir hasta Candidatos hace el mismo cable', () => {
  const g = build(['eye.candidates', 'hand.choose'], []);
  const held = P.grab(g, CAT, { port: 'in', id: 'ch' });
  assert.equal(P.targets(g, CAT, held).get('c').ok, true);
  const r = P.drop(g, CAT, held, { node: 'c' });
  assert.equal(r.action, 'connect');
  assert.equal(ws(r.genome), 'c>ch');
});
check('soltar en una tarjeta que no vale no hace nada y dice por qué (el mismo motivo que connectOptions)', () => {
  const g = build(['eye.candidates', 'dense', 'dense', 'hand.choose'], [['c', 'd'], ['d', 'd2'], ['d2', 'ch']]);
  const held = P.grab(g, CAT, { port: 'out', id: 'd2' }); // d2 → d cerraría un bucle
  const t = P.targets(g, CAT, held).get('d');
  assert.equal(t.ok, false);
  const o = H.connectOptions(g, CAT, 'd2').to.find((x) => x.id === 'd');
  assert.equal(t.why, o.why);
  const r = P.drop(g, CAT, held, { node: 'd' });
  assert.equal(r.action, 'nada');
  assert.equal(r.genome, g);
  assert.ok(r.why.startsWith(o.why));
  assert.ok(r.why.includes(o.hint), 'con la pista de qué hacer');
});
check('soltar en unos ojos (que no tienen entrada), o sacar al revés desde una mano (que no tiene salida), dice por qué', () => {
  const g = build(['eye.candidates', 'eye.features', 'hand.choose', 'dense'], []);
  const a = P.drop(g, CAT, P.grab(g, CAT, { port: 'out', id: 'c' }), { node: 'f' });
  assert.equal(a.action, 'nada'); assert.match(a.why, /ojos no tienen entradas/);
  const b = P.drop(g, CAT, P.grab(g, CAT, { port: 'in', id: 'd' }), { node: 'ch' });
  assert.equal(b.action, 'nada'); assert.match(b.why, /no tiene salida/);
});
check('soltar en el vacío o en la misma tarjeta no hace nada y no se queja', () => {
  const g = build(['eye.candidates', 'hand.choose'], []);
  const held = P.grab(g, CAT, { port: 'out', id: 'c' });
  for (const at of [{ node: null }, {}, { node: 'c' }]) {
    const r = P.drop(g, CAT, held, at);
    assert.equal(r.action, 'nada'); assert.equal(r.genome, g); assert.equal(r.why, '');
  }
});
check('lo que targets marca como válido, al soltarlo, nunca trae errores nuevos (todas las plantillas, todas las salidas)', () => {
  let n = 0;
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k);
    for (const b of g.blocks) {
      const held = P.grab(g, CAT, { port: 'out', id: b.id });
      if (!held) continue;
      for (const [id, t] of P.targets(g, CAT, held)) {
        const r = P.drop(g, CAT, held, { node: id });
        if (!t.ok) { assert.equal(r.action, 'nada', `${k} ${b.id}→${id}`); continue; }
        assert.equal(r.action, 'connect', `${k} ${b.id}→${id}`);
        assert.equal(H.newErrors(g, r.genome).length, 0, `${k} ${b.id}→${id}`);
        n++;
      }
    }
  }
  assert.ok(n > 10, `solo ${n} cables válidos probados`);
});

// ---------- desenchufar (coger la punta de un cable que ya estaba) ----------
check('la punta soltada en el vacío quita ese cable y solo ese', () => {
  const g = tpl('sniper');
  const held = P.grab(g, CAT, { port: 'in', id: 'd' });
  const r = P.drop(g, CAT, held, { node: null });
  assert.equal(r.action, 'remove');
  assert.equal(ws(r.genome), 'f>d d>ch m>md md>fm');
  assert.match(r.text, /Desenchufado/);
  assert.match(r.will, /^Suelta aquí para desenchufar/);
  assert.match(r.text, /Candidatos \(c\).*Instinto \(d\)/);
});
check('la punta soltada en su propia tarjeta deja el cable como estaba', () => {
  const g = tpl('sniper');
  const held = P.grab(g, CAT, { port: 'in', id: 'd' });
  assert.equal(P.targets(g, CAT, held).get('d').back, true);
  const r = P.drop(g, CAT, held, { node: 'd' });
  assert.equal(r.action, 'nada'); assert.equal(r.genome, g); assert.equal(r.why, '');
  assert.match(r.will, /como estaba/);
});
check('la punta soltada en otra tarjeta que vale cambia el cable de sitio', () => {
  // Instinto ya da a Elegir; el cable Candidatos → Elegir se lleva a Instinto: queda Candidatos → Instinto → Elegir
  const g = build(['eye.candidates', 'hand.choose', 'dense'], [['d', 'ch'], ['c', 'ch']]);
  const held = P.grab(g, CAT, { port: 'in', id: 'ch' });
  assert.deepEqual(held, { kind: 'end', index: 1, from: 'c', to: 'ch' });
  assert.equal(P.targets(g, CAT, held).get('d').ok, true);
  const r = P.drop(g, CAT, held, { node: 'd' });
  assert.equal(r.action, 'move');
  assert.equal(ws(r.genome), 'd>ch c>d');
  assert.equal(errs(r.genome).length, 0);
  assert.match(r.text, /Instinto \(d\)/);
  assert.match(r.label, /c → ch/);
});
check('la punta soltada en una tarjeta que no vale deja el cable donde estaba y dice por qué', () => {
  const g = tpl('sniper');
  const held = P.grab(g, CAT, { port: 'in', id: 'd' }); // c → d
  const t = P.targets(g, CAT, held).get('m'); // a unos ojos no se enchufa nada
  assert.equal(t.ok, false);
  const r = P.drop(g, CAT, held, { node: 'm' });
  assert.equal(r.action, 'nada'); assert.equal(r.genome, g);
  assert.ok(r.why.length > 10);
  assert.match(r.why, /sigue donde estaba/);
});
check('Alt + clic: quita todos los cables de un punto (entrada o salida) y los cuenta', () => {
  const g = tpl('sniper');
  const a = P.unplugAll(g, CAT, 'd', 'in');
  assert.equal(ws(a.genome), 'd>ch m>md md>fm');
  assert.equal(a.removed.length, 2);
  assert.match(a.text, /2 cables/);
  const b = P.unplugAll(g, CAT, 'd', 'out');
  assert.equal(ws(b.genome), 'f>d c>d m>md md>fm');
  assert.equal(b.removed.length, 1);
  const c = P.unplugAll(g, CAT, 'ch', 'out');
  assert.equal(c.removed.length, 0); assert.equal(c.genome, g);
});

// ---------- soltar una tarjeta encima de un cable: se mete en medio ----------
check('una tarjeta sin cables soltada en un cable A → B queda A → tarjeta → B, y B conserva el orden de sus entradas', () => {
  const g = build(['eye.features', 'eye.candidates', 'dense', 'hand.choose', 'dense'], [['f', 'd'], ['c', 'd'], ['d', 'ch']]);
  const i = g.wires.findIndex((w) => w.from === 'c' && w.to === 'd');
  const held = P.grab(g, CAT, { card: 'd2' });
  const tg = P.targets(g, CAT, held);
  assert.equal(tg.get(i).ok, true);
  const r = P.drop(g, CAT, held, { wire: i });
  assert.equal(r.action, 'insert');
  assert.deepEqual(r.genome.wires[i], { from: 'd2', to: 'd' });
  assert.equal(ws(r.genome), 'f>d d2>d d>ch c>d2');
  assert.deepEqual(r.genome.wires.filter((w) => w.to === 'd').map((w) => w.from), ['f', 'd2']);
  assert.equal(errs(r.genome).length, 0);
  assert.match(r.text, /Candidatos \(c\) → Instinto \(d2\) → Instinto \(d\)/);
});
check('la misma inserción que el ＋ del cable (M.insertOnWire), pero con un bloque que ya estaba', () => {
  const g0 = build(['eye.candidates', 'hand.choose'], [['c', 'ch']]);
  const viaPlus = M.insertOnWire(g0, 0, 'dense', CAT).genome;
  const g1 = M.addBlock(g0, 'dense', CAT).genome;
  const viaDrop = P.drop(g1, CAT, P.grab(g1, CAT, { card: 'd' }), { wire: 0 }).genome;
  assert.equal(ws(viaDrop), ws(viaPlus));
});
check('no se mete en medio: una tarjeta que ya tiene cables, unos ojos, o donde no cabe; y dice por qué', () => {
  const g = build(['eye.candidates', 'hand.choose', 'dense', 'eye.features', 'echo'], [['c', 'ch'], ['d', 'ch']]);
  // d ya tiene un cable: no se ofrece ningún cable
  assert.equal(P.targets(g, CAT, P.grab(g, CAT, { card: 'd' })).size, 0);
  const rd = P.drop(g, CAT, P.grab(g, CAT, { card: 'd' }), { wire: 0 });
  assert.equal(rd.action, 'nada'); assert.match(rd.why, /sin cables/);
  // unos ojos no tienen entrada
  const tf = P.targets(g, CAT, P.grab(g, CAT, { card: 'f' })).get(0);
  assert.equal(tf.ok, false); assert.ok(tf.why.length > 10);
  // una memoria no cabe en el cable de candidatos (el mismo motivo que insertOptions)
  const te = P.targets(g, CAT, P.grab(g, CAT, { card: 'e' })).get(0);
  const io = H.insertOptions(g, CAT, 0).find((o) => o.type === 'echo');
  assert.equal(io.ok, false); assert.equal(te.ok, false); assert.ok(te.why.length > 10);
  // en el vacío, nada
  assert.equal(P.drop(g, CAT, P.grab(g, CAT, { card: 'e' }), { wire: null }).action, 'nada');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (enchufar y desenchufar)');
process.exit(fails ? 1 : 0);
