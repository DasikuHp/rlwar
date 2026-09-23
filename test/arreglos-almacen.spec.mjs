// Parte 3, almacenamiento (spec/revision-opus.md §3.3 M2, M9, M15, B3): las partidas se guardan comprimidas y con un
// índice de metas; cada partida guarda (sin duplicar) la red tal como jugó, así la moviola es exacta; duelos, entrenos y
// trabajos terminados sobreviven a un reinicio; el salón de la fama guarda rutas relativas y avisa si falta una copia.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-almacen.spec.mjs [http://localhost:8791]
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-almacen-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const store = await import('../evo/store.js');
const TH = await import('../evo/throne.js');
const T = await import('../evo/train.js');
const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const save = (key, id, name = id) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), id, name }); assert.ok(r.ok, JSON.stringify(r)); return store.loadNet(id); };
const ev = (g) => [{ id: 1, t: 0, game: g, turn: 0, type: 'game.start', actor: {}, data: { note: 'x'.repeat(2000) } }];

// ---------- M15: partidas comprimidas ----------
await check('M15: saveGame guarda <id>.json.gz (gzip del JSON de siempre) y su meta al lado; loadGame la lee; una partida antigua en .json se sigue leyendo', () => {
  const dir = store.gamesDir();
  const r = store.saveGame({ gameId: 'g-gz-1', kind: 'duel', nets: ['gz'], ts: 1 }, ev('g-gz-1'), { p1: { netId: 'gz', soldiers: {} } });
  assert.equal(r.ok, true);
  assert.ok(existsSync(join(dir, 'g-gz-1.json.gz')) && existsSync(join(dir, 'g-gz-1.meta.json')) && !existsSync(join(dir, 'g-gz-1.json')), readdirSync(dir).join(','));
  const raw = JSON.parse(gunzipSync(readFileSync(join(dir, 'g-gz-1.json.gz'))).toString('utf8'));
  assert.deepEqual(raw, { meta: { gameId: 'g-gz-1', kind: 'duel', nets: ['gz'], ts: 1 }, events: ev('g-gz-1'), trajectories: { p1: { netId: 'gz', soldiers: {} } } });
  assert.deepEqual(store.loadGame('g-gz-1'), raw);
  assert.ok(readFileSync(join(dir, 'g-gz-1.json.gz')).length < JSON.stringify(raw).length, 'ocupa menos');
  writeFileSync(join(dir, 'g-old-1.json'), JSON.stringify({ meta: { gameId: 'g-old-1', kind: 'duel', nets: ['gz'], ts: 2 }, events: ev('g-old-1') }));
  assert.equal(store.loadGame('g-old-1').meta.gameId, 'g-old-1');
});

// ---------- M15: índice de metas ----------
await check('M15: listGames usa el índice (sin abrir partidas ni metas); si falta, lo reconstruye; la retención lo mantiene y se compacta', () => {
  for (let i = 0; i < 30; i++) store.saveGame({ gameId: `g-ix-${i}`, kind: 'training', nets: ['ix'], ts: 100 + i }, ev(`g-ix-${i}`));
  const want = store.listGames({ netId: 'ix' }).map((m) => m.gameId);
  assert.equal(want.length, 30);
  const dir = store.gamesDir();
  assert.ok(existsSync(join(dir, 'index.jsonl')), 'hay índice');
  unlinkSync(join(dir, 'index.jsonl'));
  assert.deepEqual(store.listGames({ netId: 'ix' }).map((m) => m.gameId), want, 'sin índice, lo reconstruye con las metas');
  assert.ok(existsSync(join(dir, 'index.jsonl')), 'y lo vuelve a escribir');
  for (let i = 0; i < 30; i++) for (const f of [`g-ix-${i}.meta.json`, `g-ix-${i}.json.gz`]) unlinkSync(join(dir, f));
  assert.deepEqual(store.listGames({ netId: 'ix' }).map((m) => m.gameId), want, 'con el índice no abre nada más');
  for (let i = 0; i < 260; i++) store.saveGameKept({ gameId: `g-rt-${i}`, kind: 'training', nets: ['rt'], ts: 1000 + i }, ev(`g-rt-${i}`));
  const kept = store.listGames({ netId: 'rt' });
  assert.equal(kept.length, 200); assert.ok(!kept.some((m) => m.ts < 1060), 'se van las más antiguas');
  const lines = readFileSync(join(dir, 'index.jsonl'), 'utf8').trim().split('\n').length;
  const live = store.listGames().length;
  assert.ok(lines <= 2 * live + 200, `índice compacto: ${lines} líneas para ${live} partidas`);
});

