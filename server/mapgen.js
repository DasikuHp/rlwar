// Generación procedural de mapas: obstáculos y posiciones de soldados.
import { PLANE, SOLDIERS_PER_PLAYER } from '../shared/constants.js';

const overlaps = (a, b, pad = 1.5) =>
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

// `rng`: función () → [0,1) (con semilla desde la sala; por defecto Math.random)
export function genMap(numSoldiers = SOLDIERS_PER_PLAYER, rng = Math.random) {
  const rand = (a, b) => a + rng() * (b - a);
  const roll = rng();
  const biome = roll < 0.35 ? 'fortaleza' : roll < 0.7 ? 'ruinas' : 'llanura';
  const names = { fortaleza: '🏰 Fortaleza', ruinas: '🏚️ Ruinas', llanura: '🌵 Llanura' };
  const obstacles = [];
  const push = (rect) => {
    for (const o of obstacles) if (overlaps(rect, o, 2)) return false;
    obstacles.push(rect);
    return true;
  };

  if (biome === 'fortaleza') {
    // muro central alto: las rectas se estrellan, las parábolas pasan por encima.
    // Aquí el Sniper sufre y el Artillery manda.
    push({ x: rand(-3, 1.5), y: rand(-13, -7), w: rand(1.5, 3), h: rand(9, 14) });
    for (let i = 0; i < 4; i++) {
      push({ x: rand(-20, 15), y: rand(-12, 9), w: rand(1, 3.5), h: rand(0.8, 3) });
    }
  } else if (biome === 'llanura') {
    // campo abierto y bajo: paraíso del Sniper, infierno del resto
    for (let i = 0; i < 4; i++) {
      push({ x: rand(-18, 12), y: rand(-12, 9), w: rand(1.5, 4), h: rand(0.8, 2.2) });
    }
  } else {
    // ruinas: disperso e impredecible, como antes
    const n = Math.floor(rand(3, 7));
    for (let i = 0; i < n; i++) {
      push({ x: rand(-18, 12), y: rand(-12, 8), w: rand(1, 5), h: rand(0.8, 5) });
    }
  }

  const placeSide = (side, count) => {
    const placed = [];
    let guard = 0;
    while (placed.length < count && guard++ < 400) {
      const x = side === 'left' ? rand(-23, -6) : rand(6, 23);
      const y = rand(PLANE.yMin + 2, PLANE.yMax - 2);
      const inside = obstacles.some((o) => x > o.x - 1.5 && x < o.x + o.w + 1.5 && y > o.y - 1.5 && y < o.y + o.h + 1.5);
      const near = placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 9);
      if (!inside && !near) placed.push({ x, y });
    }
    while (placed.length < count) placed.push({ x: side === 'left' ? -20 : 20, y: rand(-10, 10) });
    return placed;
  };

  return { obstacles, numSoldiers, placeSide, name: names[biome], biome };
}
