// Verdad (spec/07 §2–§9, §12): toda frase lleva refs y cada número y nombre está en los eventos referenciados.
// Verificador y compositor, confianza real, emoción calculada, memoria episódica y recuerdo, eventos de recompensa
// y emoción, neuronas con nombre y frases fijas del diario. Puro salvo nameNeurons (compila la red).
import { compile } from '../shared/nn.js';
import { normalize, BLOCKS, BLOCK_FLAGS } from '../shared/genome.js';
import { eyeLayout } from '../shared/percept.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (v) => JSON.parse(JSON.stringify(v));

export const STOPWORDS = ['Sí', 'No', 'Mmm', 'Otra', 'Vale', 'Ya', 'Ahora', 'Bueno', 'Vaya', 'Uy', 'Ah', 'Eh', 'Ja', 'Jaja', 'Toma', 'Venga', 'Bien', 'Mal', 'Casi', 'Nada', 'Todo', 'Hoy', 'Luego', 'Mira', 'Oye', 'Ojo', 'Claro', 'Perfecto', 'Fácil', 'Difícil', 'Otra', 'Vez', 'Espera', 'Cuidado', 'Adiós', 'Hola', 'Gracias', 'Perdón', 'Uf', 'Bah', 'Pues', 'Igual', 'Quizá', 'Seguro', 'Nunca', 'Siempre', 'Jamás', 'Aún', 'Así', 'Ojalá', 'Basta', 'Fuera', 'Dentro', 'Arriba', 'Abajo'];

// ---------- extracción ----------
const NUM_RE = /(?<![\p{L}\d_])(?<!\p{L}-)(#?-?\d+(?:[.,]\d+)?)(?![\p{L}\d_])/gu;
export function extractNumbers(text) {
  const out = [];
  for (const m of String(text).matchAll(NUM_RE)) out.push(m[1]);
  return out;
}
const WORD_RE = /[\p{L}\d][\p{L}\d'’-]*/gu;
export function extractNames(text) {
  const out = [];
  const s = String(text);
  let sentenceStart = true;
  for (const m of s.matchAll(WORD_RE)) {
    const tok = m[0];
    const before = s.slice(0, m.index).trimEnd();
    sentenceStart = before.length === 0 || /[.!?:]$/.test(before);
    const hyphen = /\p{L}[\p{L}\d]*-[\p{L}\d]+/u.test(tok);
    const cap = /^\p{Lu}/u.test(tok);
    if (hyphen && /\p{L}/u.test(tok)) out.push(tok);
    else if (cap && !sentenceStart && !STOPWORDS.includes(tok)) out.push(tok);
  }
  return out;
}

// ---------- verificador ----------
const decimalsOf = (tok) => { const m = /[.,](\d+)$/.exec(tok); return m ? Math.min(2, m[1].length) : 0; };
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
function walkNumbers(v, out, key = null) {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) walkNumbers(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 't') continue; walkNumbers(x, out, k); }
}
function walkStrings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walkStrings(x, out);
}
const norm = (s) => String(s).toLowerCase();
function hasWord(strings, tok) {
  const t = norm(tok);
  for (const s of strings) {
    const ls = norm(s);
    if (ls === t) return true;
    const re = new RegExp(`(^|[^\\p{L}\\d])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\d])`, 'u');
    if (re.test(ls)) return true;
  }
  return false;
}
export function checkPhrase(phrase, loadEvents) {
  const events = [];
  for (const ref of phrase.refs || []) { const got = loadEvents(ref); if (Array.isArray(got)) events.push(...got.filter(Boolean)); else if (got) events.push(got); }
  const nums = [], strs = [];
  for (const e of events) { walkNumbers(e, nums); walkStrings(e, strs); }
  const idx = new Set();
  for (const e of events) {
    const d = e && e.data;
    if (!d) continue;
    if (Array.isArray(d.candidates)) for (const c of d.candidates) if (c && Number.isInteger(c.i)) idx.add(c.i);
    if (Array.isArray(d.moves)) d.moves.forEach((m, i) => idx.add(Number.isInteger(m && m.i) ? m.i : i));
  }
  const missing = { numbers: [], names: [] };
  const text = String(phrase.text || '');
  for (const tok of extractNumbers(text)) {
    if (tok.startsWith('#')) { const k = Number(tok.slice(1)); if (!idx.has(k)) missing.numbers.push(tok); continue; }
    const n = Number(tok.replace(',', '.'));
    const d = decimalsOf(tok);
    const after = text.slice(text.indexOf(tok) + tok.length).trimStart();
    const percent = after.startsWith('%');
    const ok = nums.some((v) => roundTo(v, d) === roundTo(n, d) || (percent && roundTo(v * 100, d) === roundTo(n, d)));
    if (!ok) missing.numbers.push(tok);
  }
  for (const tok of extractNames(text)) if (!hasWord(strs, tok)) missing.names.push(tok);
  return { ok: !missing.numbers.length && !missing.names.length, missing };
}

