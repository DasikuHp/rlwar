// F1 — Motor: movimiento tras disparar, semilla, partidas sin pantalla, ángulo de artillería.
// Contrato: spec/01-motor.md. Escrito ANTES del código y congelado.
// P1b (2026-09-24, OK del usuario, spec/10): ya no se desliza ni se recorta; `slid` desaparece (reason/why); los 9 destinos
// a 1,5 u. Cambian las comprobaciones de las constantes, de slideMove, de moveOptions y de Sniper/Greedy/Artillery.
// Uso: node test/motor.spec.mjs [http://localhost:8791]   (la parte de API necesita el servidor)
process.env.GW_FAST = '1'; // las salas vivas de este test usan tiempos cortos
import { strict as assert } from 'node:assert';

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const C = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const { slideMove } = await import('../shared/geometry.js');
const { simulateShot } = await import('../shared/solver.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');
const lib = await import('../agents/lib.js');
const { createAgent } = await import('../agents/registry.js');

// ---------- validez independiente (spec/01 §3), para no fiarse del código ----------
const PLANE = C.PLANE, R = C.MOVE_RADIUS, BODY = C.BODY, SEP = C.MIN_SEPARATION;
// cambio autorizado (P1, 2026-09-24): el terreno también son círculos y bocados (spec/01 §10.1, reescrito aquí): círculo
// d ≤ r + BODY, rectángulo agrandado BODY; sólido si está en algún obstáculo y fuera de los bocados encogidos (d < r − BODY)
const insideExpanded = (P, o) => (o.kind === 'circle' ? dist(P, o) <= o.r + BODY : !(P.x < o.x - BODY || P.x > o.x + o.w + BODY || P.y < o.y - BODY || P.y > o.y + o.h + BODY));
const solid = (P, obstacles, bites) => obstacles.some((o) => insideExpanded(P, o)) && !bites.some((b) => dist(P, b) < b.r - BODY);
const segmentClear = (from, P, obstacles, bites = []) => {
  for (let k = 1; k <= 10; k++) {
    const t = k / 10, Q = { x: from.x + (P.x - from.x) * t, y: from.y + (P.y - from.y) * t };
    if (solid(Q, obstacles, bites)) return false;
  }
  return true;
};
const isValid = (P, from, soldiers, selfId, obstacles, bites = []) =>
  dist(P, from) <= R + 1e-9 &&
  P.x >= PLANE.xMin + BODY && P.x <= PLANE.xMax - BODY && P.y >= PLANE.yMin + BODY && P.y <= PLANE.yMax - BODY &&
  !solid(P, obstacles, bites) &&
  soldiers.every((s) => s.id === selfId || !s.alive || dist(P, s) >= SEP) &&
  segmentClear(from, P, obstacles, bites);
// mejor distancia posible a T con una rejilla fina (fuerza bruta)
const bruteBest = (T, from, soldiers, selfId, obstacles) => {
  let best = Infinity;
  for (let x = from.x - R; x <= from.x + R + 1e-9; x += 0.01) for (let y = from.y - R; y <= from.y + R + 1e-9; y += 0.01) {
    const P = { x, y };
    if (isValid(P, from, soldiers, selfId, obstacles)) best = Math.min(best, dist(P, T));
  }
  return best;
};
const me = { id: 's1', team: 'left', x: 0, y: 0, alive: true };
const base = { from: { x: 0, y: 0 }, soldiers: [me], obstacles: [], selfId: 's1', plane: PLANE };

// ---------- constantes ----------
await check('constantes nuevas de F1', () => {
  assert.equal(C.MOVE_RADIUS, 2); assert.equal(C.BODY, 0.5); assert.equal(C.MIN_SEPARATION, 1.0);
  assert.equal(C.MOVE_TIME, 400, 'FAST: 400 ms'); assert.equal(C.MOVE_OPTION_RADIUS, 1.5); assert.equal(C.MOVE_DIRS, 8);
});

