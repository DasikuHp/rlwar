// Percepción (spec/03): marco local del soldado, 🎲 Imaginación, ajuste, los 8 ojos, destinos.
// Puro: sin I/O. Toda aleatoriedad viene del `rng` recibido.
import { PLANE, HIT_RADIUS, MAX_SHOTS, STALL_SHOTS, BODY, MOVE_RADIUS, MOVE_DIRS } from './constants.js';
import { tryCompile } from './parser.js';
import { simulateShot } from './solver.js';
import { slideMove, los, isSolid } from './geometry.js';
import { normalize, eyeDim, BLOCKS } from './genome.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DIAG = 58; // diagonal del plano (≈ 58.3), normalización de distancias

// ---------- marco local ----------
export const toLocal = (p, team) => (team === 'right' ? { x: -p.x, y: p.y } : { x: p.x, y: p.y });
export const toWorld = toLocal;
export const worldToLocalSlope = (a, team) => (team === 'right' ? -a : a);
// obstáculo en el marco local: un círculo solo se refleja; un rectángulo, como siempre
const localRect = (o, team) => (o.kind === 'circle' ? { ...o, x: team === 'right' ? -o.x : o.x } : team === 'right' ? { x: -(o.x + o.w), y: o.y, w: o.w, h: o.h } : { ...o });
const terrainOfState = (state) => ({ obstacles: state.obstacles || [], bites: state.bites || [] });

// sustitución textual de variables: x → (-x); en ode2 además y' → (-(y'))
function substitute(expr, mode) {
  let out = '', i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/[A-Za-z]/.test(c)) {
      let j = i; while (j < expr.length && /[A-Za-z]/.test(expr[j])) j++;
      const id = expr.slice(i, j).toLowerCase();
      let primes = 0; while (expr[j] === "'") { primes++; j++; }
      const raw = expr.slice(i, j);
      if (id === 'x' && primes === 0) out += '(-x)';
      else if (mode === 'ode2' && id === 'y' && primes === 1) out += "(-(y'))";
      else out += raw;
      i = j;
    } else { out += c; i++; }
  }
  return out;
}
export function localToWorldExpr(exprLocal, mode, team) {
  if (team !== 'right') return exprLocal;
  const s = substitute(exprLocal, mode);
  return mode === 'ode1' ? `-(${s})` : s;
}

// ---------- familias ----------
export const FAMILY_ORDER = ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild'];
export const WILD_TEMPLATES = [
  (a, k) => `${a}*tan(x/${k})`,
  (a, k) => `${a}*sin(x*${k})`,
  (a, k) => `${a}*exp(-abs(x)/${k})`,
  (a, k) => `${a}*x^3/${k * k}`,
  (a, k) => `${a}*(x/${k})^2*sin(x/${k})`,
  (a, k) => `${a}*sqrt(abs(x))*sin(x/${k})`,
  (a, k) => `${a}*ln(abs(x)+1)*cos(x/${k})`,
];
const LINE_RE = /^(-?\d+(?:\.\d+)?)\*x$/;

export function familyOf({ mode, expr, angle = 0, team = 'left' }) {
  if (mode === 'ode1') return { family: 'ode1', params: [0, 0, 0] };
  if (mode === 'ode2') { const g = Number(expr); return { family: 'artillery', params: [Number.isFinite(g) ? -g : 0, Number(angle) || 0, 0] }; }
  const m = LINE_RE.exec(String(expr).trim());
  if (m) return { family: 'line', params: [worldToLocalSlope(Number(m[1]), team), 0, 0] };
  return { family: 'wild', params: [0, 0, 0] };
}

