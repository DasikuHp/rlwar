// Tutorial de la etapa Crear (spec/12 §4, aprobado en la sesión 12; relevo s12 §4.2): los 8 capítulos y la graduación,
// como datos para engine.js. Reutiliza las preguntas y los «lo que ha cambiado» con números reales de la guía de la
// sesión 10 (coach.js), que sigue probada por test/ui-coach.spec.mjs. Lógica pura: sin DOM (los objetivos son
// selectores o claves `data-tut`, que resuelve overlay.js) y sin red (los «Hazlo por mí» que cambian el genoma son puros:
// applyGenome; los demás los hace el editor). La prueba es test/ui-tutorial.spec.mjs.
import * as M from '../../lab/model.js';
import { readiness } from '../../lab/hints.js';
import { STEPS as COACH } from '../../lab/coach.js';
import { validate } from '../../../../shared/genome.js';

const co = (k) => COACH.find((s) => s.key === k);
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '—');
const MEMORY = ['echo', 'gru', 'lstm', 'teamMemory'];
export const idOf = (g, t) => {
  if (!g) return null;
  if (t === 'think') { const b = thinkBlock(g); return b ? b.id : null; }
  return ((g.blocks || []).find((b) => b.type === t) || {}).id || null;
};
const has = (g, t) => !!idOf(g, t);
const ins = (g, id) => (g.wires || []).filter((w) => w.to === id).map((w) => w.from);
const outs = (g, id) => (g.wires || []).filter((w) => w.from === id).map((w) => w.to);
const typeOf = (g, id) => ((g.blocks || []).find((b) => b.id === id) || {}).type;
const ready = (x, k) => (x.ready || []).some((r) => r.key === k && r.ok);
const more = (x, b, k) => ((x.ev && x.ev[k]) || 0) > ((b && b.ev && b.ev[k]) || 0);
// «tu Instinto»: el que alimenta a Elegir (si no hay, el primero)
function thinkBlock(g) {
  const ch = (g.blocks || []).find((b) => b.type === 'hand.choose');
  const fromCh = ch && ins(g, ch.id).map((id) => g.blocks.find((b) => b.id === id)).find((b) => b && b.type === 'dense');
  return fromCh || (g.blocks || []).find((b) => b.type === 'dense') || null;
}
// el primer cable que va de un bloque de tipo a a uno de tipo b ('think' = tu Instinto)
export function wireIndex(g, a, b) {
  if (!g) return -1;
  const A = a === 'think' ? idOf(g, 'think') : null, B = b === 'think' ? idOf(g, 'think') : null;
  return (g.wires || []).findIndex((w) => (A ? w.from === A : typeOf(g, w.from) === a) && (B ? w.to === B : typeOf(g, w.to) === b));
}
const chain2 = (g) => { // Instinto → Instinto → Elegir
  const ch = idOf(g, 'hand.choose');
  return !!ch && ins(g, ch).some((d) => typeOf(g, d) === 'dense' && ins(g, d).some((d0) => typeOf(g, d0) === 'dense'));
};

// ---------- el estado que miran los pasos ----------
// ui: lo que sabe el editor (escena, pestañas, cable bajo el ratón, contadores de acciones `ev`…)
export function buildCtx(genome, ui = {}, catalog) {
  const g = genome || null;
  const th = g ? thinkBlock(g) : null;
  return {
    ...ui, net: !!g, g, ev: ui.ev || {},
    ready: g ? readiness(g, catalog) : [],
    errors: ui.errors ?? (g ? validate(g).errors.length : 0),
    canPlay: ui.canPlay ?? (g ? validate(g, { forPlay: true }).ok : false),
    think: th && th.params ? th.params.units : null,
  };
}

// ---------- selectores ----------
const S = {
  pal: (t) => `.pal [data-add="${t}"]`,
  node: (x, t) => { const id = idOf(x.g, t); return id ? `#edBoard [data-node="${id}"]` : null; },
  port: (x, t, side = 'out') => { const id = idOf(x.g, t); return id ? `#edBoard [data-node="${id}"] .port.${side}` : null; },
  wire: (x, a, b) => { const i = wireIndex(x.g, a, b); return i >= 0 ? `#edBoard svg.wires path.hit[data-wire="${i}"]` : null; },
};