// ---------- compositor ----------
const refKey = (r) => JSON.stringify(r);
export function compose(template, slots = {}) {
  const refs = [], seen = new Set();
  const text = String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const s = slots[key];
    if (!s || s.ref === undefined || s.ref === null) throw new Error(`hueco sin evento: ${key}`);
    const k = refKey(s.ref);
    if (!seen.has(k)) { seen.add(k); refs.push(s.ref); }
    return String(s.value);
  });
  return { text, refs, numbers: extractNumbers(text), names: extractNames(text), slots: clone(slots) };
}
export function phrase(kind, netId, composed, t = Date.now()) {
  return { text: composed.text, refs: composed.refs, numbers: composed.numbers, names: composed.names, kind, netId, t };
}

// ---------- confianza (§4, §12.3) ----------
export function confidenceOf({ margin = 0, games = 0, recentShots = [] } = {}) {
  const certainty = clamp(Number(margin) || 0, 0, 1);
  const recent = (recentShots || []).slice(-20);
  const recentAccuracy = recent.length ? recent.reduce((s, v) => s + (v ? 1 : 0), 0) / recent.length : 0.5;
  const experience = (1 - Math.exp(-(Number(games) || 0) / 50)) * (0.5 + 0.5 * recentAccuracy);
  const confidence = certainty * experience;
  const level = confidence < 0.15 ? 'novata' : confidence > 0.5 ? 'veterana' : 'media';
  return { certainty, experience, recentAccuracy, confidence, level, sayProbability: 0.2 + 0.6 * confidence };
}

// ---------- emoción (§5, §12.4) ----------
export function emotionOf({ V = null, A = 0, valueSource = null } = {}) {
  const hasV = typeof V === 'number' && Number.isFinite(V);
  const a = Number(A) || 0;
  return {
    hope: hasV ? clamp(V, 0, 1) : 0, fear: hasV ? clamp(-V, 0, 1) : 0,
    joy: a > 0 ? Math.tanh(a) : 0, disappointment: a < 0 ? Math.tanh(-a) : 0, surprise: Math.tanh(Math.abs(a)),
    V: hasV ? V : null, advantage: a, valueSource: valueSource || (hasV ? 'value' : 'none'),
  };
}

