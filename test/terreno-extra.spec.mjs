// Terreno (spec/01 §10), casos que destapó la auditoría de P1 (2026-09-24). Escrito ANTES del código y congelado.
// - La cobertura de la sala (enemigos que te ven, recompensa "cubrirse" y examen de cobertura) mira los bocados.
// - El ajuste fino del movimiento de una red y el dibujo de los candidatos (redes sin Simulador) ven los bocados.
// - El Simulador mide la distancia mínima hasta el primer impacto, como antes del tiro que atraviesa (spec/01 §10.5).
// - Los compañeros ven el fuego amigo y las bajas de un tiro que atraviesa (por sus cuentas, no por el tipo).
// - Deslizar con círculos y bocados da el punto de la rejilla completa (oráculo: recorrido entero, sin atajos) y es
//   rápido (tope grueso de tiempo).
// - La capa dibujada del terreno se rehace si cambia cualquier obstáculo o bocado.
// En proceso, sin servidor. Uso: node test/terreno-extra.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const G = await import('../shared/geometry.js');
const P = await import('../shared/percept.js');
const { Room } = await import('../server/rooms.js');
const { genMap } = await import('../server/mapgen.js');
const { decideShot, decideMove } = await import('../shared/policy.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');

const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const clone = (v) => JSON.parse(JSON.stringify(v));
const stateOf = (soldiers, obstacles, bites, extra = {}) => ({
  code: 'T', phase: 'playing', soldiers, obstacles, bites,
  players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }],
  shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE }, ...extra,
});
const soldier = (id, team, x, y) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive: true, turns: 0 });

