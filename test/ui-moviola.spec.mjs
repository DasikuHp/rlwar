// Moviola en el mismo sitio (P6, sesión 14; diseño del relevo s9): shared/moviola.js rehace cada tiro de una
// partida guardada con el solver (en el servidor: en el navegador, Math.sin difiere en el último bit). Aquí se juegan partidas de verdad (sala con pantalla, x10, en este proceso), se recoge
// lo que la sala manda por el SSE (los mismos bytes que recibe el navegador) y se comprueba que la moviola, con solo los
// eventos guardados, rehace cada curva punto por punto, cada movimiento y el final.
// Uso: node test/ui-moviola.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_FAST = '1';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-moviola-'));
const { Room } = await import('../server/rooms.js');
const { replay, stateAt, shotText, thin, withCurves } = await import('../shared/moviola.js');

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// una partida con pantalla a x10 entre dos agentes; `sse` = lo que se escribió a los oyentes, ya leído como el navegador
async function live(seed, left, right) {
  const room = new Room('moviola', { seed, speed: 10 });
  const sse = [];
  room.listeners.add({ write(s) { const m = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(s); if (m) sse.push({ ev: m[1], data: JSON.parse(m[2]) }); } });
  assert.ok(!room.addAgent(left, { team: 'left', level: 3 }).error);
  assert.ok(!room.addAgent(right, { team: 'right', level: 3 }).error);
  assert.ok(!room.start().error);
  const t0 = Date.now();
  while (room.phase !== 'over') { if (Date.now() - t0 > 90000) throw new Error(`la partida ${seed} no acaba`); await sleep(50); }
  room.listeners.clear();
  // la partida tal como se guarda y se sirve (JSON)
  return { room, sse, game: JSON.parse(JSON.stringify({ meta: { gameId: room.gameId }, events: room.events })) };
}

const GAMES = [[11, 'artillery', 'chaos'], [12, 'sniper', 'greedy'], [13, 'chaos', 'artillery'], [14, 'greedy', 'sniper']];
const played = [];
for (const [seed, a, b] of GAMES) played.push(await live(seed, a, b));

await check('game.start trae dónde empieza cada soldado (positions) y coincide con el primer estado de la sala', () => {
  for (const { game, sse } of played) {
    const st = game.events.find((e) => e.type === 'game.start').data;
    assert.ok(Array.isArray(st.positions) && st.positions.length === 4, 'cuatro soldados');
    const first = sse.find((x) => x.ev === 'state' && x.data.phase === 'playing').data;
    for (const p of st.positions) {
      const s = first.soldiers.find((q) => q.id === p.id);
      assert.ok(s && s.x === p.x && s.y === p.y && s.team === p.team && s.ownerId === p.playerId, `soldado ${p.id}`);
    }
  }
});

await check('cada curva rehecha es la del SSE, punto por punto, y la moviola la da por exacta', () => {
  for (const { game, sse } of played) {
    const rp = replay(game);
    assert.ok(rp.ok && !rp.approx && rp.unknown.length === 0);
    const shots = sse.filter((x) => x.ev === 'shot').map((x) => x.data.shot);
    assert.equal(rp.frames.length, shots.length, 'un fotograma por tiro');
    rp.frames.forEach((f, i) => {
      assert.equal(f.soldierId, shots[i].soldierId, `tiro ${i}: tirador`);
      assert.equal(f.expr, shots[i].expr, `tiro ${i}: función`);
      assert.equal(f.team, shots[i].shooterTeam, `tiro ${i}: bando`);
      assert.deepEqual(f.points, shots[i].points, `tiro ${i} (${f.mode} ${f.expr}): curva`);
      assert.ok(f.exact, `tiro ${i}: exacto`);
    });
  }
});

