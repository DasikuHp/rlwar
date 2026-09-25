// Etapa 1 · Crear (P6, sesión 13): el tutorial en el editor que se va encendiendo (spec/12 §4, relevo s12 §4.4).
//  - el motor (public/js/game/tutorial/engine.js): avanzar, saltar, luces, escalón de ayuda, retos con su cambio;
//  - los capítulos (crear.js): lo que exige cada uno para empezar en él (`ensure`), y el recorrido entero con «Hazlo por
//    mí» desde una red vacía hasta el final, con una interfaz de mentira que hace lo mismo que el editor;
//  - nada sin presentar: cada `data-tut` del editor lo presenta algún paso, y cada clave que usan los pasos existe.
// Uso: node test/ui-tutorial.spec.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { catalog } = await import('../evo/api.js');
const { newGenome, validate, repair } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const M = await import('../public/js/lab/model.js');
const Hn = await import('../public/js/lab/hints.js');
const E = await import('../public/js/game/tutorial/engine.js');
const T = await import('../public/js/game/tutorial/crear.js');

const CAT = catalog();
const CH = T.CHAPTERS;
const blank = () => repair(newGenome({ id: 'mi-red', name: 'Mi red', blocks: [], wires: [] }, makeRng(1)), makeRng(1)).genome;
const fix = (g) => repair(g, makeRng(7)).genome;
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); } catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// ---------- motor, con capítulos de juguete ----------
const TOY = [
  { key: 'a', title: 'A', steps: [
    { key: 's1', kind: 'show', target: 'zona1', present: ['zona1'] },
    { key: 'd1', kind: 'do', target: 'boton', present: ['boton'], gesture: { name: 'clic' }, done: (x) => x.n >= 1 },
    { key: 'd2', kind: 'do', target: 'otro', gesture: { name: 'clic' }, done: (x, b) => (x.ev.k || 0) > (b.ev.k || 0) },
    { key: 'q', kind: 'ask', target: 'q', options: [{ v: 'si' }] },
  ] },
  { key: 'b', title: 'B', steps: [
    { key: 'r', kind: 'reto', target: 'lienzo', setup: { x: 1 }, done: (x) => x.n >= 5 },
    { key: 'g', kind: 'grad' },
  ] },
];
check('motor: empieza en el primer paso, → pasa un paso de presentar y no uno de hacer sin hacer', () => {
  let p = E.start(TOY, { now: 0, ctx: { n: 0, ev: {} } });
  assert.equal(E.current(TOY, p).step.key, 's1');
  p = E.advance(TOY, p, 'next', { ctx: { n: 0, ev: {} }, now: 10 });
  assert.equal(E.current(TOY, p).step.key, 'd1');
  assert.equal(E.current(TOY, E.advance(TOY, p, 'next', { ctx: { n: 0, ev: {} } })).step.key, 'd1', '→ no salta lo que hay que hacer');
  p = E.advance(TOY, p, 'check', { ctx: { n: 1, ev: {} }, now: 20 });
  assert.equal(E.current(TOY, p).step.key, 'd2');
  assert.deepEqual(p.last, { ci: 0, si: 1 }, 'recuerda qué se acaba de hacer (para «lo que ha cambiado»)');
});
check('motor: un paso de hacer que ya se cumple al llegar se da por hecho; uno que cuenta acciones, no', () => {
  const p = E.start(TOY, { ctx: { n: 3, ev: { k: 4 } } });
  const q = E.advance(TOY, p, 'next', { ctx: { n: 3, ev: { k: 4 } } });
  assert.equal(E.current(TOY, q).step.key, 'd2', 'd1 (estado) se salta; d2 (acción desde que llegas) no');
  const r = E.advance(TOY, q, 'check', { ctx: { n: 3, ev: { k: 5 } } });
  assert.equal(E.current(TOY, r).step.key, 'q');
});
check('motor: una pregunta avanza al responder y guarda la respuesta', () => {
  let p = E.start(TOY, { ctx: { n: 3, ev: {} } });
  p = E.advance(TOY, p, 'goto', { value: 0, ctx: { n: 3, ev: {} } });
  p = { ...p, si: 3 };
  p = E.advance(TOY, p, 'answer', { value: { v: 'si' }, ctx: { n: 3, ev: {} } });
  assert.equal(p.answers.q.v, 'si');
  assert.equal(E.current(TOY, p).step.key, 'r');
  assert.deepEqual(p.done, ['a']);
});
check('motor: un reto no se da por hecho antes de su cambio (setup), aunque ya se cumpla', () => {
  let p = E.start(TOY, { at: 1, ctx: { n: 9, ev: {} } });
  assert.equal(E.current(TOY, p).step.key, 'r');
  p = E.advance(TOY, p, 'check', { ctx: { n: 9, ev: {} } });
  assert.equal(E.current(TOY, p).step.key, 'r');
  p = E.advance(TOY, p, 'setup', { ctx: { n: 0, ev: {} } });
  assert.ok(p.setup.includes('b/r'));
  assert.equal(E.current(TOY, p).step.key, 'r');
  p = E.advance(TOY, p, 'check', { ctx: { n: 5, ev: {} } });
  assert.equal(E.current(TOY, p).step.key, 'g');
  p = E.advance(TOY, p, 'next', {});
  assert.ok(p.finished && !p.on);
});
check('motor: «Ya sé esto», saltar todo, retomar, volver a empezar e ir a un capítulo', () => {
  let p = E.start(TOY, { ctx: { n: 0, ev: {} } });
  p = E.advance(TOY, p, 'skipChapter', { ctx: { n: 0, ev: {} } });
  assert.equal(E.current(TOY, p).step.key, 'r'); assert.deepEqual(p.done, ['a']);
  const off = E.advance(TOY, p, 'skipAll');
  assert.ok(!off.on && off.skipped && E.current(TOY, off) === null);
  const back = E.advance(TOY, off, 'resume', { ctx: { n: 0, ev: {} } });
  assert.equal(E.current(TOY, back).step.key, 'r', 'la Guía te devuelve al paso en que estabas');
  const again = E.advance(TOY, back, 'restart', { ctx: { n: 0, ev: {} } });
  assert.equal(E.current(TOY, again).step.key, 's1'); assert.deepEqual(again.done, []);
  const set = E.advance(TOY, E.advance(TOY, back, 'setup', { ctx: { n: 0, ev: {} } }), 'goto', { value: 1, ctx: { n: 0, ev: {} } });
  assert.ok(!set.setup.includes('b/r'), 'ir a un capítulo vuelve a aplicar sus retos');
  assert.equal(E.advance(TOY, again, 'skipChapter').ci, 1);
});
check('motor: luces — lo de ahora iluminado; lo ya presentado a media luz; al acabar, todo conocido', () => {
  let p = E.start(TOY, { ctx: { n: 0, ev: {} } });
  let L = E.lights(TOY, p, {});
  assert.deepEqual(L.on, ['zona1']); assert.deepEqual(L.known, []);
  p = E.advance(TOY, p, 'next', { ctx: { n: 0, ev: {} } });
  L = E.lights(TOY, p, {});
  assert.deepEqual(L.on, ['boton']); assert.deepEqual(L.known, ['zona1']);
  const lit = E.lights([{ key: 'z', steps: [{ key: 'x', kind: 'show', target: (x) => `#${x.id}`, lit: (x) => [x.id + '2'], look: true }] }], E.start([{ key: 'z', steps: [{ key: 'x', kind: 'show' }] }]), { id: 'n' });
  assert.deepEqual(lit.on, ['#n', 'n2']); assert.equal(lit.look, true);
  assert.deepEqual(E.lights(TOY, { finished: true, done: [] }, {}).known.sort(), ['boton', 'zona1']);
});
check('motor: escalón de ayuda — gesto nuevo con mano desde el principio; 2 fallos o 25 s mano; 4 o 50 s «Hazlo por mí»; reto sin nada hasta 2 fallos', () => {
  let p = E.start(TOY, { ctx: { n: 0, ev: {} }, now: 0 });
  p = E.advance(TOY, p, 'next', { ctx: { n: 0, ev: {} }, now: 0 });
  assert.equal(E.helpLevel(TOY, p, 0), 1, 'd1 estrena el gesto «clic»');
  p = E.advance(TOY, p, 'check', { ctx: { n: 1, ev: {} }, now: 0 });
  assert.equal(E.current(TOY, p).step.key, 'd2');
  assert.equal(E.helpLevel(TOY, p, 1000), 0, 'd2 repite el gesto: sin mano');
  assert.equal(E.helpLevel(TOY, p, 25000), 1);
  assert.equal(E.helpLevel(TOY, p, 50000), 2);
  let q = E.advance(TOY, E.advance(TOY, p, 'miss'), 'miss');
  assert.equal(E.helpLevel(TOY, q, 0), 1);
  q = E.advance(TOY, E.advance(TOY, q, 'miss'), 'miss');
  assert.equal(E.helpLevel(TOY, q, 0), 2);
  let r = E.advance(TOY, E.start(TOY, { at: 1, ctx: { n: 0, ev: {} } }), 'setup', { ctx: { n: 0, ev: {} }, now: 0 });
  assert.equal(E.helpLevel(TOY, r, 30000), 0);
  r = E.advance(TOY, E.advance(TOY, r, 'miss'), 'miss');
  assert.equal(E.helpLevel(TOY, r, 0), 2);
  assert.equal(E.helpLevel(TOY, E.start(TOY), 99999), 0, 'presentar: sin ayuda');
  assert.deepEqual(E.bar(TOY, r).map((x) => x.state), ['done', 'now']);
});

