// Editor de redes (parte 4, spec/prompt-opus-ui.md §3.1; spec/08 §1, §4 y §7). Bloques por cables sobre el plano,
// tres niveles de vista, errores de validate en español con su ejemplo junto al bloque culpable, importar y exportar.
// La validación y el reparto de pesos usan el MISMO código que el servidor (/shared/genome.js, spec/08 §9.3).
import * as M from './model.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { validate, repair, countParams, outDims, newGenome } from '/shared/genome.js';
import { makeRng } from '/shared/rng.js';
import * as W from './whatif.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v));
const FAMILY_ES = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: "EDO (y')", artillery: 'artillería', wild: 'salvaje' };
const STREAM = { ctx: 'contexto', cand: 'candidatos', move: 'destinos', mix: 'candidatos y destinos juntos' };
const LS = { level: 'gw.lab.level', pos: (id) => `gw.lab.pos.${id}` };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: solo se pierde la posición */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* igual */ } },
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

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
const BLANK = { key: 'blank', name: '✳️ Desde cero', paramCount: 0,
  why: 'Sin ningún bloque: tú decides qué ve, cómo piensa y qué hace. Para poder jugar necesita, como mínimo, Candidatos (los tiros que imagina) unidos a Elegir (el que escoge uno).' };
const FAMILY_WEIGHT = { key: 'weight', name: 'Peso', type: 'number', min: 0, max: 100, step: 1, explain: 'Parte de los tiros imaginados que salen de esta familia (proporcional al peso).' };

