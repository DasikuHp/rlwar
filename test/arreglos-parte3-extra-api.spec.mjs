// Parte 3, casos extra por la API (servidor propio con carpeta de datos nueva): huecos que dejaron los mutantes sobre el
// código de la parte 3 (spec/mutantes.md "Parte 3"). Cuerpos: límites exactos y corte a 4× el tope (M10). Soldados 5 y
// null; generación sin objeto training (B2). Errores de pesos con ejemplo (B1). Copias de la red con varios hilos (M2).
// Ids que siguen tras reiniciar (M9). Nombres en el registro al borrar la reina y una campeona y en la cría (M5); ids
// reales de los trabajos de cría de una generación (M9); diario sin retos ajenos (M4); tope de 500 decisiones de
// disparo al nombrar neuronas (M6). Uso: node test/arreglos-parte3-extra-api.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}${e.cause ? ` (${e.cause.code || ''} ${e.cause.message || ''})` : ''}`); fails++; }
};
const startServer = async (dir, port) => {
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  return { base, port, stop: () => new Promise((r) => { srv.once('exit', r); srv.kill(); }) };
};
// una conexión reutilizada que el servidor ya cerró (carrera del keep-alive tras una petición larga, se ve en Windows como
// ECONNRESET sin error en el servidor): un GET se reintenta una vez; lo demás no, porque podría repetirse la acción
const apiOf = (s) => async function call(p, method = 'GET', body = undefined, raw = false, retry = true) {
  let res;
  try { res = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }); }
  catch (e) { if (retry && method === 'GET' && e.cause && e.cause.code === 'ECONNRESET') return call(p, method, body, raw, false); throw e; }
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: res.status, body: j, text: t };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
// envía un cuerpo de n bytes y cuenta qué pasa: {status} si responde, {cut: true} si cortan la conexión sin responder
const sendBytes = (port, path, n) => new Promise((resolve) => {
  const req = request({ host: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': n } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
  req.on('error', () => resolve({ cut: true }));
  const chunk = Buffer.alloc(16384, 0x20);
  let left = n;
  const pump = () => { while (left > 0) { const k = Math.min(left, chunk.length); left -= k; if (!req.write(k === chunk.length ? chunk : chunk.subarray(0, k))) { req.once('drain', pump); return; } } req.end(); };
  pump();
});
const done = (r) => r && !['queued', 'running', 'paused'].includes(r.status);

const dir = mkdtempSync(join(tmpdir(), 'gw-evo-p3extra-srv-'));
const port = 40000 + (process.pid % 10000);
let s = await startServer(dir, port);
let api = apiOf(s);
const logOf = async () => (await api('/api/lab/log?limit=1000')).body.entries;
try {
  await check('cuerpos de sala: 100 000 bytes se leen; 100 001 → 413 con el motivo; más de 400 000 → cortan la conexión sin responder', async () => {
    const pad = (n) => { const head = '{"name":"'; const tail = '"}'; return head + 'x'.repeat(n - head.length - tail.length) + tail; };
    const ok = await api('/api/rooms', 'POST', pad(100000), true);
    assert.equal(ok.status, 201, ok.text.slice(0, 200));
    const big = await api('/api/rooms', 'POST', pad(100001), true);
    assert.equal(big.status, 413); assert.match(big.body.error, /100000/);
    assert.equal((await sendBytes(port, '/api/rooms', 400000)).status, 413, 'justo 4× el tope: todavía responde');
    assert.deepEqual(await sendBytes(port, '/api/rooms', 400001 + 16384 * 4), { cut: true });
    assert.equal((await fetch(s.base + '/api/health')).ok, true, 'el servidor sigue');
  });

  const a = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Extra A' })).body.id;
  const b = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Extra B' })).body.id;
  const q = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Extra Reina' })).body.id;

  await check('soldados de un entreno: 5 → 400; null → "random" (vale)', async () => {
    const five = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 1 }, soldiers: 5 });
    assert.equal(five.status, 400); assert.match(five.body.error, /entre 1 y 4/);
    const nul = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 1 }, soldiers: null, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(nul.status, 202, nul.text);
    await until(async () => done((await api(`/api/lab/trainings/${nul.body.id}`)).body), 60000, 'entreno');
  });

  await check('generación: sin objeto training vale; sus trabajos de cría existen; la cría y el relevo guardan los nombres; con soldiers 5, 400', async () => {
    const f = await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa A', netId: a }, B: { name: 'Casa B', netId: b } });
    assert.equal(f.status, 200, f.text);
    assert.equal((await api('/api/lab/dynasties/generation', 'POST', { training: { soldiers: 5 } })).status, 400);
    const good = await api('/api/lab/dynasties/generation', 'POST', { training: { duration: { games: 2 } }, children: { n: 1, pretournament: { games: 1 } } });
    assert.equal(good.status, 202, good.text);
    const job = await until(async () => { const r = (await api(`/api/lab/jobs/${good.body.jobId}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, 'generación');
    assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300));
    for (const h of ['A', 'B']) {
      const cj = await api(`/api/lab/jobs/${job.result.children[h]}`);
      assert.equal(cj.status, 200, `trabajo de cría de ${h}: ${job.result.children[h]}`);
      assert.equal(cj.body.kind, 'children');
    }
    const log = await logOf();
    const names = { [a]: 'Extra A', [b]: 'Extra B' };
    const children = log.filter((e) => e.type === 'dynasty' && e.event === 'children');
    assert.equal(children.length, 2);
    for (const e of children) assert.equal(e.motherName, names[e.parentId], JSON.stringify(e));
    const promote = log.filter((e) => e.type === 'dynasty' && e.event === 'promote');
    assert.equal(promote.length, 2);
    for (const e of promote) {
      assert.equal(e.motherName, names[e.mother], JSON.stringify(e));
      assert.equal(e.childName, (await api(`/api/lab/nets/${e.child}`)).body.genome.name, JSON.stringify(e));
    }
  });

  await check('trabajos y duelos: progreso final de una cría (n·partidas), 200 en los listados y 404 exacto para ids que no existen (M9)', async () => {
    const r = await api(`/api/lab/nets/${q}/children`, 'POST', { n: 2, pretournament: { games: 1, soldiers: 1 }, seed: 3 });
    assert.equal(r.status, 202, r.text);
    const job = await until(async () => { const x = (await api(`/api/lab/jobs/${r.body.jobId}`)).body; return x && x.status !== 'running' ? x : null; }, 120000, 'cría');
    assert.deepEqual([job.status, job.progress], ['done', { done: 2, total: 2 }]);
    for (const p of ['/api/lab/duels', '/api/lab/jobs', '/api/lab/trainings']) assert.equal((await api(p)).status, 200, p);
    for (const p of ['/api/lab/duels/d-nada', '/api/lab/jobs/j999999', '/api/lab/trainings/t999999']) assert.equal((await api(p)).status, 404, p);
    assert.equal((await api('/api/lab/duels/d-nada/stop', 'POST', {})).status, 404);
  });

  await check('pesos a mano: un cuerpo que no es un objeto → 400 con ejemplo; un valor no numérico en la posición 0 → weights-nan con ejemplo', async () => {
    const g = (await api(`/api/lab/nets/${q}`)).body.genome;
    const blk = g.blocks.find((x) => g.weights[x.id]).id;
    for (const body of [[1, 2], 5, 'x']) {
      const r = await api(`/api/lab/nets/${q}/weights/${blk}`, 'PUT', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.body.errors[0].code === 'weights-shape' && /números\]/.test(r.body.errors[0].example), JSON.stringify(r.body));
    }
    const key = Object.keys(g.weights[blk])[0];
    const arr = g.weights[blk][key].slice(); arr[0] = null;
    const r = await api(`/api/lab/nets/${q}/weights/${blk}`, 'PUT', { [key]: arr });
    assert.equal(r.status, 400);
    const e = r.body.errors.find((x) => x.code === 'weights-nan');
    assert.ok(e && /posición 0/.test(e.message) && e.example, JSON.stringify(r.body.errors));
  });

  await check('con varios hilos, las partidas de muestra del entreno también guardan la red tal como jugó (M2)', async () => {
    const tr = await api('/api/lab/trainings', 'POST', { netId: b, speed: 'turbo', workers: 2, duration: { games: 21 }, soldiers: 1, seed: 5, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(tr.status, 202, tr.text);
    await until(async () => done((await api(`/api/lab/trainings/${tr.body.id}`)).body), 120000, 'entreno con hilos');
    const games = (await api(`/api/lab/games?trainingId=${tr.body.id}&limit=5`)).body.games;
    assert.ok(games.length, 'premisa: hay partidas de muestra');
    for (const m of games) assert.ok(m.snaps && m.snaps[b], `${m.gameId} sin copia de la red`);
  });

  await check('diario: el de una red incluye sus retos (como retadora o como reina) y no los de otras; responde 200 (M4)', async () => {
    assert.equal((await api('/api/lab/throne/challenge', 'POST', { challenger: q })).body.result, 'seated');
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 2 });
    await until(async () => done((await api(`/api/lab/duels/${d.body.id}`)).body), 120000, 'duelo libre');
    const ch = await api('/api/lab/throne/challenge', 'POST', { challenger: a, learning: 'frozen', speed: 'turbo' });
    assert.equal(ch.status, 202, ch.text);
    await until(async () => done((await api(`/api/lab/duels/${ch.body.duelId}`)).body), 120000, 'reto');
    const da = await api(`/api/lab/nets/${a}/diary`);
    assert.equal(da.status, 200);
    assert.ok(da.body.entries.some((e) => e.kind === 'challenge'), 'la retadora tiene su reto');
    const db = await api(`/api/lab/nets/${b}/diary`);
    assert.ok(!db.body.entries.some((e) => e.kind === 'challenge'), 'una red ajena al reto no lo tiene');
  });

  await check('neuronas por la API: recorre las partidas más recientes, cada soldado entero, hasta pasar de 500 decisiones de disparo (M6)', async () => {
    const d = await api('/api/lab/duels', 'POST', { a: q, b, learning: 'frozen', speed: 'turbo', soldiers: 4, seed: 11 });
    await until(async () => done((await api(`/api/lab/duels/${d.body.id}`)).body), 180000, 'duelo de 4 soldados');
    const gdir = join(dir, 'games');
    const real = readdirSync(gdir).filter((f) => f.endsWith('.json.gz')).map((f) => JSON.parse(gunzipSync(readFileSync(join(gdir, f))).toString('utf8'))).filter((g) => (g.meta.nets || []).includes(q) && g.trajectories);
    assert.ok(real.length, 'premisa: partidas guardadas de la red con trayectorias');
    // copias con ts crecientes hasta pasar de sobra de 500 disparos (sin índice: el servidor lo reconstruye con las metas)
    const shootsOf = (g) => Object.values(g.trajectories).filter((t) => t && t.netId === q).reduce((n, t) => n + Object.values(t.soldiers || {}).reduce((m, st) => m + (st || []).filter((x) => x && x.obs && x.phase === 'shoot').length, 0), 0);
    let total = real.reduce((n, g) => n + shootsOf(g), 0), k = 0;
    const perRound = total;
    assert.ok(perRound > 0, 'premisa: la red disparó');
    while (total < 700) {
      for (const g0 of real) {
        const gameId = `copia-${String(k++).padStart(4, '0')}`;
        const meta = { ...g0.meta, gameId, ts: 2e12 + k };
        writeFileSync(join(gdir, `${gameId}.json.gz`), gzipSync(JSON.stringify({ ...g0, meta })));
        writeFileSync(join(gdir, `${gameId}.meta.json`), JSON.stringify(meta));
      }
      total += perRound;
    }
    rmSync(join(gdir, 'index.jsonl'), { force: true });
    // oráculo: el recorrido de spec/07 §12.7 (más recientes primero; cada soldado entero; para al pasar de 500)
    const metas = readdirSync(gdir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(readFileSync(join(gdir, f), 'utf8'))).filter((m) => (m.nets || []).includes(q))
      .sort((x, y) => (x.ts || 0) - (y.ts || 0) || String(x.gameId).localeCompare(String(y.gameId))).reverse();
    let used = 0;
    outer: for (const m of metas) {
      const g = JSON.parse(gunzipSync(readFileSync(join(gdir, `${m.gameId}.json.gz`))).toString('utf8'));
      for (const t of Object.values(g.trajectories || {})) {
        if (!t || t.netId !== q) continue;
        for (const st of Object.values(t.soldiers || {})) {
          const n = (st || []).filter((x) => x && x.obs && x.phase === 'shoot').length;
          if (!n) continue;
          used += n;
          if (used >= 500) break outer;
        }
      }
    }
    const r = await api(`/api/lab/nets/${q}/neurons`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.m, used, `m ${r.body.m} ≠ ${used}`);
    assert.ok(used >= 500 && used < total, `premisa: el tope corta (${used} de ${total})`);
  });

  await check('borrar la reina o una campeona: el fin de reinado y la dinastía guardan el nombre (M5)', async () => {
    const th = (await api('/api/lab/throne')).body;
    const queen = th.queen;
    const qName = (await api(`/api/lab/nets/${queen}`)).body.genome.name;
    assert.equal((await api(`/api/lab/nets/${queen}?force=1`, 'DELETE')).status, 200);
    const end = (await logOf()).filter((e) => e.type === 'reign.end' && e.netId === queen && e.reason === 'deleted').pop();
    assert.ok(end, 'premisa: fin de reinado por borrado');
    assert.equal(end.name, qName);
    const champ = (await api('/api/lab/dynasties')).body.B.champion;
    const cName = (await api(`/api/lab/nets/${champ}`)).body.genome.name;
    assert.equal((await api(`/api/lab/nets/${champ}?force=1`, 'DELETE')).status, 200);
    const del = (await logOf()).filter((e) => e.type === 'dynasty' && e.event === 'champion.deleted' && e.netId === champ).pop();
    assert.ok(del, 'premisa: campeona borrada');
    assert.deepEqual([del.name, del.houseName], [cName, 'Casa B']);
  });

  await check('tras reiniciar, los ids de entrenos y trabajos siguen detrás de los guardados (no se repiten)', async () => {
    const before = (await api('/api/lab/trainings')).body.trainings.map((t) => Number(t.id.slice(1)));
    const jobsBefore = (await api('/api/lab/jobs')).body.jobs.map((j) => Number(j.id.slice(1)));
    const c = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Extra Tras' })).body.id;
    const lastTr = (await api('/api/lab/trainings')).body.trainings.find((t) => t.netId === b && t.games === 21);
    const fullBefore = (await api(`/api/lab/trainings/${lastTr.id}`)).body;
    await s.stop();
    s = await startServer(dir, port + 1);
    api = apiOf(s);
    const saved = (await api(`/api/lab/trainings/${lastTr.id}`)).body;
    assert.equal(saved.curve.length, 21, 'el guardado lleva la curva entera');
    assert.deepEqual([saved.config.workers, saved.sampleGames], [fullBefore.config.workers, fullBefore.sampleGames]);
    const tr = await api('/api/lab/trainings', 'POST', { netId: c, speed: 'turbo', duration: { games: 1 }, soldiers: 1, opponents: { antagonist: 0, hallOfFame: 0, self: 1 } });
    assert.equal(tr.status, 202, tr.text);
    assert.equal(Number(tr.body.id.slice(1)), Math.max(...before) + 1, `${tr.body.id} tras ${before}`);
    await until(async () => done((await api(`/api/lab/trainings/${tr.body.id}`)).body), 60000, 'entreno');
    const ex = await api(`/api/lab/nets/${c}/bulletin`, 'POST', {});
    assert.equal(ex.status, 202, ex.text);
    assert.equal(Number(ex.body.jobId.slice(1)), Math.max(...jobsBefore) + 1, `${ex.body.jobId} tras ${jobsBefore}`);
    const exam = await until(async () => { const r = (await api(`/api/lab/jobs/${ex.body.jobId}`)).body; return r && r.status !== 'running' ? r : null; }, 120000, 'examen');
    assert.deepEqual([exam.status, exam.progress], ['done', { done: 96, total: 96 }]);
  });
} finally { await s.stop(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (parte 3, casos extra por la API)');
process.exitCode = fails ? 1 : 0;
