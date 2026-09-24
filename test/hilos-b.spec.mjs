// Hilos, casos extra: el hueco `train.js:501` de la tanda B de mutantes (sesión 5, 2026-09-24). Si el entreno turbo de
// 1 hilo volviera al hilo principal del servidor, `hilos.spec` podía no notarlo: con su semilla, alguna vez todas las
// partidas duraban menos de 500 ms. Aquí la premisa se mide en el propio test: el mismo entreno (mismas redes lentas,
// misma semilla, mismas partidas) jugado en el hilo principal de ESTE proceso lo bloquea más de 2·MAX_MS alguna vez; por
// la API, con el servidor jugándolo en sus hilos, el servidor contesta siempre en menos de MAX_MS. Se cronometran TODAS
// las peticiones (la de estado también: si solo se mide /api/health, un bloqueo suelto se lo come la de estado). La
// actualización de pesos sigue en el hilo principal: lote de 1 partida para que dure poco (~0,2 s; con lotes de 4 y redes
// lentas pasa de 800 ms: eso es otro asunto, no el de la línea 501), y se cronometra desde que la partida 0 está apuntada
// (apuntarla es guardarla entera como partida de muestra y la primera actualización va en frío: 0,3–0,8 s). Escrito
// contra el código de P1b y congelado.
// Uso: node test/hilos-b.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-hilos-b-local-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const MAX_MS = 500; // el mismo límite que hilos.spec

const store = await import('../evo/store.js');
const { createTrainer } = await import('../evo/train.js');
const { LIMITS } = await import('../shared/constants.js');

const port = 30000 + ((process.pid + 7000) % 10000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-hilos-b-srv-')) }, stdio: 'ignore' });
const t0 = Date.now();
for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
// una red lenta a propósito (como en hilos.spec): 64 candidatos y Simulador fino
const mkSlow = async (name) => {
  const r = await api('/api/lab/nets', 'POST', { template: 'seer', name });
  assert.equal(r.status, 201, r.text);
  const g = (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
  g.imagination = { ...g.imagination, n: LIMITS.candidatesMax };
  for (const b of g.blocks) if (b.type === 'eye.simulator') b.params = { ...b.params, fine: true };
  const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', g);
  assert.equal(p.status, 200, p.text);
  return (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
};
const finished = (s) => ['done', 'error', 'stopped'].includes(s);

try {
  await check(`entreno turbo de 1 hilo con partidas largas: en el hilo principal lo bloquearía más de ${2 * MAX_MS} ms, y el servidor contesta siempre en menos de ${MAX_MS} ms`, async () => {
    const slow = await mkSlow('Hilo Lenta B'), slow2 = await mkSlow('Hilo Lenta B Dos');
    const cfg = { speed: 'turbo', workers: 1, duration: { games: 8 }, soldiers: 3, seed: 17, learning: { gradient: { batchGames: 1 } }, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: slow2.id } };

    // premisa: el mismo entreno en el hilo principal de este proceso (aquí no hay grupo de hilos)
    assert.ok(store.saveNet(slow).ok && store.saveNet(slow2).ok);
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const local = createTrainer({ netId: slow.id, ...cfg });
    await local.start();
    h.disable();
    assert.equal(local.status, 'done', local.error || '');
    const blocked = h.max / 1e6;
    assert.ok(blocked > 2 * MAX_MS, `premisa: en el hilo principal este entreno solo lo bloquea ${Math.round(blocked)} ms (hacen falta más de ${2 * MAX_MS}: más partidas u otra semilla)`);

    // por la API: el servidor lo juega en sus hilos y sigue contestando (desde la partida 1)
    const r = await api('/api/lab/trainings', 'POST', { netId: slow.id, ...cfg });
    assert.equal(r.status, 202, r.text);
    let st = null, worst = 0;
    while (!st || (st.games < 1 && !finished(st.status))) { await sleep(25); st = (await api(`/api/lab/trainings/${r.body.id}`)).body; }
    assert.ok(st.games < cfg.duration.games, `premisa: quedan partidas por jugar al empezar a medir (van ${st.games})`);
    const timed = async (f) => { const a = performance.now(); const v = await f(); worst = Math.max(worst, performance.now() - a); return v; };
    const t1 = Date.now();
    for (;;) {
      st = (await timed(() => api(`/api/lab/trainings/${r.body.id}`))).body;
      if (finished(st.status)) break;
      if (Date.now() - t1 > 300000) throw new Error('tiempo agotado');
      await timed(() => fetch(base + '/api/health'));
      await sleep(25);
    }
    assert.equal(st.status, 'done', JSON.stringify(st).slice(0, 300));
    assert.equal(st.games, cfg.duration.games);
    assert.ok(worst < MAX_MS, `respuesta más lenta ${Math.round(worst)} ms (en el hilo principal: ${Math.round(blocked)} ms)`);
    console.log(`  (bloqueo en el hilo principal: ${Math.round(blocked)} ms; respuesta más lenta del servidor: ${Math.round(worst)} ms)`);
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (hilos b: el entreno de 1 hilo no vuelve al hilo principal)');
process.exit(fails ? 1 : 0);
