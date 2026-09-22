// Arreglos del motor tras la revisión de Opus (spec/01 §9; spec/revision-opus.md C2 y A5).
// Escrito ANTES del código y congelado. Uso: node test/arreglos-motor.spec.mjs [http://localhost:8791]
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = await import('../shared/constants.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');
const { TEMPLATES } = await import('../shared/templates.js');

// Escena de fuego amigo: el tirador del turno, un aliado 5 u delante en su horizontal, enemigos lejos y fuera
// de esa línea, sin obstáculos. `y = 0` en modo función es la horizontal que pasa por el tirador.
function ffScene({ headless = true, humans = false, seed = 11 } = {}) {
  const room = new Room('ff', { soldiersPerPlayer: 2, seed, headless });
  if (humans) { room.addPlayer('izq', 'left'); room.addPlayer('der', 'right'); }
  else { room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' }); }
  room.start();
  const pid = room.turn.playerId;
  const shooter = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const ally = room.soldiers.find((s) => s.ownerId === pid && s.id !== shooter.id);
  const dir = shooter.team === 'left' ? 1 : -1;
  room.obstacles = [];
  shooter.x = -12 * dir; shooter.y = 0;
  ally.x = shooter.x + 5 * dir; ally.y = 0;
  room.soldiers.filter((s) => s.team !== shooter.team).forEach((e, i) => { e.x = 18 * dir; e.y = 8 + 3 * i; });
  return { room, pid, shooter, ally };
}
const since = (room, from) => room.events.slice(from);

await check('fuego amigo con move en el cuerpo (sin pantalla): muere solo el aliado, el tirador sigue vivo y el turno pasa', () => {
  const { room, pid, shooter, ally } = ffScene();
  const n0 = room.events.length;
  const r = room.fire(pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.type, 'suicide');
  assert.equal(ally.alive, false, 'el aliado muere');
  assert.equal(shooter.alive, true, 'el tirador sigue vivo (spec/01 §2.4)');
  const evs = since(room, n0);
  const ff = evs.filter((e) => e.type === 'friendlyFire'), deaths = evs.filter((e) => e.type === 'death');
  assert.equal(ff.length, 1); assert.equal(ff[0].actor.soldierId, shooter.id); assert.equal(ff[0].data.victimSoldierId, ally.id);
  assert.deepEqual(deaths.map((e) => e.actor.soldierId), [ally.id], 'una sola muerte: la del aliado');
  assert.ok(room.lastMove && room.lastMove.soldierId === shooter.id && room.lastMove.stayed === true);
  assert.equal(room.phase, 'playing');
  assert.ok(room.turn && room.turn.stage === 'shoot' && room.turn.soldierId !== shooter.id, `el turno pasa: ${JSON.stringify(room.turn)}`);
});

await check('fuego amigo con el agente en proceso (sin move en el cuerpo): se pide chooseMove y el turno pasa', () => {
  const { room, pid, shooter } = ffScene({ seed: 12 });
  let asked = 0;
  const agent = room.agents[pid];
  const orig = agent.chooseMove ? agent.chooseMove.bind(agent) : null;
  agent.chooseMove = (ctx) => { asked++; return orig ? orig(ctx) : 'stay'; };
  const r = room.fire(pid, { mode: 'function', expr: '0' });
  assert.equal(r.result.type, 'suicide');
  assert.equal(shooter.alive, true);
  assert.equal(asked, 1, 'el tirador vivo elige destino');
  assert.ok(room.turn && room.turn.stage === 'shoot' && room.turn.soldierId !== shooter.id, JSON.stringify(room.turn));
});

await check('move() con el soldado del turno ya muerto: cierra el turno sin mover (reason dead), nunca lo deja abierto', () => {
  const { room, pid, shooter } = ffScene({ humans: true, headless: false, seed: 13 });
  try {
  const r = room.fire(pid, { mode: 'function', expr: '0.3*x+40' }); // sin move: el humano tiene su ventana
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(room.turn.stage, 'move');
  const from = { x: shooter.x, y: shooter.y };
  shooter.alive = false; // muerto por cualquier causa antes de elegir destino
  const m = room.move(pid, { x: shooter.x + 1, y: shooter.y });
  assert.ok(!m.error, `sin error: ${JSON.stringify(m)}`);
  assert.ok(room.lastMove && room.lastMove.stayed === true && room.lastMove.reason === 'dead' && room.lastMove.slid === false);
  assert.deepEqual(room.lastMove.to, from, 'no se mueve');
  assert.ok(room.turn === null || room.turn.stage === 'shoot', 'el turno se cierra');
  } finally { room.gameOver(true); }
});

await check('sala viva (FAST): tras un fuego amigo de un humano que no elige destino, llega el turno siguiente', async () => {
  const { room, pid, shooter } = ffScene({ humans: true, headless: false, seed: 14 });
  try {
  const r = room.fire(pid, { mode: 'function', expr: '0' });
  assert.equal(r.result.type, 'suicide');
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && !(room.turn && room.turn.stage === 'shoot')) await sleep(50);
  assert.ok(room.turn && room.turn.stage === 'shoot', `sigue atascada: ${JSON.stringify(room.turn)}`);
  assert.equal(shooter.alive, true);
  assert.ok(room.lastMove && room.lastMove.soldierId === shooter.id && room.lastMove.reason === 'timeout');
  } finally { room.gameOver(true); }
});

