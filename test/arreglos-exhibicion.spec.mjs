// Arreglo A2 (spec/04 §10.3; spec/revision-opus.md A2): las exhibiciones cuentan, se guardan y, con learn:true, enseñan.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-exhibicion.spec.mjs http://localhost:8791
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body: json, text };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error(`tiempo agotado: ${what}`); };
const { compile } = await import('../shared/nn.js');
const { TEMPLATES } = await import('../shared/templates.js');
const flat = (genome) => Array.from(compile(genome).getFlat());

const mkNet = async (template, name, patch = null) => {
  const r = await api('/api/lab/nets', 'POST', { template, name });
  assert.equal(r.status, 201, r.text);
  if (patch) { const g = { ...r.body.genome, ...patch(r.body.genome) }; const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', g); assert.equal(p.status, 200, p.text); }
  return (await api(`/api/lab/nets/${r.body.id}`)).body.genome;
};
// sala de exhibición por la API: red contra un rival; devuelve el estado final
const exhibition = async ({ left, right, soldiers = 1, seed = 5 }) => {
  const room = (await api('/api/rooms', 'POST', { name: 'exhibición', soldiers, seed })).body;
  for (const [spec, team] of [[left, 'left'], [right, 'right']]) { const r = await api(`/api/rooms/${room.code}/addagent`, 'POST', { ...spec, team }); assert.ok(r.body && r.body.ok, r.text); }
  await api(`/api/rooms/${room.code}/start`, 'POST', {});
  const st = await until(async () => { const s = (await api(`/api/rooms/${room.code}/state`)).body; return s.phase === 'over' ? s : null; }, 90000, 'fin de la exhibición');
  return { code: room.code, state: st, gameId: `g-${st.config.seed}-${room.code}` };
};
const logOf = async () => (await api('/api/lab/log?limit=1000')).body.entries;

await check('exhibición con learn:true (gradiente): suma solo stats.games, aprende (sueño en el log), guarda la partida y la recuerda', async () => {
  // cambio autorizado (P1, 2026-09-24): con el mapa de círculos, en la semilla 5 el Sniper podía matar antes de que la red
  // decidiera; se busca desde la 5 la primera exhibición en la que la red llega a decidir (una red nueva en cada intento)
  let g0 = null, ex = null;
  for (let seed = 5; seed < 25 && !ex; seed++) {
    const g = await mkNet('seer', `Exh Aprende ${seed}`);
    const e = await exhibition({ left: { type: 'net', netId: g.id, learn: true }, right: { type: 'sniper', level: 1 }, seed });
    const saved = await until(async () => { const r = await api(`/api/lab/games/${e.gameId}`); return r.status === 200 ? r.body : null; }, 20000, 'partida guardada');
    if (Object.values(saved.trajectories || {}).some((t) => Object.values(t.soldiers || {}).some((steps) => steps.length))) { g0 = g; ex = e; }
  }
  assert.ok(ex, 'premisa: en alguna semilla de 5 a 24 la red llega a decidir');
  const g1 = await until(async () => { const g = (await api(`/api/lab/nets/${g0.id}`)).body.genome; return g.stats.games === 1 ? g : null; }, 20000, 'stats.games = 1');
  assert.deepEqual({ wins: g1.stats.wins, kills: g1.stats.kills, deaths: g1.stats.deaths }, { wins: 0, kills: 0, deaths: 0 }, 'una exhibición no cuenta victorias ni bajas');
  assert.ok(flat(g1).some((v, i) => v !== flat(g0)[i]), 'con learn:true aprende de la partida');
  const up = (await logOf()).find((e) => e.type === 'update' && e.netId === g0.id);
  assert.ok(up && up.roomCode === ex.code && up.kind === 'gradient', JSON.stringify(up));
  const game = await api(`/api/lab/games/${ex.gameId}`);
  assert.equal(game.status, 200, 'la partida se guarda');
  assert.equal(game.body.meta.kind, 'exhibition'); assert.ok(game.body.trajectories && Object.keys(game.body.trajectories).length === 1);
  assert.ok(g1.memory && g1.memory.rivals && g1.memory.rivals.sniper && g1.memory.rivals.sniper.games === 1, 'la recuerda (rival sniper)');
});

await check('exhibición con learn:false: suma stats.games, se guarda y se recuerda, pero no cambia ningún peso', async () => {
  const g0 = await mkNet('seer', 'Exh Mira');
  const ex = await exhibition({ left: { type: 'sniper', level: 1 }, right: { type: 'net', netId: g0.id } , seed: 6 });
  const g1 = await until(async () => { const g = (await api(`/api/lab/nets/${g0.id}`)).body.genome; return g.stats.games === 1 ? g : null; }, 20000, 'stats.games = 1');
  assert.deepEqual(flat(g1), flat(g0));
  assert.equal((await api(`/api/lab/games/${ex.gameId}`)).status, 200);
  assert.ok(g1.memory.rivals.sniper && g1.memory.rivals.sniper.games === 1);
  assert.ok(!(await logOf()).some((e) => e.type === 'update' && e.netId === g0.id), 'sin sueño');
});

await check('exhibición con learn:true de una red de evolución: paso de evolución contra el rival de la sala', async () => {
  const g0 = await mkNet('seer', 'Exh Evoluciona', (g) => ({ learning: { ...g.learning, method: 'evolution', evolution: { ...g.learning.evolution, population: 4, gamesPerCandidate: 1 } } }));
  const ex = await exhibition({ left: { type: 'net', netId: g0.id, learn: true }, right: { type: 'greedy', level: 1 }, seed: 7 });
  const up = await until(async () => (await logOf()).find((e) => e.type === 'update' && e.netId === g0.id), 60000, 'paso de evolución');
  assert.equal(up.kind, 'evolution'); assert.equal(up.roomCode, ex.code); assert.equal(up.games, 4);
  const g1 = (await api(`/api/lab/nets/${g0.id}`)).body.genome;
  assert.ok(flat(g1).some((v, i) => v !== flat(g0)[i]));
  assert.equal(g1.stats.games, 1, 'las copias no cuentan como partidas de la red');
});

await check('una red que está entrenando no se toca en una exhibición (queda exhibition.skipped en el log)', async () => {
  const g0 = await mkNet('sniper', 'Exh Ocupada');
  const tr = await api('/api/lab/trainings', 'POST', { netId: g0.id, speed: 'turbo', workers: 1, duration: { games: 100000 }, soldiers: 1, seed: 1 });
  assert.equal(tr.status, 202, tr.text);
  try {
    const ex = await exhibition({ left: { type: 'net', netId: g0.id, learn: true }, right: { type: 'sniper', level: 1 }, seed: 8 });
    const sk = await until(async () => (await logOf()).find((e) => e.type === 'exhibition.skipped' && e.netId === g0.id), 20000, 'exhibition.skipped');
    assert.equal(sk.roomCode, ex.code);
  } finally { await api(`/api/lab/trainings/${tr.body.id}/stop`, 'POST', {}); }
});

await check('las salas de los entrenos no son exhibiciones: un entreno x10 de 1 partida suma 1 partida, no 2', async () => {
  const g0 = await mkNet('sniper', 'Exh Entreno');
  const tr = await api('/api/lab/trainings', 'POST', { netId: g0.id, speed: 'x10', duration: { games: 1 }, soldiers: 1, seed: 2 });
  await until(async () => { const t = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return ['done', 'stopped', 'error'].includes(t.status) ? t : null; }, 60000, 'entreno x10');
  await sleep(500);
  const g1 = (await api(`/api/lab/nets/${g0.id}`)).body.genome;
  assert.equal(g1.stats.games, 1);
  assert.ok(!(await logOf()).some((e) => e.netId === g0.id && (e.type === 'exhibition.skipped' || (e.type === 'update' && e.roomCode))));
});

void clone; void TEMPLATES;
console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: exhibiciones)');
process.exitCode = fails ? 1 : 0;
