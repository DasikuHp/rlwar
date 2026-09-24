// Moverse solo donde se puede (spec/10-moverse.md, P1b, 2026-09-24): pedir un sitio imposible = pierde el movimiento y,
// si es una red, castigo "Movimiento imposible" (−0,3 por defecto). Imposible = cualquiera de las 5 reglas de spec/01 §3
// (también más de 2 u); sin deslizar. Los 9 destinos a 1,5 u con la marca "imposible"; la red pide lo suyo tal cual; los
// heurísticos solo eligen destinos posibles. Escrito ANTES del código y congelado. En proceso, sin servidor.
// Uso: node test/moverse.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-moverse-'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const G = await import('../shared/geometry.js');
const P = await import('../shared/percept.js');
const pol = await import('../shared/policy.js');
const lib = await import('../agents/lib.js');
const R = await import('../shared/reward.js');
const { createAgent } = await import('../agents/registry.js');
const { Room } = await import('../server/rooms.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize, validate, DEFAULT_REWARD, REWARD_TERMS } = await import('../shared/genome.js');
const { catalog } = await import('../evo/api.js');

const PL = C.PLANE, BODY = C.BODY;
const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const clone = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const S = (id, team, x, y, alive = true) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive, turns: 1, lastExpr: '' });
const stateOf = (soldiers, obstacles = [], bites = []) => ({
  code: 'T', phase: 'playing', soldiers, obstacles, bites,
  players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }],
  shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: PL },
});
// oráculo propio: la primera de las 5 reglas que falla (o null)
const whyOf = (P0, from, soldiers, selfId, obstacles, bites = []) => {
  if (Math.hypot(P0.x - from.x, P0.y - from.y) > C.MOVE_RADIUS + 1e-9) return 'far';
  if (P0.x < PL.xMin + BODY || P0.x > PL.xMax - BODY || P0.y < PL.yMin + BODY || P0.y > PL.yMax - BODY) return 'edge';
  const T = { obstacles, bites };
  if (G.isSolid(P0, T, BODY)) return 'terrain';
  for (const s of soldiers) if (s.id !== selfId && s.alive && Math.hypot(P0.x - s.x, P0.y - s.y) < C.MIN_SEPARATION) return 'soldier';
  for (let k = 1; k <= 10; k++) { const t = k / 10; if (G.isSolid({ x: from.x + (P0.x - from.x) * t, y: from.y + (P0.y - from.y) * t }, T, BODY)) return 'wall'; }
  return null;
};
const move = (from, requested, extra = {}) => G.slideMove({ from, requested, soldiers: [], obstacles: [], bites: [], selfId: 'me', ...extra });
const stayed = (from, reason, why = null) => ({ to: { x: from.x, y: from.y }, stayed: true, reason, why });

// ---------- §1 slideMove ----------
await check('constantes: los destinos a 1,5 u; el tope sigue en 2 u; sin la rejilla del deslizamiento', () => {
  assert.equal(C.MOVE_OPTION_RADIUS, 1.5); assert.equal(C.MOVE_RADIUS, 2); assert.equal(C.MOVE_DIRS, 8);
  assert.equal(C.SLIDE_R_STEP, undefined); assert.equal(C.SLIDE_DEG_STEP, undefined);
});

await check('slideMove: un sitio posible → allí, tal cual (reason "ok"); a 2 u justas también; sin campo `slid`', () => {
  const from = { x: -10, y: 0 };
  assert.deepEqual(move(from, { x: -8.7, y: 0.4 }), { to: { x: -8.7, y: 0.4 }, stayed: false, reason: 'ok', why: null });
  assert.deepEqual(move(from, { x: -8, y: 0 }), { to: { x: -8, y: 0 }, stayed: false, reason: 'ok', why: null });
  const req = { x: -9, y: 1 }, r = move(from, req);
  assert.ok(r.to !== req && r.to !== from, 'to es una copia');
  assert.ok(!('slid' in r));
});

await check('slideMove: "stay", null y undefined → quieto (reason "stay"); lo que no es un punto → quieto (reason "invalid"); nunca lanza', () => {
  const from = { x: -10, y: 0 };
  for (const q of ['stay', null, undefined]) assert.deepEqual(move(from, q), stayed(from, 'stay'), String(q));
  for (const q of [{ x: NaN, y: 0 }, { x: '1', y: 0 }, { x: Infinity, y: 0 }, 'abc', 5, { x: 1 }, [], true]) assert.deepEqual(move(from, q), stayed(from, 'invalid'), JSON.stringify(q));
  assert.ok(move(from, 'stay').to !== from);
});