// ---------- rng ----------
await check('makeRng: determinista, [0,1), int/pick/gauss/seed, y compatible con Math.random', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = Array.from({ length: 5 }, () => a()), sb = Array.from({ length: 5 }, () => b());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c()));
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  assert.equal(a.seed, 42);
  for (let i = 0; i < 100; i++) { const n = a.int(7); assert.ok(Number.isInteger(n) && n >= 0 && n < 7); }
  assert.ok(['p', 'q'].includes(a.pick(['p', 'q'])));
  assert.ok(Number.isFinite(a.gauss()));
  assert.equal(typeof makeRng(1), 'function');
});

// ---------- slideMove ----------
await check('slideMove: destino válido dentro del radio → allí (reason "ok")', () => {
  const r = slideMove({ ...base, requested: { x: 1.2, y: -0.7 } });
  assert.ok(near(r.to.x, 1.2) && near(r.to.y, -0.7)); assert.equal(r.reason, 'ok'); assert.equal(r.why, null); assert.equal(r.stayed, false);
});
await check('slideMove: fuera del radio → pierde el movimiento (blocked, far), sin recortar', () => {
  const r = slideMove({ ...base, requested: { x: 3, y: 4 } });
  assert.deepEqual(r.to, base.from); assert.equal(r.stayed, true); assert.equal(r.reason, 'blocked'); assert.equal(r.why, 'far');
});
await check('slideMove: "stay", null y undefined → quieto (reason "stay")', () => {
  for (const req of ['stay', null, undefined]) {
    const r = slideMove({ ...base, requested: req });
    assert.deepEqual(r.to, base.from); assert.equal(r.stayed, true); assert.equal(r.reason, 'stay');
  }
});
await check('slideMove: NaN, cadena o Infinity → quieto con reason "invalid" (nunca lanza)', () => {
  for (const req of [{ x: NaN, y: 0 }, { x: '1', y: 0 }, { x: Infinity, y: 0 }, 'abc', 5, { x: 1 }]) {
    const r = slideMove({ ...base, requested: req });
    assert.deepEqual(r.to, base.from); assert.equal(r.stayed, true); assert.equal(r.reason, 'invalid');
  }
});
await check('slideMove: dentro de un obstáculo ampliado → pierde el movimiento (blocked, terrain)', () => {
  const obstacles = [{ x: 0.8, y: -1, w: 2, h: 2 }];
  const T = { x: 1.5, y: 0.2 };
  const r = slideMove({ ...base, obstacles, requested: T });
  assert.deepEqual(r.to, base.from); assert.equal(r.stayed, true); assert.equal(r.reason, 'blocked'); assert.equal(r.why, 'terrain');
});
await check('slideMove: borde del plano → se respeta BODY', () => {
  const from = { x: 24, y: 14 };
  const r = slideMove({ ...base, from, soldiers: [{ ...me, x: 24, y: 14 }], requested: { x: 25.5, y: 15.5 } });
  assert.ok(r.to.x <= PLANE.xMax - BODY + 1e-9 && r.to.y <= PLANE.yMax - BODY + 1e-9);
  assert.ok(isValid(r.to, from, [{ ...me, x: 24, y: 14 }], 's1', []));
});
await check('slideMove: otro soldado vivo a 0.9 u del destino → pierde el movimiento (blocked, soldier); muerto no bloquea', () => {
  const other = { id: 's2', team: 'right', x: 1.5, y: 0.9, alive: true };
  const T = { x: 1.5, y: 0 };
  const r = slideMove({ ...base, soldiers: [me, other], requested: T });
  assert.deepEqual(r.to, base.from); assert.equal(r.reason, 'blocked'); assert.equal(r.why, 'soldier');
  const r2 = slideMove({ ...base, soldiers: [me, { ...other, alive: false }], requested: T });
  assert.ok(near(r2.to.x, 1.5) && near(r2.to.y, 0)); assert.equal(r2.reason, 'ok');
});
await check('slideMove: no atraviesa un muro fino de un salto', () => {
  const obstacles = [{ x: 0.9, y: -5, w: 0.1, h: 10 }];
  const r = slideMove({ ...base, obstacles, requested: { x: 1.8, y: 0 } });
  assert.ok(r.to.x < 0.9 - BODY + 1e-9, `se queda a este lado (x=${r.to.x.toFixed(3)})`);
  assert.ok(isValid(r.to, base.from, base.soldiers, 's1', obstacles));
});
await check('slideMove: rodeado → se queda (reason "blocked") y determinista', () => {
  const obstacles = [{ x: -3, y: -3, w: 6, h: 6 }]; // el soldado está dentro: nada alrededor es válido
  const r = slideMove({ ...base, obstacles, requested: { x: 1, y: 1 } });
  assert.deepEqual(r.to, base.from); assert.equal(r.stayed, true); assert.equal(r.reason, 'blocked');
  const obs2 = [{ x: 0.8, y: -1, w: 2, h: 2 }];
  const a = slideMove({ ...base, obstacles: obs2, requested: { x: 1.5, y: 0.2 } });
  const b = slideMove({ ...base, obstacles: obs2, requested: { x: 1.5, y: 0.2 } });
  assert.deepEqual(a, b);
});

