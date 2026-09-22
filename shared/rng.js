// PRNG con semilla (mulberry32), compartido por salas, mapas, agentes y laboratorio (spec/00 §1).
// makeRng(seed) devuelve una función `() → [0,1)` compatible con Math.random, con ayudas:
//   rng.int(n) entero en [0, n) · rng.pick(arr) · rng.gauss() normal(0,1) · rng.seed
export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function makeRng(seed) {
  const s = Number(seed);
  const fixed = Number.isInteger(s) && s >= 0 && s < 2 ** 31 ? s : randomSeed();
  let a = fixed >>> 0;
  const rng = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  rng.seed = fixed;
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.gauss = () => gaussFrom(rng);
  return rng;
}

// Normal(0,1) por Box-Muller a partir de cualquier fuente uniforme
export function gaussFrom(rng = Math.random) {
  let u = 0, v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
