// F3 — Percepción (spec/03 §1–§6, §9.1): marco local, Imaginación, ajuste, ojos exactos, destinos.
// Escrito ANTES del código y congelado. Sin servidor.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vecNear = (got, exp, eps = 1e-9, label = '') => {
  assert.equal(got.length, exp.length, `${label} longitud ${got.length} vs ${exp.length}`);
  for (let i = 0; i < exp.length; i++) assert.ok(near(got[i], exp[i], eps), `${label}[${i}] = ${got[i]} esperado ${exp[i]}`);
};

const C = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const { tryCompile } = await import('../shared/parser.js');
const { simulateShot } = await import('../shared/solver.js');
const { repair, outDims, normalize, DEFAULT_IMAGINATION } = await import('../shared/genome.js');
const P = await import('../shared/percept.js');
const lib = await import('../agents/lib.js');

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const IMG = (over = {}) => normalize({ id: 'x', blocks: [], wires: [], imagination: over }).imagination;

// ---------- escena de referencia (equipo izquierdo; el marco local coincide con el mundo) ----------
function scene({ team = 'left' } = {}) {
  const m = team === 'left' ? 1 : -1; // espejo para el equipo derecho
  const mk = (id, ownerId, t, x, y, alive = true, turns = 0) => ({ id, ownerId, team: t, x: x * m, y, alive, lastExpr: '', turns });
  const other = team === 'left' ? 'right' : 'left';
  const soldiers = [
    mk('me', 'p1', team, -10, 2, true, 5),
    mk('a1', 'p1', team, -12, 3), mk('a2', 'p1', team, -8, 10), mk('a3', 'p1', team, -20, -5, false),
    mk('e1', 'p2', other, 5, 4), mk('e2', 'p2', other, 12, -6), mk('e3', 'p2', other, 20, 0, false),
  ];
  const obstacles = [{ x: -2, y: 0, w: 2, h: 5 }, { x: 15, y: -10, w: 4, h: 2 }].map((o) => (m === 1 ? o : { x: -(o.x + o.w), y: o.y, w: o.w, h: o.h }));
  const players = [
    { id: 'p1', name: 'Yo', team, isBot: true, kills: 2, deaths: 1, alive: 3 },
    { id: 'p2', name: 'Rival', team: other, isBot: true, kills: 1, deaths: 2, alive: 2 },
  ];
  const shotLog = [
    { turn: 1, playerId: 'p1', soldierId: 'a1', team, mode: 'function', expr: '0.3*x', angle: 0, family: 'line', params: [0.3, 0, 0], result: { type: 'kill', soldierId: 'e3' }, minDist: 0, stayed: true, points: [] },
    { turn: 2, playerId: 'p2', soldierId: 'e1', team: other, mode: 'ode2', expr: '-0.05', angle: 30, family: 'artillery', params: [0.05, 30, 0], result: { type: 'obstacle', soldierId: null }, minDist: 12, stayed: false, points: [] },
    { turn: 3, playerId: 'p1', soldierId: 'me', team, mode: 'function', expr: '0.2*x+0.01*x^2', angle: 0, family: 'parabola', params: [0.2, 0.01, 0], result: { type: 'wall', soldierId: null }, minDist: 3.5, stayed: false, points: [] },
  ];
  return { code: 'T', phase: 'playing', soldiers, obstacles, players, shotLog, stats: { shots: 9, shotsNoKill: 2, remaps: 1 }, history: [], chat: [], config: { plane: C.PLANE } };
}
const ctxOf = (st, id = 'me') => { const s = st.soldiers.find((x) => x.id === id); return { ...lib.contextFor(st.soldiers, st.obstacles, s), team: s.team }; };

// ---------- marco local ----------
check('toLocal/toWorld: identidad para el izquierdo, espejo en x para el derecho; ida y vuelta', () => {
  assert.deepEqual(P.toLocal({ x: 3, y: -2 }, 'left'), { x: 3, y: -2 });
  assert.deepEqual(P.toLocal({ x: 3, y: -2 }, 'right'), { x: -3, y: -2 });
  assert.deepEqual(P.toWorld(P.toLocal({ x: 7, y: 1 }, 'right'), 'right'), { x: 7, y: 1 });
  assert.equal(P.worldToLocalSlope(0.4, 'right'), -0.4); assert.equal(P.worldToLocalSlope(0.4, 'left'), 0.4);
});

