// F3 — Percepción, casos que la prueba de mutantes mostró sin cubrir en percepcion.spec (congelado):
// ángulo de artillería en la simulación, víctima más cercana, espejo de obstáculos/radar/mapa,
// media x de los compañeros asimétrica, escala p1 del ajuste de senos, resultado "otro" en el historial.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (got, exp, eps = 1e-9, label = '') => { assert.equal(got.length, exp.length, label); for (let i = 0; i < exp.length; i++) assert.ok(near(got[i], exp[i], eps), `${label}[${i}] = ${got[i]} esperado ${exp[i]}`); };

const C = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const { tryCompile } = await import('../shared/parser.js');
const { simulateShot } = await import('../shared/solver.js');
const { repair, DEFAULT_IMAGINATION } = await import('../shared/genome.js');
const P = await import('../shared/percept.js');
const lib = await import('../agents/lib.js');
const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });

const mkScene = (team) => {
  const m = team === 'left' ? 1 : -1, other = team === 'left' ? 'right' : 'left';
  const mk = (id, ownerId, t, x, y, alive = true) => ({ id, ownerId, team: t, x: x * m, y, alive, lastExpr: '', turns: 1 });
  const obstacles = [{ x: -2, y: 0, w: 2, h: 5 }, { x: 15, y: -10, w: 4, h: 2 }].map((o) => (m === 1 ? o : { x: -(o.x + o.w), y: o.y, w: o.w, h: o.h }));
  return {
    soldiers: [mk('me', 'p1', team, -10, 2), mk('a1', 'p1', team, -14, 3), mk('a2', 'p1', team, -8, 10), mk('e1', 'p2', other, 5, 4), mk('e2', 'p2', other, 12, -6)],
    obstacles, players: [{ id: 'p1', team, kills: 0 }, { id: 'p2', team: other, kills: 0 }],
    shotLog: [{ turn: 1, playerId: 'p1', soldierId: 'a1', team, mode: 'function', expr: 'tan(x)', angle: 0, family: 'wild', params: [0, 0, 0], result: { type: 'invalid', soldierId: null }, minDist: 30, stayed: false, points: [] }],
    stats: { shots: 1, shotsNoKill: 1, remaps: 0 }, config: { plane: C.PLANE },
  };
};
const ctxOf = (st) => ({ ...lib.contextFor(st.soldiers, st.obstacles, st.soldiers[0]), team: st.soldiers[0].team });

check('simulateCandidate: artillería usa el ángulo en grados (radianes en el solver) y coincide con simulateShot', () => {
  const st = mkScene('left'); const ctx = ctxOf(st);
  const c = { i: 0, family: 'artillery', params: [0.07, 40, 0], mode: 'ode2', exprLocal: '-0.0700', expr: '-0.0700', angle: 40, team: 'left' };
  const sim = P.simulateCandidate(c, ctx, false);
  const ref = simulateShot({ mode: 'ode2', f: tryCompile('-0.0700').f, start: { x: -10, y: 2 }, dir: 1, angle: 40 * Math.PI / 180, soldiers: st.soldiers, obstacles: st.obstacles, shooterId: 'me', ds: 0.05, maxSteps: 2500 });
  assert.equal(sim.type, ref.result.type); assert.ok(near(sim.endX, ref.result.x) && near(sim.endY, ref.result.y)); assert.equal(sim.points, ref.points.length);
  const wrong = simulateShot({ mode: 'ode2', f: tryCompile('-0.0700').f, start: { x: -10, y: 2 }, dir: 1, angle: 40, soldiers: st.soldiers, obstacles: st.obstacles, shooterId: 'me', ds: 0.05, maxSteps: 2500 });
  assert.ok(!near(sim.endY, wrong.result.y, 1e-6) || sim.type !== wrong.result.type, 'con el ángulo sin convertir el resultado sería otro');
  assert.ok(sim.polyline[1][1] > sim.polyline[0][1], 'el ángulo positivo sube');
});

check('simulatorFeatures: la víctima es el enemigo más cercano → 1; invalid → "otro fin" y minDist 30', () => {
  const st = mkScene('left'); st.obstacles = []; const ctx = ctxOf(st);
  const me = st.soldiers[0], e1 = st.soldiers.find((s) => s.id === 'e1');
  const s0 = (e1.y - me.y) / (e1.x - me.x);
  const c = { i: 0, family: 'line', params: [s0, 0, 0], mode: 'function', exprLocal: `${s0.toFixed(5)}*x`, expr: `${s0.toFixed(5)}*x`, angle: null, team: 'left' };
  const sim = P.simulateCandidate(c, ctx, false);
  assert.equal(sim.type, 'kill'); assert.equal(sim.victimId, 'e1');
  const f = P.simulatorFeatures(sim, ctx);
  assert.equal(f[0], 1); assert.equal(f[9], 1, 'víctima = enemigo 1');
  const bad = P.simulateCandidate({ ...c, expr: 'x +', exprLocal: 'x +' }, ctx, false);
  assert.equal(bad.type, 'invalid'); assert.equal(bad.minDist, 30); assert.equal(bad.victimId, null); assert.ok(bad.polyline.length >= 2);
  const fb = P.simulatorFeatures(bad, ctx);
  vecNear(fb.slice(0, 6), [0, 0, 0, 0, 1, 1], 1e-9, 'invalid');
});

