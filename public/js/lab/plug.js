// Enchufar y desenchufar cables (sesión 12, spec/12 §5), con los gestos de Blender y Unreal. Lógica pura, sin DOM: la
// usa public/js/lab/editor.js y la prueba test/ui-enchufe.spec.mjs.
// - Desde una salida sacas un cable nuevo; desde una entrada vacía, también (al revés).
// - Desde una entrada con cables coges la punta del último que se enchufó: suéltala en el vacío y se quita; en otra
//   tarjeta que valga, se cambia de sitio; en la suya, se queda como estaba; en una que no vale, sigue donde estaba.
// - Una tarjeta sin cables soltada encima de un cable A → B se mete en medio (A → tarjeta → B), si cabe.
// - Alt + clic en un punto quita todos sus cables.
// Si algo vale o no lo decide el MISMO validate que el servidor (hints.js): lo que aquí vale, el servidor lo acepta.
import * as M from './model.js';
import { connectOptions, newErrors } from './hints.js';

const OUT_GROUPS = new Set(['hands', 'feet']);
const byId = (g, id) => (g.blocks || []).find((b) => b.id === id) || null;
const groupOf = (catalog, b) => (M.entryOf(catalog, b.type) || {}).group || (String(b.type).startsWith('eye.') ? 'eyes' : 'instinct');
const label = (catalog, g, id) => { const b = byId(g, id); return `${(b && M.entryOf(catalog, b.type) || { name: id }).name} (${id})`; };
const nada = (genome, why = '', will = why ? `No vale: ${why}` : '') => ({ action: 'nada', genome, why, will, text: '', label: '' });

// lo que coges al pulsar. where: {port: 'out' | 'in', id} o {card: id}. Devuelve {kind: 'from', from} (cable nuevo desde
// una salida), {kind: 'to', to} (cable nuevo hacia una entrada vacía), {kind: 'end', index, from, to} (la punta de un
// cable que ya estaba), {kind: 'card', id}, o null si ahí no hay punto
export function grab(genome, catalog, where) {
  const id = where.card ?? where.id;
  const b = byId(genome, id);
  if (!b) return null;
  if (where.card !== undefined) return { kind: 'card', id };
  const g = groupOf(catalog, b);
  if (where.port === 'out') return OUT_GROUPS.has(g) ? null : { kind: 'from', from: id };
  if (g === 'eyes') return null;
  const wires = genome.wires || [];
  for (let i = wires.length - 1; i >= 0; i--) if (wires[i].to === id) return { kind: 'end', index: i, from: wires[i].from, to: id };
  return { kind: 'to', to: id };
}

// dónde vale soltar lo que llevas: Map de id de tarjeta (o, con una tarjeta, índice de cable) → {ok, why, hint, back}
export function targets(genome, catalog, held) {
  const out = new Map();
  if (!held) return out;
  const put = (list) => { for (const x of list) out.set(x.id, { ok: x.ok, why: x.why, hint: x.hint || null }); };
  // las tarjetas que connectOptions ni considera (unos ojos como destino; una mano o unos pies como origen), con su porqué
  const rest = (own, why) => { for (const b of genome.blocks || []) if (b.id !== own && !out.has(b.id)) out.set(b.id, { ok: false, why: why(b), hint: null }); };
  const noOut = (b) => `${label(catalog, genome, b.id)} no tiene salida: las manos y los pies son donde acaba la red.`;
  if (held.kind === 'from') { put(connectOptions(genome, catalog, held.from).to); rest(held.from, (b) => M.connect(genome, held.from, b.id).error); }
  else if (held.kind === 'to') { put(connectOptions(genome, catalog, held.to).from); rest(held.to, noOut); }
  else if (held.kind === 'end') {
    const base = M.disconnect(genome, held.index);
    put(connectOptions(base, catalog, held.from).to);
    out.set(held.to, { ok: true, why: '', hint: null, back: true });
    rest(held.from, (b) => M.connect(base, held.from, b.id).error);
  } else if (held.kind === 'card') {
    // solo una tarjeta sin cables se mete en medio (como en Blender): así mover una tarjeta enchufada nunca cambia la red
    if ((genome.wires || []).some((w) => w.from === held.id || w.to === held.id)) return out;
    (genome.wires || []).forEach((w, i) => {
      const r = splice(genome, i, held.id);
      const e = r.error ? [{ message: r.error }] : newErrors(genome, r.genome);
      out.set(i, { ok: !e.length, why: e.length ? e[0].message : '', hint: (e[0] && e[0].example) || null });
    });
  }
  return out;
}