await check('slideMove: imposible → se queda con reason "blocked" y el motivo (far, edge, terrain, soldier, wall); sin recortar ni deslizar', () => {
  const from = { x: -10, y: 0 };
  assert.deepEqual(move(from, { x: -7, y: 0 }), stayed(from, 'blocked', 'far'), 'a 3 u: antes se recortaba a (−8, 0)');
  assert.deepEqual(move(from, { x: -8, y: 0.001 }), stayed(from, 'blocked', 'far'), 'un pelo más de 2 u');
  const edge = { x: -24.5, y: 3 };
  assert.deepEqual(move(edge, { x: -26, y: 3 }), stayed(edge, 'blocked', 'edge'), 'el caso del mutante 68: antes se deslizaba 0,05 u');
  assert.deepEqual(move({ x: -23, y: 3 }, { x: -24.5, y: 3 }), { to: { x: -24.5, y: 3 }, stayed: false, reason: 'ok', why: null }, 'justo en el margen, vale');
  const obstacles = [circle(-8, 0, 1)];
  assert.deepEqual(move(from, { x: -8, y: 0 }, { obstacles }), stayed(from, 'blocked', 'terrain'));
  assert.deepEqual(move(from, { x: -6.5, y: 0 }, { obstacles }), stayed(from, 'blocked', 'far'), 'la primera que falla');
  assert.equal(whyOf({ x: -8.6, y: 1.4 }, from, [], 'me', obstacles), 'wall', 'premisa: libre y a menos de 2 u, pero el camino cruza');
  assert.deepEqual(move(from, { x: -8.6, y: 1.4 }, { obstacles }), stayed(from, 'blocked', 'wall'));
  const bites = [-8.75, -8.3, -8].map((x) => ({ x, y: 0, r: C.BITE_RADIUS }));
  assert.deepEqual(move(from, { x: -8, y: 0 }, { obstacles: [circle(-8, 0, 0.3)], bites }).reason, 'ok', 'los bocados abren el sitio');
  const other = S('o', 'right', -8, 0.5);
  assert.deepEqual(move(from, { x: -8, y: 0 }, { soldiers: [S('me', 'left', -10, 0), other] }), stayed(from, 'blocked', 'soldier'));
  assert.equal(move(from, { x: -8, y: 0 }, { soldiers: [S('me', 'left', -10, 0), { ...other, alive: false }] }).reason, 'ok', 'un caído no estorba');
  assert.equal(move(from, { x: -8, y: 0 }, { soldiers: [S('me', 'left', -10, 0), { ...other, y: 1 }] }).reason, 'ok', 'a 1 u justa, vale');
});

await check('slideMove: el motivo es la primera regla que falla, en orden (far, edge, terrain, soldier, wall)', () => {
  const from = { x: -23.8, y: 0 };
  assert.equal(move(from, { x: -26, y: 0 }, { obstacles: [circle(-26, 0, 1)] }).why, 'far', 'lejos y dentro de terreno');
  assert.equal(move(from, { x: -25, y: 0 }, { obstacles: [circle(-25, 0, 1)] }).why, 'edge', 'fuera y dentro de terreno');
  const f2 = { x: -10, y: 0 };
  assert.equal(move(f2, { x: -8.5, y: 0 }, { obstacles: [circle(-8.5, 0, 0.5)], soldiers: [S('me', 'left', -10, 0), S('o', 'right', -8.5, 0.5)] }).why, 'terrain', 'terreno y soldado');
  assert.equal(move(f2, { x: -8.6, y: 1.4 }, { obstacles: [circle(-8, 0, 1)], soldiers: [S('me', 'left', -10, 0), S('o', 'right', -8.6, 2)] }).why, 'soldier', 'soldado y muro');
});