// ---------- M2: la red tal como jugó ----------
await check('M2: saveGame con {genomes} guarda cada red una sola vez por su huella (meta.snaps) y loadSnapshot la devuelve; al podar partidas se borran las copias que ya nadie usa', () => {
  const a = save('seer', 'sn-a'), b = save('sniper', 'sn-b');
  const r1 = store.saveGameKept({ gameId: 'g-sn-1', kind: 'duel', nets: ['sn-a', 'sn-b'], ts: 1 }, ev('g-sn-1'), null, { genomes: { 'sn-a': a, 'sn-b': b } });
  const r2 = store.saveGameKept({ gameId: 'g-sn-2', kind: 'duel', nets: ['sn-a', 'sn-b'], ts: 2 }, ev('g-sn-2'), null, { genomes: { 'sn-a': a, 'sn-b': b } });
  assert.ok(r1.ok && r2.ok);
  const m1 = store.listGames({ netId: 'sn-a' }).find((m) => m.gameId === 'g-sn-1'), m2 = store.listGames({ netId: 'sn-a' }).find((m) => m.gameId === 'g-sn-2');
  assert.deepEqual(Object.keys(m1.snaps).sort(), ['sn-a', 'sn-b']);
  assert.deepEqual(m1.snaps, m2.snaps, 'misma red, misma copia');
  assert.deepEqual(clone(store.loadSnapshot(m1.snaps['sn-a'])), clone(a));
  const a2 = { ...clone(a), weights: clone(a.weights) }; const k = Object.keys(a2.weights)[0]; const kk = Object.keys(a2.weights[k])[0]; a2.weights[k][kk][0] += 1;
  store.saveGameKept({ gameId: 'g-sn-3', kind: 'duel', nets: ['sn-a'], ts: 3 }, ev('g-sn-3'), null, { genomes: { 'sn-a': a2 } });
  const m3 = store.listGames({ netId: 'sn-a' }).find((m) => m.gameId === 'g-sn-3');
  assert.notEqual(m3.snaps['sn-a'], m1.snaps['sn-a'], 'pesos distintos, copia distinta');
  const snapFiles = () => readdirSync(join(process.env.GW_EVO_DIR, 'snapshots'));
  assert.equal(snapFiles().length, 3);
  store.saveGameKept({ gameId: 'g-sn-4', kind: 'duel', nets: ['sn-b'], ts: 4 }, ev('g-sn-4'), null, { genomes: { 'sn-b': b } }); // solo de sn-b: no se poda con sn-a
  for (let i = 0; i < 200; i++) store.saveGameKept({ gameId: `g-sn-x${i}`, kind: 'training', nets: ['sn-a'], ts: 10 + i }, ev(`g-sn-x${i}`));
  assert.ok(!store.listGames({ netId: 'sn-a' }).some((m) => ['g-sn-1', 'g-sn-2', 'g-sn-3'].includes(m.gameId)), 'premisa: la retención borró las tres');
  const left = snapFiles();
  assert.ok(left.some((f) => f.startsWith(m1.snaps['sn-b'])), 'la copia de sn-b sigue: la usa g-sn-4');
  assert.ok(!left.some((f) => f.startsWith(m1.snaps['sn-a'])) && !left.some((f) => f.startsWith(m3.snaps['sn-a'])), 'las copias de sn-a ya no las usa nadie: se borran');
  assert.equal(left.length, 1);
});