// A → B pasa a A → id → B con un bloque que ya está en la red (el ＋ del cable, M.insertOnWire, hace lo mismo con uno
// nuevo): el cable id → B ocupa el sitio del de antes, así B sigue juntando sus entradas en el mismo orden
function splice(genome, index, id) {
  const w = (genome.wires || [])[index];
  if (!w) return { genome, error: 'Ese cable ya no existe.' };
  if (w.from === id || w.to === id) return { genome, error: 'Ese cable ya sale o llega a este bloque.' };
  const a = M.connect(genome, w.from, id);
  if (a.error) return { genome, error: a.error };
  const b = M.connect(genome, id, w.to);
  if (b.error) return { genome, error: b.error };
  const wires = genome.wires.map((x, i) => (i === index ? { from: id, to: w.to } : x));
  return { genome: { ...genome, wires: [...wires, { from: w.from, to: id }] }, error: null };
}

// qué pasa al soltar. at: {node: id | null} (la tarjeta bajo el ratón o dentro del imán) o, con una tarjeta,
// {wire: índice | null} (el cable bajo ella). tg: lo que dio targets() al coger (se calcula si no llega).
// Devuelve {action: 'connect' | 'move' | 'remove' | 'insert' | 'nada', genome, why, will, text, label}: `will` dice qué
// pasará si sueltas ahí (el cartel que sigue al ratón), `text` es el aviso al soltar, `label` la línea del historial
// (Deshacer), y `why`, con 'nada', por qué no vale ('' si no hay queja)
export function drop(genome, catalog, held, at = {}, tg = null) {
  if (!held) return nada(genome);
  const T = tg || targets(genome, catalog, held);
  const L = (id) => label(catalog, genome, id);
  if (held.kind === 'card') {
    if (at.wire === null || at.wire === undefined) return nada(genome);
    const t = T.get(at.wire);
    if (!t) return nada(genome, 'Solo se mete en medio de un cable una tarjeta sin cables.');
    if (!t.ok) return nada(genome, `${t.why}${t.hint ? ` ${t.hint}` : ''}`, `Aquí no cabe: ${t.why}`);
    const w = genome.wires[at.wire];
    const r = splice(genome, at.wire, held.id);
    return { action: 'insert', genome: r.genome, why: '', will: `Suelta para meterlo en medio: ${L(w.from)} → ${L(held.id)} → ${L(w.to)}.`, text: `${L(held.id)} va ahora en medio: ${L(w.from)} → ${L(held.id)} → ${L(w.to)}.`, label: `${L(held.id)} en medio de ${w.from} → ${w.to}` };
  }
  const node = at.node ?? null;
  if (held.kind === 'end') {
    const w = genome.wires[held.index];
    if (node === null) return { action: 'remove', genome: M.disconnect(genome, held.index), why: '', will: `Suelta aquí para desenchufar ${L(w.from)} → ${L(w.to)}.`, text: `Desenchufado: ${L(w.from)} → ${L(w.to)}.`, label: `Quitado el cable ${w.from} → ${w.to}` };
    const t = T.get(node);
    if (!t || t.back) return nada(genome, '', 'Suelta aquí y el cable se queda como estaba.');
    if (!t.ok) return nada(genome, `${t.why}${t.hint ? ` ${t.hint}` : ''} El cable sigue donde estaba.`, `No vale: ${t.why}`);
    const r = M.connect(M.disconnect(genome, held.index), w.from, node);
    return { action: 'move', genome: r.genome, why: '', will: `Suelta para llevar el cable a ${L(node)}: ${L(w.from)} → ${L(node)}.`, text: `Cable cambiado de sitio: ${L(w.from)} ya no va a ${L(w.to)}, sino a ${L(node)}.`, label: `Cable ${w.from} → ${w.to} pasa a ${w.from} → ${node}` };
  }
  const own = held.kind === 'from' ? held.from : held.to;
  if (node === null || node === own) return nada(genome);
  const t = T.get(node);
  if (!t) return nada(genome);
  if (!t.ok) return nada(genome, `${t.why}${t.hint ? ` ${t.hint}` : ''}`, `No vale: ${t.why}`);
  const [from, to] = held.kind === 'from' ? [held.from, node] : [node, held.to];
  const r = M.connect(genome, from, to);
  if (r.error) return nada(genome, r.error);
  return { action: 'connect', genome: r.genome, why: '', will: `Suelta para unir ${L(from)} → ${L(to)}.`, text: `Unidos: ${L(from)} → ${L(to)}.`, label: `Cable ${from} → ${to}` };
}

// Alt + clic en un punto (como en Unreal): quita todos los cables que entran (side 'in') o salen (side 'out') de `id`
export function unplugAll(genome, catalog, id, side) {
  const key = side === 'in' ? 'to' : 'from';
  const removed = (genome.wires || []).filter((w) => w[key] === id);
  if (!removed.length) return { genome, removed, text: '' };
  const n = removed.length;
  return {
    genome: { ...genome, wires: genome.wires.filter((w) => w[key] !== id) },
    removed,
    text: `${n === 1 ? 'Quitado 1 cable' : `Quitados ${n} cables`} ${side === 'in' ? 'que llegaban a' : 'que salían de'} ${label(catalog, genome, id)}.`,
  };
}
