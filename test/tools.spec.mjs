// Herramientas de proceso (spec/00 §4): congelado de tests (tools/freeze.mjs) y prueba de mutantes
// (tools/mutants.mjs). Escrito ANTES del código. Sin dependencias, sin servidor.
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const tmp = () => mkdtempSync(join(tmpdir(), 'gw-tools-'));
const run = (args, cwd = ROOT) => spawnSync(NODE, args, { cwd, encoding: 'utf8', timeout: 60000 });

const { hashFile, hashText, checkFrozen } = await import('../tools/freeze.mjs');
const { generateMutants, applyMutant, runMutants } = await import('../tools/mutants.mjs');

// ---------- freeze ----------
await check('hashText: mismo hash con LF y con CRLF (huellas estables en Windows)', () => {
  const a = hashText('const x = 1;\nconst y = 2;\n');
  const b = hashText('const x = 1;\r\nconst y = 2;\r\n');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashText('const x = 1;\nconst y = 3;\n'));
});

await check('freeze CLI escribe FROZEN.json con rutas relativas POSIX y hashes', () => {
  const root = tmp();
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'a.spec.mjs'), 'console.log(1);\n');
  writeFileSync(join(root, 'test', 'b.spec.mjs'), 'console.log(2);\n');
  const r = run([join(ROOT, 'tools', 'freeze.mjs'), '--root', root, 'test/a.spec.mjs', 'test\\b.spec.mjs']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const frozen = JSON.parse(readFileSync(join(root, 'test', 'FROZEN.json'), 'utf8'));
  assert.deepEqual(Object.keys(frozen), ['test/a.spec.mjs', 'test/b.spec.mjs']);
  assert.equal(frozen['test/a.spec.mjs'], hashFile(join(root, 'test', 'a.spec.mjs')));
  // congelar de nuevo solo uno conserva el otro (fusiona)
  writeFileSync(join(root, 'test', 'a.spec.mjs'), 'console.log(11);\n');
  const r2 = run([join(ROOT, 'tools', 'freeze.mjs'), '--root', root, 'test/a.spec.mjs']);
  assert.equal(r2.status, 0, r2.stderr);
  const frozen2 = JSON.parse(readFileSync(join(root, 'test', 'FROZEN.json'), 'utf8'));
  assert.equal(frozen2['test/b.spec.mjs'], frozen['test/b.spec.mjs']);
  assert.notEqual(frozen2['test/a.spec.mjs'], frozen['test/a.spec.mjs']);
});

await check('checkFrozen: detecta un byte cambiado y un fichero que falta', () => {
  const root = tmp();
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'a.spec.mjs'), 'const a = 1;\n');
  writeFileSync(join(root, 'test', 'FROZEN.json'), JSON.stringify({
    'test/a.spec.mjs': hashText('const a = 1;\n'),
    'test/gone.spec.mjs': hashText('nada'),
  }));
  const r0 = checkFrozen(root);
  assert.equal(r0.ok, false);
  assert.deepEqual(r0.missing, ['test/gone.spec.mjs']);
  assert.deepEqual(r0.mismatches, []);
  writeFileSync(join(root, 'test', 'FROZEN.json'), JSON.stringify({ 'test/a.spec.mjs': hashText('const a = 1;\n') }));
  assert.equal(checkFrozen(root).ok, true);
  writeFileSync(join(root, 'test', 'a.spec.mjs'), 'const a = 2;\n');
  const r1 = checkFrozen(root);
  assert.equal(r1.ok, false);
  assert.equal(r1.mismatches.length, 1);
  assert.equal(r1.mismatches[0].file, 'test/a.spec.mjs');
});

await check('checkFrozen sin FROZEN.json → ok con aviso (nada congelado aún)', () => {
  const root = tmp();
  const r = checkFrozen(root);
  assert.equal(r.ok, true);
  assert.equal(r.frozen, 0);
});