// ---------- B3: salón de la fama con rutas relativas ----------
await check('B3: la copia de una ex-reina se guarda con ruta relativa; se encuentra aunque se mueva la carpeta; si falta, el entreno lo avisa en el registro', async () => {
  TH.writeThrone(TH.emptyThrone());
  save('seer', 'hf-q', 'Reina Fama'); save('sniper', 'hf-c', 'Retadora Fama'); save('turtle', 'hf-t', 'Entrena Fama');
  await TH.challenge({ challenger: 'hf-q' }, { now: () => 1000 });
  await TH.challenge({ challenger: 'hf-c' }, { runDuel: async (o) => ({ id: 'd-hf', a: o.a, b: o.b, status: 'done', games: [{ winner: o.a }], wins: { [o.a]: 4, [o.b]: 2 }, killDiff: 0, winner: o.a, tie: false, throne: true, ms: 1 }), now: () => 2000 });
  const h = TH.readThroneFull().hallOfFame[0];
  assert.ok(h && !isAbsolute(h.snapshot) && !/^[A-Za-z]:/.test(h.snapshot) && !h.snapshot.includes('\\'), `ruta relativa con /: ${h.snapshot}`);
  assert.ok(existsSync(join(process.env.GW_EVO_DIR, h.snapshot)));
  const moved = mkdtempSync(join(tmpdir(), 'gw-evo-movida-'));
  cpSync(process.env.GW_EVO_DIR, moved, { recursive: true });
  const old = process.env.GW_EVO_DIR; process.env.GW_EVO_DIR = moved; rmSync(old, { recursive: true, force: true });
  const train = async () => { const t = T.createTrainer({ netId: 'hf-t', opponents: { antagonist: 0, hallOfFame: 1, self: 0 }, speed: 'turbo', workers: 1, duration: { games: 1 }, soldiers: 1, seed: 7 }); const kinds = []; t.on('curve', (d) => kinds.push(d.rival ?? (d.point && d.point.rival))); await t.start(); return kinds; };
  const log0 = logOf().length;
  assert.deepEqual(await train(), ['hallOfFame'], 'juega contra la ex-reina movida');
  assert.ok(!logOf().slice(log0).some((e) => e.type === 'warning'), 'sin avisos');
  unlinkSync(join(moved, h.snapshot));
  const log1 = logOf().length;
  await train();
  const w = logOf().slice(log1).find((e) => e.type === 'warning');
  assert.ok(w && w.netId === 'hf-t' && w.snapshot === h.snapshot && /salón de la fama/.test(w.message), JSON.stringify(w));
});

// ---------- M9: registros que sobreviven a un reinicio (servidores propios) ----------
const startServer = async (dir, port) => {
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  return { base, stop: () => new Promise((r) => { srv.once('exit', r); srv.kill(); }) };
};
await check('M9: duelos, entrenos y trabajos terminados se guardan en disco: tras reiniciar, GET por id y los listados los siguen dando', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-evo-reinicio-'));
  const port = 20000 + (process.pid % 20000);
  let s = await startServer(dir, port);
  const api = async (p, method = 'GET', body = undefined) => { const res = await fetch(s.base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: res.status, body: j, text: t }; };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
  try {
    const a = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Reinicio A' })).body.id, b = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Reinicio B' })).body.id;
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 3 });
    const duel = await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.status !== 'running' ? r : null; }, 120000, 'duelo');
    const tr = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 2 }, soldiers: 1, seed: 4 });
    const training = await until(async () => { const r = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return r && !['queued', 'running', 'paused'].includes(r.status) ? r : null; }, 120000, 'entreno');
    const ex = await api(`/api/lab/nets/${b}/bulletin`, 'POST', {});
    const job = await until(async () => { const r = (await api(`/api/lab/jobs/${ex.body.jobId}`)).body; return r && r.status !== 'running' ? r : null; }, 120000, 'examen');
    await s.stop();
    s = await startServer(dir, port + 1);
    const d2 = await api(`/api/lab/duels/${duel.id}`), t2 = await api(`/api/lab/trainings/${training.id}`), j2 = await api(`/api/lab/jobs/${job.id}`);
    assert.equal(d2.status, 200, d2.text); assert.equal(t2.status, 200, t2.text); assert.equal(j2.status, 200, j2.text);
    assert.deepEqual([d2.body.status, d2.body.winner, d2.body.games.length], [duel.status, duel.winner, duel.games.length]);
    assert.deepEqual([t2.body.status, t2.body.games], [training.status, training.games]);
    assert.deepEqual([j2.body.status, j2.body.kind, j2.body.netId], [job.status, 'exam', b]);
    assert.ok((await api('/api/lab/duels')).body.duels.some((x) => x.id === duel.id), 'en el listado de duelos');
    assert.ok((await api('/api/lab/trainings')).body.trainings.some((x) => x.id === training.id), 'en el de entrenos');
    assert.ok((await api('/api/lab/jobs')).body.jobs.some((x) => x.id === job.id), 'en el de trabajos');
  } finally { await s.stop(); }
});

