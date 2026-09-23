// Lógica pura del editor de redes (parte 4, spec/08 §1 y §4): sin DOM ni red. La usan public/js/lab/editor.js
// en el navegador y test/ui-editor.spec.mjs. Todas las operaciones devuelven copias: el genoma original no cambia.

export const LEVELS = ['aprendiz', 'artesano', 'cientifico'];
export const LEVEL_NAMES = { aprendiz: 'Aprendiz', artesano: 'Artesano', cientifico: 'Científico' };
// nada se bloquea por nivel (plan2 ronda 8): el nivel solo decide cuánto se ve
export const atLevel = (itemLevel, level) => LEVELS.indexOf(itemLevel || 'aprendiz') <= LEVELS.indexOf(level);

export const GROUPS = [
  { key: 'eyes', name: 'Ojos', ask: 'qué ve' },
  { key: 'instinct', name: 'Instinto', ask: 'cómo piensa' },
  { key: 'memory', name: 'Memoria', ask: 'qué recuerda' },
  { key: 'hands', name: 'Manos', ask: 'qué hace' },
  { key: 'feet', name: 'Pies', ask: 'adónde va' },
];
const OUTPUT_GROUPS = new Set(['hands', 'feet']);

export const entryOf = (catalog, type) => catalog.blocks.find((b) => b.type === type) || null;

export function palette(catalog, level) {
  return GROUPS.map((g) => ({ ...g, blocks: catalog.blocks.filter((b) => b.group === g.key && atLevel(b.level, level)) })).filter((g) => g.blocks.length);
}

export const paramsAt = (entry, level) => ((entry && entry.params) || []).filter((p) => atLevel(p.level, level));

// ---------- ids ----------
// los mismos prefijos que usan las plantillas (f, c, d, g, ch, m, fm…); si está cogido, d2, d3…
const PREFIX = {
  'eye.map': 'map', 'eye.features': 'f', 'eye.obstacles': 'ob', 'eye.history': 'h', 'eye.radar': 'r', 'eye.clock': 'k',
  'eye.mates': 'cm', 'eye.candidates': 'c', 'eye.simulator': 'sim', 'eye.moves': 'm',
  dense: 'd', concat: 'cat', add: 'sum', mul: 'mul', skip: 'sk', norm: 'n', attention: 'at', pool: 'p',
  echo: 'e', gru: 'g', lstm: 'l', teamMemory: 'tm',
  'hand.choose': 'ch', 'hand.adjust': 'aj', 'foot.move': 'fm', 'hand.value': 'v',
};
export function newBlockId(genome, type) {
  const used = new Set(((genome && genome.blocks) || []).map((b) => b.id));
  const p = PREFIX[type] || String(type).replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'b';
  if (!used.has(p)) return p;
  for (let n = 2; ; n++) if (!used.has(p + n)) return p + n;
}

// ---------- bloques y cables ----------
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function addBlock(genome, type, catalog) {
  const entry = entryOf(catalog, type);
  if (!entry) throw new Error(`Tipo de bloque desconocido: ${type}`);
  const id = newBlockId(genome, type);
  const params = Object.fromEntries((entry.params || []).map((p) => [p.key, clone(p.default)]));
  return { genome: { ...genome, blocks: [...genome.blocks, { id, type, params }] }, id };
}

export function removeBlock(genome, id) {
  const g = { ...genome, blocks: genome.blocks.filter((b) => b.id !== id), wires: (genome.wires || []).filter((w) => w.from !== id && w.to !== id) };
  if (genome.weights && typeof genome.weights === 'object') { const { [id]: _gone, ...rest } = genome.weights; g.weights = rest; }
  if (Array.isArray(genome.frozen)) g.frozen = genome.frozen.filter((x) => x !== id);
  if (genome.names && genome.names.neurons && id in genome.names.neurons) {
    const { [id]: _n, ...neurons } = genome.names.neurons;
    g.names = { ...genome.names, neurons };
  }
  return g;
}

const isEye = (type) => String(type).startsWith('eye.');
export function connect(genome, from, to) {
  const byId = new Map(genome.blocks.map((b) => [b.id, b]));
  const fail = (error) => ({ genome, error });
  for (const id of [from, to]) if (!byId.has(id)) return fail(`El bloque "${id}" no existe.`);
  if (from === to) return fail('Un bloque no puede conectarse consigo mismo: dentro de un turno la señal solo va hacia delante.');
  if (isEye(byId.get(to).type)) return fail(`Los ojos no tienen entradas: "${to}" solo mira el tablero. Conecta su salida a otro bloque.`);
  if ((genome.wires || []).some((w) => w.from === from && w.to === to)) return fail(`Ese cable ya existe (${from} → ${to}).`);
  return { genome: { ...genome, wires: [...(genome.wires || []), { from, to }] }, error: null };
}

