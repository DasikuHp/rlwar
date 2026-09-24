// Ficha de red (P5, ronda 17 y sesión 7 de plan2): un cajón que sale por la derecha, encima de la etapa, al pulsar el
// nombre de cualquier red (cualquier elemento con `data-ficha="<id>"`, y `data-ficha-tab` para abrir una pestaña). Al
// retraerlo queda una lengüeta con el emblema; un clic y vuelve. Siete pestañas, todo con datos de la API:
//   Cerebro   — sus bloques de verdad (constelación con los pulsos de su última partida) y cuántos pesos tiene cada uno.
//   Historia  — el diario (frases comprobadas contra el registro) y la moviola turno a turno.
//   Memoria · Neuronas · Boletín — las de Verdad (spec/07).
//   Familia   — madres, hermanas e hijas del árbol genealógico, su casa, sus reinados y la sala de la fama.
//   Quirófano — congelar, tocar pesos a mano y trasplantar (la Cirugía de spec/05 §7).
import { mountTruth } from '../lab/verdad.js';
import { mountSurgery } from '../lab/cirugia.js';
import { emblemSVG } from '../lab/emblem.js';
import { api, reasonOf } from '../lab/api.js';
import { hub } from '../ui/sse.js';
import { patch } from '../ui/patch.js';
import { slide, smoothScroll } from '../ui/fx/anim.js';
import { startQueen, lastBeats } from './portada.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const when = (t) => (t ? new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const FICHA_TABS = [
  { key: 'cerebro', name: 'Cerebro' }, { key: 'historia', name: 'Historia' }, { key: 'memoria', name: 'Memoria' },
  { key: 'neuronas', name: 'Neuronas' }, { key: 'boletin', name: 'Boletín' }, { key: 'familia', name: 'Familia' }, { key: 'quirofano', name: 'Quirófano' },
];
const TRUTH_TABS = { historia: ['diario', 'moviola'], memoria: ['memoria'], neuronas: ['neuronas'], boletin: ['boletin'] };
const GROUP = { eyes: 'Ojos', instinct: 'Instinto', memory: 'Memoria', hands: 'Manos', feet: 'Pies' };
const GROUP_ORDER = ['eyes', 'instinct', 'memory', 'hands', 'feet'];