// ---------- «Hazlo por mí» y los cambios que hace el Sistema en los retos ----------
// la parte que cambia el genoma (pura); el editor hace además lo de la interfaz (escena, pestañas, guardar…)
export function applyGenome(genome, h, catalog) {
  let g = genome;
  if (!g || !h) return g;
  const link = (a, b) => { const A = idOf(g, a), B = idOf(g, b); if (!A || !B || (g.wires || []).some((w) => w.from === A && w.to === B)) return; const r = M.connect(g, A, B); if (!r.error) g = r.genome; };
  for (const t of h.remove || []) { const id = idOf(g, t); if (id) g = M.removeBlock(g, id); }
  if (h.unwire) { const i = wireIndex(g, h.unwire[0], h.unwire[1]); if (i >= 0) g = M.disconnect(g, i); }
  if (h.unwireInto) { const id = idOf(g, h.unwireInto); if (id) g = { ...g, wires: g.wires.filter((w) => w.to !== id) }; }
  for (const t of h.add || []) if (!has(g, t)) g = M.addBlock(g, t, catalog).genome;
  for (const w of [h.wire, h.wire2, h.wire3]) if (w) link(w[0], w[1]);
  if (h.insert) { const i = wireIndex(g, h.insert.on[0], h.insert.on[1]); if (i >= 0) g = M.insertOnWire(g, i, h.insert.type, catalog).genome; }
  if (h.param) {
    const id = idOf(g, h.param.type), blk = id && g.blocks.find((b) => b.id === id), e = blk && M.entryOf(catalog, blk.type);
    const p = e && (e.params || []).find((q) => q.key === h.param.key);
    if (p) g = M.setParam(g, id, p, h.param.value);
  }
  if (h.gpath) { const cur = M.getPath(g, h.gpath.path); g = M.setPath(g, h.gpath.path, h.gpath.value !== undefined ? h.gpath.value : Math.round(((Number(cur) || 0) + h.gpath.delta) * 100) / 100); }
  return g;
}

// ---------- lo que exige cada capítulo para empezar en él (idempotente: «Ya sé esto» y el camino «Ya sé algo») ----------
const need = (g, t, c) => (has(g, t) ? g : M.addBlock(g, t, c).genome);
function play(g, c) { g = need(need(g, 'eye.candidates', c), 'hand.choose', c); return ready({ ready: readiness(g, c) }, 'fed') ? g : applyGenome(g, { wire: ['eye.candidates', 'hand.choose'] }, c); }
function think(g, c) { g = play(g, c); return ready({ ready: readiness(g, c) }, 'think') ? g : applyGenome(g, { insert: { type: 'dense', on: ['eye.candidates', 'hand.choose'] } }, c); }
function move(g, c) { return applyGenome(g, { add: ['eye.moves', 'foot.move'], wire: ['eye.moves', 'foot.move'] }, c); }
function memory(g, c) { return applyGenome(think(g, c), { add: ['eye.features', 'echo'], wire: ['eye.features', 'echo'], wire2: ['echo', 'think'] }, c); }

// ---------- los capítulos ----------
// en los retos se ilumina la red (lo que hay en el lienzo), no el lienzo entero: así la ventana cabe al lado
const RED = (x) => (x.g && x.g.blocks.length ? '#edBoard .board-inner' : 'lienzo');
// dentro de una zona grande, lo que la ventana no debe tapar: las tarjetas, sus avisos y lo que le falta
const CARDS = '#edBoard [data-node], #edBoard .flag, #edBoard .needs, #edBoard .board-empty p, #edBoard .board-start';
const ends = (a, b) => (x) => [S.node(x, a), S.node(x, b)];
const ANS_BET = [{ v: 'si', label: 'Sí, apunta' }, { v: 'no', label: 'No, es al azar' }, { v: 'nose', label: 'Ni idea' }];
const pickTxt = (k) => (k ? `el tiro #${k.i}` : 'un tiro');