// ---------- lib: rng en las utilidades, moveOptions, esquiva de heurísticos ----------
await check('lib: randomTemplates/directShots/pickWeighted/addMissNoise/avoidRepeats aceptan rng y son deterministas', () => {
  const ctx = lib.contextFor([me, { id: 'e', team: 'right', x: 10, y: 3, alive: true }], [], me);
  const t1 = lib.randomTemplates(10, makeRng(5)), t2 = lib.randomTemplates(10, makeRng(5));
  assert.deepEqual(t1, t2);
  assert.notDeepEqual(t1, lib.randomTemplates(10, makeRng(6)));
  const d1 = lib.directShots(ctx, { jitter: 0.1, count: 4, rng: makeRng(1) }), d2 = lib.directShots(ctx, { jitter: 0.1, count: 4, rng: makeRng(1) });
  assert.deepEqual(d1, d2);
  const ranked = [{ cand: { expr: 'a' } }, { cand: { expr: 'b' } }, { cand: { expr: 'c' } }];
  assert.deepEqual(lib.pickWeighted(ranked, [0.5, 0.3, 0.2], 0.5, makeRng(9)), lib.pickWeighted(ranked, [0.5, 0.3, 0.2], 0.5, makeRng(9)));
  const shot = { mode: 'function', expr: '0.5*x' };
  assert.deepEqual(lib.addMissNoise(shot, 0.1, makeRng(3)), lib.addMissNoise(shot, 0.1, makeRng(3)));
  assert.notDeepEqual(lib.addMissNoise(shot, 0.1, makeRng(3)), lib.addMissNoise(shot, 0.1, makeRng(4)));
  const cands = Array.from({ length: 3 }, (_, i) => ({ mode: 'function', expr: `${i}*x` }));
  const hist = cands.map((c) => c.expr);
  assert.deepEqual(lib.avoidRepeats(cands, hist, makeRng(2)), lib.avoidRepeats(cands, hist, makeRng(2)));
  assert.ok(Number.isFinite(lib.gauss(makeRng(1))));
});
await check('lib.moveOptions: 9 destinos en orden (quedarse, 0°, 45° … 315°) a 1,5 u, con impossible/why y cover/distEnemy/los', () => {
  const enemy = { id: 'e', team: 'right', x: 10, y: 0, alive: true };
  const ctx = lib.contextFor([me, enemy], [], me);
  const opts = lib.moveOptions(ctx);
  assert.equal(opts.length, 9);
  assert.equal(opts[0].stay, true); assert.ok(near(opts[0].to.x, 0) && near(opts[0].to.y, 0));
  for (let k = 1; k < 9; k++) {
    const th = (k - 1) * Math.PI / 4;
    assert.equal(opts[k].i, k); assert.equal(opts[k].stay, false);
    assert.ok(near(opts[k].to.x, 1.5 * Math.cos(th)) && near(opts[k].to.y, 1.5 * Math.sin(th)), `dirección ${k}`);
    assert.equal(opts[k].impossible, false);
    assert.equal(opts[k].cover, 1, 'campo abierto: el enemigo ve todos los destinos');
    assert.equal(opts[k].los, true);
    assert.ok(near(opts[k].distEnemy, dist(opts[k].to, enemy)));
  }
  // con un muro entre medias, cover baja a 0 en los destinos tapados
  const wall = [{ x: 4, y: -6, w: 1, h: 12 }];
  const opts2 = lib.moveOptions(lib.contextFor([me, enemy], wall, me));
  assert.ok(opts2.every((o) => o.cover === 0 && o.los === false));
});
const sniperScene = () => {
  const s = { id: 's1', team: 'left', x: -10, y: 0, alive: true };
  const e1 = { id: 'e1', team: 'right', x: 10, y: 0, alive: true }, e2 = { id: 'e2', team: 'right', x: 10, y: 5, alive: true };
  const obstacles = [{ x: -8.5, y: 1, w: 1, h: 3 }];
  return { soldiers: [s, e1, e2], obstacles, soldier: s };
};
const moveOf = (type, scene, seed = 1) => {
  const ctx = lib.contextFor(scene.soldiers, scene.obstacles, scene.soldier);
  const agent = createAgent(type, { level: 3 });
  assert.equal(typeof agent.chooseMove, 'function', `${type} implementa chooseMove`);
  return agent.chooseMove({ soldiers: scene.soldiers, obstacles: scene.obstacles, soldier: scene.soldier, shot: null, moveOptions: lib.moveOptions(ctx), history: [], rng: makeRng(seed), state: null });
};
await check('Sniper: expuesto a dos enemigos, se mueve al destino tapado (a 1,5 u solo lo está el de 90°; el de 45° cae en el muro)', () => {
  const m = moveOf('sniper', sniperScene());
  assert.ok(m && near(m.x, -10, 1e-6) && near(m.y, 1.5, 1e-6), JSON.stringify(m));
});
await check('Sniper: ya tapado, se queda aunque alejarse sea posible', () => {
  const s = { id: 's1', team: 'left', x: -10, y: 0, alive: true }, e = { id: 'e', team: 'right', x: 10, y: 0, alive: true };
  const m = moveOf('sniper', { soldiers: [s, e], obstacles: [{ x: -8, y: -6, w: 1, h: 12 }], soldier: s });
  assert.ok(m === 'stay' || (m && near(m.x, -10) && near(m.y, 0)), JSON.stringify(m));
});
await check('Greedy: campo abierto → el destino con línea de tiro más cercano al enemigo (0°)', () => {
  const s = { id: 's1', team: 'left', x: -10, y: 0, alive: true }, e = { id: 'e', team: 'right', x: 10, y: 0, alive: true };
  const m = moveOf('greedy', { soldiers: [s, e], obstacles: [], soldier: s });
  assert.ok(m && near(m.x, -8.5) && near(m.y, 0), JSON.stringify(m));
});
await check('Artillery: campo abierto → el destino más lejano del enemigo (180°)', () => {
  const s = { id: 's1', team: 'left', x: -10, y: 0, alive: true }, e = { id: 'e', team: 'right', x: 10, y: 0, alive: true };
  const m = moveOf('artillery', { soldiers: [s, e], obstacles: [], soldier: s });
  assert.ok(m && near(m.x, -11.5) && near(m.y, 0), JSON.stringify(m));
});
await check('Chaos: uno de los 9 destinos, determinista por semilla y variable entre semillas', () => {
  const scene = sniperScene();
  const opts = lib.moveOptions(lib.contextFor(scene.soldiers, scene.obstacles, scene.soldier));
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const a = moveOf('chaos', scene, seed), b = moveOf('chaos', scene, seed);
    assert.deepEqual(a, b);
    const idx = opts.findIndex((o) => a === 'stay' ? o.stay : (near(o.to.x, a.x) && near(o.to.y, a.y)));
    assert.ok(idx >= 0, 'es uno de los 9');
    seen.add(idx);
  }
  assert.ok(seen.size >= 2);
});
await check('sin enemigos vivos, los cuatro heurísticos se quedan', () => {
  const s = { id: 's1', team: 'left', x: -10, y: 0, alive: true }, e = { id: 'e', team: 'right', x: 10, y: 0, alive: false };
  for (const t of ['sniper', 'greedy', 'artillery', 'chaos']) {
    const m = moveOf(t, { soldiers: [s, e], obstacles: [], soldier: s });
    assert.ok(m === 'stay' || m == null || (near(m.x, -10) && near(m.y, 0)), `${t}: ${JSON.stringify(m)}`);
  }
});
await check('chooseShot con rng: misma escena y semilla → mismo disparo (4 heurísticos)', () => {
  const scene = sniperScene();
  for (const t of ['sniper', 'greedy', 'artillery', 'chaos']) {
    const go = (seed) => createAgent(t, { level: 3, temperature: 0.5 }).chooseShot({ soldiers: scene.soldiers, obstacles: scene.obstacles, soldier: scene.soldier, history: [], chat: [], temperature: 0.5, rng: makeRng(seed), moveOptions: [] });
    const a = go(7), b = go(7);
    assert.equal(a.expr, b.expr, t); assert.equal(a.mode, b.mode); assert.equal(a.angle, b.angle);
  }
});