export const disconnect = (genome, index) => ({ ...genome, wires: (genome.wires || []).filter((_, i) => i !== index) });

// ---------- ajustes ----------
// convierte lo que llega de un control (texto, número, casilla, lista) al tipo del parámetro del catálogo;
// si no se puede, devuelve `current` (el control vuelve a su valor)
export function coerce(param, raw, current) {
  const clamp = (n) => Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, n));
  switch (param.type) {
    case 'int': { const n = Number(raw); return raw === '' || raw === null || !Number.isFinite(n) ? current : clamp(Math.round(n)); }
    case 'number': { const n = Number(raw); return raw === '' || raw === null || !Number.isFinite(n) ? current : clamp(n); }
    case 'bool': return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
    case 'enum': { const o = (param.options || []).find((x) => String(x.value) === String(raw)); return o ? o.value : current; }
    case 'set': { const want = new Set((Array.isArray(raw) ? raw : [raw]).map(String)); return (param.options || []).filter((o) => want.has(String(o.value))).map((o) => o.value); }
    default: return raw;
  }
}

export function setParam(genome, blockId, param, raw) {
  return {
    ...genome,
    blocks: genome.blocks.map((b) => (b.id !== blockId ? b : { ...b, params: { ...(b.params || {}), [param.key]: coerce(param, raw, (b.params || {})[param.key]) } })),
  };
}

export function getPath(obj, path) {
  let v = obj;
  for (const k of String(path).split('.')) { if (v === null || typeof v !== 'object') return undefined; v = v[k]; }
  return v;
}
export function setPath(obj, path, value) {
  const [k, ...rest] = String(path).split('.');
  const base = obj && typeof obj === 'object' ? obj : {};
  return { ...base, [k]: rest.length ? setPath(base[k], rest.join('.'), value) : value };
}

