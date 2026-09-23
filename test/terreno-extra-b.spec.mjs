// Terreno (spec/01 §10), huecos de la prueba de mutantes de P1 (2026-09-24): reglas del contrato que ningún test fijaba.
// Escrito tras el código (solo fija el contrato) y congelado. En proceso, sin servidor.
// Uso: node test/terreno-extra-b.spec.mjs
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
const { simulateShot } = await import('../shared/solver.js');
const { tryCompile } = await import('../shared/parser.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');

const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const clone = (v) => JSON.parse(JSON.stringify(v));
const f = (expr) => tryCompile(expr).f;
const soldier = (id, team, x, y) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive: true, turns: 0 });
const line = { family: 'line', mode: 'function', expr: '0', params: [0, 0, 0], angle: 0, team: 'left' };

// ---------- geometría: bordes ----------
await check('isSolid: el borde de un círculo es sólido (d ≤ r) y el borde de un bocado no es bocado (d < r)', () => {
  assert.equal(G.isSolid({ x: 2, y: 0 }, [circle(0, 0, 2)]), true, 'd = r');
  assert.equal(G.isSolid({ x: 0, y: -2.5 }, [circle(0, 0, 2)], 0.5), true, 'd = r + margen');
  const T = { obstacles: [circle(0, 0, 3)], bites: [{ x: 0, y: 0, r: 0.5 }] };
  assert.equal(G.isSolid({ x: 0.5, y: 0 }, T), true, 'en el borde del bocado: sigue siendo terreno');
  assert.equal(G.isSolid({ x: 0.25, y: 0 }, T, 0.25), true, 'con margen: el bocado encoge a 0,25');
  assert.equal(G.isSolid({ x: 0.2, y: 0 }, T, 0.25), false);
});

// ---------- solver: el primer impacto ----------
await check('simulateShot: firstHit es el primer punto a HIT_RADIUS y cuenta los puntos grabados antes más él', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 0, 0);
  const base = { mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, shooterId: 'a', obstacles: [] };
  const hit = simulateShot({ ...base, soldiers: [me, e] });
  const free = simulateShot({ ...base, soldiers: [me] }); // el mismo recorrido, sin nadie a quien alcanzar
  const fh = hit.result.firstHit;
  assert.ok(Math.hypot(fh.x - e.x, fh.y - e.y) <= C.HIT_RADIUS && fh.x < e.x - C.HIT_RADIUS + C.STEP + 1e-9, JSON.stringify(fh));
  const before = free.points.filter(([x]) => x < fh.x - 1e-12);
  assert.equal(fh.points, before.length + 1);
  assert.deepEqual(hit.points.slice(0, fh.points - 1), before);
  assert.equal(simulateShot({ ...base, soldiers: [me] }).result.firstHit, null, 'sin impactos, null');
});