// ---------- sala: cobertura ----------
await check('sala: "enemigos que te ven" (move.coverBefore/After) mira los bocados', () => {
  const room = new Room('cobertura', { soldiersPerPlayer: 1, seed: 21, headless: true });
  room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' });
  room.start();
  const sh = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const foe = room.soldiers.find((s) => s.team !== sh.team);
  const dir = sh.team === 'left' ? 1 : -1;
  sh.x = -10 * dir; sh.y = 0; foe.x = 10 * dir; foe.y = 0;
  // un círculo de r 0,6 tapa la línea; un bocado de 0,78 en su centro se lo come entero
  room.obstacles = [circle(0, 0, 0.6)]; room.bites = [{ x: 0, y: 0, r: C.BITE_RADIUS }];
  const n0 = room.events.length;
  const r = room.fire(room.turn.playerId, { mode: 'function', expr: 'sqrt(-1)', move: 'stay' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const mv = room.events.slice(n0).find((e) => e.type === 'move');
  assert.deepEqual([mv.data.coverBefore, mv.data.coverAfter], [1, 1], 'sin el círculo (comido), el enemigo te ve');
  room.bites = [];
  const sh2 = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const foe2 = room.soldiers.find((s) => s.team !== sh2.team);
  const d2 = sh2.team === 'left' ? 1 : -1;
  sh2.x = -10 * d2; sh2.y = 0; foe2.x = 10 * d2; foe2.y = 0;
  const n1 = room.events.length;
  room.fire(room.turn.playerId, { mode: 'function', expr: 'sqrt(-1)', move: 'stay' });
  const mv2 = room.events.slice(n1).find((e) => e.type === 'move');
  assert.deepEqual([mv2.data.coverBefore, mv2.data.coverAfter], [0, 0], 'premisa: sin bocado, el círculo tapa');
});

// ---------- red: ajuste fino del movimiento ----------
await check('red: el ajuste fino del movimiento desliza con los bocados (el mismo punto que la sala)', () => {
  const g = normalize(clone(TEMPLATES.turtle.genome)); // Moverse con ajuste
  const net = compile(g);
  // la red está dentro de un círculo grande, en una galería que han abierto los bocados
  const bites = [0, 0.5, 1, 1.5, 2, 2.5].map((x) => ({ x, y: 0, r: C.BITE_RADIUS }));
  const me = soldier('a', 'left', 0, 0), foe = soldier('e', 'right', 15, 5);
  const st = stateOf([me, foe], [circle(0, 0, 5)], bites);
  let checked = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = decideMove({ net, genome: g, state: st, soldierId: 'a', memory: net.zeroState(), rng: makeRng(seed) });
    const ma = r.decision.moveAdjust;
    assert.ok(ma && ma.target, 'premisa: la red ajusta su movimiento');
    const want = G.slideMove({ from: { x: 0, y: 0 }, requested: ma.target, soldiers: st.soldiers, obstacles: st.obstacles, bites, selfId: 'a' });
    const blind = G.slideMove({ from: { x: 0, y: 0 }, requested: ma.target, soldiers: st.soldiers, obstacles: st.obstacles, selfId: 'a' });
    assert.notDeepEqual(want.to, blind.to, 'premisa: sin bocados el resultado sería otro');
    assert.deepEqual(ma.to, want.to, `semilla ${seed}`);
    assert.deepEqual(r.move, { x: want.to.x, y: want.to.y });
    checked++;
  }
  assert.equal(checked, 6);
});

// ---------- red: dibujo de los candidatos (sin Simulador) ----------
await check('red sin Simulador: el recorrido dibujado de cada candidato ve los bocados', () => {
  const g = normalize(clone(TEMPLATES.sniper.genome)); // sin 🔮: la decisión simula aparte para el dibujo
  assert.ok(!g.blocks.some((b) => b.type === 'eye.simulator'), 'premisa: la plantilla no lleva Simulador');
  const net = compile(g);
  const me = soldier('a', 'left', -10, 0), foe = soldier('e', 'right', 10, 0);
  const obstacles = [circle(0, 0, 0.6)], bites = [{ x: 0, y: 0, r: C.BITE_RADIUS }];
  const st = stateOf([me, foe], obstacles, bites);
  const r = decideShot({ net, genome: g, state: st, soldierId: 'a', memory: net.zeroState(), rng: makeRng(3) });
  const ctx = { soldiers: st.soldiers, obstacles, bites, soldier: me, team: 'left' };
  const blindCtx = { ...ctx, bites: [] };
  let differs = 0;
  for (const c of r.decision.candidates) {
    const want = P.simulateCandidate(c, ctx, false).polyline;
    assert.deepEqual(c.points, want, `candidato ${c.i}`);
    if (JSON.stringify(P.simulateCandidate(c, blindCtx, false).polyline) !== JSON.stringify(want)) differs++;
  }
  assert.ok(differs > 0, 'premisa: algún candidato cruza el círculo comido');
});

// ---------- Simulador: distancia mínima hasta el primer impacto ----------
await check('Simulador: con impactos, la distancia mínima es la del recorrido hasta el primer impacto (como antes)', () => {
  const me = soldier('a', 'left', -10, 0), ally = soldier('b', 'left', -6, 0), e1 = soldier('e1', 'right', 0, 0);
  const cand = { family: 'line', mode: 'function', expr: '0', params: [0, 0, 0], angle: 0, team: 'left' };
  // solo el enemigo: el primer punto a HIT_RADIUS o menos de su centro (grueso: pasos de 0,05)
  const s1 = P.simulateCandidate(cand, { soldiers: [me, e1], obstacles: [], bites: [], soldier: me, team: 'left' }, false);
  assert.ok(s1.minDist > C.HIT_RADIUS - 0.06 && s1.minDist <= C.HIT_RADIUS + 1e-9, `mata: minDist ${s1.minDist} (antes ≈ ${C.HIT_RADIUS})`);
  // aliado y luego enemigo: hasta el aliado (x ≈ −6,7), el enemigo queda a ≈ 6,7
  const s2 = P.simulateCandidate(cand, { soldiers: [me, ally, e1], obstacles: [], bites: [], soldier: me, team: 'left' }, false);
  const reach = 6 + C.HIT_RADIUS;
  assert.ok(s2.minDist > reach - 0.06 && s2.minDist <= reach + 1e-9, `fuego amigo primero: minDist ${s2.minDist} (≈ ${reach})`);
  // la entrada del ojo que lo lleva: min(1, minDist/10)
  assert.ok(Math.abs(P.simulatorFeatures(s2, { soldiers: [me, ally, e1], obstacles: [], bites: [], soldier: me, team: 'left' })[5] - s2.minDist / 10) < 1e-12);
});

// ---------- Compañeros ----------
await check('Compañeros: "que mataron" y "con fuego amigo" cuentan las bajas de un tiro que atraviesa', () => {
  const mates = { id: 'mt', type: 'eye.mates', params: {} };
  const g = normalize({ ...clone(TEMPLATES.empty.genome), blocks: [...clone(TEMPLATES.empty.genome.blocks), mates] });
  const me = soldier('a', 'left', -10, 0), b = soldier('b', 'left', -10, 6), c = soldier('c', 'left', -10, -6), e = soldier('e', 'right', 10, 0);
  // b: su último tiro mató a un enemigo y a un aliado (tipo kill); c: uno antiguo, sin cuentas, de fuego amigo
  const shotLog = [
    { turn: 1, soldierId: 'c', team: 'left', result: { type: 'suicide', soldierId: 'x' }, minDist: 5, stayed: false },
    { turn: 2, soldierId: 'b', team: 'left', result: { type: 'kill', soldierId: 'e9', hits: ['e9', 'y'], kills: 1, friendly: 1, end: 'wall' }, minDist: 0, stayed: true },
  ];
  const st = stateOf([me, b, c, e], [], [], { shotLog });
  const o = P.observe(st, 'a', g, { phase: 'shoot', rng: makeRng(1) });
  const v = o.ctx.mt;
  assert.equal(v.length, 12);
  assert.equal(v[6], 1 / 2, 'que mataron: b');
  assert.equal(v[7], 2 / 2, 'con fuego amigo: b (cuentas) y c (tipo, partida antigua)');
});

// ---------- deslizar con círculos y bocados ----------
await check('deslizar con círculos y bocados = el punto de la rejilla polar completa (sin atajos)', () => {
  // oráculo: la rejilla de spec/01 §3 recorrida entera, con la validez de §10.1 reescrita aquí
  const R = C.MOVE_RADIUS, B = C.BODY;
  const solid = (p, obstacles, bites, m) => obstacles.some((o) => (o.kind === 'circle' ? Math.hypot(p.x - o.x, p.y - o.y) <= o.r + m : !(p.x < o.x - m || p.x > o.x + o.w + m || p.y < o.y - m || p.y > o.y + o.h + m)))
    && !bites.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < q.r - m);
  const valid = (p, from, soldiers, obstacles, bites) => {
    if (Math.hypot(p.x - from.x, p.y - from.y) > R + 1e-9) return false;
    if (p.x < C.PLANE.xMin + B || p.x > C.PLANE.xMax - B || p.y < C.PLANE.yMin + B || p.y > C.PLANE.yMax - B) return false;
    if (solid(p, obstacles, bites, B)) return false;
    if (soldiers.some((s) => s.alive && s.id !== 'a' && Math.hypot(p.x - s.x, p.y - s.y) < C.MIN_SEPARATION)) return false;
    for (let k = 1; k <= 10; k++) { const t = k / 10; if (solid({ x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t }, obstacles, bites, B)) return false; }
    return true;
  };
  const brute = (from, T, soldiers, obstacles, bites) => {
    let best = null, bestD = Infinity;
    const nr = Math.round(R / C.SLIDE_R_STEP), na = Math.round(360 / C.SLIDE_DEG_STEP);
    for (let i = 1; i <= nr; i++) for (let k = 0; k < na; k++) {
      const r = i * C.SLIDE_R_STEP, th = k * C.SLIDE_DEG_STEP * Math.PI / 180;
      const p = { x: from.x + r * Math.cos(th), y: from.y + r * Math.sin(th) };
      if (!valid(p, from, soldiers, obstacles, bites)) continue;
      const d = Math.hypot(p.x - T.x, p.y - T.y);
      if (d < bestD - 1e-12) { best = p; bestD = d; }
    }
    return best;
  };
  const rng = makeRng(2024);
  let slid = 0;
  for (let n = 0; n < 200; n++) {
    const from = { x: -20 + 40 * rng(), y: -12 + 24 * rng() };
    const obstacles = Array.from({ length: 3 + rng.int(5) }, () => circle(from.x + (rng() * 6 - 3), from.y + (rng() * 6 - 3), 0.5 + 2 * rng()));
    const bites = Array.from({ length: rng.int(6) }, () => ({ x: from.x + (rng() * 4 - 2), y: from.y + (rng() * 4 - 2), r: C.BITE_RADIUS }));
    const soldiers = [{ id: 'a', alive: true, x: from.x, y: from.y }, { id: 'o', alive: true, x: from.x + 1.2, y: from.y + 0.4 }];
    const req = { x: from.x + (rng() * 5 - 2.5), y: from.y + (rng() * 5 - 2.5) };
    const got = G.slideMove({ from, requested: req, soldiers, obstacles, bites, selfId: 'a' });
    if (got.reason !== 'slide' && got.reason !== 'blocked') continue;
    const d = Math.hypot(req.x - from.x, req.y - from.y);
    const T = d > R ? { x: from.x + (req.x - from.x) * R / d, y: from.y + (req.y - from.y) * R / d } : req;
    const want = brute(from, T, soldiers, obstacles, bites);
    if (!want) { assert.equal(got.reason, 'blocked', `escena ${n}`); continue; }
    assert.deepEqual(got.to, want, `escena ${n}`);
    slid++;
  }
  assert.ok(slid >= 30, `premisa: bastantes escenas deslizadas (${slid})`);
});

