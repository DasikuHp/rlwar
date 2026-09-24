// Batería completa de tests: parser/solver + partida humana simulada + self-play de agentes.
// Levanta su propio servidor en modo rápido (GW_FAST) y lo apaga al terminar.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFrozen, describeCheck } from '../tools/freeze.mjs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 8791);
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(label, args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => resolve({ label, ok: code === 0, s: (Date.now() - t0) / 1000 }));
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

// carpetas gw-* de TEMP que había antes de la batería: al acabar se borran solo las que haya creado ella (sesión 6, decisión
// del usuario). Las de la prueba de mutantes (gw-mutants-*) no se tocan: no se corre la batería a la vez que los mutantes
const gwDirs = () => { try { return readdirSync(tmpdir()).filter((n) => n.startsWith('gw-')); } catch { return []; } };
const before = new Set(gwDirs());

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
  results.push(await run('parte 3: casos extra en proceso (almacén y verdad)', [join(ROOT, 'test', 'arreglos-parte3-extra.spec.mjs')]));
  results.push(await run('parte 3: casos extra por la API', [join(ROOT, 'test', 'arreglos-parte3-extra-api.spec.mjs')]));
  results.push(await run('parte 3: casos extra b (segunda pasada de mutantes)', [join(ROOT, 'test', 'arreglos-parte3-extra-b.spec.mjs')]));
  results.push(await run('parte 3: casos extra por la API b (pasada dirigida)', [join(ROOT, 'test', 'arreglos-parte3-extra-api-b.spec.mjs')]));
  results.push(await run('interfaz: editor de redes (lógica)', [join(ROOT, 'test', 'ui-editor.spec.mjs')]));
  results.push(await run('interfaz: editor de redes, casos extra', [join(ROOT, 'test', 'ui-editor-extra.spec.mjs')]));
  results.push(await run('interfaz: inicio del laboratorio (lógica)', [join(ROOT, 'test', 'ui-inicio.spec.mjs')]));
  results.push(await run('interfaz: sala viva con redes (lógica)', [join(ROOT, 'test', 'ui-sala.spec.mjs')]));
  results.push(await run('interfaz: entreno (lógica)', [join(ROOT, 'test', 'ui-entreno.spec.mjs')]));
  results.push(await run('interfaz: entreno, hilos que se usan de verdad (M12)', [join(ROOT, 'test', 'ui-entreno-hilos.spec.mjs')]));
  results.push(await run('interfaz: entreno, hilos, casos extra (M12)', [join(ROOT, 'test', 'ui-entreno-hilos-b.spec.mjs')]));
  results.push(await run('interfaz: evolución, hijos y diferencias (lógica)', [join(ROOT, 'test', 'ui-evolucion.spec.mjs')]));
  results.push(await run('interfaz: trono y duelos (lógica)', [join(ROOT, 'test', 'ui-trono.spec.mjs')]));
  results.push(await run('interfaz: dinastías (lógica)', [join(ROOT, 'test', 'ui-dinastias.spec.mjs')]));
  results.push(await run('interfaz: verdad, moviola, boletín y memoria (lógica)', [join(ROOT, 'test', 'ui-verdad.spec.mjs')]));
  results.push(await run('interfaz: cirugía (lógica)', [join(ROOT, 'test', 'ui-cirugia.spec.mjs')]));
  results.push(await run('interfaz: ayudas de arranque, ¿qué pasaría si…? y primeros pasos (lógica)', [join(ROOT, 'test', 'ui-arranque.spec.mjs')]));
  results.push(await run('auditoría P0: una sola conexión SSE por URL', [join(ROOT, 'test', 'ui-sse.spec.mjs')]));
  results.push(await run('auditoría P0: huecos antiguos del entreno y del trono', [join(ROOT, 'test', 'auditoria-p0.spec.mjs')]));
  results.push(await run('auditoría P0: servidor (cría guardada, duración, cuerpos en UTF-8)', [join(ROOT, 'test', 'auditoria-p0-api.spec.mjs')]));
  results.push(await run('auditoría P0: huecos de la parte 4 (mutantes que no eran equivalentes)', [join(ROOT, 'test', 'ui-huecos-p0.spec.mjs')]));
  results.push(await run('auditoría P0: arreglos de la interfaz (hilos, formulario, ¿qué pasaría si…?)', [join(ROOT, 'test', 'ui-arreglos-p0.spec.mjs')]));
  results.push(await run('auditoría P0: aviso de hilos, casos extra (mutantes)', [join(ROOT, 'test', 'ui-arreglos-p0-b.spec.mjs')]));
  results.push(await run('auditoría P0: nombres de hijas sin repetir', [join(ROOT, 'test', 'nombres-p0.spec.mjs')]));
  results.push(await run('receta de entreno: lógica pura', [join(ROOT, 'test', 'receta.spec.mjs')]));
  results.push(await run('receta de entreno en el entrenador', [join(ROOT, 'test', 'receta-entreno.spec.mjs')]));
  results.push(await run('receta de entreno por la API y versiones', [join(ROOT, 'test', 'receta-api.spec.mjs')]));
  results.push(await run('terreno de círculos que se rompe y tiro que atraviesa (P1)', [join(ROOT, 'test', 'terreno.spec.mjs')]));
  results.push(await run('terreno (P1): casos de la auditoría (cobertura, ajuste, Simulador, compañeros, deslizar, dibujo)', [join(ROOT, 'test', 'terreno-extra.spec.mjs')]));
  results.push(await run('terreno (P1): "¿qué pasaría si…?" con círculos y bocados por la API', [join(ROOT, 'test', 'terreno-api.spec.mjs'), BASE]));
  results.push(await run('terreno (P1): huecos de la prueba de mutantes', [join(ROOT, 'test', 'terreno-extra-b.spec.mjs')]));
  results.push(await run('auditoría P0: SSE compartida, darse de baja dos veces', [join(ROOT, 'test', 'ui-sse-b.spec.mjs')]));
  results.push(await run('receta de entreno: reloj del entreno (A1) y huecos de los mutantes', [join(ROOT, 'test', 'receta-extra.spec.mjs')]));
  results.push(await run('auditoría s3: ángulo de artillería en grados (sala, heurísticos y Simulador)', [join(ROOT, 'test', 'angulo.spec.mjs')]));
  results.push(await run('auditoría s3: tope exacto de /api/lab y cuerpos cortados', [join(ROOT, 'test', 'cuerpos.spec.mjs')]));
  results.push(await run('auditoría s3: Adam por estructura y parar en el examen de después', [join(ROOT, 'test', 'receta-extra-b.spec.mjs')]));
  results.push(await run('auditoría s3: el bocado solo si toca', [join(ROOT, 'test', 'terreno-extra-c.spec.mjs')]));
  results.push(await run('auditoría s3: hilos para las partidas sin pantalla del servidor', [join(ROOT, 'test', 'hilos.spec.mjs')]));
  results.push(await run('auditoría s3: normalize idempotente y decisiones que no tocan el genoma', [join(ROOT, 'test', 'normalize.spec.mjs')]));
  results.push(await run('mundos (P2): 3 ranuras, aislados, meta, papelera, arranque y migración', [join(ROOT, 'test', 'mundos.spec.mjs')]));
  results.push(await run('mundos (P2): huecos de los mutantes (rutas, límites, lo que impide cambiar de mundo, papelera)', [join(ROOT, 'test', 'mundos-b.spec.mjs')]));
  results.push(await run('auditoría s3: huecos de los mutantes (mapas, lib, geometría, percepción, sala)', [join(ROOT, 'test', 'huecos-s3.spec.mjs')]));
  results.push(await run('auditoría s3: huecos de los mutantes por la API (cuerpos cortados, 405 de sala)', [join(ROOT, 'test', 'huecos-s3-api.spec.mjs')]));
  results.push(await run('moverse (P1b): solo donde se puede, castigo y destinos a 1,5 u', [join(ROOT, 'test', 'moverse.spec.mjs')]));
  results.push(await run('moverse (P1b): huecos de los mutantes', [join(ROOT, 'test', 'moverse-b.spec.mjs')]));
  results.push(await run('hilos b: el entreno de 1 hilo no vuelve al hilo principal (train.js:501)', [join(ROOT, 'test', 'hilos-b.spec.mjs')]));
  results.push(await run('auditoría s5: estado inicial de Adam y de la base "media" (train.js 103, 264, 293)', [join(ROOT, 'test', 'huecos-s5.spec.mjs')]));
  results.push(await run('auditoría s5: duelo "mix", cada partida se absorbe una vez', [join(ROOT, 'test', 'duelo-mix.spec.mjs')]));
  results.push(await run('hilos c: el servidor aprende en un hilo y contesta siempre (spec/11)', [join(ROOT, 'test', 'hilos-c.spec.mjs')]));
} finally {
  server.kill();
}
await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
let cleaned = 0;
for (const n of gwDirs()) {
  if (before.has(n) || n.startsWith('gw-mutants-')) continue;
  try { rmSync(join(tmpdir(), n), { recursive: true, force: true }); cleaned++; } catch { /* en uso: se queda */ }
}

console.log(`\n=== resumen === (carpetas gw-* de esta batería borradas: ${cleaned})`);
for (const r of results) console.log(` ${r.ok ? '✔' : '✘'} ${r.label} (${r.s.toFixed(1)} s)`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nFAIL ✘ (${failed})` : '\nTODO OK ✔');
process.exit(failed ? 1 : 0);