// ---------- Simulador: el recorrido de antes, exacto ----------
// oráculo: el recorrido que devolvía el solver al pararse en el primer impacto = los puntos grabados antes de él (de un
// tiro sin nadie a quien alcanzar) más el punto del impacto
const oldMinDist = (cand, soldiers, me, fine = false) => {
  const r = tryCompile(cand.expr);
  const base = { mode: cand.mode, f: r.f, start: { x: me.x, y: me.y }, dir: 1, angle: 0, obstacles: [], shooterId: me.id, ds: fine ? 0.01 : 0.05, maxSteps: fine ? 20000 : 2500 };
  const fh = simulateShot({ ...base, soldiers }).result.firstHit;
  const pts = [...simulateShot({ ...base, soldiers: [me] }).points.filter(([x]) => x < fh.x - 1e-12), [fh.x, fh.y]];
  let md = 30;
  for (const e of soldiers) if (e.alive && e.team !== me.team) for (const [px, py] of pts) md = Math.min(md, Math.hypot(e.x - px, e.y - py));
  return md;
};
await check('Simulador: la distancia mínima es exactamente la del recorrido de antes (cuenta el punto de salida y el último grabado)', () => {
  const me = soldier('a', 'left', -10, 0);
  // un enemigo a la espalda: lo más cerca que pasa el tiro es su punto de salida
  const back = [me, soldier('b', 'left', -6, 0), soldier('e', 'right', -14, 0)];
  const s1 = P.simulateCandidate(line, { soldiers: back, obstacles: [], bites: [], soldier: me, team: 'left' }, false);
  assert.equal(s1.minDist, oldMinDist(line, back, me));
  assert.equal(s1.minDist, 4, 'desde el punto de salida');
  // un enemigo justo encima del último punto grabado antes del impacto con un aliado
  const ally = soldier('b', 'left', -6, 0);
  const cut = simulateShot({ mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [me, ally], shooterId: 'a', obstacles: [], ds: 0.05, maxSteps: 2500 }).result.firstHit;
  const lastRec = simulateShot({ mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [me], shooterId: 'a', obstacles: [], ds: 0.05, maxSteps: 2500 }).points.filter(([x]) => x < cut.x - 1e-12).pop();
  const above = [me, ally, soldier('e', 'right', lastRec[0], 1)];
  const s2 = P.simulateCandidate(line, { soldiers: above, obstacles: [], bites: [], soldier: me, team: 'left' }, false);
  assert.equal(s2.minDist, oldMinDist(line, above, me));
  assert.ok(Math.abs(s2.minDist - 1) < 1e-12, `desde el último punto grabado: ${s2.minDist}`);
});
await check('Simulador: como mucho 4 aliados; un tiro que alcanza a alguien no es "otro final" aunque acabe sin recorrido', () => {
  const me = soldier('a', 'left', -10, 0);
  const row = [-8, -6, -4, -2, 0].map((x, i) => soldier(`b${i}`, 'left', x, 0));
  const ctxA = { soldiers: [me, ...row], obstacles: [], bites: [], soldier: me, team: 'left' };
  assert.equal(P.simulatorFeatures(P.simulateCandidate(line, ctxA, false), ctxA)[1], 4);
  // una onda larga: alcanza al enemigo que tiene delante y se queda sin recorrido (maxlen) sin salir del plano
  const me2 = soldier('a', 'left', -20, 0);
  const onCurve = (x) => 5 * Math.sin(x) - 5 * Math.sin(-20);
  const e = soldier('e', 'right', -19, onCurve(-19));
  const ctxW = { soldiers: [me2, e], obstacles: [], bites: [], soldier: me2, team: 'left' };
  const sim = P.simulateCandidate({ ...line, family: 'sine', expr: '5*sin(x)' }, ctxW, false);
  assert.equal(sim.end, 'maxlen', 'premisa: se queda sin recorrido');
  assert.deepEqual(sim.hitIds, ['e'], 'premisa: alcanza al enemigo');
  assert.deepEqual(Array.from(P.simulatorFeatures(sim, ctxW)).slice(0, 5), [1, 0, 0, 0, 0]);
});

// ---------- Obstáculos: el equipo derecho ----------
await check('ojo Obstáculos: para el equipo derecho, un círculo se refleja (x → −x) y conserva su tamaño', () => {
  const ob = { id: 'ob', type: 'eye.obstacles', params: { slots: 1 } };
  const g = normalize({ ...clone(TEMPLATES.empty.genome), blocks: [...clone(TEMPLATES.empty.genome.blocks), ob] });
  const st = { code: 'T', phase: 'playing', soldiers: [soldier('r', 'right', 10, 0), soldier('l', 'left', -15, 0)], obstacles: [circle(6, 2, 1.5)], bites: [],
    players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE } };
  const o = P.observe(st, 'r', g, { phase: 'shoot', rng: makeRng(1) });
  assert.deepEqual(Array.from(o.ctx.ob).slice(0, 5), [-6 / 25, 2 / 15, 3 / 10, 3 / 15, 1]);
});