// ---------- los capítulos de Crear ----------
check('capítulos: 8 y la graduación; cada paso de hacer y cada reto tiene «Hazlo por mí» y texto; cada pregunta, respuestas', () => {
  assert.equal(CH.length, 9);
  for (const c of CH) {
    assert.ok(c.title && c.ask, c.key);
    for (const s of c.steps) {
      assert.ok(['show', 'do', 'ask', 'reto', 'pause', 'grad'].includes(s.kind), `${c.key}/${s.key}`);
      assert.ok(s.title && s.text, `${c.key}/${s.key} sin título o texto`);
      if (s.kind === 'do' || s.kind === 'reto') { assert.ok(s.help && s.done && s.todo, `${c.key}/${s.key} sin ayuda, done o 👉`); }
      if (s.kind === 'reto') assert.ok(s.setup, `${c.key}/${s.key}: el reto cambia algo al empezar`);
      if (s.kind === 'ask') assert.ok(s.options && s.options.length >= 2, `${c.key}/${s.key}`);
    }
  }
  assert.equal(T.startAt('algo'), 2, '«Ya sé algo» empieza en el capítulo 3');
  assert.equal(T.startAt('cero'), 0);
});
check('ensure: se puede empezar en cualquier capítulo con una red vacía, y aplicarlo dos veces no cambia nada', () => {
  const ready = (g, k) => Hn.readiness(g, CAT).some((r) => r.key === k && r.ok);
  for (let ci = 1; ci < CH.length; ci++) {
    const g = fix(T.ensureFor(ci, blank(), CAT));
    assert.equal(validate(g).errors.length, 0, `${CH[ci].key}: ${validate(g).errors.map((e) => e.code)}`);
    assert.ok(ready(g, 'fed'), `${CH[ci].key}: puede jugar`);
    assert.deepEqual(T.ensureFor(ci, g, CAT).wires, g.wires, `${CH[ci].key}: idempotente`);
  }
  const g8 = T.ensureFor(7, blank(), CAT);
  assert.ok(ready(g8, 'think') && ready(g8, 'move') && ready(g8, 'memory'), 'el taller necesita Instinto, Moverse y Eco');
});

