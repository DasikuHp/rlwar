// Etapa 3 · Duelo en vivo (P5): lanzar un duelo entre dos redes y mirarlo pensar. Sin barra de disparo: aquí nadie dispara
// a mano. Plano con render.js, candidatos y decisión de live.js (lo que la red pensó de verdad) y el registro de la sala.
// También vale para espectar cualquier sala por su código (#room=CODE, AGENTS.md).
import { initRender, startShot, R, resetRoom, say, expect, fnText, TEAM_COLOR } from '../render.js';
import { overlay, topCandidates, confidenceView, attributionPhrase } from '../live.js';
import { hub } from '../ui/sse.js';
import { api, reasonOf } from '../lab/api.js';
import { patch } from '../ui/patch.js';
import { SETTINGS_EVENT } from './ajustes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (v) => (typeof v === 'number' ? (Math.round(v * 100) / 100).toFixed(2) : '—');
const FAMILY = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: "EDO (y')", artillery: 'artillería', wild: 'salvaje' };
const LEARNING = [
  { v: 'mix', name: 'Mixto', help: 'Aprenden un poco tras cada partida (un cuarto del paso) y repasan las 6 al final.' },
  { v: 'hot', name: 'En caliente', help: 'Aprenden de cada partida nada más acabarla: la 2.ª ya juega distinto.' },
  { v: 'frozen', name: 'Congeladas', help: 'Juegan las 6 igual y solo aprenden al final, repasándolas todas.' },
];
const STATUS = { running: 'en directo', done: 'terminado', stopped: 'parado', error: 'con error' };
let truthMod = null;
const truth = () => (truthMod ||= import('/evo/truth.js').catch(() => null));