// ---------- solver: ángulo de artillería (spec/01 §7b) ----------
await check('ode2: el ángulo positivo sube en los dos lados y la trayectoria es simétrica', () => {
  const f = () => 0;
  const L = simulateShot({ mode: 'ode2', f, start: { x: -10, y: 0 }, dir: 1, angle: 30 * Math.PI / 180 });
  const Rr = simulateShot({ mode: 'ode2', f, start: { x: 10, y: 0 }, dir: -1, angle: 30 * Math.PI / 180 });
  const lastL = L.points[L.points.length - 1], lastR = Rr.points[Rr.points.length - 1];
  assert.ok(lastL[1] > 3 && lastR[1] > 3, `suben: ${lastL[1].toFixed(2)} / ${lastR[1].toFixed(2)}`);
  assert.equal(L.points.length, Rr.points.length);
  for (let i = 0; i < L.points.length; i++) {
    assert.ok(near(L.points[i][0], -Rr.points[i][0], 1e-6) && near(L.points[i][1], Rr.points[i][1], 1e-6), `punto ${i}`);
  }
  assert.equal(L.result.type, Rr.result.type);
});

// ---------- Room sin pantalla y semilla ----------
const headless = (seed, soldiers = 2, left = 'sniper', right = 'greedy') => {
  const room = new Room('h', { soldiersPerPlayer: soldiers, seed, headless: true });
  room.addAgent(left, { level: 3, team: 'left' });
  room.addAgent(right, { level: 3, team: 'right' });
  return room;
};
const trace = (room, maxTurns = 400) => {
  const out = [];
  room.start();
  for (let i = 0; i < maxTurns && room.phase === 'playing'; i++) {
    room.step();
    out.push({ shot: room.lastShot && room.lastShot.result.type, expr: room.lastShot && room.lastShot.expr, move: room.lastMove && [room.lastMove.to.x, room.lastMove.to.y], pos: room.soldiers.map((s) => [s.x, s.y, s.alive]) });
  }
  return { out, winner: room.winner, phase: room.phase };
};
await check('Room sin pantalla: rechaza humanos, no crea temporizadores y la partida termina con step()/play()', () => {
  const room = headless(11);
  assert.ok(room.addPlayer('yo', 'left').error, 'humanos fuera');
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const t = trace(room);
  assert.equal(t.phase, 'over'); assert.ok(t.out.length >= 2);
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.equal(after, before, 'sin temporizadores nuevos');
  const room2 = headless(12, 3);
  room2.start();
  const result = room2.play({ maxTurns: 400 });
  assert.equal(room2.phase, 'over'); assert.ok(result && typeof result.shots === 'number' && result.shots > 0);
});
await check('misma semilla → misma partida (resultados, expresiones, movimientos, posiciones, ganador); distinta → difiere', () => {
  const a = trace(headless(777)), b = trace(headless(777));
  assert.deepEqual(a, b);
  const c = trace(headless(778));
  assert.notDeepEqual(a.out.map((x) => x.pos), c.out.map((x) => x.pos));
});
await check('1..4 soldados por bando terminan; los soldados solo cambian de sitio por move o por mapa renovado', () => {
  for (const n of [1, 2, 3, 4]) {
    const room = headless(100 + n, n, 'greedy', 'artillery');
    room.start();
    assert.equal(room.soldiers.length, 2 * n);
    let prev = room.soldiers.map((s) => ({ x: s.x, y: s.y })), remaps = room.remaps;
    for (let i = 0; i < 400 && room.phase === 'playing'; i++) {
      room.step();
      if (room.remaps !== remaps) { remaps = room.remaps; prev = room.soldiers.map((s) => ({ x: s.x, y: s.y })); continue; }
      const mv = room.lastMove;
      room.soldiers.forEach((s, k) => {
        if (mv && s.id === mv.soldierId) { assert.ok(near(s.x, mv.to.x) && near(s.y, mv.to.y), 'el que se mueve acaba en lastMove.to'); }
        else assert.ok(near(s.x, prev[k].x) && near(s.y, prev[k].y), 'los demás no se mueven');
      });
      if (mv) assert.ok(dist(mv.from, mv.to) <= C.MOVE_RADIUS + 1e-9, 'nunca más de 2 u');
      prev = room.soldiers.map((s) => ({ x: s.x, y: s.y }));
    }
    assert.equal(room.phase, 'over', `${n} soldados`);
  }
});
await check('fire con move en el cuerpo: aplica el movimiento (validado) y registra lastMove; el turno avanza', () => {
  const room = headless(5);
  room.start();
  const pid = room.turn.playerId, soldier = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const from = { x: soldier.x, y: soldier.y };
  const r = room.fire(pid, { mode: 'function', expr: '0.1*x', move: { x: soldier.x + 1, y: soldier.y + 0.5 } });
  assert.ok(r.ok, r.error);
  assert.ok(r.move && r.move.soldierId === soldier.id);
  assert.deepEqual(room.lastMove.from, from);
  assert.ok(dist(room.lastMove.to, from) <= C.MOVE_RADIUS + 1e-9);
  assert.ok(near(soldier.x, room.lastMove.to.x) && near(soldier.y, room.lastMove.to.y));
  assert.ok(isValid(room.lastMove.to, from, room.soldiers, soldier.id, room.obstacles, room.bites));
  assert.ok(room.turn && room.turn.playerId !== pid, 'turno del otro jugador');
  const r2 = room.fire(room.turn.playerId, { mode: 'function', expr: '0.1*x', move: 'stay' });
  assert.ok(r2.ok && room.lastMove.stayed === true && room.lastMove.requested === null);
});
await check('snapshot: config.seed, moveRadius, moveTime, body, minSeparation; lastMove', () => {
  const room = headless(9);
  const st = room.snapshot();
  assert.equal(st.config.seed, 9); assert.equal(st.config.moveRadius, 2); assert.equal(st.config.moveTime, 400);
  assert.equal(st.config.body, 0.5); assert.equal(st.config.minSeparation, 1);
  assert.equal(st.lastMove, null);
  const auto = new Room('x', { headless: true });
  assert.ok(Number.isInteger(auto.snapshot().config.seed), 'sin semilla: se sortea y se expone');
});
await check('rematch deriva una semilla nueva del rng y sigue siendo reproducible', () => {
  const a = headless(31), b = headless(31);
  trace(a); trace(b);
  a.rematch(); b.rematch();
  assert.equal(a.seed, b.seed); assert.notEqual(a.seed, 31);
  const ta = [], tb = [];
  for (let i = 0; i < 400 && a.phase === 'playing'; i++) { a.step(); ta.push(a.lastShot.result.type); }
  for (let i = 0; i < 400 && b.phase === 'playing'; i++) { b.step(); tb.push(b.lastShot.result.type); }
  assert.deepEqual(ta, tb);
});
await check('headless.playGame: devuelve seed, result, events[], trajectories, chat; determinista', () => {
  const g1 = playGame({ seed: 55, left: { type: 'sniper' }, right: { type: 'chaos' }, soldiers: 2 });
  const g2 = playGame({ seed: 55, left: { type: 'sniper' }, right: { type: 'chaos' }, soldiers: 2 });
  assert.equal(g1.seed, 55); assert.ok(g1.result && typeof g1.result.shots === 'number');
  assert.ok(Array.isArray(g1.events) && Array.isArray(g1.chat) && typeof g1.trajectories === 'object');
  assert.deepEqual(g1.result, g2.result); assert.deepEqual(g1.chat.map((c) => c.text), g2.chat.map((c) => c.text));
});

