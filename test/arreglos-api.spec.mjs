// Arreglos A5, M14 y M16 (spec/08 §9): rutas que faltaban, retención de partidas y `shared/` en el navegador.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-api.spec.mjs [http://localhost:8791]
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-a5-'));

const BASE = process.argv[2] || null;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const strip = (d) => { const x = clone(d); delete x.ms; return x; };

const store = await import('../evo/store.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const policy = await import('../shared/policy.js');
const { DEFAULT_MUTATION } = await import('../evo/mutate.js');

await check('shared/, evo/truth.js y evo/voice.js no usan Node: sin imports node: y cargan sin `process`', () => {
  const files = [...readdirSync(join(ROOT, 'shared')).filter((f) => f.endsWith('.js')).map((f) => `shared/${f}`), 'evo/truth.js', 'evo/voice.js'];
  for (const f of files) assert.ok(!/from\s+['"]node:/.test(readFileSync(join(ROOT, f), 'utf8')), `${f} importa un módulo de Node`);
  const code = "globalThis.process = undefined; const mods = ['./shared/constants.js', './shared/genome.js', './shared/nn.js', './shared/percept.js', './shared/policy.js', './shared/templates.js', './evo/truth.js', './evo/voice.js']; for (const m of mods) await import(m); console.log('ok');";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'ok', r.stderr.split('\n').slice(0, 4).join(' | '));
});

await check('partidas: cada una deja su meta al lado; listGames la usa; retención de 200 por red (saveGame la aplica)', () => {
  const ev = (g) => [{ id: 1, t: 0, game: g, turn: 0, type: 'game.start', actor: {}, data: {} }];
  for (let i = 0; i < 205; i++) {
    const gameId = `g-${i}-RET${String(i).padStart(3, '0')}`;
    assert.equal(store.saveGame({ gameId, kind: 'training', nets: ['ret-a'], ts: 1000 + i }, ev(gameId)).ok, true);
  }
  const files = readdirSync(store.gamesDir());
  assert.ok(files.some((f) => f.endsWith('.meta.json')), 'hay ficheros meta');
  const list = store.listGames({ netId: 'ret-a' });
  assert.equal(list.length, 200, 'como mucho 200 por red');
  assert.ok(!list.some((m) => m.ts < 1005), 'se borran las más antiguas');
  assert.ok(!files.includes('g-0-RET000.json') || !readdirSync(store.gamesDir()).includes('g-0-RET000.json'));
  store.saveGame({ gameId: 'g-9-THRN', kind: 'duel', throne: true, nets: ['ret-a'], ts: 1 }, ev('g-9-THRN'));
  assert.ok(store.listGames({ netId: 'ret-a' }).some((m) => m.gameId === 'g-9-THRN'), 'un duelo de trono no se borra');
});

await check('curvas en disco: los puntos de un entreno sobreviven y se agrupan por entreno', () => {
  assert.equal(typeof store.appendCurve, 'function'); assert.equal(typeof store.readCurves, 'function');
  store.appendCurve('cur-a', 't1', [{ game: 1, reward: 0.5, win: 1, kills: 1, deaths: 0 }, { game: 2, reward: -0.2, win: 0, kills: 0, deaths: 1 }]);
  store.appendCurve('cur-a', 't2', [{ game: 1, reward: 0.1, win: 0, kills: 0, deaths: 0, kind: 'showcase' }]);
  const c = store.readCurves('cur-a');
  assert.deepEqual(c.map((x) => [x.trainingId, x.points.length]), [['t1', 2], ['t2', 1]]);
  assert.equal(c[1].points[0].kind, 'showcase'); assert.ok(typeof c[0].points[0].t === 'number');
});

if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text, type: res.headers.get('content-type') || '' };
  };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(200); } throw new Error(`tiempo agotado: ${what}`); };

  await check('catálogo: mutation con los 12 tipos de spec/05 §1, explicados y con sus valores por defecto', async () => {
    const m = (await api('/api/lab/catalog')).body.mutation;
    assert.deepEqual(m.map((x) => x.key), Object.keys(DEFAULT_MUTATION));
    for (const x of m) {
      assert.ok(x.name && x.explain && x.example && ['aprendiz', 'artesano', 'cientifico'].includes(x.level), x.key);
      const d = DEFAULT_MUTATION[x.key];
      for (const p of x.params) { assert.deepEqual(p.default, d[p.key], `${x.key}.${p.key}`); if (p.type === 'number') assert.ok(p.min <= p.default && p.default <= p.max); }
      assert.deepEqual(x.params.map((p) => p.key).sort(), Object.keys(d).sort(), x.key);
    }
  });

  let netId;
  const scene = { soldiers: [{ id: 'me', team: 'left', x: -15, y: -3 }, { id: 'e1', team: 'right', x: 12, y: 4 }, { id: 'e2', team: 'right', x: 18, y: -8 }], obstacles: [{ x: -2, y: -6, w: 3, h: 9 }], soldierId: 'me' };
  await check('whatif: la decisión es la de decideShot con esa escena (misma semilla); no guarda nada', async () => {
    netId = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Que Pasaria' })).body.id;
    const before = (await api(`/api/lab/nets/${netId}`)).body.genome;
    const r = await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3 });
    assert.equal(r.status, 200, r.text);
    const d = r.body.decision;
    assert.ok(d.candidates.length > 0 && d.candidates.every((c) => Array.isArray(c.points)) && Number.isInteger(d.chosen) && Array.isArray(d.attribution));
    const net = compile(before);
    const state = { soldiers: scene.soldiers.map((s) => ({ ownerId: s.team === 'left' ? 'pL' : 'pR', alive: true, turns: 0, ...s })), obstacles: scene.obstacles, shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, players: [] };
    const ref = policy.decideShot({ net, genome: before, state, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(3), attribution: true });
    assert.equal(d.chosen, ref.decision.chosen); assert.equal(d.candidates.length, ref.decision.candidates.length);
    d.candidates.forEach((c, i) => assert.ok(Math.abs(c.p - ref.decision.candidates[i].p) < 1e-12 && c.expr === ref.decision.candidates[i].expr));
    assert.deepEqual((await api(`/api/lab/nets/${netId}`)).body.genome, before, 'la red no cambia');
  });

  await check('whatif: genoma alternativo (temperatura baja), fase move y errores 400 con motivo', async () => {
    const g = (await api(`/api/lab/nets/${netId}`)).body.genome;
    const cold = { ...g, traits: { ...g.traits, temperature: 0.05 } };
    const a = (await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3 })).body.decision;
    const b = (await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3, genome: cold })).body.decision;
    assert.ok(Math.max(...b.candidates.map((c) => c.p)) > Math.max(...a.candidates.map((c) => c.p)), 'más fría, más segura');
    const mv = await api(`/api/lab/nets/${netId}/whatif`, 'POST', { scene, seed: 3, phase: 'move' });
    assert.equal(mv.status, 200, mv.text); assert.equal(mv.body.decision.moves.length, 9);
    for (const bad of [{ scene: { ...scene, soldierId: 'nadie' } }, { scene: { ...scene, soldiers: [{ id: 'me', team: 'left', x: -99, y: 0 }] } }, { scene, genome: { format: 1 } }, { scene: { ...scene, soldiers: scene.soldiers.map((s) => (s.id === 'me' ? { ...s, alive: false } : s)) } }]) {
      const r = await api(`/api/lab/nets/${netId}/whatif`, 'POST', bad);
      assert.equal(r.status, 400, r.text); assert.ok(r.body.error && r.body.error.length > 5);
    }
  });

  await check('curvas y lista de partidas por la API tras un entreno', async () => {
    const rival = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Rival Curvas' })).body.id;
    const tr = await api('/api/lab/trainings', 'POST', { netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: rival }, speed: 'turbo', workers: 1, duration: { games: 6 }, soldiers: 1, seed: 4 });
    await until(async () => (await api(`/api/lab/trainings/${tr.body.id}`)).body.status === 'done', 60000, 'entreno');
    const c = (await api(`/api/lab/nets/${netId}/curves`)).body;
    assert.equal(c.netId, netId); assert.ok(Array.isArray(c.reigns));
    const mine = c.trainings.find((x) => x.trainingId === tr.body.id);
    assert.ok(mine && mine.points.length === 6 && mine.points.every((p) => typeof p.reward === 'number' && [0, 1].includes(p.win)), JSON.stringify(c).slice(0, 300));
    const games = (await api(`/api/lab/games?netId=${netId}`)).body.games;
    assert.ok(games.length >= 1 && games.every((m) => m.nets.includes(netId)));
    assert.ok(games.every((m, i) => i === 0 || games[i - 1].ts >= m.ts), 'de la más reciente a la más antigua');
    const byTr = (await api(`/api/lab/games?trainingId=${tr.body.id}&limit=1`)).body.games;
    assert.equal(byTr.length, 1); assert.equal(byTr[0].trainingId, tr.body.id);
    assert.deepEqual((await api('/api/lab/games?netId=nadie-aqui')).body.games, []);
  });

  await check('estáticos: /shared/*.js, /evo/truth.js y /evo/voice.js se sirven; nada más de evo/ ni fuera de sitio', async () => {
    for (const p of ['/shared/genome.js', '/shared/constants.js', '/evo/truth.js', '/evo/voice.js']) { const r = await api(p); assert.equal(r.status, 200, p); assert.match(r.type, /javascript/); }
    for (const p of ['/evo/api.js', '/evo/store.js', '/shared/../server/rooms.js', '/evo/nets/x.json', '/shared/no-existe.js']) assert.equal((await api(p)).status, 404, p);
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: API, retención y shared en el navegador)');
process.exitCode = fails ? 1 : 0;
