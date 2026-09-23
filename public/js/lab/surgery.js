// Lógica pura de la cirugía (parte 4, nivel Científico; spec/05 §7 y §10.5, spec/02 §4). Sin DOM.

export function weightBlocks(genome) {
  const frozen = new Set(Array.isArray(genome.frozen) ? genome.frozen : []);
  const w = genome.weights || {};
  return (genome.blocks || []).filter((b) => w[b.id]).map((b) => ({ id: b.id, type: b.type, params: b.params || {}, keys: Object.fromEntries(Object.entries(w[b.id]).map(([k, v]) => [k, v.length])), frozen: frozen.has(b.id) }));
}

// cómo se dibuja una matriz de pesos: W[i·salidas + j] → filas = entradas, columnas = neuronas de salida (el tamaño
// de su sesgo); los sesgos y los vectores de norma, en una fila. Si no cuadra, una fila con todo.
export function gridOf(block, key, len) {
  const p = block.params || {};
  const vector = /^b/.test(key) || key === 'g' || key === 'q0';
  let cols = null;
  if (!vector) {
    switch (block.type) {
      case 'dense': case 'echo': case 'teamMemory': case 'gru': case 'lstm': cols = p.units; break;
      case 'hand.adjust': cols = p.params; break;
      case 'foot.move': cols = key === 'Wa' ? 2 : 1; break;
      case 'hand.choose': case 'hand.value': cols = 1; break;
      case 'attention': cols = p.heads * p.keyDim; break;
      default: cols = null;
    }
  }
  if (!cols || len % cols !== 0) return { rows: 1, cols: len };
  return { rows: len / cols, cols };
}

export function weightStats(arr) {
  const n = arr.length;
  if (!n) return { n: 0, min: null, max: null, mean: null, norm: 0 };
  let min = Infinity, max = -Infinity, sum = 0, sq = 0;
  for (const v of arr) { if (v < min) min = v; if (v > max) max = v; sum += v; sq += v * v; }
  return { n, min, max, mean: sum / n, norm: Math.sqrt(sq) };
}

export function scaleWeights(w, k) {
  const f = Number(k);
  if (typeof k === 'string' && k.trim() === '') return { value: null, error: 'Escribe un número para multiplicar los pesos.' };
  if (!Number.isFinite(f)) return { value: null, error: 'El factor tiene que ser un número, p. ej. 0.5 o 2.' };
  return { value: Object.fromEntries(Object.entries(w).map(([key, arr]) => [key, arr.map((v) => v * f)])), error: null };
}

export function parseWeights(text) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return { value: null, error: `No es JSON válido (${e.message}). Ejemplo: {"W": [0.1, -0.2], "b": [0]}` }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { value: null, error: 'Tiene que ser un objeto con una lista de números por clave, p. ej. {"W": [0.1, -0.2], "b": [0]}.' };
  for (const [k, arr] of Object.entries(v)) {
    if (!Array.isArray(arr)) return { value: null, error: `"${k}" tiene que ser una lista de números.` };
    const bad = arr.findIndex((x) => typeof x !== 'number' || !Number.isFinite(x));
    if (bad >= 0) return { value: null, error: `"${k}" lleva algo que no es un número finito en la posición ${bad}.` };
  }
  return { value: v, error: null };
}

// divergente con un gris en el cero: negativo → naranja, positivo → cyan
const ZERO = [43, 51, 66], NEG = [255, 159, 67], POS = [79, 209, 255];
export function divergingColor(v, maxAbs) {
  const t = maxAbs > 0 && Number.isFinite(v) ? Math.min(1, Math.abs(v) / maxAbs) : 0;
  const to = v < 0 ? NEG : POS;
  return `rgb(${ZERO.map((z, i) => Math.round(z + (to[i] - z) * t)).join(',')})`;
}
