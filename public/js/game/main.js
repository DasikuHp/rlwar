// Juego (P5): portada con menú y 3 partidas guardadas (mundos, spec/09), y las 4 etapas con las vistas del laboratorio
// dentro. Las vistas no se desmontan al cambiar de etapa (el editor conserva lo que no has guardado). Al cambiar de
// mundo se recarga la página: así ninguna vista se queda con redes del mundo anterior.
import { api, reasonOf } from '../lab/api.js';
import { mountEditor } from '../lab/editor.js';
import { mountHome } from '../lab/inicio.js';
import { mountTraining } from '../lab/entreno.js';
import { mountEvolution } from '../lab/evolucion.js';
import { mountThrone } from '../lab/trono.js';
import { mountDynasties } from '../lab/dinastias.js';
import { mountTruth } from '../lab/verdad.js';
import { mountDuel } from './espectar.js';
import { STAGES, parseRoute, hrefOf } from './routes.js';
import { SETTINGS, SETTINGS_EVENT, loadSettings, saveSettings, reduceMotion } from './ajustes.js';
import { setFx } from '../render.js';
import { startBackground, startQueen, lastBeats } from './portada.js';
import { mountFicha } from './ficha.js';
import { startFluid } from '../ui/fx/fluid.js';
import { setReduce, introPortada, enter, springButtons, particles } from '../ui/fx/anim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PATHS = [
  { v: 'cero', name: 'Desde cero', level: 'aprendiz', help: 'No sabes nada de redes ni de aprendizaje. Empiezas con lo justo (vista Aprendiz) y todo se explica con ejemplos.' },
  { v: 'algo', name: 'Ya sé algo', level: 'artesano', help: 'Sabes qué es una red neuronal. Ves más ajustes desde el principio (vista Artesano).' },
  { v: 'rl', name: 'Sé de RL', level: 'cientifico', help: 'Conoces el aprendizaje por refuerzo. Lo ves todo, con las matemáticas (vista Científico).' },
];
const LEVEL_OF = { A: 'aprendiz', B: 'artesano', C: 'cientifico' };
const PATH_NAME = Object.fromEntries(PATHS.map((p) => [p.v, p.name]));
const when = (ms) => (ms ? new Date(ms).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ---------- aviso ----------
let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = $('toast');
  el.textContent = msg; el.className = `show ${kind}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 2600);
}

// ---------- ajustes ----------
// un solo objeto para todo el juego: las vistas lo reciben al montarse y ven cada cambio al momento
const settings = loadSettings();
const applySettings = () => {
  const reduce = reduceMotion(settings);
  document.body.classList.toggle('reduce', reduce); setReduce(reduce);
  setFx({ quality: settings.quality, reduce });
};
applySettings();

// ---------- mundos ----------
let worlds = { active: null, worlds: [] };
async function loadWorlds() {
  const r = await api('/api/worlds');
  if (r.ok) worlds = r.body;
  return r;
}
const activeWorld = () => worlds.worlds.find((w) => w.n === worlds.active && !w.empty) || null;
function setEditorLevel(level) { try { localStorage.setItem('gw.lab.level', JSON.stringify(level)); } catch { /* sin almacenamiento */ } }
async function openWorld(n, then = '#crear') {
  const r = await api(`/api/worlds/${n}/open`, 'POST', {});
  if (!r.ok) { toast(reasonOf(r), 'error'); return false; }
  const w = r.body.world;
  if (w && LEVEL_OF[w.level]) setEditorLevel(LEVEL_OF[w.level]);
  location.hash = then;
  location.reload();
  return true;
}

// ---------- portada: tres capas (fluido WebGL, partículas, constelación) y el plano con sus curvas ----------
let stopBg = null, stopQueen = null, introDone = false;
async function startLayers() {
  if (stopBg) stopBg();
  const still = reduceMotion(settings) || settings.quality === 'baja';
  const fluid = still || settings.fluid === 'apagada' ? null : startFluid($('fluid'), { quality: settings.quality, strength: settings.fluid === 'intensa' ? 1 : 0.4 });
  $('fluid').hidden = !fluid;
  const stopParticles = still ? () => {} : await particles($('pfx'), { quality: settings.quality });
  const COLORS = [[0.05, 0.2, 0.3], [0.14, 0.09, 0.3]];
  const stopCurves = startBackground($('bgfx'), {
    quality: settings.quality, reduce: still, dust: $('pfx').childElementCount === 0,
    onHead: fluid ? (x, y, dx, dy, i) => fluid.splat(x, y, dx * 0.6, dy * 0.6, COLORS[i % 2], 0.0012) : null,
  });
  stopBg = () => { stopCurves(); stopParticles(); if (fluid) fluid.stop(); };
}
async function showPortada() {
  $('game').hidden = true;
  $('portada').hidden = false;
  document.title = 'Graphwar · Entrenador de redes';
  await loadWorlds();
  renderMenu();
  if (!introDone) { introDone = true; introPortada({ title: $('portada').querySelector('.p-title'), sub: $('portada').querySelector('.p-sub'), items: [...$('menu').children] }); }
  await startLayers();
  renderQueen();
}
function renderMenu() {
  const act = activeWorld();
  const full = worlds.worlds.filter((w) => !w.empty);
  const last = act || full.slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))[0] || null;
  const items = [
    { id: 'cont', name: 'Continuar', sub: last ? `${last.name} · ${last.nets} redes` : 'aún no hay partidas', primary: !!last, disabled: !last },
    { id: 'new', name: 'Nueva partida', sub: full.length === 3 ? 'las 3 ranuras están llenas' : `${3 - full.length} ranura${full.length === 2 ? '' : 's'} libre${full.length === 2 ? '' : 's'}`, primary: !last },
    { id: 'load', name: 'Cargar o borrar', sub: `${full.length} de 3 partidas guardadas` },
    { id: 'academy', name: 'Academia', sub: 'llega con el tutorial', disabled: true },
    { id: 'settings', name: 'Ajustes', sub: 'gráficos, movimiento, velocidad' },
  ];
  $('menu').innerHTML = items.map((i) => `<button type="button" id="m-${i.id}"${i.primary ? ' class="primary"' : ''}${i.disabled ? ' disabled' : ''}><span>${i.name}</span><small>${esc(i.sub)}</small></button>`).join('');
  $('m-cont').onclick = () => { if (!last) return; if (act) { location.hash = '#crear'; } else openWorld(last.n); };
  $('m-new').onclick = openNewDialog;
  $('m-load').onclick = openLoadDialog;
  $('m-settings').onclick = openSettings;
  $('menu').querySelector('button:not(:disabled)')?.focus();
}
async function renderQueen() {
  if (stopQueen) { stopQueen(); stopQueen = null; }
  const cap = $('queenCaption');
  const act = activeWorld();
  if (!act) { cap.innerHTML = 'Crea una partida y aquí brillará la red que reine en tu mundo.'; clearQueen(); return; }
  const cat = await api('/api/lab/catalog');
  const groupOf = (type) => ((cat.ok ? cat.body.blocks : []).find((b) => b.type === type) || {}).group || 'instinct';
  const th = await api('/api/lab/throne');
  const queenId = th.ok && th.body.queen ? th.body.queen : null;
  const id = queenId || (act.practice && act.practice[0]) || null;
  const net = id ? await api(`/api/lab/nets/${id}`) : null;
  if (!net || !net.ok) { cap.textContent = 'Este mundo aún no tiene reina.'; clearQueen(); return; }
  const g = net.body.genome;
  const beats = await lastBeats(api, id);
  if ($('portada').hidden) return; // ya te has ido de la portada
  const params = Object.values(g.weights || {}).reduce((s, w) => s + Object.values(w).reduce((t, a) => t + (Array.isArray(a) ? a.length : 0), 0), 0);
  cap.innerHTML = `${queenId ? '👑 Reina' : 'Rival de práctica'}: <b>${esc(g.name)}</b> · ${g.blocks.length} bloques · ${params.toLocaleString('es-ES')} pesos${beats.length ? ` · late con ${beats.length} decisiones reales de su última partida` : ' · aún no ha jugado: sin pulsos'}`;
  stopQueen = startQueen($('queenCanvas'), { genome: g, groupOf, beats, reduce: reduceMotion(settings) });
}
function clearQueen() { const c = $('queenCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

// ---------- diálogos ----------
function openNewDialog() {
  const free = worlds.worlds.filter((w) => w.empty);
  const d = $('dlgNew');
  if (!free.length) { openLoadDialog('Las 3 ranuras están llenas: borra una partida para empezar otra.'); return; }
  d.innerHTML = `<header><h2 id="dlgNewT">Nueva partida</h2><button type="button" data-close>Cerrar</button></header>
    <form class="body" method="dialog" id="fNew">
      <div class="row"><label class="field">Ranura<select id="nSlot">${free.map((w) => `<option value="${w.n}">Ranura ${w.n}</option>`).join('')}</select></label>
        <label class="field" style="flex:1">Nombre del mundo<input id="nName" maxlength="40" value="Mundo ${free[0].n}"></label></div>
      <p class="g-note">Cada partida es un mundo entero: sus redes, su trono, sus dinastías y sus duelos. Empieza con una copia de <b>Vidente 1</b>, la rival de práctica.</p>
      <div class="paths" role="radiogroup" aria-label="Cómo empiezas">${PATHS.map((p, i) => `<label><input type="radio" name="path" value="${p.v}"${i === 0 ? ' checked' : ''}><b>${p.name}</b><span>${esc(p.help)}</span></label>`).join('')}</div>
      <p class="g-note">El tutorial de cada camino llega en una fase posterior; de momento empiezas en el editor, con la vista que elijas (se cambia cuando quieras).</p>
      <p class="err" id="nErr"></p>
      <div class="row"><button type="submit" class="primary">Crear y empezar</button></div>
    </form>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  $('nSlot').onchange = (e) => { const v = $('nName'); if (/^Mundo \d$/.test(v.value)) v.value = `Mundo ${e.target.value}`; };
  $('fNew').onsubmit = async (e) => {
    e.preventDefault();
    const n = Number($('nSlot').value), path = d.querySelector('input[name="path"]:checked').value;
    const r = await api(`/api/worlds/${n}/new`, 'POST', { path, name: $('nName').value.trim() });
    if (!r.ok) { $('nErr').textContent = reasonOf(r); return; }
    setEditorLevel(PATHS.find((p) => p.v === path).level);
    d.close();
    await openWorld(n, '#crear');
  };
  d.showModal();
}
function openLoadDialog(note = '') {
  const d = $('dlgLoad');
  const card = (w) => (w.empty
    ? `<article class="slot empty"><h3>Ranura ${w.n}</h3><p>Vacía.</p><div class="acts"><button type="button" data-new>Nueva partida aquí</button></div></article>`
    : `<article class="slot${w.n === worlds.active ? ' active' : ''}"><h3>${esc(w.name)} <small>ranura ${w.n}${w.n === worlds.active ? ' · abierta' : ''}</small></h3>
      <dl><dt>Camino</dt><dd>${esc(PATH_NAME[w.path] || w.path)}</dd><dt>Redes</dt><dd>${w.nets}</dd><dt>Partidas</dt><dd>${w.games}</dd>
      <dt>Reina</dt><dd>${w.queen ? esc(w.queen.name) : '—'}</dd><dt>Reinados</dt><dd>${w.reigns}</dd><dt>Última vez</dt><dd>${esc(when(w.lastPlayedAt))}</dd></dl>
      <div class="acts"><button type="button" class="primary" data-open="${w.n}">Abrir</button><button type="button" class="danger" data-del="${w.n}">Borrar…</button></div></article>`);
  d.innerHTML = `<header><h2 id="dlgLoadT">Cargar o borrar una partida</h2><button type="button" data-close>Cerrar</button></header>
    <div class="body">${note ? `<p class="g-note warn">${esc(note)}</p>` : ''}<div class="slots">${worlds.worlds.map(card).join('')}</div><p class="err" id="lErr"></p></div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  for (const b of d.querySelectorAll('[data-open]')) b.onclick = () => openWorld(Number(b.dataset.open), '#crear');
  for (const b of d.querySelectorAll('[data-new]')) b.onclick = () => { d.close(); openNewDialog(); };
  // borrar: se confirma con un segundo clic que dice qué pasa (spec/09 §4: el servidor pide el nombre exacto, y se lo
  // mandamos nosotros); no se pierde del todo: la carpeta va a la papelera
  for (const b of d.querySelectorAll('[data-del]')) b.onclick = () => {
    const w = worlds.worlds.find((x) => x.n === Number(b.dataset.del));
    const acts = b.parentElement;
    acts.innerHTML = `<p class="g-note" style="width:100%">¿Borrar <b>${esc(w.name)}</b>? Desaparece del juego con sus ${w.nets} redes y sus ${w.games} partidas jugadas. Se guarda una copia en la papelera (<span class="mono">evo/archivo-borrados</span>), por si acaso.</p>
      <button type="button" class="danger" data-really>Sí, borrarla</button><button type="button" data-cancel>No, dejarla</button>`;
    acts.querySelector('[data-cancel]').focus();
    acts.querySelector('[data-cancel]').onclick = () => openLoadDialog(note);
    acts.querySelector('[data-really]').onclick = async () => {
      const r = await api(`/api/worlds/${w.n}`, 'DELETE', { confirm: w.name });
      if (!r.ok) { $('lErr').textContent = reasonOf(r); return; }
      toast(`"${w.name}" borrada (la copia está en la papelera)`);
      await loadWorlds(); renderMenu(); openLoadDialog(); renderQueen();
    };
  };
  if (!d.open) d.showModal();
}
function openSettings() {
  const d = $('dlgSettings');
  d.innerHTML = `<header><h2 id="dlgSetT">Ajustes</h2><button type="button" data-close>Cerrar</button></header>
    <div class="body"><div class="set-grid">${SETTINGS.map((s) => `<span>${s.name}</span><div class="opts" role="radiogroup" aria-label="${s.name}">${s.options.map((o) => `<label><input type="radio" name="${s.key}" value="${o.v}"${settings[s.key] === o.v ? ' checked' : ''}><b>${o.name}</b><small>${esc(o.help)}</small></label>`).join('')}${s.note ? `<p class="g-note">${esc(s.note)}</p>` : ''}</div>`).join('')}</div>
    <p class="g-note">Se guardan en este navegador y se aplican al momento: la portada, el duelo y los formularios de duelo y trono.</p></div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  for (const inp of d.querySelectorAll('input[type="radio"]')) inp.onchange = () => {
    settings[inp.name] = inp.value;
    saveSettings(settings); applySettings();
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key: inp.name } }));
    if (!$('portada').hidden) { startLayers(); renderQueen(); }
  };
  d.showModal();
}