check('localToWorldExpr: sustitución textual y trayectoria espejada exacta (function, ode1, ode2)', () => {
  assert.equal(P.localToWorldExpr('0.3*x+2*sin(x/4)', 'function', 'left'), '0.3*x+2*sin(x/4)');
  assert.equal(P.localToWorldExpr('0.3*x+2*sin(x/4)', 'function', 'right'), '0.3*(-x)+2*sin((-x)/4)');
  assert.equal(P.localToWorldExpr('exp(-abs(x)/3)', 'function', 'right'), 'exp(-abs((-x))/3)', 'la x de exp/abs no se toca');
  assert.equal(P.localToWorldExpr('2*sin(x/3)+1', 'ode1', 'right'), '-(2*sin((-x)/3)+1)');
  assert.equal(P.localToWorldExpr("-0.05*y'+x", 'ode2', 'right'), "-0.05*(-(y'))+(-x)");
  for (const [mode, expr, angle] of [['function', '0.25*x+0.01*x^2', 0], ['function', '3*sin(x/4)+0.2*x', 0], ['ode1', '0.5*sin(x/5)-0.3', 0], ['ode2', '-0.05', 35], ['ode2', "-0.04-0.1*y'", 20]]) {
    const fl = tryCompile(expr).f, fr = tryCompile(P.localToWorldExpr(expr, mode, 'right')).f;
    assert.ok(fr, 'la expresión mundo compila');
    const L = simulateShot({ mode, f: fl, start: { x: -10, y: 2 }, dir: 1, angle: angle * Math.PI / 180 });
    const R = simulateShot({ mode, f: fr, start: { x: 10, y: 2 }, dir: -1, angle: angle * Math.PI / 180 });
    assert.equal(L.points.length, R.points.length, `${mode} ${expr}`);
    for (let i = 0; i < L.points.length; i++) assert.ok(near(L.points[i][0], -R.points[i][0], 1e-9) && near(L.points[i][1], R.points[i][1], 1e-9), `${mode} ${expr} punto ${i}`);
    assert.equal(L.result.type, R.result.type);
  }
});