await check('run-all --check-only: sale 1 si una huella no coincide y 0 si coinciden', () => {
  const root = tmp();
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'a.spec.mjs'), 'ok\n');
  writeFileSync(join(root, 'test', 'FROZEN.json'), JSON.stringify({ 'test/a.spec.mjs': hashText('otro\n') }));
  const bad = run([join(ROOT, 'test', 'run-all.mjs'), '--check-only', '--root', root]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout + bad.stderr, /a\.spec\.mjs/);
  writeFileSync(join(root, 'test', 'FROZEN.json'), JSON.stringify({ 'test/a.spec.mjs': hashText('ok\n') }));
  const good = run([join(ROOT, 'test', 'run-all.mjs'), '--check-only', '--root', root]);
  assert.equal(good.status, 0, good.stdout + good.stderr);
});

// ---------- mutants: generador ----------
const TOY = [
  '// suma: a + b (esto es un comentario con + y < y true)',
  "const S = 'a + b <= c';",
  'export function add(a, b) { return a + b; }',
  'export function big(x) { return x < 3; }',
  'export function neg(x) { return -x; }',
  'export function flag() { return true; }',
  'export const K = 0;',
  'export const R = /a\\+b/;',
].join('\n') + '\n';

await check('generateMutants: opera sobre operadores, números y booleanos; no toca comentarios, cadenas ni regex', () => {
  const ms = generateMutants(TOY);
  const at = (line) => ms.filter((m) => m.line === line);
  assert.equal(at(1).length, 0, 'comentario intacto');
  assert.equal(at(2).length, 0, 'cadena intacta');
  assert.equal(at(8).length, 0, 'regex intacta');
  assert.ok(at(3).some((m) => m.from === '+' && m.to === '-'), 'a + b → a - b');
  assert.ok(at(3).some((m) => m.from === 'return a + b;' && m.to === 'return null;'), 'return → null');
  assert.ok(at(4).some((m) => m.from === '<' && m.to === '<='), '< → <=');
  assert.ok(at(4).some((m) => m.from === '3' && m.to === '4'), '3 → 4');
  assert.ok(at(4).some((m) => m.from === '3' && m.to === '0'), '3 → 0');
  assert.ok(at(4).some((m) => m.from === '3' && m.to === '-3'), '3 → -3');
  assert.ok(at(5).some((m) => m.from === '-' && m.to === '+'), 'unario -x → +x');
  assert.ok(at(6).some((m) => m.from === 'true' && m.to === 'false'), 'true → false');
  assert.ok(at(7).some((m) => m.from === '0' && m.to === '1'), '0 → 1');
  assert.ok(!at(7).some((m) => m.from === '0' && m.to === '0'), 'nada de mutantes idénticos');
  for (const m of ms) { assert.ok(m.line >= 1 && typeof m.col === 'number' && m.desc, 'cada mutante tiene línea, columna y descripción'); }
});

await check('generateMutants: === ↔ !==, && ↔ ||, > ↔ >=, * ↔ /', () => {
  const src = 'export const f = (a, b) => a === b && a > 0 || a * b >= 2 && a !== b;\n';
  const ms = generateMutants(src);
  const pairs = [['===', '!=='], ['&&', '||'], ['>', '>='], ['||', '&&'], ['*', '/'], ['>=', '>'], ['!==', '===']];
  for (const [from, to] of pairs) assert.ok(ms.some((m) => m.from === from && m.to === to), `${from} → ${to}`);
});

await check('applyMutant: cambia solo ese sitio y el resultado sigue siendo distinto del original', () => {
  const ms = generateMutants(TOY);
  const m = ms.find((x) => x.line === 3 && x.from === '+');
  const out = applyMutant(TOY, m);
  assert.notEqual(out, TOY);
  assert.ok(out.includes('return a - b;'));
  assert.ok(out.includes('return -x;'), 'el resto intacto');
  assert.equal(out.split('\n').length, TOY.split('\n').length);
});

