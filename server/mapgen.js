// Generación procedural de mapas (spec/01 §10.2): círculos como en el Graphwar original (GraphServer.generateCircles)
// y posiciones de soldados. Todo sale del `rng` de la sala: misma semilla, mismo mapa.
import { PLANE, SOLDIERS_PER_PLAYER } from '../shared/constants.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// `rng`: función () → [0,1) (con semilla desde la sala; por defecto Math.random)
export function genMap(numSoldiers = SOLDIERS_PER_PLAYER, rng = Math.random) {
  const rand = (a, b) => a + rng() * (b - a);
  // normal por Box–Muller con el mismo rng (determinista)
  const gauss = (mean, sd) => { const u = Math.max(1e-12, rng()), v = rng(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
  const anywhere = (r) => circle(rand(PLANE.xMin, PLANE.xMax), rand(PLANE.yMin, PLANE.yMax), r);
  // la regla del original: 15 ± 7 círculos de 40 ± 25 px (2,6 ± 1,6 u), limitados a 8–22 y a 1–4 u
  const countOf = () => clamp(Math.round(gauss(15, 7)), 8, 22);
  const radiusOf = () => clamp(gauss(2.6, 1.6), 1, 4);

  const roll = rng();
  const biome = roll < 0.35 ? 'fortaleza' : roll < 0.7 ? 'ruinas' : 'llanura';
  const names = { fortaleza: '🏰 Fortaleza', ruinas: '🏚️ Ruinas', llanura: '🌵 Llanura' };
  const obstacles = [];
  if (biome === 'fortaleza') {
    // 2 o 3 círculos grandes apilados cerca del centro: las rectas se estrellan, las parábolas pasan por encima
    const big = rng() < 0.5 ? 2 : 3;
    for (let i = 0; i < big; i++) obstacles.push(circle(rand(-4, 4), -9 + i * 7 + rand(-1, 1), rand(3.5, 4)));
    const n = countOf();
    while (obstacles.length < n) obstacles.push(anywhere(radiusOf()));
  } else if (biome === 'llanura') {
    // campo abierto: pocos círculos y pequeños
    const n = 8 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) obstacles.push(anywhere(rand(1, 2.5)));
  } else {
    // ruinas: la regla del original, tal cual
    const n = countOf();
    for (let i = 0; i < n; i++) obstacles.push(anywhere(radiusOf()));
  }

  // cada bando en su mitad, fuera de todo círculo con 1 u de margen y a 3 u o más de sus compañeros
  const placeSide = (side, count) => {
    const placed = [];
    const ok = (x, y) => !obstacles.some((o) => Math.hypot(x - o.x, y - o.y) <= o.r + 1) && !placed.some((p) => Math.hypot(p.x - x, p.y - y) < 3);
    let guard = 0;
    while (placed.length < count && guard++ < 400) {
      const x = side === 'left' ? rand(-23, -6) : rand(6, 23);
      const y = rand(PLANE.yMin + 2, PLANE.yMax - 2);
      if (ok(x, y)) placed.push({ x, y });
    }
    // sin sitio en 400 intentos: el hueco libre más cercano a (±20, 0), en una rejilla de 0,5 u de su mitad
    while (placed.length < count) {
      const cx = side === 'left' ? -20 : 20;
      let best = null, bestD = Infinity;
      for (let x = side === 'left' ? -23 : 6; x <= (side === 'left' ? -6 : 23); x += 0.5) {
        for (let y = PLANE.yMin + 2; y <= PLANE.yMax - 2; y += 0.5) {
          const d = Math.hypot(x - cx, y);
          if (d < bestD && ok(x, y)) { best = { x, y }; bestD = d; }
        }
      }
      placed.push(best || { x: cx, y: 0 });
    }
    return placed;
  };

  return { obstacles, numSoldiers, placeSide, name: names[biome], biome };
}