// expresión local a partir de familia y params
export function buildExpr(family, params) {
  const [p1, p2, p3] = params;
  switch (family) {
    case 'line': return { mode: 'function', exprLocal: `${p1.toFixed(5)}*x`, angle: null };
    case 'parabola': return { mode: 'function', exprLocal: `${p1.toFixed(5)}*x+${p2.toFixed(5)}*x^2`, angle: null };
    case 'sine': return { mode: 'function', exprLocal: `${p1.toFixed(5)}*x+${p2.toFixed(3)}*sin(x/${p3.toFixed(3)})`, angle: null };
    case 'ode1': return { mode: 'ode1', exprLocal: `${p1.toFixed(3)}*sin(x/${p2.toFixed(3)})+${p3.toFixed(3)}`, angle: null };
    case 'artillery': return { mode: 'ode2', exprLocal: `-${p1.toFixed(4)}`, angle: Math.round(p2) };
    default: return { mode: 'function', exprLocal: WILD_TEMPLATES[p3 | 0](p1.toFixed(3), p2.toFixed(2)), angle: null };
  }
}
function makeCand(i, family, params, team) {
  const b = buildExpr(family, params);
  return { i, family, params, mode: b.mode, exprLocal: b.exprLocal, expr: localToWorldExpr(b.exprLocal, b.mode, team), angle: b.angle, team };
}
const NORM = {
  line: (p) => [Math.tanh(p[0] / 2), 0, 0],
  parabola: (p) => [Math.tanh(p[0] / 2), Math.tanh(20 * p[1]), 0],
  sine: (p) => [Math.tanh(p[0] / 2), p[1] / 6, p[2] / 12],
  ode1: (p) => [p[0] / 3, p[1] / 12, p[2] / 3],
  artillery: (p) => [p[0] / 0.15, p[1] / 85, 0],
  wild: (p) => [p[0] / 8, p[1] / 20, p[2] / 6],
};

// ---------- objetivos y contexto local ----------
function localCtx(state, soldier) {
  const team = soldier.team;
  const me = toLocal(soldier, team);
  const alive = state.soldiers.filter((s) => s.alive);
  const enemies = alive.filter((s) => s.team !== team).map((s) => ({ ...s, l: toLocal(s, team) })).sort((a, b) => dist(a.l, me) - dist(b.l, me));
  const allies = alive.filter((s) => s.team === team && s.id !== soldier.id).map((s) => ({ ...s, l: toLocal(s, team) })).sort((a, b) => dist(a.l, me) - dist(b.l, me));
  return { team, me, enemies, allies, obstaclesL: state.obstacles.map((o) => localRect(o, team)) };
}
function targetsFor(lc, imagination) {
  const t = lc.enemies.length ? lc.enemies.map((e) => e.l) : [{ x: lc.me.x + 20, y: lc.me.y }];
  return imagination.targets === 'nearest' ? t.slice(0, 1) : t;
}

// ---------- 🎲 Imaginación ----------
function quotas(n, families) {
  const active = FAMILY_ORDER.filter((f) => families[f] && families[f].on && families[f].weight > 0);
  const total = active.reduce((s, f) => s + families[f].weight, 0);
  const q = Object.fromEntries(FAMILY_ORDER.map((f) => [f, 0]));
  if (!active.length || total <= 0) return q;
  const frac = [];
  let used = 0;
  for (const f of active) { const exact = n * families[f].weight / total; q[f] = Math.floor(exact); used += q[f]; frac.push([f, exact - q[f]]); }
  frac.sort((a, b) => b[1] - a[1] || FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]));
  for (let k = 0; k < n - used; k++) q[frac[k % frac.length][0]]++;
  return q;
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function gridFor(family, F, targets, me) {
  const slopes = targets.map((t) => (t.y - me.y) / (t.x - me.x));
  const out = [];
  if (family === 'line') for (const j of F.jitter) for (const s0 of slopes) out.push([s0 * (1 + j), 0, 0]);
  else if (family === 'parabola') for (const k of F.curvatures) for (const s0 of slopes) out.push([s0, k, 0]);
  else if (family === 'sine') for (const A of F.amps) for (const T of F.periods) for (const s0 of slopes) out.push([s0, A, T]);
  else if (family === 'ode1') for (const a of F.a) for (const k of F.k) for (const b of F.b) out.push([a, k, b]);
  else if (family === 'artillery') for (const g of F.gravities) for (const ang of F.angles) out.push([g, ang, 0]);
  else for (let idx = 0; idx < WILD_TEMPLATES.length; idx++) for (const a of F.a) for (const k of F.k) out.push([a, k, idx]);
  return out;
}
export function generateCandidates(state, soldier, imagination, rng = Math.random) {
  const lc = localCtx(state, soldier);
  const targets = targetsFor(lc, imagination);
  const q = quotas(imagination.n, imagination.families);
  const out = [];
  for (const family of FAMILY_ORDER) {
    const count = q[family];
    if (!count) continue;
    const grid = shuffle(gridFor(family, imagination.families[family], targets, lc.me), rng);
    if (family === 'line') { // la recta exacta al objetivo más cercano va siempre la primera
      const s0 = (targets[0].y - lc.me.y) / (targets[0].x - lc.me.x);
      const k = grid.findIndex((g) => g[0] === s0);
      if (k > 0) { const [exact] = grid.splice(k, 1); grid.unshift(exact); }
    }
    for (let k = 0; k < count; k++) {
      let params = grid[k % grid.length].slice();
      if (k >= grid.length) {
        params[0] += (rng() * 2 - 1) * 0.05;
        if (family === 'artillery') params[0] = clamp(params[0], 0.005, 0.3);
      }
      out.push(makeCand(out.length, family, params, lc.team));
    }
  }
  return out;
}