// interfaz de mentira: lo que hace el editor con cada «Hazlo por mí» y cada cambio del Sistema
function fakeEditor() {
  const ui = { netId: null, tplOpen: null, scene: 'abierto', seed: 1, phase: 'shoot', panelTab: 'capa', genesTab: 'traits', hoverWire: null, insertOpen: false, saved: false, dirty: false, folded: false, ev: {}, path: 'cero' };
  const st = { g: null, hist: [], versions: [], savedG: null };
  const bump = (k) => { ui.ev = { ...ui.ev, [k]: (ui.ev[k] || 0) + 1 }; };
  const setG = (g, record = true) => { if (record && st.g) st.hist.push(st.g); st.g = fix(g); ui.dirty = true; ui.saved = false; ui.hoverWire = null; ui.insertOpen = false; };
  const save = () => { if (st.savedG) st.versions.push(st.savedG); st.savedG = st.g; ui.saved = true; ui.dirty = false; bump('save'); };
  const ops = (h) => {
    const before = st.g;
    if (st.g) { const g = T.applyGenome(st.g, h, CAT); if (g !== st.g) setG(g); }
    if ((h.unwire || h.unwireInto) && st.g !== before) bump('unwire');
    if (h.gpath) bump(`gene:${h.gpath.path.split('.')[0]}`);
  };
  return {
    ui, st,
    ctx: () => T.buildCtx(st.g, ui, CAT),
    help(h, p) {
      if (h.create) { st.g = blank(); ui.netId = 'mi-red'; st.savedG = st.g; return E.advance(CH, p, 'set', { value: { net: 'mi-red' } }); }
      if (h.panelTab) ui.panelTab = h.panelTab;
      if (h.genesTab) { ui.panelTab = 'genes'; ui.genesTab = h.genesTab; }
      if (h.scene) { ui.scene = h.scene; bump('scene'); }
      if (h.seed) { ui.seed += h.seed; bump('seed'); }
      if (h.phase) ui.phase = h.phase;
      if (h.benchMove) bump('bench');
      if (h.hover) ui.hoverWire = T.wireIndex(st.g, h.hover[0], h.hover[1]);
      if (h.undo && st.hist.length) { st.g = st.hist.pop(); bump('undo'); }
      if (h.save) save();
      if (h.fix) { const f = Hn.fixes(st.g, CAT, validate(st.g))[0]; if (f) { setG(f.apply(st.g)); bump('fix'); } }
      if (h.restore) { const v = st.versions[st.versions.length - 1]; if (v) { st.versions.push(st.savedG); st.g = v; st.savedG = v; st.hist = []; bump('restore'); } }
      ops(h);
      return p;
    },
    setup(s) { ops(s); if (s.resetHistory) st.hist = []; if (s.save) save(); },
  };
}
check('recorrido entero con «Hazlo por mí», desde una red vacía hasta la graduación: cada paso se cumple con su ayuda', () => {
  const F = fakeEditor();
  let p = E.start(CH, { ctx: F.ctx(), path: 'cero' });
  const seen = [];
  for (let guard = 0; guard < 200 && p.on; guard++) {
    const c = E.current(CH, p), id = `${c.chapter.key}/${c.step.key}`;
    seen.push(id);
    if (c.step.setup && !p.setup.includes(id)) { F.setup(c.step.setup); p = E.advance(CH, p, 'setup', { ctx: F.ctx() }); continue; }
    if (['show', 'pause', 'grad'].includes(c.step.kind)) { p = E.advance(CH, p, 'next', { ctx: F.ctx() }); continue; }
    if (c.step.kind === 'ask') { p = E.advance(CH, p, 'answer', { value: { v: c.step.options[0].v, pick: null }, ctx: F.ctx() }); continue; }
    assert.ok(!c.step.done(F.ctx(), p.base, p) || c.step.setup, `${id} ya estaba hecho sin hacer nada`);
    p = F.help(c.step.help, p);
    const q = E.advance(CH, p, 'check', { ctx: F.ctx() });
    assert.notEqual(E.stepId(CH, p) === (q.on ? E.stepId(CH, q) : null) ? 'igual' : 'otro', 'igual', `${id}: «Hazlo por mí» no lo cumple`);
    assert.equal(typeof (c.step.after ? c.step.after(F.ctx(), q) : ''), 'string');
    p = q;
  }
  assert.ok(p.finished, `no acabó: se quedó en ${seen[seen.length - 1]}`);
  // solo se salta, porque ya está hecho al llegar, «Añade Rasgos»: el reto del capítulo 2 ya lo puso (y sigue unido a Elegir)
  { const all = CH.flatMap((c) => c.steps.map((s) => `${c.key}/${s.key}`)); const skipped = all.filter((k) => !seen.includes(k)); assert.deepEqual(skipped, ['recordar/rasgos'], `se saltó: ${skipped.join(', ')}`); }
  const g = F.st.g;
  assert.ok(validate(g, { forPlay: true }).ok, 'la red del tutorial puede jugar');
  for (const t of ['eye.candidates', 'hand.choose', 'dense', 'eye.moves', 'foot.move', 'eye.features', 'echo']) assert.ok(g.blocks.some((b) => b.type === t), t);
  for (const k of ['traits', 'reward', 'learning', 'imagination']) assert.ok(F.ui.ev[`gene:${k}`] >= 1, `cambió un gen de ${k}`);
});
check('recorrido: los textos se componen con el estado real (números del banco) y el camino «Sé de RL» invita a saltar', () => {
  const x = T.buildCtx(null, { path: 'rl', ev: {} }, CAT);
  assert.match(CH[0].steps[0].text(x), /saltarlo/);
  for (const c of CH) for (const s of c.steps) for (const f of ['text', 'todo']) if (typeof s[f] === 'function') assert.equal(typeof s[f](T.buildCtx(T.ensureFor(7, blank(), CAT), { ev: {} }, CAT), { answers: {}, data: {} }), 'string', `${c.key}/${s.key}.${f}`);
});

