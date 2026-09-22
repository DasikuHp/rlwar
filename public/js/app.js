// Cliente web: red (REST + SSE), UI y conexión con el render.
import { initRender, startShot, R } from './render.js';

const $ = (id) => document.getElementById(id);
let session = null;                                  // {code, playerId, name, team}
try { session = JSON.parse(localStorage.getItem('gw-session') || 'null'); } catch { session = null; }
if (session && (!session.code || !session.playerId)) session = null;   // sesión corrupta: descartar
let mode = 'function';
let evtSource = null;
let spectating = false;                              // true = solo mirar (IA vs IA)

async function api(path, method = 'GET', body = null) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{4}$/.test(c.trim().toUpperCase());

function toast(text, ms = 2500) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function connect(roomCode) {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(`/api/rooms/${roomCode}/events`);
  evtSource.addEventListener('hello', (e) => onState(JSON.parse(e.data)));
  evtSource.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  evtSource.addEventListener('shot', (e) => startShot(JSON.parse(e.data).shot));
  evtSource.addEventListener('chat', (e) => {
    const d = JSON.parse(e.data);
    if (R.state) R.state.chat = d.chat;
    renderChat(d.chat);
    setBubbles(d.chat);
  });
  evtSource.addEventListener('gameover', (e) => {
    const { winner, result } = JSON.parse(e.data);
    const txt = winner
      ? `🏆 ¡Victoria del equipo ${winner === 'left' ? 'IZQUIERDO' : 'DERECHO'}!`
      : '🤝 Empate técnico';
    const extra = result && result.byLimit ? ` (límite de disparos: ${result.shots})` : '';
    toast(txt + extra, 6000);
  });
}

function onState(st) {
  // una respuesta que no es un snapshot de sala se ignora (antes lanzaba y apagaba el modo espectador)
  if (!st || !st.phase || !Array.isArray(st.players) || !Array.isArray(st.soldiers)) return;
  R.state = st;
  if (st.phase === 'lobby') { showLobby(st); return; }
  $('join').hidden = true; $('game').hidden = false;
  $('hdrRoom').textContent = `Sala ${st.code}${spectating ? ' · 👀 espectando' : ''}`;
  $('phaseText').textContent = st.phase === 'over'
    ? (st.winner
      ? `🏁 Ganó el equipo ${st.winner === 'left' ? 'IZQUIERDO' : 'DERECHO'}`
      : '🏁 Empate técnico')
    : `${st.soldiers.filter((s) => s.alive && s.team === 'left').length} vs ${st.soldiers.filter((s) => s.alive && s.team === 'right').length}`;

  const myTurn = !spectating && session && st.turn && st.turn.playerId === session.playerId;
  $('turnText').textContent = st.turn
    ? (spectating
      ? `👀 ${st.players.find((p) => p.id === st.turn.playerId)?.name ?? '...'} está calculando...`
      : myTurn ? '🎯 TU TURNO' : `Turno de ${st.players.find((p) => p.id === st.turn.playerId)?.name ?? '...'}`)
    : 'Disparo en curso...';
  $('turnText').style.color = myTurn ? '#7c6cff' : 'var(--text)';
  $('expr').disabled = !myTurn;
  $('btnFire').disabled = !myTurn;
  $('modeTabs').querySelectorAll('button').forEach((b) => { b.disabled = spectating; });
  updateTurnBar(st);

  $('playerList').innerHTML = st.players.map((p) =>
    `<li><b style="color:${p.team === 'left' ? '#4fd1ff' : '#ff9f43'}">${escapeHtml(p.name)}</b>` +
    `${p.isBot ? ' 🤖' : ''} <span class="dim">x${p.alive}${p.kills ? ` · 💥${p.kills}` : ''}</span></li>`).join('');
  $('exprList').innerHTML = st.soldiers.filter((s) => s.lastExpr).map((s) =>
    `<li>${s.alive ? '' : '☠ '}${escapeHtml(s.lastExpr)}</li>`).join('');

  renderChat(st.chat);
  setBubbles(st.chat);
}

function renderChat(chat) {
  $('chat').innerHTML = (chat || []).map((c) => `<li>${escapeHtml(c.text)}</li>`).join('');
  const el = $('chat');
  el.scrollTop = el.scrollHeight;
}

// Bocadillos: lo hablado (kind 'say') aparece sobre el soldado 5 segundos
const _seenSay = new Set();
function setBubbles(chat) {
  const now = Date.now();
  for (const c of chat || []) {
    if (c.kind !== 'say' || !c.soldierId) continue;
    const key = `${c.t}|${c.text}`;
    if (_seenSay.has(key)) continue;
    _seenSay.add(key);
    if (_seenSay.size > 200) _seenSay.clear();
    R.bubbles.push({ soldierId: c.soldierId, text: c.text, until: now + 5000 });
    R.lastSayTs = now;
  }
}

// Exige una sesión de jugador para acciones que la necesitan (evita el clásico
// "Cannot read properties of null (reading 'code')" cuando estás de espectador).
function requireSession() {
  if (!session || !session.code || !session.playerId) {
    throw new Error('No estás jugando en ninguna sala (estás como espectador): crea o únete a una sala primero');
  }
  return session;
}