check('familyOf: clasifica disparos ajenos en el marco del tirador', () => {
  assert.deepEqual(P.familyOf({ mode: 'function', expr: '0.25*x', team: 'left' }), { family: 'line', params: [0.25, 0, 0] });
  assert.deepEqual(P.familyOf({ mode: 'function', expr: '-0.5*x', team: 'right' }), { family: 'line', params: [0.5, 0, 0] });
  assert.deepEqual(P.familyOf({ mode: 'ode1', expr: 'sin(x)', team: 'left' }), { family: 'ode1', params: [0, 0, 0] });
  assert.deepEqual(P.familyOf({ mode: 'ode2', expr: '-0.05', angle: 30, team: 'right' }), { family: 'artillery', params: [0.05, 30, 0] });
  assert.deepEqual(P.familyOf({ mode: 'function', expr: '3*sin(x/4)', team: 'left' }), { family: 'wild', params: [0, 0, 0] });
  assert.deepEqual(P.familyOf({ mode: 'function', expr: '2x', team: 'left' }), { family: 'wild', params: [0, 0, 0] });
  assert.deepEqual(P.FAMILY_ORDER, ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild']);
});

// ---------- Imaginación ----------
const famCounts = (cands) => P.FAMILY_ORDER.map((f) => cands.filter((c) => c.family === f).length);
check('Imaginación: cupos por familia (restos mayores), orden, índices y determinismo', () => {
  const st = scene(); const me = st.soldiers[0];
  const c24 = P.generateCandidates(st, me, IMG(), makeRng(1));
  assert.equal(c24.length, 24); assert.deepEqual(famCounts(c24), [6, 6, 4, 2, 4, 2]);
  c24.forEach((c, i) => assert.equal(c.i, i));
  let last = -1; for (const c of c24) { const k = P.FAMILY_ORDER.indexOf(c.family); assert.ok(k >= last, 'orden por familia'); last = k; }
  assert.deepEqual(famCounts(P.generateCandidates(st, me, IMG({ n: 10 }), makeRng(1))), [2, 2, 2, 1, 2, 1]);
  assert.deepEqual(famCounts(P.generateCandidates(st, me, IMG({ families: { line: { on: false } } }), makeRng(1))), [0, 8, 5, 3, 5, 3]);
  assert.deepEqual(famCounts(P.generateCandidates(st, me, IMG({ n: 4, families: { line: { weight: 100 } } }), makeRng(1))), [4, 0, 0, 0, 0, 0]);
  const again = P.generateCandidates(st, me, IMG(), makeRng(1));
  assert.deepEqual(c24, again, 'misma semilla, mismos candidatos');
  const other = P.generateCandidates(st, me, IMG(), makeRng(2));
  assert.ok(other.some((c, i) => c.exprLocal !== c24[i].exprLocal), 'otra semilla, otra baraja');
  for (const c of c24) {
    assert.ok(['function', 'ode1', 'ode2'].includes(c.mode) && typeof c.exprLocal === 'string' && typeof c.expr === 'string' && Array.isArray(c.params) && c.params.length === 3);
    assert.ok(tryCompile(c.expr).ok, `compila: ${c.expr}`);
    if (c.mode === 'ode2') assert.ok(Number.isInteger(c.angle) && Math.abs(c.angle) <= 85); else assert.equal(c.angle, null);
  }
});

check('Imaginación: cada candidato sale de la rejilla de su familia y de un objetivo real; sin repetir dentro de la familia', () => {
  const st = scene(); const me = st.soldiers[0];
  const img = IMG();
  const cands = P.generateCandidates(st, me, img, makeRng(3));
  const enemies = st.soldiers.filter((s) => s.alive && s.team !== 'left').sort((a, b) => dist(a, me) - dist(b, me));
  const slopes = enemies.map((e) => (e.y - me.y) / (e.x - me.x));
  const F = img.families;
  const seen = new Set();
  for (const c of cands) {
    assert.ok(!seen.has(c.family + '|' + c.exprLocal + '|' + c.angle), `repetido ${c.exprLocal}`); seen.add(c.family + '|' + c.exprLocal + '|' + c.angle);
    const [p1, p2, p3] = c.params;
    if (c.family === 'line') {
      assert.ok(F.line.jitter.some((j) => slopes.some((s0) => near(p1, s0 * (1 + j), 1e-9))), `pendiente ${p1}`);
      assert.equal(c.exprLocal, `${p1.toFixed(5)}*x`); assert.equal(c.mode, 'function');
    } else if (c.family === 'parabola') {
      assert.ok(slopes.some((s0) => near(p1, s0)) && F.parabola.curvatures.includes(p2));
      assert.equal(c.exprLocal, `${p1.toFixed(5)}*x+${p2.toFixed(5)}*x^2`);
    } else if (c.family === 'sine') {
      assert.ok(slopes.some((s0) => near(p1, s0)) && F.sine.amps.includes(p2) && F.sine.periods.includes(p3));
      assert.equal(c.exprLocal, `${p1.toFixed(5)}*x+${p2.toFixed(3)}*sin(x/${p3.toFixed(3)})`);
    } else if (c.family === 'ode1') {
      assert.ok(F.ode1.a.includes(p1) && F.ode1.k.includes(p2) && F.ode1.b.includes(p3)); assert.equal(c.mode, 'ode1');
      assert.equal(c.exprLocal, `${p1.toFixed(3)}*sin(x/${p2.toFixed(3)})+${p3.toFixed(3)}`);
    } else if (c.family === 'artillery') {
      assert.ok(F.artillery.gravities.includes(p1) && F.artillery.angles.includes(p2)); assert.equal(c.mode, 'ode2');
      assert.equal(c.exprLocal, `-${p1.toFixed(4)}`); assert.equal(c.angle, p2);
    } else {
      assert.ok(F.wild.a.includes(p1) && F.wild.k.includes(p2) && Number.isInteger(p3) && p3 >= 0 && p3 < 7);
      assert.equal(c.exprLocal, P.WILD_TEMPLATES[p3](p1.toFixed(3), p2.toFixed(2)));
    }
    assert.equal(c.expr, c.exprLocal, 'equipo izquierdo: mundo = local');
  }
  const lines = cands.filter((c) => c.family === 'line');
  assert.ok(lines.some((c) => slopes.some((s0) => near(c.params[0], s0)) ), 'la recta exacta al objetivo está');
  const bothTargets = new Set(lines.map((c) => slopes.findIndex((s0) => F.line.jitter.some((j) => near(c.params[0], s0 * (1 + j), 1e-9)))));
  assert.equal(bothTargets.size, 2, '"all" alterna los dos enemigos');
  const nearestOnly = P.generateCandidates(st, me, IMG({ targets: 'nearest' }), makeRng(3)).filter((c) => c.family === 'line');
  assert.ok(nearestOnly.every((c) => F.line.jitter.some((j) => near(c.params[0], slopes[0] * (1 + j), 1e-9))), '"nearest" solo el más cercano');
});

check('Imaginación: rejilla agotada → repite con jitter; sin enemigos → objetivo virtual; equipo derecho → expresión mundo espejada', () => {
  const st = scene(); const me = st.soldiers[0];
  const cands = P.generateCandidates(st, me, IMG({ n: 8, targets: 'nearest', families: { line: { weight: 100, jitter: [0] }, parabola: { weight: 0.0001 }, sine: { on: false }, ode1: { on: false }, artillery: { on: false }, wild: { on: false } } }), makeRng(4));
  const lines = cands.filter((c) => c.family === 'line');
  assert.ok(lines.length >= 7, String(lines.length));
  const e1 = st.soldiers.find((s) => s.id === 'e1'); const s0 = (e1.y - me.y) / (e1.x - me.x);
  assert.ok(lines.some((c) => near(c.params[0], s0)), 'la exacta');
  assert.ok(lines.filter((c) => !near(c.params[0], s0)).every((c) => Math.abs(c.params[0] - s0) <= 0.05 + 1e-9), 'las repetidas llevan jitter ≤ 0.05');
  assert.equal(new Set(lines.map((c) => c.exprLocal)).size, lines.length, 'todas distintas');
  const none = scene(); for (const s of none.soldiers) if (s.team === 'right') s.alive = false;
  const cn = P.generateCandidates(none, none.soldiers[0], IMG({ n: 6, families: { line: { weight: 1 }, parabola: { on: false }, sine: { on: false }, ode1: { on: false }, artillery: { on: false }, wild: { on: false } } }), makeRng(1));
  assert.ok(cn.every((c) => c.family === 'line' && Math.abs(c.params[0]) <= 0.2), 'objetivo virtual (sx+20, sy): pendiente 0 (± jitter)');
  const right = scene({ team: 'right' }); const meR = right.soldiers[0];
  const cr = P.generateCandidates(right, meR, IMG(), makeRng(1));
  const cl = P.generateCandidates(st, me, IMG(), makeRng(1));
  for (let i = 0; i < cr.length; i++) {
    assert.equal(cr[i].exprLocal, cl[i].exprLocal, 'misma escena espejada → mismos candidatos locales');
    assert.equal(cr[i].expr, P.localToWorldExpr(cl[i].exprLocal, cl[i].mode, 'right'));
    assert.equal(cr[i].angle, cl[i].angle);
  }
});

check('applyAdjust: escalas por familia, recorte del sample a [−3,3], reconstrucción de la expresión y límites de artillería', () => {
  const st = scene(); const me = st.soldiers[0];
  const by = (fam) => P.generateCandidates(st, me, IMG(), makeRng(5)).find((c) => c.family === fam);
  const line = by('line'), s = line.params[0];
  const l2 = P.applyAdjust(line, [1, 0, 0]);
  assert.ok(near(l2.params[0], s + 0.03 * (1 + Math.abs(s))) && l2.exprLocal === `${l2.params[0].toFixed(5)}*x` && l2.expr === l2.exprLocal);
  assert.ok(near(P.applyAdjust(line, [9, 0, 0]).params[0], s + 0.03 * (1 + Math.abs(s)) * 3), 'recortado a 3');
  assert.ok(near(P.applyAdjust(line, [-9, 0, 0]).params[0], s - 0.03 * (1 + Math.abs(s)) * 3), 'recortado a −3');
  assert.deepEqual(line.params, [s, 0, 0], 'el candidato original no se toca');
  const par = by('parabola'), p2 = P.applyAdjust(par, [0.5, 2, 0]);
  assert.ok(near(p2.params[0], par.params[0] + 0.03 * (1 + Math.abs(par.params[0])) * 0.5) && near(p2.params[1], par.params[1] + 0.003 * 2));
  assert.equal(p2.exprLocal, `${p2.params[0].toFixed(5)}*x+${p2.params[1].toFixed(5)}*x^2`);
  const sin = by('sine'), s3 = P.applyAdjust(sin, [0, 1, -1]);
  assert.ok(near(s3.params[1], sin.params[1] + 0.3) && near(s3.params[2], sin.params[2] - 0.5));
  const o = by('ode1'), o2 = P.applyAdjust(o, [1, 1, 1]);
  assert.ok(near(o2.params[0], o.params[0] + 0.2) && near(o2.params[1], o.params[1] + 0.5) && near(o2.params[2], o.params[2] + 0.2));
  assert.equal(o2.exprLocal, `${o2.params[0].toFixed(3)}*sin(x/${o2.params[1].toFixed(3)})+${o2.params[2].toFixed(3)}`);
  const art = by('artillery'), a2 = P.applyAdjust(art, [1, 1, 0]);
  assert.ok(near(a2.params[0], art.params[0] + 0.005) && a2.angle === Math.round(art.params[1] + 3) && a2.params[1] === a2.angle);
  assert.equal(a2.exprLocal, `-${a2.params[0].toFixed(4)}`);
  const clampG = P.applyAdjust({ ...art, params: [0.006, 80, 0] }, [-3, 3, 0]);
  assert.equal(clampG.params[0], 0.005); assert.equal(clampG.angle, 85);
  const w = by('wild'), w2 = P.applyAdjust(w, [1, 1, 5]);
  assert.ok(near(w2.params[0], w.params[0] + 0.3) && near(w2.params[1], w.params[1] + 1) && w2.params[2] === w.params[2], 'el índice de plantilla no se ajusta');
  assert.equal(w2.exprLocal, P.WILD_TEMPLATES[w2.params[2]](w2.params[0].toFixed(3), w2.params[1].toFixed(2)));
  const right = scene({ team: 'right' });
  const lr = P.generateCandidates(right, right.soldiers[0], IMG(), makeRng(5)).find((c) => c.family === 'line');
  const lr2 = P.applyAdjust(lr, [1, 0, 0]);
  assert.equal(lr2.expr, P.localToWorldExpr(lr2.exprLocal, 'function', 'right'));
});

// ---------- rasgos de candidatos, simulador ----------
check('candidateFeatures: one-hot, normalizaciones y error analítico en la x de los dos enemigos', () => {
  const st = scene(); const me = st.soldiers[0]; const ctx = ctxOf(st);
  const e = st.soldiers.filter((s) => s.alive && s.team === 'right').sort((a, b) => dist(a, me) - dist(b, me));
  const s0 = (e[0].y - me.y) / (e[0].x - me.x);
  const line = { i: 0, family: 'line', params: [s0, 0, 0], mode: 'function', exprLocal: `${s0.toFixed(5)}*x`, expr: `${s0.toFixed(5)}*x`, angle: null };
  const f = tryCompile(line.exprLocal).f;
  const err = (en) => Math.tanh((f(en.x) - f(me.x) + me.y - en.y) / 3);
  vecNear(P.candidateFeatures(line, ctx), [1, 0, 0, 0, 0, 0, Math.tanh(s0 / 2), 0, 0, err(e[0]), err(e[1]), 0], 1e-9, 'line');
  const art = { i: 1, family: 'artillery', params: [0.07, 40, 0], mode: 'ode2', exprLocal: '-0.0700', expr: '-0.0700', angle: 40 };
  vecNear(P.candidateFeatures(art, ctx), [0, 0, 0, 0, 1, 0, 0.07 / 0.15, 40 / 85, 0, 0, 0, 1], 1e-9, 'artillery');
  const sine = { i: 2, family: 'sine', params: [0.5, 4, 8], mode: 'function', exprLocal: '0.50000*x+4.000*sin(x/8.000)', expr: '0.50000*x+4.000*sin(x/8.000)', angle: null };
  const fs = tryCompile(sine.exprLocal).f;
  vecNear(P.candidateFeatures(sine, ctx), [0, 0, 1, 0, 0, 0, Math.tanh(0.25), 4 / 6, 8 / 12, Math.tanh((fs(e[0].x) - fs(me.x) + me.y - e[0].y) / 3), Math.tanh((fs(e[1].x) - fs(me.x) + me.y - e[1].y) / 3), 0], 1e-9, 'sine');
  const wild = { i: 3, family: 'wild', params: [4, 3, 0], mode: 'function', exprLocal: '4.000*tan(x/3.00)', expr: '4.000*tan(x/3.00)', angle: null };
  const fw = P.candidateFeatures(wild, ctx);
  vecNear(fw.slice(0, 9), [0, 0, 0, 0, 0, 1, 0.5, 3 / 20, 0], 1e-9, 'wild');
  assert.ok(Number.isFinite(fw[9]) && Number.isFinite(fw[10]) && fw[11] === 0);
  const one = scene(); for (const s of one.soldiers) if (s.id === 'e2') s.alive = false;
  assert.equal(P.candidateFeatures(line, ctxOf(one))[10], 0, 'sin segundo enemigo el error 2 es 0');
  const ode = { i: 4, family: 'ode1', params: [1, 6, 0], mode: 'ode1', exprLocal: '1.000*sin(x/6.000)+0.000', expr: '1.000*sin(x/6.000)+0.000', angle: null };
  vecNear(P.candidateFeatures(ode, ctx), [0, 0, 0, 1, 0, 0, 1 / 3, 0.5, 0, 0, 0, 1], 1e-9, 'ode1');
});

check('simulateCandidate/simulatorFeatures: igual que el solver en el mundo; kill, wall y víctima más cercana', () => {
  const st = scene(); const me = st.soldiers[0]; const ctx = ctxOf(st);
  const e = st.soldiers.filter((s) => s.alive && s.team === 'right').sort((a, b) => dist(a, me) - dist(b, me));
  // e2 tiene línea de tiro directa; e1 está tapado por el muro
  const s2 = (e[1].y - me.y) / (e[1].x - me.x);
  const c2 = { i: 0, family: 'line', params: [s2, 0, 0], mode: 'function', exprLocal: `${s2.toFixed(5)}*x`, expr: `${s2.toFixed(5)}*x`, angle: null };
  const sim = P.simulateCandidate(c2, ctx, false);
  const ref = simulateShot({ mode: 'function', f: tryCompile(c2.expr).f, start: { x: me.x, y: me.y }, dir: 1, soldiers: st.soldiers, obstacles: st.obstacles, shooterId: 'me', ds: 0.05, maxSteps: 2500 });
  assert.equal(sim.type, ref.result.type); assert.equal(sim.type, 'kill'); assert.equal(sim.victimId, 'e2');
  assert.ok(near(sim.endX, ref.result.x) && near(sim.endY, ref.result.y) && sim.points === ref.points.length);
  assert.ok(Array.isArray(sim.polyline) && sim.polyline.length <= 100 && sim.polyline.length >= 2);
  let md = 30; for (const [px, py] of ref.points) for (const en of e) md = Math.min(md, Math.hypot(en.x - px, en.y - py));
  assert.ok(near(sim.minDist, md));
  vecNear(P.simulatorFeatures(sim, ctx), [1, 0, 0, 0, 0, Math.min(1, md / 10), sim.endX / 25, sim.endY / 15, Math.min(1, sim.points / 200), 0], 1e-9, 'kill e2 (no es el más cercano)');
  const s1 = (e[0].y - me.y) / (e[0].x - me.x);
  const c1 = { ...c2, params: [s1, 0, 0], exprLocal: `${s1.toFixed(5)}*x`, expr: `${s1.toFixed(5)}*x` };
  const simB = P.simulateCandidate(c1, ctx, false);
  assert.equal(simB.type, 'obstacle'); assert.equal(P.simulatorFeatures(simB, ctx)[2], 1);
  const up = { ...c2, exprLocal: 'x^2', expr: 'x^2', family: 'wild' };
  const simW = P.simulateCandidate(up, ctx, true);
  assert.equal(simW.type, 'wall'); assert.equal(P.simulatorFeatures(simW, ctx)[3], 1);
  const fine = P.simulateCandidate(c2, ctx, true);
  assert.ok(fine.points > sim.points, 'la simulación fina tiene más puntos');
  const right = scene({ team: 'right' }); const cr = { ...c2, expr: P.localToWorldExpr(c2.exprLocal, 'function', 'right') };
  const simR = P.simulateCandidate(cr, ctxOf(right), false);
  assert.equal(simR.type, 'kill'); assert.ok(near(simR.endX, sim.endX), 'endX en el marco local');
});

// ---------- destinos ----------
check('moveDestinations: 9 rasgos exactos en campo abierto, espejo para el derecho, y pegado a obstáculo', () => {
  const st = scene(); st.obstacles = []; const me = st.soldiers[0];
  const dests = P.moveDestinations(st, me);
  assert.equal(dests.length, 9);
  const enemies = st.soldiers.filter((s) => s.alive && s.team === 'right'); const allies = st.soldiers.filter((s) => s.alive && s.team === 'left' && s.id !== 'me');
  const e1 = enemies.slice().sort((a, b) => dist(a, me) - dist(b, me))[0];
  const d0 = dist(me, e1);
  for (let k = 0; k < 9; k++) {
    const d = dests[k]; assert.equal(d.i, k); assert.equal(d.stay, k === 0);
    const th = (k - 1) * Math.PI / 4;
    const exp = k === 0 ? { x: me.x, y: me.y } : { x: me.x + 2 * Math.cos(th), y: me.y + 2 * Math.sin(th) };
    assert.ok(near(d.to.x, exp.x) && near(d.to.y, exp.y)); assert.equal(d.slid, false);
    const withLos = enemies.filter((en) => lib.los(d.to, en, [])).length;
    const allyD = Math.min(...allies.map((a) => dist(d.to, a)));
    vecNear(d.feat, [(d.to.x - me.x) / 2, (d.to.y - me.y) / 2, k === 0 ? 1 : 0, 0, withLos / 4, (dist(d.to, e1) - d0) / 2, Math.min(1, allyD / 10), 1, 0], 1e-9, `dest ${k}`);
    assert.equal(d.cover, withLos); assert.ok(near(d.distEnemy, dist(d.to, e1)));
  }
  const right = scene({ team: 'right' }); right.obstacles = [];
  const dr = P.moveDestinations(right, right.soldiers[0]);
  for (let k = 0; k < 9; k++) vecNear(dr[k].feat, dests[k].feat, 1e-9, `espejo ${k}`);
  assert.ok(near(dr[1].to.x, right.soldiers[0].x - 2), 'en el mundo, "adelante" para el derecho es −x');
  const hug = scene(); hug.soldiers[0].x = -3; hug.soldiers[0].y = 6; // el muro está en x ∈ [−2, 0], y ∈ [0, 5]: a 1 u del rect ampliado en BODY
  const dh = P.moveDestinations(hug, hug.soldiers[0]);
  assert.equal(dh[0].feat[8], 1, 'a menos de 1 u del rect ampliado: pegado');
  const far = scene(); far.soldiers[0].x = -10; far.soldiers[0].y = 12;
  assert.equal(P.moveDestinations(far, far.soldiers[0])[0].feat[8], 0);
  const alone = scene(); for (const s of alone.soldiers) if (s.id !== 'me' && s.team === 'left') s.alive = false;
  assert.equal(P.moveDestinations(alone, alone.soldiers[0])[0].feat[6], 1, 'sin aliados: distancia 1 (cap)');
  const noE = scene(); for (const s of noE.soldiers) if (s.team === 'right') s.alive = false;
  const dn = P.moveDestinations(noE, noE.soldiers[0]);
  assert.ok(dn.every((d) => d.feat[4] === 0 && d.feat[5] === 0 && d.feat[7] === 0 && d.distEnemy === null));
});

// ---------- ojos de contexto (observe) ----------
const eyesGenome = () => repair({ format: 1, id: 'ojos-1', name: 'Ojos', imagination: { n: 5 },
  blocks: [B('f', 'eye.features'), B('o', 'eye.obstacles', { slots: 2 }), B('h', 'eye.history', { depth: 2 }), B('r', 'eye.radar', { rays: 8 }), B('k', 'eye.clock'), B('t', 'eye.mates'),
    B('m', 'eye.map', { cell: 5, channels: ['obstacles', 'self'] }), B('c', 'eye.candidates'), B('s', 'eye.simulator'), B('mv', 'eye.moves'),
    B('cat', 'concat'), B('d', 'dense', { units: 4 }), B('cd', 'dense', { units: 3 }), B('ch', 'hand.choose'), B('md', 'dense', { units: 3 }), B('fm', 'foot.move')],
  wires: [W('f', 'cat'), W('o', 'cat'), W('h', 'cat'), W('r', 'cat'), W('k', 'cat'), W('t', 'cat'), W('m', 'cat'), W('cat', 'd'), W('d', 'cd'), W('c', 'cd'), W('s', 'cd'), W('cd', 'ch'), W('mv', 'md'), W('d', 'md'), W('md', 'fm')] }, makeRng(1)).genome;
const segDist = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };

