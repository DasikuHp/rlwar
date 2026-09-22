// Geometría del movimiento (spec/01 §3): validez de un destino y deslizamiento al punto válido
// más cercano. Pura: sin estado, sin aleatoriedad, nunca lanza.
import { PLANE, MOVE_RADIUS, BODY, MIN_SEPARATION, SLIDE_R_STEP, SLIDE_DEG_STEP } from './constants.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ¿P está dentro del rect ampliado en `pad`? (bordes incluidos)
export function insideExpanded(P, o, pad = BODY) {
  return !(P.x < o.x - pad || P.x > o.x + o.w + pad || P.y < o.y - pad || P.y > o.y + o.h + pad);
}

// El segmento from→P no atraviesa ningún rect ampliado (muestreo t = 0.1 … 1.0)
export function segmentClear(from, P, obstacles, pad = BODY) {
  for (let k = 1; k <= 10; k++) {
    const t = k / 10;
    const Q = { x: from.x + (P.x - from.x) * t, y: from.y + (P.y - from.y) * t };
    for (const o of obstacles) if (insideExpanded(Q, o, pad)) return false;
  }
  return true;
}

// Las 5 reglas de validez de spec/01 §3
export function isValidMove(P, { from, soldiers = [], obstacles = [], selfId = null, plane = PLANE }) {
  if (dist(P, from) > MOVE_RADIUS + 1e-9) return false;
  if (P.x < plane.xMin + BODY || P.x > plane.xMax - BODY || P.y < plane.yMin + BODY || P.y > plane.yMax - BODY) return false;
  for (const o of obstacles) if (insideExpanded(P, o)) return false;
  for (const s of soldiers) {
    if (s.id === selfId || !s.alive) continue;
    if (dist(P, s) < MIN_SEPARATION) return false;
  }
  return segmentClear(from, P, obstacles);
}

// Devuelve {to, slid, stayed, reason}. `requested` = {x,y} | 'stay' | null | cualquier cosa.
export function slideMove({ from, requested, soldiers = [], obstacles = [], selfId = null, plane = PLANE }) {
  const stay = (reason, slid = false) => ({ to: { x: from.x, y: from.y }, slid, stayed: true, reason });
  if (requested === 'stay' || requested === null || requested === undefined) return stay('stay');
  if (typeof requested !== 'object' || !isNum(requested.x) || !isNum(requested.y)) return stay('invalid');
  let T = { x: requested.x, y: requested.y };
  const d = dist(T, from);
  if (d > MOVE_RADIUS) T = { x: from.x + (T.x - from.x) * MOVE_RADIUS / d, y: from.y + (T.y - from.y) * MOVE_RADIUS / d };
  const ctx = { from, soldiers, obstacles, selfId, plane };
  if (isValidMove(T, ctx)) return { to: T, slid: false, stayed: false, reason: 'ok' };

  // rejilla polar: r creciente, θ creciente; gana la menor distancia a T (empates: primero encontrado)
  let best = null, bestD = Infinity;
  const nr = Math.round(MOVE_RADIUS / SLIDE_R_STEP), na = Math.round(360 / SLIDE_DEG_STEP);
  for (let i = 1; i <= nr; i++) {
    const r = i * SLIDE_R_STEP;
    for (let k = 0; k < na; k++) {
      const th = k * SLIDE_DEG_STEP * Math.PI / 180;
      const P = { x: from.x + r * Math.cos(th), y: from.y + r * Math.sin(th) };
      if (!isValidMove(P, ctx)) continue;
      const dd = dist(P, T);
      if (dd < bestD - 1e-12) { best = P; bestD = dd; }
    }
  }
  if (!best) return stay('blocked', true);
  return { to: best, slid: true, stayed: false, reason: 'slide' };
}

// Línea de tiro (spec/01 §5): segmento recto a→b sin cruzar ningún obstáculo (rect sin ampliar,
// bordes incluidos; muestreo cada 0.25 u; un segmento más corto usa solo su extremo).
export function los(a, b, obstacles) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let k = 1; k <= n; k++) {
    const t = k / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    for (const o of obstacles) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return false;
  }
  return true;
}