export function mountFicha(el, { catalog, toast }) {
  el.innerHTML = `<button type="button" class="f-tab" id="fTab" aria-controls="fPanel" aria-expanded="false" title="Volver a abrir la ficha"></button>
    <div class="f-panel" id="fPanel" role="dialog" aria-modal="false" aria-labelledby="fName">
      <header class="f-head" id="fHead"></header>
      <nav class="f-tabs" role="tablist" aria-label="Pestañas de la ficha">${FICHA_TABS.map((t) => `<button type="button" role="tab" data-ftab="${t.key}" aria-selected="false">${t.name}</button>`).join('')}</nav>
      <div class="f-body" id="fBody"><div class="f-content" id="fContent">${FICHA_TABS.map((t) => `<section data-fview="${t.key}" hidden></section>`).join('')}</div></div>
    </div>`;
  const $ = (id) => el.querySelector(`#${id}`);
  const S = { netId: null, tab: 'cerebro', state: 'closed', nets: [], throne: null, genealogy: null, genome: null };
  const views = {};
  let stopBrain = null, stopScroll = null, offSSE = null, timer = null;
  const groupOf = (type) => ((catalog.blocks || []).find((b) => b.type === type) || {}).group || 'instinct';
  const nameOfType = (type) => ((catalog.blocks || []).find((b) => b.type === type) || {}).name || type;
  const net = (id) => S.nets.find((n) => n.id === id);
  const nameOf = (id) => (net(id) ? net(id).name : id);

  // ---------- cabecera: emblema, nombre y sus números ----------
  function headHTML() {
    const n = net(S.netId);
    if (!n) return `<h2 id="fName" tabindex="-1">${esc(S.netId)}</h2><div class="f-acts"><button type="button" data-fact="close" aria-label="Cerrar la ficha">✕</button></div>`;
    const s = n.stats || {};
    const games = s.games || 0, wins = s.wins || 0;
    const tags = [n.isQueen ? '<span class="tag queen">reina</span>' : '', n.house ? `<span class="tag">casa ${esc(n.house)}</span>` : '', n.training ? '<span class="tag busy">entrenando</span>' : '', n.playable === false ? '<span class="tag bad">no puede jugar</span>' : ''].join('');
    return `<span class="f-em" aria-hidden="true">${emblemSVG(n.emblem, 54)}</span>
      <div class="f-id"><h2 id="fName" tabindex="-1">${esc(n.name)}</h2><p class="mono dim">${esc(n.id)} ${tags}</p></div>
      <div class="f-acts"><a class="btn small" href="#crear/${esc(n.id)}">Editar</a><button type="button" data-fact="retract" title="Retraer (queda la lengüeta)" aria-label="Retraer la ficha">▸</button><button type="button" data-fact="close" aria-label="Cerrar la ficha">✕</button></div>
      <dl class="f-nums"><div><dt>Generación</dt><dd>${n.generation ?? 0}</dd></div><div><dt>Pesos</dt><dd>${(n.paramCount ?? 0).toLocaleString('es-ES')}</dd></div><div><dt>Partidas</dt><dd>${games}</dd></div><div><dt>Victorias</dt><dd>${wins} <small>${pct(games ? wins / games : null)}</small></dd></div><div><dt>Bajas / muertes</dt><dd>${s.kills || 0} / ${s.deaths || 0}</dd></div></dl>`;
  }
  function renderChrome() {
    patch($('fHead'), headHTML());
    const n = net(S.netId);
    $('fTab').innerHTML = `${n ? `<span aria-hidden="true">${emblemSVG(n.emblem, 26)}</span>` : ''}<span class="f-tab-t">Ficha</span>`;
    $('fTab').setAttribute('aria-label', `Abrir la ficha de ${n ? n.name : S.netId}`);
    for (const b of el.querySelectorAll('[data-ftab]')) b.setAttribute('aria-selected', String(b.dataset.ftab === S.tab));
  }

  // ---------- Cerebro ----------
  async function showBrain(box) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}`);
    if (!r.ok) { box.innerHTML = `<p class="bad">${esc(reasonOf(r))}</p>`; return; }
    const g = r.body.genome;
    const frozen = new Set(Array.isArray(g.frozen) ? g.frozen : []);
    const size = (id) => Object.values((g.weights || {})[id] || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
    const byGroup = GROUP_ORDER.map((k) => [k, g.blocks.filter((b) => groupOf(b.type) === k)]).filter(([, l]) => l.length);
    const beats = await lastBeats(api, S.netId);
    box.innerHTML = `<figure class="f-brain"><canvas id="fBrainCv" role="img" aria-label="Constelación de los bloques de ${esc(g.name)}"></canvas>
        <figcaption>Una estrella por bloque, más grande cuantos más pesos tiene. Los cables son sus conexiones de verdad.
        ${beats.length ? `Laten con las <b>${beats.length}</b> decisiones de su última partida: cuanto más brilla un bloque, más se activó.` : 'Aún no ha jugado: sin pulsos.'}</figcaption></figure>
      <div class="f-blocks">${byGroup.map(([k, list]) => `<section><h3 class="grp-${k}">${GROUP[k]}</h3><ul>${list.map((b) => `<li><span>${esc(nameOfType(b.type))}</span><span class="mono dim">${esc(b.id)}</span><span class="mono">${size(b.id).toLocaleString('es-ES')} pesos</span>${frozen.has(b.id) ? '<span class="tag">congelado</span>' : ''}</li>`).join('')}</ul></section>`).join('')}</div>
      <p class="hint">${g.blocks.length} bloques y ${g.wires.length} cables. Para cambiarla, <a href="#crear/${esc(g.id)}">ábrela en el editor</a>; para tocar pesos a mano, el <button type="button" class="link" data-ftab="quirofano">Quirófano</button>.</p>`;
    if (stopBrain) stopBrain();
    stopBrain = startQueen(box.querySelector('#fBrainCv'), { genome: g, groupOf, beats, reduce: document.body.classList.contains('reduce') });
  }

  // ---------- Familia ----------
  async function showFamily(box) {
    const [gen, th] = await Promise.all([api('/api/lab/genealogy'), api('/api/lab/throne')]);
    const G = gen.ok ? gen.body.nets : {};
    const me = G[S.netId];
    const T = th.ok ? th.body : {};
    const link = (id) => (net(id) ? `<button type="button" class="link" data-ficha="${esc(id)}" data-ficha-tab="familia">${esc(nameOf(id))}</button>` : `<span class="dim">${esc(id)} (ya no está)</span>`);
    const list = (ids, empty) => (ids.length ? `<ul class="f-fam">${ids.map((id) => `<li>${emblemOf(id)}${link(id)} <span class="dim">gen. ${G[id] ? G[id].generation : '—'}</span></li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`);
    const emblemOf = (id) => (net(id) ? `<span class="em" aria-hidden="true">${emblemSVG(net(id).emblem, 22)}</span>` : '');
    const parents = me ? me.parents : [];
    const children = Object.entries(G).filter(([, e]) => e.parents.includes(S.netId)).map(([id]) => id);
    const siblings = Object.entries(G).filter(([id, e]) => id !== S.netId && e.parents.some((p) => parents.includes(p))).map(([id]) => id);
    const houses = Object.entries(T.dynasties || {}).filter(([, d]) => d && (d.champion === S.netId || d.founder === S.netId));
    const reigns = (T.reigns || []).filter((r) => r.netId === S.netId);
    const hof = (T.hallOfFame || []).filter((h) => h.netId === S.netId);
    box.innerHTML = `<div class="f-family">
      <section><h3>Madres</h3>${list(parents, me ? 'Ninguna: nació en el editor.' : 'No está en el árbol genealógico de este mundo.')}</section>
      <section><h3>Hermanas</h3>${list(siblings, 'Ninguna.')}</section>
      <section><h3>Hijas</h3>${list(children, 'Aún ninguna. Se crían en 2 · Entrenar → Evolución.')}</section>
      <section><h3>Casa</h3>${houses.length ? houses.map(([k, d]) => `<p>Casa <b>${esc(k)}</b> · ${esc(d.name)}${d.champion === S.netId ? ' · <b>campeona</b>' : ''}${d.founder === S.netId ? ' · fundadora' : ''} · generación ${d.generation ?? 0}</p>`).join('') : '<p class="empty">No es campeona ni fundadora de ninguna casa.</p>'}</section>
      <section><h3>Reinados</h3>${reigns.length ? `<ol class="f-reigns">${reigns.map((r) => `<li>${esc(when(r.from))} → ${r.to ? esc(when(r.to)) : '<b>reina ahora</b>'} · ${r.defenses ?? 0} defensas</li>`).join('')}</ol>` : '<p class="empty">Nunca ha reinado.</p>'}</section>
      ${hof.length ? `<section><h3>Sala de la fama</h3><p>Tiene ${hof.length} copia${hof.length === 1 ? '' : 's'} congelada${hof.length === 1 ? '' : 's'} en la sala de la fama.</p></section>` : ''}
      ${me ? `<p class="hint">Generación ${me.generation}${me.edited ? ' · la has cambiado en el editor desde que nació' : ''}${me.orphan ? ' · alguna madre ya no existe' : ''}. Nació el ${esc(when(me.born))}.</p>` : ''}
    </div>`;
  }

  // ---------- mostrar una pestaña ----------
  async function showTab() {
    renderChrome();
    for (const s of el.querySelectorAll('[data-fview]')) s.hidden = s.dataset.fview !== S.tab;
    const box = el.querySelector(`[data-fview="${S.tab}"]`);
    if (S.tab !== 'cerebro' && stopBrain) { stopBrain(); stopBrain = null; }
    if (TRUTH_TABS[S.tab]) {
      // una sola vista de Verdad para las 4 pestañas: su raíz se mueve a la sección que se ve
      if (!views.truth) { views.truthRoot = document.createElement('div'); views.truthRoot.className = 'lab-tv'; views.truth = mountTruth(views.truthRoot, { catalog, toast, bare: true }); }
      if (views.truthRoot.parentNode !== box) box.appendChild(views.truthRoot);
      await views.truth.show({ netId: S.netId, tabs: TRUTH_TABS[S.tab] });
    } else if (S.tab === 'quirofano') {
      views.surgery ||= mountSurgery(box, { catalog, toast, bare: true });
      await views.surgery.show({ netId: S.netId });
    } else if (S.tab === 'cerebro') await showBrain(box);
    else if (S.tab === 'familia') await showFamily(box);
    $('fBody').scrollTop = 0;
  }

  async function loadNets() { const r = await api('/api/lab/nets'); if (r.ok) S.nets = r.body.nets; }
  async function open(netId, tab = null) {
    const changed = netId !== S.netId;
    S.netId = netId;
    if (tab && FICHA_TABS.some((t) => t.key === tab)) S.tab = tab;
    await loadNets();
    const wasOpen = S.state === 'open';
    setState('open');
    if (!wasOpen) slide(el, true);
    if (changed || tab || !wasOpen) await showTab(); else renderChrome();
    $('fName')?.focus?.();
    if (!offSSE) offSSE = ['training', 'throne', 'duel', 'dynasty'].map((k) => hub.on('/api/lab/events', k, () => { clearTimeout(timer); timer = setTimeout(async () => { if (S.state !== 'closed') { await loadNets(); renderChrome(); } }, 400); }));
    if (!stopScroll) smoothScroll($('fBody'), $('fContent')).then((d) => { stopScroll = d; });
  }
  function setState(st) {
    S.state = st;
    el.hidden = st === 'closed';
    el.dataset.state = st;
    $('fTab').setAttribute('aria-expanded', String(st === 'open'));
    $('fPanel').inert = st !== 'open';
  }
  async function retract() { if (S.state !== 'open') return; setState('retracted'); await slide(el, false); if (S.state === 'retracted') $('fTab').focus(); }
  async function reopen() { setState('open'); await slide(el, true); $('fName')?.focus?.(); }
  function close() {
    setState('closed');
    if (stopBrain) { stopBrain(); stopBrain = null; }
    if (offSSE) { offSSE.forEach((off) => off()); offSSE = null; }
    if (views.truth) views.truth.stop();
  }

  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.hasAttribute('data-ficha')) return;
    if (b.id === 'fTab') { reopen(); return; }
    if (b.dataset.fact === 'retract') { retract(); return; }
    if (b.dataset.fact === 'close') { close(); return; }
    if (b.dataset.ftab && b.dataset.ftab !== S.tab) { S.tab = b.dataset.ftab; await showTab(); }
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.state === 'open') { ev.stopPropagation(); retract(); }
    // flechas entre pestañas, como un tablist
    const t = ev.target.closest && ev.target.closest('[data-ftab][role="tab"]');
    if (t && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
      const i = FICHA_TABS.findIndex((x) => x.key === t.dataset.ftab);
      const next = FICHA_TABS[(i + (ev.key === 'ArrowRight' ? 1 : FICHA_TABS.length - 1)) % FICHA_TABS.length].key;
      el.querySelector(`[data-ftab="${next}"][role="tab"]`).focus();
    }
  });
  // cualquier nombre de red con data-ficha, en cualquier vista, abre su ficha
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('[data-ficha]');
    if (!a) return;
    ev.preventDefault();
    open(a.dataset.ficha, a.dataset.fichaTab || null);
  });
  setState('closed');
  return { open, close, retract, get state() { return S.state; } };
}
