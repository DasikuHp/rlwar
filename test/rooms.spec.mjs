// F1 — Room sin pantalla (spec/01 §2, §4, §6): jugadores, validaciones, estancamiento, límites,
// fin de partida, snapshot. Rápido y determinista (GW_FAST, sin temporizadores). Sin servidor.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const C = await import('../shared/constants.js');
const { Room } = await import('../server/rooms.js');
const { DEFAULT_AGENT } = await import('../agents/registry.js');
const lib = await import('../agents/lib.js');
const { makeRng } = await import('../shared/rng.js');

const headless = (seed, soldiers = 2, left = 'sniper', right = 'greedy') => {
  const room = new Room('h', { soldiersPerPlayer: soldiers, seed, headless: true });
  room.addAgent(left, { level: 3, team: 'left' });
  room.addAgent(right, { level: 3, team: 'right' });
  return room;
};
// dispara "fallando" (parábola que se estrella enseguida) con el jugador del turno
const miss = (room) => room.fire(room.turn.playerId, { mode: 'function', expr: 'x^2' });

check('constantes FAST: STALL 4, MAX 40, MOVE_TIME 400', () => {
  assert.equal(C.STALL_SHOTS, 4); assert.equal(C.MAX_SHOTS, 40); assert.equal(C.MOVE_TIME, 400);
});

check('addPlayer/addAgent: reparto automático de equipos, equipo lleno, sala llena, nombres repetidos, recortes', () => {
  const room = new Room('v', { seed: 1 });
  const a = room.addPlayer('a', 'auto'), b = room.addPlayer('b', 'auto'), c = room.addPlayer('c');
  assert.equal(a.player.team, 'left'); assert.equal(b.player.team, 'right'); assert.equal(c.player.team, 'left', 'empate → izquierda');
  assert.ok(a.token && a.token !== b.token);
  room.addPlayer('d', 'left'); room.addPlayer('e', 'left');
  assert.ok(room.addPlayer('f', 'left').error, 'izquierda llena (4)');
  assert.equal(room.addAgent('sniper', { team: 'left' }).error && true, true, 'ni agentes en un equipo lleno');
  room.addAgent('sniper', { team: 'right' }); room.addAgent('sniper', { team: 'right' }); room.addAgent('chaos', { team: 'right' });
  assert.equal(room.players.length, 8);
  assert.ok(room.addPlayer('g', 'right').error, 'sala llena (8)');
  assert.ok(room.addAgent('chaos').error, 'sala llena para agentes');
  const names = room.players.filter((p) => p.agentType === 'sniper').map((p) => p.name);
  assert.deepEqual(names, ['🎯 Sniper', '🎯 Sniper 2']);
  const r2 = new Room('t', { seed: 1 });
  const ag = r2.addAgent('greedy', { level: 9, temperature: 7, team: 'right' });
  const p = r2.players.find((q) => q.id === ag.player.id);
  assert.equal(p.level, 3); assert.equal(p.temperature, 1);
  const bad = r2.addAgent('noexiste', { team: 'left' });
  assert.equal(r2.players.find((q) => q.id === bad.player.id).agentType, DEFAULT_AGENT, 'tipo desconocido → agente por defecto');
  assert.equal(r2.addBot(2).player.agentType, DEFAULT_AGENT, 'addBot = greedy');
  assert.equal(new Room('x', { soldiersPerPlayer: 9 }).soldiersPerPlayer, 4); assert.equal(new Room('x', { soldiersPerPlayer: 0 }).soldiersPerPlayer, 2);
  assert.equal(new Room('nombre larguísimo '.repeat(5)).name.length, 40);
});