check('observe: dimensiones de todos los ojos, candidatos/destinos en la fase que toca (ceros en la otra)', () => {
  const g = eyesGenome(); const st = scene(); const dims = outDims(g);
  const obsS = P.observe(st, 'me', g, { phase: 'shoot', rng: makeRng(1) });
  for (const b of g.blocks.filter((b) => b.type.startsWith('eye.'))) {
    const { stream, dim } = dims[b.id];
    if (stream === 'ctx') assert.equal(obsS.ctx[b.id].length, dim, b.id);
    else if (stream === 'cand') { assert.equal(obsS.cand[b.id].length, 5); assert.ok(obsS.cand[b.id].every((r) => r.length === dim)); }
    else { assert.equal(obsS.move[b.id].length, 9); assert.ok(obsS.move[b.id].every((r) => r.length === dim)); }
  }
  assert.equal(obsS.candidates.length, 5); assert.equal(obsS.destinations, null);
  assert.ok(obsS.move.mv.every((r) => Array.from(r).every((v) => v === 0)), 'fase shoot: destinos a cero');
  assert.ok(obsS.cand.c.some((r) => Array.from(r).some((v) => v !== 0)));
  const obsM = P.observe(st, 'me', g, { phase: 'move', rng: makeRng(1) });
  assert.equal(obsM.candidates, null); assert.equal(obsM.destinations.length, 9);
  assert.ok(obsM.cand.c.every((r) => Array.from(r).every((v) => v === 0)) && obsM.cand.s.every((r) => Array.from(r).every((v) => v === 0)), 'fase move: candidatos a cero');
  assert.ok(obsM.move.mv.some((r) => Array.from(r).some((v) => v !== 0)));
  assert.equal(obsS.ctx.k[7], 0); assert.equal(obsM.ctx.k[7], 1, 'el reloj lleva la fase');
  const given = P.generateCandidates(st, st.soldiers[0], normalize(g).imagination, makeRng(9));
  const obsG = P.observe(st, 'me', g, { phase: 'shoot', cands: given });
  assert.deepEqual(obsG.candidates, given, 'candidatos ya generados se reutilizan');
  assert.ok(obsS.team && typeof obsS.team === 'object');
});