// ---------- ✏ Ajustar ----------
const SCALES = {
  line: (p) => [0.03 * (1 + Math.abs(p[0])), 0, 0],
  parabola: (p) => [0.03 * (1 + Math.abs(p[0])), 0.003, 0],
  sine: (p) => [0.03 * (1 + Math.abs(p[0])), 0.3, 0.5],
  ode1: () => [0.2, 0.5, 0.2],
  artillery: () => [0.005, 3, 0],
  wild: () => [0.3, 1, 0],
};
export function adjustScales(cand) { return SCALES[cand.family](cand.params); }
export function applyAdjust(cand, sample) {
  const sc = adjustScales(cand);
  const params = cand.params.map((p, i) => p + sc[i] * clamp(Number(sample[i]) || 0, -3, 3));
  if (cand.family === 'artillery') { params[0] = clamp(params[0], 0.005, 0.3); params[1] = clamp(Math.round(params[1]), -85, 85); }
  if (cand.family === 'wild') params[2] = cand.params[2];
  return makeCand(cand.i, cand.family, params, cand.team);
}

// ---------- rasgos de candidatos y simulador ----------
function ctxLocal(ctx) { // ctx de agents/lib (contextFor) + team → marco local
  const team = ctx.team || ctx.soldier.team;
  const me = toLocal(ctx.soldier, team);
  const enemies = ctx.soldiers.filter((s) => s.alive && s.team !== team).map((s) => ({ ...s, l: toLocal(s, team) })).sort((a, b) => dist(a.l, me) - dist(b.l, me));
  return { team, me, enemies };
}
export function candidateFeatures(cand, ctx) {
  const { me, enemies } = ctxLocal(ctx);
  const oh = FAMILY_ORDER.map((f) => (f === cand.family ? 1 : 0));
  const n = NORM[cand.family](cand.params);
  const isOde = cand.mode !== 'function';
  const err = (e) => {
    if (!e || isOde) return 0;
    const r = tryCompile(cand.exprLocal); if (!r.ok) return 0;
    let v; try { v = r.f(e.l.x) - r.f(me.x) + me.y - e.l.y; } catch { v = NaN; }
    return Number.isFinite(v) ? Math.tanh(v / 3) : 0;
  };
  return Float64Array.from([...oh, n[0], n[1], n[2], err(enemies[0]), err(enemies[1]), isOde ? 1 : 0]);
}
function polyline(points, team) {
  const out = [];
  let last = null;
  for (const [x, y] of points) {
    const p = toLocal({ x, y }, team);
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.5) { out.push([p.x, p.y]); last = p; }
  }
  const end = toLocal({ x: points[points.length - 1][0], y: points[points.length - 1][1] }, team);
  if (!out.length || out[out.length - 1][0] !== end.x || out[out.length - 1][1] !== end.y) out.push([end.x, end.y]);
  if (out.length < 2) out.push([end.x, end.y]);
  if (out.length > 100) { const k = []; for (let i = 0; i < 100; i++) k.push(out[Math.round(i * (out.length - 1) / 99)]); return k; }
  return out;
}
export function simulateCandidate(cand, ctx, fine = false) {
  const team = ctx.team || ctx.soldier.team;
  const r = tryCompile(cand.expr);
  const start = { x: ctx.soldier.x, y: ctx.soldier.y };
  if (!r.ok) return { type: 'invalid', end: 'invalid', minDist: 30, endX: toLocal(start, team).x, endY: start.y, points: 1, victimId: null, hitIds: [], enemiesHit: 0, alliesHit: 0, polyline: [[toLocal(start, team).x, start.y], [toLocal(start, team).x, start.y]] };
  const shot = simulateShot({ mode: cand.mode, f: r.f, start, dir: team === 'right' ? -1 : 1, angle: (cand.angle || 0) * Math.PI / 180,
    soldiers: ctx.soldiers, obstacles: ctx.obstacles, bites: ctx.bites || [], shooterId: ctx.soldier.id, ds: fine ? 0.01 : 0.05, maxSteps: fine ? 20000 : 2500 });
  // con impactos, lo que ve la red llega hasta el primero (dónde golpea primero y lo cerca que pasó hasta ahí), como cuando
  // el tiro se paraba en él (spec/01 §10.5); el dibujo sigue el recorrido entero
  const hits = shot.result.hits || [];
  const fh = shot.result.firstHit;
  const seen = fh ? [...shot.points.slice(0, fh.points - 1), [fh.x, fh.y]] : shot.points;
  const enemies = ctx.soldiers.filter((s) => s.alive && s.team !== team);
  let minDist = 30;
  for (const e of enemies) for (const [px, py] of seen) { const d = Math.hypot(e.x - px, e.y - py); if (d < minDist) minDist = d; }
  const end = toLocal(fh ? { x: fh.x, y: fh.y } : { x: shot.result.x, y: shot.result.y }, team);
  return { type: shot.result.type, end: shot.result.end, minDist, endX: end.x, endY: end.y, points: fh ? fh.points : shot.points.length, victimId: shot.result.soldierId ?? null,
    hitIds: hits.map((h) => h.soldierId), enemiesHit: hits.filter((h) => h.team !== team).length, alliesHit: hits.filter((h) => h.team === team).length, polyline: polyline(shot.points, team) };
}
// "mata" y "fuego amigo" = a cuántos enemigos y a cuántos aliados alcanza (como mucho 4); con un solo impacto valen 1,
// lo mismo que antes del tiro que atraviesa (spec/01 §10.5)
export function simulatorFeatures(sim, ctx) {
  const { enemies } = ctxLocal(ctx);
  const hitE = sim.enemiesHit, hitA = sim.alliesHit, end = sim.end, noHit = !hitE && !hitA;
  const nearest = !!enemies[0] && sim.hitIds.includes(enemies[0].id);
  return Float64Array.from([Math.min(4, hitE), Math.min(4, hitA), noHit && end === 'obstacle' ? 1 : 0, noHit && end === 'wall' ? 1 : 0,
    noHit && !['obstacle', 'wall'].includes(end) ? 1 : 0, Math.min(1, sim.minDist / 10), sim.endX / 25, sim.endY / 15, Math.min(1, sim.points / 200),
    nearest ? 1 : 0]);
}