// ---------- Room viva (FAST): etapa move, ventana y vencimiento ----------
await check('Room viva: fire sin move → stage "move" con deadline y radius; move de otro → error; move válido; vencimiento → quieto', async () => {
  const room = new Room('viva', { soldiersPerPlayer: 1, seed: 1 }); // seed 1: empieza el humano
  const j = room.addPlayer('humano', 'left');
  room.addAgent('chaos', { level: 1, team: 'right' });
  room.start(j.player.id);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && room.phase === 'playing' && !(room.turn && room.turn.playerId === j.player.id && room.turn.stage === 'shoot')) await sleep(50);
  assert.ok(room.turn && room.turn.playerId === j.player.id, 'llega mi turno');
  assert.equal(room.turn.stage, 'shoot');
  const soldier = room.soldiers.find((s) => s.id === room.turn.soldierId);
  assert.ok(room.move(j.player.id, { x: soldier.x + 1, y: soldier.y }).error, 'aún no toca moverse');
  const r = room.fire(j.player.id, { mode: 'function', expr: '0.1*x' });
  assert.ok(r.ok, r.error); assert.equal(r.move, undefined);
  assert.ok(room.turn && room.turn.stage === 'move' && room.turn.playerId === j.player.id);
  assert.ok(room.turn.deadline > Date.now() && room.turn.radius === 2);
  assert.ok(room.fire(j.player.id, { mode: 'function', expr: '0.1*x' }).error, 'no se dispara dos veces');
  const bot = room.players.find((p) => p.isBot);
  assert.ok(room.move(bot.id, { x: soldier.x + 1, y: soldier.y }).error, 'el otro no puede moverme');
  const m = room.move(j.player.id, { x: soldier.x + 1, y: soldier.y });
  assert.ok(m.ok && m.move && m.move.soldierId === soldier.id, JSON.stringify(m));
  assert.ok(near(soldier.x, m.move.to.x) && near(soldier.y, m.move.to.y));
  assert.equal(room.turn, null, 'tras moverse, el turno se cierra');
  // segunda vuelta: dejo vencer la ventana
  const t1 = Date.now();
  while (Date.now() - t1 < 15000 && room.phase === 'playing' && !(room.turn && room.turn.playerId === j.player.id && room.turn.stage === 'shoot')) await sleep(50);
  if (room.phase === 'playing') {
    room.fire(j.player.id, { mode: 'function', expr: '-0.1*x' });
    const deadline = room.turn.deadline;
    while (Date.now() < deadline + 600) await sleep(50);
    assert.ok(room.lastMove && room.lastMove.stayed === true && room.lastMove.requested === null, JSON.stringify(room.lastMove));
    assert.ok(!room.turn || room.turn.playerId !== j.player.id || room.turn.stage === 'shoot');
  }
  room.gameOver(true);
});
await check('Room viva: los bots se mueven solos tras disparar (chooseMove) sin ventana', async () => {
  const room = new Room('bots', { soldiersPerPlayer: 2, seed: 4 });
  room.addAgent('sniper', { level: 3, team: 'left' });
  room.addAgent('artillery', { level: 3, team: 'right' });
  room.start();
  const t0 = Date.now();
  const seen = new Set();
  while (Date.now() - t0 < 12000 && seen.size < 3) {
    if (room.turn && room.turn.stage === 'move') throw new Error('un bot nunca abre ventana de movimiento');
    if (room.lastMove) seen.add(room.lastMove.ts + ':' + room.lastMove.soldierId);
    await sleep(40);
  }
  assert.ok(seen.size >= 3, `hubo movimientos de bots (${seen.size})`);
  room.gameOver(true);
});