await check('slideMove: 150 escenas al azar = el oráculo de las 5 reglas (sitio tal cual, o quieto con la primera que falla)', () => {
  let ok = 0, blocked = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rng = makeRng(seed);
    const from = { x: PL.xMin + 1 + rng() * 48, y: PL.yMin + 1 + rng() * 28 };
    const obstacles = Array.from({ length: rng.int(5) }, () => (rng() < 0.5 ? circle(from.x - 4 + rng() * 8, from.y - 4 + rng() * 8, 0.3 + rng() * 2.5) : { x: from.x - 4 + rng() * 8, y: from.y - 4 + rng() * 8, w: 0.3 + rng() * 4, h: 0.3 + rng() * 4 }));
    const bites = Array.from({ length: rng.int(4) }, () => ({ x: from.x - 3 + rng() * 6, y: from.y - 3 + rng() * 6, r: C.BITE_RADIUS }));
    const soldiers = [S('me', 'left', from.x, from.y)];
    for (let i = 0; i < rng.int(4); i++) soldiers.push(S('s' + i, rng() < 0.5 ? 'left' : 'right', from.x - 3 + rng() * 6, from.y - 3 + rng() * 6, rng() < 0.7));
    const req = { x: from.x - 3 + rng() * 6, y: from.y - 3 + rng() * 6 };
    const why = whyOf(req, from, soldiers, 'me', obstacles, bites);
    const r = G.slideMove({ from, requested: req, soldiers, obstacles, bites, selfId: 'me' });
    assert.deepEqual(r, why ? stayed(from, 'blocked', why) : { to: { x: req.x, y: req.y }, stayed: false, reason: 'ok', why: null }, `semilla ${seed}`);
    if (why) blocked++; else ok++;
  }
  assert.ok(ok > 20 && blocked > 20, `premisa: hay de los dos (${ok} posibles, ${blocked} imposibles)`);
});

// ---------- §2 la sala ----------
// sala sin pantalla con el primer turno de la izquierda; el tirador en `at`; los demás lejos de la recta y = at.y
const roomAt = (at, { obstacles = [], place = null } = {}) => {
  for (let seed = 1; seed < 400; seed++) {
    const r = new Room('moverse', { soldiersPerPlayer: 2, seed, headless: true });
    r.addAgent('chaos', { level: 1, team: 'left' }); r.addAgent('chaos', { level: 1, team: 'right' });
    r.start();
    const me = r.soldiers.find((s) => s.id === r.turn.soldierId);
    if (me.team !== 'left') { r.phase = 'over'; continue; }
    r.obstacles = obstacles; r.bites = [];
    Object.assign(me, at);
    let k = 0;
    for (const s of r.soldiers) if (s !== me) Object.assign(s, (place && place(s)) || { x: s.team === 'left' ? -20 : 20, y: at.y + (k++ % 2 ? 9 : -9) });
    return { room: r, me, name: r.players.find((p) => p.id === r.turn.playerId).name };
  }
  throw new Error('premisa: ninguna semilla da el primer turno a la izquierda');
};
const lastMoveEvent = (room) => [...room.events].reverse().find((e) => e.type === 'move');

await check('sala: un sitio imposible → el soldado no se mueve; lastMove, evento `move` y registro lo cuentan con su motivo en palabras', () => {
  const cases = [
    { at: { x: -10, y: 0 }, req: { x: -13, y: 0 }, why: 'far', text: 'a más de 2 u' },
    { at: { x: -23.8, y: 0 }, req: { x: -25, y: 0 }, why: 'edge', text: 'fuera del mapa' },
    { at: { x: -10, y: 0 }, req: { x: -12, y: 0 }, obstacles: [circle(-12, 0, 1)], why: 'terrain', text: 'dentro de terreno' },
    { at: { x: -10, y: 0 }, req: { x: -10, y: 1 }, why: 'soldier', text: 'pegado a otro soldado', mate: { x: -10, y: 1.5 } },
    { at: { x: -10, y: 0 }, req: { x: -12, y: 0 }, obstacles: [circle(-11, 0, 0.3)], why: 'wall', text: 'al otro lado de un muro' },
  ];
  for (const c of cases) {
    let first = true;
    const { room, me, name } = roomAt(c.at, { obstacles: c.obstacles || [], place: c.mate ? (s) => (s.team === 'left' && first ? (first = false, c.mate) : null) : null });
    const n = room.chat.length;
    const r = room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: c.req });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual([me.x, me.y], [c.at.x, c.at.y], `${c.why}: no se mueve`);
    const { ts, ...lm } = room.lastMove;
    assert.deepEqual(lm, { playerId: lm.playerId, soldierId: me.id, from: c.at, to: c.at, requested: c.req, stayed: true, reason: 'blocked', why: c.why }, c.why);
    const ev = lastMoveEvent(room);
    assert.deepEqual(Object.keys(ev.data).sort(), ['coverAfter', 'coverBefore', 'decisionEventId', 'from', 'reason', 'requested', 'stayed', 'to', 'why']);
    assert.deepEqual([ev.data.reason, ev.data.why, ev.data.stayed], ['blocked', c.why, true]);
    assert.ok(room.chat.slice(n).some((l) => l.text === `🚫 ${name} pidió un sitio imposible (${c.text}) y pierde el movimiento`), `${c.why}: ${JSON.stringify(room.chat.slice(n).map((l) => l.text))}`);
  }
});