// ---------- destinos de movimiento ----------
export function moveDestinations(state, soldier) {
  const lc = localCtx(state, soldier);
  const from = { x: soldier.x, y: soldier.y };
  const enemiesW = lc.enemies, e1 = enemiesW[0] || null;
  const d0 = e1 ? dist(from, e1) : 0;
  const out = [];
  for (let i = 0; i <= MOVE_DIRS; i++) {
    let to, slid;
    if (i === 0) { to = { ...from }; slid = false; }
    else {
      const th = (i - 1) * (2 * Math.PI / MOVE_DIRS);
      const reqL = { x: lc.me.x + MOVE_RADIUS * Math.cos(th), y: lc.me.y + MOVE_RADIUS * Math.sin(th) };
      const r = slideMove({ from, requested: toWorld(reqL, lc.team), soldiers: state.soldiers, obstacles: state.obstacles, bites: state.bites || [], selfId: soldier.id });
      to = r.to; slid = r.slid;
    }
    let cover = 0, distEnemy = null, nearest = null;
    const terrain = terrainOfState(state);
    for (const e of enemiesW) { const d = dist(to, e); if (distEnemy === null || d < distEnemy) { distEnemy = d; nearest = e; } if (los(to, e, terrain)) cover++; }
    const seen = nearest ? los(to, nearest, terrain) : false;
    const tl = toLocal(to, lc.team);
    const allyD = lc.allies.length ? Math.min(...lc.allies.map((a) => dist(to, a))) : null;
    const adjacent = isSolid(to, terrain, BODY + 1);
    const feat = Float64Array.from([(tl.x - lc.me.x) / 2, (tl.y - lc.me.y) / 2, i === 0 ? 1 : 0, slid ? 1 : 0, cover / 4,
      e1 ? (dist(to, e1) - d0) / 2 : 0, allyD === null ? 1 : Math.min(1, allyD / 10), e1 ? (los(to, e1, terrain) ? 1 : 0) : 0, adjacent ? 1 : 0]);
    out.push({ i, to, stay: i === 0, slid, cover, distEnemy, los: seen, feat });
  }
  return out;
}

