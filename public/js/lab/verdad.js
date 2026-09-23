// Verdad (parte 4, spec/prompt-opus-ui.md §3.1; spec/07): lo que de verdad pasó y por qué. Diario de cada red y crónica
// (frases del servidor, verificadas contra el registro: al pulsar una, se ven los eventos que la justifican), moviola
// turno a turno con el cerebro (activaciones, candidatos, atribución) y la bofetada o caricia sobre una decisión,
// boletín con su radar, neuronas con nombre (renombrables) y memoria (rivales, rencores, recuerdos).
import * as V from './truthview.js';
import * as L from '../live.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { hub } from '../ui/sse.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '—');
const when = (t) => (t ? new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');
const KIND = { duel: 'duelo', training: 'entreno', exhibition: 'exhibición', exam: 'examen' };
const PHASE = { shoot: 'disparo', move: 'movimiento' };
const EMOTION = { pride: 'orgullo', grudge: 'rencor', fear: 'miedo', shame: 'vergüenza' };
const OUTCOME = { kill: 'mató', death: 'murió', graze: 'le rozaron', friendlyFire: 'fuego amigo', slap: 'recibió una bofetada', caress: 'recibió una caricia', 'reign.start': 'subió al trono', 'reign.end': 'perdió el trono', challenge: 'reto perdido' };
const RESULT = { kill: 'mató', friendlyFire: 'mató a un aliado', suicide: 'se mató a sí mismo', obstacle: 'chocó con un obstáculo', wall: 'se salió por el borde', miss: 'no dio a nadie' };
const FAMILY = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: "EDO (y')", artillery: 'artillería', wild: 'salvaje' };
const TABS = [['diario', 'Diario'], ['moviola', 'Moviola'], ['boletin', 'Boletín'], ['neuronas', 'Neuronas'], ['memoria', 'Memoria'], ['cronica', 'Crónica de todas']];
let truthMod = null;
const truth = () => (truthMod ||= import('/evo/truth.js').catch(() => null));

