// Dinastías (parte 4, spec/prompt-opus-ui.md §3.1; spec/06 §3 y §6.4): dos casas con su campeona; una generación es
// una carrera (entreno cruzado → cría → relevo si la hija gana a la madre → duelo entre casas). El relato sale de la
// crónica del servidor, con frases verificadas contra el registro (spec/07 §12, M5): aquí no se redacta ninguna.
import * as Y from './dynasty.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { hub } from '../ui/sse.js';
import { patch } from '../ui/patch.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { running: 'en marcha', done: 'terminada', error: 'con error' };

export function mountDynasties(root, { toast }) {
  const S = { nets: [], houses: { A: null, B: null }, story: [], jobs: [], found: { A: { name: '', netId: '' }, B: { name: '', netId: '' } }, refound: null, gen: Y.defaultGeneration(), ch: { learning: 'mix', speed: 'turbo' } };
  let es = null, timer = null;
  const net = (id) => S.nets.find((n) => n.id === id);
  const nameOf = (id) => (net(id) ? net(id).name : id);

  async function loadAll() {
    const [n, d, c, j] = await Promise.all([api('/api/lab/nets'), api('/api/lab/dynasties'), api('/api/lab/chronicle'), api('/api/lab/jobs')]);
    if (n.ok) S.nets = n.body.nets;
    if (d.ok) S.houses = d.body;
    if (c.ok) S.story = Y.dynastyStory(c.body.entries);
    if (j.ok) S.jobs = j.body.jobs.filter((x) => x.kind === 'generation').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    render();
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadAll, 300); };
  const netOptions = (cur) => `<option value="">elige una red…</option>${S.nets.map((n) => `<option value="${esc(n.id)}" ${n.id === cur ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}`;

  function foundHTML(house = null) {
    const keys = house ? [house] : ['A', 'B'];
    return `<form id="foundForm" class="found" data-house="${house || ''}" novalidate><h2>${house ? `Refundar la casa ${house}` : 'Fundar las dos casas'}</h2>
      <p class="hint">Cada casa tiene una campeona. En cada generación entrenan una contra la otra, crían hijos y la mejor hija releva a su madre si le gana un duelo.</p>
      <div class="found-grid">${keys.map((h) => `<fieldset><legend>Casa ${h}</legend>
        <div class="ctl"><label for="fd-${h}-n">Nombre</label><div class="ctl-in"><input id="fd-${h}-n" maxlength="32" placeholder="Casa ${h}" value="${esc(S.found[h].name)}" data-fd="${h}.name"></div></div>
        <div class="ctl"><label for="fd-${h}-c">Campeona</label><div class="ctl-in"><select id="fd-${h}-c" data-fd="${h}.netId">${netOptions(S.found[h].netId)}</select></div></div></fieldset>`).join('')}</div>
      <p class="bad" id="fdErr" role="alert"></p><div class="row"><button type="submit" class="primary">${house ? 'Refundar' : 'Fundar las casas'}</button>${house ? '<button type="button" data-act="cancel">Cancelar</button>' : ''}</div></form>`;
  }
  function houseHTML(key) {
    const h = Y.houseView(key, S.houses[key]);
    if (!h) return `<div class="house empty"><p class="dim">Casa ${key} sin fundar.</p></div>`;
    const c = h.champion && net(h.champion);
    return `<section class="house" aria-labelledby="hh-${key}"><p class="house-key">${key}</p><h2 id="hh-${key}">${esc(h.name)}</h2>
      <div class="champ">${c ? `<span class="em-big" aria-hidden="true">${emblemSVG(c.emblem, 64)}</span>` : ''}<div><p class="label">Campeona</p><p class="queen-name">${h.champion ? esc(nameOf(h.champion)) : 'ninguna (bórrala o refúndala)'}</p><p class="dim">fundadora: ${esc(nameOf(h.founder))}</p></div></div>
      <dl class="facts"><div><dt>Generaciones ganadas</dt><dd>${h.generation}</dd></div><div><dt>Generaciones jugadas</dt><dd>${h.history.length}</dd></div></dl>
      ${h.history.length ? `<table class="curve-table"><thead><tr><th>Gen.</th><th>Campeona</th><th>Duelo entre casas</th></tr></thead><tbody>${h.history.map((x) => `<tr><td class="mono">${x.generation}</td><td>${esc(nameOf(x.champion))}</td><td>${x.won ? 'ganado' : 'no ganado'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aún sin generaciones.</p>'}
      <div class="row"><button type="button" data-throne="${key}" ${h.champion ? '' : 'disabled'}>Retar al trono con ella</button><button type="button" data-refound="${key}">Refundar</button></div></section>`;
  }
  function genHTML() {
    const g = S.gen;
    const job = S.jobs[0];
    const running = job && job.status === 'running';
    const sel = (key, list, cur) => `<select data-g="${key}">${list.map(([v, t]) => `<option value="${v}" ${String(cur) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return `<form id="genForm" class="gen" novalidate><h2>Una generación</h2>
      <div class="gen-grid">
        <fieldset><legend>1. Entreno cruzado</legend><p class="explain">Cada campeona entrena contra la campeona de la otra casa.</p>
          <div class="ctl"><label>Partidas</label><div class="ctl-in"><input class="numin mono" type="number" min="1" step="1" value="${esc(g.games)}" data-g="games" aria-label="Partidas del entreno"></div></div>
          <div class="ctl"><label>Velocidad</label><div class="ctl-in">${sel('trainSpeed', [['turbo', 'turbo'], ['x10', 'x10'], ['x1', 'x1']], g.trainSpeed)}</div></div>
          <div class="ctl"><label>Soldados</label><div class="ctl-in">${sel('soldiers', [['random', 'al azar'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], g.soldiers)}</div></div></fieldset>
        <fieldset><legend>2. Cría y relevo</legend><p class="explain">Cada casa cría hijos de su campeona; la mejor del pre-torneo (contra la campeona rival) reta a su madre y, si le gana, la releva.</p>
          <div class="ctl"><label>Hijos</label><div class="ctl-in"><input class="numin mono" type="number" min="1" max="16" step="1" value="${esc(g.n)}" data-g="n" aria-label="Hijos por casa"></div></div>
          <div class="ctl"><label>Pre-torneo</label><div class="ctl-in"><input class="numin mono" type="number" min="0" max="20" step="1" value="${esc(g.ptGames)}" data-g="ptGames" aria-label="Partidas del pre-torneo"></div></div></fieldset>
        <fieldset><legend>3. Duelo entre casas</legend><p class="explain">La casa que gana suma una generación; con empate, ninguna.</p>
          <div class="ctl"><label>Aprendizaje</label><div class="ctl-in">${sel('learning', [['mix', 'mixto'], ['frozen', 'congelado'], ['hot', 'en caliente']], g.learning)}</div></div>
          <div class="ctl"><label>Velocidad</label><div class="ctl-in">${sel('duelSpeed', [['turbo', 'turbo'], ['x10', 'x10'], ['x1', 'x1']], g.duelSpeed)}</div></div></fieldset>
      </div>
      <p class="bad" id="genErr" role="alert"></p>
      ${job ? `<p class="gen-progress"><b>Generación ${esc(job.id)}</b> ${esc(STATUS[job.status] || job.status)} · paso <span class="mono">${job.progress ? `${job.progress.done} de ${job.progress.total}` : '—'}</span>${job.error ? ` · <span class="bad">${esc(job.error)}</span>` : ''}</p><div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${job.progress ? job.progress.total : 6}" aria-valuenow="${job.progress ? job.progress.done : 0}"><i style="width:${job.progress && job.progress.total ? Math.round(job.progress.done / job.progress.total * 100) : 0}%"></i></div>` : ''}
      <button type="submit" class="primary" ${running ? 'disabled' : ''}>Criar una generación</button></form>`;
  }
  function storyHTML() {
    return `<section class="card" aria-labelledby="hStory"><h2 id="hStory">Relato de las casas</h2>${S.story.length ? `<ol class="story">${S.story.slice(0, 40).map((e) => `<li><span>${esc(e.text)}</span><span class="dim mono">registro ${e.refs.map((r) => esc(r.log ?? r.id)).join(', ')}</span></li>`).join('')}</ol>` : '<p class="empty">Todavía no ha pasado nada en las casas.</p>'}</section>`;
  }
  function render() {
    const founded = S.houses.A && S.houses.B;
    const main = !founded ? foundHTML() : S.refound ? `${foundHTML(S.refound)}` : `<div class="houses-row">${houseHTML('A')}<span class="vs" aria-hidden="true">contra</span>${houseHTML('B')}</div>${genHTML()}`;
    patch(root, `<div class="thr-main">${main}</div><aside class="thr-side">${storyHTML()}</aside>`);
  }

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.fd) { const [h, k] = el.dataset.fd.split('.'); S.found[h][k] = el.value; return; }
    if (el.dataset.g) S.gen[el.dataset.g] = el.value;
  });
  root.addEventListener('input', (ev) => { const el = ev.target; if (el.dataset.fd) { const [h, k] = el.dataset.fd.split('.'); S.found[h][k] = el.value; } });
  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.target.id === 'foundForm') {
      const house = ev.target.dataset.house || null;
      const other = house ? (S.houses[house === 'A' ? 'B' : 'A'] || {}).champion : null;
      const { body, errors } = Y.foundBody(S.found, house, other);
      root.querySelector('#fdErr').textContent = errors.join(' ');
      if (!body) return;
      const r = await api(`/api/lab/dynasties${house ? `?house=${house}` : ''}`, 'POST', body);
      if (!r.ok) { root.querySelector('#fdErr').textContent = reasonOf(r); return; }
      S.refound = null;
      toast(house ? `Casa ${house} refundada.` : 'Casas fundadas.');
      await loadAll();
      return;
    }
    if (ev.target.id === 'genForm') {
      const { body, errors } = Y.generationBody(S.gen);
      root.querySelector('#genErr').textContent = errors.join(' ');
      if (!body) return;
      const r = await api('/api/lab/dynasties/generation', 'POST', body);
      if (!r.ok) { root.querySelector('#genErr').textContent = reasonOf(r); return; }
      toast(`Generación en marcha (trabajo ${r.body.jobId}).`);
      await loadAll();
    }
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.refound) { S.refound = b.dataset.refound; render(); return; }
    if (b.dataset.act === 'cancel') { S.refound = null; render(); return; }
    if (b.dataset.throne) {
      const r = await api(`/api/lab/dynasties/${b.dataset.throne}/challenge-throne`, 'POST', S.ch);
      if (!r.ok) { toast(reasonOf(r), 'error'); return; }
      toast(r.body.duelId ? `Reto al trono en marcha (duelo ${r.body.duelId}); síguelo en Trono y duelos.` : 'La campeona se sienta en el trono.');
      refresh();
    }
  });

  return {
    async start() {
      await loadAll();
      if (es) return;
      es = [hub.on(LAB_EVENTS, 'job', (j) => { if (j.kind === 'generation') refresh(); }), ...['dynasty', 'throne'].map((k) => hub.on(LAB_EVENTS, k, refresh))];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } clearTimeout(timer); },
  };
}
