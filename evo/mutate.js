// Mutación (spec/05 §1–§3, §6, §10): mutate(parent, config, rng, opts) → {child, ops}. El hijo es SIEMPRE válido:
// tras cada op se valida y, si falla, se deshace anotando el motivo. Los bloques congelados no se tocan.
import { BLOCKS, LIMITS, validate, normalize, analyzeUnchecked, repair, initWeights, weightShapes, ACTIVATIONS, CHARACTERS, TRAIT_RANGES, FAMILIES, BLOCK_FLAGS } from '../shared/genome.js';
import { makeRng, gaussFrom } from '../shared/rng.js';
import { labeler, outgoingNorms, BIAS_RE } from './labels.js';

const { isEye, isMemory, isHead } = BLOCK_FLAGS;
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const nameOf = (b) => `${BLOCKS[b.type].name} ${b.id}`;
const FAMILY_ES = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: 'ecuación', artillery: 'artillería', wild: 'salvaje' };
const CHAR_ES = { frio: 'frío', chulo: 'chulo', dramatico: 'dramático', desquiciado: 'desquiciado' };

export const DEFAULT_MUTATION = Object.freeze({
  weights: { on: true, sigma: 0.05, fraction: 0.3 },
  addNeurons: { on: true, rate: 0.3, max: 8 },
  removeNeurons: { on: true, rate: 0.2, max: 4 },
  addWire: { on: true, rate: 0.3 },
  removeWire: { on: true, rate: 0.2 },
  addBlock: { on: true, rate: 0.2, types: ['dense', 'norm', 'skip', 'attention', 'pool', 'echo', 'gru', 'lstm', 'teamMemory', 'eye.*'] },
  removeBlock: { on: true, rate: 0.1 },
  activation: { on: true, rate: 0.2 },
  eyeParams: { on: true, rate: 0.2 },
  imagination: { on: true, rate: 0.3, sigma: 0.2 },
  traits: { on: true, sigma: 0.15 },
  emblem: { on: true },
});
const ORDER = ['removeBlock', 'addBlock', 'removeWire', 'addWire', 'removeNeurons', 'addNeurons', 'activation', 'eyeParams', 'imagination', 'traits', 'weights', 'emblem'];

export function mutationConfig(config) {
  const out = {};
  for (const k of Object.keys(DEFAULT_MUTATION)) out[k] = { ...DEFAULT_MUTATION[k], ...((config && config[k]) || {}) };
  return out;
}

const wrapRng = (rng) => {
  if (typeof rng !== 'function') return makeRng(rng);
  if (typeof rng.int === 'function') return rng;
  const r = () => rng();
  r.int = (n) => Math.floor(r() * n); r.pick = (arr) => arr[Math.floor(r() * arr.length)]; r.gauss = () => gaussFrom(r);
  return r;
};

export function slugify(name) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length < 3) s = `red-${s}`.replace(/-+$/, '');
  if (s.length < 3) s = 'red-nueva';
  return s.slice(0, 32).replace(/-+$/, '');
}

// 🧭 Hydra-7 → Hydra-8a, Hydra-8b…
export function childName(parentName, generation, sibling = 0) {
  const base = String(parentName || 'Red').replace(/-\d+[a-z]*$/, '');
  let letters = '';
  let n = sibling;
  do { letters = String.fromCharCode(97 + (n % 26)) + letters; n = Math.floor(n / 26) - 1; } while (n >= 0);
  const tail = `-${generation}${letters}`;
  return base.slice(0, 32 - tail.length) + tail;
}

function uniqueIdIn(base, existing) {
  if (!existing || !existing.has(base)) return base;
  for (let k = 2; ; k++) { const id = `${base.slice(0, 32 - String(k).length - 1)}-${k}`; if (!existing.has(id)) return id; }
}