// ---------- rendimiento ----------
// tope grueso (margen ~6×): con 8–22 círculos, cada deslizamiento probaba los 2 880 puntos de la rejilla contra todos los
// círculos y una partida sin pantalla pasó de ~35 ms a ~1 s (auditoría de P1); con el arreglo, 1 000 deslizamientos ≈ 0,3 s
await check('rendimiento: 1 000 deslizamientos contra un mapa de 20 o más círculos tardan menos de 2 s', () => {
  const rng = makeRng(7);
  let obstacles = null;
  for (let s = 1; !obstacles; s++) { const m = genMap(2, makeRng(s)).obstacles; if (m.length >= 20) obstacles = m; }
  const cases = [];
  while (cases.length < 1000) {
    const o = obstacles[rng.int(obstacles.length)];
    const a = rng() * 2 * Math.PI, from = { x: o.x + (o.r + 0.6) * Math.cos(a), y: o.y + (o.r + 0.6) * Math.sin(a) };
    if (G.isSolid(from, { obstacles, bites: [] }, C.BODY)) continue;
    cases.push({ from, requested: { x: o.x, y: o.y } });
  }
  const t0 = performance.now();
  let slid = 0;
  for (const c of cases) if (G.slideMove({ from: c.from, requested: c.requested, soldiers: [], obstacles, bites: [] }).slid) slid++;
  const ms = performance.now() - t0;
  assert.ok(slid >= 900, `premisa: casi todos chocan y se deslizan (${slid})`);
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
});

