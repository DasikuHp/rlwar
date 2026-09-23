// Geometría (spec/01 §3 y §10): terreno (círculos, rectángulos y bocados), validez de un destino, deslizamiento al punto
// válido más cercano y línea de tiro. Pura: sin estado, sin aleatoriedad, nunca lanza.
import { PLANE, MOVE_RADIUS, BODY, MIN_SEPARATION, SLIDE_R_STEP, SLIDE_DEG_STEP } from './constants.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// el terreno llega como {obstacles, bites} o como la lista de obstáculos de siempre (sin bocados)
export const terrainOf = (t) => (Array.isArray(t) ? { obstacles: t, bites: [] } : { obstacles: (t && t.obstacles) || [], bites: (t && t.bites) || [] });

// ¿P está dentro del obstáculo agrandado en `pad`? Círculo {kind:'circle', x, y, r} o rectángulo {x, y, w, h} (bordes incluidos)
export function insideExpanded(P, o, pad = BODY) {
  if (o && o.kind === 'circle') {
    // fuera de la caja del círculo, fuera del círculo (hypot ≥ |dx|): se evita el hypot, que es lo caro
    const R = o.r + pad, dx = P.x - o.x, dy = P.y - o.y;
    if (dx > R || dx < -R || dy > R || dy < -R) return false;
    return Math.hypot(dx, dy) <= R;
  }
  return !(P.x < o.x - pad || P.x > o.x + o.w + pad || P.y < o.y - pad || P.y > o.y + o.h + pad);
}

// sólido = dentro de algún obstáculo (agrandado en `margin`) y fuera de todos los bocados (encogidos en `margin`)
export function isSolid(P, terrain, margin = 0) {
  const T = terrainOf(terrain);
  if (!T.obstacles.some((o) => insideExpanded(P, o, margin))) return false;
  for (const b of T.bites) if (Math.hypot(P.x - b.x, P.y - b.y) < b.r - margin) return false;
  return true;
}

// El segmento from→P no atraviesa terreno sólido agrandado (muestreo t = 0.1 … 1.0)
export function segmentClear(from, P, terrain, pad = BODY) {
  for (let k = 1; k <= 10; k++) {
    const t = k / 10;
    const Q = { x: from.x + (P.x - from.x) * t, y: from.y + (P.y - from.y) * t };
    if (isSolid(Q, terrain, pad)) return false;
  }
  return true;
}

// Las 5 reglas de validez de spec/01 §3
export function isValidMove(P, { from, soldiers = [], obstacles = [], bites = [], selfId = null, plane = PLANE }) {
  if (dist(P, from) > MOVE_RADIUS + 1e-9) return false;
  if (P.x < plane.xMin + BODY || P.x > plane.xMax - BODY || P.y < plane.yMin + BODY || P.y > plane.yMax - BODY) return false;
  const terrain = { obstacles, bites };
  if (isSolid(P, terrain, BODY)) return false;
  for (const s of soldiers) {
    if (s.id === selfId || !s.alive) continue;
    if (dist(P, s) < MIN_SEPARATION) return false;
  }
  return segmentClear(from, P, terrain);
}

// Devuelve {to, slid, stayed, reason}. `requested` = {x,y} | 'stay' | null | cualquier cosa.
export function slideMove({ from, requested, soldiers = [], obstacles = [], bites = [], selfId = null, plane = PLANE }) {
  const stay = (reason, slid = false) => ({ to: { x: from.x, y: from.y }, slid, stayed: true, reason });
  if (requested === 'stay' || requested === null || requested === undefined) return stay('stay');
  if (typeof requested !== 'object' || !isNum(requested.x) || !isNum(requested.y)) return stay('invalid');
  let T = { x: requested.x, y: requested.y };
  const d = dist(T, from);
  if (d > MOVE_RADIUS) T = { x: from.x + (T.x - from.x) * MOVE_RADIUS / d, y: from.y + (T.y - from.y) * MOVE_RADIUS / d };
  const ctx = { from, soldiers, obstacles, bites, selfId, plane };
  if (isValidMove(T, ctx)) return { to: T, slid: false, stayed: false, reason: 'ok' };

  // rejilla polar: r creciente, θ creciente; gana la menor distancia a T (empates: primero encontrado). Un punto que no
  // mejora la distancia no puede ganar: se descarta antes de validarlo (validar es lo caro), con el mismo resultado
  let best = null, bestD = Infinity;
  const nr = Math.round(MOVE_RADIUS / SLIDE_R_STEP), na = Math.round(360 / SLIDE_DEG_STEP);
  for (let i = 1; i <= nr; i++) {
    const r = i * SLIDE_R_STEP;
    for (let k = 0; k < na; k++) {
      const th = k * SLIDE_DEG_STEP * Math.PI / 180;
      const P = { x: from.x + r * Math.cos(th), y: from.y + r * Math.sin(th) };
      const dd = dist(P, T);
      if (!(dd < bestD - 1e-12) || !isValidMove(P, ctx)) continue;
      best = P; bestD = dd;
    }
  }
  if (!best) return stay('blocked', true);
  return { to: best, slid: true, stayed: false, reason: 'slide' };
}

// Línea de tiro (spec/01 §5): segmento recto a→b sin cruzar terreno sólido (sin agrandar, bordes incluidos; muestreo
// cada 0.25 u; un segmento más corto usa solo su extremo). `terrain` = {obstacles, bites} o la lista de obstáculos.
export function los(a, b, terrain) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / 0.25));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (isSolid({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, terrain, 0)) return false;
  }
  return true;
}