// ---------- análisis y recolocación de pesos ----------
// copia barata: estructura y rasgos clonados, pesos compartidos (las ops que tocan pesos los clonan ellas)
function shallowCopy(g) {
  return { ...g, blocks: clone(g.blocks), wires: clone(g.wires), traits: clone(g.traits), imagination: clone(g.imagination), frozen: g.frozen.slice(), names: g.names ? clone(g.names) : g.names, weights: g.weights };
}
// estructura válida aunque los pesos aún no cuadren (ciclos, corrientes, tamaños, límites): análisis o null
function structuralOk(next) {
  const a = analyzeUnchecked(next);
  if (!a || next.blocks.length > LIMITS.blocks || next.wires.length > LIMITS.wires) return null;
  let params = 0;
  for (const b of next.blocks) { const sh = weightShapes(b, a.dims[b.id]); if (sh) for (const v of Object.values(sh)) params += v; }
  return params > LIMITS.params ? null : a;
}
// motivo legible de por qué no vale la estructura (solo cuando se deshace: es caro)
function structuralError(next) {
  if (next.blocks.length > LIMITS.blocks) return `habría más de ${LIMITS.blocks} bloques`;
  if (next.wires.length > LIMITS.wires) return `habría más de ${LIMITS.wires} cables`;
  const v = validate(repair(clone(next), makeRng(0)).genome);
  return v.ok ? `habría más de ${LIMITS.params} pesos` : v.errors[0].message;
}

// Recoloca los pesos de `next` a partir de los de `prev` casando etiquetas (spec/05 §10.1)
function remapWeights(prev, prevA, next, nextA, unitMap, rng) {
  const Lp = labeler(prev, prevA), Ln = labeler(next, nextA, unitMap);
  const prevIds = new Set(prev.blocks.map((b) => b.id));
  const weights = {};
  for (const b of next.blocks) {
    const shapes = Ln.shapesOf(b.id);
    if (!shapes) continue;
    let fresh = null; // Xavier solo si hace falta
    const freshAt = (key, i) => { if (!fresh) fresh = initWeights(b, nextA.dims[b.id], rng); return fresh[key][i]; };
    const old = prevIds.has(b.id) ? prev.weights[b.id] : null;
    const out = {};
    for (const key of Object.keys(shapes)) {
      const t = Ln.tensorLabels(b.id, key);
      const cols = t.cols.length;
      const arr = new Array(shapes[key]);
      const isBias = BIAS_RE.test(key);
      let oldRows = null, oldCols = null, oldArr = null, oldColsN = 0;
      if (old && old[key]) {
        const tp = Lp.tensorLabels(b.id, key);
        if (tp) { oldRows = new Map(tp.rows.map((l, i) => [l, i])); oldCols = new Map(tp.cols.map((l, i) => [l, i])); oldArr = old[key]; oldColsN = tp.cols.length; }
      }
      for (let r = 0; r < t.rows.length; r++) {
        const rl = t.rows[r], ro = oldRows ? oldRows.get(rl) : undefined;
        for (let c = 0; c < cols; c++) {
          const cl = t.cols[c], co = oldCols ? oldCols.get(cl) : undefined;
          const i = r * cols + c;
          if (ro !== undefined && co !== undefined) { arr[i] = oldArr[ro * oldColsN + co]; continue; }
          if (isBias) { arr[i] = freshAt(key, i); continue; }
          const ownRow = rl.startsWith(`${b.id}#`);
          arr[i] = (!ownRow && ro === undefined) ? 0 : freshAt(key, i) * 0.1; // entrada nueva → 0; unidad nueva → Xavier × 0.1
        }
      }
      out[key] = arr;
    }
    weights[b.id] = out;
  }
  next.weights = weights;
}

function remapNames(g, id, unitMap) {
  if (!g.names || !g.names[id] || !unitMap[id]) return;
  const old = g.names[id], out = {};
  unitMap[id].forEach((u, j) => { if (typeof u === 'number' && old[u] !== undefined) out[j] = old[u]; });
  g.names[id] = out;
}