// ---------- corrientes (spec/02 §3.2) ----------
// ctx = una vez por soldado · cand = una vez por candidato de disparo · move = una vez por destino.
// Es la misma regla que outDims, pero no se para ante un genoma roto: 'mix' marca candidatos + destinos juntos.
export function streams(genome, catalog) {
  const blocks = genome.blocks || [];
  const ins = new Map(blocks.map((b) => [b.id, []]));
  for (const w of genome.wires || []) if (ins.has(w.to) && ins.has(w.from)) ins.get(w.to).push(w.from);
  const out = {};
  const outOf = (b, inStreams) => {
    const e = entryOf(catalog, b.type);
    const decl = e && e.streams ? e.streams.out : 'same';
    if (isEye(b.type)) return decl;
    if (decl !== 'same') return decl;
    if (inStreams.includes('mix') || (inStreams.includes('cand') && inStreams.includes('move'))) return 'mix';
    return inStreams.includes('cand') ? 'cand' : inStreams.includes('move') ? 'move' : 'ctx';
  };
  // pasadas hasta que nada cambie (como mucho una por bloque): un bucle no cuelga el cálculo
  for (let pass = 0; pass <= blocks.length; pass++) {
    let changed = false;
    for (const b of blocks) {
      const s = outOf(b, ins.get(b.id).map((id) => out[id]).filter(Boolean));
      if (out[b.id] !== s) { out[b.id] = s; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

// ---------- colocación por columnas del cuerpo ----------
// columna = profundidad (camino más largo desde los ojos): todo cable va hacia la derecha, como la señal dentro de
// un turno. Los ojos, siempre en la primera; las manos y los pies que no alimentan a nadie, en la última.
export const NODE = { w: 156, h: 46 };
const COL_W = 204, ROW_H = 66, PAD_X = 28, PAD_Y = 64;

export function layout(genome, catalog, saved = {}) {
  const blocks = genome.blocks || [];
  const ids = new Set(blocks.map((b) => b.id));
  const wires = (genome.wires || []).filter((w) => ids.has(w.from) && ids.has(w.to));
  const ins = new Map(blocks.map((b) => [b.id, []])), outs = new Map(blocks.map((b) => [b.id, []]));
  for (const w of wires) { ins.get(w.to).push(w.from); outs.get(w.from).push(w.to); }
  const group = (b) => { const e = entryOf(catalog, b.type); return e ? e.group : isEye(b.type) ? 'eyes' : 'instinct'; };

  // orden topológico (Kahn, en el orden del genoma); lo que queda fuera está en un bucle
  const indeg = new Map(blocks.map((b) => [b.id, ins.get(b.id).length]));
  const order = [], queue = blocks.filter((b) => !indeg.get(b.id)).map((b) => b.id);
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const nx of outs.get(id)) { indeg.set(nx, indeg.get(nx) - 1); if (!indeg.get(nx)) queue.push(nx); }
  }
  const depth = {};
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const place = (id) => {
    const b = byId.get(id);
    if (group(b) === 'eyes') return 0;
    const known = ins.get(id).filter((x) => x in depth).map((x) => depth[x]);
    return known.length ? 1 + Math.max(...known) : 1; // un bloque suelto no se pone con los ojos
  };
  for (const id of order) depth[id] = place(id);
  for (const b of blocks) if (!(b.id in depth)) depth[b.id] = place(b.id);
  const isOutSink = (b) => OUTPUT_GROUPS.has(group(b)) && !outs.get(b.id).length;
  const last = Math.max(1, ...blocks.filter((b) => !isOutSink(b)).map((b) => depth[b.id] + 1), ...blocks.filter(isOutSink).map((b) => depth[b.id]));
  for (const b of blocks) if (isOutSink(b)) depth[b.id] = last;

  // filas: ojos por corriente (contexto, candidatos, destinos); después, baricentro de las entradas
  const st = streams(genome, catalog);
  const rank = { ctx: 0, cand: 1, move: 2 };
  const cols = Array.from({ length: last + 1 }, () => []);
  for (const b of blocks) cols[depth[b.id]].push(b.id);
  const rowOf = {};
  cols.forEach((col, c) => {
    const key = (id, i) => (c === 0 ? (rank[st[id]] ?? 3) * 1000 + i : (() => { const r = ins.get(id).filter((x) => x in rowOf).map((x) => rowOf[x]); return r.length ? r.reduce((s, v) => s + v, 0) / r.length : 1e6 + i; })());
    const sorted = col.map((id, i) => ({ id, i, k: key(id, i) })).sort((a, b) => a.k - b.k || a.i - b.i);
    sorted.forEach((x, r) => { rowOf[x.id] = r; col[r] = x.id; });
  });
  const rows = Math.max(1, ...cols.map((c) => c.length));
  const nodes = {};
  cols.forEach((col, c) => col.forEach((id, r) => {
    nodes[id] = { x: PAD_X + c * COL_W, y: PAD_Y + ((rows - col.length) / 2 + r) * ROW_H, col: c };
  }));
  for (const [id, p] of Object.entries(saved || {})) if (nodes[id] && p && Number.isFinite(p.x) && Number.isFinite(p.y)) nodes[id] = { ...nodes[id], x: p.x, y: p.y };

  const label = (c) => {
    if (c === 0) return 'Ojos';
    if (c === last) return 'Manos y pies';
    const present = GROUPS.filter((g) => g.key !== 'eyes' && cols[c].some((id) => group(byId.get(id)) === g.key)).map((g) => g.name);
    if (!present.length) return '';
    return present.map((n, i) => (i ? n.toLowerCase() : n)).join(', ').replace(/, ([^,]+)$/, ' y $1');
  };
  const colList = cols.map((_, c) => ({ x: PAD_X + c * COL_W, label: label(c) }));
  const xs = Object.values(nodes).map((n) => n.x), ys = Object.values(nodes).map((n) => n.y);
  return {
    nodes, cols: colList,
    width: Math.max(PAD_X * 2 + last * COL_W + NODE.w, ...xs.map((x) => x + NODE.w + PAD_X)),
    height: Math.max(PAD_Y + rows * ROW_H + PAD_X, ...ys.map((y) => y + NODE.h + PAD_X)),
  };
}

// ---------- avisos de validate, por bloque o por cable ----------
export function issuesOf(result) {
  const out = { byBlock: {}, byWire: {}, general: [] };
  const put = (x, kind) => {
    const item = { kind, code: x.code, message: x.message, example: x.example || null, blockId: x.blockId ?? null, wire: x.wire ?? null };
    if (typeof x.blockId === 'string' && x.blockId) (out.byBlock[x.blockId] ||= []).push(item);
    else if (Number.isInteger(x.wire)) (out.byWire[x.wire] ||= []).push(item);
    else out.general.push(item);
  };
  for (const e of (result && result.errors) || []) put(e, 'error');
  for (const w of (result && result.warnings) || []) put(w, 'warning');
  return out;
}