check('eye.features exacto (26) y espejo para el equipo derecho', () => {
  const g = eyesGenome(); const st = scene(); const me = st.soldiers[0];
  const en = st.soldiers.filter((s) => s.alive && s.team === 'right').sort((a, b) => dist(a, me) - dist(b, me));
  const al = st.soldiers.filter((s) => s.alive && s.team === 'left' && s.id !== 'me').sort((a, b) => dist(a, me) - dist(b, me));
  const exp = [me.x / 25, me.y / 15, 1, 2 / 3, 2 / 4];
  for (const e of en) exp.push((e.x - me.x) / 50, (e.y - me.y) / 30, dist(e, me) / 58, lib.los(me, e, st.obstacles) ? 1 : 0, 1);
  for (const a of al) exp.push((a.x - me.x) / 50, (a.y - me.y) / 30, dist(a, me) / 58, segDist(a, me, en[0]) < C.HIT_RADIUS + 0.5 ? 1 : 0, 1);
  exp.push(2 / 8);
  const f = P.observe(st, 'me', g, { phase: 'shoot' }).ctx.f;
  vecNear(f, exp, 1e-9, 'features');
  assert.equal(f[8], 0, 'e1 tapado por el muro'); assert.equal(f[13], 1, 'e2 a la vista');
  const fr = P.observe(scene({ team: 'right' }), 'me', g, { phase: 'shoot' }).ctx.f;
  vecNear(fr, exp, 1e-9, 'espejo');
  const few = scene(); for (const s of few.soldiers) if (s.id !== 'me' && s.id !== 'e1') s.alive = false;
  const ff = P.observe(few, 'me', g, { phase: 'shoot' }).ctx.f;
  assert.deepEqual(Array.from(ff.slice(10, 25)), new Array(15).fill(0), 'sin segundo enemigo ni aliados: ceros'); assert.equal(ff[3], 0); assert.equal(ff[4], 0.25);
  const inLine = scene(); inLine.obstacles = []; const a1 = inLine.soldiers.find((s) => s.id === 'a1'); a1.x = -2; a1.y = 3; // sobre el segmento me → e1
  assert.equal(P.observe(inLine, 'me', g, { phase: 'shoot' }).ctx.f[18], 1, 'aliado en mi línea de tiro');
});