// ---------- utilidades de estructura ----------
const wireKey = (w) => `${w.from}→${w.to}`;
function newBlockId(g, type) {
  const prefix = type.replace(/^eye\./, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  const used = new Set(g.blocks.map((b) => b.id));
  for (let k = 1; ; k++) { const id = `${prefix}${k}`; if (!used.has(id)) return id; }
}
const defaultParamsOf = (type) => Object.fromEntries((BLOCKS[type].params || []).map((p) => [p.key, clone(p.default)]));
const streamEyesCount = (g) => { const c = {}; for (const b of g.blocks) if (isEye(b.type)) { const s = BLOCKS[b.type].streams.out; c[s] = (c[s] || 0) + 1; } return c; };

// ---------- las ops ----------
// cada op recibe (g copia, a análisis, cfg, rng, ctx) y devuelve {op, reshape?, unitMap?} o {op, undone: reason}
const OPS = {
  removeBlock(g, a, cfg, rng) {
    const eyes = streamEyesCount(g);
    const frozen = new Set(g.frozen);
    const cands = g.blocks.filter((b) => !isHead(b.type) && !frozen.has(b.id) && !(isEye(b.type) && eyes[BLOCKS[b.type].streams.out] <= 1));
    const n = g.blocks.length;
    if (!cands.length) return { op: { op: 'removeBlock', before: { blocks: n }, after: { blocks: n }, text: `No quité ningún bloque (${n} bloques, ninguno se puede quitar)` }, undone: 'no hay bloque que se pueda quitar (Manos, Pies, ojos únicos o congelados)' };
    const b = rng.pick(cands);
    const ins = g.wires.filter((w) => w.to === b.id).map((w) => w.from), outs = g.wires.filter((w) => w.from === b.id).map((w) => w.to);
    const keep = g.wires.filter((w) => w.from !== b.id && w.to !== b.id);
    const keys = new Set(keep.map(wireKey));
    for (const x of ins) for (const y of outs) { const w = { from: x, to: y }; if (!keys.has(wireKey(w))) { keep.push(w); keys.add(wireKey(w)); } }
    g.wires = keep;
    g.blocks = g.blocks.filter((x) => x.id !== b.id);
    g.weights = { ...g.weights }; delete g.weights[b.id];
    if (g.names) delete g.names[b.id];
    return { op: { op: 'removeBlock', blockId: b.id, before: { type: b.type, blocks: n, params: b.params }, after: { blocks: n - 1, reconnected: ins.length * outs.length }, text: `Quité ${nameOf(b)} (${n} → ${n - 1} bloques) y reconecté ${ins.length * outs.length} cable(s)` }, reshape: true };
  },
  addBlock(g, a, cfg, rng) {
    const types = (cfg.types || []).filter((t) => t === 'eye.*' || BLOCKS[t]);
    const eyeTypes = types.includes('eye.*') ? Object.keys(BLOCKS).filter((t) => isEye(t)) : types.filter((t) => isEye(t));
    const innerTypes = types.filter((t) => t !== 'eye.*' && !isEye(t));
    const n = g.blocks.length;
    const undone = (reason) => ({ op: { op: 'addBlock', before: { blocks: n }, after: { blocks: n }, text: `No añadí ningún bloque (${n} bloques)` }, undone: reason });
    let insert = rng() < 0.5;
    if (insert && (!innerTypes.length || !g.wires.length)) insert = false;
    if (!insert && !eyeTypes.length) { if (innerTypes.length && g.wires.length) insert = true; else return undone('la configuración no deja ningún tipo de bloque disponible'); }
    if (n >= LIMITS.blocks) return undone(`ya hay ${LIMITS.blocks} bloques`);
    if (insert) {
      const w = rng.pick(g.wires), type = rng.pick(innerTypes);
      const id = newBlockId(g, type);
      const params = defaultParamsOf(type);
      if (type === 'dense') { params.units = clamp(a.dims[w.from].out, 4, 64); params.activation = 'tanh'; }
      const block = { id, type, params };
      const idx = g.blocks.findIndex((b) => b.id === w.from);
      g.blocks.splice(idx + 1, 0, block);
      g.wires = g.wires.flatMap((x) => (x.from === w.from && x.to === w.to ? [{ from: w.from, to: id }, { from: id, to: w.to }] : [x]));
      const units = params.units ? ` (${params.units} neuronas)` : '';
      return { op: { op: 'addBlock', blockId: id, wire: wireKey(w), before: { blocks: n }, after: { blocks: n + 1, type, id, from: w.from, to: w.to, ...(params.units ? { units: params.units } : {}) }, text: `Añadí ${BLOCKS[type].name} ${id} entre ${w.from} y ${w.to}${units} (${n} → ${n + 1} bloques)` }, reshape: true };
    }
    const type = rng.pick(eyeTypes);
    const id = newBlockId(g, type);
    const block = { id, type, params: defaultParamsOf(type) };
    const targets = g.blocks.filter((b) => b.type === 'dense' || b.type === 'concat');
    for (const t of targets) {
      const trial = { ...g, blocks: [...g.blocks, block], wires: [...g.wires, { from: id, to: t.id }] };
      if (structuralOk(trial)) {
        g.blocks.push(block); g.wires.push({ from: id, to: t.id });
        return { op: { op: 'addBlock', blockId: id, wire: `${id}→${t.id}`, before: { blocks: n }, after: { blocks: n + 1, type, id, to: t.id }, text: `Añadí el ojo ${BLOCKS[type].name} ${id} cableado a ${nameOf(t)} (${n} → ${n + 1} bloques)` }, reshape: true };
      }
    }
    return undone(`el ojo ${BLOCKS[type].name} no encaja en ningún Instinto ni Juntar`);
  },
  removeWire(g, a, cfg, rng) {
    const outs = {}, ins = {};
    for (const w of g.wires) { outs[w.from] = (outs[w.from] || 0) + 1; ins[w.to] = (ins[w.to] || 0) + 1; }
    const cands = g.wires.filter((w) => outs[w.from] >= 2 && ins[w.to] >= 2);
    const n = g.wires.length;
    if (!cands.length) return { op: { op: 'removeWire', before: { wires: n }, after: { wires: n }, text: `No quité ningún cable (${n} cables: todos dejarían algo suelto)` }, undone: 'todos los cables dejarían un bloque sin entrada o sin salida' };
    const w = rng.pick(cands);
    g.wires = g.wires.filter((x) => !(x.from === w.from && x.to === w.to));
    return { op: { op: 'removeWire', wire: wireKey(w), before: { wires: n }, after: { wires: n - 1 }, text: `Quité el cable ${w.from} → ${w.to} (${n} → ${n - 1} cables)` }, reshape: true };
  },
  addWire(g, a, cfg, rng) {
    const n = g.wires.length;
    const keys = new Set(g.wires.map(wireKey));
    const pairs = [];
    for (const x of g.blocks) for (const y of g.blocks) if (x.id !== y.id && !isEye(y.type) && !isHead(x.type) && !keys.has(`${x.id}→${y.id}`)) pairs.push({ from: x.id, to: y.id });
    const undone = (reason) => ({ op: { op: 'addWire', before: { wires: n }, after: { wires: n }, text: `No añadí ningún cable (${n} cables)` }, undone: reason });
    if (!pairs.length) return undone('no queda ningún par de bloques sin cable');
    if (n >= LIMITS.wires) return undone(`ya hay ${LIMITS.wires} cables`);
    for (let t = 0; t < 20 && pairs.length; t++) {
      const i = rng.int(pairs.length);
      const w = pairs.splice(i, 1)[0];
      const trial = { ...g, wires: [...g.wires, w] };
      if (structuralOk(trial)) {
        g.wires.push(w);
        return { op: { op: 'addWire', wire: wireKey(w), before: { wires: n }, after: { wires: n + 1 }, text: `Añadí el cable ${w.from} → ${w.to} (${n} → ${n + 1} cables)` }, reshape: true };
      }
    }
    return undone('ningún cable nuevo de los probados es válido');
  },
  removeNeurons(g, a, cfg, rng) {
    const frozen = new Set(g.frozen);
    const cands = g.blocks.filter((b) => (b.type === 'dense' || isMemory(b.type)) && !frozen.has(b.id) && b.params.units >= 2);
    const undone = (reason) => ({ op: { op: 'removeNeurons', before: {}, after: {}, text: 'No quité neuronas' }, undone: reason });
    if (!cands.length) return undone(frozen.size ? 'no hay Instinto ni memoria con 2+ neuronas sin congelar' : 'no hay Instinto ni memoria con 2 o más neuronas');
    const b = rng.pick(cands);
    const units = b.params.units;
    const k = Math.min(rng.int(Math.max(1, cfg.max || 1)) + 1, units - 1);
    const norms = outgoingNorms(g, a, b.id, units);
    const order = Array.from({ length: units }, (_, u) => u).sort((x, y) => (norms[x] - norms[y]) || (y - x));
    const removed = order.slice(0, k).sort((x, y) => x - y);
    const kept = Array.from({ length: units }, (_, u) => u).filter((u) => !removed.includes(u));
    b.params.units = units - k;
    const unitMap = { [b.id]: kept };
    remapNames(g, b.id, unitMap);
    const list = removed.map((u) => `nº ${u}`).join(', ');
    return { op: { op: 'removeNeurons', blockId: b.id, before: { units, norms }, after: { units: units - k, removed, count: k }, text: `Quité ${k} neurona(s) de ${nameOf(b)} (${units} → ${units - k}): las de menor uso (${list})` }, reshape: true, unitMap };
  },
  addNeurons(g, a, cfg, rng) {
    const frozen = new Set(g.frozen);
    const cands = g.blocks.filter((b) => (b.type === 'dense' || isMemory(b.type)) && !frozen.has(b.id) && b.params.units < LIMITS.units);
    const undone = (reason) => ({ op: { op: 'addNeurons', before: {}, after: {}, text: 'No añadí neuronas' }, undone: reason });
    if (!cands.length) return undone(frozen.size ? 'no hay Instinto ni memoria sin congelar' : 'no hay Instinto ni memoria');
    const b = rng.pick(cands);
    const units = b.params.units;
    const k = Math.min(rng.int(Math.max(1, cfg.max || 1)) + 1, LIMITS.units - units);
    b.params.units = units + k;
    const unitMap = { [b.id]: [...Array.from({ length: units }, (_, u) => u), ...Array.from({ length: k }, (_, j) => `n${j}`)] };
    remapNames(g, b.id, unitMap);
    return { op: { op: 'addNeurons', blockId: b.id, before: { units }, after: { units: units + k, added: k }, text: `Añadí ${k} neurona(s) a ${nameOf(b)} (${units} → ${units + k})` }, reshape: true, unitMap };
  },
  activation(g, a, cfg, rng) {
    const frozen = new Set(g.frozen);
    const cands = g.blocks.filter((b) => b.type === 'dense' && !frozen.has(b.id));
    if (!cands.length) return { op: { op: 'activation', before: {}, after: {}, text: 'No cambié ninguna activación' }, undone: frozen.size ? 'no hay Instinto sin congelar' : 'no hay Instinto' };
    const b = rng.pick(cands);
    const from = b.params.activation;
    const to = rng.pick(ACTIVATIONS.filter((x) => x !== from));
    b.params.activation = to;
    return { op: { op: 'activation', blockId: b.id, before: { activation: from }, after: { activation: to }, text: `Cambié la activación de ${nameOf(b)}: ${from} → ${to}` } };
  },
  eyeParams(g, a, cfg, rng) {
    const cands = g.blocks.filter((b) => isEye(b.type) && (BLOCKS[b.type].params || []).length);
    if (!cands.length) return { op: { op: 'eyeParams', before: {}, after: {}, text: 'No cambié ningún ojo' }, undone: 'ningún ojo tiene parámetros' };
    const b = rng.pick(cands);
    const def = rng.pick(BLOCKS[b.type].params);
    const cur = b.params[def.key];
    let val;
    if (def.type === 'enum') { const others = def.options.map((o) => o.value).filter((v) => v !== cur); val = others.length ? rng.pick(others) : cur; }
    else if (def.type === 'int') {
      const delta = (rng.int(2) + 1) * (rng() < 0.5 ? -1 : 1);
      val = clamp(cur + delta, def.min, def.max);
      if (val === cur) val = clamp(cur - delta, def.min, def.max);
    } else if (def.type === 'bool') val = !cur;
    else if (def.type === 'set') {
      const all = def.options.map((o) => o.value), have = cur.slice(), missing = all.filter((v) => !have.includes(v));
      if ((rng() < 0.5 && have.length > 1) || !missing.length) { const drop = rng.pick(have); val = have.filter((v) => v !== drop); }
      else val = [...have, rng.pick(missing)];
    } else { val = clamp(cur * Math.exp(0.5 * rng.gauss()), def.min, def.max); }
    if (JSON.stringify(val) === JSON.stringify(cur)) return { op: { op: 'eyeParams', blockId: b.id, before: { [def.key]: cur }, after: { [def.key]: cur }, text: `No cambié ${nameOf(b)}` }, undone: `${def.name} no puede cambiar` };
    b.params[def.key] = val;
    const show = (v) => (Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? 'sí' : 'no') : fmt(v));
    return { op: { op: 'eyeParams', blockId: b.id, before: { [def.key]: cur }, after: { [def.key]: val }, text: `Cambié ${nameOf(b)}: ${def.name.toLowerCase()} ${show(cur)} → ${show(val)}` }, reshape: true };
  },
  imagination(g, a, cfg, rng) {
    const im = g.imagination, sigma = cfg.sigma ?? 0.2;
    const before = { n: im.n, weights: {}, on: {} }, after = { n: 0, weights: {}, on: {} };
    const delta = rng.int(5) * (rng() < 0.5 ? -1 : 1);
    im.n = clamp(im.n + delta, LIMITS.candidatesMin, LIMITS.candidatesMax);
    after.n = im.n;
    const parts = [];
    for (const f of FAMILIES) {
      const w0 = im.families[f].weight;
      const w1 = Math.round(clamp(w0 * Math.exp(sigma * rng.gauss()), 0.1, 20) * 1000) / 1000;
      im.families[f].weight = w1;
      before.weights[f] = w0; after.weights[f] = w1; before.on[f] = im.families[f].on;
      parts.push(`${FAMILY_ES[f]} ${fmt(w0)} → ${fmt(w1)}`);
    }
    let toggled = null;
    if (rng() < 0.3) {
      const f = rng.pick(FAMILIES);
      const onCount = FAMILIES.filter((x) => im.families[x].on).length;
      if (!(im.families[f].on && onCount <= 1)) { im.families[f].on = !im.families[f].on; toggled = f; }
    }
    for (const f of FAMILIES) after.on[f] = im.families[f].on;
    const tog = toggled ? `; ${im.families[toggled].on ? 'encendí' : 'apagué'} ${FAMILY_ES[toggled]}` : '';
    return { reanalyze: true, op: { op: 'imagination', before, after, text: `Imaginación: ${before.n} → ${after.n} candidatos; pesos ${parts.join(', ')}${tog}` } };
  },
  traits(g, a, cfg, rng) {
    const sigma = cfg.sigma ?? 0.15;
    const t0 = clone(g.traits), t = g.traits;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    t.temperature = r3(clamp(t.temperature * Math.exp(sigma * rng.gauss()), ...TRAIT_RANGES.temperature));
    t.pulse = r3(clamp(t.pulse * Math.exp(sigma * rng.gauss()), ...TRAIT_RANGES.pulse));
    t.teamSpirit = r3(clamp(t.teamSpirit + sigma * rng.gauss(), ...TRAIT_RANGES.teamSpirit));
    if (rng() < sigma) t.character = rng.pick(CHARACTERS.filter((c) => c !== t.character));
    const ch = t.character !== t0.character ? `, carácter ${CHAR_ES[t0.character]} → ${CHAR_ES[t.character]}` : '';
    return { op: { op: 'traits', before: t0, after: clone(t), text: `Rasgos: temperatura ${fmt(t0.temperature)} → ${fmt(t.temperature)}, pulso ${fmt(t0.pulse)} → ${fmt(t.pulse)}, espíritu de equipo ${fmt(t0.teamSpirit)} → ${fmt(t.teamSpirit)}${ch}` } };
  },
  weights(g, a, cfg, rng) {
    const sigma = cfg.sigma ?? 0.05, fraction = cfg.fraction ?? 0.3;
    const frozen = new Set(g.frozen);
    const L = labeler(g, a);
    let changed = 0, total = 0, blocks = 0;
    g.weights = { ...g.weights };
    for (const b of g.blocks) {
      const shapes = L.shapesOf(b.id);
      if (!shapes || frozen.has(b.id) || !g.weights[b.id]) continue;
      blocks++;
      g.weights[b.id] = { ...g.weights[b.id] };
      for (const key of Object.keys(shapes)) {
        const arr = g.weights[b.id][key] = g.weights[b.id][key].slice();
        for (let i = 0; i < arr.length; i++) { total++; if (rng() < fraction) { arr[i] += sigma * rng.gauss() * (1 + Math.abs(arr[i])); changed++; } }
      }
    }
    const percent = total ? Math.round((100 * changed) / total) : 0;
    return { op: { op: 'weights', before: { changed: 0, total, sigma, fraction }, after: { changed, total, blocks, percent, sigma }, text: `Moví ${changed} de ${total} pesos (${percent} %) con σ ${fmt(sigma)} en ${blocks} bloque(s)` } };
  },
  emblem(g, a, cfg, rng) {
    const before = g.emblem;
    let e;
    if (rng() < 0.5) e = rng.int(2 ** 31);
    else { e = before; for (let i = 0; i < 4; i++) e ^= 1 << rng.int(31); e = e >>> 0; if (e >= 2 ** 31) e -= 2 ** 31; }
    g.emblem = e;
    return { op: { op: 'emblem', before: { emblem: before }, after: { emblem: e }, text: e === before ? `Emblema sin cambio (${before})` : `Emblema ${before} → ${e}` } };
  },
};

