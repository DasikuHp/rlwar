// Entreno (parte 4, spec/prompt-opus-ui.md §3.1; spec/04 §6 y §9.6): lanzar un entreno con su mezcla de rivales,
// velocidad y duración, y seguirlo en vivo: recompensa media y tasa de victorias (dos gráficas, un eje cada una),
// los sueños sobre el eje de partidas, la última lección, pausa/seguir/parar y las salas x1/x10 para espectar.
import * as T from './training.js';
import * as M from './model.js';
import { api, reasonOf } from './api.js';
import { hub } from '../ui/sse.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (v) => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—');
const STATUS = { queued: 'en cola', running: 'entrenando', paused: 'en pausa', done: 'terminado', stopped: 'parado', error: 'con error' };
const RIVAL = { antagonist: 'antagonista', hallOfFame: 'sala de la fama', self: 'ella misma', ghost: 'fantasma', milestone: 'hito propio' };
const LIVE = new Set(['queued', 'running', 'paused']);
const WINDOW = 20;
const SERIES = '#259bcc'; // validado (dataviz): banda de luminosidad y contraste sobre el panel oscuro
const LS = 'gw.lab.level';

// campos del formulario con su explicación (spec/04 §6); el nivel decide cuáles se ven, nada se bloquea
const FIELDS = {
  antagonist: { name: 'Antagonista', level: 'aprendiz', explain: 'La red a la que se enfrenta: la reina, o la que elijas como rival fijo.' },
  hallOfFame: { name: 'Sala de la fama', level: 'aprendiz', explain: 'Ex-reinas e hitos propios: evita que olvide cómo ganar a estilos antiguos.' },
  self: { name: 'Ella misma', level: 'aprendiz', explain: 'Una copia congelada del principio del lote: da estabilidad.' },
  antagonistId: { name: 'Rival fijo', level: 'artesano', explain: 'Si eliges una red, el antagonista es siempre ella (si no, la reina).' },
  hard: { name: 'Dureza', level: 'cientifico', explain: 'Cuánto se sortean las ex-reinas que aún le ganan: peso = (1 − tasa de victorias contra ella)^dureza.' },
  ghost: { name: 'Partidas fantasma', level: 'artesano', explain: 'Probabilidad de repetir contra una ex-reina a la que ha perdido en las últimas 20.' },
  workers: { name: 'Hilos', level: 'artesano', explain: 'Partidas en paralelo (solo en turbo).' },
  seed: { name: 'Semilla', level: 'cientifico', explain: 'Misma semilla, mismo entreno. Vacía: una al azar.' },
  exploiter: { name: 'Retadora explotadora', level: 'artesano', explain: 'Solo juega contra la reina, para encontrar sus puntos débiles.' },
};

