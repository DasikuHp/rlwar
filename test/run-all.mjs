// Batería completa de tests: parser/solver + partida humana simulada + self-play de agentes.
// Levanta su propio servidor en modo rápido (GW_FAST) y lo apaga al terminar.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const server = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], {
  env: { ...process.env, GW_FAST: '1', PORT: String(PORT) }, stdio: 'ignore',
});

const results = [];
try {
  if (!await waitHealth()) throw new Error('el servidor de test no arrancó');
  console.log(`\n=== servidor de test en ${BASE} ===\n`);
  results.push(await run('parser + solver', [join(ROOT, 'test', 'parser.spec.mjs')]));
  results.push(await run('partida agente vs CPU', [join(ROOT, 'test', 'smoke.mjs'), BASE]));
  results.push(await run('self-play de agentes', [join(ROOT, 'test', 'agents.spec.mjs'), BASE]));
} finally {
  server.kill();
}

console.log('\n=== resumen ===');
for (const r of results) console.log(` ${r.ok ? '✔' : '✘'} ${r.label}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nFAIL ✘ (${failed})` : '\nTODO OK ✔');
process.exit(failed ? 1 : 0);