await check('sala: un sitio posible → allí (reason "ok", why null); quedarse → requested null, reason "stay"', () => {
  let { room, me, name } = roomAt({ x: -10, y: 0 });
  let n = room.chat.length;
  assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: { x: -9, y: 1.5 } }).ok);
  assert.deepEqual([me.x, me.y], [-9, 1.5]);
  assert.deepEqual([room.lastMove.reason, room.lastMove.why, room.lastMove.stayed, 'slid' in room.lastMove], ['ok', null, false, false]);
  assert.ok(room.chat.slice(n).some((l) => l.text === `🦶 ${name} se mueve a (-9.0, 1.5)`));
  ({ room, me, name } = roomAt({ x: -10, y: 0 }));
  n = room.chat.length;
  assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: 'stay' }).ok);
  assert.deepEqual([room.lastMove.requested, room.lastMove.reason, room.lastMove.why, room.lastMove.stayed], [null, 'stay', null, true]);
  assert.ok(room.chat.slice(n).some((l) => l.text === `🦶 ${name} se queda quieto`));
});

// ---------- §3 los 9 destinos ----------
await check('moveOptions: quedarse y 8 direcciones a 1,5 u, con impossible/why; el pedido tal cual; lo demás, donde acabaría de verdad', () => {
  const me = S('me', 'left', -10, 0), e = S('e', 'right', 10, 0);
  const open = lib.moveOptions(lib.contextFor([me, e], [], me));
  assert.equal(open.length, 9);
  open.forEach((o, i) => {
    assert.deepEqual(Object.keys(o).sort(), ['cover', 'distEnemy', 'i', 'impossible', 'los', 'stay', 'to', 'why']);
    assert.equal(o.i, i); assert.equal(o.stay, i === 0); assert.equal(o.impossible, false); assert.equal(o.why, null);
    const th = (i - 1) * Math.PI / 4;
    if (i) assert.ok(near(o.to.x, -10 + 1.5 * Math.cos(th)) && near(o.to.y, 1.5 * Math.sin(th)), `dirección ${i}`);
  });
  // un círculo tapa la dirección → (a (−8,5, 0)): imposible, `to` el pedido, cobertura y distancias las de quedarse
  const opts = lib.moveOptions(lib.contextFor([me, e], [circle(-8.5, 0, 0.5)], me));
  assert.equal(opts[1].impossible, true); assert.equal(opts[1].why, 'terrain');
  assert.ok(near(opts[1].to.x, -8.5) && near(opts[1].to.y, 0));
  assert.deepEqual([opts[1].cover, opts[1].distEnemy, opts[1].los], [opts[0].cover, opts[0].distEnemy, opts[0].los]);
  assert.equal(opts[0].impossible, false, 'quedarse nunca es imposible');
});

await check('destinos de la red: rasgo 4 = imposible, desplazamiento del pedido (espejo a la derecha), el resto donde acabaría; la etiqueta dice "imposible"', () => {
  const me = S('me', 'left', -10, 0), e = S('e', 'right', 10, 0);
  const d = P.moveDestinations(stateOf([me, e], [circle(-8.5, 0, 0.5)]), me);
  assert.deepEqual(Object.keys(d[1]).sort(), ['cover', 'distEnemy', 'feat', 'i', 'impossible', 'los', 'stay', 'to', 'why']);
  assert.equal(d[1].impossible, true); assert.equal(d[1].why, 'terrain');
  assert.deepEqual([d[1].feat[0], d[1].feat[1], d[1].feat[3]], [0.75, 0, 1]);
  assert.deepEqual(Array.from(d[1].feat).slice(4), Array.from(d[0].feat).slice(4));
  assert.ok(d.filter((x) => x.i !== 1).every((x) => x.feat[3] === 0));
  const r = S('r', 'right', 10, 0);
  const dr = P.moveDestinations(stateOf([r, S('l', 'left', -10, 0)], [circle(8.5, 0, 0.5)]), r);
  assert.equal(dr[1].impossible, true); assert.ok(near(dr[1].to.x, 8.5), 'la dirección 1 de la derecha va hacia −x'); assert.equal(dr[1].feat[0], 0.75);
  assert.equal(P.eyeLayout({ id: 'm', type: 'eye.moves', params: {} })[3].name, 'imposible');
});