// ---------- memoria (§6, §12.5) ----------
export const emptyMemory = () => ({ episodes: [], rivals: {}, recentShots: [] });
export function memoryOf(genome) {
  const m = genome && genome.memory;
  if (!m || Array.isArray(m) || typeof m !== 'object') return emptyMemory();
  return { episodes: Array.isArray(m.episodes) ? m.episodes : [], rivals: m.rivals && typeof m.rivals === 'object' ? m.rivals : {}, recentShots: Array.isArray(m.recentShots) ? m.recentShots : [] };
}
const EMOTION_OF = { kill: 'pride', death: 'grudge', graze: 'fear', friendlyFire: 'shame', 'reign.start': 'pride', 'reign.end': 'grudge', challenge: 'grudge' };
const episodeScore = (e) => (e.intensity || 0) * 0.9 ** (e.gamesAgo || 0);
export function updateMemory(memory, { netId = null, playerId, events = [], rewards = null, extra = [] } = {}) {
  for (const e of memory.episodes) e.gamesAgo = (e.gamesAgo || 0) + 1;
  const byId = new Map(events.map((e) => [e.id, e]));
  const start = events.find((e) => e.type === 'game.start');
  const biome = start && start.data && start.data.map ? start.data.map.biome : null;
  const rival = start && start.data && Array.isArray(start.data.players) ? start.data.players.find((p) => p.playerId !== playerId) : null;
  const rivalId = rival ? (rival.netId || rival.agentType || rival.name || 'rival') : null;
  const game = events.length ? events[0].game : null;
  const effByDecision = new Map();
  if (rewards && Array.isArray(rewards.entries)) for (const en of rewards.entries) if (en.decision && Number.isInteger(en.decision.eventId)) effByDecision.set(en.decision.eventId, en.effective);
  const intensityFor = (shotEv) => {
    const dId = shotEv && shotEv.data ? shotEv.data.decisionEventId : null;
    return effByDecision.has(dId) ? Math.min(1, Math.abs(effByDecision.get(dId))) : 0.5;
  };
  const shotOf = (e) => (e.data && Number.isInteger(e.data.shotEventId) ? byId.get(e.data.shotEventId) : null);
  const push = (ev, outcome, shotEv, intensity) => memory.episodes.push({ ref: { game: ev.game || game, id: ev.id }, rivalId, biome, family: shotEv && shotEv.data ? shotEv.data.family || null : null, outcome, emotion: EMOTION_OF[outcome], intensity, gamesAgo: 0 });
  const mine = (e) => e.actor && e.actor.playerId === playerId;
  let myKills = 0, myDeaths = 0;
  for (const e of events) {
    if (e.type === 'kill' && mine(e)) { const s = shotOf(e); push(e, 'kill', s, intensityFor(s)); myKills++; }
    else if (e.type === 'death' && mine(e)) { const s = shotOf(e); push(e, 'death', s, 0.5); myDeaths++; }
    else if (e.type === 'graze' && mine(e) && e.data && e.data.dist < 1) { const s = shotOf(e); push(e, 'graze', s, intensityFor(s)); }
    else if (e.type === 'friendlyFire' && mine(e)) { const s = shotOf(e); push(e, 'friendlyFire', s, intensityFor(s)); }
    else if (e.type === 'shot' && mine(e)) { memory.recentShots.push(e.data && e.data.result && e.data.result.type === 'kill' ? 1 : 0); }
  }
  if (memory.recentShots.length > 20) memory.recentShots.splice(0, memory.recentShots.length - 20);
  for (const ev of extra || []) {
    const outcome = ev.type === 'challenge' ? (ev.result === 'challenger' && ev.challenger === netId ? null : 'challenge') : ev.type;
    if (!outcome || !EMOTION_OF[outcome]) continue;
    memory.episodes.push({ ref: ev.id !== undefined ? { log: ev.id } : { game: null, id: null }, rivalId: ev.queen && ev.queen !== netId ? ev.queen : ev.challenger && ev.challenger !== netId ? ev.challenger : rivalId, biome: null, family: null, outcome, emotion: EMOTION_OF[outcome], intensity: 1, gamesAgo: 0 });
  }
  if (rivalId && events.length) {
    const r = memory.rivals[rivalId] || (memory.rivals[rivalId] = { alias: null, games: 0, wins: 0, killsBy: 0, killsOf: 0, pride: 0, grudge: 0, respect: 0.5 });
    r.games++;
    if (events.some((e) => e.type === 'win' && mine(e))) r.wins++;
    r.killsBy += myDeaths; r.killsOf += myKills; r.pride += myKills; r.grudge += myDeaths;
    r.respect = r.games ? (r.games - r.wins) / r.games : 0.5;
  }
  while (memory.episodes.length > 300) {
    let worst = 0;
    for (let i = 1; i < memory.episodes.length; i++) if (episodeScore(memory.episodes[i]) < episodeScore(memory.episodes[worst])) worst = i;
    memory.episodes.splice(worst, 1);
  }
  return memory;
}
export function recall(memory, ctx = {}, n = 3) {
  const score = (e) => episodeScore(e) * (1 + (ctx.rivalId && e.rivalId === ctx.rivalId ? 1 : 0) + (ctx.biome && e.biome === ctx.biome ? 0.5 : 0) + (ctx.family && e.family === ctx.family ? 0.5 : 0) + (ctx.outcome && e.outcome === ctx.outcome ? 0.5 : 0));
  return memory.episodes.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => (b.s - a.s) || (b.i - a.i)).slice(0, n).map((x) => x.e);
}