// --- Selector de tropas (self-play): qué agente pelea en cada bando; las posiciones las sortea el servidor ---
const BUILTIN_AGENTS = [
  { id: 'sniper', name: 'Sniper', icon: '🎯' }, { id: 'greedy', name: 'Greedy', icon: '🤑' },
  { id: 'artillery', name: 'Artillery', icon: '💣' }, { id: 'chaos', name: 'Chaos', icon: '🌀' },
];
const AGENT_TEMPS = { sniper: 0.1, artillery: 0.6, greedy: 0.4, chaos: 0.9 };
let troopAgents = BUILTIN_AGENTS;

function loadTroops() {
  try { return JSON.parse(localStorage.getItem('gw-troops') || 'null') || {}; } catch { return {}; }
}

function troopSoldiers() {
  const n = Number($('spSoldiers').value);
  return n >= 1 && n <= 4 ? Math.floor(n) : 4;
}

function saveTroops() {
  const soldiers = troopSoldiers();
  try { localStorage.setItem('gw-troops', JSON.stringify({ left: $('spLeft').value, right: $('spRight').value, soldiers })); } catch { /* sin almacenamiento: no pasa nada */ }
  return soldiers;
}

// la elección guardada gana si sigue existiendo; si no, "Aleatorio"
function renderTroops(saved) {
  const ids = troopAgents.map((a) => a.id);
  const opts = '<option value="random">🎲 Aleatorio</option>' + troopAgents
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(`${a.icon || ''} ${a.name || a.id}`.trim())}</option>`).join('');
  for (const [id, side] of [['spLeft', 'left'], ['spRight', 'right']]) {
    $(id).innerHTML = opts;
    $(id).value = ids.includes(saved[side]) ? saved[side] : 'random';
  }
  const n = Number(saved.soldiers);
  $('spSoldiers').value = String(n >= 1 && n <= 4 ? Math.floor(n) : 4);
}

// "Aleatorio" nunca repite el agente del otro bando (si hay más de uno)
function pickTroops() {
  const ids = troopAgents.map((a) => a.id);
  const rnd = (exclude) => {
    const pool = ids.filter((x) => x !== exclude);
    const from = pool.length ? pool : ids;
    return from[Math.floor(Math.random() * from.length)];
  };
  let left = ids.includes($('spLeft').value) ? $('spLeft').value : 'random';
  let right = ids.includes($('spRight').value) ? $('spRight').value : 'random';
  if (left === 'random' && right === 'random') { left = rnd(null); right = rnd(left); }
  else if (left === 'random') left = rnd(right);
  else if (right === 'random') right = rnd(left);
  return { left, right };
}

function initTroops() {
  renderTroops(loadTroops());
  for (const id of ['spLeft', 'spRight', 'spSoldiers']) $(id).onchange = saveTroops;
  api('/agents').then((d) => {
    const list = Array.isArray(d.agents) ? d.agents.filter((a) => a && typeof a.id === 'string') : [];
    if (list.length) { troopAgents = list; renderTroops(loadTroops()); }
  }).catch(() => { /* sin /api/agents: se quedan los 4 de serie */ });
}

// --- UI events ---
function init() {
  initTroops();
  initRender($('board'));
  $('joinName').value = localStorage.getItem('gw-name') || 'Jugador';

  // cualquier error no controlado se muestra en pantalla en vez de romper la partida
  window.addEventListener('error', (e) => toast('⚠ ' + (e.message || 'Error inesperado'), 5000));

  $('btnCreate').onclick = async () => {
    try {
      const name = $('joinName').value.trim() || 'Jugador';
      localStorage.setItem('gw-name', name);
      const soldiers = Number($('soldiersPick').value) || 2;
      const r = await api('/rooms', 'POST', { name: 'Sala de ' + name, soldiers });
      const j = await api(`/rooms/${r.code}/join`, 'POST', { name, team: $('teamPick').value });
      session = { code: r.code, playerId: j.player.id, name, team: j.player.team };
      localStorage.setItem('gw-session', JSON.stringify(session));
      connect(r.code);
      showLobby(await api(`/rooms/${r.code}/state`));
    } catch (e) { $('joinError').textContent = e.message; }
  };

  $('btnJoin').onclick = async () => {
    try {
      const code = $('joinCode').value.trim().toUpperCase();
      if (!validCode(code)) throw new Error('Escribe un código de sala válido de 4 caracteres');
      const name = $('joinName').value.trim() || 'Jugador';
      const j = await api(`/rooms/${code}/join`, 'POST', { name, team: $('teamPick').value });
      session = { code, playerId: j.player.id, name, team: j.player.team };
      spectating = false;
      localStorage.setItem('gw-session', JSON.stringify(session));
      connect(code);
      onState(await api(`/rooms/${code}/state`));
    } catch (e) { $('joinError').textContent = e.message; }
  };

  // 👀 Espectar una sala existente (sin ser jugador)
  $('btnSpectate').onclick = async () => {
    try {
      const code = $('joinCode').value.trim().toUpperCase();
      if (!validCode(code)) throw new Error('Escribe un código de sala válido de 4 caracteres');
      spectate(code);
    } catch (e) { $('joinError').textContent = e.message; }
  };

// Botón self-play: crea sala, inicia partida y MUESTRA EL GRÁFICO YA
  $('btnSelfplay').onclick = async () => {
    try {
      spectating = true;
      const soldiers = saveTroops();
      const r = await api('/rooms', 'POST', { name: 'Self-play de agentes', soldiers });
      // tropa elegida por el usuario (o sorteada); cada heurístico con su temperatura
      const { left, right } = pickTroops();
      await api(`/rooms/${r.code}/addagent`, 'POST', { type: left, level: 3, team: 'left', temperature: AGENT_TEMPS[left] });
      await api(`/rooms/${r.code}/addagent`, 'POST', { type: right, level: 3, team: 'right', temperature: AGENT_TEMPS[right] });
      await api(`/rooms/${r.code}/start`, 'POST', {});
      // Esperar a que el estado llegue como playing para poder mostrar el gráfico
      const st = await api(`/rooms/${r.code}/state`);
      // Fuerza mostrar el gráfico siquiera está en lobby (porque la partida ya inició)
      spectate(r.code, true);
      toast('🤖 Partida de agentes iniciada', 4000);
    } catch (e) { $('joinError').textContent = e.message; }
  };

  $('btnAddBot').onclick = async () => {
    try {
      const s = requireSession();
      await api(`/rooms/${s.code}/addagent`, 'POST', { type: 'greedy', level: 2 });
      toast('🤖 Agente añadido a la sala');
    } catch (e) { toast('⚠ ' + e.message); }
  };

  $('btnStart').onclick = async () => {
    try {
      const s = requireSession();
      const r = await api(`/rooms/${s.code}/start`, 'POST', { playerId: s.playerId });
      if (r.error) throw new Error(r.error);
      onState(await api(`/rooms/${s.code}/state`));
    } catch (e) { toast('⚠ ' + e.message); }
  };

  for (const b of $('modeTabs').querySelectorAll('button')) {
    b.onclick = () => {
      mode = b.dataset.mode;
      $('modeTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      $('angleBox').hidden = mode !== 'ode2';
    };
  }
  $('angle').oninput = () => { $('angleVal').textContent = $('angle').value + '°'; };

  $('btnFire').onclick = fire;
  $('expr').addEventListener('keydown', (e) => { if (e.key === 'Enter') fire(); });

  $('chatForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (text && session) { await api(`/rooms/${session.code}/chat`, 'POST', { playerId: session.playerId, text }); $('chatInput').value = ''; }
  };

  if (session) {
    connect(session.code);
    api(`/rooms/${session.code}/state`).then(onState).catch(() => {
      localStorage.removeItem('gw-session');
      session = null;
    });
  } else if (window.location.hash.match(/^#room=[A-Za-z0-9]{4}$/)) {
    spectate(window.location.hash.slice(6).toUpperCase());
  }
}

// Modo espectador: ver una sala sin ser jugador (p. ej. agentes jugando solos)
function spectate(code) {
  spectating = true;
  if (session && session.code !== code) session = null;   // deja de actuar como jugador
  connect(code);
  api(`/rooms/${code}/state`).then(onState).catch((e) => {
    spectating = false;
    $('joinError').textContent = e.message;
  });
  window.history.replaceState(null, '', '#room=' + code);

}

async function fire() {
  if (!session) return;
  try {
    const r = await api(`/rooms/${session.code}/fire`, 'POST', {
      playerId: session.playerId, mode, expr: $('expr').value.trim(),
      angle: Number($('angle').value),
    });
    if (r.error) toast('⚠ ' + r.error);
    else { $('expr').value = ''; if (r.result.type === 'kill') toast('💥 ¡Blanco eliminado!'); }
  } catch (e) { toast('⚠ ' + e.message); }
}

init();

function updateTurnBar(st) {
  if (!st.turn) { $('turnBar').style.width = '0%'; return; }
  const left = Math.max(0, st.turn.deadline - Date.now());
  $('turnBar').style.width = (100 * left / st.config.turnTime).toFixed(1) + '%';
  setTimeout(() => updateTurnBar(st), 300);
}

function showLobby(st) {
  $('join').hidden = false; $('game').hidden = true;
  $('lobby').hidden = false;
  $('roomCode').textContent = st.code;
  // En modo espectador no se muestran los controles de la sala (no hay sesión de jugador)
  const mine = !!session && session.code === st.code;
  $('lobbyControls').hidden = !mine;
  $('lobbyHint').textContent = mine
    ? 'Añade un CPU o espera a más jugadores y pulsa ¡Empezar!'
    : '👀 Estás como espectador: crea una sala o únete con el código para jugar.';
  $('joinError').textContent = '';
  $('lobbyPlayers').innerHTML = st.players.map((p) =>
    `<li>${escapeHtml(p.name)} — ${p.team === 'left' ? 'cyan' : 'naranja'}${p.isBot ? ' (CPU)' : ''}</li>`).join('');
}
