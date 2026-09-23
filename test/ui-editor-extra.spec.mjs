// Editor de redes, casos extra (huecos de mutantes de public/js/lab/model.js, spec/mutantes.md "Parte 4"): la
// colocación no depende del orden en que el genoma lista los bloques, no deja columnas vacías, ordena los ojos por
// corriente y el lienzo cubre todos los bloques; un control vacío deja el valor como estaba; las casillas aceptan
// sus formas; un cable a un bloque que no existe no cuenta. Uso: node test/ui-editor-extra.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ui-editor-extra-'));
const { catalog } = await import('../evo/api.js');
const { TEMPLATES } = await import('../shared/templates.js');
const M = await import('../public/js/lab/model.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const CAT = catalog();
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));
const entry = (type) => CAT.blocks.find((b) => b.type === type);
const cols = (L) => Object.fromEntries(Object.entries(L.nodes).map(([id, n]) => [id, n.col]));

check('la columna de cada bloque no depende del orden en que el genoma lista los bloques', () => {
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k), rev = { ...g, blocks: g.blocks.slice().reverse() };
    assert.deepEqual(cols(M.layout(rev, CAT)), cols(M.layout(g, CAT)), k);
    for (const w of rev.wires) assert.ok(M.layout(rev, CAT).nodes[w.from].col < M.layout(rev, CAT).nodes[w.to].col, `${k}: ${w.from} → ${w.to}`);
  }
  const t = M.layout({ ...tpl('turtle'), blocks: tpl('turtle').blocks.slice().reverse() }, CAT);
  assert.deepEqual([t.nodes.cat.col, t.nodes.g.col, t.nodes.d.col, t.nodes.cd.col, t.nodes.ch.col], [1, 2, 3, 4, 5]);
});

check('sin columnas vacías: de los ojos a las manos, cada columna tiene algún bloque (también con uno suelto)', () => {
  const cases = Object.keys(TEMPLATES).map((k) => tpl(k));
  cases.push(M.addBlock(tpl('turtle'), 'dense', CAT).genome);
  cases.push({ ...tpl('seer'), blocks: tpl('seer').blocks.slice().reverse() });
  for (const g of cases) {
    const L = M.layout(g, CAT);
    const used = new Set(Object.values(L.nodes).map((n) => n.col));
    assert.equal(L.cols.length, Math.max(...used) + 1);
    for (let c = 0; c < L.cols.length; c++) assert.ok(used.has(c), `${g.id}: columna ${c} vacía`);
    assert.ok(L.cols.every((c) => c.label), `${g.id}: columna sin nombre`);
  }
  const L = M.layout(tpl('sniper'), CAT);
  assert.equal(L.cols.length, 3, 'francotirador: ojos, instinto, manos y pies');
});

check('ojos en la primera columna por corriente: contexto arriba, después candidatos, después destinos', () => {
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k), L = M.layout(g, CAT), st = M.streams(g, CAT);
    const eyes = g.blocks.filter((b) => entry(b.type).group === 'eyes').sort((a, b) => L.nodes[a.id].y - L.nodes[b.id].y);
    const rank = { ctx: 0, cand: 1, move: 2 };
    const ranks = eyes.map((b) => rank[st[b.id]]);
    assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), `${k}: ${eyes.map((b) => b.id).join(', ')}`);
  }
  const L = M.layout(tpl('turtle'), CAT);
  assert.deepEqual(['f', 'r', 'k', 'c', 'm'].map((id) => L.nodes[id].y), ['f', 'r', 'k', 'c', 'm'].map((id) => L.nodes[id].y).sort((a, b) => a - b), 'mismo orden que en el genoma dentro de cada corriente');
});

check('el lienzo cubre todos los bloques (también los arrastrados lejos)', () => {
  for (const k of Object.keys(TEMPLATES)) {
    for (const saved of [{}, { [tpl(k).blocks[0].id]: { x: 2000, y: 1500 } }]) {
      const L = M.layout(tpl(k), CAT, saved);
      for (const [id, n] of Object.entries(L.nodes)) {
        assert.ok(n.x >= 0 && n.y >= 0, `${k}: ${id} fuera por arriba o por la izquierda`);
        assert.ok(n.x + M.NODE.w <= L.width && n.y + M.NODE.h <= L.height, `${k}: ${id} fuera del lienzo (${n.x}, ${n.y}) en ${L.width}×${L.height}`);
      }
      for (const c of L.cols) assert.ok(c.x + M.NODE.w <= L.width);
    }
  }
});

check('un control vacío deja el valor como estaba; las casillas aceptan sus formas', () => {
  const units = entry('dense').params.find((p) => p.key === 'units');
  const eps = entry('norm').params[0];
  for (const raw of ['', null, '  x ']) {
    assert.equal(M.coerce(units, raw, 24), 24, JSON.stringify(raw));
    assert.equal(M.coerce(eps, raw, 0.001), 0.001, JSON.stringify(raw));
  }
  assert.equal(M.coerce(units, '0.4', 24), 1, 'se redondea y se recorta');
  const adj = entry('foot.move').params[0];
  for (const raw of [true, 'true', 1, '1', 'on']) assert.equal(M.coerce(adj, raw, false), true, JSON.stringify(raw));
  for (const raw of [false, 'false', 0, '0', '', null, undefined]) assert.equal(M.coerce(adj, raw, true), false, JSON.stringify(raw));
  const act = entry('dense').params.find((p) => p.key === 'activation');
  assert.equal(M.coerce(act, 'gelu', 'tanh'), 'gelu');
  assert.deepEqual(M.coerce(entry('eye.map').params.find((p) => p.key === 'channels'), 'self', []), ['self'], 'un solo valor también vale');
});

check('corrientes: un cable a un bloque que no existe no cuenta (ni rompe el cálculo)', () => {
  const g = tpl('sniper');
  const bad = { ...g, wires: [...g.wires, { from: 'm', to: 'zz' }, { from: 'zz', to: 'd' }] };
  assert.deepEqual(M.streams(bad, CAT), M.streams(g, CAT));
  assert.deepEqual(cols(M.layout(bad, CAT)), cols(M.layout(g, CAT)));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (editor de redes: casos extra)');
process.exitCode = fails ? 1 : 0;