export function mountEditor(root, { catalog, toast }) {
  const S = {
    level: M.LEVELS.includes(store.get(LS.level, 'aprendiz')) ? store.get(LS.level, 'aprendiz') : 'aprendiz',
    nets: [], templates: [], railTab: 'nets', panelTab: 'block',
    netId: null, saved: null, genome: null, check: null, forPlay: null, dims: null, streams: {}, issues: null, params: null,
    server: null, sel: null, pos: {}, zoom: 1, fit: true, wi: { scene: 'abierto', seed: 1, res: null, busy: false, note: null }, dirty: false, pending: null, tplOpen: null, confirm: null,
  };
  let drag = null, link = null, suppressClick = false;

  root.innerHTML = `
    <header class="ed-head" id="edHead"></header>
    <aside class="ed-rail" id="edRail"></aside>
    <div class="ed-board" id="edBoard" aria-label="Lienzo de la red"></div>
    <section class="ed-panel" id="edPanel" aria-label="Ajustes"></section>
    <div class="ed-modal" id="edModal" hidden></div>`;
  const $ = (id) => root.querySelector('#' + id);

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
  // pesos: los guardados se conservan si su forma sigue valiendo; si no, repair pone pesos nuevos (semilla = emblema)
  function commit(next, opts = {}) {
    const w = { ...(next.weights || {}) };
    if (S.saved) for (const b of next.blocks) {
      const old = S.saved.blocks.find((x) => x.id === b.id && x.type === b.type);
      if (old && S.saved.weights && S.saved.weights[b.id]) w[b.id] = S.saved.weights[b.id];
    }
    S.genome = repair({ ...next, weights: w }, makeRng((Number(next.emblem) >>> 0) % 2 ** 31)).genome;
    S.dirty = true;
    S.server = null;
    recheck();
    if (opts.select !== undefined) S.sel = opts.select;
    if (opts.partial) { renderHead(); renderBoard(); } else render();
    if (S.panelTab === 'whatif') scheduleWhatif();
  }
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
    S.netId = netId; S.saved = clone(r.body.genome); S.genome = clone(r.body.genome); S.dirty = false; S.server = null; S.sel = null;
    S.pos = store.get(LS.pos(netId), {}) || {};
    S.wi.res = null;
    S.fit = true; // al abrir, encaja el ancho de la red en el lienzo
    S.railTab = 'blocks';
    recheck();
    if (location.hash !== `#editor/${netId}`) history.replaceState(null, '', `#editor/${netId}`);
    render();
  }
  async function save() {
    if (!S.genome) return;
    if (!S.check.ok) { S.panelTab = 'issues'; render(); toast('Hay errores: arréglalos antes de guardar (están en Avisos y junto a cada bloque).', 'error'); return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}`, 'PUT', S.genome);
    if (r.ok) {
      S.saved = clone(S.genome); S.dirty = false; S.server = { warnings: r.body.warnings || [] };
      if (S.panelTab === 'whatif') scheduleWhatif();
      await loadNets(); render(); toast('Red guardada.');
    } else {
      S.server = { status: r.status, error: reasonOf(r), errors: (r.body && r.body.errors) || [] };
      S.panelTab = 'issues'; render(); toast(reasonOf(r), 'error');
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
    toast(`Red en blanco creada: ${genome.name}. Empieza por los Ojos (qué ve).`);
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
    await open(r.body.id); // con cambios sin guardar, pregunta antes de cambiar de red
    toast(`Red importada como «${r.body.id}».`);
  }
  async function removeNet(force = false) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}${force ? '?force=1' : ''}`, 'DELETE');
    if (r.status === 409 && !force && /force=1/.test(reasonOf(r))) { S.confirm = { kind: 'force', text: reasonOf(r).replace(/,? ?bórrala con \?force=1\.?/, '.') }; showModal(); return; }
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    store.del(LS.pos(S.netId));
    const gone = S.genome.name;
    S.netId = null; S.saved = null; S.genome = null; S.dirty = false; S.sel = null; S.railTab = 'nets';
    history.replaceState(null, '', '#editor');
    await loadNets(); render(); toast(`Red borrada: ${gone}.`);
  }

  // ---------- pintar ----------
  function render() { renderHead(); renderRail(); renderBoard(); renderPanel(); }

  function statusOf() {
    if (!S.genome) return null;
    const errs = S.check.errors.length;
    if (errs) return { cls: 'bad', text: `${errs} ${errs === 1 ? 'error' : 'errores'}: no se puede guardar` };
    if (!S.forPlay.ok) return { cls: 'warn', text: 'Se puede guardar, pero no puede jugar: le falta Elegir' };
    return { cls: 'good', text: 'Lista para jugar' };
  }
  function renderHead() {
    const h = $('edHead');
    const lv = M.LEVELS.map((l) => `<button type="button" data-level="${l}" aria-pressed="${S.level === l}">${M.LEVEL_NAMES[l]}</button>`).join('');
    if (!S.genome) {
      h.innerHTML = `<div class="ed-title"><h1>Editor de redes</h1><p class="dim">Elige una red o crea una desde una plantilla.</p></div><div class="ed-levels" role="group" aria-label="Nivel de vista">${lv}</div>`;
      return;
    }
    const g = S.genome, st = statusOf(), gen = g.lineage && Number.isInteger(g.lineage.generation) ? g.lineage.generation : 0;
    const net = S.nets.find((n) => n.id === S.netId);
    h.innerHTML = `
      <div class="ed-emblem" title="Emblema: sale de la semilla ${esc(g.emblem)}">${emblemSVG(g.emblem, 44)}</div>
      <div class="ed-title">
        <label class="sr" for="edName">Nombre de la red</label>
        <input id="edName" class="ed-name" value="${esc(g.name)}" maxlength="32" spellcheck="false">
        <p class="ed-facts"><span class="mono">${esc(g.id)}</span><span>generación ${gen}</span><span>${g.blocks.length} bloques</span><span>${S.params === null ? 'pesos: —' : `${S.params.toLocaleString('es-ES')} pesos`}</span>${net && net.stats && Number.isFinite(net.stats.games) ? `<span>${net.stats.games} partidas</span>` : ''}${net && net.isQueen ? '<span class="tag queen">reina</span>' : ''}${net && net.house ? `<span class="tag">campeona de la casa ${esc(net.house)}</span>` : ''}${net && net.training ? '<span class="tag busy">entrenando</span>' : ''}</p>
      </div>
      <div class="ed-levels" role="group" aria-label="Nivel de vista">${lv}</div>
      <p class="ed-status ${st.cls}" role="status">${esc(st.text)}${S.dirty ? '<span class="dirty">cambios sin guardar</span>' : ''}</p>
      <div class="ed-actions">
        <button type="button" class="primary" data-act="save" ${S.check.ok ? '' : 'aria-disabled="true"'}>Guardar</button>
        <a class="btn" href="/api/lab/nets/${encodeURIComponent(S.netId)}/export" download="${esc(S.netId)}.json" ${S.dirty ? 'title="Exporta lo guardado: guarda antes para exportar tus cambios"' : ''}>Exportar</a>
        <button type="button" data-act="delete">Borrar…</button>
      </div>`;
  }

  function renderRail() {
    const r = $('edRail');
    const tabs = `<div class="tabs" role="tablist">
      <button role="tab" type="button" data-rail="nets" aria-selected="${S.railTab === 'nets'}">Redes</button>
      <button role="tab" type="button" data-rail="blocks" aria-selected="${S.railTab === 'blocks'}" ${S.genome ? '' : 'disabled'}>Bloques</button></div>`;
    if (S.railTab === 'blocks' && S.genome) {
      const groups = M.palette(catalog, S.level).map((g) => `
        <h3 class="grp g-${g.key}">${esc(g.name)}<small>${esc(g.ask)}</small></h3>
        <ul class="pal">${g.blocks.map((b) => `<li><button type="button" class="pal-item g-${g.key}" data-add="${esc(b.type)}" title="${esc(b.explain)}"><span class="ico" aria-hidden="true">${esc(b.icon)}</span>${esc(b.name)}</button></li>`).join('')}</ul>`).join('');
      const hidden = catalog.blocks.length - M.palette(catalog, S.level).reduce((s, g) => s + g.blocks.length, 0);
      r.innerHTML = `${tabs}<p class="hint">Pulsa un bloque para añadirlo; después únelo con cables arrastrando desde su punto de salida.</p>${groups}${hidden ? `<p class="hint">${hidden} bloques más en ${S.level === 'aprendiz' ? 'Artesano y Científico' : 'Científico'}.</p>` : ''}`;
      return;
    }
    const nets = S.nets.length ? `<ul class="nets">${S.nets.map((n) => `
      <li><button type="button" class="net-item ${n.id === S.netId ? 'on' : ''}" data-open="${esc(n.id)}">
        <span class="net-em" aria-hidden="true">${emblemSVG(n.emblem, 30)}</span>
        <span class="net-nm">${esc(n.name)}</span>
        <span class="net-sub">gen ${esc(n.generation ?? 0)}${n.stats && Number.isFinite(n.stats.games) ? ` · ${n.stats.games} partidas` : ''}${n.isQueen ? ' · reina' : ''}${n.training ? ' · entrenando' : ''}</span>
      </button></li>`).join('')}</ul>` : '<p class="empty">Aún no tienes redes. Crea la primera desde una plantilla.</p>';
    const tpls = [BLANK, ...S.templates].map((t) => `
      <li class="tpl ${S.tplOpen === t.key ? 'open' : ''}">
        <button type="button" class="tpl-head" data-tpl="${esc(t.key)}" aria-expanded="${S.tplOpen === t.key}"><span>${esc(t.name)}</span><small>${t.paramCount ? `${t.paramCount.toLocaleString('es-ES')} pesos` : 'sin bloques'}</small></button>
        <p>${esc(t.why)}</p>
        ${S.tplOpen === t.key ? `<form class="tpl-form" data-create="${esc(t.key)}"><label>Nombre <input name="name" value="${esc(t.key === 'blank' ? 'Mi red' : t.name.replace(/^\S+\s/, ''))}" maxlength="32" required></label><button class="primary" type="submit">Crear red</button></form>` : ''}
      </li>`).join('');
    r.innerHTML = `${tabs}
      <h3>Tus redes <small>${S.nets.length}</small></h3>${nets}
      <h3>Crear desde una plantilla</h3><ul class="tpls">${tpls}</ul>
      <label class="btn file">Importar un genoma (.json)<input type="file" accept=".json,application/json" data-import hidden></label>`;
  }

  // ---------- lienzo ----------
  function renderBoard() {
    const b = $('edBoard');
    if (!S.genome) {
      b.innerHTML = '<div class="board-empty"><p>Abre una red de la lista o crea una desde una plantilla.</p><p class="dim">Aquí verás sus bloques unidos por cables, de los ojos a las manos.</p></div>';
      return;
    }
    const keep = { left: b.scrollLeft, top: b.scrollTop };
    const L = M.layout(S.genome, catalog, S.pos);
    // encajar: el ancho de la red cabe en el lienzo (entre 55 % y 100 %); con +/− manda la persona
    if (S.fit) S.zoom = Math.max(0.55, Math.min(1, (b.clientWidth - 16) / (L.width + 24)));
    const z = S.zoom;
    const ask = { 0: 'lo que ve' };
    const heads = L.cols.map((c, i) => `<div class="colhead" style="left:${c.x}px">${esc(c.label)}${i === 0 ? `<small>${ask[0]}</small>` : i === L.cols.length - 1 ? '<small>lo que hace</small>' : ''}</div>`).join('');
    const nodes = S.genome.blocks.map((blk) => nodeHTML(blk, L.nodes[blk.id])).join('');
    const flags = S.genome.blocks.map((blk) => flagHTML(blk, L.nodes[blk.id])).join('');
    b.innerHTML = `
      <div class="board-inner" style="width:${L.width + 240}px;height:${L.height + 120}px;zoom:${z}">
        ${heads}
        <svg class="wires" width="${L.width + 240}" height="${L.height + 120}" aria-hidden="true">${wiresSVG(L)}<path id="edTmpWire" class="wire tmp" d=""/></svg>
        ${nodes}${flags}
      </div>
      <p class="legend"><span class="lg s-ctx">contexto</span> una vez por soldado <span class="lg s-cand">candidatos</span> una vez por tiro imaginado <span class="lg s-move">destinos</span> una vez por sitio adonde moverse<span class="zoom" role="group" aria-label="Zoom"><button type="button" data-zoom="-1" aria-label="Alejar">−</button><span class="mono">${Math.round(z * 100)} %</span><button type="button" data-zoom="1" aria-label="Acercar">+</button><button type="button" data-zoom="fit" aria-pressed="${S.fit}">Encajar</button></span><button type="button" data-act="tidy" title="Vuelve a colocar los bloques por columnas">Ordenar</button></p>`;
    b.scrollLeft = keep.left; b.scrollTop = keep.top;
  }
  function nodeHTML(blk, p) {
    const e = M.entryOf(catalog, blk.type) || { name: blk.type, icon: '?', group: 'instinct', params: [] };
    const iss = (S.issues.byBlock[blk.id] || []);
    const err = iss.some((x) => x.kind === 'error'), warn = !err && iss.length;
    const main = (e.params || []).find((q) => q.type === 'int' || q.type === 'enum');
    const val = main && blk.params && blk.params[main.key] !== undefined ? ` ${num(blk.params[main.key])}` : '';
    const d = S.dims && S.dims[blk.id];
    const meta = d ? `${STREAM[d.stream]} ${d.dim}` : STREAM[S.streams[blk.id]] || '';
    const sel = S.sel && S.sel.kind === 'block' && S.sel.id === blk.id;
    const frozen = Array.isArray(S.genome.frozen) && S.genome.frozen.includes(blk.id);
    return `<button type="button" class="node g-${e.group}${sel ? ' sel' : ''}${err ? ' err' : ''}${warn ? ' warn' : ''}" data-node="${esc(blk.id)}" style="left:${p.x}px;top:${p.y}px" aria-label="${esc(e.name)} ${esc(blk.id)}${err ? ', con error' : warn ? ', con aviso' : ''}">
      ${e.group === 'eyes' ? '' : '<span class="port in" aria-hidden="true"></span>'}
      <span class="ico" aria-hidden="true">${esc(e.icon)}</span>
      <span class="nm">${esc(e.name)}${esc(val)}</span>
      <span class="meta"><span class="mono">${esc(blk.id)}</span> ${esc(meta)}${frozen ? ' · congelado' : ''}</span>
      ${e.group === 'hands' || e.group === 'feet' ? '' : `<span class="port out" data-port="${esc(blk.id)}" title="Arrastra hasta otro bloque para unirlos"></span>`}
    </button>`;
  }
  function flagHTML(blk, p) {
    const errs = (S.issues.byBlock[blk.id] || []).filter((x) => x.kind === 'error');
    if (!errs.length) return '';
    const x = errs[0];
    return `<div class="flag" style="left:${p.x}px;top:${p.y + M.NODE.h + 6}px" role="note">${esc(x.message)}${x.example ? `<span class="eg">${esc(x.example)}</span>` : ''}${errs.length > 1 ? `<span class="more">y ${errs.length - 1} más en Avisos</span>` : ''}</div>`;
  }
  function wirePath(a, b) {
    const x1 = a.x + M.NODE.w, y1 = a.y + M.NODE.h / 2, x2 = b.x, y2 = b.y + M.NODE.h / 2;
    const dx = Math.max(48, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  function wiresSVG(L) {
    const groupOf = (id) => { const blk = S.genome.blocks.find((x) => x.id === id); const e = blk && M.entryOf(catalog, blk.type); return e ? e.group : 'instinct'; };
    return (S.genome.wires || []).map((w, i) => {
      const a = L.nodes[w.from], b = L.nodes[w.to];
      if (!a || !b) return '';
      const d = wirePath(a, b);
      const bad = (S.issues.byWire[i] || []).length;
      const sel = S.sel && S.sel.kind === 'wire' && S.sel.index === i;
      return `<path class="wire g-${groupOf(w.from)} s-${S.streams[w.from] || 'ctx'}${sel ? ' sel' : ''}${bad ? ' bad' : ''}" d="${d}"/><path class="hit" data-wire="${i}" d="${d}"><title>${esc(w.from)} → ${esc(w.to)}</title></path>`;
    }).join('');
  }
  function redrawWires() {
    const svg = $('edBoard').querySelector('svg.wires');
    if (!svg) return;
    const L = M.layout(S.genome, catalog, S.pos);
    svg.innerHTML = `${wiresSVG(L)}<path id="edTmpWire" class="wire tmp" d=""/>`;
  }

  // ---------- panel de ajustes ----------
  function control(param, value, attrs) {
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
    return `<div class="ctl"><label for="${id}">${esc(param.name)}</label><div class="ctl-in">${input}</div>
      <p class="explain">${esc(param.explain || '')}${opt && opt.explain ? ` <b>${esc(opt.name)}</b>: ${esc(opt.explain)}.` : ''}${param.personality ? ` <i>${esc(param.personality)}</i>` : ''}${param.example ? `<span class="eg">${esc(param.example)}</span>` : ''}</p></div>`;
  }
  function hiddenNote(all, shown) {
    const n = all.length - shown.length;
    return n > 0 ? `<p class="hint">${n} ${n === 1 ? 'ajuste más' : 'ajustes más'} en ${S.level === 'aprendiz' ? 'Artesano o Científico' : 'Científico'}: nada se bloquea, cambia el nivel de vista para verlos.</p>` : '';
  }
  function issueList(items) {
    return `<ul class="issues">${items.map((x) => `<li class="${x.kind}"><b>${x.kind === 'error' ? 'Error' : 'Aviso'}</b> ${esc(x.message)}${x.example ? `<span class="eg">${esc(x.example)}</span>` : ''}${x.blockId && S.genome.blocks.some((b) => b.id === x.blockId) ? ` <button type="button" class="link" data-goto="${esc(x.blockId)}">ir al bloque ${esc(x.blockId)}</button>` : ''}${Number.isInteger(x.wire) && S.genome.wires[x.wire] ? ` <button type="button" class="link" data-gowire="${x.wire}">ver el cable</button>` : ''}</li>`).join('')}</ul>`;
  }
  function blockTab() {
    if (S.sel && S.sel.kind === 'wire') {
      const w = S.genome.wires[S.sel.index];
      if (!w) return '<p class="empty">Ese cable ya no existe.</p>';
      const d = S.dims && S.dims[w.from];
      return `<div class="ph"><h2>Cable ${esc(w.from)} → ${esc(w.to)}</h2><button type="button" data-act="unwire" data-index="${S.sel.index}">Quitar cable</button></div>
        <p>Lleva ${esc(d ? `${STREAM[d.stream]} (${d.dim} números)` : STREAM[S.streams[w.from]] || '—')} de <button type="button" class="link" data-goto="${esc(w.from)}">${esc(w.from)}</button> a <button type="button" class="link" data-goto="${esc(w.to)}">${esc(w.to)}</button>. Si un bloque recibe varios cables, los junta en el orden en que se conectaron.</p>
        ${issueList(S.issues.byWire[S.sel.index] || [])}`;
    }
    const blk = S.sel && S.sel.kind === 'block' && S.genome.blocks.find((b) => b.id === S.sel.id);
    if (!blk) return '<p class="empty">Elige un bloque del lienzo para ver qué hace y ajustarlo, o añade uno desde la lista de la izquierda.</p>';
    const e = M.entryOf(catalog, blk.type);
    const shown = M.paramsAt(e, S.level);
    const ins = S.genome.wires.map((w, i) => ({ ...w, i })).filter((w) => w.to === blk.id);
    const outs = S.genome.wires.map((w, i) => ({ ...w, i })).filter((w) => w.from === blk.id);
    const d = S.dims && S.dims[blk.id];
    const sources = S.genome.blocks.filter((b) => b.id !== blk.id && !ins.some((w) => w.from === b.id) && !['hands', 'feet'].includes((M.entryOf(catalog, b.type) || {}).group));
    const isEyeBlk = e.group === 'eyes';
    return `<div class="ph"><h2><span aria-hidden="true">${esc(e.icon)}</span> ${esc(e.name)} <span class="mono dim">${esc(blk.id)}</span></h2><button type="button" data-act="remove" data-id="${esc(blk.id)}">Quitar bloque</button></div>
      <div class="cols2">
        <div>
          <p class="explain big">${esc(e.explain)}${e.example ? `<span class="eg">${esc(e.example)}</span>` : ''}</p>
          <p class="flow">${isEyeBlk ? 'Mira el tablero' : `Recibe ${ins.length ? ins.map((w) => `<button type="button" class="link" data-goto="${esc(w.from)}">${esc(w.from)}</button>`).join(', ') : 'nada todavía'}`} y da ${esc(d ? `${STREAM[d.stream]} (${d.dim} números)` : STREAM[S.streams[blk.id]] || '—')}${outs.length ? ` a ${outs.map((w) => `<button type="button" class="link" data-goto="${esc(w.to)}">${esc(w.to)}</button>`).join(', ')}` : ''}.</p>
          ${issueList(S.issues.byBlock[blk.id] || [])}
        </div>
        <div>
          ${shown.map((p) => control(p, (blk.params || {})[p.key], `data-bparam="${esc(p.key)}" data-block="${esc(blk.id)}"`)).join('') || '<p class="hint">Este bloque no tiene ajustes.</p>'}
          ${hiddenNote(e.params || [], shown)}
          ${isEyeBlk ? '' : `<div class="wiring"><h3>Entradas</h3>${ins.length ? `<ul>${ins.map((w) => `<li><span class="mono">${esc(w.from)}</span> <button type="button" class="link" data-act="unwire" data-index="${w.i}">quitar</button></li>`).join('')}</ul>` : ''}
            ${sources.length ? `<label>Conectar desde <select data-connect="${esc(blk.id)}"><option value="">elige un bloque…</option>${sources.map((b) => `<option value="${esc(b.id)}">${esc(b.id)} (${esc((M.entryOf(catalog, b.type) || {}).name || b.type)})</option>`).join('')}</select></label>` : ''}</div>`}
        </div>
      </div>`;
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
      const idle = !active;
      return `<fieldset class="${idle ? 'idle' : ''}"><legend>${esc(title)}${idle ? ' <small>no se usa con el método elegido</small>' : ''}</legend>${shown.map((p) => control(p, M.getPath(S.genome, `learning.${p.key}`), `data-gpath="learning.${esc(p.key)}"`)).join('')}</fieldset>`;
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
  function issuesTab() {
    const all = [...S.check.errors.map((x) => ({ ...x, kind: 'error' })), ...S.check.warnings.map((x) => ({ ...x, kind: 'warning' }))];
    if (!S.forPlay.ok && S.check.ok) all.push(...S.forPlay.errors.map((x) => ({ ...x, kind: 'warning' })).filter((x) => !all.some((y) => y.code === x.code)));
    const fresh = freshBlocks();
    const server = S.server && S.server.error ? `<h3>El servidor no la guardó</h3><p class="bad">${esc(S.server.error)}</p>${issueList((S.server.errors || []).map((x) => ({ ...x, kind: 'error' })))}` : '';
    return `${server}${all.length ? issueList(all) : '<p class="empty good">Sin errores ni avisos.</p>'}
      ${fresh.length ? `<h3>Pesos nuevos al guardar</h3><p>Estos bloques cambiaron de forma y empezarán con pesos nuevos: lo que habían aprendido se pierde. ${fresh.map((b) => `<button type="button" class="link" data-goto="${esc(b.id)}">${esc(b.id)}</button>`).join(', ')}.</p>` : ''}`;
  }
  // ---------- ¿qué pasaría si…? (plan2 ronda 4; spec/08 §9.1): la guardada frente a la que editas, en una escena fija ----------
  let wiTimer = null;
  function scheduleWhatif() { clearTimeout(wiTimer); wiTimer = setTimeout(runWhatif, 350); }
  async function runWhatif() {
    if (!S.genome || !S.netId) return;
    const sc = W.SCENES.find((x) => x.key === S.wi.scene) || W.SCENES[0];
    const seed = Number.isInteger(Number(S.wi.seed)) && Number(S.wi.seed) >= 0 ? Number(S.wi.seed) : 1;
    S.wi.busy = true;
    const url = `/api/lab/nets/${encodeURIComponent(S.netId)}/whatif`;
    const before = await api(url, 'POST', W.whatifBody(sc, 'shoot', seed));
    let after = before, note = null;
    if (S.dirty) {
      if (S.forPlay && S.forPlay.ok) after = await api(url, 'POST', W.whatifBody(sc, 'shoot', seed, S.genome));
      else { after = null; note = `Con tus cambios la red aún no puede jugar: ${(S.forPlay && S.forPlay.errors[0] && S.forPlay.errors[0].message) || 'revisa los avisos'}`; }
    }
    S.wi.busy = false;
    S.wi.res = { sc, before: before.ok ? before.body.decision : null, after: after && after.ok ? after.body.decision : null, error: !before.ok ? reasonOf(before) : after && !after.ok ? reasonOf(after) : null };
    S.wi.note = note;
    if (S.panelTab === 'whatif') renderPanel();
  }
  function sceneSVG(sc, d) {
    const X = (x) => (x + 25) * 10, Y = (y) => (15 - y) * 10;
    const r1 = (v) => Math.round(v * 10) / 10;
    const obs = sc.scene.obstacles.map((o) => `<rect x="${X(o.x)}" y="${Y(o.y + o.h)}" width="${o.w * 10}" height="${o.h * 10}" class="wi-obs"/>`).join('');
    const sol = sc.scene.soldiers.map((x) => `<circle cx="${X(x.x)}" cy="${Y(x.y)}" r="${x.id === sc.scene.soldierId ? 7 : 5}" class="wi-s ${x.team}"/>`).join('');
    const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${r1(X(p[0]))},${r1(Y(p[1]))}`).join('');
    const cands = d && Array.isArray(d.candidates) ? d.candidates.filter((c) => Array.isArray(c.points) && c.points.length) : [];
    const maxP = Math.max(1e-9, ...cands.map((c) => c.p || 0));
    const faint = cands.filter((c) => c.i !== d.chosen).sort((a, b) => a.p - b.p).map((c) => `<path d="${line(c.points)}" class="wi-c" style="opacity:${(0.08 + 0.45 * (c.p || 0) / maxP).toFixed(2)}"/>`).join('');
    const ch = cands.find((c) => c.i === d.chosen);
    return `<svg viewBox="0 0 500 300" class="wi-svg" role="img" aria-label="Escena: ${esc(sc.name)}"><rect x="0" y="0" width="500" height="300" class="wi-plane"/><line x1="250" y1="0" x2="250" y2="300" class="wi-axis"/><line x1="0" y1="150" x2="500" y2="150" class="wi-axis"/>${obs}${faint}${ch ? `<path d="${line(ch.points)}" class="wi-ch"/>` : ''}${sol}</svg>`;
  }
  function whatifTab() {
    if (!S.wi.res && !S.wi.busy) scheduleWhatif();
    const r = S.wi.res;
    const cmp = r ? W.compare(r.before, r.after) : null;
    const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
    const side = (label, x) => (x ? `<p><b>${label}</b>: elegiría la <span class="mono">#${x.i}</span> (${esc(FAMILY_ES[x.family] || x.family)}, <span class="mono">${esc(x.expr)}</span>) con probabilidad <span class="mono">${f2(x.p)}</span> y certeza <span class="mono">${f2(x.certainty)}</span></p>` : `<p><b>${label}</b>: —</p>`);
    const verdict = cmp && S.dirty && cmp.after ? `<p class="${cmp.same ? 'dim' : 'good'}">${cmp.same ? 'Con tus cambios elige el mismo tiro.' : 'Con tus cambios elige otro tiro.'}</p>` : '';
    return `<div class="wi"><div>
        <p class="hint">Una escena congelada: cambia un ajuste o un cable y mira si cambia el tiro que elegiría. No guarda nada ni juega partidas.</p>
        <div class="seg" role="radiogroup" aria-label="Escena">${W.SCENES.map((x) => `<label><input type="radio" name="wiScene" value="${x.key}" data-wi="scene" ${S.wi.scene === x.key ? 'checked' : ''}><b>${esc(x.name)}</b><small>${esc(x.explain)}</small></label>`).join('')}</div>
        <div class="ctl"><label for="wiSeed">Semilla</label><div class="ctl-in"><input id="wiSeed" class="numin mono" type="number" min="0" step="1" value="${esc(S.wi.seed)}" data-wi="seed"></div><p class="explain">La misma semilla sortea igual: si la elección cambia, es por tus cambios.</p></div>
        ${r && r.error ? `<p class="bad">${esc(r.error)}</p>` : ''}${S.wi.note ? `<p class="warn-text">${esc(S.wi.note)}</p>` : ''}
        ${cmp ? `${side('Guardada', cmp.before)}${S.dirty ? `${side('Con tus cambios', cmp.after)}${verdict}` : '<p class="dim">No hay cambios sin guardar: es la misma red.</p>'}` : '<p class="dim">Calculando…</p>'}
      </div><div>${r ? sceneSVG(r.sc, r.after || r.before) : ''}<p class="hint">Curvas tenues: los tiros que imagina ${S.dirty ? 'la red con tus cambios' : 'la red'}; en blanco, el elegido.</p></div></div>`;
  }

  function renderPanel() {
    const p = $('edPanel');
    if (!S.genome) { p.innerHTML = ''; return; }
    const nIss = S.check.errors.length + S.check.warnings.length;
    const tabs = [['block', 'Bloque'], ['traits', 'Carácter'], ['reward', 'Recompensa'], ['learning', 'Aprendizaje'], ['imagination', 'Imaginación'], ['whatif', '¿Qué pasaría si…?'], ['issues', `Avisos${nIss ? ` (${nIss})` : ''}`]];
    const body = {
      block: blockTab,
      traits: () => genomeControls(catalog.traits, 'traits'),
      reward: () => `<p class="hint">Qué premia y qué castiga al aprender. Cada término cambia su carácter; por ejemplo, premiar sobrevivir la vuelve cauta.</p>${genomeControls(catalog.rewardTerms, 'reward')}`,
      learning: learningTab,
      imagination: imaginationTab,
      issues: issuesTab,
      whatif: whatifTab,
    }[S.panelTab]();
    p.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" type="button" data-ptab="${k}" aria-selected="${S.panelTab === k}" class="${k === 'issues' && S.check.errors.length ? 'has-err' : ''}">${esc(t)}</button>`).join('')}</div><div class="panel-body">${body}</div>`;
  }

  // ---------- diálogo propio (sin confirm del navegador) ----------
  function showModal() {
    const m = $('edModal');
    let html = '';
    if (S.pending) html = `<p>Tienes cambios sin guardar en «${esc(S.genome.name)}».</p><div class="row"><button type="button" class="primary" data-modal="save-open">Guardar y abrir la otra</button><button type="button" data-modal="drop-open">Descartar cambios</button><button type="button" data-modal="cancel">Seguir aquí</button></div>`;
    else if (S.confirm && S.confirm.kind === 'import') html = `<p>${esc(S.confirm.text)}</p><div class="row"><button type="button" class="primary" data-modal="import-rename">Importar con otro id</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    else if (S.confirm && S.confirm.kind === 'delete') html = `<p>¿Borrar «${esc(S.genome.name)}»? Se borra su genoma; sus partidas guardadas y lo que dejó en el registro se conservan.</p><div class="row"><button type="button" class="danger" data-modal="delete">Borrar la red</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    else if (S.confirm && S.confirm.kind === 'force') html = `<p>${esc(S.confirm.text)}</p><div class="row"><button type="button" class="danger" data-modal="delete-force">Borrarla igualmente</button><button type="button" data-modal="cancel">Cancelar</button></div>`;
    m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    const first = m.querySelector('button');
    if (first) first.focus();
  }
  function closeModal() { $('edModal').hidden = true; S.pending = null; S.confirm = null; }

  // ---------- eventos ----------
  const blockOf = (id) => S.genome.blocks.find((b) => b.id === id);
  function select(sel) { S.sel = sel; S.panelTab = 'block'; renderBoard(); renderPanel(); }
  function focusNode(id) { const n = $('edBoard').querySelector(`[data-node="${CSS.escape(id)}"]`); if (n) { n.focus(); n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, a, [data-wire]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.level) { S.level = t.dataset.level; store.set(LS.level, S.level); render(); return; }
    if (t.dataset.zoom) { if (t.dataset.zoom === 'fit') S.fit = true; else { S.fit = false; S.zoom = Math.max(0.4, Math.min(1.5, Math.round((S.zoom + 0.1 * Number(t.dataset.zoom)) * 10) / 10)); } renderBoard(); return; }
    if (t.dataset.rail) { S.railTab = t.dataset.rail; renderRail(); return; }
    if (t.dataset.ptab) { S.panelTab = t.dataset.ptab; renderPanel(); return; }
    if (t.dataset.open) { open(t.dataset.open); return; }
    if (t.dataset.tpl) { S.tplOpen = S.tplOpen === t.dataset.tpl ? null : t.dataset.tpl; renderRail(); const f = root.querySelector('.tpl-form input'); if (f) f.select(); return; }
    if (t.dataset.add) {
      const r = M.addBlock(S.genome, t.dataset.add, catalog);
      commit(r.genome, { select: { kind: 'block', id: r.id } });
      focusNode(r.id);
      return;
    }
    if (t.dataset.node) {
      if (suppressClick) { suppressClick = false; return; }
      select({ kind: 'block', id: t.dataset.node });
      return;
    }
    if (t.dataset.wire !== undefined) { select({ kind: 'wire', index: Number(t.dataset.wire) }); return; }
    if (t.dataset.goto) { select({ kind: 'block', id: t.dataset.goto }); focusNode(t.dataset.goto); return; }
    if (t.dataset.gowire !== undefined) { select({ kind: 'wire', index: Number(t.dataset.gowire) }); return; }
    if (t.dataset.modal) {
      const kind = t.dataset.modal, pending = S.pending, conf = S.confirm;
      closeModal();
      if (kind === 'save-open') { await save(); if (!S.dirty) open(pending, { force: true }); }
      else if (kind === 'drop-open') open(pending, { force: true });
      else if (kind === 'import-rename') importFile(conf.file, true);
      else if (kind === 'delete') removeNet(false);
      else if (kind === 'delete-force') removeNet(true);
      return;
    }
    switch (t.dataset.act) {
      case 'save': save(); break;
      case 'delete': S.confirm = { kind: 'delete' }; showModal(); break;
      case 'tidy': S.pos = {}; store.del(LS.pos(S.netId)); renderBoard(); break;
      case 'remove': { const id = t.dataset.id; commit(M.removeBlock(S.genome, id), { select: null }); break; }
      case 'unwire': commit(M.disconnect(S.genome, Number(t.dataset.index)), { select: null }); break;
      default: break;
    }
  });

  root.addEventListener('submit', (ev) => {
    const f = ev.target.closest('form[data-create]');
    if (!f) return;
    ev.preventDefault();
    createFromTemplate(f.dataset.create, f.elements.name.value.trim());
  });

  // cambios de los controles: 'input' repinta solo el lienzo y la cabecera (el deslizador no se corta); 'change', todo
  const onControl = (ev, partial) => {
    const el = ev.target;
    if (!S.genome || !root.contains(el)) return;
    if (el.id === 'edName') { commit({ ...S.genome, name: el.value }, { partial: true }); return; }
    if (el.dataset.bparam) {
      const blk = blockOf(el.dataset.block), e = blk && M.entryOf(catalog, blk.type);
      const param = e && e.params.find((p) => p.key === el.dataset.bparam);
      if (!param) return;
      let raw = el.type === 'checkbox' && param.type === 'bool' ? el.checked : el.value;
      if (param.type === 'set') raw = [...root.querySelectorAll(`[data-bparam="${CSS.escape(param.key)}"][data-block="${CSS.escape(blk.id)}"]`)].filter((x) => x.checked).map((x) => x.dataset.opt);
      commit(M.setParam(S.genome, blk.id, param, raw), { partial });
      syncTwins(el);
      return;
    }
    if (el.dataset.gpath) {
      const path = el.dataset.gpath;
      const param = paramForPath(path);
      const cur = M.getPath(S.genome, path);
      const raw = el.type === 'checkbox' ? el.checked : el.value;
      const v = param ? M.coerce(param, raw, cur) : raw;
      commit(M.setPath(S.genome, path, v), { partial });
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
  root.addEventListener('input', (ev) => { if (ev.target.type === 'range' || ev.target.id === 'edName') onControl(ev, true); });
  root.addEventListener('change', (ev) => {
    if (ev.target.dataset.wi) { S.wi[ev.target.dataset.wi] = ev.target.value; scheduleWhatif(); return; }
    if (ev.target.dataset.import !== undefined && ev.target.files && ev.target.files[0]) { importFile(ev.target.files[0]); ev.target.value = ''; return; }
    if (ev.target.dataset.connect) {
      const r = M.connect(S.genome, ev.target.value, ev.target.dataset.connect);
      if (r.error) { toast(r.error, 'error'); renderPanel(); return; }
      commit(r.genome);
      return;
    }
    if (ev.target.id === 'edName') { renderRail(); return; }
    onControl(ev, false);
  });

  // teclado en el lienzo: Supr quita, flechas mueven (Mayús: más lejos), Esc suelta la selección
  root.addEventListener('keydown', (ev) => {
    if (!$('edModal').hidden && ev.key === 'Escape') { closeModal(); return; }
    const node = ev.target.closest && ev.target.closest('[data-node]');
    if (ev.key === 'Escape' && S.sel) { select(null); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && S.genome) { ev.preventDefault(); save(); return; }
    if (!node || !S.genome) return;
    const id = node.dataset.node;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); commit(M.removeBlock(S.genome, id), { select: null }); return; }
    const step = ev.shiftKey ? 32 : 8;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (d) {
      ev.preventDefault();
      const cur = M.layout(S.genome, catalog, S.pos).nodes[id];
      S.pos = { ...S.pos, [id]: { x: Math.max(0, cur.x + d[0]), y: Math.max(40, cur.y + d[1]) } };
      store.set(LS.pos(S.netId), S.pos);
      renderBoard(); focusNode(id);
    }
  });
  root.addEventListener('keydown', (ev) => {
    if (S.sel && S.sel.kind === 'wire' && (ev.key === 'Delete' || ev.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) {
      ev.preventDefault(); commit(M.disconnect(S.genome, S.sel.index), { select: null });
    }
  });

  // arrastrar: desde el punto de salida hace un cable; desde el bloque, lo mueve
  const boardPoint = (ev) => { const inner = $('edBoard').querySelector('.board-inner').getBoundingClientRect(); return { x: (ev.clientX - inner.left) / S.zoom, y: (ev.clientY - inner.top) / S.zoom }; };
  root.addEventListener('pointerdown', (ev) => {
    if (!S.genome || ev.button !== 0) return;
    const port = ev.target.closest('[data-port]');
    const node = ev.target.closest('[data-node]');
    if (port) {
      ev.preventDefault(); ev.stopPropagation();
      link = { from: port.dataset.port };
      $('edBoard').setPointerCapture(ev.pointerId);
      return;
    }
    if (node) {
      const p = M.layout(S.genome, catalog, S.pos).nodes[node.dataset.node];
      drag = { id: node.dataset.node, sx: ev.clientX, sy: ev.clientY, ox: p.x, oy: p.y, moved: false, el: node };
      node.setPointerCapture(ev.pointerId);
    }
  });
  root.addEventListener('pointermove', (ev) => {
    if (link) {
      const L = M.layout(S.genome, catalog, S.pos), a = L.nodes[link.from], p = boardPoint(ev);
      const tmp = $('edBoard').querySelector('#edTmpWire');
      if (tmp && a) tmp.setAttribute('d', `M${a.x + M.NODE.w},${a.y + M.NODE.h / 2} C${a.x + M.NODE.w + 60},${a.y + M.NODE.h / 2} ${p.x - 60},${p.y} ${p.x},${p.y}`);
      return;
    }
    if (!drag) return;
    const dx = (ev.clientX - drag.sx) / S.zoom, dy = (ev.clientY - drag.sy) / S.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const x = Math.max(0, drag.ox + dx), y = Math.max(40, drag.oy + dy);
    S.pos = { ...S.pos, [drag.id]: { x, y } };
    drag.el.style.left = `${x}px`; drag.el.style.top = `${y}px`;
    redrawWires();
  });
  root.addEventListener('pointerup', (ev) => {
    if (link) {
      const from = link.from;
      link = null;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = under && under.closest && under.closest('[data-node]');
      if (!target) { redrawWires(); return; }
      const r = M.connect(S.genome, from, target.dataset.node);
      if (r.error) { toast(r.error, 'error'); redrawWires(); return; }
      commit(r.genome, { select: { kind: 'block', id: target.dataset.node } });
      return;
    }
    if (drag) {
      if (drag.moved) { store.set(LS.pos(S.netId), S.pos); suppressClick = true; renderBoard(); focusNode(drag.id); }
      drag = null;
    }
  });
  window.addEventListener('beforeunload', (ev) => { if (S.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  return {
    async start(netId) {
      const t = await api('/api/lab/templates');
      S.templates = t.ok ? t.body : [];
      await loadNets();
      if (netId && S.nets.some((n) => n.id === netId)) await open(netId, { force: true });
      else render();
    },
    open,
    get state() { return S; },
  };
}