// ---------- el juego: 4 etapas ----------
const views = {};
let catalog = null;
function viewEl(key) {
  let el = $('view').querySelector(`[data-view="${key}"]`);
  if (!el) { el = document.createElement('div'); el.dataset.view = key; el.hidden = true; $('view').appendChild(el); }
  return el;
}
// cada pestaña: su vista del laboratorio (se monta la primera vez que se abre)
const MOUNT = {
  'crear/editor': (el) => mountEditor(el, { catalog, toast }),
  'crear/redes': (el) => mountHome(el),
  'entrenar/entrenamiento': (el) => mountTraining(el, { toast }),
  'entrenar/evolucion': (el) => mountEvolution(el, { catalog, toast }),
  'duelo/vivo': (el) => mountDuel(el, { toast, settings }),
  'trono/trono': (el) => mountThrone(el, { toast, settings }),
  'trono/dinastias': (el) => mountDynasties(el, { toast }),
  'trono/cronica': (el) => mountTruth(el, { catalog, toast, bare: true, tabs: ['cronica'] }),
};
const CLASS = { 'crear/editor': 'lab-ed', 'crear/redes': 'lab-home', 'entrenar/entrenamiento': 'lab-tr', 'entrenar/evolucion': 'lab-tr', 'trono/trono': 'lab-thr', 'trono/dinastias': 'lab-thr', 'trono/cronica': 'lab-tv' };
let editorStarted = false, shownKey = null;
async function showStage(r) {
  if (!activeWorld()) { toast('Abre o crea una partida primero.', 'error'); location.hash = '#portada'; return; }
  if (stopBg) { stopBg(); stopBg = null; }
  if (stopQueen) { stopQueen(); stopQueen = null; }
  $('portada').hidden = true; $('game').hidden = false;
  const st = STAGES.find((s) => s.key === r.stage);
  $('stages').innerHTML = STAGES.map((s) => `<a href="${hrefOf({ stage: s.key })}" data-stage="${s.key}"${s.key === st.key ? ' aria-current="page"' : ''}><b>${s.n}</b>${esc(s.short)}</a>`).join('');
  const w = activeWorld();
  $('worldChip').innerHTML = `${esc(w.name)} <i>· ranura ${w.n}</i>`;
  $('stageHead').innerHTML = `<div class="g-num" data-stage="${st.key}">${st.n}.</div>
    <div class="g-title"><h1>${st.key === 'trono' ? 'Resultados, <em>trono</em> y análisis' : esc(st.title)}</h1><p>${esc(st.sub)}</p></div>
    <div class="g-motto">Functions shape victory</div>
    <nav class="g-tabs" aria-label="Pestañas de la etapa">${st.tabs.length > 1 ? st.tabs.map((t) => `<a href="${hrefOf({ stage: st.key, tab: t.key })}"${t.key === r.tab ? ' aria-current="page"' : ''}>${esc(t.name)}</a>`).join('') : ''}</nav>`;
  const key = `${r.stage}/${r.tab}`;
  for (const el of $('view').children) el.hidden = el.dataset.view !== key;
  const el = viewEl(key);
  if (el.hidden || shownKey !== key) enter(el);
  shownKey = key;
  el.hidden = false;
  if (CLASS[key]) el.className = CLASS[key];
  if (!views[key]) views[key] = MOUNT[key](el);
  document.title = `${st.n} · ${st.short} · Graphwar`;
  const v = views[key];
  if (key === 'crear/editor') {
    if (!editorStarted) { editorStarted = true; await v.start(r.id); }
    else if (r.id && r.id !== v.state.netId) v.open(r.id);
  } else if (key === 'duelo/vivo') await v.start(r.code);
  else if (v && v.start) v.start();
  for (const [k, vv] of Object.entries(views)) if (k !== key && vv && vv.stop) vv.stop();
}

async function route() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  const r = parseRoute(location.hash);
  if (r.screen === 'portada') return showPortada();
  if (r.screen === 'room') { location.hash = hrefOf({ stage: 'duelo', code: r.code }); return; }
  return showStage(r);
}

// ---------- arranque ----------
const [cat] = await Promise.all([api('/api/lab/catalog'), loadWorlds()]);
if (!cat.ok) {
  document.body.innerHTML = `<p style="padding:40px">No se pudo cargar el catálogo de bloques: ${esc(reasonOf(cat))}. ¿Está el servidor en marcha? (<span class="mono">node server/server.js</span>)</p>`;
} else {
  catalog = cat.body;
  mountFicha($('ficha'), { catalog, toast });
  springButtons('.p-menu button, body.game button.primary, .g-stages a, .g-tabs a');
  $('btnSettings').onclick = openSettings;
  $('worldChip').onclick = () => { location.hash = '#portada'; };
  $('worldChip').title = 'Volver a la portada (cambiar de partida)';
  window.addEventListener('hashchange', route);
  await route();
}
