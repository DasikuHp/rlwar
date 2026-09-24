// Pistas del editor (P6; sesión 8: "que expliquen más, que sean más explícitas, y si algo no se puede, que te den una
// pista de dónde podría ir o de qué le falta a tu red para que pueda"). Lógica pura, sin DOM ni red: la usa
// public/js/lab/editor.js y la prueba test/ui-crear.spec.mjs. Todo sale del MISMO validate que usa el servidor: si una
// pista dice que un cable vale, el servidor lo acepta; si dice que no, da el mismo motivo.
import { validate } from '../../../shared/genome.js';
import * as M from './model.js';

const OUT_GROUPS = new Set(['hands', 'feet']);
const STREAM_ES = { ctx: 'contexto', cand: 'candidatos', move: 'destinos', mix: 'candidatos y destinos juntos' };
const byId = (g, id) => (g.blocks || []).find((b) => b.id === id) || null;
const groupOf = (catalog, b) => (M.entryOf(catalog, b.type) || {}).group || (String(b.type).startsWith('eye.') ? 'eyes' : 'instinct');
const nameOf = (catalog, type) => (M.entryOf(catalog, type) || { name: type }).name;
const iconOf = (catalog, type) => (M.entryOf(catalog, type) || { icon: '' }).icon;
const label = (catalog, b) => `${nameOf(catalog, b.type)} (${b.id})`;
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}`);

// solo la forma de la red (bloques y cables): sin pesos, así es ~15 veces más rápido y no depende de ellos
const shapeCheck = (g, forPlay = false) => {
  const r = validate({ ...g, weights: {} }, { forPlay });
  const keep = (x) => !String(x.code).startsWith('weights-');
  return { ok: !r.errors.some(keep), errors: r.errors.filter(keep), warnings: r.warnings.filter(keep) };
};
const sig = (x) => `${x.code}|${x.blockId ?? ''}|${x.message}`;
// errores que trae `next` y no tenía `prev` (así un cable no carga con los errores que ya había)
function newErrors(prev, next) {
  const had = new Set(shapeCheck(prev).errors.map(sig));
  return shapeCheck(next).errors.filter((e) => !had.has(sig(e)));
}

// ---------- lo que hace cada bloque, en una línea ----------
// dims = outDims(genome) del servidor ({stream, dim} por bloque) o null si la red aún tiene errores
export function roleOf(catalog, genome, block, dims = null) {
  const e = M.entryOf(catalog, block.type) || { group: 'instinct' };
  const d = dims && dims[block.id];
  const n = d ? d.dim : null;
  const N = genome.imagination && genome.imagination.n;
  const per = d && d.stream === 'cand' ? ` por cada uno de sus ${N} tiros imaginados` : d && d.stream === 'move' ? ' por cada uno de los 9 sitios adonde moverse' : '';
  const p = block.params || {};
  switch (block.type) {
    case 'hand.choose': return `escoge 1 de los ${N} tiros que imagina`;
    case 'hand.adjust': return `afina ${p.params ?? 'unos'} números del tiro elegido`;
    case 'hand.value': return 'calcula cuánto cree que va a ganar';
    case 'foot.move': return p.adjust ? 'escoge 1 de 9 sitios y lo afina' : 'escoge 1 de 9 sitios adonde moverse';
    case 'dense': return `piensa con ${p.units} neuronas${per}`;
    case 'concat': return n === null ? 'pone sus entradas una detrás de otra' : `junta sus entradas: ${n} números${per}`;
    case 'add': return 'suma sus entradas (del mismo tamaño)';
    case 'mul': return 'multiplica sus entradas: una hace de puerta';
    case 'skip': return 'deja pasar la señal tal cual (atajo)';
    case 'norm': return 'recentra y reescala la señal';
    case 'attention': return `mira todos los ${d && d.stream === 'ctx' ? 'candidatos' : 'tiros'} con ${p.heads} cabeza${p.heads === 1 ? '' : 's'} y da un resumen`;
    case 'pool': return `resume todos los tiros o sitios en un vector (${p.op === 'max' ? 'máximo' : 'media'})`;
    case 'echo': case 'gru': case 'lstm': return `recuerda ${p.units} números de un turno al siguiente`;
    case 'teamMemory': return `comparte ${p.units} números de recuerdo con sus compañeros`;
    default:
      if (e.group === 'eyes') return n === null ? 'mira el tablero' : `ve ${n} número${n === 1 ? '' : 's'}${per}`;
      return n === null ? '' : `da ${n} números${per}`;
  }
}

// ---------- quién da cada corriente ----------
// bloques que pueden alimentar a otros (las manos y los pies son el final del camino) y dan la corriente `stream`
export function suppliers(genome, catalog, stream) {
  const st = M.streams(genome, catalog);
  return (genome.blocks || []).filter((b) => !OUT_GROUPS.has(groupOf(catalog, b)) && st[b.id] === stream);
}
const NEED = {
  cand: (catalog) => `algo que dé candidatos (los tiros que imagina): ${iconOf(catalog, 'eye.candidates')} Candidatos o ${iconOf(catalog, 'eye.simulator')} Simulador, en Ojos`,
  move: (catalog) => `algo que dé destinos (los sitios adonde moverse): ${iconOf(catalog, 'eye.moves')} Destinos, en Ojos`,
  ctx: (catalog) => `algo que dé contexto (lo que ve el soldado una vez por turno): ${iconOf(catalog, 'eye.features')} Rasgos, ${iconOf(catalog, 'eye.radar')} Radar… en Ojos, o un Instinto sobre ellos`,
  kv: () => 'algo que dé candidatos o destinos para resumir',
};
// qué corriente necesita un tipo de bloque para funcionar (null = cualquiera)
function needs(type) {
  if (type === 'hand.choose' || type === 'hand.adjust') return 'cand';
  if (type === 'foot.move') return 'move';
  if (type === 'hand.value' || ['echo', 'gru', 'lstm', 'teamMemory'].includes(type)) return 'ctx';
  if (type === 'attention' || type === 'pool') return 'kv';
  return null;
}

// ---------- la paleta: ¿se puede añadir? y si no, ¿qué le falta? ----------
// Barata (sin validate): se calcula en cada pintado. {can, why} — why explica en una frase por qué no, o dónde irá.
export function advice(genome, catalog, type) {
  const g = genome || { blocks: [], wires: [] };
  const e = M.entryOf(catalog, type);
  if (!e) return { can: false, why: 'Tipo de bloque desconocido.' };
  if (OUT_GROUPS.has(e.group) && type !== 'hand.value') {
    const had = g.blocks.find((b) => b.type === type);
    if (had) return { can: false, why: `Ya tienes ${e.name} (${had.id}): solo puede haber uno por red. Para cambiarlo, selecciónalo en el lienzo.` };
  }
  if (type === 'hand.value') { const had = g.blocks.find((b) => b.type === type); if (had) return { can: false, why: `Ya tienes ${e.name} (${had.id}): solo puede haber uno por red.` }; }
  if (type === 'hand.adjust' && !g.blocks.some((b) => b.type === 'hand.choose')) return { can: true, why: 'Afina el tiro que escoge Elegir: sin Elegir no hace nada. Añade también Elegir y dale los mismos candidatos.' };
  if (e.group === 'eyes') return { can: true, why: `No recibe cables: después une su punto de salida a un Instinto${type === 'eye.candidates' || type === 'eye.simulator' ? ' o directamente a Elegir' : type === 'eye.moves' ? ' o directamente a Moverse' : ', una Memoria o una mano'}.` };
  const need = needs(type);
  if (need) {
    const have = need === 'kv' ? [...suppliers(g, catalog, 'cand'), ...suppliers(g, catalog, 'move')] : suppliers(g, catalog, need);
    if (!have.length) return { can: true, why: `Se puede añadir, pero para funcionar le falta ${NEED[need](catalog)}. Añádelo antes.`, missing: need };
    return { can: true, why: `Irá detrás de ${list(have.map((b) => label(catalog, b)))}.` };
  }
  return { can: true, why: 'Va en medio del camino: recibe de unos Ojos (u otro bloque) y da a otro bloque o a una mano.' };
}

// ---------- conectar: qué cables valen desde y hacia un bloque, y por qué no los demás ----------
// {from: [{id, ok, why}], to: [{id, ok, why}]}: `why` es el primer error nuevo que traería ese cable (el del servidor)
export function connectOptions(genome, catalog, id) {
  const me = byId(genome, id);
  if (!me) return { from: [], to: [] };
  const already = (a, b) => (genome.wires || []).some((w) => w.from === a && w.to === b);
  const test = (from, to) => {
    if (already(from, to)) return { ok: false, why: 'Ya están unidos.' };
    const r = M.connect(genome, from, to);
    if (r.error) return { ok: false, why: r.error };
    const errs = newErrors(genome, r.genome);
    return errs.length ? { ok: false, why: errs[0].message, hint: errs[0].example || null } : { ok: true, why: '' };
  };
  const others = (genome.blocks || []).filter((b) => b.id !== id);
  const meGroup = groupOf(catalog, me);
  const from = meGroup === 'eyes' ? [] : others.filter((b) => !OUT_GROUPS.has(groupOf(catalog, b))).map((b) => ({ id: b.id, ...test(b.id, id) }));
  const to = OUT_GROUPS.has(meGroup) ? [] : others.filter((b) => groupOf(catalog, b) !== 'eyes').map((b) => ({ id: b.id, ...test(id, b.id) }));
  return { from, to };
}

// ---------- ¿puede jugar? la lista de lo imprescindible y de lo recomendable, con qué añadir ----------
// [{key, ok, required, text, need, add: [tipos], wire: [from, to] | null}]
export function readiness(genome, catalog) {
  const g = genome || { blocks: [], wires: [] };
  const has = (t) => g.blocks.find((b) => b.type === t) || null;
  const st = M.streams(g, catalog);
  const choose = has('hand.choose');
  const cands = suppliers(g, catalog, 'cand');
  const ins = (id) => (g.wires || []).filter((w) => w.to === id).map((w) => w.from);
  const chooseFed = !!choose && ins(choose.id).some((x) => st[x] === 'cand') && !ins(choose.id).some((x) => st[x] === 'move' || st[x] === 'mix');
  const seesShots = !!(has('eye.candidates') || has('eye.simulator'));
  const out = [
    { key: 'shots', ok: seesShots, required: true, text: 'Imagina tiros: tiene Candidatos o Simulador',
      need: 'Añade 🎯 Candidatos (en Ojos): cada turno se imagina varios tiros posibles y los ve como números (familia, forma, puntería).', add: seesShots ? [] : ['eye.candidates'] },
    { key: 'choose', ok: !!choose, required: true, text: 'Escoge un tiro: tiene Elegir',
      need: 'Añade 🎯 Elegir (en Manos): puntúa cada tiro imaginado y escoge uno. Sin él no puede disparar.', add: choose ? [] : ['hand.choose'] },
    { key: 'fed', ok: chooseFed, required: true, text: 'Elegir recibe los tiros imaginados',
      need: choose ? `Une Candidatos (o un Instinto que los reciba) con Elegir (${choose.id}).` : 'Cuando tenga Elegir, únele Candidatos.',
      wire: choose && !chooseFed && cands.length === 1 ? [cands[0].id, choose.id] : null },
    { key: 'think', ok: !!choose && ins(choose.id).some((x) => { const b = byId(g, x); return b && b.type !== 'concat' && !String(b.type).startsWith('eye.'); }), required: false, text: 'Piensa antes de escoger: hay un Instinto antes de Elegir',
      need: 'Sin Instinto, Elegir puntúa cada tiro con una sola suma de lo que ve: aprende poco. Pon un 🧠 Instinto entre Candidatos y Elegir.', add: [] },
    { key: 'move', ok: !!has('foot.move'), required: false, text: 'Se mueve tras disparar: tiene Destinos → Moverse',
      need: 'Sin Pies se queda quieta después de cada tiro: vale, pero es un blanco fácil. Añade 🦶 Destinos (Ojos) y 🦶 Moverse (Pies) y únelos.', add: [has('eye.moves') ? null : 'eye.moves', has('foot.move') ? null : 'foot.move'].filter(Boolean) },
    { key: 'memory', ok: g.blocks.some((b) => ['echo', 'gru', 'lstm', 'teamMemory'].includes(b.type)), required: false, text: 'Recuerda entre turnos: tiene Memoria',
      need: 'Sin Memoria cada turno empieza de cero: no sabe qué tiró antes ni si falló. 🌀 Eco (o GRU) sobre Rasgos lo arregla.', add: [] },
  ];
  return out;
}

// ---------- arreglar con un clic: solo cuando el error tiene UNA solución ----------
// [{code, label, apply(genome) → genome}] — si hay varias formas de arreglarlo, no hay botón (lo dice la pista)
export function fixes(genome, catalog, check = null) {
  const g = genome;
  const c = check || shapeCheck(g);
  const out = [];
  const all = [...c.errors, ...c.warnings];
  const seen = new Set();
  const push = (f) => { if (!seen.has(f.key)) { seen.add(f.key); out.push(f); } };
  const wireAt = (i) => (g.wires || [])[i];
  for (const x of all) {
    if ((x.code === 'duplicate-wire' || x.code === 'wire-ref') && Number.isInteger(x.wire) && wireAt(x.wire)) {
      const w = wireAt(x.wire);
      push({ key: `${x.code}:${x.wire}`, code: x.code, label: x.code === 'duplicate-wire' ? `Quitar el cable repetido ${w.from} → ${w.to}` : `Quitar el cable ${w.from} → ${w.to} (un extremo no existe)`, apply: (h) => M.disconnect(h, x.wire) });
    }
    if (x.code === 'stream-mix' && Number.isInteger(x.wire) && wireAt(x.wire)) {
      const w = wireAt(x.wire);
      push({ key: `into-eye:${x.wire}`, code: x.code, label: `Quitar el cable ${w.from} → ${w.to} (los ojos no reciben)`, apply: (h) => M.disconnect(h, x.wire) });
    }
    if (x.code === 'frozen-ref') {
      push({ key: 'frozen-ref', code: x.code, label: 'Olvidar los bloques congelados que ya no existen', apply: (h) => ({ ...h, frozen: (h.frozen || []).filter((id) => h.blocks.some((b) => b.id === id)) }) });
    }
    // Elegir/Ajustar/Moverse sin su corriente, y hay UN solo bloque que la da y no está unido: unirlo
    if (x.code === 'stream-mix' && x.blockId && !Number.isInteger(x.wire)) {
      const b = byId(g, x.blockId);
      const need = b && needs(b.type);
      if (need === 'cand' || need === 'move') {
        const sup = suppliers(g, catalog, need).filter((s) => !(g.wires || []).some((w) => w.from === s.id && w.to === b.id));
        if (sup.length === 1) push({ key: `feed:${b.id}`, code: x.code, label: `Unir ${label(catalog, sup[0])} con ${label(catalog, b)}`, apply: (h) => M.connect(h, sup[0].id, b.id).genome });
      }
    }
    // le falta Elegir y hay UN solo sitio del que colgarlo (un bloque de candidatos que no alimenta a nadie)
    if (x.code === 'missing-choose') {
      const ends = suppliers(g, catalog, 'cand').filter((s) => !(g.wires || []).some((w) => w.from === s.id));
      if (ends.length === 1) push({ key: 'missing-choose', code: x.code, label: `Añadir Elegir detrás de ${label(catalog, ends[0])}`, apply: (h) => { const r = M.addBlock(h, 'hand.choose', catalog); return M.connect(r.genome, ends[0].id, r.id).genome; } });
    }
  }
  return out;
}

// ---------- una pista para cada error o aviso, en palabras de la persona ----------
// además del mensaje del servidor (que ya dice qué pasa), qué hacer: una frase con el siguiente paso
export function hintFor(genome, catalog, issue) {
  const b = issue.blockId ? byId(genome, issue.blockId) : null;
  switch (issue.code) {
    case 'missing-choose': return 'Añade 🎯 Elegir (Manos) y únele Candidatos, directamente o a través de un Instinto.';
    case 'unconnected': {
      if (!b) return 'Únelo a un camino que vaya de unos Ojos a una mano, o quítalo.';
      const g = groupOf(catalog, b);
      if (g === 'eyes') return `Une su punto de salida a un Instinto, una Memoria o una mano; si no, lo que ve no llega a ninguna decisión.`;
      if (OUT_GROUPS.has(g)) return `Dale una entrada: une a ${label(catalog, b)} algo que venga de unos Ojos.`;
      return `Tiene que recibir de unos Ojos (o de un bloque que los reciba) y dar a una mano o a otro bloque. Si no lo necesitas, quítalo.`;
    }
    case 'stream-mix':
      if (b && ['echo', 'gru', 'lstm', 'teamMemory'].includes(b.type)) return 'La memoria recuerda un vector por soldado. Pon 👁‍🗨 Atención o 🧮 Resumen entre los candidatos y la memoria: convierten los tiros en un resumen.';
      if (b && (b.type === 'hand.choose' || b.type === 'hand.adjust')) return `Necesita la corriente de candidatos: únele 🎯 Candidatos o 🔮 Simulador (o un Instinto que los reciba).`;
      if (b && b.type === 'foot.move') return 'Necesita la corriente de destinos: únele 🦶 Destinos (o un Instinto que los reciba).';
      return issue.example || '';
    case 'cycle': return 'Quita uno de los cables del bucle. Si lo que quieres es recordar, usa una Memoria: recuerda de un turno al siguiente sin bucles.';
    case 'dim': return 'Sumar y Multiplicar necesitan entradas del mismo tamaño: pon delante un 🧠 Instinto con el mismo número de neuronas en cada rama, o usa 🔗 Juntar.';
    case 'duplicate-hand': return 'Quita uno de los dos (selecciónalo y pulsa «Quitar bloque»).';
    default: return issue.example || '';
  }
}

// ---------- pesos de un bloque, en barras (el Quirófano en pequeño) ----------
// {total, zeros, maxAbs, bins: [{lo, hi, n}]}: `bins` impar y simétrico, así el cero cae en la barra del medio; los
// ceros exactos se cuentan aparte para que se vean aunque sean pocos
export function weightHistogram(genome, blockId, bins = 21) {
  const w = (genome.weights || {})[blockId];
  const vals = w ? Object.values(w).flatMap((a) => (Array.isArray(a) ? a : [])) : [];
  const total = vals.length;
  if (!total) return { total: 0, zeros: 0, maxAbs: 0, bins: [] };
  let maxAbs = 0, zeros = 0;
  for (const v of vals) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; if (v === 0) zeros++; }
  const k = bins % 2 ? bins : bins + 1;
  const width = (2 * (maxAbs || 1)) / k;
  const out = Array.from({ length: k }, (_, i) => ({ lo: -(maxAbs || 1) + i * width, hi: -(maxAbs || 1) + (i + 1) * width, n: 0 }));
  for (const v of vals) out[Math.min(k - 1, Math.max(0, Math.floor((v + (maxAbs || 1)) / width)))].n++;
  return { total, zeros, maxAbs, bins: out };
}

export const streamName = (s) => STREAM_ES[s] || s;
export { shapeCheck };