check('eye.obstacles, eye.history, eye.radar, eye.clock, eye.mates, eye.map exactos', () => {
  const g = eyesGenome(); const st = scene(); const me = st.soldiers[0];
  const o = P.observe(st, 'me', g, { phase: 'shoot' });
  // obstáculos (2 huecos, ordenados por distancia al centro)
  vecNear(o.ctx.o, [-1 / 25, 2.5 / 15, 2 / 10, 5 / 15, 1, 17 / 25, -9 / 15, 4 / 10, 2 / 15, 1, 2 / 8], 1e-9, 'obstacles');
  // historial (depth 2): míos más reciente primero (parábola turno 3, recta turno 1), luego rival (artillería), luego ceros
  const hist = [
    0, 1, 0, 0, 0, 0, Math.tanh(0.2 / 2), Math.tanh(20 * 0.01), 0, 0, 0, 1, 0, 0.35,
    1, 0, 0, 0, 0, 0, Math.tanh(0.3 / 2), 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 1, 0, 0.05 / 0.15, 30 / 85, 0, 0, 1, 0, 0, 1,
    ...new Array(14).fill(0),
  ];
  vecNear(o.ctx.h, hist, 1e-9, 'history');
  // radar (8 rayos): 0° muro a 8 u; 90° borde superior; 180° borde izquierdo; 270° borde inferior
  const r = o.ctx.r;
  assert.ok(near(r[0], 8 / 58) && r[1] === 1, `rayo 0: ${r[0] * 58} tipo ${r[1]}`);
  assert.ok(near(r[4], 13.25 / 58) && r[5] === 0, `rayo 90°: ${r[4] * 58}`);
  assert.ok(near(r[8], 15.25 / 58) && r[9] === 0, `rayo 180°: ${r[8] * 58}`);
  assert.ok(near(r[12], 17.25 / 58) && r[13] === 0, `rayo 270°: ${r[12] * 58}`);
  assert.equal(r.length, 16);
  // reloj
  vecNear(o.ctx.k, [9 / C.MAX_SHOTS, 2 / C.STALL_SHOTS, 1 / 3, 3 / 4, 2 / 4, (2 - 1) / 4, 5 / 20, 0], 1e-9, 'clock');
  // compañeros: a1 (−12,3) y a2 (−8,10); a1 mató y se quedó quieta; a2 sin disparo
  const a1 = st.soldiers.find((s) => s.id === 'a1'), a2 = st.soldiers.find((s) => s.id === 'a2');
  vecNear(o.ctx.t, [2 / 3, ((a1.x - me.x) + (a2.x - me.x)) / 2 / 50, ((a1.y - me.y) + (a2.y - me.y)) / 2 / 30, Math.min(dist(a1, me), dist(a2, me)) / 58, Math.max(dist(a1, me), dist(a2, me)) / 58, 1, 0.5, 0, (0 + 1) / 2, 0.5, 1 / 3, 1], 1e-9, 'mates');
  // mapa celda 5, canales obstacles + self: W=10, H=6; me en col 3 fila 3; muro en col 4 fila 3 cubre 0.5
  const m = o.ctx.m; assert.equal(m.length, 2 * 6 * 10);
  assert.equal(m[60 + 3 * 10 + 3], 1, 'yo en mi celda'); assert.equal(Array.from(m.slice(60)).reduce((a, b) => a + b, 0), 1);
  assert.ok(near(m[3 * 10 + 4], 0.5), `muro: ${m[34]}`);
  assert.ok(near(m[0 * 60 + 1 * 10 + 8], 0.5) || near(m[0 * 60 + 0 * 10 + 8], 0.5) || Array.from(m.slice(0, 60)).filter((v) => v > 0).length >= 2, 'el segundo muro también cubre algo');
  const noAllies = scene(); for (const s of noAllies.soldiers) if (s.team === 'left' && s.id !== 'me') s.alive = false;
  vecNear(P.observe(noAllies, 'me', g, { phase: 'shoot' }).ctx.t, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3 / 3, 0], 1e-9, 'sin compañeros vivos');
});

