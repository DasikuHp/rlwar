// Batería completa de tests: parser/solver + partida humana simulada + self-play de agentes.
// Levanta su propio servidor en modo rápido (GW_FAST) y lo apaga al terminar.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFrozen, describeCheck } from '../tools/freeze.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 8791);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(label, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => resolve({ label, ok: code === 0 }));
  });
}

async function waitHealth(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* aún no */ }
    await sleep(300);
  }
  return false;
}

// Tests congelados (spec/00 §4): si alguna huella no coincide, no se corre nada.
const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const fz = checkFrozen(rootArg >= 0 ? args[rootArg + 1] : ROOT);
console.log(describeCheck(fz));
if (!fz.ok) { console.log('\nFAIL ✘ (tests congelados modificados: OK del usuario + motivo escrito + tools/freeze.mjs)'); process.exit(1); }
if (args.includes('--check-only')) process.exit(0);

const server = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], {
  env: { ...process.env, GW_FAST: '1', PORT: String(PORT), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-test-')) }, stdio: 'ignore',
});

const results = [];
try {
  if (!await waitHealth()) throw new Error('el servidor de test no arrancó');
  console.log(`\n=== servidor de test en ${BASE} ===\n`);
  results.push(await run('parser + solver', [join(ROOT, 'test', 'parser.spec.mjs')]));
  results.push(await run('partida agente vs CPU', [join(ROOT, 'test', 'smoke.mjs'), BASE]));
  results.push(await run('self-play de agentes', [join(ROOT, 'test', 'agents.spec.mjs'), BASE]));
  results.push(await run('cliente (DOM simulado)', [join(ROOT, 'test', 'client.spec.mjs')]));
  results.push(await run('selector de tropas (F0)', [join(ROOT, 'test', 'troops.spec.mjs')]));
  results.push(await run('herramientas: congelado y mutantes', [join(ROOT, 'test', 'tools.spec.mjs')]));
  results.push(await run('motor (F1): movimiento, semilla, sin pantalla', [join(ROOT, 'test', 'motor.spec.mjs'), BASE]));
  results.push(await run('geometría (F1): propiedades del deslizamiento', [join(ROOT, 'test', 'geometry.spec.mjs')]));
  results.push(await run('rng (F1): secuencia fijada y distribución', [join(ROOT, 'test', 'rng.spec.mjs')]));
  results.push(await run('movimiento de heurísticos (F1)', [join(ROOT, 'test', 'moves.spec.mjs')]));
  results.push(await run('sala sin pantalla (F1)', [join(ROOT, 'test', 'rooms.spec.mjs')]));
  results.push(await run('red (F2): genoma, validación, cálculo y BPTT', [join(ROOT, 'test', 'red.spec.mjs')]));
  results.push(await run('genoma (F2): defaults fijados y validación', [join(ROOT, 'test', 'genoma.spec.mjs')]));
  results.push(await run('percepción (F3): ojos, Imaginación, ajuste, destinos', [join(ROOT, 'test', 'percepcion.spec.mjs')]));
  results.push(await run('percepción (F3): casos extra', [join(ROOT, 'test', 'percepcion-extra.spec.mjs')]));
  results.push(await run('política (F3): decisión, agente-red, almacén, sala', [join(ROOT, 'test', 'politica.spec.mjs')]));
  results.push(await run('API del laboratorio: catálogo, plantillas, redes', [join(ROOT, 'test', 'api-lab.spec.mjs'), BASE]));
} finally {
  server.kill();
}

console.log('\n=== resumen ===');
for (const r of results) console.log(` ${r.ok ? '✔' : '✘'} ${r.label}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nFAIL ✘ (${failed})` : '\nTODO OK ✔');
process.exit(failed ? 1 : 0);
