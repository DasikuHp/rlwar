// Emblema de una red (spec/02 §1: `emblem` es la semilla; "Opus lo dibuja"): un sello de simetría radial que sale
// entero de la semilla, así dos redes con la misma semilla llevan el mismo sello y una mutación del emblema se nota.
const INKS = ['#4fd1ff', '#9d8cff', '#f5c451', '#3ddc97', '#ff8fa3', '#7ee0ff'];

function rngOf(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const f = (v) => (Math.round(v * 100) / 100).toString();
const pt = (r, ang) => `${f(r * Math.cos(ang))},${f(r * Math.sin(ang))}`;

export function emblemSVG(seed, size = 40) {
  const r = rngOf(seed);
  const n = 3 + Math.floor(r() * 6);                 // simetría de 3 a 8
  const ink = INKS[Math.floor(r() * INKS.length)];
  const ink2 = INKS[(INKS.indexOf(ink) + 1 + Math.floor(r() * (INKS.length - 1))) % INKS.length];
  const rot = -Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI / n);
  const outer = 40 + r() * 6, inner = 12 + r() * 16, mid = 22 + r() * 12;
  const step = (2 * Math.PI) / n;
  const ring = Array.from({ length: n }, (_, i) => pt(outer, rot + i * step)).join(' ');
  const star = Array.from({ length: 2 * n }, (_, i) => pt(i % 2 ? inner : mid + 10, rot + i * step / 2)).join(' ');
  const spokes = r() < 0.6 ? Array.from({ length: n }, (_, i) => `<line x1="${pt(inner * 0.5, rot + i * step).split(',')[0]}" y1="${pt(inner * 0.5, rot + i * step).split(',')[1]}" x2="${pt(outer, rot + i * step).split(',')[0]}" y2="${pt(outer, rot + i * step).split(',')[1]}"/>`).join('') : '';
  const core = 4 + r() * 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="${size}" height="${size}" role="img" aria-label="emblema ${Number(seed) >>> 0}">`
    + `<g fill="none" stroke-linejoin="round" stroke-linecap="round">`
    + `<polygon points="${ring}" stroke="${ink}" stroke-width="3" opacity=".55"/>`
    + `<g stroke="${ink}" stroke-width="1.5" opacity=".45">${spokes}</g>`
    + `<polygon points="${star}" stroke="${ink2}" stroke-width="3.5"/>`
    + `</g><circle r="${f(core)}" fill="${ink}"/></svg>`;
}