// ---------- eventos de recompensa y emoción (§1, §12.1) ----------
function appendEvent(events, type, actor, data, turn) {
  const id = events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  const game = events.length ? events[0].game : null;
  const ev = { id, t: Date.now(), game, turn, type, actor, data };
  events.push(ev);
  return ev;
}
const turnOf = (events, decisionEventId) => { const d = events.find((e) => e.id === decisionEventId); return d ? d.turn : 0; };
export function rewardEvents(events, rewards, { playerId, netId = null, tau = 0.5, normalized = false } = {}) {
  let n = 0;
  for (const en of (rewards && rewards.entries) || []) {
    if (!en.decision || !Number.isInteger(en.decision.eventId)) continue;
    appendEvent(events, 'reward', { playerId, soldierId: null, netId }, { decisionEventId: en.decision.eventId, terms: en.terms, own: en.own, team: en.team, effective: en.effective, normalized, tau }, turnOf(events, en.decision.eventId));
    n++;
  }
  return n;
}
export function emotionEvents(events, emotions, { playerId, netId = null } = {}) {
  let n = 0;
  for (const em of emotions || []) {
    if (!Number.isInteger(em.decisionEventId)) continue;
    const { decisionEventId, hope, fear, joy, disappointment, surprise, V, advantage, valueSource } = em;
    appendEvent(events, 'emotion', { playerId, soldierId: null, netId }, { decisionEventId, hope, fear, joy, disappointment, surprise, V, advantage, valueSource }, turnOf(events, decisionEventId));
    n++;
  }
  return n;
}