check('eye.map con estelas (trails) y rejilla 2u; eyeLayout con nombres para cada índice', () => {
  const g = repair({ format: 1, id: 'mapa-1', name: 'Mapa', blocks: [B('m', 'eye.map', { cell: 2, channels: ['obstacles', 'enemies', 'allies', 'self', 'trails'] }), B('v', 'hand.value')], wires: [W('m', 'v')] }, makeRng(1)).genome;
  const st = scene();
  st.shotLog[2].points = [[-10, 2], [-5, 2], [0, 2]]; st.shotLog[0].points = [[-12, 3], [-6, 3]]; st.shotLog[1].points = [[5, 4], [3, 6]];
  const m = P.observe(st, 'me', g, { phase: 'shoot' }).ctx.m;
  const W_ = 25, H_ = 15, cell = (x, y) => Math.floor((y + 15) / 2) * W_ + Math.floor((x + 25) / 2);
  assert.equal(m.length, 5 * H_ * W_);
  assert.equal(m[3 * H_ * W_ + cell(-10, 2)], 1, 'self'); assert.equal(m[1 * H_ * W_ + cell(5, 4)], 1, 'enemigo'); assert.equal(m[1 * H_ * W_ + cell(20, 0)], 0, 'enemigo muerto no');
  assert.equal(m[2 * H_ * W_ + cell(-12, 3)], 1, 'aliado'); assert.equal(m[2 * H_ * W_ + cell(-10, 2)], 0, 'yo no cuento como aliado');
  assert.equal(m[4 * H_ * W_ + cell(-5, 2)], 1, 'estela del último tiro de mi equipo = 1');
  assert.equal(m[4 * H_ * W_ + cell(-6, 3)], 0.5, 'estela del anterior = 0.5');
  assert.equal(m[4 * H_ * W_ + cell(3, 6)], 1, 'último tiro del rival = 1');
  assert.equal(m[0 * H_ * W_ + cell(-0.5, 2)], 0.5, 'celda [−1,1)×[1,3): la mitad izquierda está dentro del muro');
  assert.equal(m[0 * H_ * W_ + cell(-1.5, 2)], 0.5, 'celda [−3,−1): la mitad derecha');
  assert.equal(m[0 * H_ * W_ + cell(-1.5, 5.5)], 0, 'fila [5,7): fuera (el muro llega a y = 5)');
  for (const b of g.blocks.concat(eyesGenome().blocks).filter((b) => b.type.startsWith('eye.'))) {
    const lay = P.eyeLayout(normalize({ id: 'x', blocks: [b], wires: [] }).blocks[0]);
    const dim = outDims(repair({ format: 1, id: 'l-1', name: 'l', imagination: { n: 5 }, blocks: [b, B('hv', b.type.startsWith('eye.candidates') || b.type === 'eye.simulator' ? 'hand.choose' : b.type === 'eye.moves' ? 'foot.move' : 'hand.value')], wires: [W(b.id, 'hv')] }, makeRng(1)).genome)[b.id].dim;
    assert.equal(lay.length, dim, b.type);
    lay.forEach((e, i) => assert.ok(e.index === i && typeof e.name === 'string' && e.name.length > 2, `${b.type}[${i}]`));
  }
  assert.equal(P.eyeLayout(B('f', 'eye.features'))[0].name, 'mi x');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (percepción F3)');
process.exit(fails ? 1 : 0);