// ---------- ojos de contexto ----------
const segDist = (p, a, b) => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
};
const RESULTS = ['kill', 'suicide', 'obstacle', 'wall'];
const resultOneHot = (t) => RESULTS.map((r) => (r === t ? 1 : 0)).concat([RESULTS.includes(t) ? 0 : 1]);

function eyeFeatures(state, soldier, lc) {
  const f = [lc.me.x / 25, lc.me.y / 15, 1, lc.allies.length / 3, lc.enemies.length / 4];
  for (let i = 0; i < 2; i++) {
    const e = lc.enemies[i];
    if (e) f.push((e.l.x - lc.me.x) / 50, (e.l.y - lc.me.y) / 30, dist(e.l, lc.me) / DIAG, los(soldier, e, terrainOfState(state)) ? 1 : 0, 1);
    else f.push(0, 0, 0, 0, 0);
  }
  const e1 = lc.enemies[0];
  for (let i = 0; i < 2; i++) {
    const a = lc.allies[i];
    if (a) f.push((a.l.x - lc.me.x) / 50, (a.l.y - lc.me.y) / 30, dist(a.l, lc.me) / DIAG, e1 && segDist(a, soldier, e1) < HIT_RADIUS + 0.5 ? 1 : 0, 1);
    else f.push(0, 0, 0, 0, 0);
  }
  f.push(state.obstacles.length / 8);
  return Float64Array.from(f);
}
function eyeObstacles(state, lc, slots) {
  // un círculo se ve por su caja (spec/01 §10.5): mismo tamaño de entrada que un rectángulo
  const rects = lc.obstaclesL.map((o) => (o.kind === 'circle' ? { cx: o.x, cy: o.y, w: 2 * o.r, h: 2 * o.r } : { cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h })).sort((a, b) => dist({ x: a.cx, y: a.cy }, lc.me) - dist({ x: b.cx, y: b.cy }, lc.me));
  const f = [];
  for (let i = 0; i < slots; i++) { const o = rects[i]; if (o) f.push(o.cx / 25, o.cy / 15, o.w / 10, o.h / 15, 1); else f.push(0, 0, 0, 0, 0); }
  f.push(state.obstacles.length / 8);
  return Float64Array.from(f);
}
const shotVector = (s) => {
  if (!s) return new Array(14).fill(0);
  const fam = FAMILY_ORDER.includes(s.family) ? s.family : 'wild';
  const n = NORM[fam](s.params || [0, 0, 0]);
  return [...FAMILY_ORDER.map((f) => (f === fam ? 1 : 0)), n[0], n[1], ...resultOneHot(s.result && s.result.type), Math.min(1, (s.minDist ?? 30) / 10)];
};
function eyeHistory(state, soldier, depth) {
  const log = state.shotLog || [];
  const mine = log.filter((s) => s.playerId === soldier.ownerId).reverse();
  const theirs = log.filter((s) => s.team !== soldier.team).reverse();
  const f = [];
  for (let i = 0; i < depth; i++) f.push(...shotVector(mine[i]));
  for (let i = 0; i < depth; i++) f.push(...shotVector(theirs[i]));
  return Float64Array.from(f);
}
function eyeRadar(state, soldier, lc, rays) {
  const f = [];
  const terrain = terrainOfState(state);
  for (let k = 0; k < rays; k++) {
    const th = k * 2 * Math.PI / rays;
    const dirL = { x: Math.cos(th), y: Math.sin(th) };
    const dirW = toWorld(dirL, lc.team);
    let d = 0, type = 0;
    for (let s = 1; s < 400; s++) {
      const p = { x: soldier.x + s * 0.25 * dirW.x, y: soldier.y + s * 0.25 * dirW.y };
      if (isSolid(p, terrain, 0)) { d = s * 0.25; type = 1; break; }
      if (p.x < PLANE.xMin || p.x > PLANE.xMax || p.y < PLANE.yMin || p.y > PLANE.yMax) { d = s * 0.25; type = 0; break; }
    }
    f.push(d / DIAG, type);
  }
  return Float64Array.from(f);
}
function eyeClock(state, soldier, lc, phase) {
  const st = state.stats || { shots: 0, shotsNoKill: 0, remaps: 0 };
  const myPlayer = (state.players || []).find((p) => p.id === soldier.ownerId) || { kills: 0 };
  const enemyKills = (state.players || []).filter((p) => p.team !== soldier.team).reduce((s, p) => s + (p.kills || 0), 0);
  const myAlive = state.soldiers.filter((s) => s.alive && s.ownerId === soldier.ownerId).length;
  return Float64Array.from([st.shots / MAX_SHOTS, Math.min(1, st.shotsNoKill / STALL_SHOTS), Math.min(1, st.remaps / 3), myAlive / 4, lc.enemies.length / 4,
    ((myPlayer.kills || 0) - enemyKills) / 4, Math.min(1, (soldier.turns || 0) / 20), phase === 'move' ? 1 : 0]);
}
function eyeMates(state, soldier, lc) {
  const allies = lc.allies;
  const dead = state.soldiers.filter((s) => !s.alive && s.team === soldier.team && s.id !== soldier.id).length;
  if (!allies.length) return Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, dead / 3, 0]);
  const log = state.shotLog || [];
  const lastOf = (id) => { for (let i = log.length - 1; i >= 0; i--) if (log[i].soldierId === id) return log[i]; return null; };
  const n = allies.length;
  let dx = 0, dy = 0, minD = Infinity, maxD = -Infinity, fLos = 0, fKill = 0, fFF = 0, mMin = 0, fStay = 0;
  for (const a of allies) {
    dx += a.l.x - lc.me.x; dy += a.l.y - lc.me.y;
    const d = dist(a.l, lc.me); minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    if (lc.enemies.some((e) => los(a, e, terrainOfState(state)))) fLos++;
    const s = lastOf(a.id);
    if (s) {
      // el tiro atraviesa: cuentan sus bajas (un tiro puede matar a un enemigo y a un aliado); los antiguos, su tipo
      const r = s.result || {};
      if (Number.isInteger(r.kills) ? r.kills > 0 : r.type === 'kill') fKill++;
      if (Number.isInteger(r.friendly) ? r.friendly > 0 : r.type === 'suicide') fFF++;
      mMin += Math.min(1, (s.minDist ?? 30) / 10); if (s.stayed) fStay++;
    }
    else mMin += 1;
  }
  return Float64Array.from([n / 3, dx / n / 50, dy / n / 30, minD / DIAG, maxD / DIAG, fLos / n, fKill / n, fFF / n, mMin / n, fStay / n, dead / 3, 1]);
}
function eyeMap(state, soldier, lc, params) {
  const cell = params.cell, Wc = Math.round(50 / cell), Hc = Math.round(30 / cell);
  const chans = params.channels;
  const grid = new Float64Array(chans.length * Hc * Wc);
  const idx = (c, x, y) => { const col = clamp(Math.floor((x - PLANE.xMin) / cell), 0, Wc - 1), row = clamp(Math.floor((y - PLANE.yMin) / cell), 0, Hc - 1); return c * Hc * Wc + row * Wc + col; };
  chans.forEach((ch, c) => {
    if (ch === 'obstacles') {
      for (let row = 0; row < Hc; row++) for (let col = 0; col < Wc; col++) {
        let inside = 0;
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
          const x = PLANE.xMin + (col + (a + 0.5) / 4) * cell, y = PLANE.yMin + (row + (b + 0.5) / 4) * cell;
          if (isSolid(toWorld({ x, y }, lc.team), terrainOfState(state), 0)) inside++;
        }
        grid[c * Hc * Wc + row * Wc + col] = inside / 16;
      }
    } else if (ch === 'enemies') for (const e of lc.enemies) grid[idx(c, e.l.x, e.l.y)] = 1;
    else if (ch === 'allies') for (const a of lc.allies) grid[idx(c, a.l.x, a.l.y)] = 1;
    else if (ch === 'self') grid[idx(c, lc.me.x, lc.me.y)] = 1;
    else if (ch === 'trails') {
      const log = state.shotLog || [];
      for (const team of [soldier.team, soldier.team === 'left' ? 'right' : 'left']) {
        const shots = log.filter((s) => s.team === team && Array.isArray(s.points)).slice(-2).reverse();
        shots.forEach((s, k) => { const v = k === 0 ? 1 : 0.5; for (const [x, y] of s.points) { const p = toLocal({ x, y }, lc.team); const i = idx(c, p.x, p.y); grid[i] = Math.max(grid[i], v); } });
      }
    }
  });
  return grid;
}

