// Editor de redes (parte 4, spec/08 §1 y §4, spec/prompt-opus-ui.md §3.1): lógica pura del editor en
// public/js/lab/model.js (niveles de vista, paleta, ids, añadir/quitar bloques y cables, ajustes, corrientes,
// colocación por columnas del cuerpo, avisos por bloque) y el emblema de public/js/lab/emblem.js.
// Escrito ANTES del código. Sin servidor ni navegador. Uso: node test/ui-editor.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ui-editor-'));
const { catalog } = await import('../evo/api.js');
const { validate, repair, outDims } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const M = await import('../public/js/lab/model.js');
const { emblemSVG } = await import('../public/js/lab/emblem.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const CAT = catalog();
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));
const entry = (type) => CAT.blocks.find((b) => b.type === type);
const fixed = (g) => repair(g, makeRng(7)).genome;

check('niveles: Aprendiz < Artesano < Científico; sin nivel cuenta como Aprendiz', () => {
  assert.deepEqual(M.LEVELS, ['aprendiz', 'artesano', 'cientifico']);
  assert.equal(M.atLevel('aprendiz', 'aprendiz'), true);
  assert.equal(M.atLevel('artesano', 'aprendiz'), false);
  assert.equal(M.atLevel('artesano', 'artesano'), true);
  assert.equal(M.atLevel('cientifico', 'artesano'), false);
  assert.equal(M.atLevel('cientifico', 'cientifico'), true);
  assert.equal(M.atLevel(undefined, 'aprendiz'), true);
});

check('paleta: grupos en el orden del cuerpo y solo los bloques del nivel (nada se bloquea en Científico)', () => {
  const ap = M.palette(CAT, 'aprendiz');
  assert.deepEqual(ap.map((g) => g.key), ['eyes', 'instinct', 'memory', 'hands', 'feet']);
  assert.deepEqual(ap.map((g) => g.name), ['Ojos', 'Instinto', 'Memoria', 'Manos', 'Pies']);
  const types = (p) => p.flatMap((g) => g.blocks.map((b) => b.type));
  assert.deepEqual(types(ap), CAT.blocks.filter((b) => b.level === 'aprendiz').map((b) => b.type).sort((a, b) => order(a) - order(b)));
  assert.ok(types(ap).every((t) => entry(t).level === 'aprendiz'));
  assert.ok(!types(ap).includes('gru') && types(M.palette(CAT, 'artesano')).includes('gru'));
  assert.ok(!types(M.palette(CAT, 'artesano')).includes('mul') && types(M.palette(CAT, 'cientifico')).includes('mul'));
  assert.equal(types(M.palette(CAT, 'cientifico')).length, CAT.blocks.length);
  function order(t) { return ['eyes', 'instinct', 'memory', 'hands', 'feet'].indexOf(entry(t).group) * 100 + CAT.blocks.findIndex((b) => b.type === t); }
});

check('ajustes por nivel: Instinto en Aprendiz solo enseña Neuronas; en Artesano, también Activación', () => {
  assert.deepEqual(M.paramsAt(entry('dense'), 'aprendiz').map((p) => p.key), ['units']);
  assert.deepEqual(M.paramsAt(entry('dense'), 'artesano').map((p) => p.key), ['units', 'activation']);
  assert.deepEqual(M.paramsAt(entry('attention'), 'artesano').map((p) => p.key), ['heads']);
  assert.deepEqual(M.paramsAt(entry('attention'), 'cientifico').map((p) => p.key), ['heads', 'keyDim']);
  assert.deepEqual(M.paramsAt(entry('eye.features'), 'cientifico'), []);
});

check('ids nuevos: cortos, legibles, únicos y válidos (d, d2, d3…)', () => {
  const t = tpl('turtle');
  assert.equal(M.newBlockId(t, 'dense'), 'd2');
  assert.equal(M.newBlockId(t, 'gru'), 'g2');
  assert.equal(M.newBlockId(t, 'lstm'), 'l');
  assert.equal(M.newBlockId({ blocks: [] }, 'dense'), 'd');
  let g = { ...tpl('empty') };
  const seen = new Set(g.blocks.map((b) => b.id));
  for (const b of CAT.blocks) for (let i = 0; i < 3; i++) {
    const r = M.addBlock(g, b.type, CAT);
    assert.ok(!seen.has(r.id), `repetido ${r.id}`); seen.add(r.id);
    assert.match(r.id, /^[A-Za-z0-9_-]{1,32}$/);
    g = r.genome;
  }
});

check('añadir un bloque: copia nueva con los valores por defecto del catálogo; queda suelto (aviso, no error)', () => {
  const t = tpl('sniper'), before = JSON.stringify(t);
  const r = M.addBlock(t, 'dense', CAT);
  assert.equal(JSON.stringify(t), before, 'no toca el original');
  const b = r.genome.blocks.find((x) => x.id === r.id);
  assert.deepEqual(b, { id: r.id, type: 'dense', params: { units: 32, activation: 'tanh' } });
  const r2 = M.addBlock(t, 'eye.map', CAT);
  assert.deepEqual(r2.genome.blocks.find((x) => x.id === r2.id).params, { cell: 2, channels: ['obstacles', 'enemies', 'allies', 'self'] });
  assert.deepEqual(M.addBlock(t, 'eye.features', CAT).genome.blocks.at(-1).params, {});
  const v = validate(fixed(r.genome));
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.ok(v.warnings.some((w) => w.code === 'unconnected' && w.blockId === r.id));
});