// ---------- nada sin presentar ----------
const src = ['public/js/lab/editor.js', 'public/js/game/main.js'].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
const EXPAND = { grupo: M.GROUPS.map((g) => g.key), gen: ['traits', 'reward', 'learning', 'imagination'], tab: ['capa', 'genes', 've', 'versiones', 'avisos'] };
const inEditor = new Set();
for (const m of src.matchAll(/data-tut="([a-z-]+?)(\$\{[^}]*\})?"/g)) {
  if (m[2]) for (const k of EXPAND[m[1].replace(/-$/, '')] || []) inEditor.add(`${m[1]}${k}`); else inEditor.add(m[1]);
}
inEditor.add('tab-editor'); inEditor.add('tab-redes');
const presented = new Set(CH.flatMap((c) => c.steps.flatMap((s) => s.present || [])));
check('nada sin presentar: cada zona `data-tut` del editor la presenta algún paso', () => {
  assert.ok(inEditor.size >= 40, `solo hay ${inEditor.size} claves data-tut en el editor`);
  const missing = [...inEditor].filter((k) => !presented.has(k));
  assert.deepEqual(missing, [], `sin presentar: ${missing.join(', ')}`);
});
check('nada inventado: cada clave que presentan o iluminan los pasos existe en el editor', () => {
  const keys = new Set([...presented]);
  for (const c of CH) for (const s of c.steps) for (const t of [s.target, ...(Array.isArray(s.lit) ? s.lit : [])]) if (typeof t === 'string' && /^[a-z-]+$/.test(t)) keys.add(t);
  for (const c of CH) for (const s of c.steps) for (const z of s.zones || []) keys.add(z[0]);
  const ghost = [...keys].filter((k) => !inEditor.has(k));
  assert.deepEqual(ghost, [], `no existen: ${ghost.join(', ')}`);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (tutorial en el editor que se va encendiendo)');
process.exitCode = fails ? 1 : 0;