export function mountTruth(root, { catalog, toast }) {
  const S = { nets: [], netId: null, tab: 'diario', diary: [], chronicle: [], openRef: null, refEvents: [], games: [], game: null, gameId: null, turns: [], turn: null, brain: null, phrase: null, feedbackMsg: null, bulletin: null, examJob: null, neurons: null, memory: null, feedback: null };
  let es = null;
  const net = (id) => S.nets.find((n) => n.id === id);
  const nameOf = (id) => (net(id) ? net(id).name : id);

  async function loadNets() {
    const r = await api('/api/lab/nets');
    if (r.ok) S.nets = r.body.nets;
    if (!S.netId && S.nets.length) S.netId = S.nets[0].id;
  }
  async function loadTab() {
    const id = encodeURIComponent(S.netId || '');
    if (S.tab === 'cronica') { const r = await api('/api/lab/chronicle'); S.chronicle = r.ok ? r.body.entries : []; }
    if (!S.netId) return;
    if (S.tab === 'diario') { const r = await api(`/api/lab/nets/${id}/diary`); S.diary = r.ok ? r.body.entries : []; }
    if (S.tab === 'moviola') { const r = await api(`/api/lab/games?netId=${id}&limit=60`); S.games = r.ok ? r.body.games : []; }
    if (S.tab === 'boletin') { const r = await api(`/api/lab/nets/${id}/bulletin`); S.bulletin = r.ok ? r.body : null; }
    if (S.tab === 'neuronas') { const r = await api(`/api/lab/nets/${id}/neurons`); S.neurons = r.ok ? r.body : { error: reasonOf(r) }; }
    if (S.tab === 'memoria') { const [m, f] = await Promise.all([api(`/api/lab/nets/${id}/memory`), api(`/api/lab/nets/${id}/feedback`)]); S.memory = m.ok ? m.body : null; S.feedback = f.ok ? f.body : null; }
  }
  async function refreshAll() { await loadNets(); await loadTab(); render(); }

  // ---------- diario y crónica: la frase y los eventos que la justifican ----------
  function entriesHTML(list, empty) {
    if (!list.length) return `<p class="empty">${empty}</p>`;
    return `<ol class="entries">${list.map((e) => {
      const key = `${e.kind}:${e.id}`;
      const open = S.openRef === key;
      return `<li class="${open ? 'open' : ''}"><button type="button" class="entry" data-ref="${esc(key)}" aria-expanded="${open}"><span>${esc(e.text)}</span><span class="dim">${esc(when(e.t))}</span></button>
        ${open ? `<div class="why"><p class="dim">La frase sale de ${e.refs.length === 1 ? 'este evento' : 'estos eventos'} del registro${e.numbers && e.numbers.length ? `; números comprobados: <span class="mono">${e.numbers.map(esc).join(', ')}</span>` : ''}${e.names && e.names.length ? `; nombres: ${e.names.map(esc).join(', ')}` : ''}.</p>${S.refEvents.map((ev) => `<pre class="json">${esc(JSON.stringify(ev, null, 2))}</pre>`).join('')}</div>` : ''}</li>`;
    }).join('')}</ol>`;
  }
  async function openRef(key, list) {
    if (S.openRef === key) { S.openRef = null; render(); return; }
    const e = list.find((x) => `${x.kind}:${x.id}` === key);
    S.openRef = key;
    S.refEvents = [];
    for (const r of (e && e.refs) || []) {
      if (r.log !== undefined) { const x = await api(`/api/lab/log/${encodeURIComponent(r.log)}`); S.refEvents.push(x.ok ? x.body : { error: reasonOf(x) }); }
      else if (r.game) { const g = await api(`/api/lab/games/${encodeURIComponent(r.game)}`); S.refEvents.push(g.ok ? (g.body.events.find((ev) => ev.id === r.id) || { game: r.game, id: r.id }) : { error: reasonOf(g) }); }
    }
    render();
  }

  // ---------- moviola ----------
  async function openGame(gameId) {
    const r = await api(`/api/lab/games/${encodeURIComponent(gameId)}`);
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    S.gameId = gameId; S.game = r.body; S.turns = V.netTurns(r.body, S.netId); S.turn = null; S.brain = null; S.feedbackMsg = null;
    if (S.turns.length) await openTurn(0); else render();
  }
  async function openTurn(i) {
    const t = S.turns[i];
    if (!t) return;
    S.turn = i; S.feedbackMsg = null; S.phrase = null;
    const r = await api(`/api/lab/games/${encodeURIComponent(S.gameId)}/turns/${t.turn}/brain?player=${encodeURIComponent(t.playerId)}`);
    S.brain = r.ok ? r.body : { error: reasonOf(r) };
    // la frase de atribución: solo si se compone y pasa checkPhrase contra el evento guardado (spec/07 §2)
    const d = r.ok ? r.body.decision : null;
    const f = d && L.attributionPhrase(d, { game: S.gameId, id: t.eventId });
    const T = f && await truth();
    if (T) {
      try {
        const ph = T.compose(f.template, f.slots);
        const byId = new Map(S.game.events.map((e) => [e.id, e]));
        if (T.checkPhrase(ph, (ref) => (ref.game === S.gameId ? byId.get(ref.id) : null)).ok) S.phrase = ph.text;
      } catch { /* no se enseña */ }
    }
    render();
  }
  function moviolaHTML() {
    const games = S.games.length ? `<ul class="game-list">${S.games.map((g) => `<li><button type="button" data-game="${esc(g.gameId)}" class="${g.gameId === S.gameId ? 'on' : ''}"><b>${esc(KIND[g.kind] || g.kind)}</b> ${(g.nets || []).filter((x) => x !== S.netId).map((x) => `contra ${esc(nameOf(x))}`).join(', ') || 'contra sí misma'}<span class="dim">${(g.nets || []).length < 2 ? '' : g.winner ? (g.winner === S.netId ? 'ganó · ' : 'perdió · ') : 'empate · '}${esc(when(g.ts))}</span></button></li>`).join('')}</ul>` : '<p class="empty">Esta red aún no tiene partidas guardadas.</p>';
    let right = '<p class="empty">Elige una partida.</p>';
    if (S.game) {
      const turns = S.turns.length ? `<div class="turns" role="tablist" aria-label="Decisiones">${S.turns.map((t, i) => `<button type="button" role="tab" aria-selected="${i === S.turn}" data-turn="${i}">turno ${t.turn} · ${PHASE[t.phase] || t.phase}</button>`).join('')}</div>` : '<p class="empty">En esta partida la red no llegó a decidir nada (o sus decisiones no se registraron completas).</p>';
      right = `<p class="dim mono">${esc(S.gameId)}</p>${turns}${brainHTML()}`;
    }
    return `<div class="moviola"><div class="mv-games">${games}</div><div class="mv-brain">${right}</div></div>`;
  }
  function brainHTML() {
    const b = S.brain;
    if (!b) return '';
    if (b.error) return `<p class="bad">${esc(b.error)}</p>`;
    const d = b.decision;
    const t = S.turns[S.turn];
    const shot = d.phase === 'shoot' ? S.game.events.find((e) => e.type === 'shot' && e.id > t.eventId && e.actor && e.actor.soldierId === t.soldierId) : null;
    const emo = S.game.events.find((e) => e.type === 'emotion' && e.data && e.data.decisionEventId === t.eventId);
    const c = L.confidenceView(d.confidence);
    const rows = V.activationRows(b.activations, d);
    const cands = d.phase === 'shoot' ? L.topCandidates(d, 6) : [];
    const attr = L.attributionRows(d).filter((a) => a.share > 0);
    return `<div class="brain-view">
      <p class="approx ${b.approx ? 'warn' : 'good'}">${b.approx ? 'Aproximada: esta partida no guarda la red tal como jugó; se recalcula con la red de ahora.' : 'Exacta: la red tal como jugó esa partida.'}</p>
      <div class="bv-grid">
        <div>
          <h3>Decisión</h3>
          ${d.phase === 'shoot' ? `<p>Eligió la <b class="mono">#${d.chosen}</b> · margen <span class="mono">${f2(d.margin)}</span>${typeof d.value === 'number' ? ` · valor esperado <span class="mono">${f2(d.value)}</span>` : ''}</p>` : `<p>Eligió el destino <b class="mono">#${d.chosenMove}</b> de ${(d.moves || []).length}</p>`}
          ${c ? `<p>Confianza <span class="lvl">${esc(c.label)}</span> certeza <span class="mono">${f2(c.certainty)}</span> · experiencia <span class="mono">${f2(c.experience)}</span></p>` : ''}
          ${shot ? `<p>Disparó <span class="mono">${esc(shot.data.expr)}</span>: ${esc(shot.data.result ? RESULT[shot.data.result.type] || shot.data.result.type : '')}</p>` : ''}
          ${cands.length ? `<ol class="b-cands">${cands.map((x) => `<li class="${x.chosen ? 'chosen' : ''}"><span class="mono">#${x.i}</span> ${esc(FAMILY[x.family] || x.family)} <span class="mono expr">${esc(x.expr)}</span><span class="mono p">${f2(x.p)}</span></li>`).join('')}</ol>` : ''}
          ${attr.length ? `<h3>En qué se fijó</h3><ul class="b-attr">${attr.map((a) => `<li><span>${esc(a.name)}</span><span class="bar"><i style="width:${Math.round(a.share * 100)}%"></i></span><span class="mono">${f2(a.share)}</span></li>`).join('')}</ul>` : ''}
          ${S.phrase ? `<p class="b-say">${esc(S.phrase)}</p>` : ''}
          ${emo ? `<p class="dim">Emoción tras decidir: esperanza <span class="mono">${f2(emo.data.hope)}</span> · miedo <span class="mono">${f2(emo.data.fear)}</span> · alegría <span class="mono">${f2(emo.data.joy)}</span> · decepción <span class="mono">${f2(emo.data.disappointment)}</span> · sorpresa <span class="mono">${f2(emo.data.surprise)}</span></p>` : ''}
          ${d.phase === 'shoot' ? `<div class="row fb"><button type="button" data-fb="slap">Bofetada</button><button type="button" data-fb="caress">Caricia</button><span class="dim">castiga o premia esta decisión: cuenta en su próximo sueño</span></div>${S.feedbackMsg ? `<p class="${S.feedbackMsg.ok ? 'good' : 'bad'}">${esc(S.feedbackMsg.text)}</p>` : ''}` : ''}
        </div>
        <div>
          <h3>Activaciones</h3>
          <p class="hint">Cada casilla es una neurona; más clara, más activa (en valor absoluto)${d.phase === 'shoot' ? ', para la candidata elegida' : d.phase === 'move' ? ', para el destino elegido' : ''}.</p>
          <ul class="acts">${rows.map((r) => `<li><span class="mono">${esc(r.blockId)}</span><span class="heat">${r.norm.slice(0, 64).map((v, i) => `<i style="background:rgb(${Math.round(14 + 65 * v)},${Math.round(22 + 187 * v)},${Math.round(39 + 216 * v)})" title="${esc(f2(r.values[i]))}"></i>`).join('')}</span><span class="mono dim">máx ${f2(r.max)}</span></li>`).join('')}</ul>
        </div>
      </div></div>`;
  }

  // ---------- boletín ----------
  function bulletinHTML() {
    const b = S.bulletin;
    const job = S.examJob;
    const head = `<div class="row"><button type="button" class="primary" data-act="exam" ${job && job.status === 'running' ? 'disabled' : ''}>Examinar ahora</button>${job ? `<span class="dim">examen ${esc(job.id)}: ${esc(job.status === 'running' ? `${job.progress ? job.progress.done : 0} de ${job.progress ? job.progress.total : 96} escenas` : job.status)}</span>` : ''}</div>
      <p class="hint">Cuatro exámenes con semilla fija (misma red, mismas notas): puntería (40 blancos quietos), cobertura (30 movimientos), supervivencia (10 partidas contra un francotirador) y adaptación (12 partidas con 1 a 4 soldados).</p>`;
    if (!b) return `${head}<p class="empty">Aún no tiene boletín.</p>`;
    const R = V.radar(b, { cx: 150, cy: 150, r: 110 });
    const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${[[150, 150 - 110 * k], [150 + 110 * k, 150], [150, 150 + 110 * k], [150 - 110 * k, 150]].map((p) => p.join(',')).join(' ')}" class="ring"/>`).join('');
    const axes = R.axes.map((a) => `<line x1="150" y1="150" x2="${a.ex}" y2="${a.ey}" class="ring"/><text x="${150 + (a.ex - 150) * 1.18}" y="${150 + (a.ey - 150) * 1.18 + 4}" text-anchor="middle" class="axis">${esc(a.label)} ${f2(a.raw)}</text>`).join('');
    const det = b.details || {};
    const n = (arr, pred) => (arr || []).filter(pred).length;
    return `${head}<div class="bulletin"><svg viewBox="-20 -20 340 340" role="img" aria-label="Radar del boletín">${rings}${axes}<polygon points="${R.polygon}" class="shape"/></svg>
      <table class="curve-table"><thead><tr><th>Examen</th><th class="num">Nota</th><th>De dónde sale</th></tr></thead><tbody>
        <tr><td>puntería</td><td class="num">${f2(b.aim)}</td><td>${Array.isArray(det.aim) ? `${n(det.aim, (x) => x.kill)} de ${det.aim.length} blancos` : ''}</td></tr>
        <tr><td>cobertura</td><td class="num">${f2(b.cover)}</td><td>${Array.isArray(det.cover) ? `${det.cover.length} escenas` : ''}</td></tr>
        <tr><td>supervivencia</td><td class="num">${f2(b.survival)}</td><td>${Array.isArray(det.survival) ? `${det.survival.length} partidas` : ''}</td></tr>
        <tr><td>adaptación</td><td class="num">${f2(b.adaptation)}</td><td>${det.adaptation ? Object.entries(det.adaptation).map(([k, v]) => `${k} sold.: ${f2(v)}`).join(' · ') : ''}</td></tr>
      </tbody></table></div>`;
  }

  // ---------- neuronas ----------
  function neuronsHTML() {
    const nb = S.neurons;
    if (!nb) return '';
    if (nb.error) return `<p class="bad">${esc(nb.error)}</p>`;
    const blocks = Object.entries(nb.blocks || {});
    if (!blocks.length) return '<p class="empty">Esta red no tiene capas con neuronas que nombrar.</p>';
    return `<p class="hint">Cada neurona se nombra por la entrada con la que más se mueve a la vez (correlación de más de 0,3 en las últimas ${esc(nb.m)} decisiones de disparo). Puedes ponerle tu nombre.</p>
      ${blocks.map(([bid, list]) => `<h3>${esc(bid)}</h3><table class="curve-table neur"><thead><tr><th class="num">#</th><th>Nombre</th><th class="num">Correlación</th><th>Con</th><th>Renombrar</th></tr></thead><tbody>${list.map((u) => `<tr><td class="mono">${u.index}</td><td>${esc(u.name)}${u.custom ? ' <span class="tag">tuyo</span>' : ''}</td><td class="num">${f2(u.corr)}</td><td>${esc(u.feature || '')}</td><td><form class="rename" data-block="${esc(bid)}" data-index="${u.index}"><input aria-label="Nuevo nombre de la neurona ${u.index}" maxlength="40" placeholder="${esc(u.auto || '')}"><button type="submit" class="small">Guardar</button></form></td></tr>`).join('')}</tbody></table>`).join('')}`;
  }

  // ---------- memoria ----------
  function memoryHTML() {
    const m = S.memory;
    if (!m) return '<p class="empty">Sin memoria todavía.</p>';
    const rivals = V.rivalRows(m);
    const eps = V.lastEpisodes(m, 20);
    const shots = m.recentShots || [];
    const fb = S.feedback || { pending: [], applied: [] };
    return `<div class="mem">
      <section><h3>Rivales</h3>${rivals.length ? `<table class="curve-table"><thead><tr><th>Rival</th><th class="num">Partidas</th><th class="num">Ganadas</th><th class="num">Le maté</th><th class="num">Me mató</th><th class="num">Orgullo</th><th class="num">Rencor</th><th class="num">Respeto</th></tr></thead><tbody>${rivals.map((r) => `<tr><td>${esc(nameOf(r.rivalId))}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${r.killsOf}</td><td class="num">${r.killsBy}</td><td class="num">${f2(r.pride)}</td><td class="num">${f2(r.grudge)}</td><td class="num">${f2(r.respect)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aún no recuerda a nadie.</p>'}</section>
      <section><h3>Últimos disparos</h3>${shots.length ? `<p class="shots">${shots.map((s) => `<span class="${s ? 'hit' : 'miss'}" title="${s ? 'mató' : 'no mató'}"></span>`).join('')} <span class="dim">${shots.filter(Boolean).length} de ${shots.length} mataron</span></p>` : '<p class="empty">Sin disparos todavía.</p>'}</section>
      <section><h3>Recuerdos más recientes</h3>${eps.length ? `<ul class="eps">${eps.map((e) => `<li><b>${esc(EMOTION[e.emotion] || e.emotion)}</b> ${esc(OUTCOME[e.outcome] || e.outcome)} contra ${esc(nameOf(e.rivalId))}<span class="dim"> · ${esc(e.biome || '')} · tiro ${esc(FAMILY[e.family] || e.family || '—')} · intensidad ${f2(e.intensity)} · hace ${e.gamesAgo} partidas</span></li>`).join('')}</ul>` : '<p class="empty">Sin recuerdos.</p>'}</section>
      <section><h3>Bofetadas y caricias</h3><p>${fb.pending.length} pendientes de su próximo sueño · ${(fb.applied || []).length} ya aplicadas</p></section>
    </div>`;
  }

  function render() {
    const netSel = `<div class="tv-head"><label for="tvNet">Red</label><select id="tvNet">${S.nets.map((n) => `<option value="${esc(n.id)}" ${n.id === S.netId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>${net(S.netId) ? `<span class="em" aria-hidden="true">${emblemSVG(net(S.netId).emblem, 30)}</span>` : ''}
      <div class="tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${t}</button>`).join('')}</div></div>`;
    let body = '';
    if (!S.nets.length && S.tab !== 'cronica') body = '<p class="empty">Aún no hay redes.</p>';
    else if (S.tab === 'diario') body = entriesHTML(S.diary, 'Esta red aún no tiene entradas en su diario.');
    else if (S.tab === 'cronica') body = entriesHTML(S.chronicle, 'La crónica está vacía: todavía no ha habido reinados ni retos.');
    else if (S.tab === 'moviola') body = moviolaHTML();
    else if (S.tab === 'boletin') body = bulletinHTML();
    else if (S.tab === 'neuronas') body = neuronsHTML();
    else if (S.tab === 'memoria') body = memoryHTML();
    root.innerHTML = `${netSel}<div class="tv-body">${body}</div>`;
  }

  root.addEventListener('change', async (ev) => {
    if (ev.target.id === 'tvNet') { S.netId = ev.target.value; S.game = null; S.gameId = null; S.brain = null; S.openRef = null; await loadTab(); render(); }
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { S.tab = b.dataset.tab; S.openRef = null; await loadTab(); render(); return; }
    if (b.dataset.ref) { openRef(b.dataset.ref, S.tab === 'cronica' ? S.chronicle : S.diary); return; }
    if (b.dataset.game) { openGame(b.dataset.game); return; }
    if (b.dataset.turn !== undefined) { openTurn(Number(b.dataset.turn)); return; }
    if (b.dataset.fb) {
      const t = S.turns[S.turn];
      const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/${b.dataset.fb}`, 'POST', { game: S.gameId, decisionEventId: t.eventId, amount: 1 });
      S.feedbackMsg = r.ok ? { ok: true, text: `${b.dataset.fb === 'slap' ? 'Bofetada' : 'Caricia'} anotada${typeof r.body.reward === 'number' ? `: recompensa ${f2(r.body.reward)}` : ''}${r.body.queued ? '; se aplica cuando la red quede libre' : ''}.` } : { ok: false, text: reasonOf(r) };
      render();
      return;
    }
    if (b.dataset.act === 'exam') {
      const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/bulletin`, 'POST', {});
      if (!r.ok) { toast(reasonOf(r), 'error'); return; }
      S.examJob = { id: r.body.jobId, status: 'running', progress: { done: 0, total: 96 } };
      render();
    }
  });
  root.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('form.rename');
    if (!f) return;
    ev.preventDefault();
    const name = f.querySelector('input').value.trim();
    if (!name) { toast('Escribe un nombre.', 'error'); return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/neurons/${encodeURIComponent(f.dataset.block)}/${f.dataset.index}`, 'PUT', { name });
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    toast('Nombre guardado.');
    await loadTab(); render();
  });

  return {
    async start() {
      await refreshAll();
      if (es) return;
      es = [hub.on(LAB_EVENTS, 'job', async (j) => {
        if (j.kind !== 'exam' || !S.examJob || j.id !== S.examJob.id) return;
        S.examJob = j;
        if (j.status === 'done' && S.tab === 'boletin') await loadTab();
        if (S.tab === 'boletin') render();
      })];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } },
  };
}