await check('cada movimiento y el final (posiciones, bajas y bocados) son los de la sala', () => {
  for (const { game, sse } of played) {
    const rp = replay(game);
    const moves = sse.filter((x) => x.ev === 'move').map((x) => x.data.move);
    assert.equal(moves.length, rp.frames.length, 'un movimiento tras cada tiro');
    rp.frames.forEach((f, i) => {
      assert.ok(f.move, `tiro ${i}: su movimiento`);
      assert.deepEqual(f.move.to, moves[i].to, `tiro ${i}: destino`);
      assert.equal(f.move.stayed, moves[i].stayed, `tiro ${i}: se queda`);
    });
    const last = sse.filter((x) => x.ev === 'state').pop().data;
    assert.equal(last.phase, 'over');
    for (const s of last.soldiers) {
      const r = rp.final.soldiers.find((q) => q.id === s.id);
      assert.ok(r && r.x === s.x && r.y === s.y && r.alive === s.alive, `soldado ${s.id} al acabar`);
    }
    assert.deepEqual(rp.final.bites, last.bites, 'bocados al acabar');
    const end = stateAt(rp, rp.frames.length);
    assert.equal(end.kills.left, last.result.killsLeft, 'bajas del bando izquierdo');
    assert.equal(end.kills.right, last.result.killsRight, 'bajas del bando derecho');
    assert.ok(rp.result && rp.result.winner === last.result.winner, 'quién ganó');
  }
});

await check('las partidas cubren lo difícil: dos modos o más, bocados, movimientos y bajas', () => {
  const frames = played.flatMap(({ game }) => replay(game).frames);
  const modes = new Set(frames.map((f) => f.mode));
  assert.ok(modes.size >= 2, `modos: ${[...modes].join(', ')}`);
  assert.ok(frames.filter((f) => f.bite).length >= 3, 'bocados');
  assert.ok(frames.some((f) => f.move && !f.move.stayed), 'alguien se mueve');
  assert.ok(frames.some((f) => f.result.kills > 0), 'alguna baja');
  // un tiro que pasa por un bocado anterior: el terreno roto cuenta
  assert.ok(frames.some((f) => f.bites.length > 0), 'tiros con bocados ya hechos');
});

await check('stateAt: al empezar, cada soldado en su sitio y sin curvas; después de k tiros, k curvas y el plano de antes del siguiente', () => {
  const rp = replay(played[0].game);
  const s0 = stateAt(rp, 0);
  assert.equal(s0.trails.length, 0);
  assert.deepEqual(s0.soldiers.map((s) => [s.id, s.x, s.y, s.alive]), rp.initial.map((s) => [s.id, s.x, s.y, true]));
  const k = Math.min(3, rp.frames.length);
  const sk = stateAt(rp, k);
  assert.equal(sk.trails.length, rp.frames.slice(0, k).filter((f) => f.points.length > 1).length);
  if (k < rp.frames.length) assert.deepEqual(sk.soldiers, rp.frames[k].soldiers);
  assert.equal(stateAt(rp, -5).k, 0); assert.equal(stateAt(rp, 1e6).k, rp.frames.length);
});

await check('partida anterior a hoy (sin positions): cada soldado sale de su primer movimiento y las curvas siguen siendo exactas', () => {
  for (const { game, sse } of played) {
    const old = JSON.parse(JSON.stringify(game));
    delete old.events.find((e) => e.type === 'game.start').data.positions;
    const rp = replay(old);
    assert.ok(rp.ok && rp.approx);
    const shots = sse.filter((x) => x.ev === 'shot').map((x) => x.data.shot);
    rp.frames.forEach((f, i) => assert.deepEqual(f.points, shots[i].points, `tiro ${i}`));
    // quien no llegó a moverse (murió antes de su turno) no se sabe dónde estaba: se dice
    const movers = new Set(old.events.filter((e) => e.type === 'move').map((e) => e.actor.soldierId));
    const dead = new Set(old.events.filter((e) => e.type === 'death').map((e) => e.actor.soldierId));
    assert.deepEqual(rp.unknown.sort(), [...dead].filter((id) => !movers.has(id)).sort());
  }
});

