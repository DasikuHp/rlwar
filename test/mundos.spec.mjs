// Mundos (spec/09, P2): 3 ranuras, cada una un mundo entero con Vidente de práctica; el mundo activo decide dónde lee y
// escribe la API del laboratorio; 409 si algo está en marcha; meta, papelera, arranque en el último mundo abierto y
// migración de lo de antes (una vez, sin borrar). Por la API con servidor propio sobre una carpeta temporal, y la
// migración en el proceso. Escrito ANTES del código y congelado. Uso: node test/mundos.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

const base = mkdtempSync(join(tmpdir(), 'gw-mundos-'));
const port = 30000 + ((process.pid + 2500) % 10000);
const url = `http://localhost:${port}`;
let srv = null;
const start = async () => {
  srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: base }, stdio: 'ignore' });
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(url + '/api/health')).ok) return; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
};
const stop = () => new Promise((r) => { if (!srv) return r(); srv.once('exit', r); srv.kill(); srv = null; });
const api = async (p, method = 'GET', body) => {
  const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
const worlds = async () => (await api('/api/worlds')).body;
const netIds = async () => (await api('/api/lab/nets')).body.nets.map((n) => n.id).sort();
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
const BASE_VIDENTE = join(ROOT, 'evo', 'base', 'vidente-1.json');

// datos sueltos "de antes" en la carpeta: con GW_EVO_DIR el servidor no los migra nunca
mkdirSync(join(base, 'nets'), { recursive: true });
writeFileSync(join(base, 'nets', 'suelta.json'), '{"id":"suelta"}');

try {
  await start();

  await check('al principio: tres ranuras vacías, sin mundo activo; con GW_EVO_DIR no se migra nada', async () => {
    assert.deepEqual(await worlds(), { active: null, worlds: [{ n: 1, empty: true }, { n: 2, empty: true }, { n: 3, empty: true }] });
    assert.ok(existsSync(join(base, 'nets', 'suelta.json')), 'lo suelto sigue donde estaba');
    assert.ok(!existsSync(join(base, 'archivo-2026-09-23')));
  });

  let w1 = null;
  await check('crear: 201 con datos reales, nombre por defecto, nivel según el camino y Vidente idéntica al fichero base', async () => {
    const t0 = Date.now();
    const r = await api('/api/worlds/1/new', 'POST', { path: 'cero' });
    assert.equal(r.status, 201, r.text);
    w1 = r.body.world;
    const { createdAt, lastPlayedAt, ...rest } = w1;
    assert.deepEqual(rest, { n: 1, empty: false, name: 'Mundo 1', path: 'cero', level: 'A', tutorial: {}, practice: ['vidente-1'], nets: 1, games: 0, queen: null, reigns: 0 });
    assert.ok(createdAt >= t0 && createdAt <= Date.now() && lastPlayedAt === createdAt);
    assert.deepEqual(readJson(join(base, 'worlds', '1', 'nets', 'vidente-1.json')), readJson(BASE_VIDENTE), 'copia exacta de evo/base/vidente-1.json');
    const r2 = await api('/api/worlds/2/new', 'POST', { path: 'rl', name: 'Laboratorio' });
    assert.equal(r2.status, 201, r2.text);
    assert.equal(r2.body.world.level, 'C'); assert.equal(r2.body.world.name, 'Laboratorio');
    assert.equal((await api('/api/worlds/3/new', 'POST', { path: 'algo', name: 'Tercero' })).body.world.level, 'B');
    const all = await worlds();
    assert.equal(all.active, null, 'crear no abre');
    assert.deepEqual(all.worlds.map((w) => [w.n, w.empty, w.name]), [[1, false, 'Mundo 1'], [2, false, 'Laboratorio'], [3, false, 'Tercero']]);
  });

  await check('crear: ranura ocupada → 409; camino o nombre que no valen → 400; ranura fuera de 1–3 → 404', async () => {
    assert.equal((await api('/api/worlds/1/new', 'POST', { path: 'cero' })).status, 409);
    await api('/api/worlds/3', 'DELETE', { confirm: 'Tercero' });
    for (const body of [{ path: 'nada' }, {}, { path: 'cero', name: '' }, { path: 'cero', name: 'x'.repeat(41) }, { path: 'cero', name: 'dos\nlíneas' }, { path: 'cero', name: 5 }]) {
      const r = await api('/api/worlds/3/new', 'POST', body);
      assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status}`);
      assert.ok(r.body && typeof r.body.error === 'string' && r.body.error.length > 3);
    }
    assert.equal((await worlds()).worlds[2].empty, true, 'lo que falla no deja nada a medias');
    for (const n of [0, 4, 'x']) assert.equal((await api(`/api/worlds/${n}/new`, 'POST', { path: 'cero' })).status, 404);
  });

  let mine = null;
  await check('mundos aislados: lo creado en un mundo solo está en él (y no en la carpeta de siempre)', async () => {
    const o = await api('/api/worlds/1/open', 'POST', {});
    assert.equal(o.status, 200, o.text); assert.equal(o.body.active, 1);
    mine = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Solo Uno' })).body.id;
    assert.deepEqual(await netIds(), [mine, 'vidente-1'].sort());
    assert.ok(existsSync(join(base, 'worlds', '1', 'nets', `${mine}.json`)) && !existsSync(join(base, 'nets', `${mine}.json`)));
    assert.equal((await api('/api/worlds/2/open', 'POST', {})).status, 200);
    assert.deepEqual(await netIds(), ['vidente-1']);
    assert.equal((await api('/api/worlds/1/open', 'POST', {})).status, 200);
    assert.deepEqual(await netIds(), [mine, 'vidente-1'].sort());
    const all = await worlds();
    assert.equal(all.active, 1);
    assert.equal(all.worlds[0].nets, 2); assert.equal(all.worlds[1].nets, 1);
    assert.ok(all.worlds[0].lastPlayedAt >= w1.lastPlayedAt);
  });

  await check('abrir con un entreno en marcha → 409 con el motivo; parado, abre; los entrenos no pasan de un mundo a otro', async () => {
    const t = await api('/api/lab/trainings', 'POST', { netId: mine, speed: 'x1', duration: { games: 50 }, soldiers: 1, seed: 5, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(t.status, 202, t.text);
    await until(async () => ['running', 'paused'].includes((await api(`/api/lab/trainings/${t.body.id}`)).body.status), 20000, 'entreno en marcha');
    const busy = await api('/api/worlds/2/open', 'POST', {});
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.body.error, /entren/i);
    assert.equal((await worlds()).active, 1, 'sigue en el mismo mundo');
    await api(`/api/lab/trainings/${t.body.id}/stop`, 'POST', {});
    // parado del todo = su fase final (spec/04 §11.6): hasta entonces aún cierra su partida y guarda en este mundo
    await until(async () => (await api(`/api/lab/trainings/${t.body.id}`)).body.phase === 'stopped', 30000, 'entreno parado del todo');
    assert.equal((await api('/api/worlds/2/open', 'POST', {})).status, 200);
    const list = (await api('/api/lab/trainings')).body.trainings;
    assert.ok(!list.some((x) => x.id === t.body.id), 'el entreno del mundo 1 no aparece en el 2');
    assert.equal((await api(`/api/lab/trainings/${t.body.id}`)).status, 404);
    assert.equal((await api('/api/worlds/1/open', 'POST', {})).status, 200);
    assert.ok((await api('/api/lab/trainings')).body.trainings.some((x) => x.id === t.body.id), 'de vuelta en el 1, está');
  });

  await check('meta: cambia nombre, nivel y tutorial (lo demás no); lo que no vale → 400; ranura vacía → 404', async () => {
    const r = await api('/api/worlds/1/meta', 'PUT', { level: 'B', tutorial: { paso: 3, hecho: ['tu-mundo'] }, name: 'Mi mundo' });
    assert.equal(r.status, 200, r.text);
    const m = (await api('/api/worlds/1/meta')).body;
    assert.equal(m.level, 'B'); assert.deepEqual(m.tutorial, { paso: 3, hecho: ['tu-mundo'] }); assert.equal(m.name, 'Mi mundo');
    assert.equal(m.path, 'cero'); assert.equal(m.n, 1); assert.deepEqual(m.practice, ['vidente-1']); assert.equal(m.format, 1);
    for (const body of [{ level: 'D' }, { name: '' }, { tutorial: 'texto' }, { tutorial: { grande: 'x'.repeat(70000) } }]) {
      assert.equal((await api('/api/worlds/1/meta', 'PUT', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await api('/api/worlds/1/meta')).body.level, 'B', 'lo que falla no cambia nada');
    assert.equal((await api('/api/worlds/3/meta')).status, 404);
  });

  await check('borrar: confirmación con el nombre exacto; va a la papelera; la ranura queda libre; si era el activo, deja de haberlo', async () => {
    assert.equal((await api('/api/worlds/2/open', 'POST', {})).status, 200);
    assert.equal((await api('/api/worlds/2', 'DELETE', { confirm: 'laboratorio' })).status, 400);
    assert.equal((await api('/api/worlds/2', 'DELETE', {})).status, 400);
    assert.equal((await worlds()).worlds[1].empty, false);
    const r = await api('/api/worlds/2', 'DELETE', { confirm: 'Laboratorio' });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.deleted, 2);
    const trash = readdirSync(join(base, 'archivo-borrados'));
    assert.ok(trash.some((d) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-mundo-2$/.test(d)), JSON.stringify(trash));
    const moved = trash.find((d) => d.endsWith('-mundo-2'));
    assert.equal(readJson(join(base, 'archivo-borrados', moved, 'meta.json')).name, 'Laboratorio', 'no se borra nada: se mueve');
    const all = await worlds();
    assert.equal(all.worlds[1].empty, true); assert.equal(all.active, null);
    assert.equal((await api('/api/worlds/2', 'DELETE', { confirm: 'Laboratorio' })).status, 404);
  });

  await check('al reiniciar, el servidor sigue en el último mundo abierto', async () => {
    assert.equal((await api('/api/worlds/1/open', 'POST', {})).status, 200);
    await stop(); await start();
    const all = await worlds();
    assert.equal(all.active, 1);
    assert.deepEqual(await netIds(), [mine, 'vidente-1'].sort());
  });
} finally {
  await stop();
}

await check('migración: mueve lo suelto al archivo sin borrar nada; la segunda vez no hace nada', async () => {
  const { migrateLegacy } = await import('../server/worlds.js');
  const b = mkdtempSync(join(tmpdir(), 'gw-migra-'));
  const files = { 'nets/vidente-1.json': '{"id":"vidente-1"}', 'nets/tortuga-1/optim.json': '{}', 'games/g-1.json.gz': 'gz', 'records/jobs/j1.json': '{}', 'snapshots/abc.json.gz': 's', 'throne.json': '{"queen":null}', 'log.jsonl': '{"a":1}\n', 'log.1.jsonl': '{"a":0}\n' };
  for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(b, f)), { recursive: true }); writeFileSync(join(b, f), text); }
  mkdirSync(join(b, 'worlds', '1'), { recursive: true }); writeFileSync(join(b, 'worlds', '1', 'meta.json'), '{}');
  const r = migrateLegacy(b);
  assert.deepEqual([...r.moved].sort(), ['games', 'log.1.jsonl', 'log.jsonl', 'nets', 'records', 'snapshots', 'throne.json']);
  for (const [f, text] of Object.entries(files)) {
    assert.equal(readFileSync(join(b, 'archivo-2026-09-23', f), 'utf8'), text, f);
    assert.ok(!existsSync(join(b, f)), `${f} ya no está suelto`);
  }
  assert.ok(existsSync(join(b, 'worlds', '1', 'meta.json')), 'los mundos no se tocan');
  writeFileSync(join(b, 'throne.json'), '{"nuevo":1}');
  assert.deepEqual(migrateLegacy(b).moved, [], 'con el archivo hecho, no hace nada');
  assert.equal(readFileSync(join(b, 'throne.json'), 'utf8'), '{"nuevo":1}');
  assert.equal(readFileSync(join(b, 'archivo-2026-09-23', 'throne.json'), 'utf8'), '{"queen":null}');
  const empty = mkdtempSync(join(tmpdir(), 'gw-migra-vacia-'));
  assert.deepEqual(migrateLegacy(empty).moved, [], 'sin nada suelto no crea el archivo');
  assert.ok(!existsSync(join(empty, 'archivo-2026-09-23')));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (mundos: 3 ranuras, aislados, meta, papelera, arranque y migración)');
process.exit(fails ? 1 : 0);
