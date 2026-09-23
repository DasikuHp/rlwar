// tools/mutants.mjs: antes del primer mutante corre los tests sobre la copia SIN mutar (con su servidor si --server).
// Si alguno falla ya sin mutante, no hay tirada: un test que falla por otra causa (p. ej. el orden de las suites en un
// mismo servidor) contaría como cazador de todo (spec/00 §4, "Mutantes"). Escrito ANTES del código y congelado.
// Uso: node test/tools-base.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
const tmp = () => mkdtempSync(join(tmpdir(), 'gw-tools-base-'));
const { runMutants } = await import('../tools/mutants.mjs');
const PORT = 8872;

// repo de juguete: lib/val.js, un test que pasa, otro que falla siempre y un servidor mínimo
const toyRepo = () => {
  const root = tmp();
  for (const d of ['lib', 'server', 'test']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'lib', 'val.js'), 'export const K = 5;\n');
  writeFileSync(join(root, 'test', 'ok.spec.mjs'), "import { K } from '../lib/val.js';\nprocess.exitCode = K === 5 ? 0 : 1;\n");
  writeFileSync(join(root, 'test', 'roto.spec.mjs'), "console.log('roto sin mutante');\nprocess.exitCode = 3;\n");
  writeFileSync(join(root, 'server', 'server.js'), "import http from 'node:http';\nhttp.createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT));\n");
  return root;
};

await check('sin servidor: si un test falla ya sin mutante, runMutants no tira ningún mutante y lanza "los tests fallan sin mutante" con el test y su código', async () => {
  const root = toyRepo();
  await assert.rejects(runMutants({ root, file: 'lib/val.js', tests: ['test/ok.spec.mjs', 'test/roto.spec.mjs'], quiet: true, timeoutMs: 20000 }),
    (e) => /los tests fallan sin mutante/.test(e.message) && /test\/roto\.spec\.mjs/.test(e.message) && /sale 3/.test(e.message));
});

await check('con servidor: igual, con el servidor de la copia sin mutar (y el puerto queda libre)', async () => {
  const root = toyRepo();
  await assert.rejects(runMutants({ root, file: 'lib/val.js', tests: ['test/roto.spec.mjs'], server: true, port: PORT, quiet: true, timeoutMs: 20000 }),
    (e) => /los tests fallan sin mutante/.test(e.message) && /roto/.test(e.message));
  let up = false; try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch { /* libre */ }
  assert.equal(up, false, 'el servidor de la línea base está apagado');
});

await check('si los tests pasan sin mutante, la tirada sigue como siempre (K = 5 → los mutantes de la constante se cazan)', async () => {
  const root = toyRepo();
  const r = await runMutants({ root, file: 'lib/val.js', tests: ['test/ok.spec.mjs'], quiet: true, timeoutMs: 20000 });
  assert.ok(r.results.length >= 2 && r.results.every((m) => m.killed), JSON.stringify(r.results.map((m) => [m.desc, m.killed])));
});

await check('CLI: con un test roto sin mutante sale 1 y lo dice', () => {
  const root = toyRepo();
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'mutants.mjs'), 'lib/val.js', '--tests', 'test/roto.spec.mjs', '--root', root], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /los tests fallan sin mutante/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (herramientas: línea base de los mutantes)');
process.exitCode = fails ? 1 : 0;