// ---------- observación ----------
export function observe(state, soldierId, genome, opts = {}) {
  return observeNormalized(state, soldierId, normalize(genome), opts);
}
// igual, con el genoma ya normalizado (quien decide ya lo normalizó: una copia del genoma menos por decisión); no lo toca
export function observeNormalized(state, soldierId, g, { phase = 'shoot', cands = null, moves = null, sims = null, rng = Math.random } = {}) {
  const soldier = state.soldiers.find((s) => s.id === soldierId);
  if (!soldier) throw new Error(`soldado ${soldierId} no está en el estado`);
  const lc = localCtx(state, soldier);
  const ctx = { soldiers: state.soldiers, obstacles: state.obstacles, bites: state.bites || [], soldier, enemies: state.soldiers.filter((s) => s.alive && s.team !== soldier.team), dir: soldier.team === 'left' ? 1 : -1, team: soldier.team };
  const N = g.imagination.n;
  const obs = { ctx: {}, cand: {}, move: {}, team: {}, candidates: null, destinations: null, sims: null };
  const eyes = g.blocks.filter((b) => b.type.startsWith('eye.'));
  const needCand = phase === 'shoot' && eyes.some((b) => b.type === 'eye.candidates' || b.type === 'eye.simulator');
  const needSim = phase === 'shoot' && eyes.some((b) => b.type === 'eye.simulator');
  if (phase === 'shoot') obs.candidates = cands || (needCand ? generateCandidates(state, soldier, g.imagination, rng) : null);
  if (needSim) obs.sims = sims || obs.candidates.map((c) => simulateCandidate(c, ctx, eyes.some((b) => b.type === 'eye.simulator' && b.params.fine)));
  if (phase === 'move') obs.destinations = moves || moveDestinations(state, soldier);
  for (const b of eyes) {
    const dim = eyeDim(b, g);
    switch (b.type) {
      case 'eye.features': obs.ctx[b.id] = eyeFeatures(state, soldier, lc); break;
      case 'eye.obstacles': obs.ctx[b.id] = eyeObstacles(state, lc, b.params.slots); break;
      case 'eye.history': obs.ctx[b.id] = eyeHistory(state, soldier, b.params.depth); break;
      case 'eye.radar': obs.ctx[b.id] = eyeRadar(state, soldier, lc, b.params.rays); break;
      case 'eye.clock': obs.ctx[b.id] = eyeClock(state, soldier, lc, phase); break;
      case 'eye.mates': obs.ctx[b.id] = eyeMates(state, soldier, lc); break;
      case 'eye.map': obs.ctx[b.id] = eyeMap(state, soldier, lc, b.params); break;
      case 'eye.candidates': obs.cand[b.id] = obs.candidates ? obs.candidates.map((c) => candidateFeatures(c, ctx)) : Array.from({ length: N }, () => new Float64Array(dim)); break;
      case 'eye.simulator': obs.cand[b.id] = obs.sims ? obs.sims.map((s) => simulatorFeatures(s, ctx)) : Array.from({ length: N }, () => new Float64Array(dim)); break;
      case 'eye.moves': obs.move[b.id] = obs.destinations ? obs.destinations.map((d) => d.feat) : Array.from({ length: 9 }, () => new Float64Array(dim)); break;
      default: break;
    }
  }
  return obs;
}

