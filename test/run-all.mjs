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
  results.push(await run('herramientas: mutantes por líneas y con servidor', [join(ROOT, 'test', 'tools-servidor.spec.mjs')]));
  results.push(await run('herramientas: línea base de los mutantes', [join(ROOT, 'test', 'tools-base.spec.mjs')]));
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
  results.push(await run('aprendizaje (F4): recompensa, gradiente, tareas, entrenador', [join(ROOT, 'test', 'aprendizaje.spec.mjs')]));
  results.push(await run('aprendizaje (F4): casos extra', [join(ROOT, 'test', 'aprendizaje-extra.spec.mjs')]));
  results.push(await run('entrenador (F4): casos extra 2', [join(ROOT, 'test', 'entrenador-extra.spec.mjs')]));
  results.push(await run('entrenador (F4): casos extra 3', [join(ROOT, 'test', 'entrenador-extra-b.spec.mjs')]));
  results.push(await run('API de entrenos (F4)', [join(ROOT, 'test', 'api-trainings.spec.mjs'), BASE]));
  results.push(await run('evolución (F5): mutación, diferencias, pre-torneo, Imaginación por uso', [join(ROOT, 'test', 'evolucion.spec.mjs')]));
  results.push(await run('evolución (F5): casos extra', [join(ROOT, 'test', 'evolucion-extra.spec.mjs')]));
  results.push(await run('API de evolución (F5): hijos, diff, cirugía, importar', [join(ROOT, 'test', 'api-evolucion.spec.mjs'), BASE]));
  results.push(await run('trono (F6): duelos, reto, liga, genealogía, dinastías', [join(ROOT, 'test', 'trono.spec.mjs')]));
  results.push(await run('API de trono (F6): duelos, trono, dinastías, explotadora', [join(ROOT, 'test', 'api-trono.spec.mjs'), BASE]));
  results.push(await run('verdad (F7): frases, confianza, emoción, memoria, boletín, neuronas, registro', [join(ROOT, 'test', 'verdad.spec.mjs')]));
  results.push(await run('API de la verdad (F7): moviola, boletín, diario, neuronas, bofetada', [join(ROOT, 'test', 'api-verdad.spec.mjs'), BASE]));
  results.push(await run('arreglos del motor: fuego amigo, turno siempre cerrado, sala x10', [join(ROOT, 'test', 'arreglos-motor.spec.mjs'), BASE]));
  results.push(await run('arreglos del aprendizaje: cada partida es un mundo aparte', [join(ROOT, 'test', 'arreglos-partidas.spec.mjs')]));
  results.push(await run('arreglos del aprendizaje: gradiente, evolución o ambos', [join(ROOT, 'test', 'arreglos-metodo.spec.mjs')]));
  results.push(await run('arreglos: exhibiciones que cuentan, se guardan y enseñan', [join(ROOT, 'test', 'arreglos-exhibicion.spec.mjs'), BASE]));
  results.push(await run('arreglos: bofetada y caricia con efecto inmediato', [join(ROOT, 'test', 'arreglos-bofetada.spec.mjs'), BASE]));
  results.push(await run('arreglos: trono protegido, retos anulados, ids de duelo únicos', [join(ROOT, 'test', 'arreglos-trono.spec.mjs'), BASE]));
  results.push(await run('arreglos: boletín con blanco inofensivo y adaptación equilibrada', [join(ROOT, 'test', 'arreglos-boletin.spec.mjs')]));
  results.push(await run('arreglos: voz verificada de las redes en la sala', [join(ROOT, 'test', 'arreglos-voz.spec.mjs')]));
  results.push(await run('arreglos: rutas que faltaban, retención y shared/ en el navegador', [join(ROOT, 'test', 'arreglos-api.spec.mjs'), BASE]));
  results.push(await run('arreglos (revisión de Fable): red ocupada y evolución que cede el bucle', [join(ROOT, 'test', 'arreglos-ocupada.spec.mjs'), BASE]));
  results.push(await run('arreglos (revisión de Fable): red ocupada, casos extra', [join(ROOT, 'test', 'arreglos-ocupada-extra.spec.mjs')]));
  results.push(await run('arreglos (revisión de Fable): método de aprendizaje, casos extra', [join(ROOT, 'test', 'arreglos-metodo-extra.spec.mjs')]));
  results.push(await run('arreglos: voz, casos extra (huecos de mutantes de A3)', [join(ROOT, 'test', 'arreglos-voz-extra.spec.mjs')]));
  results.push(await run('arreglos (revisión de Fable): red ocupada y huecos de mutantes, casos extra b', [join(ROOT, 'test', 'arreglos-ocupada-extra-b.spec.mjs'), BASE]));
  results.push(await run('parte 3: sala y servidor (M7, R5, M10, B2, B4)', [join(ROOT, 'test', 'arreglos-sala.spec.mjs'), BASE]));
  results.push(await run('parte 3: verdad y registro (M1, M3, M4, M5, M6, M8)', [join(ROOT, 'test', 'arreglos-verdad.spec.mjs'), BASE]));
  results.push(await run('parte 3: almacenamiento (M2, M9, M15, B3)', [join(ROOT, 'test', 'arreglos-almacen.spec.mjs'), BASE]));
  results.push(await run('parte 3: liga y validación (M11, M13, B1)', [join(ROOT, 'test', 'arreglos-liga.spec.mjs'), BASE]));
  results.push(await run('parte 3: moviola de una partida antigua (sin copia de la red)', [join(ROOT, 'test', 'moviola-antigua.spec.mjs')]));
  results.push(await run('interfaz: editor de redes (lógica)', [join(ROOT, 'test', 'ui-editor.spec.mjs')]));
  results.push(await run('interfaz: editor de redes, casos extra', [join(ROOT, 'test', 'ui-editor-extra.spec.mjs')]));
  results.push(await run('interfaz: inicio del laboratorio (lógica)', [join(ROOT, 'test', 'ui-inicio.spec.mjs')]));
  results.push(await run('interfaz: sala viva con redes (lógica)', [join(ROOT, 'test', 'ui-sala.spec.mjs')]));
  results.push(await run('interfaz: entreno (lógica)', [join(ROOT, 'test', 'ui-entreno.spec.mjs')]));
  results.push(await run('interfaz: evolución, hijos y diferencias (lógica)', [join(ROOT, 'test', 'ui-evolucion.spec.mjs')]));
} finally {
  server.kill();
}

console.log('\n=== resumen ===');
for (const r of results) console.log(` ${r.ok ? '✔' : '✘'} ${r.label}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nFAIL ✘ (${failed})` : '\nTODO OK ✔');
process.exit(failed ? 1 : 0);