// ---------- API ----------
if (BASE) {
  const api = async (p, m = 'GET', b = null) => {
    const res = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return res.json();
  };
  await check('API: POST /rooms acepta seed y la devuelve; fire.move; POST /move; state.turn.stage/radius; lastMove', async () => {
    const room = await api('/api/rooms', 'POST', { name: 'api-move', soldiers: 1, seed: 1 }); // seed 1: empieza el humano
    assert.equal(room.seed, 1);
    const j = await api(`/api/rooms/${room.code}/join`, 'POST', { name: 'yo', team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'chaos', level: 1, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', { playerId: j.player.id });
    let st = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) { st = await api(`/api/rooms/${room.code}/state`); if (st.phase !== 'playing' || (st.turn && st.turn.playerId === j.player.id && st.turn.stage === 'shoot')) break; await sleep(100); }
    assert.ok(st.turn && st.turn.playerId === j.player.id, 'mi turno');
    assert.equal(st.config.seed, 1); assert.equal(st.config.moveRadius, 2);
    const bad = await api(`/api/rooms/${room.code}/move`, 'POST', { playerId: j.player.id, x: 0, y: 0 });
    assert.ok(bad.error, 'antes de disparar no se puede mover');
    const f = await api(`/api/rooms/${room.code}/fire`, 'POST', { playerId: j.player.id, mode: 'function', expr: '0.2*x' });
    assert.ok(f.ok, f.error);
    st = await api(`/api/rooms/${room.code}/state`);
    assert.equal(st.turn.stage, 'move'); assert.equal(st.turn.radius, 2); assert.ok(st.turn.deadline > Date.now());
    const soldier = st.soldiers.find((s) => s.ownerId === j.player.id);
    const mv = await api(`/api/rooms/${room.code}/move`, 'POST', { playerId: j.player.id, x: soldier.x - 1, y: soldier.y });
    assert.ok(mv.ok && mv.move && mv.move.soldierId === soldier.id, JSON.stringify(mv));
    st = await api(`/api/rooms/${room.code}/state`);
    assert.ok(st.lastMove && st.lastMove.soldierId === soldier.id && near(st.lastMove.to.x, mv.move.to.x));
    // siguiente turno: move dentro de fire con "stay"
    const t1 = Date.now();
    while (Date.now() - t1 < 15000) { st = await api(`/api/rooms/${room.code}/state`); if (st.phase !== 'playing' || (st.turn && st.turn.playerId === j.player.id && st.turn.stage === 'shoot')) break; await sleep(100); }
    if (st.phase === 'playing') {
      const f2 = await api(`/api/rooms/${room.code}/fire`, 'POST', { playerId: j.player.id, mode: 'function', expr: '-0.2*x', move: 'stay' });
      assert.ok(f2.ok && f2.move && f2.move.stayed === true, JSON.stringify(f2));
      st = await api(`/api/rooms/${room.code}/state`);
      assert.ok(!st.turn || st.turn.stage !== 'move', 'con move en el cuerpo no hay ventana');
    }
  });
} else console.log('(API: sin BASE, se omite)');

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (motor F1)');
process.exit(fails ? 1 : 0);