check('start: exige dos equipos, jugador de la sala, una sola vez; banter de presentación en bocadillo', () => {
  const room = new Room('s', { seed: 2, headless: true });
  assert.ok(room.start().error, 'sin jugadores');
  room.addAgent('sniper', { team: 'left' });
  assert.ok(room.start().error, 'un solo equipo');
  room.addAgent('chaos', { team: 'right' });
  assert.ok(room.start('p-inexistente').error, 'jugador que no está');
  assert.deepEqual(room.start(), { ok: true });
  assert.equal(room.phase, 'playing'); assert.ok(room.turn && room.turn.stage === 'shoot');
  assert.ok(room.start().error, 'dos veces no');
  assert.ok(room.addAgent('greedy').error, 'no se entra con la partida en marcha');
  const says = room.chat.filter((c) => c.kind === 'say');
  assert.equal(says.length, 2, 'cada bot se presenta'); assert.ok(says.every((c) => c.soldierId && c.playerId));
  assert.ok(room.chat.some((c) => /Mapa:/.test(c.text)));
  assert.equal(room.soldiers.length, 4);
});

check('fire: validaciones (turno, modo, expresión, ángulo, etapa) y registro del disparo', () => {
  const room = headless(3);
  room.start();
  const pid = room.turn.playerId, other = room.players.find((p) => p.id !== pid).id;
  assert.ok(room.fire(other, { mode: 'function', expr: 'x' }).error, 'no es su turno');
  assert.ok(room.fire(pid, { mode: 'laser', expr: 'x' }).error, 'modo inválido');
  assert.ok(/inválida/.test(room.fire(pid, { mode: 'function', expr: 'x +' }).error), 'expresión rota');
  assert.ok(room.fire(pid, { mode: 'ode2', expr: '-0.05', angle: 90 }).error, 'ángulo fuera de rango');
  assert.equal(room.shots, 0);
  const r = room.fire(pid, { mode: 'ode2', expr: '-0.05', angle: 85, move: 'stay' });
  assert.ok(r.ok && r.result && r.result.type, JSON.stringify(r));
  assert.equal(room.shots, 1); assert.equal(room.history.length, 1);
  assert.equal(room.lastShot.playerId, pid); assert.equal(room.lastShot.mode, 'ode2'); assert.equal(room.lastShot.expr, '-0.05');
  assert.ok(room.soldiers.find((s) => s.id === room.lastShot.soldierId).lastExpr.startsWith("y'' ="));
  assert.ok(room.turn && room.turn.playerId !== pid, 'turno del otro');
  assert.ok(room.move(pid, { x: 0, y: 0 }).error, 'sin turno no se mueve');
  assert.ok(room.move(room.turn.playerId, { x: 0, y: 0 }).error, 'primero se dispara');
  room.gameOver(true);
  assert.ok(room.fire(room.players[0].id, { mode: 'function', expr: 'x' }).error, 'partida acabada');
  assert.ok(room.move(room.players[0].id, 'stay').error);
});

// cambio autorizado (P1, spec/01 §10.4, 2026-09-24): ya no hay renovación de mapa por estancamiento
check('sin renovación y límite: 4 fallos → el mismo mapa (muertos quietos, historial intacto); 40 disparos → empate técnico', () => {
  const room = headless(4, 2, 'chaos', 'chaos');
  room.start();
  const dead = room.soldiers[0];
  dead.alive = false;
  const deadPos = { x: dead.x, y: dead.y };
  const map0 = JSON.stringify(room.obstacles);
  for (let i = 0; i < 4; i++) { assert.ok(miss(room).ok); assert.equal(room.remaps, 0); }
  assert.equal(room.shotsNoKill, 4, 'los fallos siguen contando');
  assert.equal(JSON.stringify(room.obstacles), map0, 'el mapa no cambia (los bocados van aparte)');
  assert.deepEqual([dead.x, dead.y], [deadPos.x, deadPos.y], 'el muerto no se mueve');
  assert.equal(room.history.length, 4, 'la memoria de expresiones no se vacía');
  assert.ok(!room.chat.some((c) => /renovado/.test(c.text)));
  while (room.phase === 'playing') assert.ok(miss(room).ok);
  assert.equal(room.shots, 40); assert.equal(room.remaps, 0, 'nunca se renueva');
  assert.equal(room.result.byLimit, true); assert.equal(room.winner, 'right', 'con 1-1 en bajas (uno muerto a mano) decide… no: 0 kills; deciden supervivientes 1 vs 2');
  assert.equal(room.result.shots, 40); assert.equal(room.result.aliveLeft, 1); assert.equal(room.result.aliveRight, 2);
  assert.ok(room.chat.some((c) => /Límite de disparos/.test(c.text)));
});

