// Cirugía (parte 4, nivel Científico; spec/05 §7 y §10.5, spec/02 §4): lógica pura de public/js/lab/surgery.js. Qué
// bloques tienen pesos (y cuáles están congelados), cómo se dibuja cada matriz (W[i·salidas + j]: filas = entradas,
// columnas = neuronas de salida), sus cifras, escalar pesos, leer pesos escritos a mano (errores en español) y el
// color divergente (negativo naranja, cero gris, positivo cyan). Escrito ANTES del código.
// Uso: node test/ui-cirugia.spec.mjs
import { strict as assert } from 'node:assert';
const { TEMPLATES } = await import('../shared/templates.js');
const { outDims, weightShapes, analyzeGenome } = await import('../shared/genome.js');
const X = await import('../public/js/lab/surgery.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));

check('bloques con pesos: los del genoma, con la longitud de cada clave y si están congelados', () => {
  const g = tpl('turtle'); g.frozen = ['g'];
  const list = X.weightBlocks(g);
  assert.deepEqual(list.map((b) => b.id), g.blocks.filter((b) => g.weights[b.id]).map((b) => b.id));
  const gru = list.find((b) => b.id === 'g');
  assert.equal(gru.frozen, true); assert.equal(gru.type, 'gru');
  assert.deepEqual(gru.keys, Object.fromEntries(Object.entries(g.weights.g).map(([k, v]) => [k, v.length])));
  assert.equal(list.find((b) => b.id === 'd').frozen, false);
  assert.deepEqual(X.weightBlocks({ blocks: [], weights: {} }), []);
});

check('rejilla: columnas = neuronas de salida (el tamaño de su sesgo), filas = entradas; sesgos en una fila', () => {
  const g = tpl('turtle');
  const a = analyzeGenome(g);
  for (const b of g.blocks) {
    const shapes = weightShapes(b, a.dims[b.id]);
    if (!shapes) continue;
    for (const [k, len] of Object.entries(shapes)) {
      const grid = X.gridOf(b, k, len);
      assert.equal(grid.rows * grid.cols, len, `${b.id}.${k}`);
    }
  }
  const d = g.blocks.find((b) => b.id === 'd');
  assert.deepEqual(X.gridOf(d, 'W', 16 * 24), { rows: 16, cols: 24 });
  assert.deepEqual(X.gridOf(d, 'b', 24), { rows: 1, cols: 24 });
  const gru = g.blocks.find((b) => b.id === 'g');
  assert.deepEqual(X.gridOf(gru, 'Wz', (66 + 16) * 16), { rows: 82, cols: 16 });
  assert.deepEqual(X.gridOf({ type: 'foot.move', params: { adjust: true } }, 'Wa', 16 * 2), { rows: 16, cols: 2 });
  assert.deepEqual(X.gridOf({ type: 'hand.choose', params: {} }, 'W', 16), { rows: 16, cols: 1 });
  assert.deepEqual(X.gridOf({ type: 'attention', params: { heads: 2, keyDim: 4 } }, 'Wk', 12 * 8), { rows: 12, cols: 8 });
  assert.deepEqual(X.gridOf({ type: 'dense', params: { units: 7 } }, 'W', 10), { rows: 1, cols: 10 }, 'si no cuadra, una fila');
  assert.ok(outDims(g), 'premisa: plantilla válida');
});

check('cifras de un vector: cuántos, mínimo, máximo, media y norma', () => {
  assert.deepEqual(X.weightStats([3, -4, 0, 1]), { n: 4, min: -4, max: 3, mean: 0, norm: Math.sqrt(26) });
  assert.deepEqual(X.weightStats([]), { n: 0, min: null, max: null, mean: null, norm: 0 });
});

check('escalar pesos: copia nueva con cada clave multiplicada; un factor que no es un número, error', () => {
  const w = { W: [1, -2], b: [0.5] };
  assert.deepEqual(X.scaleWeights(w, 2), { value: { W: [2, -4], b: [1] }, error: null });
  assert.deepEqual(w, { W: [1, -2], b: [0.5] }, 'no toca el original');
  assert.deepEqual(X.scaleWeights(w, 0).value, { W: [0, -0], b: [0] });
  assert.match(X.scaleWeights(w, 'x').error, /número/);
  assert.match(X.scaleWeights(w, Infinity).error, /número/);
});

check('pesos escritos a mano: objeto con listas de números finitos; si no, error en español con dónde', () => {
  assert.deepEqual(X.parseWeights('{"W":[1,2],"b":[0]}'), { value: { W: [1, 2], b: [0] }, error: null });
  assert.match(X.parseWeights('{"W":[1,2]').error, /JSON/);
  assert.match(X.parseWeights('[1,2]').error, /objeto/);
  assert.match(X.parseWeights('{"W":3}').error, /"W".*lista/);
  assert.match(X.parseWeights('{"W":[1,"a"]}').error, /"W".*posición 1/);
  assert.match(X.parseWeights('{"W":[1,null]}').error, /"W".*posición 1/);
});

check('color divergente: negativo naranja, cero gris, positivo cyan; más intenso cuanto más lejos de cero', () => {
  assert.equal(X.divergingColor(0, 1), 'rgb(43,51,66)');
  assert.equal(X.divergingColor(1, 1), 'rgb(79,209,255)');
  assert.equal(X.divergingColor(-1, 1), 'rgb(255,159,67)');
  assert.equal(X.divergingColor(5, 1), X.divergingColor(1, 1), 'recortado');
  assert.equal(X.divergingColor(0.3, 0), X.divergingColor(0, 1), 'sin escala, gris');
  assert.notEqual(X.divergingColor(0.5, 1), X.divergingColor(-0.5, 1));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (cirugía: lógica)');
process.exitCode = fails ? 1 : 0;