await check('generateMutants es determinista y no genera mutantes en un fichero vacío', () => {
  assert.deepEqual(generateMutants(''), []);
  assert.deepEqual(generateMutants(TOY), generateMutants(TOY));
});

// ---------- mutants: extremo a extremo ----------
await check('runMutants: caza el + → - de add y reporta superviviente en neg (sin test)', async () => {
  const root = tmp();
  mkdirSync(join(root, 'lib'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'lib', 'sum.js'), 'export function add(a, b) { return a + b; }\nexport function neg(x) { return -x; }\n');
  writeFileSync(join(root, 'test', 'sum.spec.mjs'), "import { add } from '../lib/sum.js';\nif (add(2, 3) !== 5) { console.log('FAIL'); process.exit(1); }\nconsole.log('PASS');\n");
  const r = await runMutants({ root, file: 'lib/sum.js', tests: ['test/sum.spec.mjs'], timeoutMs: 20000, quiet: true });
  assert.ok(r.total >= 3, 'hay mutantes: ' + r.total);
  const addMut = r.results.find((m) => m.line === 1 && m.from === '+' && m.to === '-');
  assert.ok(addMut && addMut.killed === true, 'add + → - cazado');
  const negMut = r.results.find((m) => m.line === 2 && m.from === '-' && m.to === '+');
  assert.ok(negMut && negMut.killed === false, 'neg -x → +x sobrevive');
  assert.equal(r.killed + r.survived, r.total);
  assert.ok(r.survivors.some((s) => s.line === 2), 'la lista de supervivientes incluye la línea 2');
  // el original no se ha tocado
  assert.ok(readFileSync(join(root, 'lib', 'sum.js'), 'utf8').includes('return a + b;'));
  assert.ok(readFileSync(join(root, 'lib', 'sum.js'), 'utf8').includes('return -x;'));
  assert.ok(!existsSync(join(root, '.mutants')) || true, 'directorio de trabajo opcional');
});

await check('runMutants: un test que revienta por tiempo cuenta como cazado', async () => {
  const root = tmp();
  mkdirSync(join(root, 'lib'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'lib', 'loop.js'), 'export function n(i) { return i < 3 ? i : 3; }\n');
  writeFileSync(join(root, 'test', 'loop.spec.mjs'), "import { n } from '../lib/loop.js';\nlet i = 0; while (n(i) !== 3) i++;\nconsole.log('PASS');\n");
  const r = await runMutants({ root, file: 'lib/loop.js', tests: ['test/loop.spec.mjs'], timeoutMs: 3000, quiet: true });
  const m = r.results.find((x) => x.from === '<' && x.to === '<=');
  assert.ok(m, 'existe el mutante < → <=');
  // con <=, n(3) devuelve 3 igualmente: sobrevive; con "3 → 4" el bucle no termina → tiempo → cazado
  const t = r.results.find((x) => x.from === '3' && x.to === '4' && x.line === 1);
  assert.ok(t && t.killed === true && t.timeout === true, '3 → 4 cazado por tiempo');
});

await check('mutants CLI: imprime tabla y resumen "cazados X/Y" y sale 0', () => {
  const root = tmp();
  mkdirSync(join(root, 'lib'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'lib', 'sum.js'), 'export function add(a, b) { return a + b; }\n');
  writeFileSync(join(root, 'test', 'sum.spec.mjs'), "import { add } from '../lib/sum.js';\nif (add(2, 3) !== 5) process.exit(1);\n");
  const r = run([join(ROOT, 'tools', 'mutants.mjs'), 'lib/sum.js', '--tests', 'test/sum.spec.mjs', '--root', root, '--max', '2', '--seed', '1']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /cazados \d+\/\d+/);
  assert.match(r.stdout, /línea/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (herramientas de proceso)');
process.exit(fails ? 1 : 0);