// ---------- sala: bocados en rectángulos y roces de un tiro que atraviesa ----------
const { Room } = await import('../server/rooms.js');
const roomScene = (seed) => {
  const room = new Room('extra-b', { soldiersPerPlayer: 2, seed, headless: true });
  room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' });
  room.start();
  const pid = room.turn.playerId;
  const sh = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const dir = sh.team === 'left' ? 1 : -1;
  room.obstacles = []; room.bites = [];
  sh.x = -12 * dir; sh.y = 0;
  const ally = room.soldiers.find((s) => s.ownerId === pid && s.id !== sh.id);
  const foes = room.soldiers.filter((s) => s.team !== sh.team);
  ally.x = -20 * dir; ally.y = 12;
  return { room, pid, sh, ally, foes, dir };
};
await check('sala: un tiro que acaba contra un rectángulo también le arranca un bocado; lejos de todo, ninguno', () => {
  const a = roomScene(31);
  a.foes[0].x = 20 * a.dir; a.foes[0].y = 10; a.foes[1].x = 20 * a.dir; a.foes[1].y = -10;
  a.room.obstacles = [{ x: a.dir > 0 ? 0 : -2, y: -1, w: 2, h: 2 }];
  const r = a.room.fire(a.pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.equal(r.result.end, 'obstacle');
  assert.deepEqual(a.room.bites, [{ x: r.result.x, y: r.result.y, r: C.BITE_RADIUS }]);
  const b = roomScene(32);
  b.foes[0].x = 20 * b.dir; b.foes[0].y = 10; b.foes[1].x = 20 * b.dir; b.foes[1].y = -10;
  b.room.obstacles = [{ x: -2, y: 6, w: 4, h: 2 }, circle(0, -6, 2)]; // el tiro pasa entre los dos y acaba en el borde
  const r2 = b.room.fire(b.pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.equal(r2.result.end, 'wall');
  assert.deepEqual(b.room.bites, []);
});
await check('sala: roces solo de enemigos vivos que el tiro no alcanza (el alcanzado no roza; el aliado cerca, tampoco)', () => {
  const a = roomScene(33);
  a.foes[0].x = 0; a.foes[0].y = 0;            // lo alcanza
  a.foes[1].x = 6 * a.dir; a.foes[1].y = 0.9;   // pasa a 0,9 u (> 0,7): roce
  a.ally.x = -8 * a.dir; a.ally.y = 0.9;        // un aliado a 0,9 u del recorrido
  const n0 = a.room.events.length;
  const r = a.room.fire(a.pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.deepEqual(r.result.hits.map((h) => h.soldierId), [a.foes[0].id]);
  const grazes = a.room.events.slice(n0).filter((e) => e.type === 'graze');
  assert.deepEqual(grazes.map((e) => e.data.soldierId), [a.foes[1].id]);
});

// ---------- recompensa ----------
await check('recompensa: el fuego amigo cuenta por cada aliado del tiro (dos aliados, el doble)', async () => {
  const { assignRewards } = await import('../shared/reward.js');
  const reward = { ...TEMPLATES.sniper.genome.reward, normalize: false };
  const events = [
    { id: 1, type: 'decision', actor: { playerId: 'p', soldierId: 's' }, data: {} },
    { id: 2, type: 'shot', actor: { playerId: 'p', soldierId: 's' }, data: { decisionEventId: 1, result: { type: 'suicide', soldierId: 'x', hits: ['x', 'y'], kills: 0, friendly: 2, end: 'wall' }, minDist: 30 } },
  ];
  const trajectory = { soldiers: { s: [{ turn: 1, phase: 'shoot', obs: null, decision: { eventId: 1 } }] } };
  const r = assignRewards({ reward, teamSpirit: 0, events, trajectory, playerId: 'p' });
  assert.equal(r.entries[0].terms.friendlyFire, 2 * reward.friendlyFire);
  assert.equal(r.entries[0].terms.kill, undefined);
});

// ---------- mapas (spec/01 §10.2) ----------
const { genMap } = await import('../server/mapgen.js');
// Φ de la normal (Abramowitz y Stegun 7.1.26, error < 1,5·10⁻⁷)
const Phi = (z) => {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
};
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(4)} (teórico ${want.toFixed(4)}, margen ${tol})`);
await check('mapas: biomas 35/35/30; 15 ± 7 círculos (tope 8–22) y radios de 2,6 ± 1,6 u (tope 1–4), como el original', () => {
  const N = 6000, biomes = { fortaleza: 0, ruinas: 0, llanura: 0 }, counts = [], radii = [];
  for (let seed = 1; seed <= N; seed++) {
    const m = genMap(2, makeRng(seed));
    biomes[m.biome]++;
    if (m.biome !== 'llanura') counts.push(m.obstacles.length);
    if (m.biome === 'ruinas') for (const o of m.obstacles) radii.push(o.r);
  }
  near(biomes.fortaleza / N, 0.35, 0.025, 'fortaleza'); near(biomes.ruinas / N, 0.35, 0.025, 'ruinas'); near(biomes.llanura / N, 0.3, 0.025, 'llanura');
  // round(N(15, 7)) con tope en 8 y 22: P(8) = P(X < 8,5) y P(22) = P(X ≥ 21,5), iguales por simetría
  near(counts.filter((n) => n === 8).length / counts.length, Phi(-6.5 / 7), 0.025, 'P(8 círculos)');
  near(counts.filter((n) => n === 22).length / counts.length, Phi(-6.5 / 7), 0.025, 'P(22 círculos)');
  near(counts.reduce((s, n) => s + n, 0) / counts.length, 15, 0.4, 'media de círculos');
  // N(2,6, 1,6) con tope en 1 y 4: P(r = 1) = Φ(−1), P(r = 4) = 1 − Φ(0,875)
  near(radii.filter((r) => r === 1).length / radii.length, Phi(-1), 0.015, 'P(r = 1)');
  near(radii.filter((r) => r === 4).length / radii.length, 1 - Phi(1.4 / 1.6), 0.015, 'P(r = 4)');
});
await check('mapas: la fortaleza empieza por 2 o 3 círculos grandes (r 3,5–4, x −4..4); la llanura tiene 8, 9 o 10', () => {
  let forts = 0, third = 0, fourth = 0;
  const plains = new Set();
  for (let seed = 1; seed <= 900; seed++) {
    const m = genMap(2, makeRng(seed));
    const big = (o) => o && o.r >= 3.5 && o.r <= 4 && Math.abs(o.x) <= 4;
    if (m.biome === 'fortaleza') {
      forts++;
      assert.ok(big(m.obstacles[0]) && big(m.obstacles[1]), `semilla ${seed}: los dos primeros son grandes`);
      if (big(m.obstacles[2])) third++;
      if (big(m.obstacles[2]) && big(m.obstacles[3])) fourth++;
    }
    if (m.biome === 'llanura') plains.add(m.obstacles.length);
  }
  near(third / forts, 0.5 + 0.5 * 0.05, 0.12, 'con un tercero grande (la mitad, más alguna coincidencia)');
  assert.ok(fourth / forts < 0.1, `cuatro grandes seguidos solo por casualidad (${fourth} de ${forts})`);
  assert.deepEqual([...plains].sort((a, b) => a - b), [8, 9, 10]);
});
await check('soldados: cada bando en su mitad (x −23..−6 y 6..23) y a 2 u o más del borde de arriba y del de abajo', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const m = genMap(4, makeRng(seed));
    for (const [side, lo, hi] of [['left', -23, -6], ['right', 6, 23]]) {
      for (const p of m.placeSide(side, 4)) assert.ok(p.x >= lo && p.x <= hi && p.y >= C.PLANE.yMin + 2 && p.y <= C.PLANE.yMax - 2, `semilla ${seed}: ${side} en (${p.x}, ${p.y})`);
    }
  }
});
await check('soldados: sin sitio al azar, el hueco libre de la rejilla de 0,5 u más cercano a (±20, 0); sin hueco, (±20, 0)', () => {
  // placeSide coloca contra los obstáculos del propio mapa: cuatro círculos enormes solo dejan libre un puntito alrededor de
  // (−15, 5) y (15, −5), que al azar no se acierta nunca
  const k = 20, R = k * Math.SQRT2 - 1 - 0.01;
  const walled = (cx, cy) => {
    const m = genMap(2, makeRng(1));
    m.obstacles.length = 0;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) m.obstacles.push(circle(cx + sx * k, cy + sy * k, R));
    return m;
  };
  assert.deepEqual(walled(-15, 5).placeSide('left', 2), [{ x: -15, y: 5 }, { x: -20, y: 0 }]);
  assert.deepEqual(walled(15, -5).placeSide('right', 1), [{ x: 15, y: -5 }]);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (terreno: huecos de los mutantes de P1)');
process.exitCode = fails ? 1 : 0;