// ---------- dibujo ----------
await check('dibujo: la clave de la capa del terreno cambia con cualquier obstáculo o bocado, no solo con cuántos hay', async () => {
  const { terrainKey } = await import('../public/js/render.js');
  const obs = [circle(0, 0, 2), circle(5, 1, 1)], bite = [{ x: 1, y: 0, r: C.BITE_RADIUS }];
  const k = terrainKey(obs, bite, 800, 500);
  assert.equal(k, terrainKey(clone(obs), clone(bite), 800, 500), 'mismo terreno, misma clave');
  assert.notEqual(k, terrainKey(obs, [{ x: 1.5, y: 0, r: C.BITE_RADIUS }], 800, 500), 'el mismo número de bocados en otro sitio');
  assert.notEqual(k, terrainKey([circle(0, 0, 2), circle(5, 1, 1.5)], bite, 800, 500), 'otro radio');
  assert.notEqual(k, terrainKey(obs, bite, 801, 500), 'otro tamaño del lienzo');
  assert.notEqual(terrainKey([{ x: 0, y: 0, w: 2, h: 3 }], [], 800, 500), terrainKey([{ x: 0, y: 0, w: 3, h: 2 }], [], 800, 500), 'rectángulos');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (terreno: casos de la auditoría de P1)');
process.exitCode = fails ? 1 : 0;