export const CHAPTERS = [
  { key: 'ver', title: 'Que vea y escoja', ask: '¿Cómo decide una red adónde disparar?', steps: [
    { key: 'hola', kind: 'show', title: 'Soy el Sistema',
      text: (x) => `Te enseño el editor pieza a pieza, haciéndolo tú. Lo que toca ahora se ilumina; lo que ya conoces queda a media luz; lo demás, a oscuras hasta que llegue su momento. Arriba tienes «Ya sé esto» (salta el capítulo) y «Saltar tutorial».${x.path === 'rl' ? ' Si ya sabes de aprendizaje por refuerzo, puedes saltarlo: la Guía lo retoma cuando quieras.' : ''}` },
    { key: 'plantillas', kind: 'show', target: 'plantillas', present: ['plantillas'], title: 'Plantillas',
      text: 'Redes ya montadas para empezar rápido: Francotirador solo mira la geometría, Tortuga recuerda y se cubre, Vidente ve el futuro de cada tiro. Hoy montarás la tuya desde cero, para entender cada pieza.' },
    { key: 'desde-cero', kind: 'do', target: 'desde-cero', present: ['desde-cero'], title: 'Una red en blanco',
      text: 'Empieza con una red sin ningún bloque: tú decides qué ve, cómo piensa y qué hace.',
      todo: (x) => (x.tplOpen === 'blank' ? 'Pulsa «Crear red» (el nombre lo puedes cambiar luego).' : 'Pulsa ✳️ Desde cero y luego «Crear red».'),
      gesture: { name: 'clic', at: (x) => (x.tplOpen === 'blank' ? 'form[data-create="blank"] button[type="submit"]' : '[data-tpl="blank"]') },
      done: (x, b, p) => x.net && !!p.data.net && x.netId === p.data.net, help: { create: 'blank' },
      after: () => 'Ya tienes red: está vacía, sin bloques ni pesos.' },
    { key: 'lienzo', kind: 'show', target: 'lienzo', room: CARDS, present: ['lienzo'], title: 'El lienzo',
      text: 'Aquí irá tu red, de izquierda a derecha, como viaja la señal: lo que ve → cómo piensa → lo que hace. Cada bloque será una tarjeta y los cables, cómo se pasan la información.' },
    { key: 'banco', kind: 'show', target: 'banco', present: ['banco'], title: 'El banco de pruebas',
      text: 'Tu soldado (el blanco, «tu red») frente a un enemigo. Aquí verás al momento qué haría tu red con cada cambio que hagas. Ahora no hace nada: está vacía.' },
    { key: 'candidatos', kind: 'do', target: S.pal('eye.candidates'), present: ['paleta', 'grupo-eyes', 'ficha-bloque'], title: 'Que imagine tiros',
      text: () => co('ojos').ask, todo: 'Añade 🎯 Candidatos: en «Nuevo bloque», grupo Ojos (lo que ve). Pasa el ratón por encima y al lado te dice qué hace.',
      gesture: { name: 'paleta', at: S.pal('eye.candidates') }, done: (x) => has(x.g, 'eye.candidates') || has(x.g, 'eye.simulator'),
      help: { add: ['eye.candidates'] }, after: (x) => co('ojos').after(x) },
    { key: 'elegir', kind: 'do', target: S.pal('hand.choose'), present: ['grupo-hands', 'tarjeta'], title: 'Que escoja uno',
      text: () => `${co('manos').ask} Cada bloque que añades es una tarjeta en el lienzo.`, todo: 'Añade 🎯 Elegir (grupo Manos: lo que hace).',
      gesture: { name: 'paleta', at: S.pal('hand.choose') }, done: (x) => has(x.g, 'hand.choose'), help: { add: ['hand.choose'] }, after: (x) => co('manos').after(x) },
    { key: 'cable', kind: 'do', target: (x) => S.port(x, 'eye.candidates'), lit: (x) => [S.node(x, 'hand.choose')], keep: ends('eye.candidates', 'hand.choose'), present: ['puntos', 'cable'], title: 'Únelos con un cable',
      text: () => `${co('cable').ask} Los círculos a los lados de cada tarjeta son sus puntos de enchufe: a la derecha sale, a la izquierda entra.`,
      todo: 'Arrastra desde el círculo de la derecha de Candidatos hasta Elegir y suelta (se pone verde donde vale).',
      gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'eye.candidates'), to: (x) => S.node(x, 'hand.choose') },
      done: (x) => ready(x, 'fed'), help: { wire: ['eye.candidates', 'hand.choose'] }, after: (x) => co('cable').after(x) },
    { key: 'estado', kind: 'show', target: 'estado', present: ['estado', 'neuronas'], title: '¿Puede jugar?',
      text: 'El estado, arriba del lienzo, dice si tu red puede jugar y, si no, qué le falta. Ahora: «Lista para jugar». Pulsarlo abre los avisos.' },
    { key: 'apuesta', kind: 'ask', target: 'escena', present: ['escena'], title: '¿Ha escogido bien?', text: () => co('apuesta').ask,
      options: ANS_BET, after: (x, p) => co('apuesta').after({ ...x, bet: p.answers.apuesta }) },
  ] },

  { key: 'enchufar', title: 'Enchufar y desenchufar', ask: '¿Qué pasa si le quitas lo que ve?', ensure: play, steps: [
    { key: 'desenchufar', kind: 'do', target: (x) => S.port(x, 'hand.choose', 'in'), keep: ends('eye.candidates', 'hand.choose'), title: 'Desenchufar',
      text: 'Para quitar un cable, coge su punta donde llega (el punto izquierdo de Elegir) y suéltala en un sitio vacío del lienzo, como en Blender.',
      todo: 'Arrastra desde el punto izquierdo de Elegir hasta un sitio vacío y suelta.',
      gesture: { name: 'desenchufar', from: (x) => S.port(x, 'hand.choose', 'in'), to: { dx: -30, dy: 110 } },
      done: (x, b) => !ready(x, 'fed') && more(x, b, 'unwire'), help: { unwireInto: 'hand.choose' },
      after: () => 'Sin ese cable, Elegir ya no recibe ningún tiro: tu red no puede jugar.' },
    { key: 'le-falta', kind: 'show', target: 'le-falta', lit: ['estado'], present: ['le-falta', 'resumen'], title: 'Lo que le falta',
      text: 'El estado se ha puesto naranja y en el lienzo sale qué le falta, con un botón que lo arregla. Abajo, en la pestaña Capa (sin ningún bloque elegido), tienes la misma lista.' },
    { key: 'deshacer', kind: 'do', target: 'deshacer', present: ['deshacer'], keys: ['ctrl+z', 'ctrl+y'], title: 'Deshacer',
      text: 'Todo se puede deshacer: ↶ (o Ctrl+Z) vuelve un paso atrás; ↷ (o Ctrl+Y), uno adelante. El aviso de abajo también trae «Deshacer».',
      todo: 'Pulsa ↶ o Ctrl+Z para volver a enchufar el cable.', gesture: { name: 'deshacer', at: '[data-act="undo"]' },
      done: (x, b) => more(x, b, 'undo') && ready(x, 'fed'), help: { undo: true }, after: () => 'El cable ha vuelto: tu red puede jugar otra vez.' },
    { key: 'pasar-cable', kind: 'do', target: (x) => S.wire(x, 'eye.candidates', 'hand.choose') || S.wire(x, 'think', 'hand.choose'), lit: ['cable-x', 'cable-mas'], keep: ends('eye.candidates', 'hand.choose'), present: ['cable-x', 'cable-mas'], title: 'Los botones del cable',
      text: 'Otra forma: quédate quieto encima de un cable un momento. Se ilumina y salen ✕ (desenchufar) y ＋ (meter una capa en medio). Pulsar el cable solo lo elige: no lo borra.',
      todo: 'Deja el ratón quieto sobre el cable un momento.',
      gesture: { name: 'pasar', at: (x) => S.wire(x, 'eye.candidates', 'hand.choose') || S.wire(x, 'think', 'hand.choose') },
      done: (x) => x.hoverWire !== null && x.hoverWire !== undefined, help: { hover: ['eye.candidates', 'hand.choose'] },
      after: () => 'Esos dos botones salen en cualquier cable. Con Alt + clic en un punto se quitan todos sus cables de golpe.' },
    { key: 'reto', kind: 'reto', target: RED, room: CARDS, title: 'Reto: arréglala',
      setup: { unwire: ['eye.candidates', 'hand.choose'], add: ['eye.features'], wire: ['eye.features', 'hand.choose'], resetHistory: true },
      text: 'El Sistema ha cambiado tu red: ahora Elegir recibe Rasgos (números sobre la partida), no los tiros imaginados. Esta red no puede jugar.',
      todo: 'Arréglala para que pueda jugar.', gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'eye.candidates'), to: (x) => S.node(x, 'hand.choose') },
      done: (x) => x.canPlay, help: { wire: ['eye.candidates', 'hand.choose'] },
      after: () => '¡Arreglada! Elegir necesita los tiros imaginados (Candidatos); lo demás que le llegue se junta con cada tiro.' },
  ] },

  { key: 'pensar', title: 'Que piense', ask: '¿Y si combina lo que ve antes de puntuar?', ensure: play, steps: [
    { key: 'capa-en-medio', kind: 'do', target: (x) => S.wire(x, 'eye.candidates', 'hand.choose'), lit: ['cable-mas', 'insertar'], keep: ends('eye.candidates', 'hand.choose'), present: ['insertar'], title: 'Una capa en medio',
      text: () => co('pensar').ask, todo: 'Quieto sobre el cable Candidatos → Elegir, pulsa ＋ y elige 🧠 Instinto.',
      gesture: { name: 'capa', at: (x) => (x.insertOpen ? '#edInsert [data-insert="dense"]' : x.hoverWire !== null && x.hoverWire !== undefined ? '.wire-plus' : S.wire(x, 'eye.candidates', 'hand.choose')) },
      done: (x) => ready(x, 'think'), help: { insert: { type: 'dense', on: ['eye.candidates', 'hand.choose'] } }, after: (x) => co('pensar').after(x) },
    { key: 'capa', kind: 'show', target: '.capa-cfg .capa-id', lit: ['.capa-cfg .capa-ctls', 'tab-capa'], present: ['panel', 'tab-capa', 'capa-ajustes'], title: 'La pestaña Capa',
      text: 'Abajo, los ajustes del bloque elegido (el Instinto que acabas de meter): qué recibe, de quién, y sus números. Pulsa cualquier tarjeta del lienzo y aquí verás la suya.' },
    { key: 'neuronas', kind: 'do', target: '.capa-cfg .capa-ctls', title: 'Más neuronas',
      text: 'Cada neurona mezcla lo que ve a su manera. Más neuronas = más matices, y más pesos que entrenar.',
      todo: (x) => `Sube sus neuronas de ${x.think ?? 32} a 64 (desliza o escribe 64).`,
      gesture: { name: 'numero', at: '.capa-ctls input.numin[data-bparam="units"]' },
      done: (x) => (x.think || 0) >= 64, help: { param: { type: 'think', key: 'units', value: 64 } },
      after: (x) => `Ahora cada tiro pasa por ${x.think} neuronas. Mira arriba, en los datos: el número de pesos ha subido.` },
    { key: 'que-hace', kind: 'show', target: '.capa-what .explain', present: ['capa-que'], title: '¿Qué hace esta capa?',
      text: 'Qué hace el bloque elegido, con un ejemplo, qué recibe y a quién se lo da. Lo tienes para cada bloque: pulsa su tarjeta.' },
    { key: 'pesos', kind: 'show', target: '.capa-w .histo', present: ['capa-pesos'], title: 'Sus pesos',
      text: 'Cada barra cuenta cuántos pesos tienen ese valor: naranja, negativos; cian, positivos; la del medio, cerca de 0. Sin entrenar son números al azar; entrenar es moverlos.' },
    { key: 'datos', kind: 'show', target: 'datos', lit: [(x) => S.node(x, 'think')], present: ['datos'], title: 'Neuronas y pesos',
      text: 'Los puntos de cada tarjeta son sus neuronas, encendidas con la señal de la escena del banco. Arriba, los datos de tu red: generación, bloques, pesos y partidas jugadas.' },
    { key: 'reto', kind: 'reto', target: RED, room: CARDS, lit: ['grupo-instinct', 'insertar', 'cable-mas'], present: ['grupo-instinct'], title: 'Reto: que piense dos veces',
      text: 'Una capa detrás de otra combina lo que ya combinó la primera. Vale el ＋ del cable, o sacar un Instinto del grupo Instinto de «Nuevo bloque» y soltarlo encima del cable.', todo: 'Pon otro 🧠 Instinto entre tu Instinto y Elegir.',
      gesture: { name: 'capa', at: (x) => (x.insertOpen ? '#edInsert [data-insert="dense"]' : x.hoverWire !== null && x.hoverWire !== undefined ? '.wire-plus' : S.wire(x, 'think', 'hand.choose')) },
      setup: { resetHistory: true }, done: (x) => chain2(x.g), help: { insert: { type: 'dense', on: ['think', 'hand.choose'] } },
      after: () => 'Dos capas seguidas: también puedes arrastrar una tarjeta sin cables encima de un cable y soltarla, y se mete en medio.' },
  ] },

  { key: 'banco', title: 'El banco de pruebas', ask: '¿Escoge igual en otra situación?', ensure: think, steps: [
    { key: 'escenas', kind: 'show', target: 'escenas', present: ['escenas'], title: 'Escenas',
      text: 'Situaciones fijas para probar tu red. La misma escena con la misma semilla da siempre lo mismo: si la elección cambia, es por tus cambios.' },
    { key: 'apuesta-roca', kind: 'ask', target: 'escena', title: 'Apuesta',
      text: (x) => `Ahora escoge ${pickTxt(x.pick)}. Si ponemos una roca grande en medio, ¿cambiará de tiro?`,
      options: [{ v: 'si', label: 'Sí, cambiará' }, { v: 'no', label: 'No, el mismo' }, { v: 'nose', label: 'Ni idea' }] },
    { key: 'roca', kind: 'do', target: '[data-scene="roca"]', title: 'Tras una roca',
      text: () => co('giro').ask, todo: 'Pulsa la escena «Tras una roca».', gesture: { name: 'clic', at: '[data-scene="roca"]' },
      done: (x) => x.scene === 'roca', help: { scene: 'roca' },
      after: (x, p) => { const a = p.answers['apuesta-roca'] || {}, was = a.pick; const changed = was && x.pick ? was.i !== x.pick.i : null; return `${was && x.pick ? `Antes escogía el #${was.i}; con la roca, el #${x.pick.i}: ${changed ? 'ha cambiado' : 'el mismo'}${a.v === 'nose' ? '.' : (a.v === 'si') === changed ? ' (acertaste).' : ' (no acertaste).'} ` : ''}${co('giro').after(x)}`; } },
    { key: 'semilla', kind: 'do', target: 'semilla', present: ['semilla'], title: 'La semilla',
      text: 'Elegir no escoge siempre el de más nota: sortea, y el de más nota tiene más papeletas. La semilla fija ese sorteo.',
      todo: 'Cambia la Semilla (escribe otro número o usa sus flechas).', gesture: { name: 'numero', at: '[data-bseed]' },
      done: (x, b) => more(x, b, 'seed'), help: { seed: 1 },
      after: (x) => `Otra semilla, otro sorteo: ahora escoge ${pickTxt(x.pick)}${x.pick ? `, con probabilidad ${f2(x.pick.p)}` : ''}.` },
    { key: 'decision', kind: 'show', target: 'decision', lit: ['se-fijo'], present: ['decision', 'se-fijo'], title: 'La decisión, explicada',
      text: 'Qué tiro escoge, con qué probabilidad y con qué certeza (0 = duda total, 1 = segura). «Se fijó sobre todo en» dice qué bloque pesó más: se calcula tapándolo y comparando.' },
    { key: 'tu-escena', kind: 'do', target: (x) => (x.scene === 'mia' ? 'escena' : '[data-scene="mia"]'), lit: ['tu-escena'], present: ['tu-escena', 'escena'], title: 'Tu escena',
      text: 'Empieza como la escena que tengas y la cambias tú: arrastra soldados y rocas; doble clic en el plano añade una roca; la rueda sobre una roca la agranda.',
      todo: (x) => (x.scene === 'mia' ? 'Arrastra al enemigo (el punto naranja) a otro sitio.' : 'Pulsa «Tu escena».'),
      gesture: { name: 'escena', at: (x) => (x.scene === 'mia' ? null : '[data-scene="mia"]'), from: (x) => (x.scene === 'mia' ? '#benchSvg .b-s.right' : null), to: { dx: -40, dy: -30 } },
      done: (x, b) => x.scene === 'mia' && more(x, b, 'bench'), help: { scene: 'mia', benchMove: true },
      after: () => 'La red decide otra vez con tu escena, al momento.' },
    { key: 'pausa', kind: 'pause', target: 'probar', lit: ['probar-panel'], present: ['probar', 'probar-panel'], title: 'Tu red ya juega',
      text: '¿La pruebas de verdad? «Probar ya» juega 6 partidas (x10) contra Vidente aquí mismo, sin cambiarla ni que aprenda. Así ves cómo juega hoy: casi al azar. O sigue con el tutorial.' },
  ] },

  { key: 'mover', title: 'Que se mueva', ask: 'Tras disparar, ¿adónde va?', ensure: play, steps: [
    { key: 'destinos', kind: 'do', target: S.pal('eye.moves'), title: 'Destinos', text: () => co('pies').ask,
      todo: 'Añade 🦶 Destinos (grupo Ojos): los 9 sitios adonde podría ir.', gesture: { name: 'paleta', at: S.pal('eye.moves') },
      done: (x) => has(x.g, 'eye.moves'), help: { add: ['eye.moves'] }, after: () => 'Destinos ve 9 sitios: quedarse o ir 1,5 u en 8 direcciones.' },
    { key: 'moverse', kind: 'do', target: S.pal('foot.move'), present: ['grupo-feet'], title: 'Moverse',
      text: 'Pies: lo que hace después de disparar. Moverse puntúa cada sitio y escoge uno.', todo: 'Añade 🦶 Moverse (grupo Pies).',
      gesture: { name: 'paleta', at: S.pal('foot.move') }, done: (x) => has(x.g, 'foot.move'), help: { add: ['foot.move'] } },
    { key: 'cable-pies', kind: 'do', target: (x) => S.port(x, 'eye.moves'), lit: (x) => [S.node(x, 'foot.move')], title: 'Únelos',
      text: 'Igual que con los tiros: los sitios tienen que llegarle a Moverse.', todo: 'Arrastra desde el punto de salida de Destinos hasta Moverse.',
      gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'eye.moves'), to: (x) => S.node(x, 'foot.move') },
      done: (x) => { const m = idOf(x.g, 'foot.move'); return !!m && ins(x.g, m).length > 0; }, help: { wire: ['eye.moves', 'foot.move'] } },
    { key: 'fase', kind: 'do', target: 'fase', present: ['fase'], title: 'Disparar o moverse',
      text: 'El banco puede enseñar las dos decisiones: el disparo y, después, adónde se mueve.', todo: 'En el banco, pulsa «Moverse».',
      gesture: { name: 'clic', at: '[data-phase="move"]' }, done: (x) => x.phase === 'move', help: { phase: 'move' }, after: (x) => co('pies').after(x) },
    { key: 'reto', kind: 'reto', target: RED, room: CARDS, title: 'Reto: que se mueva',
      setup: { unwireInto: 'foot.move', resetHistory: true }, text: 'El Sistema ha quitado el cable que llega a Moverse: tu red dispara, pero se queda quieta.',
      todo: 'Haz que esta red se mueva.', gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'eye.moves'), to: (x) => S.node(x, 'foot.move') },
      done: (x) => { const m = idOf(x.g, 'foot.move'); return !!m && ins(x.g, m).length > 0; }, help: { wire: ['eye.moves', 'foot.move'] },
      after: () => 'Se mueve otra vez.' },
  ] },

  { key: 'recordar', title: 'Que recuerde', ask: '¿Cómo sabe si el último tiro se quedó corto?', ensure: think, steps: [
    { key: 'rasgos', kind: 'do', target: S.pal('eye.features'), title: 'Rasgos', text: () => co('memoria').ask,
      todo: 'Añade 📊 Rasgos (grupo Ojos): 26 números sobre la partida (distancias, turno, el último tiro…).',
      gesture: { name: 'paleta', at: S.pal('eye.features') }, done: (x) => has(x.g, 'eye.features'), help: { add: ['eye.features'] } },
    { key: 'eco', kind: 'do', target: S.pal('echo'), present: ['grupo-memory'], title: 'Eco',
      text: 'Memoria: lo que pasa de un turno al siguiente.', todo: 'Añade 🌀 Eco (grupo Memoria).',
      gesture: { name: 'paleta', at: S.pal('echo') }, done: (x) => has(x.g, 'echo'), help: { add: ['echo'] } },
    { key: 'rasgos-eco', kind: 'do', target: (x) => S.port(x, 'eye.features'), lit: (x) => [S.node(x, 'echo')], title: 'Rasgos → Eco',
      text: 'Eco recuerda lo que le llega.', todo: 'Une Rasgos con Eco (arrastra desde el punto de salida de Rasgos).',
      gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'eye.features'), to: (x) => S.node(x, 'echo') },
      done: (x) => { const e = idOf(x.g, 'echo'); return !!e && ins(x.g, e).length > 0; }, help: { wire: ['eye.features', 'echo'] } },
    { key: 'eco-instinto', kind: 'do', target: (x) => S.port(x, 'echo'), lit: (x) => [S.node(x, 'think')], title: 'Eco → Instinto',
      text: 'Lo que recuerda tiene que llegar adonde se piensa cada tiro.', todo: 'Une Eco con tu 🧠 Instinto.',
      gesture: { name: 'arrastrar-cable', from: (x) => S.port(x, 'echo'), to: (x) => S.node(x, 'think') },
      done: (x) => (x.g.blocks || []).some((b) => MEMORY.includes(b.type) && outs(x.g, b.id).length > 0 && ins(x.g, b.id).length > 0),
      help: { wire: ['echo', 'think'] }, after: (x) => co('memoria').after(x) },
    { key: 'leyenda', kind: 'show', target: 'leyenda', lit: ['columnas'], present: ['leyenda', 'columnas'], title: 'Qué lleva cada cable',
      text: 'Contexto (una vez por turno, línea continua), candidatos (una fila por tiro imaginado) o destinos (una fila por sitio). Arriba de cada columna del lienzo, lo que hay en ella: Entradas, Instinto, Memoria, Salidas.' },
  ] },

  { key: 'caracter', title: 'Su carácter', ask: '¿Qué le gusta y cómo aprende?', ensure: play, steps: [
    { key: 'genes', kind: 'do', target: 'tab-genes', present: ['tab-genes'], title: 'Los genes',
      text: 'Además de sus bloques, cada red tiene genes: su carácter, qué premia, cómo aprende y qué tiros imagina. Sus hijas los heredan (con mutaciones).',
      todo: 'Abre la pestaña Genes.', gesture: { name: 'clic', at: '.tabs [data-ptab="genes"]' }, done: (x) => x.panelTab === 'genes' && !x.folded, help: { panelTab: 'genes' } },
    ...[['traits', 'Carácter', 'la temperatura dice cuánto se arriesga al escoger entre tiros parecidos (más alta, más variada).', { path: 'traits.temperature', delta: 0.2 }],
      ['reward', 'Recompensa', 'qué premia y qué castiga al aprender: premiar sobrevivir la vuelve cauta; premiar matar, agresiva.', { path: 'reward.survive', delta: 0.1 }],
      ['learning', 'Aprendizaje', 'cómo aprende: gradiente (ajusta sus pesos tras cada partida), evolución (copias con cambios que compiten) o los dos.', { path: 'learning.method', value: 'both' }],
      ['imagination', 'Imaginación', 'qué tiros imagina y cuántos: con 24 ve 24 curvas; puedes apagar familias (senos, parábolas…).', { path: 'imagination.n', delta: 8 }]]
      .map(([k, name, what, gp]) => ({ key: `gen-${k}`, kind: 'do', target: `gen-${k}`, lit: [k === 'learning' ? '.genes fieldset:first-of-type > div.ctl:first-of-type' : '.genes > div.ctl:first-of-type'], present: k === 'traits' ? ['gen-traits', 'genes-cuerpo'] : [`gen-${k}`], title: name,
        text: `${name}: ${what}`, todo: `En «${name}», cambia un valor.`, gesture: { name: 'clic', at: `[data-genes="${k}"]` },
        done: (x, b) => more(x, b, `gene:${k}`), help: { genesTab: k, gpath: gp } })),
  ] },

  { key: 'taller', title: 'Tu taller', ask: '¿Y si algo sale mal?', ensure: (g, c) => move(memory(g, c), c), steps: [
    { key: 'guardar', kind: 'do', target: 'guardar', lit: ['nombre', 'sin-guardar'], present: ['guardar', 'nombre', 'emblema', 'sin-guardar'], keys: ['ctrl+s'], title: 'Guardar',
      text: '«cambios sin guardar» avisa de que lo que ves aún no juega así. Guardar (o Ctrl+S) lo fija, y la de antes queda como versión. A la izquierda puedes cambiarle el nombre; el emblema sale de su semilla.',
      todo: 'Pulsa Guardar.', gesture: { name: 'clic', at: '[data-act="save"]' }, done: (x, b) => more(x, b, 'save') && x.saved, help: { save: true },
      after: () => 'Guardada: así jugará en duelos y entrenos.' },
    { key: 'avisos', kind: 'do', target: 'tab-avisos', lit: ['arreglar', 'aviso-bloque', 'estado'], present: ['tab-avisos', 'aviso-bloque', 'arreglar'], title: 'Avisos y arreglos',
      setup: { unwireInto: 'foot.move' },
      text: 'El Sistema acaba de romper algo a propósito. Cuando algo está mal, el estado se pone rojo, sale un aviso junto al bloque y la pestaña Avisos lo explica. Si solo hay una forma de arreglarlo, hay un botón.',
      todo: (x) => (x.panelTab === 'avisos' ? 'Pulsa el arreglo de un clic.' : 'Abre Avisos y pulsa el arreglo de un clic.'),
      gesture: { name: 'clic', at: (x) => (x.panelTab === 'avisos' && !x.folded ? '#edPanel [data-fix]' : '.tabs [data-ptab="avisos"]') },
      done: (x, b) => more(x, b, 'fix') && x.errors === 0, help: { fix: true }, after: () => 'Arreglada con un clic (también se deshace con Ctrl+Z).' },
    { key: 'versiones', kind: 'do', target: 'tab-versiones', present: ['tab-versiones'], title: 'Versiones',
      text: 'A la izquierda, los cambios de esta sesión (pulsa uno para volver ahí); a la derecha, las versiones guardadas, con sus diferencias.',
      todo: 'Abre Versiones.', gesture: { name: 'clic', at: '.tabs [data-ptab="versiones"]' }, done: (x) => x.panelTab === 'versiones' && !x.folded, help: { panelTab: 'versiones' } },
    { key: 'que-ve', kind: 'do', target: 'tab-ve', present: ['tab-ve'], title: 'Qué ve tu red',
      text: 'Los números exactos que entran en cada ojo en la escena del banco, con su nombre. Cambia de escena y verás cómo cambian.',
      todo: 'Abre «Qué ve tu red».', gesture: { name: 'clic', at: '.tabs [data-ptab="ve"]' }, done: (x) => x.panelTab === 've' && !x.folded, help: { panelTab: 've' } },
    { key: 'menu', kind: 'show', target: 'menu', look: true, present: ['menu'], title: 'El menú ⋯',
      text: 'Abrir otra red, exportarla a un fichero (.json), importar una, ver sus versiones, abrir su ficha o borrarla.' },
    { key: 'tus-redes', kind: 'show', target: 'tab-redes', lit: ['tab-editor'], look: true, present: ['tab-editor', 'tab-redes'], title: 'Tus redes',
      text: '«Tus redes»: todas las redes de este mundo, con sus números. «Editor» te trae de vuelta aquí.' },
    { key: 'reto', kind: 'reto', target: 'tab-versiones', lit: ['panel', 'deshacer'], title: 'Reto: vuelve atrás',
      setup: { remove: ['echo'], save: true },
      text: 'El Sistema ha quitado la memoria (Eco) de tu red y la ha guardado así. Las versiones guardadas se pueden recuperar.',
      todo: 'Vuelve a la versión de antes, la que tenía memoria.', gesture: { name: 'clic', at: (x) => (x.panelTab === 'versiones' ? '#edPanel [data-vback]' : '.tabs [data-ptab="versiones"]') },
      done: (x) => (x.g.blocks || []).some((b) => MEMORY.includes(b.type)), help: { restore: 'latest' },
      after: () => 'Recuperada. La que no tenía memoria también quedó guardada como versión: nada se pierde.' },
  ] },

  { key: 'grad', title: 'Graduación', ask: 'Ya conoces cada parte', ensure: (g) => g, steps: [
    { key: 'niveles', kind: 'show', target: 'niveles', present: ['niveles'], title: 'Niveles de vista',
      text: 'Aprendiz, Artesano y Científico: cuánto se ve (más bloques y más ajustes). Nada se bloquea: cámbialo cuando quieras.' },
    { key: 'zoom', kind: 'show', target: 'zoom', present: ['zoom', 'encajar', 'ordenar'], title: 'Zoom, Encajar y Ordenar',
      text: '− y + acercan y alejan el lienzo; Encajar hace que la red entera quepa; Ordenar recoloca las tarjetas por columnas.' },
    { key: 'plegar', kind: 'show', target: 'plegar', lit: ['separador'], present: ['plegar', 'separador'], title: 'Más sitio',
      text: 'Plegar esconde el panel de abajo; la raya entre el lienzo y el panel se arrastra para darle más sitio a uno u otro.' },
    { key: 'guia', kind: 'show', target: 'guia', present: ['guia'], title: 'La Guía',
      text: 'Te devuelve a este tutorial: donde lo dejaste o, si lo acabaste, desde el principio.' },
    { key: 'todo', kind: 'grad', title: 'Todo encendido',
      zones: [['plantillas', 'Plantillas'], ['paleta', 'Nuevo bloque'], ['lienzo', 'El lienzo'], ['estado', 'El estado'], ['panel', 'Capa, Genes, Qué ve, Versiones y Avisos'], ['banco', 'El banco de pruebas'], ['guardar', 'Guardar']],
      text: 'Ya conoces cada zona del editor. Ahora es tuyo: cambia lo que quieras. Lo siguiente es entrenar tu red (etapa 2).' },
  ] },
];

// dónde empieza cada camino (plan: «Ya sé algo» en el capítulo 3; «Sé de RL» en el 1, con la invitación a saltarlo)
export const startAt = (path) => (path === 'algo' ? CHAPTERS.findIndex((c) => c.key === 'pensar') : 0);

// lo que exige el capítulo `ci` para empezar en él: los de antes y el suyo
export function ensureFor(ci, genome, catalog) {
  let g = genome;
  for (let i = 0; i <= ci && i < CHAPTERS.length; i++) if (CHAPTERS[i].ensure) g = CHAPTERS[i].ensure(g, catalog);
  return g;
}