await check('destinos: 120 escenas al azar — "imposible" es exactamente lo que la sala rechazaría (lib y red dicen lo mismo)', () => {
  let imp = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const rng = makeRng(1000 + seed);
    const me = S('me', 'left', -20 + rng() * 15, -12 + rng() * 24);
    const soldiers = [me, S('e', 'right', 5 + rng() * 15, -12 + rng() * 24)];
    for (let i = 0; i < rng.int(3); i++) soldiers.push(S('m' + i, rng() < 0.5 ? 'left' : 'right', me.x - 2.5 + rng() * 5, me.y - 2.5 + rng() * 5, rng() < 0.8));
    const obstacles = Array.from({ length: rng.int(4) }, () => circle(me.x - 3 + rng() * 6, me.y - 3 + rng() * 6, 0.3 + rng() * 1.5));
    const bites = rng() < 0.5 ? [{ x: me.x + 1, y: me.y, r: C.BITE_RADIUS }] : [];
    const L = lib.moveOptions(lib.contextFor(soldiers, obstacles, me, bites));
    const D = P.moveDestinations(stateOf(soldiers, obstacles, bites), me);
    for (let i = 1; i < 9; i++) {
      const why = whyOf(L[i].to, me, soldiers, 'me', obstacles, bites);
      assert.ok(near(Math.hypot(L[i].to.x - me.x, L[i].to.y - me.y), 1.5), `semilla ${seed}, ${i}: a 1,5 u`);
      assert.deepEqual([L[i].impossible, L[i].why], [!!why, why], `semilla ${seed}, destino ${i} (lib)`);
      assert.deepEqual([D[i].impossible, D[i].why, D[i].feat[3]], [!!why, why, why ? 1 : 0], `semilla ${seed}, destino ${i} (red)`);
      if (why) imp++;
    }
  }
  assert.ok(imp > 30, `premisa: hay imposibles (${imp})`);
});

// ---------- §4 la red ----------
const withId = (t, id) => normalize({ ...clone(TEMPLATES[t].genome), id, name: id });
// soldado rodeado de 8 compañeros a 1,5 u: todas las direcciones son imposibles (soldier)
const boxed = () => {
  const me = S('me', 'left', -10, 0);
  const ring = Array.from({ length: 8 }, (_, k) => S('a' + k, 'left', -10 + 1.5 * Math.cos(k * Math.PI / 4), 1.5 * Math.sin(k * Math.PI / 4)));
  return stateOf([me, ...ring, S('e', 'right', 10, 5)]);
};

await check('red sin ajuste: pide el destino elegido tal cual, también si es imposible; decision.moves lleva impossible/why', () => {
  const g = withId('sniper', 'mov-sin'), net = compile(g), st = boxed();
  let tried = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = pol.decideMove({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(seed), shot: null });
    const d = r.decision, k = d.chosenMove;
    assert.deepEqual(Object.keys(d.moves[1]).sort(), ['cover', 'distEnemy', 'i', 'impossible', 'los', 'p', 'score', 'stay', 'to', 'why']);
    assert.ok(d.moves.every((m, i) => m.impossible === (i !== 0) && m.why === (i ? 'soldier' : null)));
    if (k === 0) { assert.equal(r.move, 'stay'); continue; }
    assert.deepEqual(r.move, d.moves[k].to, 'el punto pedido, sin cambiar');
    tried++;
  }
  assert.ok(tried > 5, `premisa: elige direcciones (${tried})`);
});