check('espejo del equipo derecho: obstáculos, radar, mapa y destinos dan los mismos vectores que el izquierdo', () => {
  const g = repair({ format: 1, id: 'espejo-1', name: 'Espejo', imagination: { n: 4 },
    blocks: [B('o', 'eye.obstacles', { slots: 3 }), B('r', 'eye.radar', { rays: 16 }), B('m', 'eye.map', { cell: 2, channels: ['obstacles', 'enemies', 'allies', 'self', 'trails'] }), B('t', 'eye.mates'), B('h', 'eye.history', { depth: 2 }), B('cat', 'concat'), B('v', 'hand.value')],
    wires: [W('o', 'cat'), W('r', 'cat'), W('m', 'cat'), W('t', 'cat'), W('h', 'cat'), W('cat', 'v')] }, makeRng(1)).genome;
  const L = mkScene('left'), R = mkScene('right');
  L.shotLog[0].points = [[-14, 3], [-9, 3], [-4, 3]]; R.shotLog[0].points = [[14, 3], [9, 3], [4, 3]];
  const ol = P.observe(L, 'me', g, { phase: 'shoot' }), or = P.observe(R, 'me', g, { phase: 'shoot' });
  for (const id of ['o', 'r', 'm', 't', 'h']) vecNear(or.ctx[id], ol.ctx[id], 1e-9, id);
  assert.ok(Array.from(ol.ctx.m).some((v) => v === 0.5 || v === 1), 'el mapa tiene celdas ocupadas');
  assert.ok(ol.ctx.o[0] < 0, 'el muro cercano está delante (x local negativa desde −25… no: centro en −1)');
  const dl = P.moveDestinations(L, L.soldiers[0]), dr = P.moveDestinations(R, R.soldiers[0]);
  for (let k = 0; k < 9; k++) vecNear(dr[k].feat, dl[k].feat, 1e-9, `dest ${k}`);
});

check('eye.mates: media x asimétrica y aliado más lejano; historial con resultado "otro fin" y minDist al tope', () => {
  const g = repair({ format: 1, id: 'mates-1', name: 'Mates', blocks: [B('t', 'eye.mates'), B('h', 'eye.history', { depth: 1 }), B('cat', 'concat'), B('v', 'hand.value')], wires: [W('t', 'cat'), W('h', 'cat'), W('cat', 'v')] }, makeRng(1)).genome;
  const st = mkScene('left'); const me = st.soldiers[0];
  const a1 = st.soldiers.find((s) => s.id === 'a1'), a2 = st.soldiers.find((s) => s.id === 'a2');
  const o = P.observe(st, 'me', g, { phase: 'shoot' });
  const d1 = Math.hypot(a1.x - me.x, a1.y - me.y), d2 = Math.hypot(a2.x - me.x, a2.y - me.y);
  assert.ok(near(o.ctx.t[1], ((a1.x - me.x) + (a2.x - me.x)) / 2 / 50) && o.ctx.t[1] !== 0, 'media x distinta de cero');
  assert.ok(near(o.ctx.t[3], Math.min(d1, d2) / 58) && near(o.ctx.t[4], Math.max(d1, d2) / 58));
  assert.ok(near(o.ctx.t[8], (1 + 1) / 2), 'a1 disparó con minDist 30 → 1; a2 sin disparo → 1');
  // historial: mi único tiro es "invalid" → familia salvaje, resultado "otro"
  vecNear(o.ctx.h.slice(0, 14), [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1], 1e-9, 'history');
});

check('applyAdjust: escala p1 de senos y parábolas (0.03·(1+|s|)); Fisher–Yates: la primera de line es la exacta', () => {
  const st = mkScene('left'); const me = st.soldiers[0];
  const img = P.generateCandidates(st, me, JSON.parse(JSON.stringify(DEFAULT_IMAGINATION)), makeRng(2));
  const sine = img.find((c) => c.family === 'sine'), par = img.find((c) => c.family === 'parabola');
  const s2 = P.applyAdjust(sine, [2, 0, 0]);
  assert.ok(near(s2.params[0], sine.params[0] + 0.03 * (1 + Math.abs(sine.params[0])) * 2));
  const p2 = P.applyAdjust(par, [-1, 0, 0]);
  assert.ok(near(p2.params[0], par.params[0] - 0.03 * (1 + Math.abs(par.params[0]))));
  const e1 = st.soldiers.find((s) => s.id === 'e1');
  const s0 = (e1.y - me.y) / (e1.x - me.x);
  for (let seed = 1; seed <= 10; seed++) {
    const first = P.generateCandidates(st, me, JSON.parse(JSON.stringify(DEFAULT_IMAGINATION)), makeRng(seed))[0];
    assert.ok(first.family === 'line' && near(first.params[0], s0), `seed ${seed}: la primera es la recta exacta`);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (percepción F3, extra)');
process.exit(fails ? 1 : 0);
