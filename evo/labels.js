// Etiquetas de posiciones (spec/05 §10.1): cada número que circula por la red lleva una etiqueta estable
// ("ojo:k" o "bloque#u") y cada tensor de pesos sabe qué etiqueta tiene cada fila y cada columna. Con eso
// mutate.js recoloca los pesos cuando cambia una forma y diff.js compara dos genomas peso a peso.
import { BLOCK_FLAGS, weightShapes } from '../shared/genome.js';

const { isEye } = BLOCK_FLAGS;
const PASS = new Set(['concat', 'skip', 'norm']);
const WITH_UNITS = new Set(['dense', 'echo', 'gru', 'lstm', 'teamMemory', 'attention', 'hand.choose', 'hand.value', 'hand.adjust', 'foot.move']);
export const BIAS_RE = /^(b|ba|bz|br|bh|bi|bf|bo|bg|g)$/;

// unitMap: { [blockId]: array índiceNuevo → etiqueta de unidad (número viejo o texto para las nuevas) }
export function labeler(genome, analysis, unitMap = {}) {
  const byId = new Map(genome.blocks.map((b) => [b.id, b]));
  const outMemo = new Map();
  const unitLabel = (id, k) => `${id}#${unitMap[id] ? unitMap[id][k] : k}`;
  const outLabels = (id) => {
    if (outMemo.has(id)) return outMemo.get(id);
    const b = byId.get(id), dims = analysis.dims[id], ins = analysis.inputs[id] || [];
    let out;
    if (isEye(b.type)) out = Array.from({ length: dims.out }, (_, k) => `${id}:${k}`);
    else if (PASS.has(b.type)) out = ins.flatMap((i) => outLabels(i));
    else if (b.type === 'add' || b.type === 'mul') out = ins.length ? outLabels(ins[0]).slice() : [];
    else if (b.type === 'pool') out = ins.filter((i) => analysis.streams[i] !== 'ctx').flatMap((i) => outLabels(i));
    else out = Array.from({ length: dims.out }, (_, k) => unitLabel(id, k));
    outMemo.set(id, out);
    return out;
  };
  const inLabels = (id) => (analysis.inputs[id] || []).flatMap((i) => outLabels(i));
  const ctxLabels = (id) => (analysis.inputs[id] || []).filter((i) => analysis.streams[i] === 'ctx').flatMap((i) => outLabels(i));
  const kvLabels = (id) => (analysis.inputs[id] || []).filter((i) => analysis.streams[i] !== 'ctx').flatMap((i) => outLabels(i));
  const units = (id, n) => Array.from({ length: n }, (_, k) => unitLabel(id, k));
  // filas y columnas de cada tensor; un vector es "filas × ['·']"
  const tensorLabels = (id, key) => {
    const b = byId.get(id), p = b.params;
    const V = ['·'];
    switch (b.type) {
      case 'dense': return key === 'W' ? { rows: inLabels(id), cols: units(id, p.units) } : { rows: units(id, p.units), cols: V };
      case 'norm': return { rows: inLabels(id), cols: V };
      case 'attention': {
        const hk = units(id, p.heads * p.keyDim);
        if (key === 'Wq') return { rows: ctxLabels(id), cols: hk };
        if (key === 'q0') return { rows: hk, cols: V };
        return { rows: kvLabels(id), cols: hk };
      }
      case 'echo': case 'teamMemory':
        if (key === 'Wx') return { rows: inLabels(id), cols: units(id, p.units) };
        if (key === 'Wh') return { rows: units(id, p.units), cols: units(id, p.units) };
        return { rows: units(id, p.units), cols: V };
      case 'gru': case 'lstm':
        if (key.length === 2 && key[0] === 'W') return { rows: [...inLabels(id), ...units(id, p.units)], cols: units(id, p.units) };
        return { rows: units(id, p.units), cols: V };
      case 'hand.choose': case 'hand.value': return key === 'W' ? { rows: inLabels(id), cols: V } : { rows: [`${id}:b0`], cols: V };
      case 'hand.adjust': return key === 'W' ? { rows: inLabels(id), cols: units(id, p.params) } : { rows: units(id, p.params), cols: V };
      case 'foot.move':
        if (key === 'W') return { rows: inLabels(id), cols: V };
        if (key === 'b') return { rows: [`${id}:b0`], cols: V };
        if (key === 'Wa') return { rows: inLabels(id), cols: [`${id}:a0`, `${id}:a1`] };
        return { rows: [`${id}:a0`, `${id}:a1`], cols: V };
      default: return null;
    }
  };
  const shapesOf = (id) => weightShapes(byId.get(id), analysis.dims[id]);
  return { outLabels, inLabels, tensorLabels, shapesOf, hasUnits: (id) => WITH_UNITS.has(byId.get(id).type), byId };
}

// suma de cuadrados de los pesos que salen de cada unidad de `id` (filas etiquetadas "id#u" en los consumidores)
export function outgoingNorms(genome, analysis, id, units) {
  const L = labeler(genome, analysis);
  const acc = new Map(Array.from({ length: units }, (_, u) => [`${id}#${u}`, 0]));
  for (const b of genome.blocks) {
    const w = genome.weights[b.id];
    if (!w) continue;
    for (const key of Object.keys(w)) {
      const t = L.tensorLabels(b.id, key);
      if (!t) continue;
      const cols = t.cols.length;
      t.rows.forEach((lab, r) => {
        if (!acc.has(lab)) return;
        let s = acc.get(lab);
        for (let c = 0; c < cols; c++) s += w[key][r * cols + c] ** 2;
        acc.set(lab, s);
      });
    }
  }
  return Array.from({ length: units }, (_, u) => Math.sqrt(acc.get(`${id}#${u}`)));
}
