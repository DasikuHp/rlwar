// Trazador de trayectorias (simulación autoritativa, compartida servidor/agente/navegador).
// Modos (como el Graphwar original):
//  - 'function': y = f(x) + c, con c = ySoldado - f(xSoldado) (la curva pasa por el soldado)
//  - 'ode1': y' = f(x,y); condición inicial = posición del soldado (RK4 sobre longitud de arco)
//  - 'ode2': y'' = f(x,y,y'); condiciones iniciales = posición + ángulo (RK4)
// La dirección de avance es hacia el lado enemigo (equipo izquierdo: x creciente).

import { PLANE, HIT_RADIUS, OBSTACLE_MARGIN, STEP, MAX_STEPS, MAX_STEEPNESS, NETWORK_STEP } from './constants.js';
import { isSolid } from './geometry.js';

const inBounds = (x, y) => x >= PLANE.xMin && x <= PLANE.xMax && y >= PLANE.yMin && y <= PLANE.yMax;

/**
 * Simula un disparo y devuelve { points: [[x,y],...], result: {type, end, hits, soldierId, x, y, firstHit} }
 * El tiro atraviesa a los soldados (spec/01 §10.3): `hits` = los alcanzados en orden de recorrido; se para en
 * `end` = obstacle | wall | invalid | steep | maxlen. `type` = kill (algún enemigo) | suicide (solo aliados) | end.
 * `firstHit` = {x, y, points}: dónde iba el recorrido al alcanzar al primero (para el Simulador).
 */
export function simulateShot({ mode, f, start, dir, angle = 0, soldiers = [], obstacles = [], bites = [], shooterId = null, ds = STEP, maxSteps = MAX_STEPS }) {
  const points = [[start.x, start.y]];
  let x = start.x, y = start.y;
  // pendiente inicial dy/dx: el ángulo positivo SUBE en los dos lados (spec/01 §7b); para el
  // equipo derecho (dir = -1) x decrece, así que dy/dx debe ser negativa para subir
  let v = dir * Math.tan(angle);
  let c = null;

  const terrain = { obstacles, bites };
  const shooterTeam = (soldiers.find((q) => q.id === shooterId) || {}).team;
  const hits = [], hitIds = new Set();
  let firstHit = null;
  const finish = (end, ex = x, ey = y) => {
    points.push([ex, ey]);
    const type = hits.some((h) => h.team !== shooterTeam) ? 'kill' : hits.length ? 'suicide' : end;
    return { points, result: { type, end, hits, soldierId: hits.length ? hits[0].soldierId : null, x: ex, y: ey, firstHit } };
  };

  if (mode === 'function') {
    let f0;
    try { f0 = f(x, y, 0, 0); } catch { f0 = NaN; }
    if (!isFinite(f0)) return finish('invalid');
    c = y - f0;
  }

  const F = (t) => f(t, y, 0, 0) + c; // valor exacto de la curva en modo función

  const check = (px, py) => {
    if (!inBounds(px, py)) {
      const cx = Math.min(PLANE.xMax, Math.max(PLANE.xMin, px));
      const cy = Math.min(PLANE.yMax, Math.max(PLANE.yMin, py));
      return finish('wall', cx, cy);
    }
    if (isSolid({ x: px, y: py }, terrain, OBSTACLE_MARGIN)) return finish('obstacle', px, py);
    // atraviesa: cada soldado vivo (menos el que dispara) a HIT_RADIUS o menos, una vez y en orden; no se para
    for (const s of soldiers) {
      if (!s.alive || s.id === shooterId || hitIds.has(s.id)) continue;
      const dx = s.x - px, dy = s.y - py;
      if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) {
        hitIds.add(s.id);
        hits.push({ soldierId: s.id, team: s.team, x: s.x, y: s.y });
        if (!firstHit) firstHit = { x: px, y: py, points: points.length + 1 };
      }
    }
    return null;
  };

  let lastRec = 0;
  const record = (px, py) => {
    const d = (px - points[points.length - 1][0]) ** 2 + (py - points[points.length - 1][1]) ** 2;
    if (d >= NETWORK_STEP * NETWORK_STEP || lastRec === 0) points.push([px, py]);
    lastRec++;
  };

  const gOf = (px, py, pv) => {
    try { return f(px, py, pv, 0); } catch { return NaN; }
  };
  // derivada numérica de la curva en modo función
  const slopeAt = (px) => {
    const h = 1e-3;
    const a = F(px - h), b = F(px + h);
    if (!isFinite(a) || !isFinite(b)) return NaN;
    return (b - a) / (2 * h);
  };

  for (let s = 0; s < maxSteps; s++) {
    if (mode === 'function') {
      const g = slopeAt(x);
      if (!isFinite(g)) return finish('invalid');
      if (Math.abs(g) > MAX_STEEPNESS) return finish('steep');
      const u = 1 / Math.sqrt(1 + g * g);
      const dx = dir * u * ds;
      const xn = x + dx;
      let yn;
      try { yn = F(xn); } catch { yn = NaN; }
      if (!isFinite(yn)) return finish('invalid');
      record(x, y);
      x = xn; y = yn;
    } else if (mode === 'ode1') {
      const k = (px, py) => {
        const g = gOf(px, py, 0);
        if (!isFinite(g)) return null;
        const u = 1 / Math.sqrt(1 + g * g);
        return [dir * u, dir * u * g];
      };
      const a = k(x, y);
      if (!a) return finish('invalid');
      const b = k(x + ds / 2 * a[0], y + ds / 2 * a[1]);
      if (!b) return finish('invalid');
      const cc = k(x + ds / 2 * b[0], y + ds / 2 * b[1]);
      if (!cc) return finish('invalid');
      const d = k(x + ds * cc[0], y + ds * cc[1]);
      if (!d) return finish('invalid');
      record(x, y);
      x += ds / 6 * (a[0] + 2 * b[0] + 2 * cc[0] + d[0]);
      y += ds / 6 * (a[1] + 2 * b[1] + 2 * cc[1] + d[1]);
    } else { // ode2
      const k = (px, py, pv) => {
        const h = gOf(px, py, pv);
        if (!isFinite(h)) return null;
        const u = 1 / Math.sqrt(1 + pv * pv);
        return [dir * u, dir * u * pv, dir * u * h];
      };
      const a = k(x, y, v);
      if (!a) return finish('invalid');
      const b = k(x + ds / 2 * a[0], y + ds / 2 * a[1], v + ds / 2 * a[2]);
      if (!b) return finish('invalid');
      const cc = k(x + ds / 2 * b[0], y + ds / 2 * b[1], v + ds / 2 * b[2]);
      if (!cc) return finish('invalid');
      const d = k(x + ds * cc[0], y + ds * cc[1], v + ds * cc[2]);
      if (!d) return finish('invalid');
      record(x, y);
      x += ds / 6 * (a[0] + 2 * b[0] + 2 * cc[0] + d[0]);
      y += ds / 6 * (a[1] + 2 * b[1] + 2 * cc[1] + d[1]);
      v += ds / 6 * (a[2] + 2 * b[2] + 2 * cc[2] + d[2]);
    }

    const end = check(x, y);
    if (end) return end;
  }
  return finish('maxlen');
}
