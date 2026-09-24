// Mundos (spec/09, P2): huecos de la prueba de mutantes de server/worlds.js y de lo que cambió para P2 (evo/api.js,
// evo/busy.js, server/server.js). Códigos exactos de las rutas, límites de nombre y tutorial, restos de un intento
// anterior, la vista (solo redes de verdad, la reina de la carpeta), lastPlayedAt y el aviso `world`, todo lo que impide
// cambiar de mundo (duelo, trabajo, partida con una red, exhibición que aprende, entreno parado que aún guarda), borrar con
// algo en marcha, la papelera con la misma hora, arrancar con active.json de una ranura vacía y crear sin Vidente base.
// Escrito DESPUÉS del código (cubre supervivientes) y congelado. Uso: node test/mundos-b.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

const base = mkdtempSync(join(tmpdir(), 'gw-mundos-b-'));
const W = (n, ...p) => join(base, 'worlds', String(n), ...p);
const port = 40000 + ((process.pid + 700) % 9000);
const url = `http://localhost:${port}`;
let srv = null;
const start = async () => {
  srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: base }, stdio: 'ignore' });
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(url + '/api/health')).ok) return; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
};
const stop = () => new Promise((r) => { if (!srv) return r(); srv.once('exit', r); srv.kill(); srv = null; });
const api = async (p, method = 'GET', body) => {
  const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
const worlds = async () => (await api('/api/worlds')).body;
const open = (n) => api(`/api/worlds/${n}/open`, 'POST', {});
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
const mkNet = async (template, name, patch = null) => {
  const r = await api('/api/lab/nets', 'POST', { template, name });
  assert.equal(r.status, 201, r.text);
  if (patch) { const g = { ...r.body.genome, ...patch(r.body.genome) }; const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', g); assert.equal(p.status, 200, p.text); }
  return r.body.id;
};
// sala con una red (izquierda) contra un heurístico (derecha), ya empezada
const exhibition = async (netId, { seed, soldiers = 1, learn = false }) => {
  const room = (await api('/api/rooms', 'POST', { name: 'mundos-b', soldiers, seed })).body;
  await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId, learn, team: 'left' });
  await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'right' });
  await api(`/api/rooms/${room.code}/start`, 'POST', {});
  return room.code;
};
const phaseOf = async (code) => (await api(`/api/rooms/${code}/state`)).body.phase;
const openWhenFree = (n, what) => until(async () => (await open(n)).status === 200, 180000, what);
const stamp = (d) => { const p2 = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`; };

try {
  await start();

  await check('rutas: 200 y 405 en /api/worlds; 404 en lo que no existe; 200 y 405 en meta; cuerpo demasiado grande → 413', async () => {
    const all = await api('/api/worlds');
    assert.equal(all.status, 200, all.text);
    assert.equal((await api('/api/worlds', 'POST', {})).status, 405);
    assert.equal((await api('/api/worlds/1/new', 'POST', { path: 'cero' })).status, 201);
    for (const [p, m] of [['/api/worlds/1', 'GET'], ['/api/worlds/1', 'PUT'], ['/api/worlds/1/open', 'GET'], ['/api/worlds/1/cosa', 'POST'], ['/api/worlds/1/open/otra', 'POST'], ['/api/worlds/1/cosa', 'GET'], ['/api/worlds/1/meta/otra', 'GET']]) {
      const r = await api(p, m, m === 'GET' ? undefined : {});
      assert.equal(r.status, 404, `${m} ${p} → ${r.status} ${r.text}`);
    }
    assert.equal((await worlds()).active, null, 'nada de lo anterior abre el mundo');
    const meta = await api('/api/worlds/1/meta');
    assert.equal(meta.status, 200, meta.text); assert.equal(meta.body.name, 'Mundo 1');
    assert.equal((await api('/api/worlds/1/meta', 'POST', { name: 'Otro' })).status, 405);
    const big = await api('/api/worlds/1/meta', 'PUT', { name: 'Grande', tutorial: { t: 'x'.repeat(200000) } });
    assert.equal(big.status, 413, big.text);
    assert.equal((await api('/api/worlds/1/meta')).body.name, 'Mundo 1', 'ni el 405 ni el 413 cambian nada');
  });

  await check('límites exactos: nombre de 40 caracteres y avance del tutorial de 65 536 bytes en JSON', async () => {
    const forty = 'n'.repeat(40);
    assert.equal((await api('/api/worlds/1/meta', 'PUT', { name: forty })).status, 200);
    assert.equal((await api('/api/worlds/1/meta')).body.name, forty);
    const exact = { t: 'x'.repeat(65528) }, over = { t: 'x'.repeat(65529) };
    assert.equal(JSON.stringify(exact).length, 65536);
    assert.equal((await api('/api/worlds/1/meta', 'PUT', { tutorial: exact })).status, 200);
    assert.equal((await api('/api/worlds/1/meta', 'PUT', { tutorial: over })).status, 400);
    assert.deepEqual((await api('/api/worlds/1/meta')).body.tutorial, exact);
    assert.equal((await api('/api/worlds/1/meta', 'PUT', { name: 'Mundo 1', tutorial: {} })).status, 200);
  });

  await check('crear sobre restos de un intento anterior (ranura sin meta.json y carpeta de montaje): 201 y sin restos', async () => {
    mkdirSync(W(3), { recursive: true }); writeFileSync(W(3, 'restos.txt'), 'de antes');
    const tmp = join(base, 'worlds', `.nuevo-3-${srv.pid}`);
    mkdirSync(tmp, { recursive: true }); writeFileSync(join(tmp, 'basura.txt'), 'de antes');
    assert.equal((await worlds()).worlds[2].empty, true, 'sin meta.json la ranura está vacía');
    const r = await api('/api/worlds/3/new', 'POST', { path: 'algo', name: 'Tres' });
    assert.equal(r.status, 201, r.text);
    assert.ok(!existsSync(W(3, 'restos.txt')) && !existsSync(tmp) && existsSync(W(3, 'meta.json')));
  });

  await check('la vista cuenta solo las redes de verdad y lee la reina de la carpeta del mundo', async () => {
    const v = readJson(join(ROOT, 'evo', 'base', 'vidente-1.json'));
    writeFileSync(W(3, 'nets', 'abc.json'), JSON.stringify({ ...v, id: 'abc', name: 'Abc', emblem: 7 }));
    mkdirSync(W(3, 'nets', 'tortuga-1'), { recursive: true }); writeFileSync(W(3, 'nets', 'tortuga-1', 'optim.json'), '{}');
    writeFileSync(W(3, 'nets', 'abcde_.json'), '{"id":"abcde_"}');
    writeFileSync(W(3, 'nets', 'fghij_.json'), '{"id":"fghij_"}');
    writeFileSync(W(3, 'nets', 'notas.txt'), 'hola');
    writeFileSync(W(3, 'throne.json'), JSON.stringify({ queen: 'abc', reigns: [{ netId: 'vidente-1' }, { netId: 'abc' }] }));
    let w3 = (await worlds()).worlds[2];
    assert.equal(w3.nets, 2, 'vidente-1 y abc; ni la carpeta, ni los ids que no valen, ni el .txt');
    assert.deepEqual(w3.queen, { id: 'abc', name: 'Abc', emblem: 7 }); assert.equal(w3.reigns, 2);
    assert.equal((await open(3)).status, 200);
    assert.equal((await api('/api/lab/nets')).body.nets.length, w3.nets, 'lo mismo que lista el laboratorio');
    writeFileSync(W(3, 'throne.json'), JSON.stringify({ queen: 'fantasma', reigns: [] }));
    w3 = (await worlds()).worlds[2];
    assert.deepEqual(w3.queen, { id: 'fantasma', name: 'fantasma', emblem: null }, 'reina sin fichero: su id y sin emblema');
    assert.equal(w3.reigns, 0);
    writeFileSync(W(3, 'throne.json'), JSON.stringify({ queen: null, reigns: [] }));
  });

  await check('abrir: lastPlayedAt pasa a ahora y el aviso `world` llega por /api/lab/events', async () => {
    const ctrl = new AbortController();
    const res = await fetch(url + '/api/lab/events', { signal: ctrl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let text = '';
    const before = (await api('/api/worlds/1/meta')).body.lastPlayedAt;
    await sleep(30);
    const t0 = Date.now();
    assert.equal((await open(1)).status, 200);
    const after = (await api('/api/worlds/1/meta')).body.lastPlayedAt;
    assert.ok(after >= t0 && after > before && after <= Date.now(), `${before} → ${after}`);
    const t1 = Date.now();
    while (!/event: world\ndata: \{"active":1\}/.test(text)) {
      if (Date.now() - t1 > 5000) throw new Error(`sin evento world: ${text.slice(-300)}`);
      const { value, done } = await Promise.race([reader.read(), sleep(5000).then(() => ({ done: true }))]);
      if (done) break;
      text += dec.decode(value);
    }
    ctrl.abort();
    assert.match(text, /event: world\ndata: \{"active":1\}/);
  });

  // mundo 1 activo desde aquí
  const a = await mkNet('sniper', 'Duelo A'), b = await mkNet('sniper', 'Duelo B');

  await check('un duelo en curso impide cambiar de mundo (409 con el duelo); acabado, abre y no pasa al otro mundo', async () => {
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'x1', soldiers: 1, seed: 3 });
    assert.equal(d.status, 202, d.text);
    const busy = await open(3);
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.body.error, /duelo/); assert.ok(busy.body.error.includes(d.body.id), busy.body.error);
    await api(`/api/lab/duels/${d.body.id}/stop`, 'POST', {});
    await until(async () => (await api(`/api/lab/duels/${d.body.id}`)).body.status !== 'running', 120000, 'duelo parado');
    await openWhenFree(3, 'abrir el 3 tras el duelo');
    assert.ok(!(await api('/api/lab/duels')).body.duels.some((x) => x.id === d.body.id), 'el duelo del mundo 1 no aparece en el 3');
    assert.equal((await api(`/api/lab/duels/${d.body.id}`)).status, 404);
    assert.equal((await open(1)).status, 200);
  });

  await check('un trabajo en curso (hijos) impide cambiar de mundo (409 con el trabajo)', async () => {
    const j = await api(`/api/lab/nets/${a}/children`, 'POST', { n: 4, pretournament: { games: 4 } });
    assert.equal(j.status, 202, j.text);
    const busy = await open(3);
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.body.error, /trabajo/); assert.ok(busy.body.error.includes(j.body.jobId || j.body.id), busy.body.error);
    await openWhenFree(3, 'abrir el 3 tras el trabajo');
    assert.equal((await open(1)).status, 200);
  });

  await check('una partida sin redes (solo heurísticos) no impide cambiar de mundo', async () => {
    const room = (await api('/api/rooms', 'POST', { name: 'sin-redes', soldiers: 3, seed: 12 })).body;
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', {});
    assert.equal(await phaseOf(room.code), 'playing');
    const r = await open(3);
    assert.equal(r.status, 200, r.text);
    assert.equal((await open(1)).status, 200);
  });

  await check('una partida con una red en curso impide cambiar de mundo (409 con la sala)', async () => {
    const code = await exhibition(a, { seed: 11, soldiers: 3 });
    assert.equal(await phaseOf(code), 'playing');
    const busy = await open(3);
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.body.error, /partida con una red/); assert.ok(busy.body.error.includes(code), busy.body.error);
    await until(async () => (await phaseOf(code)) === 'over', 120000, 'fin de la partida');
    await openWhenFree(3, 'abrir el 3 tras la partida');
    assert.equal((await open(1)).status, 200);
  });

  await check('una red que aprende de una exhibición impide cambiar de mundo (409 con la exhibición)', async () => {
    const e = await mkNet('seer', 'Exhibe', (g) => ({ learning: { ...g.learning, method: 'evolution', evolution: { ...g.learning.evolution, population: 32, gamesPerCandidate: 8 } } }));
    const code = await exhibition(e, { seed: 61, soldiers: 3, learn: true });
    await until(async () => (await phaseOf(code)) === 'over', 120000, 'fin de la exhibición');
    const busy = await open(3);
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.body.error, /exhibición/); assert.ok(busy.body.error.includes(code), busy.body.error);
    await openWhenFree(3, 'abrir el 3 tras el paso de evolución');
    assert.equal((await open(1)).status, 200);
  });

  await check('un entreno parado no deja cambiar de mundo hasta que acaba de verdad: todo lo suyo se guarda en su mundo', async () => {
    const t = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'x1', duration: { games: 50 }, soldiers: 1, seed: 7, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(t.status, 202, t.text);
    await until(async () => (await api(`/api/lab/trainings/${t.body.id}`)).body.status === 'running', 20000, 'entreno en marcha');
    await api(`/api/lab/trainings/${t.body.id}/stop`, 'POST', {});
    const r = await open(3); // justo después de parar: aún cierra su partida y guarda
    if (r.status === 409) { assert.match(r.body.error, /entren/); await openWhenFree(3, 'abrir el 3 tras el entreno'); }
    else assert.equal(r.status, 200, r.text);
    const rec = (n) => join(base, 'worlds', String(n), 'records', 'trainings', `${t.body.id}.json`);
    await sleep(500);
    assert.ok(existsSync(rec(1)), 'el registro del entreno está en su mundo');
    assert.ok(!existsSync(rec(3)), 'y no en el mundo abierto después');
    assert.equal((await open(1)).status, 200);
  });

  await check('borrar: el activo con algo en marcha → 409 y sigue; otro mundo sí se borra; misma hora → sufijo -2', async () => {
    const t = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'x1', duration: { games: 50 }, soldiers: 1, seed: 9, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(t.status, 202, t.text);
    await until(async () => (await api(`/api/lab/trainings/${t.body.id}`)).body.status === 'running', 20000, 'entreno en marcha');
    const busy = await api('/api/worlds/1', 'DELETE', { confirm: 'Mundo 1' });
    assert.equal(busy.status, 409, busy.text); assert.match(busy.body.error, /entren/);
    assert.equal((await worlds()).worlds[0].empty, false, 'el activo sigue');
    const other = await api('/api/worlds/3', 'DELETE', { confirm: 'Tres' });
    assert.equal(other.status, 200, 'otro mundo se borra aunque el activo esté ocupado: ' + other.text);
    await api(`/api/lab/trainings/${t.body.id}/stop`, 'POST', {});
    await until(async () => (await api(`/api/lab/trainings/${t.body.id}`)).body.phase === 'stopped', 30000, 'entreno parado');
    assert.equal((await api('/api/worlds/3/new', 'POST', { path: 'rl', name: 'Tres' })).status, 201);
    const now = Date.now();
    for (let s = 0; s < 4; s++) mkdirSync(join(base, 'archivo-borrados', `${stamp(new Date(now + s * 1000))}-mundo-3`), { recursive: true });
    const r = await api('/api/worlds/3', 'DELETE', { confirm: 'Tres' });
    assert.equal(r.status, 200, r.text);
    assert.match(r.body.trash.replace(/\\/g, '/'), /\/archivo-borrados\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-mundo-3-2$/);
    assert.equal(readJson(join(r.body.trash, 'meta.json')).path, 'rl', 'el segundo borrado, entero, en su carpeta');
  });

  await check('al arrancar, un active.json que apunta a una ranura vacía no abre nada', async () => {
    await stop();
    writeFileSync(join(base, 'worlds', 'active.json'), JSON.stringify({ n: 2 }));
    await start();
    const all = await worlds();
    assert.equal(all.active, null); assert.equal(all.worlds[1].empty, true);
  });
} finally {
  await stop();
}

await check('crear sin evo/base/vidente-1.json → 500 con el motivo y la ranura sigue vacía (copia del código sin la base)', async () => {
  const code = mkdtempSync(join(tmpdir(), 'gw-mundos-sin-vidente-'));
  for (const d of ['server', 'shared', 'agents']) cpSync(join(ROOT, d), join(code, d), { recursive: true });
  mkdirSync(join(code, 'evo'));
  for (const f of readdirSync(join(ROOT, 'evo'))) if (f.endsWith('.js') && statSync(join(ROOT, 'evo', f)).isFile()) cpSync(join(ROOT, 'evo', f), join(code, 'evo', f));
  cpSync(join(ROOT, 'package.json'), join(code, 'package.json'));
  const b2 = mkdtempSync(join(tmpdir(), 'gw-mundos-b2-'));
  process.env.GW_EVO_DIR = b2;
  const { worldsRoute } = await import(pathToFileURL(join(code, 'server', 'worlds.js')).href);
  const r = worldsRoute('POST', ['1', 'new'], { path: 'cero' });
  assert.equal(r.status, 500, JSON.stringify(r));
  assert.match(r.body.error, /vidente-1\.json/);
  assert.ok(!existsSync(join(b2, 'worlds', '1')), 'no se crea a medias');
  assert.equal(worldsRoute('GET', [], {}).body.worlds[0].empty, true);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (mundos-b: huecos de los mutantes de P2)');
process.exit(fails ? 1 : 0);
