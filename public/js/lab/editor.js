// Etapa 1 · Crear: el editor de redes (P6, plan ronda 17; spec/08 §1, §4 y §7). Distribución del panel 1 del mockup:
// plantillas y bloques a la izquierda, el lienzo por columnas en el orden de la señal (ENTRADAS · INSTINTO · MEMORIA ·
// SALIDAS según lo que haya), y abajo "Configuración de la capa" y "¿Qué hace esta capa?" junto al banco de pruebas.
// Las 8 mejoras: banco de pruebas en vivo (con tu propia escena), qué ve tu red, probar ya contra otra red, nervios que
// laten con la señal real, deshacer/rehacer y versiones con sus diferencias, arreglar con un clic, y los pesos del
// bloque (que abren el Quirófano de la ficha). Sesión 8: todo más explicado, y si algo no se puede, una pista de dónde
// podría ir o de qué le falta a tu red.
// La validación, el reparto de pesos y la decisión del banco usan el MISMO código que el servidor (/shared, spec/08 §9.3).
import * as M from './model.js';
import * as Hn from './hints.js';
import * as Bn from './bench.js';
import * as Hi from './history.js';
import * as Co from './coach.js';
import * as P from './plug.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { validate, repair, countParams, outDims, newGenome } from '/shared/genome.js';
import { makeRng } from '/shared/rng.js';
import { patch } from '../ui/patch.js';
import { popIn } from '../ui/fx/anim.js';
import { R, fnText, TEAM_COLOR, prettyExpr } from '../render.js';
import { roomWatch } from '../game/sala.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v));
const f2 = (v) => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—');
const pct = (v) => `${Math.round(v * 100)} %`;
const FAMILY_ES = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: "EDO (y')", artillery: 'artillería', wild: 'salvaje' };
// con su artículo, para las frases del banco ("el tiro #13, un seno …")
const FAMILY_A = { line: 'una recta', parabola: 'una parábola', sine: 'un seno', ode1: "una EDO (y')", artillery: 'un tiro de artillería', wild: 'un tiro salvaje' };
const STREAM = { ctx: 'contexto', cand: 'candidatos', move: 'destinos', mix: 'candidatos y destinos juntos' };
const LS = { level: 'gw.lab.level', pos: (id) => `gw.lab.pos.${id}`, bottom: 'gw.ed.bottom' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: solo se pierde la posición */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* igual */ } },
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const when = (ms) => (ms ? new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Imaginación (spec/03 §5, spec/05 §6): el catálogo trae las familias; n, objetivos y "adaptativa" se explican aquí
const IMAGINATION = (limits) => [
  { key: 'n', name: 'Tiros que imagina', type: 'int', min: limits.candidatesMin, max: limits.candidatesMax, step: 1, level: 'aprendiz',
    explain: 'Cuántos tiros posibles se imagina en cada turno antes de elegir uno con Elegir.', example: 'Con 24 ve 24 curvas candidatas; con 64 tiene más donde escoger y piensa más despacio.' },
  { key: 'targets', name: 'A quién apunta', type: 'enum', level: 'artesano', options: [
    { value: 'all', name: 'a todos', explain: 'reparte los tiros entre los enemigos vivos, del más cercano al más lejano' },
    { value: 'nearest', name: 'al más cercano', explain: 'todos los tiros van al enemigo más cercano' }],
    explain: 'Hacia qué enemigos se imaginan los tiros.', example: '"a todos" con 3 enemigos alterna el objetivo de cada tiro.' },
  { key: 'adaptive', name: 'Adaptativa', type: 'bool', level: 'artesano',
    explain: 'En cada sueño, el peso de cada familia se acerca a lo que de verdad elige: peso ← 0,9·peso + 0,1·uso.', example: 'Si casi siempre elige parábolas, cada vez imagina más parábolas.' },
];
// "Desde cero" va la primera de las plantillas: una red sin bloques que montas tú (sesión 8: el tutorial empieza así)
const BLANK = { key: 'blank', name: '✳️ Desde cero', short: 'sin bloques: la montas tú', paramCount: 0,
  why: 'Sin ningún bloque: tú decides qué ve, cómo piensa y qué hace. Para poder jugar necesita, como mínimo, Candidatos (los tiros que imagina) unidos a Elegir (el que escoge uno).' };
const TPL_SHORT = { sniper: 'solo geometría, sin trampas', turtle: 'recuerda y se cubre', seer: 've el futuro de cada tiro', empty: 'lo mínimo que dispara' };
const FAMILY_WEIGHT = { key: 'weight', name: 'Peso', type: 'number', min: 0, max: 100, step: 1, explain: 'Parte de los tiros imaginados que salen de esta familia (proporcional al peso).' };
// títulos de columna del mockup: lo que hay en cada columna, en mayúsculas, con su pregunta
const COLTITLE = { eyes: ['Entradas', '¿Qué ve?'], instinct: ['Instinto', '¿Cómo piensa?'], memory: ['Memoria', '¿Qué recuerda?'], out: ['Salidas', '¿Qué hace?'] };
// medidas del lienzo: tarjetas más altas que las de model.js (llevan qué hacen y sus neuronas); se escala su colocación
const CARD = { w: 176, h: 70 }, COL_W = 232, ROW_K = 92 / 66, PAD = { x: 24, y: 78 };
const GENES = [['traits', 'Carácter'], ['reward', 'Recompensa'], ['learning', 'Aprendizaje'], ['imagination', 'Imaginación']];
const LEVEL_WORLD = { aprendiz: 'A', artesano: 'B', cientifico: 'C' };
const PTABS = [['capa', 'Capa'], ['genes', 'Genes'], ['ve', 'Qué ve tu red'], ['versiones', 'Versiones'], ['avisos', 'Avisos']];

export function mountEditor(root, { catalog, toast }) {
  const S = {
    level: M.LEVELS.includes(store.get(LS.level, 'aprendiz')) ? store.get(LS.level, 'aprendiz') : 'aprendiz',
    nets: [], templates: [], panelTab: 'capa', genesTab: 'traits',
    netId: null, saved: null, base: null, genome: null, check: null, forPlay: null, dims: null, streams: {}, issues: null, params: null,
    coach: null, world: null, server: null, sel: null, pos: {}, zoom: 1, fit: true, dirty: false, pending: null, tplOpen: null, confirm: null,
    hist: Hi.createHistory(null), menu: false, slotEl: null, palHover: null, link: null, hoverWire: null, folded: store.get('gw.ed.folded', false) === true,
    bench: { scene: 'abierto', custom: null, phase: 'shoot', seed: 1, now: null, saved: null, savedKey: null, sig: null, pick: null, busy: false },
    versions: { list: null, open: null, diff: null, ver: null, busy: false },
    probe: null,
  };
  let drag = null, suppressClick = false, benchTimer = null, coachShown = null;

  root.innerHTML = `
    <div class="ed-slot-fallback" id="edHead"></div>
    <aside class="ed-rail" id="edRail" aria-label="Plantillas y bloques"></aside>
    <div class="pal-tip" id="edPalTip" role="tooltip" hidden></div>
    <div class="ed-tools" id="edTools"></div>
    <div class="ed-board" id="edBoard" aria-label="Lienzo de la red"></div>
    <div class="ed-coach" id="edCoach" hidden></div>
    <div class="wire-tools" id="edWireTools" hidden></div>
    <div class="drop-tip" id="edDropTip" role="status" hidden></div>
    <div class="ed-split" id="edSplit" role="separator" aria-orientation="horizontal" aria-label="Arrastra para dar más sitio al lienzo o a los ajustes" tabindex="0"></div>
    <section class="ed-panel" id="edPanel" aria-label="La capa elegida y los genes"></section>
    <section class="ed-bench" id="edBench" aria-label="Banco de pruebas"></section>
    <div class="ed-probe" id="edProbe" hidden></div>
    <div class="ed-modal" id="edModal" hidden></div>`;
  const $ = (id) => root.querySelector('#' + id);
  // alto del panel de abajo: lo último que elegiste, o un tercio de la ventana; plegado, solo sus pestañas
  const bottomH = () => Math.max(180, Math.min(620, store.get(LS.bottom, null) ?? Math.round(Math.min(262, (typeof innerHeight === 'number' ? innerHeight : 800) * 0.3))));
  const applyBottom = () => root.style.setProperty('--ed-bottom', S.folded ? '42px' : `${bottomH()}px`);
  applyBottom();
  function fold(v) { S.folded = v; store.set('gw.ed.folded', v); applyBottom(); renderPanel(); if (S.fit) setTimeout(renderBoard, 30); }

  // ---------- estado del genoma ----------
  function recheck() {
    const g = S.genome;
    S.check = validate(g);
    S.forPlay = validate(g, { forPlay: true });
    S.params = S.check.ok ? countParams(g) : null;
    S.dims = S.check.ok ? outDims(g) : null;
    S.streams = M.streams(g, catalog);
    S.issues = M.issuesOf(S.check);
  }
  // pesos: los guardados se conservan si su forma sigue valiendo; si no, repair pone pesos nuevos (semilla = emblema).
  // opts: {select, partial, label, key} — label y key van al historial (key junta los cambios seguidos de un deslizador)
  function commit(next, opts = {}) {
    const w = { ...(next.weights || {}) };
    if (S.saved) for (const b of next.blocks) {
      const old = S.saved.blocks.find((x) => x.id === b.id && x.type === b.type);
      if (old && S.saved.weights && S.saved.weights[b.id]) w[b.id] = S.saved.weights[b.id];
    }
    const before = S.genome;
    S.genome = repair({ ...next, weights: w }, makeRng((Number(next.emblem) >>> 0) % 2 ** 31)).genome;
    S.hist = Hi.record(S.hist, S.genome, opts.label || Hi.describe(before, S.genome, catalog), opts.key ?? null, Date.now());
    afterChange(opts);
  }
  function afterChange(opts = {}) {
    S.dirty = S.genome !== S.base;
    S.hoverWire = null; // los índices de los cables pueden haber cambiado
    S.server = null;
    recheck();
    if (opts.select !== undefined) S.sel = opts.select;
    if (opts.partial) { renderHead(); renderTools(); renderBoard(); } else render();
    scheduleBench();
  }
  // quitar un cable (✕ del cable, «Quitar cable», Supr, arrastrar su punta al vacío): el aviso ofrece deshacerlo
  function unwire(i) {
    const w = S.genome && S.genome.wires[i];
    if (!w) return;
    const r = P.drop(S.genome, catalog, { kind: 'end', index: i, from: w.from, to: w.to }, { node: null }, new Map());
    commit(r.genome, { select: null, label: r.label });
    toast(r.text, 'info', { label: 'Deshacer', run: undo });
  }
  function undo() { if (!Hi.canUndo(S.hist)) return; const l = Hi.undoLabel(S.hist); S.hist = Hi.undo(S.hist); S.genome = S.hist.present; afterChange(); toast(`Deshecho: ${l}`); }
  function redo() { if (!Hi.canRedo(S.hist)) return; const l = Hi.redoLabel(S.hist); S.hist = Hi.redo(S.hist); S.genome = S.hist.present; afterChange(); toast(`Rehecho: ${l}`); }
  // bloques que ya existían y estrenan pesos al guardar (cambió su forma): lo aprendido en ellos se pierde
  function freshBlocks() {
    if (!S.saved || !S.genome) return [];
    return S.genome.blocks.filter((b) => {
      const old = S.saved.blocks.find((x) => x.id === b.id && x.type === b.type);
      const a = S.saved.weights && S.saved.weights[b.id], c = S.genome.weights && S.genome.weights[b.id];
      if (!old || !a || !c) return false;
      return Object.keys(c).some((k) => !sameArr(a[k], c[k]));
    });
  }

  // ---------- datos ----------
  async function loadNets() {
    const r = await api('/api/lab/nets');
    S.nets = r.ok ? r.body.nets : [];
  }
  async function open(netId, { force = false } = {}) {
    if (!force && S.dirty && S.netId && netId !== S.netId) { S.pending = netId; showModal(); return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(netId)}`);
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    S.netId = netId; S.saved = clone(r.body.genome); S.genome = clone(r.body.genome); S.base = S.genome; S.dirty = false; S.server = null; S.sel = null;
    S.hist = Hi.createHistory(S.genome);
    S.pos = store.get(LS.pos(netId), {}) || {};
    S.fit = true; S.menu = false;
    S.coach = store.get(`gw.coach.${netId}`, null);
    S.bench.saved = null; S.bench.savedKey = null; S.versions = { list: null, open: null, diff: null, ver: null, busy: false };
    recheck();
    if (location.hash !== `#crear/${netId}`) history.replaceState(null, '', `#crear/${netId}`);
    render();
    scheduleBench(0);
    if (S.panelTab === 'versiones') loadVersions();
  }
  async function save() {
    if (!S.genome) return;
    if (!S.check.ok) { S.panelTab = 'avisos'; render(); toast('Hay errores: arréglalos antes de guardar (están en Avisos y junto a cada bloque).', 'error'); return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}`, 'PUT', S.genome);
    if (r.ok) {
      S.saved = clone(S.genome); S.base = S.genome; S.dirty = false; S.server = { warnings: r.body.warnings || [] };
      S.bench.saved = null; S.bench.savedKey = null; S.versions.list = null;
      await loadNets(); render(); scheduleBench(0); toast(r.body.version ? `Red guardada. La de antes queda como versión ${r.body.version} (Versiones).` : 'Red guardada.');
      if (S.panelTab === 'versiones') loadVersions();
    } else {
      S.server = { status: r.status, error: reasonOf(r), errors: (r.body && r.body.errors) || [] };
      S.panelTab = 'avisos'; render(); toast(reasonOf(r), 'error');
    }
  }
  // desde cero: una red sin ningún bloque (válida para guardar; para jugar le faltará Elegir, y el editor lo dice)
  const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  async function createBlank(name) {
    const base = slug(name).length >= 3 ? slug(name) : 'mi-red';
    const taken = new Set(S.nets.map((n) => n.id));
    let id = base;
    for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
    const genome = newGenome({ id, name: String(name || 'Mi red').slice(0, 32), blocks: [], wires: [] }, makeRng((Math.random() * 2 ** 31) >>> 0));
    const r = await api('/api/lab/nets', 'POST', { genome });
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    S.tplOpen = null;
    await loadNets();
    await open(r.body.id);
    coachStart();
    toast(`Red en blanco creada: ${genome.name}. La guía te lleva paso a paso (arriba a la derecha del lienzo).`);
  }
  async function createFromTemplate(key, name) {
    if (key === 'blank') { await createBlank(name); return; }
    const r = await api('/api/lab/nets', 'POST', { template: key, name });
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    S.tplOpen = null;
    await loadNets();
    await open(r.body.id); // con cambios sin guardar, pregunta antes de cambiar de red
    toast(`Red creada: ${r.body.genome.name}.`);
  }
  async function importFile(file, rename = false) {
    let g;
    try { g = JSON.parse(await file.text()); } catch { toast(`«${file.name}» no es un JSON válido.`, 'error'); return; }
    const r = await api(`/api/lab/nets/import${rename ? '?rename=1' : ''}`, 'POST', g);
    if (r.status === 409 && !rename) { S.confirm = { kind: 'import', file, text: reasonOf(r) }; showModal(); return; }
    if (!r.ok) {
      const first = r.body && r.body.errors && r.body.errors[0];
      toast(first ? `${first.message}${first.example ? ` Ejemplo: ${first.example}` : ''}` : reasonOf(r), 'error');
      return;
    }
    await loadNets();
    await open(r.body.id);
    toast(`Red importada como «${r.body.id}».`);
  }
  async function removeNet(force = false) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}${force ? '?force=1' : ''}`, 'DELETE');
    if (r.status === 409 && !force && /force=1/.test(reasonOf(r))) { S.confirm = { kind: 'force', text: reasonOf(r).replace(/,? ?bórrala con \?force=1\.?/, '.') }; showModal(); return; }
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    store.del(LS.pos(S.netId));
    const gone = S.genome.name;
    S.netId = null; S.saved = null; S.genome = null; S.base = null; S.dirty = false; S.sel = null;
    history.replaceState(null, '', '#crear');
    await loadNets(); render(); toast(`Red borrada: ${gone}.`);
  }

  // ---------- pintar ----------
  function render() { renderHead(); renderRail(); renderTools(); renderBoard(); renderPanel(); renderBench(); }

  function statusOf() {
    if (!S.genome) return null;
    const errs = S.check.errors.length;
    if (errs) return { cls: 'bad', text: `${errs} ${errs === 1 ? 'error' : 'errores'}: no se puede guardar` };
    if (!S.forPlay.ok) {
      const miss = Hn.readiness(S.genome, catalog).filter((x) => x.required && !x.ok);
      return { cls: 'warn', text: `Se puede guardar, pero aún no puede jugar${miss.length ? `: le falta ${miss[0].text.split(':')[0].toLowerCase()}` : ''}` };
    }
    return { cls: 'good', text: 'Lista para jugar' };
  }

  // cabecera: en la fila del título de la etapa (como en el mockup): emblema, nombre, deshacer, Guardar y ⋯
  function renderHead() {
    const h = S.slotEl && S.slotEl.isConnected ? S.slotEl : $('edHead');
    $('edHead').hidden = h !== $('edHead');
    if (!S.genome) {
      patch(h, `<div class="edh"><span class="edh-hint">Elige una red o crea una desde una plantilla (a la izquierda).</span>${menuHTML()}</div>`);
      return;
    }
    const g = S.genome;
    const u = Hi.undoLabel(S.hist), r = Hi.redoLabel(S.hist);
    patch(h, `<div class="edh">
      <span class="edh-em" title="Emblema: sale de la semilla ${esc(g.emblem)}">${emblemSVG(g.emblem, 34)}</span>
      <label class="edh-name"><small>Nombre de la red</small><input id="edName" value="${esc(g.name)}" maxlength="32" spellcheck="false"></label>
      <span class="edh-undo" role="group" aria-label="Deshacer y rehacer">
        <button type="button" data-act="undo" ${u ? '' : 'disabled'} title="${esc(u ? `Deshacer: ${u} (Ctrl+Z)` : 'Nada que deshacer')}" aria-label="Deshacer">↶</button>
        <button type="button" data-act="redo" ${r ? '' : 'disabled'} title="${esc(r ? `Rehacer: ${r} (Ctrl+Y)` : 'Nada que rehacer')}" aria-label="Rehacer">↷</button></span>
      <button type="button" class="primary" data-act="save" ${S.check.ok ? '' : 'aria-disabled="true"'} title="Guarda la red (Ctrl+S). La de antes queda en Versiones.">Guardar</button>
      ${menuHTML()}</div>`);
  }
  function menuHTML() {
    const others = S.nets.filter((n) => n.id !== S.netId);
    return `<span class="edh-more"><button type="button" data-act="menu" aria-expanded="${S.menu}" aria-label="Más: abrir otra red, exportar, importar, versiones, borrar">⋯</button>
      <div class="menu" ${S.menu ? '' : 'hidden'} role="menu">
        ${others.length ? `<p class="menu-h">Abrir otra red</p>${others.map((n) => `<button type="button" role="menuitem" data-open="${esc(n.id)}"><span class="net-em" aria-hidden="true">${emblemSVG(n.emblem, 20)}</span>${esc(n.name)}<small>gen ${esc(n.generation ?? 0)}${n.isQueen ? ' · reina' : ''}</small></button>`).join('')}` : ''}
        ${S.genome ? `<p class="menu-h">Esta red</p>
        <a class="btn" role="menuitem" href="/api/lab/nets/${encodeURIComponent(S.netId)}/export" download="${esc(S.netId)}.json" ${S.dirty ? 'title="Exporta lo guardado: guarda antes para exportar tus cambios"' : ''}>Exportar (.json)</a>
        <button type="button" role="menuitem" data-ptab="versiones">Versiones y cambios</button>
        <button type="button" role="menuitem" data-ficha="${esc(S.netId)}">Abrir su ficha</button>
        <button type="button" role="menuitem" class="danger" data-act="delete">Borrar esta red…</button>` : ''}
        <p class="menu-h">Traer</p><label class="btn file" role="menuitem">Importar un genoma (.json)<input type="file" accept=".json,application/json" data-import hidden></label>
      </div></span>`;
  }

  // raíl: plantillas (con su porqué) y bloques (con lo que hacen y si se pueden añadir ya)
  function renderRail() {
    const tpls = [BLANK, ...S.templates].map((t) => {
      const ico = /^\S+/.exec(t.name)[0], nm = t.name.replace(/^\S+\s/, '');
      const opened = S.tplOpen === t.key;
      return `<li class="tpl2${opened ? ' open' : ''}" data-key="t:${esc(t.key)}">
        <button type="button" class="tpl2-head" data-tpl="${esc(t.key)}" aria-expanded="${opened}"><span class="ti" aria-hidden="true">${esc(ico)}</span><b>${esc(nm)}</b><small>${esc(t.short || TPL_SHORT[t.key] || '')}</small></button>
        ${opened ? `<div class="tpl2-body"><p>${esc(t.why)}</p><p class="dim">${t.paramCount ? `${t.paramCount.toLocaleString('es-ES')} pesos` : 'sin bloques ni pesos'}</p>
          <form class="tpl-form" data-create="${esc(t.key)}"><label>Nombre <input name="name" value="${esc(t.key === 'blank' ? 'Mi red' : nm)}" maxlength="32" required></label><button class="primary" type="submit">Crear red</button></form></div>` : ''}
      </li>`;
    }).join('');
    let pal = '';
    if (S.genome) {
      const groups = M.palette(catalog, S.level).map((g) => `
        <h4 class="grp g-${g.key}">${esc(g.name)}<small>${esc(g.ask)}</small></h4>
        <ul class="pal">${g.blocks.map((b) => {
          const a = Hn.advice(S.genome, catalog, b.type);
          const short = String(b.explain).split(/[.:]/)[0];
          return `<li data-key="p:${esc(b.type)}"><button type="button" class="pal-item g-${g.key}${a.can ? '' : ' no'}${a.missing ? ' missing' : ''}" data-add="${esc(b.type)}" ${a.can ? '' : 'aria-disabled="true"'} aria-describedby="edPalTip"><span class="ico" aria-hidden="true">${esc(b.icon)}</span><span class="pn">${esc(b.name)}</span><small>${esc(short)}</small></button></li>`;
        }).join('')}</ul>`).join('');
      const hidden = catalog.blocks.length - M.palette(catalog, S.level).reduce((s, g) => s + g.blocks.length, 0);
      // sesión 11: la explicación iba aquí y, al crecer con el ratón encima, empujaba la lista y el clic caía en otro
      // bloque; ahora sale al lado (renderPalTip) y este texto no cambia nunca
      pal = `<h3>Nuevo bloque <small>pulsa para añadirlo</small></h3>
        <p class="pal-hint">Pasa el ratón (o el foco) por un bloque: al lado verás qué hace y dónde irá en tu red.</p>
        ${groups}${hidden ? `<p class="hint">${hidden} bloques más en ${S.level === 'aprendiz' ? 'Artesano y Científico' : 'Científico'}: cambia la vista arriba del lienzo (nada se bloquea).</p>` : ''}`;
    }
    patch($('edRail'), `<h3>Plantillas <small>para empezar</small></h3><ul class="tpls2">${tpls}</ul>${pal}`);
    renderPalTip();
  }
  // qué hace el bloque bajo el ratón (o con el foco) y dónde iría: flota a la derecha del raíl, a su altura
  function renderPalTip() {
    const tip = $('edPalTip'), hov = S.genome && S.palHover && M.entryOf(catalog, S.palHover);
    const item = hov && $('edRail').querySelector(`[data-add="${CSS.escape(S.palHover)}"]`);
    if (!item) { tip.hidden = true; return; }
    const a = Hn.advice(S.genome, catalog, S.palHover);
    tip.className = `pal-tip${a.can ? '' : ' no'}`;
    patch(tip, `<b>${esc(hov.icon)} ${esc(hov.name)}</b>: ${esc(hov.explain)}<span class="why">${esc(a.why)}</span>`);
    tip.hidden = false;
    const R = root.getBoundingClientRect(), r = item.getBoundingClientRect(), rail = $('edRail').getBoundingClientRect();
    tip.style.left = `${rail.right - R.left + 8}px`;
    tip.style.top = `${Math.max(4, Math.min(R.height - tip.offsetHeight - 4, r.top - R.top))}px`;
  }

  // barra del lienzo: nivel de vista, datos, estado (con lo que le falta), leyenda y zoom
  function renderTools() {
    const lv = M.LEVELS.map((l) => `<button type="button" data-level="${l}" aria-pressed="${S.level === l}">${M.LEVEL_NAMES[l]}</button>`).join('');
    if (!S.genome) { patch($('edTools'), `<div class="ed-levels" role="group" aria-label="Nivel de vista">${lv}</div>`); return; }
    const g = S.genome, st = statusOf(), gen = g.lineage && Number.isInteger(g.lineage.generation) ? g.lineage.generation : 0;
    const net = S.nets.find((n) => n.id === S.netId);
    patch($('edTools'), `<div class="ed-levels" role="group" aria-label="Nivel de vista: cuánto se ve (nada se bloquea)">${lv}</div>
      <p class="ed-facts" title="${esc(g.id)}"><span>gen ${gen}</span><span>${g.blocks.length} bloques</span><span>${S.params === null ? 'pesos: —' : `${S.params.toLocaleString('es-ES')} pesos`}</span>${net && net.stats && Number.isFinite(net.stats.games) ? `<span>${net.stats.games} partidas</span>` : ''}${net && net.isQueen ? '<span class="tag queen">reina</span>' : ''}${net && net.training ? '<span class="tag busy">entrenando</span>' : ''}</p>
      <button type="button" class="ed-status ${st.cls}" data-ptab="avisos" title="Ver qué le falta y los avisos">${esc(st.text)}</button>
      ${S.dirty ? '<span class="dirty" title="Guarda para que juegue así">cambios sin guardar</span>' : ''}
      <span class="zoom" role="group" aria-label="Zoom"><button type="button" data-zoom="-1" aria-label="Alejar">−</button><span class="mono" id="edZoom">${Math.round(S.zoom * 100)} %</span><button type="button" data-zoom="1" aria-label="Acercar">+</button><button type="button" data-zoom="fit" aria-pressed="${S.fit}" title="Que la red entera quepa en el lienzo">Encajar</button><button type="button" data-act="tidy" title="Vuelve a colocar los bloques por columnas">Ordenar</button></span>
      <button type="button" class="coach-open" data-coach="open" aria-pressed="${!!(S.coach && S.coach.on)}" title="Guía paso a paso: monta una red entendiendo qué hace cada pieza">Guía</button>`);
  }

  // ---------- lienzo ----------
  // colocación de model.js (columnas por profundidad, filas por baricentro) con tarjetas más grandes
  function layout() {
    const L = M.layout(S.genome, catalog, {});
    const nodes = {};
    for (const [id, p] of Object.entries(L.nodes)) nodes[id] = { x: PAD.x + p.col * COL_W, y: Math.round(PAD.y + (p.y - 64) * ROW_K), col: p.col };
    for (const [id, p] of Object.entries(S.pos || {})) if (nodes[id] && p && Number.isFinite(p.x) && Number.isFinite(p.y)) nodes[id] = { ...nodes[id], x: p.x, y: p.y };
    const cols = L.cols.map((_, c) => ({ x: PAD.x + c * COL_W, c }));
    const xs = Object.values(nodes).map((n) => n.x + CARD.w), ys = Object.values(nodes).map((n) => n.y + CARD.h);
    return { nodes, cols, width: Math.max(PAD.x * 2 + (cols.length - 1) * COL_W + CARD.w, ...xs.map((x) => x + PAD.x)), height: Math.max(PAD.y + 3 * 92, ...ys.map((y) => y + 40)) };
  }
  function colTitle(L, c) {
    const ids = Object.entries(L.nodes).filter(([, p]) => p.col === c).map(([id]) => id);
    const groups = new Set(ids.map((id) => (M.entryOf(catalog, S.genome.blocks.find((b) => b.id === id).type) || {}).group));
    if (c === 0) return { key: 'eyes', t: COLTITLE.eyes };
    const out = groups.has('hands') || groups.has('feet'), ins = groups.has('instinct'), mem = groups.has('memory');
    if (out && !ins && !mem) return { key: 'out', t: COLTITLE.out };
    const parts = [ins && 'instinct', mem && 'memory', out && 'out'].filter(Boolean);
    if (!parts.length) return { key: 'instinct', t: ['', ''] };
    if (parts.length === 1) return { key: parts[0], t: COLTITLE[parts[0]] };
    return { key: parts[0], t: [parts.map((p) => COLTITLE[p][0]).join(' y '), parts.map((p) => COLTITLE[p][1]).join(' ')] };
  }
  function renderBoard() {
    const b = $('edBoard');
    if (!S.genome) {
      patch(b, `<div class="board-empty"><h2>Elige una red o crea una</h2><p>A la izquierda tienes las plantillas: <b>Desde cero</b> si quieres montarla tú, bloque a bloque, o una ya montada para cambiarla.</p><p class="dim">Aquí verás sus bloques unidos por cables, de los ojos (lo que ve) a las manos (lo que hace).</p></div>`);
      return;
    }
    if (!S.genome.blocks.length) { patch(b, S.coach && S.coach.on ? '<div class="board-empty coach-only" data-key="start"><p class="dim">Aquí irá tu red, de izquierda a derecha: lo que ve → cómo piensa → lo que hace. Sigue la guía.</p></div>' : startHTML()); renderCoach(); return; }
    const keep = { left: b.scrollLeft, top: b.scrollTop };
    const L = layout();
    // encajar: la red entera cabe en el lienzo, a lo ancho y a lo alto (entre 55 % y 100 %); si ni así, lo que sobra se
    // recorre con la rueda (sesión 9: a 1280×800 un cuarto de Tortuga quedaba escondido bajo el panel)
    const coachW = S.coach && S.coach.on ? Math.min(360, b.clientWidth * 0.4) : 0; // la guía tapa ese trozo del lienzo
    if (S.fit) S.zoom = Math.max(0.55, Math.min(1, (b.clientWidth - 16 - coachW) / (L.width + 12), (b.clientHeight - 12) / (L.height + 8)));
    const z = S.zoom;
    const zl = $('edTools').querySelector('#edZoom');
    if (zl) zl.textContent = `${Math.round(z * 100)} %`;
    const heads = L.cols.map((c) => { const t = colTitle(L, c.c); return `<div class="colhead g-${t.key}" data-key="h:${c.c}" style="left:${c.x}px"><b>${esc(t.t[0])}</b><small>${esc(t.t[1])}</small></div>`; }).join('');
    const nodes = S.genome.blocks.map((blk) => nodeHTML(blk, L.nodes[blk.id])).join('');
    const flags = S.genome.blocks.map((blk) => flagHTML(blk, L.nodes[blk.id])).join('');
    const missing = Hn.readiness(S.genome, catalog).filter((x) => x.required && !x.ok);
    patch(b, `<div class="board-inner" data-key="inner" style="width:${L.width}px;height:${L.height}px;zoom:${z};--z:${z}">
        ${heads}
        <svg class="wires" data-key="svg" width="${L.width}" height="${L.height}" aria-hidden="true">${wiresSVG(L)}<path id="edTmpWire" data-key="tmp" class="wire tmp" d=""/></svg>
        ${nodes}${flags}
      </div>
      ${S.coach && S.coach.on ? '' : missing.length ? `<aside class="needs" data-key="needs" aria-label="Lo que le falta para poder jugar"><b>Para poder jugar le falta:</b><ul>${missing.map((x) => `<li>${esc(x.need)} ${readyButtons(x)}</li>`).join('')}</ul></aside>` : ''}`);
    b.scrollLeft = keep.left; b.scrollTop = keep.top;
    renderWireTools();
    renderCoach();
  }
  function renderCoach() {
    const el = $('edCoach'), on = !!(S.coach && S.coach.on && S.genome);
    el.hidden = !on;
    patch(el, on ? coachHTML() : '');
    coachMark();
  }
  function readyButtons(x) {
    return `${(x.add || []).map((t) => `<button type="button" class="mini" data-add="${esc(t)}">Añadir ${esc((M.entryOf(catalog, t) || { name: t }).name)}</button>`).join(' ')}${x.wire ? ` <button type="button" class="mini" data-wireup="${esc(x.wire[0])}|${esc(x.wire[1])}">Unir ${esc(x.wire[0])} → ${esc(x.wire[1])}</button>` : ''}`;
  }
  // ---------- guía «Tu primera red» (coach.js): una tarjeta sobre el lienzo que pregunta, pide una cosa y explica lo que
  // ha cambiado con los números del banco. Se guarda por red (y el avance, en el mundo, para el tutorial de P10) ----------
  function coachSave() {
    if (!S.netId || !S.coach) return;
    store.set(`gw.coach.${S.netId}`, S.coach);
    if (S.world && S.world.meta) {
      const tutorial = { ...(S.world.meta.tutorial || {}), primeraRed: { net: S.netId, done: S.coach.marked, bet: S.coach.bet, on: S.coach.on } };
      S.world.meta = { ...S.world.meta, tutorial };
      api(`/api/worlds/${S.world.n}/meta`, 'PUT', { tutorial }).catch(() => {});
    }
  }
  function coachStart() { S.coach = { on: true, marked: [], bet: null, probed: false, hint: false }; coachSave(); render(); }
  function coachCtx() {
    const g = S.genome, d = S.bench.now && S.bench.now.ok ? S.bench.now.decision : null;
    const cand = g.blocks.find((b) => b.type === 'eye.candidates' || b.type === 'eye.simulator');
    const ch = g.blocks.find((b) => b.type === 'hand.choose');
    const think = ch && g.wires.filter((w) => w.to === ch.id).map((w) => g.blocks.find((b) => b.id === w.from)).find((b) => b && b.type === 'dense');
    return {
      readiness: Hn.readiness(g, catalog), scene: S.bench.scene, bet: S.coach && S.coach.bet,
      saved: !S.dirty && !!S.saved && S.saved.blocks.length > 0, probed: !!(S.coach && S.coach.probed),
      cands: d && d.phase !== 'move' && Array.isArray(d.candidates) ? d.candidates.length : (g.imagination && g.imagination.n) || null,
      candDim: cand && S.dims && S.dims[cand.id] ? S.dims[cand.id].dim : null,
      pick: d && d.phase !== 'move' ? Bn.pick(d) : null,
      think: think && think.params ? think.params.units : null,
    };
  }
  // la guía en este momento; si un paso acaba de cumplirse, lo apunta
  function coachNow() {
    const x = coachCtx(), st = Co.coachState(S.genome, x, S.coach.marked);
    if (st.doneKeys.length !== S.coach.marked.length) { S.coach.marked = st.doneKeys; S.coach.hint = false; coachSave(); }
    return { st, x };
  }
  function coachHTML() {
    if (!S.coach || !S.coach.on || !S.genome) return '';
    const { st, x } = coachNow(), N = Co.STEPS.length;
    const prev = st.i > 0 ? Co.STEPS[st.i - 1] : null;
    const dots = Co.STEPS.map((k, j) => `<i class="${j < st.i ? 'ok' : j === st.i ? 'now' : ''}" title="${esc(k.title)}"></i>`).join('');
    const after = prev ? `<div class="coach-after"><b>✓ ${esc(prev.title)}</b><p>${esc(prev.after(x))}</p></div>` : '';
    if (st.finished) {
      return `<aside class="coach done" data-key="coach" aria-label="Guía: tu primera red" aria-live="polite"><header><b>Tu primera red</b><span class="dots">${dots}</span><button type="button" class="x" data-coach="close" aria-label="Cerrar la guía">✕</button></header>
        ${after}<p class="coach-end">Has montado una red entera sabiendo qué hace cada pieza. Ahora es tuya: cambia lo que quieras (la Guía sigue arriba, en la barra).</p>
        <p class="row"><button type="button" class="primary mini" data-coach="close">Cerrar la guía</button><button type="button" class="mini" data-coach="restart">Empezar de nuevo</button></p></aside>`;
    }
    const k = st.step, help = Co.helpOffered(st.i) || S.coach.hint;
    const bet = k.bet ? `<p class="coach-bet row"><button type="button" class="mini" data-coach="bet:si">Sí, apunta</button><button type="button" class="mini" data-coach="bet:no">No, es al azar</button><button type="button" class="mini" data-coach="bet:nose">Ni idea</button></p>` : '';
    return `<aside class="coach" data-key="coach" aria-label="Guía: tu primera red" aria-live="polite"><header><b>Tu primera red</b><span class="mono">paso ${st.i + 1} de ${N}</span><span class="dots">${dots}</span><button type="button" class="x" data-coach="close" aria-label="Cerrar la guía">✕</button></header>
      ${after}<h3>${esc(k.title)}</h3><p class="ask">${esc(k.ask)}</p><p class="todo">👉 ${esc(k.todo)}</p>${bet}
      <p class="row">${k.help && help ? '<button type="button" class="mini" data-coach="help" title="Lo hace por ti; mira qué cambia">Hazlo por mí</button>' : ''}${!help && k.help ? '<button type="button" class="mini" data-coach="hint">No lo encuentro</button>' : ''}</p></aside>`;
  }
  // ilumina lo que pide el paso (en los primeros, siempre; después, solo si se pide la pista)
  function coachMark() {
    for (const el of root.querySelectorAll('.coach-target')) el.classList.remove('coach-target');
    if (!S.coach || !S.coach.on || !S.genome) return;
    const st = Co.coachState(S.genome, coachCtx(), S.coach.marked);
    if (!st.step || !(Co.helpOffered(st.i) || S.coach.hint)) return;
    const g = S.genome, id = (t) => (g.blocks.find((b) => b.type === t) || {}).id;
    let el = null;
    if (st.step.target === 'port') { const c = id('eye.candidates') || id('eye.simulator'); el = c && root.querySelector(`[data-node="${CSS.escape(c)}"] .port.out`); }
    else if (st.step.target === 'wire') { const ch = id('hand.choose'); const i = g.wires.findIndex((w) => w.to === ch && ['eye.candidates', 'eye.simulator'].includes((g.blocks.find((b) => b.id === w.from) || {}).type)); el = i >= 0 && root.querySelector(`svg.wires path.wire[data-key="w:${i}"]`); }
    else el = root.querySelector(st.step.target);
    if (!el) return;
    el.classList.add('coach-target');
    // lo que pide un paso nuevo se trae a la vista una vez (a 1280 × 800, Candidatos quedaba cortado al pie del raíl)
    const shownKey = `${st.step.key}:${S.coach.hint}`;
    if (coachShown === shownKey) return;
    coachShown = shownKey;
    const box = el.closest('#edRail, #edBench, #edBoard');
    if (box) {
      const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.bottom > b.bottom - 8) box.scrollTop += r.bottom - b.bottom + 48;
      else if (r.top < b.top + 8) box.scrollTop -= b.top - r.top + 48;
    }
  }
  // "Hazlo por mí": el mismo cambio que harías tú, de una vez (se deshace con Ctrl+Z)
  function coachHelp() {
    const st = Co.coachState(S.genome, coachCtx(), S.coach.marked), h = st.step && st.step.help;
    if (!h) return;
    if (h.scene) { S.bench.scene = h.scene; scheduleBench(0); render(); return; }
    let g = S.genome;
    const id = (t) => (g.blocks.find((b) => b.type === t) || {}).id;
    const thinkId = () => { const ch = id('hand.choose'); const w = g.wires.find((x) => x.to === ch && (g.blocks.find((z) => z.id === x.from) || {}).type === 'dense'); return w && w.from; };
    const wire = (a, b) => {
      const A = id(a), B = b === 'dense' ? thinkId() : id(b);
      if (!A || !B || g.wires.some((w) => w.from === A && w.to === B)) return;
      const r = M.connect(g, A, B);
      if (!r.error) g = r.genome;
    };
    for (const t of h.add || []) if (!id(t)) g = M.addBlock(g, t, catalog).genome;
    if (h.wire) wire(h.wire[0], h.wire[1]);
    if (h.wire2) wire(h.wire2[0], h.wire2[1]);
    if (h.insert) {
      const ch = id('hand.choose'), i = g.wires.findIndex((w) => w.to === ch && ['eye.candidates', 'eye.simulator'].includes((g.blocks.find((b) => b.id === w.from) || {}).type));
      if (i >= 0) g = M.insertOnWire(g, i, h.insert, catalog).genome;
    }
    if (g !== S.genome) commit(g, { select: null, label: `Guía: ${st.step.title.toLowerCase()}` });
  }

  // red sin bloques: por dónde empezar, explicado
  function startHTML() {
    const r = Hn.readiness(S.genome, catalog);
    return `<div class="board-start" data-key="start">
      <h2>Tu red está vacía: empieza por aquí</h2>
      <p>Una red va de izquierda a derecha, como la señal: <b class="c-eyes">Ojos</b> (qué ve) → <b class="c-instinct">Instinto</b> y <b class="c-memory">Memoria</b> (cómo piensa y qué recuerda) → <b class="c-hands">Manos</b> y <b class="c-feet">Pies</b> (qué hace). Para poder jugar necesita, como mínimo, estas tres cosas:</p>
      <ol>${r.filter((x) => x.required).map((x) => `<li class="${x.ok ? 'ok' : ''}"><b>${esc(x.text)}</b><span>${esc(x.need)}</span>${x.ok ? '<i>hecho</i>' : readyButtons(x)}</li>`).join('')}</ol>
      <p class="dim">También puedes añadir cualquier bloque desde la lista de la izquierda y unirlo arrastrando desde su punto de salida (el círculo de la derecha) hasta otro bloque.</p>
      <p><button type="button" class="primary" data-coach="open">Guía paso a paso</button> <span class="dim">nueve pasos: qué hace cada pieza, viéndolo en el banco de pruebas</span></p></div>`;
  }
  function nodeHTML(blk, p) {
    const e = M.entryOf(catalog, blk.type) || { name: blk.type, icon: '?', group: 'instinct', params: [] };
    const iss = (S.issues.byBlock[blk.id] || []);
    const err = iss.some((x) => x.kind === 'error'), warn = !err && iss.length;
    const main = (e.params || []).find((q) => q.type === 'int' || q.type === 'enum');
    const val = main && blk.params && blk.params[main.key] !== undefined ? ` · ${num(blk.params[main.key])}` : '';
    const sel = S.sel && S.sel.kind === 'block' && S.sel.id === blk.id;
    const frozen = Array.isArray(S.genome.frozen) && S.genome.frozen.includes(blk.id);
    const role = Hn.roleOf(catalog, S.genome, blk, S.dims);
    const lk = S.link ? (S.link.from === blk.id ? ' link-from' : S.link.ok.has(blk.id) ? ' link-ok' : ' link-no') : '';
    const lkWhy = S.link && S.link.why.get(blk.id);
    return `<button type="button" class="node g-${e.group}${sel ? ' sel' : ''}${err ? ' err' : ''}${warn ? ' warn' : ''}${lk}" data-key="n:${esc(blk.id)}" data-node="${esc(blk.id)}" style="left:${p.x}px;top:${p.y}px" aria-label="${esc(e.name)} ${esc(blk.id)}: ${esc(role)}${err ? ', con error' : warn ? ', con aviso' : ''}" ${lkWhy ? `title="${esc(lkWhy)}"` : ''}>
      ${e.group === 'eyes' ? '' : `<span class="port in" data-portin="${esc(blk.id)}" aria-hidden="true" title="Arrastra desde aquí para enchufar (o, si ya tiene cable, para desenchufarlo). Alt + clic quita todos sus cables"></span>`}
      <span class="ico" aria-hidden="true">${esc(e.icon)}</span>
      <span class="nm">${esc(e.name)}${esc(val)} <span class="mono id">${esc(blk.id)}</span>${frozen ? ' <span class="frz" title="Congelado: no aprende">❄</span>' : ''}</span>
      <span class="role">${esc(role)}</span>
      <span class="dots" aria-hidden="true">${dotsHTML(blk.id)}</span>
      ${e.group === 'hands' || e.group === 'feet' ? '' : `<span class="port out" data-port="${esc(blk.id)}" aria-hidden="true" title="Arrastra hasta otro bloque para unirlos. Alt + clic quita todos sus cables"></span>`}
    </button>`;
  }
  // neuronas del bloque: un punto por neurona (hasta 16), encendido según su valor en la escena del banco
  function dotsHTML(id) {
    const s = S.bench.sig && S.bench.sig[id];
    if (!s || !s.sample.length) return '<i class="off"></i>'.repeat(8);
    const vals = s.sample.slice(0, 16), m = Math.max(1e-9, ...vals.map((v) => Math.abs(v)));
    return vals.map((v) => `<i style="opacity:${(0.18 + 0.82 * Math.abs(v) / m).toFixed(2)}" class="${v < 0 ? 'neg' : 'pos'}"></i>`).join('') + (s.sample.length > 16 ? '<em>+</em>' : '');
  }
  function flagHTML(blk, p) {
    const errs = (S.issues.byBlock[blk.id] || []).filter((x) => x.kind === 'error');
    if (!errs.length) return '';
    const x = errs[0];
    const hint = Hn.hintFor(S.genome, catalog, x);
    const fx = Hn.fixes(S.genome, catalog, S.check).filter((f) => f.key.endsWith(`:${blk.id}`) || (Number.isInteger(x.wire) && f.key.endsWith(`:${x.wire}`)));
    return `<div class="flag" data-key="f:${esc(blk.id)}" style="left:${p.x}px;top:${p.y + CARD.h + 6}px" role="note">${esc(x.message)}${hint ? `<span class="hintline">👉 ${esc(hint)}</span>` : ''}${fx.map((f, i) => `<button type="button" class="mini fix" data-fix="${esc(f.key)}">${esc(f.label)}</button>`).join('')}${errs.length > 1 ? `<span class="more">y ${errs.length - 1} más en Avisos</span>` : ''}</div>`;
  }
  // un cable largo no pasa por debajo de otra tarjeta (sesión 9: parecía que entraba en ella y salía por el otro lado):
  // si la curva la cruza, la rodea por arriba o por abajo, por el lado más cercano y sin meterse en otra
  function wirePath(a, b, L = null, ends = []) {
    const x1 = a.x + CARD.w, y1 = a.y + CARD.h / 2, x2 = b.x, y2 = b.y + CARD.h / 2;
    const seg = (xa, ya, xb, yb) => { const dx = Math.max(xb > xa ? 24 : 48, Math.abs(xb - xa) / 2); return ` C${xa + dx},${ya} ${xb - dx},${yb} ${xb},${yb}`; };
    if (!L || x2 <= x1 + 40) return `M${x1},${y1}${seg(x1, y1, x2, y2)}`;
    const G = 9; // holgura alrededor de cada tarjeta
    const cards = Object.entries(L.nodes).filter(([id]) => !ends.includes(id)).map(([, p]) => ({ l: p.x - G, r: p.x + CARD.w + G, t: p.y - G, b: p.y + CARD.h + G }))
      .filter((c) => c.l > x1 - 1 && c.r < x2 + 1).sort((p, q) => p.l - q.l);
    const inside = (y, c0) => cards.some((o) => o !== c0 && o.r > c0.l && o.l < c0.r && y > o.t && y < o.b);
    // altura de la curva directa (la misma Bézier de seg) desde (xa, ya) hasta (xb, yb) en la abscisa X; x(t) es monótona
    const yOn = (xa, ya, xb, yb, X) => {
      const dx = Math.max(xb > xa ? 24 : 48, Math.abs(xb - xa) / 2), bx = (t) => (1 - t) ** 3 * xa + 3 * (1 - t) ** 2 * t * (xa + dx) + 3 * (1 - t) * t * t * (xb - dx) + t ** 3 * xb;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bx(m) < X) lo = m; else hi = m; }
      const t = (lo + hi) / 2;
      return (1 - t) ** 3 * ya + 3 * (1 - t) ** 2 * t * ya + 3 * (1 - t) * t * t * yb + t ** 3 * yb;
    };
    let d = `M${x1},${y1}`, px = x1, py = y1;
    for (const c of cards) {
      if (c.l < px) continue;
      // la tarjeta se cruza si la curva, en todo su ancho (no solo en el centro: sesión 10, c → cd pasaba por g), entra en su alto
      const yl = yOn(px, py, x2, y2, c.l), yr = yOn(px, py, x2, y2, c.r), yAt = yOn(px, py, x2, y2, (c.l + c.r) / 2);
      if (Math.max(yl, yr) <= c.t || Math.min(yl, yr) >= c.b) continue;
      let up = c.t, down = c.b;
      while (inside(up, c)) up -= 12;
      while (inside(down, c)) down += 12;
      const yy = Math.max(4, Math.abs(yAt - up) <= Math.abs(down - yAt) ? up : down);
      d += `${seg(px, py, c.l, yy)} L${c.r},${yy}`;
      px = c.r; py = yy;
    }
    return d + seg(px, py, x2, y2);
  }
  function wiresSVG(L) {
    const groupOf = (id) => { const blk = S.genome.blocks.find((x) => x.id === id); const e = blk && M.entryOf(catalog, blk.type); return e ? e.group : 'instinct'; };
    return (S.genome.wires || []).map((w, i) => {
      const a = L.nodes[w.from], b = L.nodes[w.to];
      if (!a || !b) return '';
      // los cables no esquivan la tarjeta que arrastras: si no, huirían de ella y nunca podrías soltarla encima de uno
      const d = wirePath(a, b, L, drag && drag.moved ? [w.from, w.to, drag.id] : [w.from, w.to]);
      const bad = (S.issues.byWire[i] || []).length;
      const sel = S.sel && S.sel.kind === 'wire' && S.sel.index === i;
      // el cable cuya punta llevas en la mano no se dibuja: lo dibuja el cable provisional que sigue al ratón
      const held = S.link && S.link.held.kind === 'end' && S.link.held.index === i ? ' held' : '';
      // encima del cable: el ratón (se ilumina) o una tarjeta que se meterá en medio al soltarla (se abre un hueco)
      const hov = S.hoverWire === i ? ' hov' : '';
      const ins = drag && drag.wire === i ? (drag.tg.get(i) && drag.tg.get(i).ok ? ' ins-ok' : ' ins-no') : '';
      // nervios: la señal real del bloque de salida en la escena del banco (más señal, pulso más vivo y más rápido)
      const s = S.bench.sig && S.bench.sig[w.from];
      const nerve = s && !bad ? `<path class="nerve" data-key="nv:${i}" d="${d}" style="--lv:${s.level.toFixed(2)};animation-duration:${(2.6 - 1.9 * s.level).toFixed(2)}s"/>` : '';
      return `<path data-key="w:${i}" class="wire g-${groupOf(w.from)} s-${S.streams[w.from] || 'ctx'}${sel ? ' sel' : ''}${bad ? ' bad' : ''}${held}${hov}${ins}" d="${d}"/>${held ? '' : nerve}<path data-key="hw:${i}" class="hit" data-wire="${i}" d="${d}"><title>${esc(w.from)} → ${esc(w.to)}: lleva ${esc(STREAM[S.streams[w.from]] || '—')}${s ? ` · señal ${pct(s.level)} del bloque más activo` : ''}</title></path>`;
    }).join('');
  }
  function redrawWires() {
    const svg = $('edBoard').querySelector('svg.wires');
    if (!svg) return;
    patch(svg, `${wiresSVG(layout())}<path id="edTmpWire" data-key="tmp" class="wire tmp" d=""/>`);
  }
  // el cable bajo el ratón (o, si no, el elegido): «✕ Desenchufar» y «＋ Añadir capa» justo encima de su mitad, a tamaño
  // de pantalla (sesión 12: dentro del lienzo, a 58 % de zoom, el ＋ medía 15 px). Encima y no en medio: pulsar el cable
  // lo sigue eligiendo, sin riesgo de quitarlo
  function renderWireTools() {
    const el = $('edWireTools');
    const i = S.link || (drag && drag.moved) ? null : S.hoverWire ?? (S.sel && S.sel.kind === 'wire' ? S.sel.index : null);
    const bd = $('edBoard'), path = i !== null && S.genome && bd.querySelector(`svg.wires path.hit[data-wire="${i}"]`);
    if (!path) { el.hidden = true; return; }
    const w = S.genome.wires[i];
    patch(el, `<button type="button" class="wt-x" data-unwire="${i}" title="Quita el cable ${esc(w.from)} → ${esc(w.to)} (también: Supr con el cable elegido, o arrastra su punta fuera de ${esc(w.to)})">✕<span class="t"> Desenchufar</span></button><button type="button" class="wire-plus" data-wireplus="${i}" title="Mete un bloque en medio: ${esc(w.from)} → nuevo → ${esc(w.to)}">＋<span class="t"> Añadir capa</span></button>`);
    el.hidden = false;
    // el primer sitio del cable (la mitad, y si no, hacia los lados), encima o debajo, donde no tapen ninguna tarjeta
    const B = bd.getBoundingClientRect(), R = root.getBoundingClientRect(), m = path.getScreenCTM(), len = path.getTotalLength();
    const cards = [...bd.querySelectorAll('[data-node]')].map((n) => n.getBoundingClientRect());
    const cover = () => { const t = el.getBoundingClientRect(); return cards.reduce((s, c) => s + Math.max(0, Math.min(t.right, c.right) - Math.max(t.left, c.left)) * Math.max(0, Math.min(t.bottom, c.bottom) - Math.max(t.top, c.top)), 0); };
    // con texto si cabe sin tapar nada; si no, compactos (✕ y ＋; el texto sale al pasar el ratón por cada uno)
    let best = null;
    for (const compact of [false, true]) {
    el.classList.toggle('compact', compact);
    for (const f of [0.5, 0.35, 0.65, 0.22, 0.78]) {
      const q = path.getPointAtLength(len * f), x = q.x * m.a + m.e, y = q.y * m.d + m.f;
      if (x < B.left + 20 || x > B.right - 20 || y < B.top + 40 || y > B.bottom - 4) continue;
      for (const below of [false, true]) {
        el.style.left = `${x - R.left}px`; el.style.top = `${y - R.top}px`; el.classList.toggle('below', below);
        const c = cover();
        if (!best || c < best.c) best = { x, y, below, c };
        if (!c) break;
      }
      if (best && !best.c) break;
    }
    if (best && !best.c) break;
    if (!compact) best = null;
    }
    if (!best) { el.hidden = true; return; }
    el.style.left = `${best.x - R.left}px`; el.style.top = `${best.y - R.top}px`; el.classList.toggle('below', best.below);
  }


  // "+ Añadir capa" sobre un cable (P6): los bloques de en medio que caben entre los dos y, plegados, los que no y por qué
  function insertHTML(index, w) {
    const opts = Hn.insertOptions(S.genome, catalog, index, S.level);
    const ok = opts.filter((o) => o.ok), no = opts.filter((o) => !o.ok);
    const btn = (o) => `<button type="button" class="pal-item g-${o.group}" data-insert="${esc(o.type)}" data-index="${index}" title="${esc(`${w.from} → ${o.name} → ${w.to}`)}"><span class="ico" aria-hidden="true">${esc(o.icon)}</span><span class="pn">${esc(o.name)}</span></button>`;
    return `<section class="insert" id="edInsert"><h3>＋ Añadir una capa en este cable</h3>
      <p class="explain">Mete un bloque entre ${esc(w.from)} y ${esc(w.to)}: la señal pasará por él (${esc(w.from)} → nuevo → ${esc(w.to)}). Por ejemplo, un 🧠 Instinto entre Candidatos y Elegir hace que la red <i>piense</i> cada tiro antes de puntuarlo.</p>
      ${ok.length ? `<div class="ins-list">${ok.map(btn).join('')}</div>` : '<p class="hint">Aquí no cabe ningún bloque de en medio.</p>'}
      ${no.length ? `<details class="ins-no"><summary>${no.length} no caben aquí (por qué)</summary><ul>${no.map((o) => `<li><b>${esc(o.icon)} ${esc(o.name)}</b>: ${esc(o.why)}</li>`).join('')}</ul></details>` : ''}</section>`;
  }

  // ---------- panel de abajo: la capa elegida, los genes, lo que ve, versiones y avisos ----------
  function control(param, value, attrs, compact = false) {
    const id = `c-${attrs.replace(/[^a-z0-9]/gi, '-')}`;
    let input;
    switch (param.type) {
      case 'int':
      case 'number': {
        const step = param.step ?? (param.type === 'int' ? 1 : 'any');
        const range = Number.isFinite(param.min) && Number.isFinite(param.max) && (param.max - param.min) / (Number(step) || 1) <= 2000;
        input = `${range ? `<input type="range" ${attrs} min="${param.min}" max="${param.max}" step="${step}" value="${esc(value)}" aria-label="${esc(param.name)}">` : ''}<input id="${id}" class="numin mono" type="number" ${attrs} ${Number.isFinite(param.min) ? `min="${param.min}"` : ''} ${Number.isFinite(param.max) ? `max="${param.max}"` : ''} step="${step}" value="${esc(value)}">`;
        break;
      }
      case 'enum':
        input = `<select id="${id}" ${attrs}>${(param.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
        break;
      case 'bool':
        input = `<input id="${id}" type="checkbox" ${attrs} ${value ? 'checked' : ''}>`;
        break;
      case 'set':
        input = `<span class="set" role="group" aria-label="${esc(param.name)}">${(param.options || []).map((o) => `<label><input type="checkbox" ${attrs} data-opt="${esc(o.value)}" ${(value || []).map(String).includes(String(o.value)) ? 'checked' : ''}>${esc(o.name)}</label>`).join('')}</span>`;
        break;
      default:
        input = `<span class="mono">${esc(JSON.stringify(value))}</span>`;
    }
    const opt = param.type === 'enum' && (param.options || []).find((o) => String(o.value) === String(value));
    return `<div class="ctl${compact ? ' compact' : ''}"><label for="${id}">${esc(param.name)}</label><div class="ctl-in">${input}</div>
      <p class="explain">${esc(param.explain || '')}${opt && opt.explain ? ` <b>${esc(opt.name)}</b>: ${esc(opt.explain)}.` : ''}${param.personality ? ` <i>${esc(param.personality)}</i>` : ''}${param.example ? `<span class="eg">${esc(param.example)}</span>` : ''}</p></div>`;
  }
  function hiddenNote(all, shown) {
    const n = all.length - shown.length;
    return n > 0 ? `<p class="hint">${n} ${n === 1 ? 'ajuste más' : 'ajustes más'} en ${S.level === 'aprendiz' ? 'Artesano o Científico' : 'Científico'}: nada se bloquea, cambia el nivel de vista para verlos.</p>` : '';
  }
  function issueRow(x) {
    const hint = Hn.hintFor(S.genome, catalog, x);
    return `<li class="${x.kind}"><b>${x.kind === 'error' ? 'Error' : 'Aviso'}</b> ${esc(x.message)}${hint ? `<span class="hintline">👉 ${esc(hint)}</span>` : x.example ? `<span class="eg">${esc(x.example)}</span>` : ''}${x.blockId && S.genome.blocks.some((b) => b.id === x.blockId) ? ` <button type="button" class="link" data-goto="${esc(x.blockId)}">ir al bloque ${esc(x.blockId)}</button>` : ''}${Number.isInteger(x.wire) && S.genome.wires[x.wire] ? ` <button type="button" class="link" data-gowire="${x.wire}">ver el cable</button>` : ''}</li>`;
  }
  // Capa: "Configuración de la capa seleccionada" · "¿Qué hace esta capa?" · sus pesos
  function capaTab() {
    if (S.sel && S.sel.kind === 'wire') {
      const w = S.genome.wires[S.sel.index];
      if (!w) return '<p class="empty">Ese cable ya no existe.</p>';
      const d = S.dims && S.dims[w.from];
      const s = S.bench.sig && S.bench.sig[w.from];
      return `<div class="capa"><section><h3>Cable ${esc(w.from)} → ${esc(w.to)}</h3>
        <p>Lleva ${esc(d ? `${STREAM[d.stream]} (${d.dim} números${d.stream === 'cand' ? ' por cada tiro imaginado' : d.stream === 'move' ? ' por cada sitio adonde moverse' : ''})` : STREAM[S.streams[w.from]] || '—')} de <button type="button" class="link" data-goto="${esc(w.from)}">${esc(w.from)}</button> a <button type="button" class="link" data-goto="${esc(w.to)}">${esc(w.to)}</button>. Si un bloque recibe varios cables, los junta en el orden en que se conectaron.</p>
        ${s ? `<p class="dim">En la escena del banco pasa una señal del ${pct(s.level)} de la del bloque más activo: por eso late ${s.level > 0.6 ? 'deprisa' : s.level > 0.25 ? 'a ritmo normal' : 'despacio'}.</p>` : ''}
        <ul class="issues">${(S.issues.byWire[S.sel.index] || []).map(issueRow).join('')}</ul>
        <button type="button" data-act="unwire" data-index="${S.sel.index}">Quitar cable</button></section>
        ${insertHTML(S.sel.index, w)}</div>`;
    }
    const blk = S.sel && S.sel.kind === 'block' && S.genome.blocks.find((b) => b.id === S.sel.id);
    if (!blk) return netSummary();
    const e = M.entryOf(catalog, blk.type);
    const shown = M.paramsAt(e, S.level);
    const ins = S.genome.wires.map((w, i) => ({ ...w, i })).filter((w) => w.to === blk.id);
    const outs = S.genome.wires.map((w, i) => ({ ...w, i })).filter((w) => w.from === blk.id);
    const d = S.dims && S.dims[blk.id];
    const isEyeBlk = e.group === 'eyes';
    const same = catalog.blocks.filter((x) => x.group === e.group && x.type !== blk.type && M.atLevel(x.level, S.level) && !String(x.type).startsWith('eye.') && !['hands', 'feet'].includes(x.group));
    const opts = Hn.connectOptions(S.genome, catalog, blk.id);
    const okFrom = opts.from.filter((o) => o.ok), noFrom = opts.from.filter((o) => !o.ok && !ins.some((w) => w.from === o.id));
    const s = S.bench.sig && S.bench.sig[blk.id];
    const H = Hn.weightHistogram(S.genome, blk.id);
    const maxN = Math.max(1, ...H.bins.map((x) => x.n));
    const nm = (id) => { const b = S.genome.blocks.find((x) => x.id === id); return b ? `${(M.entryOf(catalog, b.type) || {}).name || b.type} ${id}` : id; };
    return `<div class="capa">
      <section class="capa-cfg"><h3>Configuración de la capa seleccionada</h3>
        <p class="capa-id"><span class="ico" aria-hidden="true">${esc(e.icon)}</span> <b>${esc(e.name)}</b> <span class="mono dim">${esc(blk.id)}</span>
          ${same.length ? `<label class="swap">Tipo <select data-swap="${esc(blk.id)}"><option value="${esc(blk.type)}" selected>${esc(e.name)}</option>${same.map((x) => `<option value="${esc(x.type)}">${esc(x.name)}</option>`).join('')}</select></label>` : ''}</p>
        <div class="capa-ctls">${shown.map((p) => control(p, (blk.params || {})[p.key], `data-bparam="${esc(p.key)}" data-block="${esc(blk.id)}"`, true)).join('') || '<p class="hint">Este bloque no tiene ajustes: lo que hace depende solo de lo que le llega.</p>'}</div>
        ${hiddenNote(e.params || [], shown)}
        ${isEyeBlk ? '' : `<div class="wiring"><h4>Recibe de</h4>${ins.length ? `<ul>${ins.map((w) => `<li><button type="button" class="link" data-goto="${esc(w.from)}">${esc(nm(w.from))}</button> <button type="button" class="link" data-act="unwire" data-index="${w.i}">quitar</button></li>`).join('')}</ul>` : '<p class="hint">Nada todavía: sin entradas no hace nada.</p>'}
          ${okFrom.length ? `<label>Unir desde <select data-connect="${esc(blk.id)}"><option value="">elige un bloque…</option>${okFrom.map((o) => `<option value="${esc(o.id)}">${esc(nm(o.id))}</option>`).join('')}</select></label>` : ''}
          ${noFrom.length ? `<details class="cant"><summary>${noFrom.length} bloque${noFrom.length === 1 ? '' : 's'} no pueden unirse aquí (por qué)</summary><ul>${noFrom.map((o) => `<li><b>${esc(nm(o.id))}</b>: ${esc(o.why)}${o.hint ? ` <span class="eg">${esc(o.hint)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}</div>`}
        <div class="capa-acts"><button type="button" data-act="remove" data-id="${esc(blk.id)}">Quitar bloque</button></div>
      </section>
      <section class="capa-what"><h3>¿Qué hace esta capa?</h3>
        <p class="explain big">${esc(e.explain)}</p>${e.example ? `<p class="eg">${esc(e.example)}</p>` : ''}
        <p class="flow">${isEyeBlk ? 'Mira el tablero' : `Recibe ${ins.length ? ins.map((w) => `<button type="button" class="link" data-goto="${esc(w.from)}">${esc(w.from)}</button>`).join(', ') : 'nada todavía'}`} y da ${esc(d ? `${STREAM[d.stream]} (${d.dim} números${d.stream === 'cand' ? ' por tiro imaginado' : d.stream === 'move' ? ' por sitio' : ''})` : STREAM[S.streams[blk.id]] || '—')}${outs.length ? ` a ${outs.map((w) => `<button type="button" class="link" data-goto="${esc(w.to)}">${esc(w.to)}</button>`).join(', ')}` : ' a nadie todavía'}.</p>
        <p class="role-big">En corto: <b>${esc(Hn.roleOf(catalog, S.genome, blk, S.dims))}</b>.</p>
        ${s ? `<p class="dim">En la escena del banco («${esc(benchScene().name)}») se activa al <b>${pct(s.level)}</b> del bloque más activo (media |valor| ${f2(s.mean)}).</p>` : ''}
        <ul class="issues">${(S.issues.byBlock[blk.id] || []).map(issueRow).join('')}</ul>
      </section>
      <section class="capa-w"><h3>Sus pesos</h3>
        ${H.total ? `<svg class="histo" viewBox="0 0 ${H.bins.length * 10} 60" role="img" aria-label="Reparto de sus ${H.total} pesos">${H.bins.map((x, i) => `<rect x="${i * 10 + 1}" y="${60 - Math.max(x.n ? 2 : 0, (54 * x.n) / maxN)}" width="8" height="${Math.max(x.n ? 2 : 0, (54 * x.n) / maxN)}" class="${i === (H.bins.length - 1) / 2 ? 'zero' : x.hi <= 0 ? 'neg' : 'pos'}"><title>${f2(x.lo)} a ${f2(x.hi)}: ${x.n}</title></rect>`).join('')}</svg>
          <p class="dim histo-axis"><span>−${f2(H.maxAbs)}</span><span>0</span><span>+${f2(H.maxAbs)}</span></p>
          <p class="dim">${H.total.toLocaleString('es-ES')} pesos${H.zeros ? `, <b class="zero-t">${H.zeros} a cero</b>` : ''}. Barras naranjas: negativos; cian: positivos; la del medio, los que están cerca de 0.</p>
          <button type="button" data-ficha="${esc(S.netId)}" data-ficha-tab="quirofano" title="Abre la ficha en el Quirófano (con los pesos guardados)">Abrir en el Quirófano</button>` : '<p class="hint">Este bloque no tiene pesos: no aprende nada por sí mismo.</p>'}
      </section></div>`;
  }
  // sin bloque elegido: qué es esta red, qué le falta y qué le recomendamos
  function netSummary() {
    const r = Hn.readiness(S.genome, catalog);
    return `<div class="capa"><section class="capa-cfg"><h3>Tu red, en una lista</h3>
      <ul class="ready">${r.map((x) => `<li class="${x.ok ? 'ok' : x.required ? 'bad' : 'meh'}"><b>${x.ok ? '✔' : x.required ? '✘' : '·'} ${esc(x.text)}</b>${x.ok ? '' : `<span>${esc(x.need)}</span> ${readyButtons(x)}`}</li>`).join('')}</ul></section>
      <section class="capa-what"><h3>¿Qué hace cada capa?</h3><p class="explain big">Pulsa un bloque del lienzo: aquí verás qué hace, con un ejemplo, qué recibe y a quién se lo da, y abajo a la izquierda podrás ajustarlo.</p>
        <p class="dim">Con el teclado: Tab hasta un bloque, Intro para elegirlo, flechas para moverlo (Mayús: más lejos), Supr para quitarlo, Ctrl+Z para deshacer.</p></section></div>`;
  }
  const genomeControls = (list, root0, extra = '') => {
    const shown = list.filter((p) => M.atLevel(p.level, S.level));
    return `${shown.map((p) => control(p, M.getPath(S.genome, `${root0}.${p.key}`), `data-gpath="${esc(`${root0}.${p.key}`)}"`)).join('')}${hiddenNote(list, shown)}${extra}`;
  };
  function learningTab() {
    const method = M.getPath(S.genome, 'learning.method');
    const groups = [['', 'Cómo aprende'], ['gradient.', 'Gradiente (aprende de cada partida)'], ['evolution.', 'Evolución (copias y selección)'], ['both.', 'Los dos a la vez'], ['sleep.', 'Sueño']];
    return groups.map(([pre, title]) => {
      const list = catalog.learning.filter((p) => (pre ? p.key.startsWith(pre) : !p.key.includes('.')));
      const shown = list.filter((p) => M.atLevel(p.level, S.level));
      if (!shown.length) return '';
      // gradient.* cuenta con gradient o both; evolution.* con evolution o both; both.* solo con both; el sueño, siempre
      const active = !pre || pre === 'sleep.' || (pre === 'gradient.' && method !== 'evolution') || (pre === 'evolution.' && method !== 'gradient') || (pre === 'both.' && method === 'both');
      return `<fieldset class="${active ? '' : 'idle'}"><legend>${esc(title)}${active ? '' : ' <small>no se usa con el método elegido</small>'}</legend>${shown.map((p) => control(p, M.getPath(S.genome, `learning.${p.key}`), `data-gpath="learning.${esc(p.key)}"`)).join('')}</fieldset>`;
    }).join('') + hiddenNote(catalog.learning, catalog.learning.filter((p) => M.atLevel(p.level, S.level)));
  }
  function imaginationTab() {
    const im = IMAGINATION(catalog.limits);
    const fams = catalog.families.map((f) => {
      const cur = M.getPath(S.genome, `imagination.families.${f.id}`) || {};
      const lists = S.level === 'cientifico' ? (f.params || []).map((p) => `<div class="ctl"><label>${esc(p.name)}</label><div class="ctl-in"><input class="mono wide" data-glist="imagination.families.${esc(f.id)}.${esc(p.key)}" value="${esc((cur[p.key] || []).join(', '))}" spellcheck="false"></div><p class="explain">${esc(p.explain || '')}</p></div>`).join('') : '';
      return `<fieldset class="${cur.on === false ? 'idle' : ''}"><legend><label><input type="checkbox" data-gpath="imagination.families.${esc(f.id)}.on" ${cur.on !== false ? 'checked' : ''}> ${esc(f.name)}</label></legend>
        <p class="explain">${esc(f.explain)}</p>
        ${M.atLevel('artesano', S.level) ? control(FAMILY_WEIGHT, cur.weight, `data-gpath="imagination.families.${esc(f.id)}.weight"`) : ''}${lists}</fieldset>`;
    }).join('');
    return `${genomeControls(im, 'imagination')}<h3>Familias de tiros</h3><div class="fams">${fams}</div>`;
  }
  function genesTab() {
    const body = {
      traits: () => `<p class="hint">El carácter decide cómo usa lo que sabe: la temperatura, por ejemplo, dice cuánto se arriesga al escoger entre tiros parecidos.</p>${genomeControls(catalog.traits, 'traits')}`,
      reward: () => `<p class="hint">Qué premia y qué castiga al aprender. Cada término cambia su carácter; por ejemplo, premiar sobrevivir la vuelve cauta.</p>${genomeControls(catalog.rewardTerms, 'reward')}`,
      learning: learningTab,
      imagination: imaginationTab,
    }[S.genesTab]();
    return `<div class="subtabs" role="tablist" aria-label="Genes">${GENES.map(([k, t]) => `<button type="button" role="tab" data-genes="${k}" aria-selected="${S.genesTab === k}">${esc(t)}</button>`).join('')}</div><div class="genes">${body}</div>`;
  }
  // lo que ve cada ojo en la escena del banco, número a número y con su nombre
  function veTab() {
    const now = S.bench.now;
    if (!now || !now.ok) return `<p class="empty">${esc(now && now.error ? `El banco no puede calcularlo: ${now.error}` : 'Cuando tu red pueda jugar, aquí verás los números exactos que ve cada ojo en la escena del banco de pruebas (a la derecha).')}</p>`;
    const eyes = Bn.eyesView(S.genome, now.obs);
    if (!eyes.length) return '<p class="empty">Tu red no tiene ojos: no ve nada.</p>';
    const chosen = S.bench.pick && S.bench.pick.kind === 'shot' ? S.bench.pick.i : S.bench.pick ? S.bench.pick.i : null;
    return `<p class="hint">Escena «${esc(benchScene().name)}»: esto es lo que entra en tu red antes de decidir, ya escalado (casi todo entre −1 y 1). Cambia la escena en el banco y mira cómo cambian los números.</p>
      <div class="ve">${eyes.map((ey) => {
        const e = M.entryOf(catalog, ey.type);
        if (ey.type === 'eye.map') return veMap(ey, e);
        if (ey.stream === 'ctx') {
          const row = ey.rows[0] || [];
          return `<section><h4>${esc(e.icon)} ${esc(e.name)} <span class="mono dim">${esc(ey.blockId)}</span> <small>${row.length} números, una vez por turno</small></h4><ul class="vbars">${row.map((v, i) => `<li><span class="vn">${esc(ey.names[i] || `#${i}`)}</span><span class="vb"><i style="${v < 0 ? `right:50%;width:${Math.min(50, Math.abs(v) * 50)}%` : `left:50%;width:${Math.min(50, v * 50)}%`}" class="${v < 0 ? 'neg' : 'pos'}"></i></span><span class="vv mono">${f2(v)}</span></li>`).join('')}</ul></section>`;
        }
        const rows = ey.rows.slice(0, 8);
        return `<section><h4>${esc(e.icon)} ${esc(e.name)} <span class="mono dim">${esc(ey.blockId)}</span> <small>${ey.rows.length} filas (${ey.stream === 'cand' ? 'una por tiro imaginado' : 'una por sitio adonde moverse'}) × ${ey.names.length} números</small></h4>
          <div class="vtable-wrap"><table class="vtable"><thead><tr><th>#</th>${ey.names.map((n) => `<th title="${esc(n)}">${esc(n.length > 14 ? `${n.slice(0, 13)}…` : n)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${i === chosen ? 'chosen' : ''}"><th>${i}${i === chosen ? ' ✔' : ''}</th>${r.map((v) => `<td class="mono">${f2(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          ${ey.rows.length > 8 ? `<p class="dim">y ${ey.rows.length - 8} filas más, iguales en forma.</p>` : ''}</section>`;
      }).join('')}</div>`;
  }
  function veMap(ey, e) {
    const b = S.genome.blocks.find((x) => x.id === ey.blockId);
    const cell = (b.params && b.params.cell) || 2, W = Math.round(50 / cell), Hh = Math.round(30 / cell);
    const row = ey.rows[0] || [];
    const chans = (b.params && b.params.channels) || [];
    const CH = { obstacles: 'muros', enemies: 'enemigos', allies: 'aliados', self: 'yo', trails: 'estelas' };
    return `<section><h4>${esc(e.icon)} ${esc(e.name)} <span class="mono dim">${esc(ey.blockId)}</span> <small>${chans.length} capas de ${W}×${Hh} celdas</small></h4><div class="vmaps">${chans.map((ch, k) => `<figure><svg viewBox="0 0 ${W} ${Hh}" class="vmap">${Array.from({ length: W * Hh }, (_, i) => { const v = row[k * W * Hh + i] || 0; return v ? `<rect x="${i % W}" y="${Math.floor(i / W)}" width="1" height="1" style="opacity:${Math.min(1, v).toFixed(2)}"/>` : ''; }).join('')}</svg><figcaption>${esc(CH[ch] || ch)}</figcaption></figure>`).join('')}</div></section>`;
  }
  // versiones: lo de esta sesión (deshacer) y lo guardado en el servidor, con sus diferencias reales
  async function loadVersions() {
    if (!S.netId || S.versions.busy) return;
    S.versions.busy = true;
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/versions`);
    S.versions.busy = false;
    S.versions.list = r.ok ? r.body.versions : [];
    if (S.panelTab === 'versiones') renderPanel();
  }
  async function openVersion(n) {
    const [d, v] = await Promise.all([api(`/api/lab/nets/${encodeURIComponent(S.netId)}/versions/${n}/diff`), api(`/api/lab/nets/${encodeURIComponent(S.netId)}/versions/${n}`)]);
    if (!d.ok) { toast(reasonOf(d), 'error'); return; }
    S.versions.open = n; S.versions.diff = d.body; S.versions.ver = v.ok ? v.body : null;
    renderPanel();
  }
  function versionesTab() {
    const tl = Hi.timeline(S.hist);
    const V = S.versions;
    if (V.list === null && !V.busy) loadVersions();
    const vlist = V.list === null ? '<p class="dim">Cargando…</p>' : V.list.length ? `<ul class="vers">${V.list.map((v) => `<li data-key="v:${v.n}" class="${V.open === v.n ? 'on' : ''}"><b>versión ${v.n}</b> <span class="dim">${esc(when(v.ts))}</span><span>${esc(v.reason || '')}</span>${Number.isInteger(v.paramCount) ? `<span class="dim">${v.paramCount.toLocaleString('es-ES')} pesos</span>` : ''}
        <button type="button" class="mini" data-vdiff="${v.n}">Diferencias con la de ahora</button> <button type="button" class="mini" data-vback="${v.n}">Volver a esta…</button></li>`).join('')}</ul>` : '<p class="empty">Aún no hay versiones guardadas. Cada vez que guardas, la de antes queda aquí; y antes de cada entreno, también.</p>';
    return `<div class="vcols"><section><h3>Cambios de esta sesión <small>(guardados o no; Ctrl+Z los deshace)</small></h3>
        ${tl.length ? `<ol class="tl">${tl.map((x) => `<li><button type="button" class="link" data-jump="${x.steps}" title="Deshacer hasta aquí (${x.steps} paso${x.steps === 1 ? '' : 's'})">${esc(x.label)}</button></li>`).join('')}</ol><p class="dim">Pulsa uno para volver a como estaba antes de ese cambio (se puede rehacer).</p>` : '<p class="empty">Nada todavía: cada cambio que hagas aparecerá aquí.</p>'}</section>
      <section><h3>Versiones guardadas <small>en el servidor</small></h3>${vlist}${V.diff ? diffHTML(V.diff, V.ver) : ''}</section></div>`;
  }
  function diffHTML(d, ver) {
    const ST = { added: ['＋', 'añadido'], removed: ['－', 'quitado'], changed: ['～', 'cambiado'], same: ['＝', 'igual'] };
    const changed = d.blocks.filter((b) => b.status !== 'same');
    const tr = Object.keys({ ...(d.traits.before || {}), ...(d.traits.after || {}) }).filter((k) => JSON.stringify(d.traits.before[k]) !== JSON.stringify(d.traits.after[k]));
    const cmp = (top) => (ver && ver.genome ? Object.keys({ ...(ver.genome[top] || {}), ...(S.saved[top] || {}) }).filter((k) => JSON.stringify((ver.genome[top] || {})[k]) !== JSON.stringify((S.saved[top] || {})[k])) : []);
    const rw = cmp('reward'), ln = cmp('learning');
    return `<div class="vdiff"><h4>Versión ${S.versions.open} → la guardada ahora</h4>
      ${changed.length ? `<ul>${changed.map((b) => `<li class="st-${b.status}"><b>${ST[b.status][0]} ${esc(b.name)}</b> ${ST[b.status][1]}${b.status === 'changed' && b.relChange ? ` · pesos movidos un ${pct(Math.min(1, b.relChange))}` : ''}</li>`).join('')}</ul>` : '<p>Mismos bloques con los mismos pesos.</p>'}
      ${d.wires.added.length || d.wires.removed.length ? `<p>Cables: ${d.wires.added.map((w) => `<span class="st-added">＋ ${esc(w.from)} → ${esc(w.to)}</span>`).join(' ')} ${d.wires.removed.map((w) => `<span class="st-removed">－ ${esc(w.from)} → ${esc(w.to)}</span>`).join(' ')}</p>` : ''}
      ${tr.length ? `<p>Carácter: ${tr.map((k) => `${esc(k)} ${esc(num(d.traits.before[k]))} → ${esc(num(d.traits.after[k]))}`).join(' · ')}</p>` : ''}
      ${rw.length ? `<p>Recompensa: ${rw.map((k) => `${esc(k)} ${esc(JSON.stringify(ver.genome.reward[k]))} → ${esc(JSON.stringify(S.saved.reward[k]))}`).join(' · ')}</p>` : ''}
      ${ln.length ? `<p>Aprendizaje: ${ln.map((k) => esc(k)).join(', ')} cambiados</p>` : ''}
      ${JSON.stringify(d.imagination.before) !== JSON.stringify(d.imagination.after) ? '<p>Imaginación cambiada.</p>' : ''}
      ${d.text && d.text.length ? `<p class="dim">Mutaciones: ${d.text.map(esc).join(' · ')}</p>` : ''}</div>`;
  }
  function avisosTab() {
    const all = [...S.check.errors.map((x) => ({ ...x, kind: 'error' })), ...S.check.warnings.map((x) => ({ ...x, kind: 'warning' }))];
    if (!S.forPlay.ok && S.check.ok) all.push(...S.forPlay.errors.map((x) => ({ ...x, kind: 'warning' })).filter((x) => !all.some((y) => y.code === x.code)));
    const fx = Hn.fixes(S.genome, catalog, S.check);
    const fresh = freshBlocks();
    const r = Hn.readiness(S.genome, catalog);
    const server = S.server && S.server.error ? `<h3>El servidor no la guardó</h3><p class="bad">${esc(S.server.error)}</p><ul class="issues">${(S.server.errors || []).map((x) => issueRow({ ...x, kind: 'error' })).join('')}</ul>` : '';
    return `<div class="vcols"><section><h3>¿Puede jugar?</h3><ul class="ready">${r.map((x) => `<li class="${x.ok ? 'ok' : x.required ? 'bad' : 'meh'}"><b>${x.ok ? '✔' : x.required ? '✘' : '·'} ${esc(x.text)}</b>${x.ok ? '' : `<span>${esc(x.need)}</span> ${readyButtons(x)}`}</li>`).join('')}</ul></section>
      <section>${server}<h3>Errores y avisos</h3>${fx.length ? `<div class="fixes"><b>Arreglar con un clic</b> <small class="dim">(solo cuando hay una única forma de arreglarlo)</small>${fx.map((f) => `<button type="button" class="mini fix" data-fix="${esc(f.key)}">${esc(f.label)}</button>`).join('')}</div>` : ''}
        ${all.length ? `<ul class="issues">${all.map(issueRow).join('')}</ul>` : '<p class="empty good">Sin errores ni avisos.</p>'}
        ${fresh.length ? `<h3>Pesos nuevos al guardar</h3><p>Estos bloques cambiaron de forma y empezarán con pesos nuevos: lo que habían aprendido se pierde. ${fresh.map((b) => `<button type="button" class="link" data-goto="${esc(b.id)}">${esc(b.id)}</button>`).join(', ')}.</p>` : ''}</section></div>`;
  }
  function renderPanel() {
    const p = $('edPanel');
    if (!S.genome) { patch(p, ''); return; }
    const nIss = S.check.errors.length + S.check.warnings.length + (S.forPlay.ok ? 0 : 1);
    const body = S.folded ? '' : { capa: capaTab, genes: genesTab, ve: veTab, versiones: versionesTab, avisos: avisosTab }[S.panelTab]();
    patch(p, `<div class="tabs" role="tablist" data-key="tabs">${PTABS.map(([k, t]) => `<button role="tab" type="button" data-ptab="${k}" aria-selected="${!S.folded && S.panelTab === k}" class="${k === 'avisos' && S.check.errors.length ? 'has-err' : ''}">${esc(k === 'avisos' && nIss ? `${t} (${nIss})` : t)}</button>`).join('')}<p class="legend2" data-key="legend" aria-label="Qué lleva cada cable"><span class="lg s-ctx" title="Una vez por soldado y turno">contexto</span><span class="lg s-cand" title="Una fila por cada tiro imaginado">candidatos</span><span class="lg s-move" title="Una fila por cada sitio adonde moverse">destinos</span>${S.bench.sig ? '<span class="lg nv" title="Un pulso corre por cada cable: más vivo cuanta más señal pasa en la escena del banco">señal real</span>' : ''}</p><button type="button" class="fold" data-act="fold" aria-expanded="${!S.folded}" title="${S.folded ? 'Abre el panel' : 'Pliega el panel para dar todo el sitio al lienzo'}">${S.folded ? '▴ Abrir' : '▾ Plegar'}</button></div>${S.folded ? '' : `<div class="panel-body" data-key="body-${S.panelTab}">${body}</div>`}`);
  }

  // ---------- banco de pruebas (a la derecha, abajo): la red decide aquí mismo ----------
  const benchScene = () => (S.bench.scene === 'mia' && S.bench.custom ? { key: 'mia', name: 'Tu escena', explain: 'Arrastra soldados y rocas; doble clic en el plano añade una roca; rueda sobre una roca, más grande o más pequeña.', scene: S.bench.custom } : Bn.BENCH_SCENES.find((x) => x.key === S.bench.scene) || Bn.BENCH_SCENES[0]);
  function scheduleBench(ms = 140) { clearTimeout(benchTimer); benchTimer = setTimeout(runBench, ms); }
  function runBench() {
    if (!S.genome) return;
    const sc = benchScene(), opt = { phase: S.bench.phase, seed: Number(S.bench.seed) || 0 };
    const key = `${sc.key}|${JSON.stringify(sc.scene)}|${opt.phase}|${opt.seed}`;
    S.bench.now = Bn.decide(S.genome, sc.scene, opt);
    if (S.bench.savedKey !== key) { S.bench.saved = S.saved && S.saved.blocks.length ? Bn.decide(S.saved, sc.scene, opt) : null; S.bench.savedKey = key; }
    S.bench.sig = S.bench.now.ok ? Bn.signal(S.genome, S.bench.now.decision, S.bench.now.obs) : null;
    S.bench.pick = S.bench.now.ok ? Bn.pick(S.bench.now.decision) : null;
    renderBench(); renderBoard();
    if (S.panelTab === 've' || (S.panelTab === 'capa' && S.sel)) renderPanel();
  }
  const X = (x) => (x + 25) * 10, Y = (y) => (15 - y) * 10;
  function benchSVG(sc, res) {
    const r1 = (v) => Math.round(v * 10) / 10;
    const d = res && res.ok ? res.decision : null;
    const obs = sc.scene.obstacles.map((o, i) => (o.kind === 'circle' ? `<circle data-key="o:${i}" cx="${X(o.x)}" cy="${Y(o.y)}" r="${o.r * 10}" class="b-obs" data-rock="${i}"/>` : `<rect data-key="o:${i}" x="${X(o.x)}" y="${Y(o.y + o.h)}" width="${o.w * 10}" height="${o.h * 10}" class="b-obs"/>`)).join('');
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(X(p[0]))},${r1(Y(p[1]))}`).join('');
    let lines = '';
    if (d && d.phase === 'shoot') {
      const cands = (d.candidates || []).filter((c) => Array.isArray(c.points) && c.points.length);
      const maxP = Math.max(1e-9, ...cands.map((c) => c.p || 0));
      lines = cands.filter((c) => c.i !== d.chosen).sort((a, b) => a.p - b.p).map((c) => `<path d="${line(c.points)}" class="b-c" style="opacity:${(0.08 + 0.45 * (c.p || 0) / maxP).toFixed(2)}"><title>#${c.i} ${esc(FAMILY_ES[c.family] || c.family)} · p ${f2(c.p)}</title></path>`).join('');
      const ch = cands.find((c) => c.i === d.chosen);
      if (ch) lines += `<path d="${line(ch.points)}" class="b-ch"/>`;
    } else if (d && d.phase === 'move' && Array.isArray(d.moves)) {
      lines = d.moves.map((m) => `<circle cx="${X(m.to.x)}" cy="${Y(m.to.y)}" r="${3 + 9 * Math.min(1, m.p * 2)}" class="b-mv${m.i === d.chosenMove ? ' on' : ''}${m.impossible ? ' no' : ''}"><title>${m.stay ? 'quedarse' : `ir a (${f2(m.to.x)}, ${f2(m.to.y)})`} · p ${f2(m.p)}${m.impossible ? ` · imposible (${esc(m.why)})` : ''}</title></circle>`).join('');
    }
    const sol = sc.scene.soldiers.map((x) => `<g data-key="s:${esc(x.id)}" class="b-s ${x.team}${x.id === sc.scene.soldierId ? ' me' : ''}" data-soldier="${esc(x.id)}"><circle cx="${X(x.x)}" cy="${Y(x.y)}" r="${x.id === sc.scene.soldierId ? 8 : 6}"/><text x="${X(x.x)}" y="${Y(x.y) - 11}">${esc(x.id === sc.scene.soldierId ? 'tu red' : x.id)}</text></g>`).join('');
    return `<svg viewBox="0 0 500 300" class="bench-svg${sc.key === 'mia' ? ' editable' : ''}" id="benchSvg" role="img" aria-label="Escena: ${esc(sc.name)}"><rect x="0" y="0" width="500" height="300" class="b-plane"/><line x1="250" y1="0" x2="250" y2="300" class="b-axis"/><line x1="0" y1="150" x2="500" y2="150" class="b-axis"/>${obs}${lines}${sol}</svg>`;
  }
  function renderBench() {
    const el = $('edBench');
    if (!S.genome) { patch(el, '<p class="empty">Aquí probarás tu red en escenas fijas: verás qué tiro escoge y por qué, al momento, mientras cambias cosas.</p>'); return; }
    const sc = benchScene(), B = S.bench;
    const now = B.now, sv = B.saved;
    const a = now && now.ok ? Bn.pick(now.decision) : null, b = sv && sv.ok ? Bn.pick(sv.decision) : null;
    const same = now && now.ok && sv && sv.ok ? Bn.sameChoice(sv.decision, now.decision) : null;
    const desc = (x) => (!x ? '—' : x.kind === 'move' ? `${x.stay ? 'quedarse quieta' : `moverse a (${f2(x.to.x)}, ${f2(x.to.y)})`} · probabilidad <b class="mono">${f2(x.p)}</b>` : `el tiro <span class="mono">#${x.i}</span>, ${esc(FAMILY_A[x.family] || `de la familia ${x.family}`)} <span class="mono">${esc(x.mode === 'ode2' ? `y'' = ${prettyExpr(x.expr)} · ${Math.round(x.angle ?? 0)}°` : x.mode === 'ode1' ? `y' = ${prettyExpr(x.expr)}` : `y = ${prettyExpr(x.expr)}`)}</span> · probabilidad <b class="mono">${f2(x.p)}</b>, certeza <b class="mono">${f2(x.certainty)}</b>`);
    const att = now && now.ok && now.decision.attribution ? now.decision.attribution.filter((r) => r.share >= 0.005).sort((x, y) => y.share - x.share) : [];
    const tools = sc.key === 'mia' ? `<div class="b-tools" role="group" aria-label="Editar tu escena"><button type="button" class="mini" data-bench="enemy">+ enemigo</button><button type="button" class="mini" data-bench="ally">+ aliada</button><button type="button" class="mini" data-bench="rock">+ roca</button>${B.picked ? `<button type="button" class="mini danger" data-bench="del">Quitar ${esc(B.picked.kind === 'rock' ? 'la roca' : B.picked.id)}</button>` : ''}</div>` : '';
    patch(el, `<header><h3>Banco de pruebas</h3><button type="button" class="primary mini" data-act="probe" title="Una partida de verdad (x10) contra otra red, aquí mismo">Probar ya</button></header>
      <div class="b-scenes" role="radiogroup" aria-label="Escena">${[...Bn.BENCH_SCENES, { key: 'mia', name: 'Tu escena' }].map((x) => `<button type="button" role="radio" aria-checked="${B.scene === x.key}" data-scene="${x.key}" title="${esc(x.explain || 'Tu propia escena: empieza como la que tengas elegida y la cambias arrastrando.')}">${esc(x.name)}</button>`).join('')}</div>
      ${benchSVG(sc, now)}${tools}
      <p class="b-explain">${esc(sc.explain)}</p>
      <div class="b-row"><span class="seg2" role="radiogroup" aria-label="Qué decide"><button type="button" role="radio" data-phase="shoot" aria-checked="${B.phase === 'shoot'}">Disparar</button><button type="button" role="radio" data-phase="move" aria-checked="${B.phase === 'move'}">Moverse</button></span>
        <label class="seed">Semilla <input class="numin mono" type="number" min="0" step="1" value="${esc(B.seed)}" data-bseed title="La misma semilla sortea igual: si la elección cambia, es por tus cambios"></label></div>
      <div class="b-out" aria-live="polite">${!now ? '<p class="dim">Calculando…</p>' : !now.ok ? `<p class="warn-text">${esc(now.error)}</p>` : `
        <p><b>${S.dirty && b ? 'Con tus cambios' : 'Tu red'}</b>: ${desc(a)}</p>
        ${S.dirty && b ? `<p class="dim"><b>La guardada</b>: ${desc(b)}</p><p class="${same ? 'dim' : 'good'}">${same ? 'Tus cambios no cambian lo que escoge aquí.' : '¡Tus cambios cambian lo que escoge aquí!'}</p>` : ''}
        ${att.length ? `<div class="attr"><span class="dim">Se fijó sobre todo en:</span>${att.slice(0, 4).map((r) => `<span class="ab"><i style="width:${Math.round(r.share * 100)}%"></i><b>${esc(r.name)}</b> ${pct(r.share)}</span>`).join('')}</div>` : ''}
        <p class="dim small">Sin entrenar, una red escoge casi al azar: la certeza lo dice (cerca de 0 = duda). Curvas tenues: los tiros que imagina; en blanco, el escogido.</p>`}</div>`);
  }
  // editar tu escena: arrastrar soldados y rocas, doble clic para una roca, rueda para su tamaño
  const benchPoint = (ev) => { const svg = $('benchSvg'); const r = svg.getBoundingClientRect(); return { x: ((ev.clientX - r.left) / r.width) * 50 - 25, y: 15 - ((ev.clientY - r.top) / r.height) * 30 }; };
  function useCustom() { if (!S.bench.custom) S.bench.custom = Bn.copyScene((Bn.BENCH_SCENES.find((x) => x.key === S.bench.scene) || Bn.BENCH_SCENES[0]).scene); }
  let bdrag = null;
  root.addEventListener('pointerdown', (ev) => {
    const svg = ev.target.closest && ev.target.closest('#benchSvg.editable');
    if (!svg || ev.button !== 0) return;
    const s = ev.target.closest('[data-soldier]'), rk = ev.target.closest('[data-rock]');
    if (!s && !rk) return;
    ev.preventDefault();
    bdrag = s ? { kind: 'soldier', id: s.dataset.soldier } : { kind: 'rock', i: Number(rk.dataset.rock) };
    S.bench.picked = s ? { kind: 'soldier', id: s.dataset.soldier } : { kind: 'rock', i: Number(rk.dataset.rock) };
    svg.setPointerCapture(ev.pointerId);
  });
  root.addEventListener('pointermove', (ev) => {
    if (!bdrag) return;
    const p = benchPoint(ev);
    S.bench.custom = bdrag.kind === 'soldier' ? Bn.moveSoldier(S.bench.custom, bdrag.id, p.x, p.y) : Bn.moveObstacle(S.bench.custom, bdrag.i, p.x, p.y);
    scheduleBench(30);
  });
  root.addEventListener('pointerup', () => { if (bdrag) { bdrag = null; renderBench(); } });
  root.addEventListener('dblclick', (ev) => {
    const svg = ev.target.closest && ev.target.closest('#benchSvg.editable');
    if (!svg || ev.target.closest('[data-soldier],[data-rock]')) return;
    const p = benchPoint(ev);
    S.bench.custom = Bn.addRock(S.bench.custom, p.x, p.y); scheduleBench(0);
  });
  root.addEventListener('wheel', (ev) => {
    const rk = ev.target.closest && ev.target.closest('#benchSvg.editable [data-rock]');
    if (!rk) return;
    ev.preventDefault();
    const i = Number(rk.dataset.rock);
    S.bench.custom = Bn.resizeRock(S.bench.custom, i, S.bench.custom.obstacles[i].r + (ev.deltaY < 0 ? 0.3 : -0.3)); scheduleBench(30);
  }, { passive: false });

  // ---------- probar ya: una partida de verdad (x10) contra otra red, aquí mismo ----------
  function renderProbe() {
    const el = $('edProbe'), P = S.probe;
    if (!P) { el.hidden = true; return; }
    el.hidden = false;
    const rivals = S.nets.filter((n) => n.id !== S.netId);
    const nameOf = (id) => (S.nets.find((n) => n.id === id) || {}).name || id;
    const busy = P.busy || new Map();
    const free = rivals.filter((n) => !busy.has(n.id));
    if (!P.duelId) {
      patch(el, `<div class="pr-box"><header><h3>Probar ya</h3><button type="button" data-act="probe-close" aria-label="Cerrar">✕</button></header>
        ${S.dirty ? '<p class="warn-text">Se prueba la red <b>guardada</b>: tus cambios sin guardar no juegan. Guarda antes si quieres probarlos.</p>' : ''}
        ${!S.forPlay.ok ? '<p class="warn-text">Tu red aún no puede jugar: mira en Avisos qué le falta.</p>' : ''}
        ${busy.has(S.netId) ? `<p class="warn-text">Tu red está ${esc(busy.get(S.netId))}: cuando acabe podrás probarla.</p>` : ''}
        ${rivals.length && !free.length ? '<p class="warn-text">Todas las demás redes están ocupadas (en un duelo o entrenando). Espera a que acaben o crea otra desde una plantilla.</p>' : ''}
        ${rivals.length ? `<label class="field">Contra <select data-prival>${rivals.map((n) => `<option value="${esc(n.id)}"${n.id === P.rival ? ' selected' : ''}${busy.has(n.id) ? ' disabled' : ''}>${esc(n.name)}${n.isQueen ? ' (reina)' : ''}${busy.has(n.id) ? ` — ${esc(busy.get(n.id))}` : ''}</option>`).join('')}</select></label>
          <p class="dim">6 partidas (3 mapas × 2 lados) a x10, sin aprender (congeladas): así ves cómo juega hoy, sin cambiarla.</p>
          <div class="row">${S.dirty && P.rival && !busy.has(S.netId) ? '<button type="button" class="primary" data-act="probe-save-go">Guardar y probar</button>' : ''}<button type="button" class="${S.dirty ? '' : 'primary'}" data-act="probe-go" ${(S.forPlay.ok || !S.dirty) && P.rival && !busy.has(S.netId) ? '' : 'disabled'}>Empezar${S.dirty ? ' con la guardada' : ''}</button></div>` : '<p class="empty">Hace falta otra red en este mundo. Crea otra desde una plantilla.</p>'}</div>`);
      return;
    }
    const d = P.duel;
    const res = d && d.status !== 'running' ? `<p><b>${esc(nameOf(d.a))} ${d.wins[d.a] ?? 0} – ${d.wins[d.b] ?? 0} ${esc(nameOf(d.b))}</b> · ${d.tie ? 'empate' : d.winner === S.netId ? '¡gana tu red!' : 'gana la rival'}</p>` : '';
    if (!el.querySelector('#prCanvas')) {
      el.innerHTML = `<div class="pr-live"><header><h3>Probar ya: <span id="prWho"></span></h3><span class="dim" id="prScore"></span><button type="button" data-act="probe-close" aria-label="Cerrar">✕</button></header>
        <canvas id="prCanvas" aria-label="Plano de la partida"></canvas><div class="fnbar" id="prFn"><span class="dim">Aquí sale la función de cada tiro.</span></div><div id="prEnd"></div></div>`;
    }
    patch(el.querySelector('#prWho'), `${esc(nameOf(d ? d.a : S.netId))} contra ${esc(nameOf(d ? d.b : P.rival))}`);
    patch(el.querySelector('#prScore'), d ? `${d.games.length}/6 partidas · ${d.wins[d.a] ?? 0} – ${d.wins[d.b] ?? 0}` : 'empezando…');
    patch(el.querySelector('#prEnd'), res ? `<div class="pr-end">${res}<p class="dim">Para ver cada decisión con calma, abre la moviola de su ficha:</p><button type="button" data-ficha="${esc(S.netId)}" data-ficha-tab="historia">Moviola de ${esc(nameOf(S.netId))}</button> <button type="button" data-act="probe-again">Otra vez</button></div>` : '');
  }
  // la sala en directo: la misma escucha que el duelo (game/sala.js); al abrirla aquí, el duelo deja de pintar la suya
  const probeFn = (shot, landed) => {
    const el = $('edProbe').querySelector('#prFn');
    if (!el) return;
    const p = R.state && R.state.players.find((q) => q.id === shot.playerId), c = TEAM_COLOR[shot.shooterTeam] || '#fff';
    patch(el, `<b class="fn-who" style="color:${c};border-color:${c}">${esc(p ? p.name : '?')}</b><span class="fn-expr mono" style="color:${c}">${esc(fnText(shot))}</span><span class="fn-res">${landed ? '' : '<span class="dim">trazando…</span>'}</span>`);
  };
  const PW = roomWatch(() => $('edProbe').querySelector('#prCanvas'), { shot: (x) => probeFn(x, false), landed: (x) => probeFn(x, true) });
  let probePoll = null;
  const probeWatch = (code) => PW.watch(code);
  // quién está ocupada ahora (en un duelo o entrenando): el servidor no la deja jugar otro duelo (409)
  async function probeBusy() {
    const [d, n] = await Promise.all([api('/api/lab/duels'), api('/api/lab/nets')]);
    const busy = new Map();
    if (d.ok) for (const x of d.body.duels) if (x.status === 'running') for (const id of [x.a, x.b]) busy.set(id, 'en un duelo');
    if (n.ok) { S.nets = n.body.nets; for (const x of n.body.nets) if (x.training) busy.set(x.id, 'entrenando'); }
    return busy;
  }
  async function probeOpen(rival0 = null) {
    if (S.coach && S.coach.on && !S.coach.probed) { S.coach.probed = true; coachSave(); renderCoach(); }
    const busy = await probeBusy();
    const rivals = S.nets.filter((n) => n.id !== S.netId && !busy.has(n.id));
    const q = rivals.find((n) => n.id === rival0) || rivals.find((n) => n.isQueen) || rivals.find((n) => n.id === 'vidente-1') || rivals[0];
    S.probe = { rival: q ? q.id : null, duelId: null, busy };
    renderProbe();
  }
  async function probeStart() {
    const P = S.probe;
    const r = await api('/api/lab/duels', 'POST', { a: S.netId, b: P.rival, speed: 'x10', learning: 'frozen', soldiers: 'random' });
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    P.duelId = r.body.id; P.room = null;
    renderProbe();
    clearInterval(probePoll);
    probePoll = setInterval(async () => {
      if (!S.probe || S.probe.duelId !== P.duelId) { clearInterval(probePoll); return; }
      const d = await api(`/api/lab/duels/${encodeURIComponent(P.duelId)}`);
      if (!d.ok) return;
      P.duel = d.body;
      if (d.body.liveRoom && d.body.liveRoom !== P.room) { P.room = d.body.liveRoom; probeWatch(P.room); }
      if (d.body.status !== 'running') { clearInterval(probePoll); loadNets().then(() => renderTools()); }
      renderProbe();
    }, 700);
  }
  function probeClose() {
    clearInterval(probePoll);
    PW.stop();
    if (S.probe && S.probe.duelId && S.probe.duel && S.probe.duel.status === 'running') api(`/api/lab/duels/${encodeURIComponent(S.probe.duelId)}/stop`, 'POST', {});
    S.probe = null; $('edProbe').innerHTML = ''; renderProbe();
  }

  // ---------- diálogo propio (sin confirm del navegador) ----------
  function showModal() {
    const m = $('edModal');
    let html = '';
    if (S.pending) html = `<p>Tienes cambios sin guardar en «${esc(S.genome.name)}».</p><div class="row"><button type="button" class="primary" data-modal="save-open">Guardar y abrir la otra</button><button type="button" data-modal="drop-open">Descartar cambios</button><button type="button" data-modal="cancel">Seguir aquí</button></div>`;
    else if (S.confirm && S.confirm.kind === 'import') html = `<p>${esc(S.confirm.text)}</p><div class="row"><button type="button" class="primary" data-modal="import-rename">Importar con otro id</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    else if (S.confirm && S.confirm.kind === 'delete') html = `<p>¿Borrar «${esc(S.genome.name)}»? Se borra su genoma; sus partidas guardadas y lo que dejó en el registro se conservan.</p><div class="row"><button type="button" class="danger" data-modal="delete">Borrar la red</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    else if (S.confirm && S.confirm.kind === 'force') html = `<p>${esc(S.confirm.text)}</p><div class="row"><button type="button" class="danger" data-modal="delete-force">Borrarla igualmente</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    else if (S.confirm && S.confirm.kind === 'restore') html = `<p>¿Volver a la versión ${S.confirm.n}? La red recupera sus bloques, cables, pesos y genes de entonces; lo vivido (partidas, estadísticas, linaje) se queda. La de ahora se guarda antes como otra versión: se puede deshacer.${S.dirty ? ' <b>Tus cambios sin guardar se pierden.</b>' : ''}</p><div class="row"><button type="button" class="primary" data-modal="restore">Volver a la versión ${S.confirm.n}</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    const first = m.querySelector('button');
    if (first) first.focus();
  }
  function closeModal() { $('edModal').hidden = true; S.pending = null; S.confirm = null; }
  async function restoreVersion(n) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/versions/${n}/restore`, 'POST', {});
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    await open(S.netId, { force: true });
    S.panelTab = 'versiones'; S.versions.list = null; renderPanel();
    toast(`Vuelta a la versión ${n}. La de antes quedó guardada como versión ${r.body.savedAs}.`);
  }

  // ---------- eventos ----------
  const blockOf = (id) => S.genome.blocks.find((b) => b.id === id);
  function select(sel) { S.sel = sel; S.panelTab = 'capa'; renderBoard(); if (sel && S.folded) fold(false); else renderPanel(); }
  function focusNode(id) { const n = $('edBoard').querySelector(`[data-node="${CSS.escape(id)}"]`); if (n) { n.focus(); n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }
  function addBlock(type) {
    const a = Hn.advice(S.genome, catalog, type);
    if (!a.can) { toast(a.why, 'error'); return; }
    const r = M.addBlock(S.genome, type, catalog);
    commit(r.genome, { select: { kind: 'block', id: r.id } });
    focusNode(r.id);
    popIn($('edBoard').querySelector(`[data-node="${CSS.escape(r.id)}"]`));
    toast(`${(M.entryOf(catalog, type) || {}).name} (${r.id}) añadido. ${a.why}`);
  }

  const palItem = (el) => el && el.closest && el.closest('.pal [data-add]');
  root.addEventListener('mouseover', (ev) => { const t = palItem(ev.target); if (t && S.palHover !== t.dataset.add) { S.palHover = t.dataset.add; renderPalTip(); } });
  root.addEventListener('mouseout', (ev) => { if (palItem(ev.target) && !palItem(ev.relatedTarget) && document.activeElement !== palItem(ev.target)) { S.palHover = null; renderPalTip(); } });
  root.addEventListener('focusin', (ev) => { const t = palItem(ev.target); if (t && S.palHover !== t.dataset.add) { S.palHover = t.dataset.add; renderPalTip(); } });
  root.addEventListener('focusout', (ev) => { if (palItem(ev.target) && !palItem(ev.relatedTarget)) { S.palHover = null; renderPalTip(); } });
  $('edRail').addEventListener('scroll', () => { if (S.palHover) renderPalTip(); }, { passive: true });

  // pasar el ratón por un cable lo ilumina y saca sus botones (✕ Desenchufar, ＋ Añadir capa); se van 0,3 s después de
  // salir del cable y de los botones, así da tiempo a llegar a ellos
  let wireOff = null;
  function hoverWire(i) {
    clearTimeout(wireOff);
    if (S.hoverWire === i) return;
    const bd = $('edBoard'), mark = (k, on) => { if (k !== null) bd.querySelector(`svg.wires path.wire[data-key="w:${k}"]`)?.classList.toggle('hov', on); };
    mark(S.hoverWire, false); mark(i, true);
    S.hoverWire = i;
    renderWireTools();
  }
  const WIRE_ZONE = 'path.hit[data-wire], #edWireTools';
  root.addEventListener('pointerover', (ev) => {
    if (S.link || drag || !ev.target.closest) return;
    const hit = ev.target.closest('path.hit[data-wire]');
    // 0,25 s quieto sobre el cable: cruzar un cable de paso no hace saltar sus botones
    if (hit) { const i = Number(hit.dataset.wire); clearTimeout(wireOff); if (S.hoverWire !== i) wireOff = setTimeout(() => hoverWire(i), 250); }
    else if (ev.target.closest('#edWireTools')) clearTimeout(wireOff);
  });
  root.addEventListener('pointerout', (ev) => {
    if (!ev.target.closest || !ev.target.closest(WIRE_ZONE)) return;
    const to = ev.relatedTarget;
    if (to && to.closest && to.closest(WIRE_ZONE)) return;
    clearTimeout(wireOff); wireOff = setTimeout(() => hoverWire(null), 300);
  });
  $('edBoard').addEventListener('scroll', () => { if (!$('edWireTools').hidden) renderWireTools(); }, { passive: true });

  // la cabecera vive en la de la etapa (fuera de root): sus eventos llegan por el mismo camino (ver slot())
  const mine = (el) => !!el && (root.contains(el) || (S.slotEl && S.slotEl.contains(el)));
  document.addEventListener('click', (ev) => { if (S.menu && !(ev.target.closest && ev.target.closest('.edh-more'))) { S.menu = false; renderHead(); } }, true);
  const onClick = async (ev) => {
    const t = ev.target.closest('button, a, [data-wire]');
    if (!t || !mine(t)) return;
    if (t.dataset.ficha) { S.menu = false; renderHead(); return; } // lo abre la ficha (main.js escucha data-ficha en todo el documento)
    if (t.dataset.level) { S.level = t.dataset.level; store.set(LS.level, S.level); if (S.world) api(`/api/worlds/${S.world.n}/meta`, 'PUT', { level: LEVEL_WORLD[S.level] }).catch(() => {}); render(); return; }
    if (t.dataset.zoom) { if (t.dataset.zoom === 'fit') S.fit = true; else { S.fit = false; S.zoom = Math.max(0.4, Math.min(1.5, Math.round((S.zoom + 0.1 * Number(t.dataset.zoom)) * 10) / 10)); } renderTools(); renderBoard(); return; }
    if (t.dataset.ptab) { S.panelTab = t.dataset.ptab; S.menu = false; renderHead(); if (S.folded) fold(false); else renderPanel(); return; }
    if (t.dataset.genes) { S.genesTab = t.dataset.genes; renderPanel(); return; }
    if (t.dataset.open) { S.menu = false; open(t.dataset.open); return; }
    if (t.dataset.tpl) { S.tplOpen = S.tplOpen === t.dataset.tpl ? null : t.dataset.tpl; renderRail(); const f = root.querySelector('.tpl-form input'); if (f) f.select(); return; }
    if (t.dataset.add) { if (!S.genome) return; addBlock(t.dataset.add); return; }
    if (t.dataset.coach) {
      const c = t.dataset.coach;
      if (c === 'open') { if (!S.genome) return; if (!S.coach) coachStart(); else { S.coach.on = !S.coach.on; coachSave(); render(); } return; }
      if (c === 'close') { if (S.coach) { S.coach.on = false; coachSave(); render(); } return; }
      if (c === 'restart') { coachStart(); return; }
      if (c === 'hint') { S.coach.hint = true; renderBoard(); return; }
      if (c === 'help') { coachHelp(); return; }
      if (c.startsWith('bet:')) { S.coach.bet = c.slice(4); coachSave(); renderBoard(); return; }
      return;
    }
    if (t.dataset.insert) {
      const r = M.insertOnWire(S.genome, Number(t.dataset.index), t.dataset.insert, catalog);
      if (r.error) { toast(r.error, 'error'); return; }
      commit(r.genome, { select: { kind: 'block', id: r.id }, label: `${(M.entryOf(catalog, t.dataset.insert) || {}).name} (${r.id}) en medio de un cable` });
      focusNode(r.id); popIn($('edBoard').querySelector(`[data-node="${CSS.escape(r.id)}"]`));
      toast(`${(M.entryOf(catalog, t.dataset.insert) || {}).name} (${r.id}) va ahora en medio del cable.`);
      return;
    }
    if (t.dataset.unwire !== undefined) { unwire(Number(t.dataset.unwire)); return; }
    if (t.dataset.wireplus) { const wi = Number(t.dataset.wireplus); if (!(S.sel && S.sel.kind === 'wire' && S.sel.index === wi)) { S.sel = { kind: 'wire', index: wi }; renderBoard(); } S.panelTab = 'capa'; if (S.folded) fold(false); else renderPanel(); setTimeout(() => { const el = $('edInsert'); if (el) { el.scrollIntoView({ block: 'nearest' }); el.querySelector('button')?.focus(); } }, 60); return; }
    if (t.dataset.wireup) { const [a, b] = t.dataset.wireup.split('|'); const r = M.connect(S.genome, a, b); if (r.error) { toast(r.error, 'error'); return; } commit(r.genome); return; }
    if (t.dataset.fix) { const f = Hn.fixes(S.genome, catalog, S.check).find((x) => x.key === t.dataset.fix); if (f) { commit(f.apply(S.genome), { label: f.label }); toast(`Arreglado: ${f.label}.`); } return; }
    if (t.dataset.node) {
      if (suppressClick) { suppressClick = false; return; }
      select({ kind: 'block', id: t.dataset.node });
      return;
    }
    if (t.dataset.wire !== undefined) { select({ kind: 'wire', index: Number(t.dataset.wire) }); return; }
    if (t.dataset.goto) { select({ kind: 'block', id: t.dataset.goto }); focusNode(t.dataset.goto); return; }
    if (t.dataset.gowire !== undefined) { select({ kind: 'wire', index: Number(t.dataset.gowire) }); return; }
    if (t.dataset.jump) { S.hist = Hi.jump(S.hist, Number(t.dataset.jump)); S.genome = S.hist.present; afterChange(); return; }
    if (t.dataset.vdiff) { openVersion(Number(t.dataset.vdiff)); return; }
    if (t.dataset.vback) { S.confirm = { kind: 'restore', n: Number(t.dataset.vback) }; showModal(); return; }
    if (t.dataset.scene) {
      if (t.dataset.scene === 'mia') useCustom();
      S.bench.scene = t.dataset.scene; S.bench.picked = null; scheduleBench(0); renderBench(); return;
    }
    if (t.dataset.phase) { S.bench.phase = t.dataset.phase; scheduleBench(0); return; }
    if (t.dataset.bench) {
      const b = S.bench;
      if (t.dataset.bench === 'enemy') b.custom = Bn.addSoldier(b.custom, 'right');
      else if (t.dataset.bench === 'ally') b.custom = Bn.addSoldier(b.custom, 'left');
      else if (t.dataset.bench === 'rock') b.custom = Bn.addRock(b.custom, 0, 0);
      else if (t.dataset.bench === 'del' && b.picked) { b.custom = b.picked.kind === 'rock' ? Bn.removeRock(b.custom, b.picked.i) : Bn.removeSoldier(b.custom, b.picked.id); b.picked = null; }
      scheduleBench(0); return;
    }
    if (t.dataset.modal) {
      const kind = t.dataset.modal, pending = S.pending, conf = S.confirm;
      closeModal();
      if (kind === 'save-open') { await save(); if (!S.dirty) open(pending, { force: true }); }
      else if (kind === 'drop-open') open(pending, { force: true });
      else if (kind === 'import-rename') importFile(conf.file, true);
      else if (kind === 'delete') removeNet(false);
      else if (kind === 'delete-force') removeNet(true);
      else if (kind === 'restore') restoreVersion(conf.n);
      return;
    }
    switch (t.dataset.act) {
      case 'save': save(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'menu': S.menu = !S.menu; renderHead(); break;
      case 'fold': fold(!S.folded); break;
      case 'delete': S.menu = false; renderHead(); S.confirm = { kind: 'delete' }; showModal(); break;
      case 'tidy': S.pos = {}; store.del(LS.pos(S.netId)); renderBoard(); break;
      case 'remove': { const id = t.dataset.id; commit(M.removeBlock(S.genome, id), { select: null }); break; }
      case 'unwire': unwire(Number(t.dataset.index)); break;
      case 'probe': probeOpen(); break;
      case 'probe-close': probeClose(); break;
      case 'probe-go': probeStart(); break;
      case 'probe-save-go': await save(); if (!S.dirty) probeStart(); break;
      case 'probe-again': { const rival = S.probe.rival; probeClose(); probeOpen(rival); break; }
      default: break;
    }
  };
  root.addEventListener('click', onClick);

  root.addEventListener('submit', (ev) => {
    const f = ev.target.closest('form[data-create]');
    if (!f) return;
    ev.preventDefault();
    createFromTemplate(f.dataset.create, f.elements.name.value.trim());
  });

  // cambios de los controles: 'input' repinta solo el lienzo y la cabecera (el deslizador no se corta); 'change', todo
  const onControl = (ev, partial) => {
    const el = ev.target;
    if (!S.genome || !mine(el)) return;
    if (el.id === 'edName') { commit({ ...S.genome, name: el.value }, { partial: true, key: 'name', label: `Nombre: ${el.value}` }); return; }
    if (el.dataset.bparam) {
      const blk = blockOf(el.dataset.block), e = blk && M.entryOf(catalog, blk.type);
      const param = e && e.params.find((p) => p.key === el.dataset.bparam);
      if (!param) return;
      let raw = el.type === 'checkbox' && param.type === 'bool' ? el.checked : el.value;
      if (param.type === 'set') raw = [...root.querySelectorAll(`[data-bparam="${CSS.escape(param.key)}"][data-block="${CSS.escape(blk.id)}"]`)].filter((x) => x.checked).map((x) => x.dataset.opt);
      const before = (blk.params || {})[param.key];
      const next = M.setParam(S.genome, blk.id, param, raw);
      const after = next.blocks.find((b) => b.id === blk.id).params[param.key];
      commit(next, { partial, key: `${blk.id}.${param.key}`, label: `${param.name} de ${blk.id}: ${num(before)} → ${num(after)}` });
      syncTwins(el);
      return;
    }
    if (el.dataset.gpath) {
      const path = el.dataset.gpath;
      const param = paramForPath(path);
      const cur = M.getPath(S.genome, path);
      const raw = el.type === 'checkbox' ? el.checked : el.value;
      const v = param ? M.coerce(param, raw, cur) : raw;
      commit(M.setPath(S.genome, path, v), { partial, key: path, label: `${param && param.name ? param.name : path}: ${num(cur)} → ${num(v)}` });
      syncTwins(el);
      return;
    }
    if (el.dataset.glist && !partial) {
      const nums = el.value.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
      if (!nums.length || nums.some((n) => !Number.isFinite(n))) { toast('Escribe números separados por comas, p. ej. 0, 0.03, -0.03.', 'error'); renderPanel(); return; }
      commit(M.setPath(S.genome, el.dataset.glist, nums));
    }
  };
  // el deslizador y la casilla numérica del mismo ajuste van juntos
  function syncTwins(el) {
    const key = el.dataset.bparam ? `[data-bparam="${CSS.escape(el.dataset.bparam)}"][data-block="${CSS.escape(el.dataset.block)}"]` : el.dataset.gpath ? `[data-gpath="${CSS.escape(el.dataset.gpath)}"]` : null;
    if (!key || el.type === 'checkbox') return;
    const v = el.dataset.bparam ? blockOf(el.dataset.block).params[el.dataset.bparam] : M.getPath(S.genome, el.dataset.gpath);
    for (const x of root.querySelectorAll(key)) if (x !== el && x.type !== 'checkbox') x.value = v;
  }
  function paramForPath(path) {
    const [top, ...rest] = path.split('.');
    const key = rest.join('.');
    if (top === 'traits') return catalog.traits.find((p) => p.key === key);
    if (top === 'reward') return catalog.rewardTerms.find((p) => p.key === key);
    if (top === 'learning') return catalog.learning.find((p) => p.key === key);
    if (top === 'imagination') {
      if (rest[0] === 'families') return rest[2] === 'weight' ? FAMILY_WEIGHT : rest[2] === 'on' ? { type: 'bool' } : null;
      return IMAGINATION(catalog.limits).find((p) => p.key === key);
    }
    return null;
  }
  const onInput = (ev) => { if (ev.target.type === 'range' || ev.target.id === 'edName') onControl(ev, true); };
  root.addEventListener('input', onInput);
  const onChange = (ev) => {
    const el = ev.target;
    if (el.dataset.bseed !== undefined) { S.bench.seed = Math.max(0, Math.round(Number(el.value) || 0)); scheduleBench(0); return; }
    if (el.dataset.prival !== undefined) { S.probe.rival = el.value; return; }
    if (el.dataset.import !== undefined && el.files && el.files[0]) { S.menu = false; importFile(el.files[0]); el.value = ''; return; }
    if (el.dataset.connect) {
      const r = M.connect(S.genome, el.value, el.dataset.connect);
      if (r.error) { toast(r.error, 'error'); renderPanel(); return; }
      commit(r.genome);
      return;
    }
    if (el.dataset.swap) {
      // cambiar el tipo de un bloque (p. ej. Eco → GRU): conserva su id y sus cables; sus ajustes vuelven a los de fábrica
      const blk = blockOf(el.dataset.swap), e = M.entryOf(catalog, el.value);
      if (!blk || !e) return;
      const params = Object.fromEntries((e.params || []).map((p) => [p.key, clone(p.default)]));
      commit({ ...S.genome, blocks: S.genome.blocks.map((b) => (b.id === blk.id ? { ...b, type: e.type, params } : b)) }, { label: `${blk.id}: ${(M.entryOf(catalog, blk.type) || {}).name} → ${e.name}` });
      return;
    }
    if (el.id === 'edName') { renderRail(); return; }
    onControl(ev, false);
  };
  root.addEventListener('change', onChange);

  // teclado: Ctrl+Z / Ctrl+Y deshacer y rehacer; en el lienzo, Supr quita, flechas mueven (Mayús: más lejos), Esc suelta
  const onKey = (ev) => {
    if (!$('edModal').hidden && ev.key === 'Escape') { closeModal(); return; }
    const typing = /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName);
    if ((ev.ctrlKey || ev.metaKey) && !typing && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !typing && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && S.genome) { ev.preventDefault(); save(); return; }
    if (ev.key === 'Escape' && S.menu) { S.menu = false; renderHead(); return; }
    if (ev.key === 'Escape' && S.sel) { select(null); return; }
    if (S.sel && S.sel.kind === 'wire' && (ev.key === 'Delete' || ev.key === 'Backspace') && !typing) { ev.preventDefault(); unwire(S.sel.index); return; }
    const node = ev.target.closest && ev.target.closest('[data-node]');
    if (!node || !S.genome) return;
    const id = node.dataset.node;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); commit(M.removeBlock(S.genome, id), { select: null }); return; }
    const step = ev.shiftKey ? 32 : 8;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (d) {
      ev.preventDefault();
      const cur = layout().nodes[id];
      S.pos = { ...S.pos, [id]: { x: Math.max(0, cur.x + d[0]), y: Math.max(56, cur.y + d[1]) } };
      store.set(LS.pos(S.netId), S.pos);
      renderBoard(); focusNode(id);
    }
  };
  root.addEventListener('keydown', onKey);
  // sesión 10: tras un clic en el fondo del lienzo, o un cambio que rehace el panel (el Tipo), el foco queda en <body> y
  // Ctrl+Z/Y/S no llegaban al editor
  document.addEventListener('keydown', (ev) => { if (ev.target === document.body && root.isConnected && !root.closest('[hidden]') && root.offsetParent !== null) onKey(ev); });

  // arrastrar: desde el punto de salida hace un cable (y marca dónde vale y dónde no, con el porqué); desde el bloque,
  // lo mueve; la raya entre el lienzo y el panel cambia su altura
  const boardPoint = (ev) => { const inner = $('edBoard').querySelector('.board-inner').getBoundingClientRect(); return { x: (ev.clientX - inner.left) / S.zoom, y: (ev.clientY - inner.top) / S.zoom }; };
  let split = null;
  root.addEventListener('pointerdown', (ev) => {
    if (ev.target.id === 'edSplit') { if (S.folded) { S.folded = false; store.set('gw.ed.folded', false); renderPanel(); } split = { y: ev.clientY, h: parseFloat(getComputedStyle(root).getPropertyValue('--ed-bottom')) || 262 }; ev.target.setPointerCapture(ev.pointerId); return; }
    if (!S.genome || ev.button !== 0) return;
    const port = ev.target.closest('[data-port], [data-portin]');
    const node = ev.target.closest('[data-node]');
    if (port) {
      ev.preventDefault(); ev.stopPropagation();
      const where = port.dataset.port ? { port: 'out', id: port.dataset.port } : { port: 'in', id: port.dataset.portin };
      // Alt + clic (como en Unreal): quita todos los cables de ese punto
      if (ev.altKey) {
        const r = P.unplugAll(S.genome, catalog, where.id, where.port);
        if (!r.removed.length) { toast('Ese punto no tiene cables.'); return; }
        commit(r.genome, { select: null, label: r.text });
        toast(r.text, 'info', { label: 'Deshacer', run: undo });
        return;
      }
      const held = P.grab(S.genome, catalog, where);
      if (!held) return;
      const tg = P.targets(S.genome, catalog, held);
      // la tarjeta de la que sale el cable (o a la que llega, si lo sacas al revés desde una entrada vacía)
      const own = held.kind === 'to' ? held.to : held.from;
      S.link = { held, tg, from: own, hot: null, res: null, ok: new Set([...tg].filter(([, t]) => t.ok).map(([id]) => id)), why: new Map([...tg].filter(([, t]) => !t.ok).map(([id, t]) => [id, t.why])) };
      S.hoverWire = null;
      renderBoard();
      linkMove(ev);
      $('edBoard').setPointerCapture(ev.pointerId);
      return;
    }
    if (node) {
      const p = layout().nodes[node.dataset.node];
      drag = { id: node.dataset.node, sx: ev.clientX, sy: ev.clientY, ox: p.x, oy: p.y, moved: false, el: node, wire: null, tg: null };
      node.setPointerCapture(ev.pointerId);
    }
  });
  // la tarjeta donde caería lo que llevas: la que está bajo el ratón o, si no, la más cercana que valga a menos de 40 px
  // (imán: no hace falta acertar a la tarjeta)
  function linkHot(ev) {
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const t = under && under.closest && under.closest('[data-node]');
    if (t && $('edBoard').contains(t)) return t.dataset.node;
    let best = null, bd = 40;
    for (const n of $('edBoard').querySelectorAll('[data-node]')) {
      if (!S.link.ok.has(n.dataset.node) && !(S.link.tg.get(n.dataset.node) || {}).back) continue;
      const r = n.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom));
      if (d < bd) { bd = d; best = n.dataset.node; }
    }
    return best;
  }
  // el cartel que sigue al ratón mientras arrastras: qué pasará si sueltas ahí
  function dropTip(ev, text, kind = '') {
    const el = $('edDropTip');
    if (!text) { el.hidden = true; return; }
    el.textContent = text; el.className = `drop-tip${kind ? ` ${kind}` : ''}`; el.hidden = false;
    const R = root.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(ev.clientX - R.left + 16, R.width - el.offsetWidth - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(ev.clientY - R.top + 18, R.height - el.offsetHeight - 6))}px`;
  }
  const portAt = (id, side) => { const L = layout(), a = L.nodes[id]; return a && { x: side === 'out' ? a.x + CARD.w : a.x, y: a.y + CARD.h / 2 }; };
  const bez = (a, b) => `M${a.x},${a.y} C${a.x + 60},${a.y} ${b.x - 60},${b.y} ${b.x},${b.y}`;
  function linkMove(ev) {
    const { held } = S.link, p = boardPoint(ev);
    const hot = linkHot(ev);
    if (hot !== S.link.hot || !S.link.res) {
      const bd = $('edBoard');
      if (S.link.hot) bd.querySelector(`[data-node="${CSS.escape(S.link.hot)}"]`)?.classList.remove('link-hot');
      if (hot) bd.querySelector(`[data-node="${CSS.escape(hot)}"]`)?.classList.add('link-hot');
      S.link.hot = hot;
      S.link.res = P.drop(S.genome, catalog, held, { node: hot }, S.link.tg);
    }
    const tmp = $('edBoard').querySelector('#edTmpWire');
    // con el imán, la punta ya se pega al punto de la tarjeta; si no, sigue al ratón
    if (tmp) {
      const d = held.kind === 'to'
        ? bez(hot && hot !== held.to ? portAt(hot, 'out') : p, portAt(held.to, 'in'))
        : bez(portAt(held.from, 'out'), hot && hot !== held.from ? portAt(hot, 'in') : p);
      tmp.setAttribute('d', d);
      tmp.classList.toggle('no', !!S.link.res.why);
    }
    const r = S.link.res;
    const idle = held.kind === 'end' ? 'Suéltalo en el vacío para desenchufar, o en otra tarjeta verde para cambiarlo de sitio.' : 'Llévalo hasta una tarjeta verde y suelta. Las grises no valen: pasa por encima y te digo por qué.';
    dropTip(ev, r.will || idle, r.why ? 'no' : r.action === 'remove' ? 'rm' : r.action !== 'nada' ? 'ok' : '');
  }
  root.addEventListener('pointermove', (ev) => {
    if (split) { const h = Math.max(180, Math.min(620, split.h - (ev.clientY - split.y))); root.style.setProperty('--ed-bottom', `${h}px`); return; }
    if (S.link) {
      // cerca del borde de arriba o de abajo, el lienzo se desplaza solo: así llegas a los bloques que no se ven
      const bd = $('edBoard'), br = bd.getBoundingClientRect();
      if (ev.clientY > br.bottom - 28) bd.scrollTop += 14; else if (ev.clientY < br.top + 28) bd.scrollTop -= 14;
      linkMove(ev);
      return;
    }
    if (!drag) return;
    const dx = (ev.clientX - drag.sx) / S.zoom, dy = (ev.clientY - drag.sy) / S.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    // sin la transición de la posición mientras se arrastra: la tarjeta va pegada al ratón (con ella se quedaba atrás)
    if (!drag.moved) drag.el.classList.add('dragging');
    drag.moved = true;
    const x = Math.max(0, drag.ox + dx), y = Math.max(56, drag.oy + dy);
    S.pos = { ...S.pos, [drag.id]: { x, y } };
    drag.el.style.left = `${x}px`; drag.el.style.top = `${y}px`;
    // una tarjeta sin cables encima de un cable se meterá en medio al soltarla (como en Blender): el cable se ilumina y se
    // abre un hueco con los dos tramos que quedarían
    if (!drag.tg) { drag.tg = P.targets(S.genome, catalog, { kind: 'card', id: drag.id }); S.hoverWire = null; renderWireTools(); }
    let wi = null;
    if (drag.tg.size) {
      const r = drag.el.getBoundingClientRect();
      const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((e) => e.matches && e.matches('path.hit[data-wire]'));
      wi = hit ? Number(hit.dataset.wire) : null;
    }
    drag.wire = wi;
    redrawWires();
    if (wi !== null) {
      const w = S.genome.wires[wi], res = P.drop(S.genome, catalog, { kind: 'card', id: drag.id }, { wire: wi }, drag.tg);
      if (res.action === 'insert') $('edBoard').querySelector('#edTmpWire')?.setAttribute('d', `${bez(portAt(w.from, 'out'), { x, y: y + CARD.h / 2 })} ${bez({ x: x + CARD.w, y: y + CARD.h / 2 }, portAt(w.to, 'in'))}`);
      dropTip(ev, res.will, res.action === 'insert' ? 'ok' : 'no');
    } else dropTip(ev, '');
  });
  root.addEventListener('pointerup', (ev) => {
    if (split) { split = null; store.set(LS.bottom, parseFloat(root.style.getPropertyValue('--ed-bottom'))); S.fit && renderBoard(); return; }
    if (S.link) {
      const L = S.link;
      S.link = null;
      dropTip(ev, '');
      // lo mismo que enseñaba el cartel: la tarjeta bajo el ratón o la del imán
      const r = P.drop(S.genome, catalog, L.held, { node: L.hot }, L.tg);
      if (r.action === 'nada') { if (r.why) toast(r.why, 'error'); renderBoard(); return; }
      const sel = r.action === 'remove' ? null : { kind: 'block', id: L.held.kind === 'to' ? L.held.to : L.hot };
      commit(r.genome, { select: sel, label: r.label });
      toast(r.text, 'info', r.action === 'remove' || r.action === 'move' ? { label: 'Deshacer', run: undo } : null);
      return;
    }
    if (drag) {
      const d = drag;
      drag = null;
      dropTip(ev, '');
      if (!d.moved) return;
      store.set(LS.pos(S.netId), S.pos); suppressClick = true;
      const r = d.wire !== null ? P.drop(S.genome, catalog, { kind: 'card', id: d.id }, { wire: d.wire }, d.tg) : null;
      if (r && r.action === 'insert') {
        commit(r.genome, { select: { kind: 'block', id: d.id }, label: r.label });
        toast(r.text, 'info', { label: 'Deshacer', run: undo });
        popIn($('edBoard').querySelector(`[data-node="${CSS.escape(d.id)}"]`));
      } else { if (r && r.why) toast(r.why, 'error'); renderBoard(); }
      focusNode(d.id);
    }
  });
  window.addEventListener('beforeunload', (ev) => { if (S.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  window.addEventListener('resize', () => { if (S.fit && S.genome && !root.closest('[hidden]')) renderBoard(); });

  return {
    async start(netId) {
      const t = await api('/api/lab/templates');
      S.templates = t.ok ? t.body : [];
      // el nivel de vista es el del mundo abierto (GET/PUT /api/worlds/:n/meta; A/B/C = Aprendiz/Artesano/Científico)
      const w = await api('/api/worlds');
      if (w.ok && w.body.active) {
        const m = await api(`/api/worlds/${w.body.active}/meta`);
        if (m.ok) { S.world = { n: w.body.active, meta: m.body }; const lv = Object.keys(LEVEL_WORLD).find((k) => LEVEL_WORLD[k] === m.body.level); if (lv) { S.level = lv; store.set(LS.level, lv); } }
      }
      await loadNets();
      if (netId && S.nets.some((n) => n.id === netId)) await open(netId, { force: true });
      else render();
    },
    open,
    // la etapa le presta su cabecera (a la derecha del título, como en el mockup) para el nombre y los botones
    slot(el) {
      if (S.slotEl !== el && el) { el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onChange); el.addEventListener('keydown', onKey); }
      S.slotEl = el; renderHead();
    },
    stop() { if (S.probe) probeClose(); },
    get state() { return S; },
  };
}