check('quitar un bloque: se van sus cables, sus pesos y su congelado; lo demás queda igual', () => {
  const t = fixed(tpl('turtle'));
  t.frozen = ['g', 'd'];
  const before = JSON.stringify(t);
  const g = M.removeBlock(t, 'g');
  assert.equal(JSON.stringify(t), before, 'no toca el original');
  assert.ok(!g.blocks.some((b) => b.id === 'g'));
  assert.deepEqual(g.wires, t.wires.filter((w) => w.from !== 'g' && w.to !== 'g'));
  assert.ok(!('g' in g.weights) && 'd' in g.weights);
  assert.deepEqual(g.frozen, ['d']);
  assert.equal(g.blocks.length, t.blocks.length - 1);
});

check('cables: conectar añade al final; mismo bloque, repetido o hacia un ojo → error en español; desconectar por índice', () => {
  const t = tpl('sniper'), before = JSON.stringify(t);
  const ok = M.connect(t, 'm', 'd');
  assert.equal(ok.error, null);
  assert.deepEqual(ok.genome.wires.at(-1), { from: 'm', to: 'd' });
  assert.equal(ok.genome.wires.length, t.wires.length + 1);
  assert.equal(JSON.stringify(t), before);
  for (const [from, to, re] of [['d', 'd', /consigo mismo/], ['f', 'd', /ya existe/], ['d', 'c', /ojos/i], ['d', 'zz', /no existe/], ['zz', 'd', /no existe/]]) {
    const r = M.connect(t, from, to);
    assert.match(String(r.error), re, `${from} → ${to}`);
    assert.equal(r.genome, t, 'sin cambios si hay error');
  }
  const cut = M.disconnect(t, 1);
  assert.deepEqual(cut.wires, t.wires.filter((_, i) => i !== 1));
  assert.equal(JSON.stringify(t), before);
});

check('ajustes: se recortan al rango del catálogo y se convierten al tipo (entero, número, sí/no, opción, conjunto)', () => {
  const t = tpl('turtle');
  const d = entry('dense'), units = d.params.find((p) => p.key === 'units'), act = d.params.find((p) => p.key === 'activation');
  const val = (g, id, k) => g.blocks.find((b) => b.id === id).params[k];
  assert.equal(val(M.setParam(t, 'd', units, '0'), 'd', 'units'), 1);
  assert.equal(val(M.setParam(t, 'd', units, 9999), 'd', 'units'), 512);
  assert.equal(val(M.setParam(t, 'd', units, '12.6'), 'd', 'units'), 13);
  assert.equal(val(M.setParam(t, 'd', units, 'abc'), 'd', 'units'), 24, 'sin número: se queda como estaba');
  assert.equal(val(M.setParam(t, 'd', act, 'relu'), 'd', 'activation'), 'relu');
  assert.equal(val(M.setParam(t, 'd', act, 'swish'), 'd', 'activation'), 'tanh', 'opción que no existe: se queda');
  const rays = entry('eye.radar').params[0];
  assert.equal(val(M.setParam(t, 'r', rays, '32'), 'r', 'rays'), 32, 'el valor de la opción, con su tipo');
  const t2 = M.addBlock(tpl('empty'), 'eye.map', CAT);
  const cell = entry('eye.map').params.find((p) => p.key === 'cell'), ch = entry('eye.map').params.find((p) => p.key === 'channels');
  assert.equal(val(M.setParam(t2.genome, t2.id, cell, '2.5'), t2.id, 'cell'), 2.5);
  assert.deepEqual(val(M.setParam(t2.genome, t2.id, ch, ['trails', 'self', 'nada']), t2.id, 'channels'), ['self', 'trails'], 'conjunto: solo opciones, en su orden');
  const norm = M.addBlock(tpl('empty'), 'norm', CAT), eps = entry('norm').params[0];
  assert.equal(val(M.setParam(norm.genome, norm.id, eps, 1), norm.id, 'eps'), 0.01);
  const fm = entry('foot.move').params[0];
  assert.equal(val(M.setParam(t, 'fm', fm, false), 'fm', 'adjust'), false);
  assert.equal(t.blocks.find((b) => b.id === 'd').params.units, 24, 'no toca el original');
});

check('rutas de ajustes de la red (aprendizaje, rasgos, recompensa): leer y escribir sin tocar el original', () => {
  const t = tpl('seer');
  const g = M.setPath(t, 'learning.gradient.lr', 0.01);
  assert.equal(M.getPath(g, 'learning.gradient.lr'), 0.01);
  assert.equal(M.getPath(t, 'learning.gradient.lr'), t.learning ? t.learning.gradient.lr : undefined);
  const g2 = M.setPath({ id: 'x' }, 'reward.survive', 0.5);
  assert.deepEqual(g2, { id: 'x', reward: { survive: 0.5 } });
  assert.equal(M.getPath({}, 'a.b.c'), undefined);
});