export function mountTraining(root, { toast }) {
  const S = { nets: [], trainings: [], sel: null, detail: null, form: null, table: false, hover: null, learning: null };
  let es = null, timer = null;
  const level = () => { try { return JSON.parse(localStorage.getItem(LS)) || 'aprendiz'; } catch { return 'aprendiz'; } };
  const nameOf = (id) => { const n = S.nets.find((x) => x.id === id); return n ? n.name : id; };
  const defaults = () => ({ netId: '', mix: { antagonist: 0.6, hallOfFame: 0.25, self: 0.15 }, antagonistId: '', hard: 2, ghost: 0, speed: 'turbo', workers: 4, durationKind: 'games', games: 200, minutes: 10, window: 50, minGain: 0.02, soldiers: 'random', seed: '', exploiter: false });

  async function loadAll() {
    const [n, t] = await Promise.all([api('/api/lab/nets'), api('/api/lab/trainings')]);
    if (n.ok) S.nets = n.body.nets;
    if (t.ok) S.trainings = t.body.trainings.slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    if (!S.sel && S.trainings.length) S.sel = S.trainings[0].id;
    if (S.sel) await loadDetail(S.sel);
    render();
  }
  async function loadDetail(id) {
    const r = await api(`/api/lab/trainings/${encodeURIComponent(id)}`);
    S.detail = r.ok ? r.body : null;
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadAll, 400); };
  // aprendizaje de la red elegida: para decir cuántos hilos se usan de verdad (M12)
  async function loadLearning(id) { S.learning = null; if (!id) return; const r = await api(`/api/lab/nets/${encodeURIComponent(id)}`); if (S.form.netId === id) S.learning = r.ok ? r.body.genome.learning : null; }

  // ---------- formulario ----------
  const show = (k) => M.atLevel(FIELDS[k].level, level());
  function formHTML() {
    const f = S.form;
    const nets = S.nets.filter((n) => !n.training);
    const slider = (k) => `<div class="ctl"><label for="tr-${k}">${FIELDS[k].name}</label><div class="ctl-in"><input id="tr-${k}" type="range" min="0" max="1" step="0.05" value="${f.mix[k]}" data-mix="${k}"><output class="mono">${f2(f.mix[k])}</output></div><p class="explain">${esc(FIELDS[k].explain)}</p></div>`;
    const sum = f.mix.antagonist + f.mix.hallOfFame + f.mix.self;
    return `<form class="tr-form" id="trForm" novalidate>
      <h2>Entrenar una red</h2>
      <div class="ctl"><label for="tr-net">Red</label><div class="ctl-in"><select id="tr-net" data-f="netId"><option value="">elige una red…</option>${nets.map((n) => `<option value="${esc(n.id)}" ${n.id === f.netId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div>
        <p class="explain">Aprende de cada partida que juega, según su método de aprendizaje (se elige en el editor, pestaña Aprendizaje).</p></div>
      <fieldset><legend>Contra quién juega</legend>${slider('antagonist')}${slider('hallOfFame')}${slider('self')}
        <p class="hint">Se reparten en proporción: ahora ${sum > 0 ? `${Math.round(f.mix.antagonist / sum * 100)} % · ${Math.round(f.mix.hallOfFame / sum * 100)} % · ${Math.round(f.mix.self / sum * 100)} %` : 'nadie'}. Nunca contra los heurísticos.</p>
        ${show('antagonistId') ? `<div class="ctl"><label for="tr-ant">${FIELDS.antagonistId.name}</label><div class="ctl-in"><select id="tr-ant" data-f="antagonistId"><option value="">la reina</option>${S.nets.filter((n) => n.id !== f.netId).map((n) => `<option value="${esc(n.id)}" ${n.id === f.antagonistId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div><p class="explain">${esc(FIELDS.antagonistId.explain)}</p></div>` : ''}
        ${show('ghost') ? `<div class="ctl"><label for="tr-ghost">${FIELDS.ghost.name}</label><div class="ctl-in"><input id="tr-ghost" class="numin mono" type="number" min="0" max="1" step="0.05" value="${f.ghost}" data-f="ghost"></div><p class="explain">${esc(FIELDS.ghost.explain)}</p></div>` : ''}
        ${show('hard') ? `<div class="ctl"><label for="tr-hard">${FIELDS.hard.name}</label><div class="ctl-in"><input id="tr-hard" class="numin mono" type="number" min="0" max="10" step="0.5" value="${f.hard}" data-f="hard"></div><p class="explain">${esc(FIELDS.hard.explain)}</p></div>` : ''}
        ${show('exploiter') ? `<label class="check"><input type="checkbox" data-f="exploiter" ${f.exploiter ? 'checked' : ''}> ${FIELDS.exploiter.name}<span class="explain">${esc(FIELDS.exploiter.explain)}</span></label>` : ''}
      </fieldset>
      <fieldset><legend>Velocidad</legend>
        <div class="seg" role="radiogroup" aria-label="Velocidad">${[['turbo', 'turbo', 'sin pantalla, en hilos; guarda 1 partida de cada 20'], ['x10', 'x10', 'sala visible a 10 veces la velocidad'], ['x1', 'x1', 'sala normal, con bocadillos']].map(([v, t, e]) => `<label><input type="radio" name="tr-speed" value="${v}" data-f="speed" ${f.speed === v ? 'checked' : ''}><b>${t}</b><small>${e}</small></label>`).join('')}</div>
        ${f.speed === 'turbo' && show('workers') ? `<div class="ctl"><label for="tr-w">${FIELDS.workers.name}</label><div class="ctl-in"><input id="tr-w" class="numin mono" type="number" min="1" max="32" step="1" value="${f.workers}" data-f="workers"></div><p class="explain">${esc(FIELDS.workers.explain)}</p></div>` : ''}
        ${(() => { const n = T.threadNote(S.learning, f.workers, f.speed); return n ? `<p class="hint warn-text" role="note">${esc(n.text)}</p>` : ''; })()}
      </fieldset>
      <fieldset><legend>Cuánto</legend>
        <div class="seg" role="radiogroup" aria-label="Duración">${[['games', 'partidas'], ['minutes', 'minutos'], ['plateau', 'hasta que deje de mejorar']].map(([v, t]) => `<label><input type="radio" name="tr-dur" value="${v}" data-f="durationKind" ${f.durationKind === v ? 'checked' : ''}><b>${t}</b></label>`).join('')}</div>
        ${f.durationKind === 'games' ? `<div class="ctl"><label for="tr-g">Partidas</label><div class="ctl-in"><input id="tr-g" class="numin mono" type="number" min="1" step="1" value="${f.games}" data-f="games"></div></div>` : ''}
        ${f.durationKind === 'minutes' ? `<div class="ctl"><label for="tr-m">Minutos</label><div class="ctl-in"><input id="tr-m" class="numin mono" type="number" min="0.1" step="0.5" value="${f.minutes}" data-f="minutes"></div></div>` : ''}
        ${f.durationKind === 'plateau' ? `<div class="ctl"><label for="tr-win">Ventana</label><div class="ctl-in"><input id="tr-win" class="numin mono" type="number" min="1" step="1" value="${f.window}" data-f="window"></div><p class="explain">Para cuando la recompensa media no sube en tantas partidas…</p></div><div class="ctl"><label for="tr-gain">Mejora mínima</label><div class="ctl-in"><input id="tr-gain" class="numin mono" type="number" step="0.01" value="${f.minGain}" data-f="minGain"></div><p class="explain">…al menos esto.</p></div>` : ''}
        <p class="hint">Siempre se puede parar a mano y lo aprendido se guarda.</p>
      </fieldset>
      <div class="ctl"><label for="tr-sold">Soldados por bando</label><div class="ctl-in"><select id="tr-sold" data-f="soldiers">${[['random', 'al azar (1 a 4)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']].map(([v, t]) => `<option value="${v}" ${String(f.soldiers) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      ${show('seed') ? `<div class="ctl"><label for="tr-seed">${FIELDS.seed.name}</label><div class="ctl-in"><input id="tr-seed" class="numin mono" type="number" min="0" step="1" value="${esc(f.seed)}" data-f="seed"></div><p class="explain">${esc(FIELDS.seed.explain)}</p></div>` : ''}
      <p class="bad" id="trErrors" role="alert"></p>
      <button type="submit" class="primary">Empezar a entrenar</button>
    </form>`;
  }

  // ---------- gráficas: recompensa media y tasa de victorias (dos gráficas, un eje cada una) ----------
  function chartHTML(key, title, s, ys, yTicks, fmt) {
    const W = 640, H = 150, L = 44, R = 12, Tp = 10, B = 24;
    const n = s.games.length;
    const x0 = s.games[0] ?? 1, x1 = s.games[n - 1] ?? 1;
    const sx = (x) => L + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * (W - L - R);
    const lo = yTicks[0], hi = yTicks[yTicks.length - 1];
    const sy = (y) => Tp + (1 - (y - lo) / (hi - lo || 1)) * (H - Tp - B);
    const grid = yTicks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${L - 6}" y="${sy(t) + 4}" class="axis" text-anchor="end">${fmt(t)}</text>`).join('');
    const xt = T.niceTicks(x0, x1, 6).filter((t) => t >= x0 && t <= x1 && Number.isInteger(t));
    const xaxis = xt.map((t) => `<text x="${sx(t)}" y="${H - 6}" class="axis" text-anchor="middle">${t}</text>`).join('');
    const sleeps = (S.detail.curve || []).filter((p) => p.loss !== undefined).map((p) => `<line x1="${sx(p.game)}" x2="${sx(p.game)}" y1="${H - B - 4}" y2="${H - B + 6}" class="sleep"><title>soñó tras la partida ${p.game}</title></line>`).join('');
    const path = n ? T.linePath(s.games, ys, sx, sy) : '';
    const last = n ? `<circle cx="${sx(s.games[n - 1])}" cy="${sy(ys[n - 1])}" r="4" fill="${SERIES}" stroke="var(--panel)" stroke-width="2"/><text x="${Math.min(W - R - 2, sx(s.games[n - 1]) + 0)}" y="${sy(ys[n - 1]) - 9}" class="val" text-anchor="end">${fmt(ys[n - 1])}</text>` : '';
    const hv = S.hover !== null && S.hover < n ? `<line x1="${sx(s.games[S.hover])}" x2="${sx(s.games[S.hover])}" y1="${Tp}" y2="${H - B}" class="cross"/><circle cx="${sx(s.games[S.hover])}" cy="${sy(ys[S.hover])}" r="4" fill="${SERIES}" stroke="var(--panel)" stroke-width="2"/>` : '';
    return `<figure class="chart"><figcaption>${esc(title)} <span class="dim">(media de las últimas ${WINDOW} partidas)</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" data-chart="${key}" tabindex="0" data-l="${L}" data-r="${R}" data-w="${W}" data-x0="${x0}" data-x1="${x1}">
        ${grid}${xaxis}${sleeps}<path d="${path}" fill="none" stroke="${SERIES}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${last}${hv}
        <rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}" fill="transparent" class="hit"/>
      </svg></figure>`;
  }
  function tooltipHTML(s) {
    if (S.hover === null) return '';
    const p = S.detail.curve[S.hover];
    if (!p) return '';
    return `<div class="tip" role="status"><b class="mono">partida ${p.game}</b>
      <span><i class="key"></i><b class="mono">${f2(s.rewardAvg[S.hover])}</b> recompensa media · esta partida <span class="mono">${f2(p.reward)}</span></span>
      <span><i class="key"></i><b class="mono">${f2(s.winRate[S.hover])}</b> tasa de victorias · ${p.win ? 'ganó' : 'no ganó'} (bajas ${p.kills ?? 0}, muertes ${p.deaths ?? 0})</span>
      <span class="dim">rival: ${esc(RIVAL[p.rival] || p.rival || '—')}${p.loss !== undefined ? ` · después soñó (pérdida ${f2(p.loss)})` : ''}</span></div>`;
  }
  function detailHTML() {
    const d = S.detail;
    if (!d) return '<p class="empty">Elige un entreno de la lista o empieza uno.</p>';
    const s = T.curveSeries(d.curve || [], WINDOW);
    const rv = s.rewardAvg.length ? T.niceTicks(Math.min(...s.rewardAvg), Math.max(...s.rewardAvg), 4) : [0, 1];
    const rivals = {}; for (const p of d.curve || []) rivals[p.rival] = (rivals[p.rival] || 0) + 1;
    const live = LIVE.has(d.status);
    const lesson = d.lastLesson ? `<p class="lesson ${d.lastLesson.bulb ? 'bulb' : ''}">${d.lastLesson.bulb ? '<span class="bulb-ico" aria-label="bombilla">💡</span>' : ''}Último sueño: lo que más cambió fue ${esc(d.lastLesson.name)} <span class="mono">${esc(d.lastLesson.blockId)}</span> (${esc(String(Math.round(d.lastLesson.relChange * 1000) / 10))} %)</p>` : '';
    const rooms = (d.rooms || []).length ? `<p>Salas para mirar: ${d.rooms.map((c) => `<a href="/#room=${esc(c)}">${esc(c)}</a>`).join(', ')}</p>` : '';
    const samples = (d.sampleGames || []).length ? `<p class="dim">Partidas de muestra guardadas: <span class="mono">${d.sampleGames.slice(-8).map(esc).join(', ')}</span>${d.sampleGames.length > 8 ? ` y ${d.sampleGames.length - 8} más` : ''}</p>` : '';
    const table = S.table ? `<table class="curve-table"><caption class="sr">Últimas partidas del entreno</caption><thead><tr><th>Partida</th><th class="num">Recompensa</th><th class="num">Media</th><th>Ganó</th><th class="num">Tasa</th><th>Rival</th><th class="num">Pérdida del sueño</th></tr></thead><tbody>${(d.curve || []).map((p, i) => ({ p, i })).slice(-50).reverse().map(({ p, i }) => `<tr><td class="mono">${p.game}</td><td class="num">${f2(p.reward)}</td><td class="num">${f2(s.rewardAvg[i])}</td><td>${p.win ? 'sí' : 'no'}</td><td class="num">${f2(s.winRate[i])}</td><td>${esc(RIVAL[p.rival] || p.rival || '—')}</td><td class="num">${p.loss !== undefined ? f2(p.loss) : ''}</td></tr>`).join('')}</tbody></table>` : '';
    return `<div class="tr-head">
        <div><h2>${esc(nameOf(d.netId))} <span class="mono dim">${esc(d.id)}</span></h2>
        <p class="facts-line"><span class="st st-${esc(d.status)}">${esc(STATUS[d.status] || d.status)}</span><span><b class="mono">${d.games}</b> partidas</span><span><b class="mono">${d.updates}</b> sueños</span><span>${esc(d.config ? d.config.speed : '')}</span><span>${Number.isFinite(d.elapsedMs) ? `${Math.round(d.elapsedMs / 1000)} s` : ''}</span></p></div>
        <div class="row">${live ? `${d.status === 'paused' ? '<button type="button" data-tr="resume">Seguir</button>' : '<button type="button" data-tr="pause">Pausa</button>'}<button type="button" class="danger" data-tr="stop">Parar y guardar</button>` : ''}</div>
      </div>
      ${d.error ? `<p class="bad">${esc(d.error)}</p>` : ''}
      ${lesson}
      ${(d.curve || []).length ? `${chartHTML('reward', 'Recompensa media por partida', s, s.rewardAvg, rv, f2)}${chartHTML('win', 'Tasa de victorias', s, s.winRate, [0, 0.25, 0.5, 0.75, 1], f2)}
        <p class="legend-line"><span class="lg-sleep"></span> marca en el eje = después de esa partida soñó (aprendió del lote) · rivales: ${Object.entries(rivals).map(([k, v]) => `${esc(RIVAL[k] || k)} <b class="mono">${v}</b>`).join(', ')} <button type="button" class="link" data-act="table">${S.table ? 'ocultar la tabla' : 'ver como tabla'}</button></p>${tooltipHTML(s)}${table}`
        : '<p class="empty">Aún no ha terminado ninguna partida.</p>'}
      ${rooms}${samples}`;
  }
  function listHTML() {
    if (!S.trainings.length) return '<p class="empty">Aún no hay entrenos.</p>';
    return `<ul class="tr-list">${S.trainings.map((t) => `<li><button type="button" data-sel="${esc(t.id)}" class="${t.id === S.sel ? 'on' : ''}"><b>${esc(nameOf(t.netId))}</b> <span class="mono dim">${esc(t.id)}</span><span class="st st-${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span><span class="mono dim">${t.games} p · ${t.updates} s</span></button></li>`).join('')}</ul>`;
  }
  function render() {
    if (!S.form) S.form = defaults();
    root.innerHTML = `<div class="tr-left">${formHTML()}</div><section class="tr-right" aria-label="Entrenos"><h2 class="sr">Entrenos</h2>${listHTML()}<div class="tr-detail" id="trDetail">${detailHTML()}</div></section>`;
  }
  const renderDetail = () => { const el = root.querySelector('#trDetail'); if (el) el.innerHTML = detailHTML(); };

  // ---------- eventos ----------
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.mix) { S.form.mix[el.dataset.mix] = Number(el.value); el.nextElementSibling.textContent = f2(Number(el.value)); }
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.mix) { S.form.mix[el.dataset.mix] = Number(el.value); render(); return; }
    if (!el.dataset.f) return;
    S.form[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.f === 'netId') { loadLearning(el.value).then(render); return; }
    if (['speed', 'durationKind', 'workers'].includes(el.dataset.f)) render();
  });
  root.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'trForm') return;
    ev.preventDefault();
    const { body, errors } = T.trainingBody(S.form);
    root.querySelector('#trErrors').textContent = errors.join(' ');
    if (!body) return;
    const r = await api('/api/lab/trainings', 'POST', body);
    if (!r.ok) { root.querySelector('#trErrors').textContent = reasonOf(r); return; }
    toast(`Entreno ${r.body.id} en marcha.`);
    S.sel = r.body.id;
    await loadAll();
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.sel) { S.sel = b.dataset.sel; S.hover = null; await loadDetail(S.sel); render(); return; }
    if (b.dataset.tr && S.detail) {
      const r = await api(`/api/lab/trainings/${encodeURIComponent(S.detail.id)}/${b.dataset.tr}`, 'POST', {});
      if (!r.ok) toast(reasonOf(r), 'error');
      await loadAll();
      return;
    }
    if (b.dataset.act === 'table') { S.table = !S.table; renderDetail(); }
  });
  // cruz: sigue al puntero y se ajusta a la partida más cercana; con el teclado, flechas
  const hoverAt = (svg, clientX) => {
    const r = svg.getBoundingClientRect(), W = Number(svg.dataset.w), L = Number(svg.dataset.l), R = Number(svg.dataset.r);
    const x = (clientX - r.left) / r.width * W;
    const x0 = Number(svg.dataset.x0), x1 = Number(svg.dataset.x1);
    const game = x0 + (x - L) / (W - L - R) * (x1 - x0);
    const games = (S.detail.curve || []).map((p) => p.game);
    let best = 0; games.forEach((g, i) => { if (Math.abs(g - game) < Math.abs(games[best] - game)) best = i; });
    return best;
  };
  root.addEventListener('pointermove', (ev) => {
    const svg = ev.target.closest && ev.target.closest('svg[data-chart]');
    if (!svg || !S.detail) return;
    const i = hoverAt(svg, ev.clientX);
    if (i !== S.hover) { S.hover = i; renderDetail(); }
  });
  root.addEventListener('pointerleave', () => { if (S.hover !== null) { S.hover = null; renderDetail(); } }, true);
  root.addEventListener('keydown', (ev) => {
    const svg = ev.target.closest && ev.target.closest('svg[data-chart]');
    if (!svg || !S.detail) return;
    const n = (S.detail.curve || []).length;
    const d = { ArrowLeft: -1, ArrowRight: 1, Home: -1e9, End: 1e9 }[ev.key];
    if (d === undefined || !n) return;
    ev.preventDefault();
    S.hover = Math.max(0, Math.min(n - 1, (S.hover ?? n - 1) + d));
    const key = svg.dataset.chart;
    renderDetail();
    const again = root.querySelector(`svg[data-chart="${key}"]`); if (again) again.focus();
  });

  return {
    async start() {
      await loadAll();
      if (es) return;
      es = [hub.on(LAB_EVENTS, 'curve', (d) => {
        if (!S.detail || d.trainingId !== S.detail.id) return;
        S.detail.curve = [...(S.detail.curve || []), d.point].slice(-500);
        S.detail.games = Math.max(S.detail.games || 0, d.point.game);
        renderDetail();
      }), ...['training', 'sleep', 'lesson', 'milestone'].map((k) => hub.on(LAB_EVENTS, k, refresh))];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } clearTimeout(timer); },
  };
}
