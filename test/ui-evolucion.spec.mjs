// Evolución: hijos, pre-torneo y diferencias (parte 4, spec/prompt-opus-ui.md §3.1; spec/05 §1, §4, §5, §10.3–§10.4):
// lógica pura de public/js/lab/evolution.js. La configuración de mutación por defecto sale del catálogo; el cuerpo de
// POST /nets/:id/children con los límites del servidor y errores en español; el ranking tal cual; el color del mapa de
// calor (una sola tinta, de oscuro a claro) y el resumen de un diff. Escrito ANTES del código.
// Uso: node test/ui-evolucion.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ui-evolucion-'));
const { catalog } = await import('../evo/api.js');
const E = await import('../public/js/lab/evolution.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const CAT = catalog();

check('mutación por defecto: la del catálogo, tipo a tipo y ajuste a ajuste', () => {
  const m = E.defaultMutation(CAT.mutation);
  assert.deepEqual(Object.keys(m), CAT.mutation.map((x) => x.key));
  for (const t of CAT.mutation) for (const p of t.params) assert.deepEqual(m[t.key][p.key], p.default, `${t.key}.${p.key}`);
  assert.deepEqual(m.weights, { on: true, sigma: 0.05, fraction: 0.3 });
  m.weights.sigma = 9;
  assert.equal(E.defaultMutation(CAT.mutation).weights.sigma, 0.05, 'copias nuevas cada vez');
});

check('cuerpo de hijos: n, mutación, pre-torneo (rival o null) y semilla solo si se da', () => {
  const mutation = E.defaultMutation(CAT.mutation);
  const r = E.childrenBody({ n: '6', mutation, games: '4', opponentId: '', soldiers: 'random', seed: '' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.body, { n: 6, mutation, pretournament: { games: 4, opponentId: null, soldiers: 'random' } });
  const r2 = E.childrenBody({ n: 1, mutation, games: 0, opponentId: 'orca', soldiers: '2', seed: '7' });
  assert.deepEqual(r2.body, { n: 1, mutation, pretournament: { games: 0, opponentId: 'orca', soldiers: 2 }, seed: 7 });
});

check('cuerpo de hijos: errores en español con los límites del servidor', () => {
  const mutation = E.defaultMutation(CAT.mutation);
  const bad = (patch, re) => { const r = E.childrenBody({ n: 4, mutation, games: 4, opponentId: '', soldiers: 'random', seed: '', ...patch }); assert.equal(r.body, null); assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${r.errors}`); };
  bad({ n: '0' }, /hijos/);
  bad({ n: '17' }, /hijos/);
  bad({ n: '2.5' }, /hijos/);
  bad({ games: '21' }, /partidas/);
  bad({ games: '-1' }, /partidas/);
  bad({ soldiers: '0' }, /soldados/);
  bad({ seed: 'x' }, /semilla/);
});

check('ranking: posición, la mejor marcada y los números tal cual', () => {
  const ranking = [
    { id: 'h-b', name: 'H B', wins: 3, killDiff: 2, kills: 5, deaths: 3, opsText: ['Añade 8 neuronas a Instinto d'] },
    { id: 'h-a', name: 'H A', wins: 1, killDiff: -1, kills: 2, deaths: 3, opsText: [] },
  ];
  assert.deepEqual(E.rankingRows(ranking), [
    { pos: 1, best: true, id: 'h-b', name: 'H B', wins: 3, killDiff: 2, kills: 5, deaths: 3, opsText: ['Añade 8 neuronas a Instinto d'] },
    { pos: 2, best: false, id: 'h-a', name: 'H A', wins: 1, killDiff: -1, kills: 2, deaths: 3, opsText: [] },
  ]);
  assert.deepEqual(E.rankingRows(null), []);
});

check('mapa de calor: una tinta de oscuro (0) a claro (1), recortada y sin NaN', () => {
  assert.equal(E.heatColor(0), 'rgb(14,22,39)');
  assert.equal(E.heatColor(1), 'rgb(79,209,255)');
  assert.equal(E.heatColor(0.5), 'rgb(47,116,147)');
  assert.equal(E.heatColor(-3), E.heatColor(0));
  assert.equal(E.heatColor(7), E.heatColor(1));
  assert.equal(E.heatColor(NaN), E.heatColor(0));
  const lum = (c) => c.match(/\d+/g).map(Number).reduce((s, v) => s + v, 0);
  for (let v = 0.1; v <= 1; v += 0.1) assert.ok(lum(E.heatColor(v)) > lum(E.heatColor(v - 0.1)), 'más cambio, más claro');
});

check('resumen de un diff: cuántos bloques cambian, cables y solo los rasgos que cambian', () => {
  const diff = {
    blocks: [{ blockId: 'f', status: 'same' }, { blockId: 'd', status: 'changed' }, { blockId: 'g', status: 'changed' }, { blockId: 'x', status: 'added' }, { blockId: 'r', status: 'removed' }],
    wires: { added: [{ from: 'f', to: 'x' }], removed: [] },
    traits: { before: { temperature: 1, pulse: 0.1, character: 'frio' }, after: { temperature: 1.2, pulse: 0.1, character: 'chulo' } },
    imagination: { before: { n: 24 }, after: { n: 24 } },
    text: ['a'],
  };
  assert.deepEqual(E.diffSummary(diff), {
    same: 1, changed: 2, added: 1, removed: 1, wiresAdded: 1, wiresRemoved: 0,
    traits: [{ key: 'temperature', before: 1, after: 1.2 }, { key: 'character', before: 'frio', after: 'chulo' }],
    imaginationChanged: false,
  });
  assert.equal(E.diffSummary({ ...diff, imagination: { before: { n: 24 }, after: { n: 30 } } }).imaginationChanged, true);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (evolución: lógica)');
process.exitCode = fails ? 1 : 0;