await check('si lo guardado no cuadra (un alcanzado que no está en la curva), ese tiro no se da por exacto', () => {
  const { game } = played.find(({ game }) => replay(game).frames.some((f) => f.result.kills > 0));
  const bad = JSON.parse(JSON.stringify(game));
  const shot = bad.events.find((e) => e.type === 'shot' && e.data.result.kills > 0);
  shot.data.result.hits = ['s-nadie'];
  const rp = replay(bad);
  const f = rp.frames.find((x) => x.turn === shot.turn && x.soldierId === shot.actor.soldierId);
  assert.equal(f.exact, false);
});

await check('sin mapa guardado, la moviola lo dice en vez de inventar', () => {
  const rp = replay({ events: [{ type: 'game.start', data: { map: { name: 'x' } } }] });
  assert.equal(rp.ok, false); assert.match(rp.why, /no guarda su mapa/);
  assert.equal(replay(null).ok, false);
});

await check('withCurves (lo que manda el servidor): cada tiro lleva su curva aligerada y exact; el navegador la dibuja sin resolver nada', () => {
  for (const { game, sse } of played) {
    const shots = sse.filter((x) => x.ev === 'shot').map((x) => x.data.shot);
    const light = JSON.parse(JSON.stringify(withCurves(game.events)));
    const withPts = light.filter((e) => e.type === 'shot');
    assert.equal(withPts.length, shots.length);
    withPts.forEach((e, i) => { assert.deepEqual(e.data.points, thin(shots[i].points), `tiro ${i}`); assert.equal(e.data.exact, true); });
    const a = replay(game), b = replay({ events: light });
    assert.ok(b.ok && b.frames.every((f) => f.exact));
    b.frames.forEach((f, i) => {
      assert.deepEqual(f.points, thin(a.frames[i].points), `tiro ${i}: puntos del servidor`);
      assert.deepEqual([f.soldiers, f.bites, f.move], [a.frames[i].soldiers, a.frames[i].bites, a.frames[i].move], `tiro ${i}: el plano de antes`);
    });
    assert.deepEqual(b.final, a.final);
    // un tiro que el servidor no dio por exacto sigue sin serlo en el navegador
    light.find((e) => e.type === 'shot').data.exact = false;
    assert.equal(replay({ events: light }).frames[0].exact, false);
  }
});

await check('thin: guarda el primero y el último, deja ≥ step entre puntos y redondea a milésimas', () => {
  const pts = Array.from({ length: 1001 }, (_, i) => [i * 0.01, Math.sin(i * 0.01)]);
  const t = thin(pts, 0.1);
  assert.deepEqual(t[0], [0, 0]);
  assert.deepEqual(t[t.length - 1], [10, Math.round(Math.sin(10) * 1000) / 1000]);
  for (let i = 1; i < t.length - 1; i++) assert.ok(Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]) >= 0.099, `hueco ${i}`);
  assert.ok(t.length < 150 && t.length > 70, `${t.length} puntos`);
  assert.deepEqual(thin([[1, 2]]), [[1, 2]]);
});

await check('shotText cuenta el tiro en palabras', () => {
  const f = (r) => ({ result: { kills: 0, friendly: 0, hits: [], ...r } });
  assert.match(shotText(f({ kills: 1, hits: ['s1'] }), () => 'Vidente'), /acierta a Vidente/);
  assert.match(shotText(f({ kills: 2, hits: ['s1', 's2'] })), /2 bajas de un tiro/);
  assert.match(shotText(f({ friendly: 1, hits: ['s1'] })), /aliado/);
  assert.match(shotText(f({ end: 'obstacle' })), /roca/);
  assert.match(shotText(f({ end: 'wall' })), /sale del plano/);
});

console.log(fails ? `\n${fails} fallo(s)` : '\nmoviola: todo en verde');
process.exit(fails ? 1 : 0);