check('gameOver: desempates (bajas, luego supervivientes, luego empate) y victoria por aniquilación', () => {
  const mk = () => { const r = headless(5, 2, 'chaos', 'chaos'); r.start(); return r; };
  let r = mk(); r.players[0].kills = 2; r.players[1].kills = 1; r.gameOver(true);
  assert.equal(r.winner, r.players[0].team); assert.equal(r.result.killsLeft + r.result.killsRight, 3);
  r = mk(); r.players[0].kills = 1; r.players[1].kills = 1; r.soldiers.find((s) => s.team === 'right').alive = false; r.gameOver(true);
  assert.equal(r.winner, 'left', 'mismas bajas → más supervivientes');
  r = mk(); r.gameOver(true);
  assert.equal(r.winner, null); assert.ok(r.chat.some((c) => /Empate técnico/.test(c.text)));
  assert.deepEqual(r.result, { winner: null, shots: 0, remaps: 0, byLimit: true, killsLeft: 0, killsRight: 0, aliveLeft: 2, aliveRight: 2 });
  r = mk(); for (const s of r.soldiers) if (s.team === 'left') s.alive = false; r.gameOver(false);
  assert.equal(r.winner, 'right'); assert.equal(r.phase, 'over'); assert.equal(r.turn, null);
  assert.ok(r.chat.some((c) => /Victoria del equipo DERECHO/.test(c.text)));
  r = mk(); for (const s of r.soldiers) if (s.team === 'right') s.alive = false; r.gameOver(true);
  assert.equal(r.winner, 'left', 'aniquilación gana aunque sea por límite');
});

check('un kill real: contadores, bocadillo de burla, soldado muerto no vuelve a disparar', () => {
  const room = headless(6, 2, 'sniper', 'greedy');
  room.start();
  let killed = false;
  for (let i = 0; i < 60 && room.phase === 'playing' && !killed; i++) {
    const st = room.snapshot();
    const cand = lib.searchShot(st, room.turn.soldierId, 40, { rng: makeRng(i) });
    const r = room.fire(room.turn.playerId, cand);
    assert.ok(r.ok, r.error);
    if (r.result.type === 'kill') {
      killed = true;
      const shooter = room.players.find((p) => p.id === room.lastShot.playerId);
      const victim = room.soldiers.find((s) => s.id === r.result.soldierId);
      const owner = room.players.find((p) => p.id === victim.ownerId);
      assert.equal(victim.alive, false); assert.equal(shooter.kills, 1); assert.equal(owner.deaths, 1);
      assert.ok(room.chat.some((c) => c.text.includes('eliminó a') && c.text.includes(owner.name)));
      const lastSay = room.chat.filter((c) => c.kind === 'say').pop();
      assert.equal(lastSay.playerId, shooter.id, 'burla del que mata');
      assert.equal(room.shotsNoKill, 0);
      assert.equal(room.snapshot().players.find((p) => p.id === owner.id).alive, 1);
    }
  }
  assert.ok(killed, 'hubo un kill en 60 turnos');
  const deadIds = new Set(room.soldiers.filter((s) => !s.alive).map((s) => s.id));
  for (let i = 0; i < 20 && room.phase === 'playing'; i++) { assert.ok(!deadIds.has(room.turn.soldierId), 'un muerto nunca tiene el turno'); miss(room); }
});