await check('redes de plantilla con 4 soldados (semillas 1..30): ninguna partida acaba "por límite" sin llegar a MAX_SHOTS; tras un fuego amigo se sigue jugando', () => {
  const g = TEMPLATES.sniper.genome;
  let withFF = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = playGame({ seed, left: { type: 'net', genome: { ...g, id: 'ff-a', name: 'A' } }, right: { type: 'net', genome: { ...g, id: 'ff-b', name: 'B' } }, soldiers: 4 });
    assert.ok(!r.result.byLimit || r.result.shots >= C.MAX_SHOTS, `semilla ${seed}: acaba por límite con ${r.result.shots} disparos`);
    const ev = r.events;
    ev.forEach((e, i) => {
      if (e.type !== 'friendlyFire') return;
      withFF++;
      const shooterDeath = ev.find((d) => d.type === 'death' && d.actor.soldierId === e.actor.soldierId && d.data.shotEventId === e.data.shotEventId);
      assert.ok(!shooterDeath, `semilla ${seed}: el tirador muere por su propio fuego amigo`);
      const alive = { left: r.result.aliveLeft, right: r.result.aliveRight };
      const shotsAfter = ev.slice(i + 1).filter((x) => x.type === 'shot').length;
      assert.ok(shotsAfter > 0 || alive.left === 0 || alive.right === 0, `semilla ${seed}: la partida se para tras el fuego amigo`);
    });
  }
  assert.ok(withFF >= 5, `la muestra tiene fuegos amigos (${withFF})`);
});

if (BASE) {
  const api = async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  await check('API: POST /api/rooms {speed:10} crea una sala x10 que no admite humanos; sin speed, x1', async () => {
    const r = await api('/api/rooms', 'POST', { name: 'x10', soldiers: 1, speed: 10 });
    const st = await api(`/api/rooms/${r.code}/state`);
    assert.equal(st.config.speed, 10);
    const j = await fetch(`${BASE}/api/rooms/${r.code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'yo' }) });
    assert.equal(j.status, 400); assert.match((await j.json()).error, /solo agentes/);
    const r1 = await api('/api/rooms', 'POST', { name: 'x1', soldiers: 1 });
    assert.equal((await api(`/api/rooms/${r1.code}/state`)).config.speed, 1);
    const r7 = await api('/api/rooms', 'POST', { name: 'x7', soldiers: 1, speed: 7 });
    assert.equal((await api(`/api/rooms/${r7.code}/state`)).config.speed, 1, 'otro valor → 1');
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos del motor)');
process.exitCode = fails ? 1 : 0; // no process.exit(): en Node 24 (Windows) aborta tras fetch seguidos