// ---------- M2 por la API: moviola exacta ----------
if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => { const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: res.status, body: j, text: t }; };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
  const brainsMatch = async (gid, netId) => {
    const game = await until(async () => { const g = await api(`/api/lab/games/${gid}`); return g.status === 200 ? g.body : null; }, 20000, 'partida guardada');
    // las del jugador cuya trayectoria se guarda (en un entreno contra sí misma, la rival lleva el mismo netId)
    const decs = game.events.filter((e) => e.type === 'decision' && e.actor.netId === netId && e.data.phase === 'shoot' && typeof e.data.value === 'number' && game.trajectories && game.trajectories[e.actor.playerId]);
    assert.ok(decs.length, `premisa: decisiones con valor en ${gid}`);
    for (const d of decs.slice(0, 3)) {
      const r = await api(`/api/lab/games/${gid}/turns/${d.turn}/brain?player=${d.actor.playerId}`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.approx, false, 'moviola exacta');
      assert.equal(r.body.outputs.value, d.data.value, `valor del turno ${d.turn}: ${r.body.outputs.value} ≠ ${d.data.value}`);
    }
  };

  await check('M2: la moviola de una exhibición que enseñó a la red (pesos ya cambiados), de un duelo libre y de un entreno es exacta (approx:false, mismo valor que en la partida)', async () => {
    const id = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Moviola Exacta' })).body.id, rival = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Rival Exacta' })).body.id;
    const room = (await api('/api/rooms', 'POST', { name: 'exacta', soldiers: 2, seed: 8 })).body;
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId: id, learn: true, team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', {});
    const st = await until(async () => { const x = (await api(`/api/rooms/${room.code}/state`)).body; return x.phase === 'over' ? x : null; }, 120000, 'exhibición');
    const w0 = JSON.stringify((await api(`/api/lab/nets/${id}`)).body.genome.weights);
    await until(async () => JSON.stringify((await api(`/api/lab/nets/${id}`)).body.genome.weights) !== w0 || null, 20000, 'la red aprendió').catch(() => null);
    await brainsMatch(`g-${st.config.seed}-${room.code}`, id);
    const d = await api('/api/lab/duels', 'POST', { a: id, b: rival, learning: 'mix', speed: 'turbo', soldiers: 2, seed: 9 });
    const rec = await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, 'duelo');
    await brainsMatch(rec.games[rec.games.length - 1].gameId, id);
    const tr = await api('/api/lab/trainings', 'POST', { netId: id, speed: 'turbo', duration: { games: 21 }, soldiers: 1, seed: 10 });
    const t = await until(async () => { const r = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return r && !['queued', 'running', 'paused'].includes(r.status) ? r : null; }, 180000, 'entreno');
    const sample = (await api(`/api/lab/games?trainingId=${t.id}&limit=5`)).body.games[0];
    assert.ok(sample, 'premisa: el entreno guarda partidas de muestra');
    await brainsMatch(sample.gameId, id);
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: almacenamiento)');
process.exitCode = fails ? 1 : 0;