await check('red con ajuste: pide destino + 0,5·ajuste tal cual (sin deslizar); moveAdjust dice qué pasará según slideMove', () => {
  const g = withId('turtle', 'mov-con'), net = compile(g);
  for (const st of [boxed(), stateOf([S('me', 'left', -10, 0), S('e', 'right', 10, 5)], [circle(-8, 0, 1)])]) {
    for (let seed = 1; seed <= 12; seed++) {
      const r = pol.decideMove({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(seed), shot: null });
      const d = r.decision, a = d.moveAdjust, dest = d.moves[d.chosenMove].to;
      const target = { x: dest.x + 0.5 * a.sample[0], y: dest.y + 0.5 * a.sample[1] };
      assert.ok(near(a.target.x, target.x) && near(a.target.y, target.y), `semilla ${seed}: objetivo`);
      assert.deepEqual(r.move, a.target, 'se pide el objetivo tal cual');
      const s = G.slideMove({ from: { x: -10, y: 0 }, requested: a.target, soldiers: st.soldiers, obstacles: st.obstacles, bites: [], selfId: 'me' });
      assert.deepEqual({ to: a.to, reason: a.reason, why: a.why }, { to: s.to, reason: s.reason, why: s.why });
      assert.deepEqual(Object.keys(a).sort(), ['mu', 'reason', 'sample', 'scales', 'target', 'to', 'why']);
    }
  }
});

// ---------- §5 heurísticos ----------
await check('heurísticos: en 120 escenas ninguno pide un sitio imposible y siempre eligen uno de los destinos posibles', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const rng = makeRng(2000 + seed);
    const me = S('me', 'left', -20 + rng() * 15, -12 + rng() * 24);
    const soldiers = [me, S('e', 'right', 5 + rng() * 15, -12 + rng() * 24), S('f', 'right', 5 + rng() * 15, -12 + rng() * 24)];
    for (let i = 0; i < rng.int(4); i++) soldiers.push(S('m' + i, 'left', me.x - 2.5 + rng() * 5, me.y - 2.5 + rng() * 5));
    const obstacles = Array.from({ length: rng.int(5) }, () => circle(me.x - 3 + rng() * 6, me.y - 3 + rng() * 6, 0.3 + rng() * 1.5));
    const opts = lib.moveOptions(lib.contextFor(soldiers, obstacles, me));
    for (const type of ['sniper', 'greedy', 'artillery', 'chaos']) {
      const m = createAgent(type, { level: 3 }).chooseMove({ soldiers, obstacles, bites: [], soldier: me, shot: null, moveOptions: opts, history: [], rng: makeRng(seed), state: null });
      const k = m === 'stay' ? 0 : opts.findIndex((o) => !o.stay && near(o.to.x, m.x) && near(o.to.y, m.y));
      assert.ok(k >= 0 && !opts[k].impossible, `semilla ${seed}, ${type}: ${JSON.stringify(m)}`);
      if (m !== 'stay') assert.equal(G.slideMove({ from: me, requested: m, soldiers, obstacles, bites: [], selfId: 'me' }).reason, 'ok');
    }
  }
});

await check('Chaos: una sola tirada entre los posibles (0 → quedarse, casi 1 → el último posible)', () => {
  const me = S('me', 'left', -10, 0);
  const soldiers = [me, S('e', 'right', 10, 0), S('a', 'left', -8.5, 0), S('b', 'left', -10, -1.5)]; // tapan → y ↓
  const opts = lib.moveOptions(lib.contextFor(soldiers, [], me));
  const possible = opts.filter((o) => !o.impossible);
  assert.equal(possible.length, 7, 'premisa: dos imposibles');
  const pick = (u) => { let calls = 0; const rng = () => { calls++; return u; }; const m = createAgent('chaos', { level: 1 }).chooseMove({ soldiers, obstacles: [], bites: [], soldier: me, shot: null, moveOptions: opts, history: [], rng, state: null }); return { m, calls }; };
  assert.deepEqual(pick(0), { m: 'stay', calls: 1 });
  const last = possible[possible.length - 1];
  assert.deepEqual(pick(0.9999), { m: { x: last.to.x, y: last.to.y }, calls: 1 });
});

