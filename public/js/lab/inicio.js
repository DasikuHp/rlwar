// Inicio del laboratorio (parte 4, spec/prompt-opus-ui.md §3.1): tus redes, el trono con su reina, los últimos retos,
// las casas y lo que está en marcha. Todo sale de la API (/nets, /throne) y del SSE global (spec/08 §6), que actualiza
// en sitio: al llegar un evento se vuelven a pedir los datos, nada se calcula a ojo.
import * as H from './home.js';
import { emblemSVG } from './emblem.js';
import { api } from './api.js';
import { hub } from '../ui/sse.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)
import { tutorialSteps } from './whatif.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const STATUS = { queued: 'en cola', running: 'en marcha', paused: 'en pausa', done: 'terminado', stopped: 'parado', error: 'con error' };
const JOB = { children: 'Hijos', generation: 'Generación de las casas', exam: 'Boletín' };
const LIVE = new Set(['queued', 'running', 'paused']);

export function mountHome(root) {
  const S = { nets: [], throne: null, trainings: [], live: { trainings: [], jobs: [], duels: [] }, loaded: false, error: null };
  let es = null, timer = null;
  const nameOf = (id) => { const n = S.nets.find((x) => x.id === id); return n ? n.name : id; };

  async function load() {
    const [n, t, tr] = await Promise.all([api('/api/lab/nets'), api('/api/lab/throne'), api('/api/lab/trainings')]);
    if (tr.ok) S.trainings = tr.body.trainings;
    S.error = !n.ok ? n.body && n.body.error : !t.ok ? t.body && t.body.error : null;
    if (n.ok) S.nets = n.body.nets;
    if (t.ok) S.throne = t.body;
    S.loaded = true;
    render();
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  const upsert = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item); };

  function netsTable() {
    const rows = H.netRows(S.nets);
    if (!rows.length) return `<p class="empty">Aún no tienes redes. <a href="#editor">Crea la primera en el editor</a> desde una plantilla.</p>`;
    return `<table class="nets-table">
      <thead><tr><th scope="col">Red</th><th scope="col" class="num">Gen.</th><th scope="col" class="num">Pesos</th><th scope="col" class="num">Partidas</th><th scope="col" class="num">Victorias</th><th scope="col" class="num">Tasa</th><th scope="col" class="num">Bajas / muertes</th><th scope="col">Estado</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <th scope="row"><span class="cell-net"><span class="em" aria-hidden="true">${emblemSVG(r.emblem, 28)}</span><span><b>${esc(r.name)}</b><span class="mono dim">${esc(r.id)}</span></span></span></th>
        <td class="num">${r.generation}</td><td class="num">${(r.paramCount ?? 0).toLocaleString('es-ES')}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${pct(r.winRate)}</td><td class="num">${r.kills} / ${r.deaths}</td>
        <td>${r.tags.map((t) => `<span class="tag ${t === 'reina' ? 'queen' : t === 'entrenando' ? 'busy' : t === 'no puede jugar' ? 'bad' : ''}">${esc(t)}</span>`).join(' ')}</td>
        <td><a class="btn small" href="#editor/${esc(r.id)}">Editar</a></td></tr>`).join('')}</tbody></table>`;
  }
  function throneCard() {
    const r = H.reignOf(S.throne);
    const hof = (S.throne && S.throne.hallOfFame) || [];
    const queenNet = r && S.nets.find((n) => n.id === r.queen);
    const head = r
      ? `<div class="queen"><span class="em-big" aria-hidden="true">${queenNet ? emblemSVG(queenNet.emblem, 72) : ''}</span>
          <div><p class="label">Reina</p><p class="queen-name">${esc(r.queenName || nameOf(r.queen))}</p><p class="dim">en el trono desde hace ${esc(H.duration(r.ms))}</p></div></div>
        <dl class="facts"><div><dt>Reinado</dt><dd>${r.number}.º</dd></div><div><dt>Defensas</dt><dd>${r.defenses}</dd></div><div><dt>Retos ganados</dt><dd>${r.won}</dd></div><div><dt>Retos perdidos</dt><dd>${r.lost}</dd></div></dl>`
      : '<p class="empty">Aún no hay reina. La primera red que rete al trono se sienta en él sin duelo.</p>';
    const hall = hof.length ? `<p class="hall"><b>Sala de la fama</b> ${hof.map((h) => esc(nameOf(h.netId))).join(', ')} <span class="dim">(copias congeladas de ex-reinas)</span></p>` : '';
    return `<section class="card throne-card" aria-labelledby="hTrono"><h2 id="hTrono">El trono</h2>${head}${hall}</section>`;
  }
  function challengesCard() {
    const list = H.lastChallenges(S.throne, 6);
    return `<section class="card" aria-labelledby="hRetos"><h2 id="hRetos">Últimos retos</h2>${list.length ? `<ol class="chal">${list.map((c) => `<li class="r-${esc(c.result)}"><span><b>${esc(nameOf(c.challenger))}</b> reta a <b>${esc(nameOf(c.queen))}</b></span><span>${esc(c.text)}</span><span class="dim">hace ${esc(H.duration(Date.now() - c.ts))}</span></li>`).join('')}</ol>` : '<p class="empty">Todavía no ha habido retos.</p>'}</section>`;
  }
  function housesCard() {
    const hs = H.housesOf(S.throne);
    return `<section class="card" aria-labelledby="hCasas"><h2 id="hCasas">Casas</h2><ul class="houses">${hs.map((h) => `<li><span class="house-key">${h.key}</span>${h.name ? `<span><b>${esc(h.name)}</b><span class="dim">campeona: ${h.champion ? esc(nameOf(h.champion)) : 'ninguna'}</span></span>` : '<span class="dim">sin fundar</span>'}</li>`).join('')}</ul></section>`;
  }
  function liveCard() {
    const tr = S.live.trainings.filter((t) => LIVE.has(t.status));
    const jobs = S.live.jobs.filter((j) => LIVE.has(j.status));
    const duels = S.live.duels.filter((d) => LIVE.has(d.status));
    const items = [
      ...tr.map((t) => `<li><b>Entreno ${esc(t.id)}</b> de ${esc(nameOf(t.netId))}<span>${esc(STATUS[t.status] || t.status)}</span><span class="mono">${t.games ?? 0} partidas · ${t.updates ?? 0} sueños</span></li>`),
      ...jobs.map((j) => `<li><b>${esc(JOB[j.kind] || j.kind)} ${esc(j.id)}</b>${j.netId ? ` de ${esc(nameOf(j.netId))}` : ''}<span>${esc(STATUS[j.status] || j.status)}</span><span class="mono">${j.progress ? `${j.progress.done} de ${j.progress.total}` : ''}</span></li>`),
      ...duels.map((d) => `<li><b>Duelo ${esc(d.id)}</b> ${esc(nameOf(d.a))} contra ${esc(nameOf(d.b))}<span>${esc(STATUS[d.status] || d.status)}</span><span class="mono">${(d.games || []).length} partidas${d.liveRoom ? ` · <a href="/#room=${esc(d.liveRoom)}">ver la sala ${esc(d.liveRoom)}</a>` : ''}</span></li>`),
    ];
    return `<section class="card" aria-labelledby="hLive"><h2 id="hLive">En marcha</h2>${items.length ? `<ul class="live">${items.join('')}</ul>` : '<p class="empty">Nada en marcha ahora mismo.</p>'}</section>`;
  }
  // primeros pasos (plan2 ronda 4): cada uno se marca hecho cuando los datos lo dicen
  function stepsCard() {
    const steps = tutorialSteps({ nets: S.nets, trainings: S.trainings, throne: S.throne || {} });
    const left = steps.filter((x) => !x.done).length;
    const list = `<ol class="steps">${steps.map((x) => `<li class="${x.done ? 'done' : ''}"><span class="chk" aria-label="${x.done ? 'hecho' : 'pendiente'}">${x.done ? '✓' : ''}</span><a href="${x.href}">${esc(x.title)}</a><p>${esc(x.text)}</p></li>`).join('')}</ol>`;
    return `<section class="card" aria-labelledby="hSteps"><h2 id="hSteps">Primeros pasos <span class="dim">${left ? `${steps.length - left} de ${steps.length}` : 'hechos'}</span></h2>${left ? list : ''}</section>`;
  }
  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="loading">Cargando el laboratorio…</p>'; return; }
    root.innerHTML = `
      <section class="home-nets" aria-labelledby="hRedes">
        <div class="sec-head"><h1 id="hRedes">Tus redes <span class="dim">${S.nets.length}</span></h1><a class="btn primary" href="#editor">Abrir el editor</a></div>
        ${S.error ? `<p class="bad">${esc(S.error)}</p>` : ''}
        ${netsTable()}
      </section>
      <aside class="home-side">${stepsCard()}${throneCard()}${challengesCard()}${housesCard()}${liveCard()}</aside>`;
  }

  return {
    async start() {
      render();
      await load();
      if (es) return;
      es = [
        hub.on(LAB_EVENTS, 'hello', (d) => { S.live = { trainings: d.trainings || [], jobs: d.jobs || [], duels: d.duels || [] }; render(); }),
        hub.on(LAB_EVENTS, 'training', (d) => { upsert(S.live.trainings, d); refresh(); }),
        hub.on(LAB_EVENTS, 'job', (d) => { upsert(S.live.jobs, d); refresh(); }),
        hub.on(LAB_EVENTS, 'duel', async (d) => {
          const rec = d.result || (d.id ? (await api(`/api/lab/duels/${encodeURIComponent(d.id)}`)).body : null); // cada partida: el registro entero
          if (rec && rec.id) upsert(S.live.duels, rec);
          refresh();
        }),
        ...['throne', 'dynasty', 'exam', 'milestone'].map((k) => hub.on(LAB_EVENTS, k, refresh)),
      ];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } clearTimeout(timer); },
    reload: load,
  };
}
