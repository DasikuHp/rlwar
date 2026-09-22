// F1 — PRNG con semilla (spec/00 §1): secuencia FIJADA (para que las repeticiones no cambien
// entre versiones), rangos y distribución. Sin servidor.
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const { makeRng, gaussFrom, randomSeed } = await import('../shared/rng.js');

check('secuencia fijada: makeRng(42) y makeRng(1) dan siempre los mismos primeros valores (mulberry32)', () => {
  const a = makeRng(42), b = makeRng(1);
  assert.deepEqual([a(), a(), a()], [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  assert.deepEqual([b(), b(), b()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const c = makeRng(7);
  assert.deepEqual([c.int(100), c.int(100), c.int(100), c.pick(['a', 'b', 'c'])], [1, 6, 97, 'c']);
  assert.equal(makeRng(42).seed, 42);
  assert.equal(makeRng(0).seed, 0);
  assert.notEqual(makeRng(0)(), makeRng(1)());
});

check('semilla inválida o ausente → se sortea una válida (entero en [0, 2^31))', () => {
  for (const s of [undefined, null, -1, 2 ** 31, 1.5, 'x', NaN]) {
    const r = makeRng(s);
    assert.ok(Number.isInteger(r.seed) && r.seed >= 0 && r.seed < 2 ** 31, String(s));
  }
  const s = randomSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 31);
  assert.deepEqual([makeRng(5)(), makeRng(5)()], [makeRng(5)(), makeRng(5)()]);
});

check('distribución: float uniforme en [0,1), int en [0,n) sin sesgo grosero, gauss ~ N(0,1)', () => {
  const r = makeRng(123);
  let sum = 0, min = 1, max = 0;
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) { const v = r(); sum += v; min = Math.min(min, v); max = Math.max(max, v); buckets[Math.floor(v * 10)]++; }
  assert.ok(min >= 0 && max < 1);
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01, `media ${sum / 20000}`);
  for (const b of buckets) assert.ok(b > 1700 && b < 2300, `cubo ${b}`);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 14000; i++) counts[r.int(7)]++;
  for (const c of counts) assert.ok(c > 1700 && c < 2300, `int ${c}`);
  let gs = 0, gs2 = 0;
  for (let i = 0; i < 20000; i++) { const g = gaussFrom(r); gs += g; gs2 += g * g; }
  assert.ok(Math.abs(gs / 20000) < 0.03 && Math.abs(gs2 / 20000 - 1) < 0.05, `gauss media ${gs / 20000} var ${gs2 / 20000}`);
  assert.ok(Number.isFinite(r.gauss()));
  assert.ok(Number.isFinite(gaussFrom()), 'sin rng usa Math.random');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (rng F1)');
process.exit(fails ? 1 : 0);