// ---------- nombres de cada índice (catálogo) ----------
export function eyeLayout(block) {
  const p = { ...Object.fromEntries((BLOCKS[block.type]?.params || []).map((q) => [q.key, q.default])), ...(block.params || {}) };
  const names = [];
  const push = (...n) => names.push(...n);
  switch (block.type) {
    case 'eye.features':
      push('mi x', 'mi y', 'sesgo (1)', 'aliados vivos', 'enemigos vivos');
      for (const k of [1, 2]) push(`enemigo ${k}: distancia en x`, `enemigo ${k}: distancia en y`, `enemigo ${k}: distancia`, `enemigo ${k}: línea de tiro`, `enemigo ${k}: presente`);
      for (const k of [1, 2]) push(`aliado ${k}: distancia en x`, `aliado ${k}: distancia en y`, `aliado ${k}: distancia`, `aliado ${k}: en mi línea de tiro`, `aliado ${k}: presente`);
      push('número de obstáculos'); break;
    case 'eye.obstacles':
      for (let k = 1; k <= p.slots; k++) push(`muro ${k}: centro x`, `muro ${k}: centro y`, `muro ${k}: ancho`, `muro ${k}: alto`, `muro ${k}: presente`);
      push('número de obstáculos'); break;
    case 'eye.history':
      for (const who of ['mi tiro', 'tiro rival']) for (let k = 1; k <= p.depth; k++) {
        for (const f of ['recta', 'parábola', 'seno', 'EDO', 'artillería', 'salvaje']) push(`${who} ${k}: familia ${f}`);
        push(`${who} ${k}: parámetro 1`, `${who} ${k}: parámetro 2`);
        for (const r of ['mató', 'fuego amigo', 'chocó con muro', 'chocó con borde', 'otro final']) push(`${who} ${k}: ${r}`);
        push(`${who} ${k}: distancia mínima al enemigo`);
      }
      break;
    case 'eye.radar': for (let k = 0; k < p.rays; k++) push(`bigote ${Math.round(k * 360 / p.rays)}°: distancia`, `bigote ${Math.round(k * 360 / p.rays)}°: es muro`); break;
    case 'eye.clock': push('disparos de la partida', 'disparos sin bajas', 'mapas renovados', 'mis soldados vivos', 'enemigos vivos', 'diferencia de bajas', 'mis turnos', 'fase (0 disparar, 1 mover)'); break;
    case 'eye.mates': push('compañeros vivos', 'compañeros: media x', 'compañeros: media y', 'compañero más cercano', 'compañero más lejano', 'compañeros con línea de tiro', 'compañeros que mataron', 'compañeros con fuego amigo', 'compañeros: distancia mínima del último tiro', 'compañeros que se quedaron quietos', 'compañeros muertos', 'hay compañeros'); break;
    case 'eye.candidates': push('familia recta', 'familia parábola', 'familia seno', 'familia EDO', 'familia artillería', 'familia salvaje', 'parámetro 1', 'parámetro 2', 'parámetro 3', 'error al enemigo 1', 'error al enemigo 2', 'es una EDO'); break;
    case 'eye.simulator': push('enemigos que mata', 'aliados que mata', 'choca con muro', 'choca con borde', 'otro final', 'distancia mínima al enemigo', 'x final', 'y final', 'longitud del tiro', 'mata al enemigo 1'); break;
    case 'eye.moves': push('desplazamiento x', 'desplazamiento y', 'es quedarse', 'deslizado', 'enemigos que me verían', 'me alejo del enemigo 1', 'distancia al aliado más cercano', 'línea de tiro al enemigo 1', 'pegado a un muro'); break;
    case 'eye.map': {
      const Wc = Math.round(50 / p.cell), Hc = Math.round(30 / p.cell);
      const chName = { obstacles: 'muros', enemies: 'enemigos', allies: 'aliados', self: 'yo', trails: 'estelas' };
      for (const ch of p.channels) for (let row = 0; row < Hc; row++) for (let col = 0; col < Wc; col++) push(`mapa ${chName[ch]}: celda fila ${row} columna ${col}`);
      break;
    }
    default: break;
  }
  return names.map((name, index) => ({ index, name }));
}
