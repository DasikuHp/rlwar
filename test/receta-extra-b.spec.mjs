// Receta de entreno, casos de la auditoría de la sesión 3 (2026-09-24). Escrito ANTES del arreglo y congelado.
// - A3 (spec/04 §11.7): "el estado de Adam no se versiona: si la estructura cambió, se reinicia solo al cargarse". Antes
//   solo se miraba cuántos parámetros había: una red con los mismos bloques en otro orden (mismo número de parámetros,
//   otra disposición) heredaba los momentos de otros pesos.
// - Parar es parar (spec/04 §11.6): si se para durante el examen de después, el entreno acaba parado y sin `exam.after`
//   (ni evento, ni línea en el registro, ni boletín nuevo). Antes acababa `done` y con el examen.
// Uso: node test/receta-extra-b.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-receta-extra-b-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');
const { compile } = await import('../shared/nn.js');
const layout = (net) => net.paramList().map((p) => `${p.blockId}.${p.key}:${p.array.length}`).join(' ');

// ---------- A3: Adam y la estructura ----------
await check('Adam se reinicia al cargarse si cambió la disposición de los parámetros aunque su número sea el mismo', () => {
  const g1 = normalize({ ...clone(TEMPLATES.sniper.genome), id: 'adam-a3', name: 'A3' });
  const g2 = normalize({ ...clone(g1), blocks: clone(g1.blocks).reverse() }); // los mismos bloques en otro orden
  const n1 = compile(g1), n2 = compile(g2);
  assert.equal(n1.paramCount(), n2.paramCount(), 'premisa: mismo número de parámetros');
  assert.notEqual(layout(n1), layout(n2), 'premisa: otra disposición');
  const dir = mkdtempSync(join(tmpdir(), 'gw-a3-'));
  const o = T.adamInit(n1); o.m.fill(0.5); o.v.fill(0.25); o.t = 7;
  T.saveOptim(o, dir);
  const same = T.loadOptim(n1, dir);
  assert.equal(same.t, 7, 'la misma red recupera su Adam');
  assert.ok(same.m.every((x) => x === 0.5) && same.v.every((x) => x === 0.25));
  const other = T.loadOptim(n2, dir);
  assert.equal(other.t, 0, 'otra disposición: Adam empieza de cero');
  assert.ok(other.m.every((x) => x === 0) && other.v.every((x) => x === 0));
  assert.equal(other.m.length, n2.paramCount());
});

await check('Adam de un fichero antiguo (sin la disposición guardada) empieza de cero: no se puede saber si la estructura cambió', async () => {
  const { writeFileSync } = await import('node:fs');
  const n1 = compile(normalize({ ...clone(TEMPLATES.sniper.genome), id: 'adam-a3b', name: 'A3b' }));
  const dir = mkdtempSync(join(tmpdir(), 'gw-a3b-'));
  const k = n1.paramCount();
  writeFileSync(join(dir, 'optim.json'), JSON.stringify({ m: Array(k).fill(0.5), v: Array(k).fill(0.25), t: 9, mean: { mean: 0, n: 0 } }));
  const o = T.loadOptim(n1, dir);
  assert.equal(o.t, 0);
  assert.ok(o.m.every((x) => x === 0));
});

// ---------- parar durante el examen de después ----------
await check('parar durante el examen de después: el entreno acaba parado, sin exam.after, sin evento ni línea "after" y sin boletín nuevo', async () => {
  const r0 = store.saveNet({ ...clone(TEMPLATES.sniper.genome), id: 'para-examen', name: 'para-examen' }); assert.ok(r0.ok);
  const t = T.createTrainer({ netId: 'para-examen', speed: 'turbo', workers: 1, duration: { games: 2 }, soldiers: 1, seed: 4600,
    opponents: { antagonist: 0, hallOfFame: 0, self: 1 }, exam: true });
  const exams = [], dones = [];
  let stoppedIn = null;
  t.on('training', () => { if (t.phase === 'exam-after' && !stoppedIn) { stoppedIn = t.phase; t.stop(); } });
  t.on('exam', (d) => exams.push(d.when));
  t.on('done', (d) => dones.push(d.reason));
  await t.start();
  assert.equal(stoppedIn, 'exam-after', 'premisa: se paró durante el examen de después');
  assert.equal(t.status, 'stopped');
  assert.ok(t.exam && t.exam.before, 'el examen de antes sí se hizo');
  assert.equal(t.exam.after, undefined, 'sin examen de después');
  assert.deepEqual(exams, ['before']);
  assert.deepEqual(dones, ['stopped']);
  const logFile = join(process.env.GW_EVO_DIR, 'log.jsonl');
  const lines = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  assert.ok(lines.some((e) => e.type === 'exam' && e.trainingId === t.id && e.when === 'before'), 'premisa: el registro lleva el examen de antes');
  assert.ok(!lines.some((e) => e.type === 'exam' && e.trainingId === t.id && e.when === 'after'), 'sin línea "after" en el registro');
  assert.ok(!existsSync(join(store.netsDir(), 'para-examen', 'bulletin.json')), 'sin boletín nuevo');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (receta de entreno: Adam por estructura y parar en el examen)');
process.exitCode = fails ? 1 : 0;
