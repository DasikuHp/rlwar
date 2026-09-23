// tools/mutants.mjs con servidor y por líneas (spec/00 §4, "Mutantes"): --lines filtra antes de --max; --server
// levanta el servidor de la copia ya mutada (GW_FAST, puerto propio, GW_EVO_DIR nuevo), pasa la URL a los tests
// y lo apaga entre mutantes; un servidor mutado que no arranca cuenta como cazado. Congelado.
// Uso: node test/tools-servidor.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const tmp = () => mkdtempSync(join(tmpdir(), 'gw-tools-srv-'));
const { generateMutants, runMutants } = await import('../tools/mutants.mjs');
const PORT = 8871;
const up = async (port) => { try { return (await fetch(`http://localhost:${port}/api/health`)).ok; } catch { return false; } };

// repo de juguete: un servidor que lee lib/val.js y lib/boot.js, y un test que solo habla con él por HTTP
const toyRepo = () => {
  const root = tmp();
  for (const d of ['lib', 'server', 'test']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'lib', 'val.js'), 'export const K = 5;\nexport const J = 7;\n');
  writeFileSync(join(root, 'lib', 'boot.js'), 'export const OK = true;\n');
  writeFileSync(join(root, 'server', 'server.js'), [
    "import http from 'node:http';",
    "import { existsSync, writeFileSync, statSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { K } from '../lib/val.js';",
    "import { OK } from '../lib/boot.js';",
    'if (!OK) process.exit(3);',
    'const evo = process.env.GW_EVO_DIR;',
    'http.createServer((req, res) => {',
    "  if (req.url === '/api/health') { res.end('ok'); return; }",
    "  const fresh = !existsSync(join(evo, 'marker')); writeFileSync(join(evo, 'marker'), '1');",
    "  res.end(JSON.stringify({ k: K, fast: process.env.GW_FAST, port: process.env.PORT, evoIsDir: statSync(evo).isDirectory(), fresh }));",
    '}).listen(Number(process.env.PORT));',
  ].join('\n') + '\n');
  writeFileSync(join(root, 'test', 'k.spec.mjs'), [
    'const base = process.argv[2];',
    "if (!base) { console.log('sin URL'); process.exit(2); }",
    "const r = await (await fetch(base + '/k')).json();",
    `const ok = r.k === 5 && r.fast === '1' && r.port === '${PORT}' && base === 'http://localhost:${PORT}' && r.evoIsDir && r.fresh;`,
    "console.log(JSON.stringify(r)); process.exitCode = ok ? 0 : 1;",
  ].join('\n') + '\n');
  return root;
};

await check('--lines: solo los mutantes de esas líneas, y el filtro va antes de --max', async () => {
  const root = tmp(); mkdirSync(join(root, 'lib')); mkdirSync(join(root, 'test'));
  const src = 'export const a = 1 + 2;\nexport const b = 3 * 4;\nexport const c = 5 - 6;\n';
  writeFileSync(join(root, 'lib', 'm.js'), src);
  writeFileSync(join(root, 'test', 'ok.spec.mjs'), "console.log('PASS');\n");
  const onLine = (l) => generateMutants(src).filter((m) => m.line === l).length;
  const r2 = await runMutants({ root, file: 'lib/m.js', tests: ['test/ok.spec.mjs'], lines: '2', quiet: true, timeoutMs: 20000 });
  assert.ok(r2.total > 0 && r2.results.every((m) => m.line === 2), `solo la línea 2: ${r2.results.map((m) => m.line)}`);
  assert.equal(r2.total, onLine(2)); assert.equal(r2.possible, generateMutants(src).length, 'possible sigue contando todos');
  const r13 = await runMutants({ root, file: 'lib/m.js', tests: ['test/ok.spec.mjs'], lines: '1,3', quiet: true, timeoutMs: 20000 });
  assert.equal(r13.total, onLine(1) + onLine(3)); assert.ok(r13.results.every((m) => m.line === 1 || m.line === 3));
  const rr = await runMutants({ root, file: 'lib/m.js', tests: ['test/ok.spec.mjs'], lines: '2-3', max: 2, seed: 5, quiet: true, timeoutMs: 20000 });
  assert.equal(rr.total, 2); assert.ok(rr.results.every((m) => m.line === 2 || m.line === 3), 'la muestra sale de las líneas pedidas');
});

await check('--server: el servidor es el de la copia mutada (K cazado por HTTP, J sobrevive), con GW_FAST, su puerto, la URL al test y un GW_EVO_DIR nuevo por mutante; al acabar, el puerto está libre y el original intacto', async () => {
  const root = toyRepo();
  assert.equal(await up(PORT), false, `el puerto ${PORT} está libre antes de empezar`);
  const r = await runMutants({ root, file: 'lib/val.js', tests: ['test/k.spec.mjs'], server: true, port: PORT, quiet: true, timeoutMs: 20000 });
  const k = r.results.filter((m) => m.line === 1), j = r.results.filter((m) => m.line === 2);
  assert.ok(k.length >= 2 && j.length >= 2, `mutantes en K y en J (${k.length}, ${j.length})`);
  for (const m of k) { assert.equal(m.killed, true, `K: ${m.desc}`); assert.match(m.detail, /sale 1/); }
  for (const m of j) assert.equal(m.killed, false, `J sobrevive: ${m.desc} (${m.detail})`);
  assert.equal(await up(PORT), false, 'el servidor del último mutante está apagado');
  assert.equal(readFileSync(join(root, 'lib', 'val.js'), 'utf8'), 'export const K = 5;\nexport const J = 7;\n');
});

await check('--server: si el servidor mutado sale antes de responder, el mutante cuenta como cazado ("el servidor no arranca")', async () => {
  const root = toyRepo();
  const t0 = Date.now();
  const r = await runMutants({ root, file: 'lib/boot.js', tests: ['test/k.spec.mjs'], server: true, port: PORT, quiet: true, timeoutMs: 20000 });
  const m = r.results.find((x) => x.from === 'true' && x.to === 'false');
  assert.ok(m, 'existe el mutante true → false');
  assert.equal(m.killed, true); assert.equal(m.detail, 'el servidor no arranca');
  assert.ok(Date.now() - t0 < 15000, `no espera los 20 s si el servidor ya salió (${Date.now() - t0} ms)`);
});

await check('CLI: --lines, --server y --port llegan a runMutants (tabla solo con esa línea y "con servidor" en la cabecera)', () => {
  const root = toyRepo();
  const out = spawnSync(process.execPath, [join(ROOT, 'tools', 'mutants.mjs'), 'lib/val.js', '--tests', 'test/k.spec.mjs', '--root', root, '--lines', '1', '--server', '--port', String(PORT), '--timeout', '20000'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /con servidor/);
  const rows = out.stdout.split('\n').filter((l) => /^\s+\d+\s+\d+\s/.test(l));
  assert.ok(rows.length >= 2 && rows.every((l) => /^\s+\d+\s+1\s/.test(l)), rows.join('\n'));
  assert.match(out.stdout, /cazados (\d+)\/\1/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (herramientas: mutantes con servidor y por líneas)');
process.exitCode = fails ? 1 : 0;
