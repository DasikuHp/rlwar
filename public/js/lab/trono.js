// Trono y duelos (parte 4, spec/prompt-opus-ui.md §3.1; spec/06): la reina frente a la retadora, el reto al trono
// ("quien defiende gana los empates"), duelos libres 3 mapas × 2 lados con su marcador en vivo, la sala de la fama y
// el árbol genealógico. Todo sale de /throne, /duels, /hall-of-fame y /genealogy; el SSE actualiza en sitio.
import * as D from './duels.js';
import * as H from './home.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { hub } from '../ui/sse.js';
import { patch } from '../ui/patch.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEARN = [
  ['mix', 'mixto', 'aprenden un poco tras cada partida (tasa × 0,25) y repasan las 6 al final'],
  ['frozen', 'congelado', 'no aprenden durante el duelo; al acabar, repasan las 6 partidas'],
  ['hot', 'en caliente', 'aprenden de verdad tras cada partida'],
];
const SPEED = [['turbo', 'turbo', 'sin pantalla: el marcador al instante'], ['x10', 'x10', 'salas visibles a 10 veces la velocidad'], ['x1', 'x1', 'salas normales, con bocadillos']];
const STATUS = { running: 'en juego', done: 'terminado', stopped: 'parado', error: 'con error' };

export function mountThrone(root, { toast, settings = null }) {
  // la velocidad que sale marcada es la de Ajustes ("Velocidad de duelos y retos"); si la cambias allí, cambia aquí
  const speed0 = () => (settings && ['turbo', 'x10', 'x1'].includes(settings.speed) ? settings.speed : 'turbo');
  const S = { nets: [], throne: null, duels: [], genealogy: null, sel: null, ch: { challenger: '', learning: 'mix', speed: speed0() }, duel: { a: '', b: '', learning: 'mix', speed: speed0(), soldiers: 'random', seed: '' } };
  let es = null, timer = null;
  if (typeof window !== 'undefined') window.addEventListener('gw:settings', (e) => { if (e.detail && e.detail.key === 'speed') { S.ch.speed = speed0(); S.duel.speed = speed0(); render(); } });
  const net = (id) => S.nets.find((n) => n.id === id);
  const nameOf = (id) => (net(id) ? net(id).name : id);

  async function loadAll() {
    const [n, t, d, g] = await Promise.all([api('/api/lab/nets'), api('/api/lab/throne'), api('/api/lab/duels'), api('/api/lab/genealogy')]);
    if (n.ok) S.nets = n.body.nets;
    if (t.ok) S.throne = t.body;
    if (d.ok) S.duels = d.body.duels.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    if (g.ok) S.genealogy = g.body;
    if (!S.sel && S.duels.length) S.sel = S.duels[0].id;
    if (S.throne && S.ch.challenger === S.throne.queen) S.ch.challenger = ''; // ya reina: deja de ser retadora
    render();
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadAll, 300); };

  const seg = (name, list, cur, key) => `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${list.map(([v, t, e]) => `<label><input type="radio" name="${esc(key)}" value="${v}" data-k="${esc(key)}" ${cur === v ? 'checked' : ''}><b>${t}</b><small>${e}</small></label>`).join('')}</div>`;
  const netOptions = (cur, except = []) => `<option value="">elige una red…</option>${S.nets.filter((n) => !except.includes(n.id)).map((n) => `<option value="${esc(n.id)}" ${n.id === cur ? 'selected' : ''}>${esc(n.name)}${n.training ? ' (entrenando)' : ''}</option>`).join('')}`;
  const card = (id, label, facts) => {
    const n = id && net(id);
    return `<div class="duelist ${label === 'Reina' ? 'is-queen' : ''}"><p class="label">${label}</p>${n ? `<span class="em-big" aria-hidden="true">${emblemSVG(n.emblem, 84)}</span><p class="queen-name"><button type="button" class="link" data-ficha="${esc(n.id)}" title="Abrir su ficha">${esc(n.name)}</button></p>` : `<p class="dim">${label === 'Reina' ? 'Trono vacío' : 'Elige una retadora'}</p>`}${facts}</div>`;
  };

  function throneHTML() {
    const r = H.reignOf(S.throne);
    const qFacts = r ? `<dl class="facts"><div><dt>Reinado</dt><dd>${r.number}.º</dd></div><div><dt>Defensas</dt><dd>${r.defenses}</dd></div><div><dt>Desde hace</dt><dd class="small">${esc(H.duration(r.ms))}</dd></div></dl>` : '';
    const c = S.ch.challenger && net(S.ch.challenger);
    const s = c && c.stats ? c.stats : null;
    const cFacts = s ? `<dl class="facts"><div><dt>Partidas</dt><dd>${s.games}</dd></div><div><dt>Victorias</dt><dd>${s.wins}</dd></div><div><dt>Tasa</dt><dd>${s.games ? `${Math.round(s.wins / s.games * 100)} %` : '—'}</dd></div></dl>` : '';
    return `<section class="throne-hero" aria-labelledby="hThr"><h1 id="hThr">El trono</h1>
      <div class="vs-row">${card(r && r.queen, 'Reina', qFacts)}<span class="vs" aria-hidden="true">contra</span>${card(S.ch.challenger, 'Retadora', cFacts)}</div>
      <form id="chForm" class="ch-form" novalidate>
        <div class="ctl"><label for="ch-net">Retadora</label><div class="ctl-in"><select id="ch-net" data-c="challenger">${netOptions(S.ch.challenger, r ? [r.queen] : [])}</select></div></div>
        ${r ? `${seg('Aprendizaje durante el duelo', LEARN, S.ch.learning, 'ch-learning')}${seg('Velocidad', SPEED, S.ch.speed, 'ch-speed')}
        <p class="rule">Duelo de 3 mapas × 2 lados. Si hay empate, la reina conserva el trono.</p>` : '<p class="rule">Sin reina, la retadora se sienta en el trono sin duelo.</p>'}
        <p class="bad" id="chErr" role="alert"></p>
        <button type="submit" class="primary">${r ? 'Retar al trono' : 'Sentarla en el trono'}</button>
      </form></section>`;
  }
  function duelsHTML() {
    const list = S.duels.length ? `<ul class="tr-list">${S.duels.map((d) => `<li><button type="button" data-duel="${esc(d.id)}" class="${d.id === S.sel ? 'on' : ''}"><b>${esc(nameOf(d.a))} contra ${esc(nameOf(d.b))}</b><span class="st st-${esc(d.status)}">${esc(STATUS[d.status] || d.status)}${d.throne ? ' · reto al trono' : ''}</span><span class="mono dim">${esc(d.speed)} · ${esc(d.learning)}</span></button></li>`).join('')}</ul>` : '<p class="empty">Aún no ha habido duelos.</p>';
    const d = S.duels.find((x) => x.id === S.sel);
    let board = '';
    if (d) {
      const sb = D.scoreboard(d);
      const cell = (g) => {
        if (!g) return '<td class="pending">pendiente</td>';
        const w = g.winner ? `gana ${esc(nameOf(g.winner))}` : 'empate';
        return `<td class="${g.winner === d.a ? 'win-a' : g.winner === d.b ? 'win-b' : 'draw'}"><b>${w}</b><span class="mono dim">${esc(nameOf(g.left))} a la izquierda · bajas ${Object.entries(g.kills || {}).map(([k, v]) => `${esc(nameOf(k))} ${v}`).join(', ')}</span>${g.roomCode ? `<a href="/#room=${esc(g.roomCode)}">sala ${esc(g.roomCode)}</a>` : ''}<span class="mono dim">${esc(g.gameId || '')}</span></td>`;
      };
      board = `<div class="board-3x2"><table><caption>${esc(nameOf(d.a))} contra ${esc(nameOf(d.b))}${d.liveRoom ? ` · <a href="/#room=${esc(d.liveRoom)}">verlo en vivo (sala ${esc(d.liveRoom)})</a>` : ''}</caption>
        <thead><tr><th scope="col">Mapa</th><th scope="col">${esc(nameOf(d.a))} a la izquierda</th><th scope="col">${esc(nameOf(d.b))} a la izquierda</th></tr></thead>
        <tbody>${sb.maps.map((m, i) => `<tr><th scope="row">${i + 1}<span class="mono dim">${m.soldiers ? ` · ${m.soldiers} por bando` : ''}</span></th>${cell(m.games[0])}${cell(m.games[1])}</tr>`).join('')}</tbody></table>
        <p class="score"><b class="mono">${esc(nameOf(d.a))} ${sb.wins ? sb.wins[d.a] ?? 0 : 0}</b> · <b class="mono">${esc(nameOf(d.b))} ${sb.wins ? sb.wins[d.b] ?? 0 : 0}</b> · diferencia de bajas <span class="mono">${sb.killDiff > 0 ? '+' : ''}${sb.killDiff ?? 0}</span> · ${d.status === 'running' ? `${sb.played} de 6 jugadas` : sb.tie ? 'empate' : sb.winner ? `gana ${esc(nameOf(sb.winner))}` : ''}</p>
        ${d.status === 'running' ? `<button type="button" class="danger" data-stop="${esc(d.id)}">Parar el duelo</button>` : ''}</div>`;
    }
    return `<section aria-labelledby="hDuels" id="thrDuels"><h2 id="hDuels">Duelos</h2>${list}${board}</section>`;
  }
  function freeDuelHTML() {
    const f = S.duel;
    return `<section class="card" aria-labelledby="hFree"><h2 id="hFree">Duelo libre</h2>
      <form id="duelForm" novalidate>
        <div class="ctl"><label for="du-a">Una</label><div class="ctl-in"><select id="du-a" data-d="a">${netOptions(f.a)}</select></div></div>
        <div class="ctl"><label for="du-b">Otra</label><div class="ctl-in"><select id="du-b" data-d="b">${netOptions(f.b, [f.a])}</select></div></div>
        ${seg('Aprendizaje', LEARN, f.learning, 'du-learning')}${seg('Velocidad', SPEED, f.speed, 'du-speed')}
        <div class="ctl"><label for="du-s">Soldados</label><div class="ctl-in"><select id="du-s" data-d="soldiers">${[['random', 'al azar por mapa (1 a 4)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']].map(([v, t]) => `<option value="${v}" ${String(f.soldiers) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        <p class="hint">Cuenta para la liga (a quién le gana cada red), no para el trono.</p>
        <p class="bad" id="duErr" role="alert"></p><button type="submit">Empezar el duelo</button></form></section>`;
  }
  function hallHTML() {
    const rows = D.hallRows(S.throne && S.throne.hallOfFame);
    return `<section class="card" aria-labelledby="hHall"><h2 id="hHall">Sala de la fama</h2>${rows.length ? `<ol class="hall-list">${rows.map((h) => `<li><span class="em" aria-hidden="true">${net(h.netId) ? emblemSVG(net(h.netId).emblem, 28) : ''}</span><span><b>${esc(nameOf(h.netId))}</b><span class="dim">reinado ${h.reign}.º · ${h.games} partidas en el trono</span></span></li>`).join('')}</ol><p class="hint">Copias congeladas tal como eran al perder el trono: rivales de los entrenos para no olvidar estilos antiguos.</p>` : '<p class="empty">Ninguna reina ha perdido aún el trono.</p>'}</section>`;
  }
  function treeHTML() {
    const flat = D.flattenTree(D.genealogyTree(S.genealogy));
    const queen = S.throne && S.throne.queen;
    return `<section class="card" aria-labelledby="hTree"><h2 id="hTree">Árbol genealógico</h2>${flat.length ? `<ul class="tree">${flat.map((n) => `<li style="--d:${n.depth}"><span class="em" aria-hidden="true">${net(n.id) ? emblemSVG(net(n.id).emblem, 20) : ''}</span>${net(n.id) ? `<button type="button" class="link" data-ficha="${esc(n.id)}" data-ficha-tab="familia"><b>${esc(nameOf(n.id))}</b></button>` : `<b>${esc(nameOf(n.id))}</b>`}<span class="dim mono">gen ${n.generation}</span>${n.id === queen ? '<span class="tag queen">reina</span>' : ''}${n.marks.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</li>`).join('')}</ul>` : '<p class="empty">Sin redes.</p>'}</section>`;
  }
  function render() {
    patch(root, `<div class="thr-main">${throneHTML()}${duelsHTML()}</div><aside class="thr-side">${freeDuelHTML()}${hallHTML()}${treeHTML()}</aside>`);
  }
  // el marcador en vivo: con el parche del DOM, repintar todo no quita el foco a los formularios
  const renderDuels = () => render();

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.c) { S.ch[el.dataset.c] = el.value; render(); return; }
    if (el.dataset.d) { S.duel[el.dataset.d] = el.value; if (el.dataset.d === 'a') render(); return; }
    if (el.dataset.k) {
      const [who, key] = el.dataset.k.split('-');
      (who === 'ch' ? S.ch : S.duel)[key] = el.value;
    }
  });
  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.target.id === 'chForm') {
      const { body, errors } = D.challengeBody(S.ch);
      root.querySelector('#chErr').textContent = errors.join(' ');
      if (!body) return;
      const r = await api('/api/lab/throne/challenge', 'POST', body);
      if (!r.ok) { root.querySelector('#chErr').textContent = reasonOf(r); return; }
      toast(r.body.result === 'seated' ? `${nameOf(body.challenger)} se sienta en el trono.` : `Reto en marcha (duelo ${r.body.duelId}).`);
      if (r.body.duelId) S.sel = r.body.duelId;
      await loadAll();
      return;
    }
    if (ev.target.id === 'duelForm') {
      const { body, errors } = D.duelBody(S.duel);
      root.querySelector('#duErr').textContent = errors.join(' ');
      if (!body) return;
      const r = await api('/api/lab/duels', 'POST', body);
      if (!r.ok) { root.querySelector('#duErr').textContent = reasonOf(r); return; }
      toast(`Duelo ${r.body.id} en marcha.`);
      S.sel = r.body.id;
      await loadAll();
    }
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.duel) { S.sel = b.dataset.duel; renderDuels(); return; }
    if (b.dataset.stop) { const r = await api(`/api/lab/duels/${encodeURIComponent(b.dataset.stop)}/stop`, 'POST', {}); if (!r.ok) toast(reasonOf(r), 'error'); refresh(); }
  });

  return {
    async start() {
      await loadAll();
      if (es) return;
      es = [hub.on(LAB_EVENTS, 'duel', async (d) => {
        const rec = d.result || (d.id ? (await api(`/api/lab/duels/${encodeURIComponent(d.id)}`)).body : null);
        if (rec && rec.id) { const i = S.duels.findIndex((x) => x.id === rec.id); if (i >= 0) S.duels[i] = rec; else S.duels.unshift(rec); renderDuels(); }
        if (d.result) refresh();
      }), ...['throne', 'dynasty'].map((k) => hub.on(LAB_EVENTS, k, refresh))];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } clearTimeout(timer); },
  };
}