check('move: quieto/válido/deslizado registran requested; fire con move inválido (NaN) deja quieto', () => {
  const room = headless(7);
  room.start();
  const s = room.soldiers.find((x) => x.id === room.turn.soldierId);
  const sx = s.x, sy = s.y;
  const r1 = room.fire(room.turn.playerId, { mode: 'function', expr: 'x^2', move: { x: sx + 0.5, y: sy } });
  assert.ok(r1.ok && r1.move.requested && near(r1.move.requested.x, sx + 0.5) && near(r1.move.from.x, sx), JSON.stringify(r1.move));
  assert.equal(r1.move.reason, r1.move.slid ? 'slide' : 'ok');
  const s2 = room.soldiers.find((x) => x.id === room.turn.soldierId);
  const r2 = room.fire(room.turn.playerId, { mode: 'function', expr: 'x^2', move: { x: NaN, y: 1 } });
  assert.ok(r2.ok && r2.move.stayed && r2.move.requested === null && r2.move.reason === 'invalid');
  assert.ok(near(s2.x, r2.move.from.x) && near(s2.y, r2.move.from.y));
  const r3 = room.fire(room.turn.playerId, { mode: 'function', expr: 'x^2', move: { x: 99, y: 99 } });
  assert.ok(r3.ok && r3.move.requested.x === 99 && Math.hypot(r3.move.to.x - r3.move.from.x, r3.move.to.y - r3.move.from.y) <= 2 + 1e-9, 'lejos → recortado');
  assert.ok(room.chat.some((c) => /se queda quieto/.test(c.text)) && room.chat.some((c) => /se mueve a/.test(c.text)));
});

check('snapshot: chat 40, history 12, config, jugadores; addChat; rematch reinicia', () => {
  const room = headless(8, 1, 'chaos', 'chaos');
  room.start();
  for (let i = 0; i < 50; i++) room.log('ruido ' + i);
  assert.equal(room.snapshot().chat.length, 40); assert.ok(room.chat.length <= 120);
  for (let i = 0; i < 13 && room.phase === 'playing'; i++) room.fire(room.turn.playerId, { mode: 'function', expr: `x^2+${i}` });
  assert.ok(room.snapshot().history.length <= 12);
  const st = room.snapshot();
  assert.deepEqual(st.config.plane, { xMin: -25, xMax: 25, yMin: -15, yMax: 15 }); assert.equal(st.config.turnTime, C.TURN_TIME);
  assert.equal(st.players.length, 2); assert.ok(st.players.every((p) => typeof p.alive === 'number' && p.isBot && p.agentType === 'chaos'));
  assert.equal(st.soldiers.length, 2); assert.ok(st.soldiers.every((s) => 'lastExpr' in s && 'ownerId' in s));
  assert.equal(room.addChat(room.players[0].id, 'hola').ok, true);
  assert.ok(room.chat.pop().text.startsWith(room.players[0].name + ': hola'));
  room.addChat('nadie', 'x'); assert.ok(room.chat.pop().text.startsWith('?: x'));
  assert.ok(room.rematch().error, 'solo tras acabar');
  room.gameOver(true);
  room.players[0].kills = 3; room.soldiers[0].alive = false;
  assert.deepEqual(room.rematch(), { ok: true });
  assert.equal(room.phase, 'playing'); assert.ok(room.soldiers.every((s) => s.alive)); assert.equal(room.players[0].kills, 0);
  assert.equal(room.shots, 0); assert.equal(room.lastShot, null); assert.equal(room.lastMove, null); assert.equal(room.result, null);
});

check('banter: sin lista o sin soldado no habla; variables sustituidas', () => {
  const room = headless(9);
  const n = room.chat.length;
  room.banter(room.players[0], null, ['hola']); room.banter(room.players[0], { id: 's' }, []); room.banter(room.players[0], { id: 's' }, null);
  assert.equal(room.chat.length, n);
  room.banter(room.players[0], { id: 's' }, ['adiós {victim}'], { victim: 'Rex' });
  assert.ok(room.chat.pop().text.endsWith('adiós Rex'));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (sala F1)');
process.exit(fails ? 1 : 0);