export function mountDuel(root, { toast, settings }) {
  root.innerHTML = `<div class="duel-live">
    <aside>
      <section><h3>Lanzar un duelo</h3>
        <div class="brain" id="dForm"></div></section>
      <section><h3>Duelos</h3><div class="duel-list" id="dList"><p class="empty">Cargando…</p></div></section>
    </aside>
    <div class="stage-canvas">
      <div class="bar"><span class="who" id="dWho">Ningún duelo en directo</span><span class="mono dim" id="dTurn"></span></div>
      <canvas id="dCanvas" aria-label="Plano de la partida"></canvas>
      <div class="fnbar" id="dFn" role="status" aria-live="polite"><span class="dim">Aquí sale la función de cada tiro, como en el original, y lo que consigue.</span></div>
    </div>
    <aside class="right">
      <section><h3>Candidatos y decisión</h3><div class="brain" id="dBrain"><p class="empty">Cuando una red piense, aquí verás sus 5 mejores candidatos y cuál eligió, con su certeza.</p></div></section>
      <section><h3>Marcador del duelo</h3><div class="score" id="dScore"><span class="dim">—</span></div></section>
      <section><h3>Registro de la partida</h3><ul class="log" id="dLog"></ul></section>
    </aside>
  </div>`;
  const $ = (id) => root.querySelector(`#${id}`);
  let rendered = false, offRoom = [], room = null, follow = null, poll = null, nets = [], duels = [];
  const nameOf = (id) => (nets.find((n) => n.id === id) || {}).name || id;

  // ---- lanzar ----
  function renderForm() {
    const opt = (sel) => nets.map((n) => `<option value="${esc(n.id)}"${n.id === sel ? ' selected' : ''}>${esc(n.name)}</option>`).join('');
    if (nets.length < 2) { patch($('dForm'), '<p class="empty">Hacen falta dos redes. Crea otra en <a href="#crear">1 · Crear</a> (desde una plantilla tarda un clic).</p>'); return; }
    const speed = settings.speed;
    const SPEEDS = [['x10', 'x10 — en directo, rápido'], ['x1', 'x1 — como el original'], ['turbo', 'turbo — sin pantalla, solo el resultado']];
    patch($('dForm'), `<label class="field">Red A<select id="dA">${opt(nets[0].id)}</select></label>
      <label class="field">Red B<select id="dB">${opt(nets[1].id)}</select></label>
      <label class="field">Velocidad<select id="dSpeed">${SPEEDS.map(([v, t]) => `<option value="${v}"${speed === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Cómo aprenden<select id="dLearn">${LEARNING.map((l) => `<option value="${l.v}">${l.name}</option>`).join('')}</select></label>
      <p class="dim" id="dLearnHelp">${esc(LEARNING[0].help)}</p>
      <button type="button" class="primary" id="dGo">Empezar duelo (6 partidas)</button>`);
    $('dLearn').onchange = (e) => { $('dLearnHelp').textContent = LEARNING.find((l) => l.v === e.target.value).help; };
    $('dGo').onclick = launch;
  }
  async function launch() {
    const a = $('dA').value, b = $('dB').value;
    if (a === b) { toast('Elige dos redes distintas: una red no se bate contra sí misma.', 'error'); return; }
    const r = await api('/api/lab/duels', 'POST', { a, b, speed: $('dSpeed').value, learning: $('dLearn').value, soldiers: 'random' });
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    toast(`Duelo ${nameOf(a)} contra ${nameOf(b)} en marcha`);
    follow = r.body.id;
    await loadDuels();
  }

  // ---- lista y seguimiento ----
  async function loadDuels() {
    const [n, d] = await Promise.all([api('/api/lab/nets'), api('/api/lab/duels')]);
    if (n.ok) nets = n.body.nets;
    if (d.ok) duels = d.body.duels.slice().sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0));
    if (!follow) { const live = duels.find((x) => x.status === 'running' && x.liveRoom); if (live) follow = live.id; }
    renderList();
    const cur = duels.find((x) => x.id === follow);
    if (cur) {
      renderScore(cur);
      if (cur.liveRoom && cur.liveRoom !== room) watchRoom(cur.liveRoom);
      if (cur.status !== 'running' && !room) $('dWho').textContent = `Duelo ${STATUS[cur.status] || cur.status}: ${nameOf(cur.a)} ${cur.wins[cur.a] ?? 0} – ${cur.wins[cur.b] ?? 0} ${nameOf(cur.b)}`;
    }
  }
  function renderList() {
    if (!duels.length) { patch($('dList'), '<p class="empty">Aún no hay duelos en este mundo.</p>'); return; }
    patch($('dList'), duels.slice(0, 20).map((d) => `<a href="#duelo" data-key="${esc(d.id)}" data-duel="${esc(d.id)}"${d.id === follow ? ' aria-current="true"' : ''}>
      <span><b>${esc(nameOf(d.a))}</b> ${d.wins[d.a] ?? 0} – ${d.wins[d.b] ?? 0} <b>${esc(nameOf(d.b))}</b></span>
      <small>${esc(STATUS[d.status] || d.status)} · ${esc(d.speed)} · ${d.games.length}/6 partidas${d.throne ? ' · 👑 trono' : ''}</small></a>`).join(''));
  }
  function renderScore(d) {
    const who = (id) => `<button type="button" class="link" data-ficha="${esc(id)}" title="Abrir su ficha">${esc(nameOf(id))}</button>`;
    patch($('dScore'), `<span>${who(d.a)}</span><b>${d.wins[d.a] ?? 0}</b><span>${who(d.b)}</span><b>${d.wins[d.b] ?? 0}</b>
      <span class="dim">Partidas</span><b>${d.games.length} / 6</b><span class="dim">Diferencia de bajas</span><b>${d.killDiff > 0 ? '+' : ''}${d.killDiff ?? 0}</b>`);
  }

  window.addEventListener(SETTINGS_EVENT, (e) => { if (e.detail && e.detail.key === 'speed' && nets.length >= 2) renderForm(); });
  $('dList').addEventListener('click', (e) => { const a = e.target.closest('[data-duel]'); if (!a) return; e.preventDefault(); follow = a.dataset.duel; loadDuels(); });

  // ---- la sala en directo ----
  function watchRoom(code) {
    for (const off of offRoom) off();
    room = code;
    resetRoom(); held = null; chat = [];
    $('dLog').innerHTML = ''; $('dBrain').innerHTML = '<p class="empty">Esperando a que una red piense…</p>';
    const url = `/api/rooms/${code}/events`;
    offRoom = [
      hub.on(url, 'hello', onState), hub.on(url, 'state', onState),
      hub.on(url, 'shot', (d) => onShot(d.shot)),
      hub.on(url, 'decision', (d) => onDecision(d.decision)),
      hub.on(url, 'move', () => { if (R.think && R.think.kind === 'move') R.think = null; }),
      hub.on(url, 'chat', (d) => { if (R.state) R.state.chat = d.chat; chat = d.chat || []; logSoon(); bubbles(d.chat); }),
    ];
    api(`/api/rooms/${code}/state`).then((r) => {
      if (r.ok) { onState(r.body); return; }
      for (const off of offRoom) off();
      offRoom = []; room = null;
      $('dWho').textContent = r.status === 404 ? `La sala ${code} no existe (o ya se cerró).` : reasonOf(r);
    });
  }
  function onState(st) {
    if (!st || !st.phase || !Array.isArray(st.players) || !Array.isArray(st.soldiers)) return;
    R.state = st;
    const side = (team) => st.players.filter((p) => p.team === team).map((p) => esc(p.name)).join(', ');
    const alive = (team) => st.soldiers.filter((s) => s.alive && s.team === team).length;
    patch($('dWho'), `<b style="color:#4fd1ff">${side('left')}</b> <span class="mono">${alive('left')} vs ${alive('right')}</span> <b style="color:#ff9f43">${side('right')}</b> <span class="dim">· sala ${esc(st.code)}${st.phase === 'over' ? ' · acabada' : ''}</span>`);
    $('dTurn').textContent = st.stats ? `disparo ${st.stats.shots}` : '';
    chat = st.chat || chat; logSoon();
  }

  // ---- registro, como el chat del original: el nombre en negrita y del color de su bando ----
  // Lo que pasa con un tiro (💥, 🪨…) y lo que la red dice al dispararlo se escriben en el servidor a la vez que el tiro;
  // aquí se guardan hasta que su curva llega al final, para que el registro no cuente el resultado antes de verlo.
  let chat = [], held = null, logTimer = null;
  const logSoon = () => { clearTimeout(logTimer); logTimer = setTimeout(renderLog, 60); }; // el tiro llega justo detrás del chat
  function colorNames(html) {
    const st = R.state;
    if (!st) return html;
    let out = html;
    for (const p of [...st.players].sort((a, b) => b.name.length - a.name.length)) {
      const n = esc(p.name);
      if (n) out = out.split(n).join(`<b style="color:${TEAM_COLOR[p.team] || '#fff'}">${n}</b>`);
    }
    return out;
  }
  function renderLog() {
    const el = $('dLog');
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    const shown = chat.filter((c) => !(held && c.t >= held.from && c.t <= held.to)).slice(-60);
    patch(el, shown.map((c) => `<li data-key="${esc(`${c.t}|${c.text}`)}" class="${c.playerId ? 'said' : 'sys'}${c.kind === 'think' ? ' think' : ''}">${colorNames(esc(c.text))}</li>`).join(''));
    if (atEnd) el.scrollTop = el.scrollHeight; // si estás leyendo más arriba, no te lo mueve
  }
  // ---- la barra de la función, como el campo "y =" del original: quién tira, qué función y qué consigue ----
  const RESULT = { obstacle: '🪨 choca con un obstáculo', wall: '🧱 se sale del plano', invalid: '❌ la función no vale ahí y explota', steep: '📐 se pone vertical y explota' };
  function resultText(shot) {
    const r = shot.result || {}, st = R.state;
    const nameOfSoldier = (id) => { const s = st && st.soldiers.find((x) => x.id === id); const p = s && st.players.find((q) => q.id === s.ownerId); return p ? p.name : id; };
    const hits = (r.hits || []).map((h) => (typeof h === 'string' ? h : h.soldierId));
    const shooter = st && st.soldiers.find((s) => s.id === shot.soldierId);
    const foes = hits.filter((id) => { const s = st && st.soldiers.find((x) => x.id === id); return s && shooter && s.team !== shooter.team; });
    const mates = hits.length - foes.length;
    const parts = [];
    if (foes.length) parts.push(`💥 elimina a ${foes.map(nameOfSoldier).join(' y a ')}`);
    if (mates) parts.push(`💀 ${foes.length ? 'y a' : 'alcanza a'} ${mates === 1 ? 'un aliado' : `${mates} aliados`}`);
    return parts.length ? parts.join(' ') : RESULT[r.type] || '💤 se queda sin recorrido';
  }
  function fnBar(shot, landedYet) {
    const st = R.state;
    const p = st && st.players.find((q) => q.id === shot.playerId);
    const color = TEAM_COLOR[shot.shooterTeam] || '#fff';
    patch($('dFn'), `<b class="fn-who" style="color:${color};border-color:${color}">${esc(p ? p.name : '?')}</b>
      <span class="fn-expr mono" style="color:${color}">${esc(fnText(shot))}</span>
      <span class="fn-res">${landedYet ? esc(resultText(shot)) : '<span class="dim">trazando…</span>'}</span>`);
  }
  function onShot(shot) {
    startShot(shot); // si el anterior seguía trazándose, se completa aquí (y suelta lo suyo del registro)
    held = { from: shot.ts - 40, to: shot.ts + 5 };
    fnBar(shot, false);
    logSoon();
  }
  R.onLanded = (shot) => { if (!root.isConnected) return; held = null; fnBar(shot, true); renderLog(); };

  // ---- bocadillos: lo que dice cada red sale sobre su soldado, después de su función (ui/bubbles.js) ----
  const seenSay = new Set();
  function bubbles(list) {
    for (const c of list || []) {
      if (c.kind !== 'say' || !c.soldierId) continue;
      const key = `${c.t}|${c.text}`; if (seenSay.has(key)) continue;
      seenSay.add(key); if (seenSay.size > 200) seenSay.clear();
      const cut = c.text.indexOf(': ');
      say({ soldierId: c.soldierId, text: cut >= 0 && cut < 40 ? c.text.slice(cut + 2) : c.text, level: c.level || null });
    }
  }
  async function onDecision(d) {
    if (!d || !R.state) return;
    const st = R.state;
    const sol = st.soldiers.find((s) => s.id === d.soldierId);
    const ov = overlay(d);
    R.think = ov ? { ...ov, team: sol ? sol.team : 'left', until: Date.now() + (ov.kind === 'move' ? 4000 : 15000) } : null;
    if (d.phase !== 'shoot') return;
    expect(d.soldierId);
    const owner = sol && st.players.find((p) => p.id === sol.ownerId);
    const c = confidenceView(d.confidence);
    $('dBrain').innerHTML = `<p><b>${esc(owner ? owner.name : d.netId)}</b> <span class="dim">antes de disparar</span></p>
      <ol class="b-cands">${topCandidates(d, 5).map((x) => `<li class="${x.chosen ? 'chosen' : ''}"><span class="mono">#${x.i}</span><span>${esc(FAMILY[x.family] || x.family)}</span><span class="expr">${esc(x.expr)}</span><span class="p">${f2(x.p)}</span></li>`).join('')}</ol>
      ${c ? `<p class="b-conf"><span class="lvl lvl-${esc(c.level)}">${esc(c.label)}</span> certeza <b>${f2(c.certainty)}</b></p><span class="meter"><i style="width:${Math.round(Math.max(0, Math.min(1, c.certainty)) * 100)}%"></i></span>` : ''}
      <p class="dim">elegida #${d.chosen} · margen ${f2(d.margin)}</p><p class="b-say" id="dSay"></p>`;
    // la frase solo sale si se compone con compose y pasa checkPhrase contra esta misma decisión (spec/07 §2)
    const f = attributionPhrase(d, { game: `g-${st.config && st.config.seed}-${st.code}`, id: d.eventId });
    const T = f && await truth();
    const out = $('dSay');
    if (!T || !out) return;
    try { const ph = T.compose(f.template, f.slots); if (T.checkPhrase(ph, (r) => (r.id === d.eventId ? { id: d.eventId, turn: d.turn, type: 'decision', data: d } : null)).ok) out.textContent = ph.text; } catch { /* sin evento: no se enseña */ }
  }

  return {
    async start(code = null) {
      if (!rendered) { initRender($('dCanvas')); rendered = true; }
      await loadDuels();
      renderForm();
      if (code && code !== room) watchRoom(code);
      clearInterval(poll);
      poll = setInterval(() => { if (!root.closest('[hidden]')) loadDuels(); }, 1500);
    },
    stop() { clearInterval(poll); },
  };
}