// ---------- neuronas con nombre (§9, §12.7) ----------
function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
export function nameNeurons(genome, samples, { m = Infinity, min = 50, threshold = 0.3 } = {}) {
  const g = normalize(genome);
  const net = compile(g);
  const use = (samples || []).filter((s) => s && s.obs).slice(0, Number.isFinite(m) ? m : undefined);
  const byId = new Map(g.blocks.map((b) => [b.id, b]));
  const custom = (g.names && g.names.neurons) || {};
  const out = {};
  const targets = g.blocks.filter((b) => b.type === 'dense' || BLOCK_FLAGS.isMemory(b.type));
  if (use.length < min) {
    for (const b of targets) out[b.id] = Array.from({ length: b.params.units }, (_, i) => ({ index: i, name: custom[b.id] && custom[b.id][i] ? custom[b.id][i] : 'sin datos', corr: 0, feature: null, m: use.length, custom: !!(custom[b.id] && custom[b.id][i]) }));
    return out;
  }
  // columnas de entrada nombradas: contexto (por decisión) y candidatos/destinos (por fila)
  const eyes = g.blocks.filter((b) => b.type.startsWith('eye.'));
  const ctxFeatures = [], rowFeatures = [];
  for (const e of eyes) {
    const stream = BLOCKS[e.type].streams.out;
    const layout = eyeLayout(e);
    for (const l of layout) (stream === 'ctx' ? ctxFeatures : rowFeatures).push({ eye: e.id, stream, index: l.index, name: `${l.name}` });
  }
  const acts = use.map((s) => { let st = net.zeroState(); const o = net.forward(s.obs, st); return o.activations; });
  for (const b of targets) {
    const units = b.params.units;
    const stream = net.streams[b.id];
    const rowsPer = (k) => { const a = acts[k][b.id]; return stream === 'ctx' ? [a] : (Array.isArray(a) ? a : [a]); };
    const cols = [];
    const unitSeries = Array.from({ length: units }, () => []);
    const featureSeries = new Map();
    const push = (key, v) => { (featureSeries.get(key) || featureSeries.set(key, []).get(key)).push(v); };
    for (let k = 0; k < use.length; k++) {
      const rows = rowsPer(k);
      const obs = use[k].obs, dec = use[k].decision;
      rows.forEach((row, r) => {
        for (let u = 0; u < units; u++) unitSeries[u].push(row[u]);
        for (const f of ctxFeatures) { const v = obs.ctx && obs.ctx[f.eye] ? obs.ctx[f.eye][f.index] : 0; push(f.name, v); }
        if (stream !== 'ctx') {
          for (const f of rowFeatures) { if (f.stream !== stream) continue; const src = obs[stream] && obs[stream][f.eye]; const v = src && src[r] ? src[r][f.index] : 0; push(f.name, v); }
          if (stream === 'cand') {
            const sim = dec && Array.isArray(dec.candidates) && dec.candidates[r] ? dec.candidates[r].sim : null;
            push('kill', sim && sim.type === 'kill' ? 1 : 0); push('suicide', sim && sim.type === 'suicide' ? 1 : 0);
          }
        }
      });
    }
    void cols;
    out[b.id] = Array.from({ length: units }, (_, i) => {
      let best = { name: null, corr: 0 };
      for (const [name, series] of featureSeries) { const c = pearson(unitSeries[i], series); if (Math.abs(c) > Math.abs(best.corr)) best = { name, corr: c }; }
      const own = custom[b.id] && custom[b.id][i];
      const auto = Math.abs(best.corr) > threshold ? best.name : 'sin nombre claro';
      return { index: i, name: own || auto, auto, corr: best.corr, feature: best.name, m: use.length, custom: !!own };
    });
  }
  return out;
}

// ---------- diario (§10, §12.8): plantillas fijas verificables ----------
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));
export function diaryPhrase(entry) {
  const ref = { log: entry.id };
  const S = (value) => ({ value, ref });
  let c;
  switch (entry.type) {
    case 'lesson': c = compose('Lo que más cambió fue {name} {blockId} ({pct} %)', { name: S(entry.name || 'bloque'), blockId: S(entry.blockId), pct: S(Math.round((entry.relChange || 0) * 1000) / 10) }); break;
    case 'milestone': c = compose('Hito: tasa de victorias {value} en las últimas {n}', { value: S(fmt(entry.value)), n: S(entry.n ?? 20) }); break;
    case 'challenge': c = compose('Reto de {challenger} a {queen}: {result}', { challenger: S(entry.challenger), queen: S(entry.queen), result: S(entry.result === 'challenger' ? 'ganó la retadora' : entry.result === 'tie' ? 'empate, la reina conserva el trono' : 'la reina defendió el trono') }); break;
    case 'exam': c = compose('Boletín: puntería {aim}, cobertura {cover}, supervivencia {survival}, adaptación {adaptation}', { aim: S(fmt(entry.aim)), cover: S(fmt(entry.cover)), survival: S(fmt(entry.survival)), adaptation: S(fmt(entry.adaptation)) }); break;
    case 'reign.start': c = compose('{queen} se sienta en el trono', { queen: S(entry.queen || entry.netId) }); break;
    case 'reign.end': c = compose('{netId} pierde el trono', { netId: S(entry.netId) }); break;
    case 'dynasty': c = compose('Casa {house}: {event}', { house: S(entry.house), event: S(entry.event) }); break;
    case 'update': c = compose('Sueño de {games} partidas: pérdida {loss}', { games: S(entry.games), loss: S(fmt(entry.loss || 0)) }); break;
    case 'slap': case 'caress': c = compose('{kind} del usuario en la partida {game}', { kind: S(entry.type === 'slap' ? 'Bofetada' : 'Caricia'), game: S(entry.game) }); break;
    default: return null;
  }
  return phrase(entry.type, entry.netId || null, c, entry.ts || Date.now());
}
