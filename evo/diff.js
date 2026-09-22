// Diferencias entre dos genomas (spec/05 §5, §10.3): por bloque (same/changed/added/removed, relChange, heat),
// cables, rasgos, imaginación y los textos de las mutaciones si `parent` es el padre de `child`.
import { BLOCKS, analyzeGenome } from '../shared/genome.js';
import { labeler } from './labels.js';

const MAX_HEAT = 64;
const sq = (v) => v * v;

// promedia tramos consecutivos hasta dejar ≤ 64 valores
function bucket(values) {
  if (values.length <= MAX_HEAT) return values;
  const out = new Array(MAX_HEAT).fill(0);
  const per = values.length / MAX_HEAT;
  for (let i = 0; i < MAX_HEAT; i++) {
    const lo = Math.floor(i * per), hi = Math.max(lo + 1, Math.floor((i + 1) * per));
    let s = 0; for (let k = lo; k < hi; k++) s += values[k];
    out[i] = s / (hi - lo);
  }
  return out;
}
const rescale = (values) => { const m = Math.max(0, ...values); return m > 0 ? values.map((v) => v / m) : values.map(() => 0); };

// heat: un valor por unidad (columna propia) o, si el tensor no tiene columnas propias, por fila (posición de entrada)
function blockDelta(id, Lc, Lp, wc, wp) {
  let d2 = 0, p2 = 0;
  const heat = new Map();
  const bump = (label, v) => heat.set(label, (heat.get(label) || 0) + v);
  const keys = new Set([...Object.keys(wc || {}), ...Object.keys(wp || {})]);
  for (const key of keys) {
    const tc = wc && wc[key] ? Lc.tensorLabels(id, key) : null, tp = wp && wp[key] ? Lp.tensorLabels(id, key) : null;
    const rowsP = tp ? new Map(tp.rows.map((l, i) => [l, i])) : null, colsP = tp ? new Map(tp.cols.map((l, i) => [l, i])) : null;
    const seen = new Set();
    if (tc) {
      const cols = tc.cols.length, ownCols = cols > 1 && tc.cols[0].startsWith(`${id}#`);
      for (let r = 0; r < tc.rows.length; r++) for (let c = 0; c < cols; c++) {
        const v = wc[key][r * cols + c];
        const ro = rowsP ? rowsP.get(tc.rows[r]) : undefined, co = colsP ? colsP.get(tc.cols[c]) : undefined;
        let old = 0;
        if (ro !== undefined && co !== undefined) { old = wp[key][ro * tp.cols.length + co]; seen.add(ro * tp.cols.length + co); p2 += sq(old); }
        const dd = sq(v - old); d2 += dd;
        bump(ownCols ? tc.cols[c] : tc.rows[r], dd);
      }
    }
    if (tp) {
      const cols = tp.cols.length, ownCols = cols > 1 && tp.cols[0].startsWith(`${id}#`);
      for (let r = 0; r < tp.rows.length; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (seen.has(i)) continue;
        const old = wp[key][i]; p2 += sq(old); d2 += sq(old);
        bump(ownCols ? tp.cols[c] : tp.rows[r], sq(old));
      }
    }
  }
  const labels = [...heat.keys()].filter((l) => !/:(a|b)\d+$/.test(l));
  return { relChange: Math.sqrt(d2) / (Math.sqrt(p2) + 1e-9), heat: rescale(bucket(labels.map((l) => Math.sqrt(heat.get(l))))) };
}

export function diffGenomes(child, parent) {
  const ac = analyzeGenome(child), ap = analyzeGenome(parent);
  const gc = ac.genome, gp = ap.genome;
  const Lc = labeler(gc, ac), Lp = labeler(gp, ap);
  const byC = new Map(gc.blocks.map((b) => [b.id, b])), byP = new Map(gp.blocks.map((b) => [b.id, b]));
  const ids = [...gp.blocks.map((b) => b.id), ...gc.blocks.filter((b) => !byP.has(b.id)).map((b) => b.id)];
  const blocks = ids.map((id) => {
    const bc = byC.get(id), bp = byP.get(id);
    const b = bc || bp;
    const name = `${BLOCKS[b.type].name} ${id}`;
    if (!bc) return { blockId: id, name, status: 'removed', relChange: 1, heat: rescale((Lp.outLabels(id) || []).map(() => 1)).slice(0, MAX_HEAT) };
    if (!bp) return { blockId: id, name, status: 'added', relChange: 1, heat: rescale((Lc.outLabels(id) || []).map(() => 1)).slice(0, MAX_HEAT) };
    const sameShape = bc.type === bp.type && JSON.stringify(bc.params) === JSON.stringify(bp.params);
    const wc = gc.weights[id], wp = gp.weights[id];
    if (!wc && !wp) return { blockId: id, name, status: sameShape ? 'same' : 'changed', relChange: 0, heat: [] };
    if (bc.type !== bp.type) return { blockId: id, name, status: 'changed', relChange: 1, heat: rescale(Lc.outLabels(id).map(() => 1)).slice(0, MAX_HEAT) };
    const { relChange, heat } = blockDelta(id, Lc, Lp, wc, wp);
    const same = sameShape && JSON.stringify(wc) === JSON.stringify(wp);
    return { blockId: id, name, status: same ? 'same' : 'changed', relChange: same ? 0 : relChange, heat: same ? heat.map(() => 0) : heat };
  });
  const key = (w) => `${w.from}→${w.to}`;
  const pk = new Set(gp.wires.map(key)), ck = new Set(gc.wires.map(key));
  const wires = { added: gc.wires.filter((w) => !pk.has(key(w))).map((w) => ({ from: w.from, to: w.to })), removed: gp.wires.filter((w) => !ck.has(key(w))).map((w) => ({ from: w.from, to: w.to })) };
  const isChild = gc.lineage && Array.isArray(gc.lineage.parents) && gc.lineage.parents[0] === gp.id && gc.id !== gp.id;
  const text = isChild ? gc.lineage.mutations.map((o) => o.text).filter((t) => typeof t === 'string') : [];
  return { blocks, wires, traits: { before: gp.traits, after: gc.traits }, imagination: { before: gp.imagination, after: gc.imagination }, text };
}