await check('sala: 4 partidas sin pantalla de heurísticos con semilla, ningún movimiento "blocked"', () => {
  let total = 0;
  for (const [seed, a, b] of [[3, 'sniper', 'greedy'], [4, 'artillery', 'chaos'], [5, 'chaos', 'sniper'], [6, 'greedy', 'artillery']]) {
    const r = new Room('heuristicos', { soldiersPerPlayer: 3, seed, headless: true });
    r.addAgent(a, { level: 2, team: 'left' }); r.addAgent(b, { level: 2, team: 'right' });
    r.start(); r.play();
    const moves = r.events.filter((e) => e.type === 'move');
    total += moves.length;
    assert.ok(moves.every((m) => m.data.reason !== 'blocked'), `semilla ${seed}: ${JSON.stringify(moves.filter((m) => m.data.reason === 'blocked').map((m) => m.data))}`);
  }
  assert.ok(total > 8, `premisa: se mueven (${total})`);
});

// ---------- §6 recompensa ----------
await check('recompensa: término "impossibleMove" (−0,3 por defecto, −5..5) en el genoma y en el catálogo', () => {
  assert.equal(DEFAULT_REWARD.impossibleMove, -0.3); assert.ok(REWARD_TERMS.includes('impossibleMove'));
  const g = clone(TEMPLATES.sniper.genome); delete g.reward.impossibleMove;
  assert.equal(normalize({ ...g, id: 'r-1', name: 'r' }).reward.impossibleMove, -0.3, 'las redes de antes lo reciben al cargarse');
  assert.equal(normalize({ ...g, id: 'r-2', name: 'r', reward: { ...g.reward, impossibleMove: -1.2 } }).reward.impossibleMove, -1.2);
  assert.equal(validate(normalize({ ...g, id: 'r-3', name: 'r', reward: { ...g.reward, impossibleMove: 6 } })).ok, false);
  const t = catalog().rewardTerms.find((x) => x.key === 'impossibleMove');
  assert.ok(t, 'en el catálogo');
  assert.deepEqual([t.name, t.default, t.min, t.max], ['Movimiento imposible', -0.3, -5, 5]);
  const fm = catalog().blocks.find((b) => b.type === 'foot.move');
  assert.ok(!/desliz/i.test(JSON.stringify(fm)), 'la explicación del bloque Moverse ya no habla de deslizar');
});

await check('recompensa: se castiga el movimiento "blocked" (una vez, con el peso de la red) y nada más', () => {
  const ev = (id, type, actor, data = {}) => ({ id, t: id, game: 'g', turn: 0, type, actor, data });
  const A = { playerId: 'p1', netId: 'n', soldierId: 's1' };
  const step = (turn, eventId) => ({ turn, phase: 'move', obs: null, decision: { eventId, phase: 'move', soldierId: 's1', chosen: 0, chosenMove: 1, logp: {} } });
  const reasons = ['blocked', 'ok', 'stay', 'timeout', 'invalid', 'dead'];
  const events = [ev(1, 'game.start', { playerId: null })];
  reasons.forEach((reason, k) => {
    events.push(ev(2 + 2 * k, 'decision', A, { phase: 'move' }));
    events.push(ev(3 + 2 * k, 'move', A, { reason, why: reason === 'blocked' ? 'terrain' : null, coverBefore: 0, coverAfter: 0, decisionEventId: 2 + 2 * k }));
  });
  const trajectory = { netId: 'n', soldiers: { s1: reasons.map((_, k) => step(k + 1, 2 + 2 * k)) } };
  const terms = (reward) => Object.fromEntries(R.assignRewards({ reward: { ...DEFAULT_REWARD, ...reward, normalize: false }, teamSpirit: 0, events, trajectory, playerId: 'p1' }).entries.map((e) => [e.decision.eventId, e.terms]));
  const t = terms({});
  assert.deepEqual(t[2], { impossibleMove: -0.3 });
  for (let k = 1; k < reasons.length; k++) assert.deepEqual(t[2 + 2 * k], {}, reasons[k]);
  assert.deepEqual(terms({ impossibleMove: -1.2 })[2], { impossibleMove: -1.2 });
});

// ---------- §7 AGENTS.md ----------
await check('AGENTS.md: explica que un sitio imposible hace perder el movimiento (blocked) y los destinos a 1,5 u; ya no dice "se desliza"', () => {
  const doc = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(!/se desliza|deslizados/.test(doc), 'sin deslizar');
  assert.match(doc, /reason: 'blocked'/); assert.match(doc, /1,5 u/); assert.match(doc, /impossible/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (moverse: solo donde se puede, castigo y destinos a 1,5 u)');
process.exit(fails ? 1 : 0);
