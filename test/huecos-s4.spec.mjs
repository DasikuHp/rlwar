// Huecos pequeños de la sesión 4 (sesión 6, 2026-09-24): `resetTrainerSeq` al cambiar de mundo (los ids de los entrenos
// siguen detrás de lo guardado en el mundo que se abre, spec/09 §4), el recorte a ±3 del ajuste fino del movimiento
// (spec/03: `a_i = clip(μ_i + pulse·gauss, −3, 3)`, y el movimiento "igual") y la rama del soldado caído de `Room.move`
// (spec/01 §9.2: el evento `move` también dice que se quedó, y `move()` devuelve ok). Escrito DESPUÉS del código (cubre
// supervivientes de los mutantes) y congelado. Uso: node test/huecos-s4.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s4-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const pol = await import('../shared/policy.js');
const { Room } = await import('../server/rooms.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');
const S = (id, team, x, y) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive: true, turns: 1, lastExpr: '' });

await check('ajuste fino del movimiento: con μ = (10, −10) la muestra se recorta a (3, −3) y el destino queda a 0,5·√18 u del elegido', () => {
  const g = normalize({ ...JSON.parse(JSON.stringify(TEMPLATES.turtle.genome)), id: 'recorte-1', name: 'r' });
  const fm = g.blocks.find((b) => b.type === 'foot.move');
  assert.ok(fm && fm.params.adjust, 'premisa: la Tortuga afina el destino');
  g.weights[fm.id].Wa = g.weights[fm.id].Wa.map(() => 0);
  g.weights[fm.id].ba = [10, -10];
  const net = compile(g);
  const st = { code: 'T', phase: 'playing', soldiers: [S('me', 'left', -10, 0), S('e', 'right', 10, 5)], obstacles: [], bites: [], players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE } };
  for (let seed = 1; seed <= 5; seed++) {
    const r = pol.decideMove({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(seed), shot: null });
    const a = r.decision.moveAdjust;
    assert.deepEqual(a.mu, [10, -10], 'premisa: μ');
    assert.deepEqual(a.sample, [3, -3], `semilla ${seed}: muestra ${a.sample}`);
    const to = r.decision.moves[r.decision.chosenMove].to;
    assert.ok(Math.abs(Math.hypot(a.target.x - to.x, a.target.y - to.y) - 0.5 * Math.sqrt(18)) < 1e-9, `semilla ${seed}: destino a ${Math.hypot(a.target.x - to.x, a.target.y - to.y)} u`);
  }
});

await check('sala: el soldado del turno cae antes de elegir destino → el evento `move` dice que se queda (stayed, reason "dead", sin pedido) y move() devuelve ok', () => {
  const room = new Room('caido', { soldiersPerPlayer: 1, seed: 13, headless: false });
  room.addPlayer('izq', 'left'); room.addPlayer('der', 'right');
  room.start();
  try {
    const pid = room.turn.playerId;
    const shooter = room.soldiers.find((s) => s.id === room.turn.soldierId);
    const r = room.fire(pid, { mode: 'function', expr: '0.3*x+40' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(room.turn.stage, 'move');
    const from = { x: shooter.x, y: shooter.y };
    const n0 = room.events.length;
    shooter.alive = false;
    const m = room.move(pid, { x: shooter.x + 1, y: shooter.y });
    assert.equal(m.ok, true, JSON.stringify(m));
    const ev = room.events.slice(n0).find((e) => e.type === 'move');
    assert.ok(ev, 'hay evento move');
    assert.deepEqual([ev.data.stayed, ev.data.reason, ev.data.requested, ev.data.why], [true, 'dead', null, null]);
    assert.deepEqual(ev.data.to, from);
  } finally { room.gameOver(true); }
});

// cambiar de mundo: los ids de los entrenos siguen detrás de lo guardado en el mundo que se abre (spec/09 §4)
const base = process.env.GW_EVO_DIR;
const port = 30000 + ((process.pid + 11000) % 10000);
const url = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: base }, stdio: 'ignore' });
try {
  const t0 = Date.now();
  for (;;) { try { if ((await fetch(url + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
  const api = async (p, method = 'GET', body) => {
    const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
    return { status: r.status, body: j, text: t };
  };
  const train = async () => {
    const net = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: `Contador ${Date.now()}` })).body.id;
    const r = await api('/api/lab/trainings', 'POST', { netId: net, speed: 'turbo', duration: { games: 1 }, soldiers: 1, seed: 1 });
    assert.equal(r.status, 202, r.text);
    for (;;) { const s = (await api(`/api/lab/trainings/${r.body.id}`)).body; if (['done', 'error', 'stopped'].includes(s.status)) break; await sleep(50); }
    return r.body.id;
  };
  await check('cambiar de mundo: los ids de los entrenos siguen detrás de lo guardado en el mundo que se abre (t1 en uno nuevo; al volver, detrás de los suyos)', async () => {
    assert.equal((await api('/api/worlds/1/new', 'POST', { path: 'cero' })).status, 201);
    assert.equal((await api('/api/worlds/1/open', 'POST', {})).status, 200);
    assert.deepEqual([await train(), await train(), await train()], ['t1', 't2', 't3']);
    assert.equal((await api('/api/worlds/2/new', 'POST', { path: 'algo' })).status, 201);
    assert.equal((await api('/api/worlds/2/open', 'POST', {})).status, 200);
    assert.equal(await train(), 't1', 'un mundo nuevo empieza en t1');
    assert.equal((await api('/api/worlds/1/open', 'POST', {})).status, 200);
    assert.equal(await train(), 't4', 'al volver al mundo 1, detrás de sus t1–t3 (no pisa t2)');
  });
} finally { srv.kill(); }

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (huecos s4: contador de entrenos por mundo, recorte ±3 del ajuste y soldado caído)');
process.exit(fails ? 1 : 0);