check('corrientes: las mismas que calcula el genoma (ctx, cand, move) en las 4 plantillas; candidatos + destinos → mix', () => {
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k);
    const want = Object.fromEntries(Object.entries(outDims(g)).map(([id, o]) => [id, o.stream]));
    assert.deepEqual(M.streams(g, CAT), want, k);
  }
  const bad = tpl('turtle'); bad.wires.push({ from: 'm', to: 'cd' });
  assert.equal(M.streams(bad, CAT).cd, 'mix');
  const loop = tpl('turtle'); loop.wires.push({ from: 'd', to: 'cat' });
  const s = M.streams(loop, CAT);
  assert.ok(['cat', 'g', 'd'].every((id) => id in s), 'un bucle no cuelga el cálculo');
});

check('colocación: columnas por profundidad (los cables siempre hacia la derecha), ojos a la izquierda, manos y pies al final, sin solapes', () => {
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k);
    const L = M.layout(g, CAT);
    assert.deepEqual(Object.keys(L.nodes).sort(), g.blocks.map((b) => b.id).sort(), k);
    const col = (id) => L.nodes[id].col;
    for (const w of g.wires) assert.ok(col(w.from) < col(w.to), `${k}: ${w.from} → ${w.to}`);
    const last = Math.max(...Object.values(L.nodes).map((n) => n.col));
    for (const b of g.blocks) {
      const grp = entry(b.type).group;
      if (grp === 'eyes') assert.equal(col(b.id), 0, `${k}: ojo ${b.id}`);
      if (grp === 'hands' || grp === 'feet') assert.equal(col(b.id), last, `${k}: salida ${b.id}`);
    }
    const ns = Object.values(L.nodes);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      if (ns[i].col === ns[j].col) assert.ok(Math.abs(ns[i].y - ns[j].y) >= M.NODE.h, `${k}: solape`);
    }
    for (const n of ns) assert.equal(n.x, L.cols[n.col].x);
    assert.equal(L.cols[0].label, 'Ojos');
    assert.equal(L.cols[last].label, 'Manos y pies');
    assert.deepEqual(M.layout(g, CAT), L, 'determinista');
  }
  const t = M.layout(tpl('turtle'), CAT);
  assert.equal(t.cols[t.nodes.g.col].label, 'Memoria');
  assert.equal(t.cols[t.nodes.d.col].label, 'Instinto');
});

check('colocación: lo arrastrado manda; un bloque suelto no se pone con los ojos; un bucle no cuelga', () => {
  const g = tpl('sniper');
  const L = M.layout(g, CAT, { d: { x: 900, y: 40 }, fantasma: { x: 1, y: 1 } });
  assert.deepEqual([L.nodes.d.x, L.nodes.d.y], [900, 40]);
  assert.ok(!('fantasma' in L.nodes));
  const loose = M.addBlock(g, 'dense', CAT);
  assert.ok(M.layout(loose.genome, CAT).nodes[loose.id].col > 0);
  const loop = tpl('turtle'); loop.wires.push({ from: 'd', to: 'cat' });
  const LL = M.layout(loop, CAT);
  assert.equal(Object.keys(LL.nodes).length, loop.blocks.length);
});

check('avisos: cada error y aviso de validate va a su bloque o a su cable; el resto, a la lista general', () => {
  const g = fixed(tpl('turtle'));
  g.wires.push({ from: 'm', to: 'cd' });
  g.wires.push({ from: 'f', to: 'cat' });
  const v = validate(g);
  const I = M.issuesOf(v);
  assert.ok(I.byBlock.cd.some((x) => x.kind === 'error' && x.code === 'stream-mix' && x.example));
  const all = [...Object.values(I.byBlock).flat(), ...Object.values(I.byWire).flat(), ...I.general];
  assert.equal(all.length, v.errors.length + v.warnings.length);
  assert.equal(all.filter((x) => x.kind === 'error').length, v.errors.length);
  const dupe = v.warnings.find((w) => w.code === 'duplicate-wire');
  if (dupe) assert.ok(I.byWire[dupe.wire].some((x) => x.code === 'duplicate-wire'));
  const none = M.issuesOf({ ok: true, errors: [], warnings: [] });
  assert.deepEqual(none, { byBlock: {}, byWire: {}, general: [] });
});

check('emblema: SVG determinista a partir de la semilla, distinto para semillas distintas, sin NaN', () => {
  const a = emblemSVG(401949551, 48), b = emblemSVG(401949551, 48), c = emblemSVG(401949552, 48);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^<svg [^>]*viewBox="[^"]+"[^>]*>[\s\S]*<\/svg>$/);
  assert.ok(!/NaN|undefined/.test(a + c));
  for (const s of [0, 1, 2 ** 31 - 1, 123456789]) assert.ok(!/NaN|undefined/.test(emblemSVG(s, 24)), `semilla ${s}`);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (editor de redes: lógica)');
process.exitCode = fails ? 1 : 0;