function frozenTouched(prev, next) {
  for (const id of next.frozen || []) {
    const pb = prev.blocks.find((b) => b.id === id), nb = next.blocks.find((b) => b.id === id);
    if (!pb) continue;
    if (!nb) return id;
    if (JSON.stringify(pb.params) !== JSON.stringify(nb.params)) return id;
    if (JSON.stringify(prev.weights[id]) !== JSON.stringify(next.weights[id])) return id;
  }
  return null;
}

export function mutate(parent, config, rng, opts = {}) {
  const R = wrapRng(rng);
  const cfg = mutationConfig(config);
  let g = normalize(parent);
  let a = analyzeUnchecked(g);
  if (!a) throw new Error(`el genoma ${parent.id} no es válido: no se puede mutar`);
  const ops = [];
  for (const name of ORDER) {
    const c = cfg[name];
    if (!c || !c.on) continue;
    if (c.rate !== undefined && !(R() < c.rate)) continue;
    const next = shallowCopy(g);
    const res = OPS[name](next, a, c, R);
    if (res.undone) { ops.push({ ...res.op, undone: true, reason: res.undone }); continue; }
    let nextA = a;
    if (res.reshape || res.reanalyze) {
      nextA = structuralOk(next);
      if (!nextA) { ops.push({ ...res.op, undone: true, reason: structuralError(next) }); continue; }
      if (res.reshape) remapWeights(g, a, next, nextA, res.unitMap || {}, R);
    }
    const v = validate(next);
    if (!v.ok) { ops.push({ ...res.op, undone: true, reason: v.errors[0].message }); continue; }
    const touched = frozenTouched(g, next);
    if (touched) { ops.push({ ...res.op, undone: true, reason: `tocaría el bloque congelado ${touched}` }); continue; }
    ops.push(res.op);
    g = next; a = nextA;
  }
  const generation = (parent.lineage && parent.lineage.generation ? parent.lineage.generation : 0) + 1;
  // con existingNames, la primera letra libre desde la de sibling: nunca dos redes con el mismo nombre (spec/05 §10)
  const taken = opts.existingNames ? new Set([...opts.existingNames].map((x) => String(x).toLocaleLowerCase('es'))) : null;
  let s = opts.sibling || 0;
  while (taken && taken.has(childName(parent.name, generation, s).toLocaleLowerCase('es'))) s++;
  const name = childName(parent.name, generation, s);
  g.name = name;
  g.id = uniqueIdIn(slugify(name), opts.existingIds);
  g.lineage = { generation, parents: [parent.id], born: opts.now || new Date().toISOString(), mutations: ops };
  g.stats = { games: 0, wins: 0, kills: 0, deaths: 0, reigns: 0 };
  g.memory = [];
  return { child: g, ops };
}

// 🎲 Imaginación por uso (spec/05 §6, §10.6). Pura: no toca `imagination`.
export function adaptImagination(imagination, decisions) {
  const usage = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  const shots = (decisions || []).filter((d) => d && d.phase === 'shoot' && !d.error && Array.isArray(d.candidates) && d.candidates[d.chosen]);
  for (const d of shots.slice(-200)) { const f = d.candidates[d.chosen].family; if (f in usage) usage[f]++; }
  const weights = Object.fromEntries(FAMILIES.map((f) => [f, imagination.families[f].weight]));
  let changed = false;
  const total = FAMILIES.reduce((s, f) => s + usage[f], 0);
  if (imagination.adaptive && total > 0) {
    const sumW = FAMILIES.reduce((s, f) => s + weights[f], 0);
    for (const f of FAMILIES) {
      const w = clamp(0.9 * weights[f] + 0.1 * (usage[f] / total) * sumW, 0.1, 20);
      if (w !== weights[f]) changed = true;
      weights[f] = w;
    }
  }
  return { usage, weights, changed };
}
