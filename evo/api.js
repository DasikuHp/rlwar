// API REST del laboratorio (spec/08). Parte F2/F3: catálogo, plantillas y redes (CRUD, validar,
// exportar/importar). Nunca 500 por una entrada mala: 400/404/409 con mensajes en español.
import { BLOCKS, LIMITS, validate, normalize, countParams, DEFAULT_TRAITS, TRAIT_RANGES, DEFAULT_REWARD, REWARD_TERMS, DEFAULT_LEARNING, LEARNING_RANGES, DEFAULT_IMAGINATION, CHARACTERS } from '../shared/genome.js';
import { eyeLayout } from '../shared/percept.js';
import { TEMPLATES } from '../shared/templates.js';
import { listNets, loadNet, saveNet, deleteNet, entryOf } from './store.js';
import { createTrainer, makeLearner, feedbackTarget, feedbackFromGame } from './train.js';
import { runDuel, newDuelId, LEARNING_MODES, SPEEDS } from './duel.js';
import { challenge, throneView, foundDynasties, runGeneration, readThroneFull, genealogyView, registerBirth, vacateNet } from './throne.js';
import { loadGame, appendLog, readLog, loadLogEntry, listGames, saveGame, loadGameNets, readFeedback, writeFeedback, readApplied, appendApplied, netsDir } from './store.js';
import { nameNeurons, diaryPhrase, memoryOf } from './truth.js';
import { runBulletin } from './exam.js';
import { compile } from '../shared/nn.js';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mutate, mutationConfig, slugify } from './mutate.js';
import { diffGenomes } from './diff.js';
import { runPretournamentAsync } from './children.js';
import { readThrone } from './store.js';
import { analyzeGenome, weightShapes, repair } from '../shared/genome.js';
import { makeRng, randomSeed } from '../shared/rng.js';

// ---------- entrenos y SSE global (spec/04 §9.6) ----------
const trainings = new Map();
// trabajos (spec/08 §5): hijos + pre-torneo; más adelante exámenes y generaciones
const jobs = new Map();
let jobSeq = 1;
const jobView = (j) => ({ id: j.id, kind: j.kind, status: j.status, progress: j.progress, result: j.result, error: j.error, netId: j.netId, createdAt: j.createdAt });
function startChildrenJob({ genome, n, mutation, games, opponent, soldiers, seed }) {
  const job = { id: `j${jobSeq++}`, kind: 'children', status: 'running', progress: { done: 0, total: n * games }, result: null, error: null, netId: genome.id, createdAt: Date.now() };
  jobs.set(job.id, job);
  (async () => {
    try {
      await new Promise((r) => setImmediate(r));
      const existing = new Set(listNets().map((x) => x.id));
      const children = [];
      for (let k = 0; k < n; k++) {
        const { child } = mutate(genome, mutation, makeRng(seed + k), { sibling: k, existingIds: existing });
        existing.add(child.id);
        const r = saveNet(child);
        if (!r.ok) throw new Error(`el hijo ${child.id} no se pudo guardar: ${JSON.stringify(r.errors && r.errors[0])}`);
        registerBirth(loadNet(child.id));
        children.push(loadNet(child.id));
      }
      const res = await runPretournamentAsync({ children, opponent, games, seed, soldiers, onGame: (done, total) => { job.progress = { done, total }; pushEvent('job', jobView(job)); } });
      job.status = 'done';
      job.result = { parentId: genome.id, opponentId: opponent.id, soldiers: res.soldiers, seed, ranking: res.ranking };
      pushEvent('job', jobView(job));
      pushEvent('children', { jobId: job.id, parentId: genome.id, ranking: res.ranking });
    } catch (e) {
      job.status = 'error'; job.error = e.message;
      pushEvent('job', jobView(job));
      pushEvent('error', { message: `hijos de ${genome.id}: ${e.message}` });
    }
  })();
  return job;
}
const sseClients = new Set();
function pushEvent(ev, data) { for (const res of sseClients) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignorar */ } } }
const activeTraining = (netId) => [...trainings.values()].find((t) => t.netId === netId && ['queued', 'running', 'paused'].includes(t.status)) || null;
function trainingView(t, full = false) {
  const v = { id: t.id, netId: t.netId, status: t.status, games: t.games, updates: t.updates, steps: t.steps || 0, startedAt: t.startedAt, error: t.error };
  if (full) Object.assign(v, { elapsedMs: t.startedAt ? Date.now() - t.startedAt : 0, curve: t.curve.slice(-500), sampleGames: t.sampleGames || [], rooms: t.rooms, lastLesson: t.lastLesson, config: { ...t.config, genome: undefined } });
  return v;
}
// ---------- duelos (spec/06 §1, §6.5) ----------
const duels = new Map();
const duelView = (d) => ({ id: d.id, a: d.a, b: d.b, status: d.status, learning: d.learning, speed: d.speed, throne: d.throne, soldiers: d.soldiers, seed: d.seed, games: d.games, wins: d.wins, killDiff: d.killDiff, winner: d.winner, tie: d.tie, ms: d.ms, roomCodes: d.roomCodes, startedAt: d.startedAt });
function startDuel(opts) {
  const id = newDuelId();
  const holder = { id, rec: { id, a: opts.a, b: opts.b, status: 'running', learning: opts.learning, speed: opts.speed, throne: !!opts.throne, soldiers: opts.soldiers, seed: opts.seed, games: [], wins: {}, killDiff: 0, winner: null, tie: false, ms: 0, roomCodes: [], startedAt: Date.now() }, stop: false };
  duels.set(id, holder);
  holder.promise = runDuel({ ...opts, id, onStart: (rec) => { holder.rec = rec; }, shouldStop: () => holder.stop, onGame: (k, game, rec) => { holder.rec = rec; pushEvent('duel', { id, game, wins: rec.wins }); } })
    .then((rec) => { holder.rec = rec; pushEvent('duel', { id, result: duelView(rec) }); appendLog({ type: 'duel', ...duelView(rec), games: undefined }); return rec; })
    .catch((e) => { holder.rec.status = 'error'; holder.rec.error = e.message; pushEvent('error', { message: `duelo ${id}: ${e.message}` }); return holder.rec; });
  return { id, promise: holder.promise, holder };
}
function startGenerationJob(body) {
  const job = { id: `j${jobSeq++}`, kind: 'generation', status: 'running', progress: { done: 0, total: 6 }, result: null, error: null, netId: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  (async () => {
    try {
      await new Promise((r) => setImmediate(r));
      const res = await runGeneration(body, {
        onEvent: (ev) => { if (ev.type === 'dynasty') pushEvent('dynasty', { house: ev.house, event: ev.event, ...ev }); },
        onProgress: (done, total) => { job.progress = { done, total }; pushEvent('job', jobView(job)); },
        registerJob: (kind, netId) => { const j = { id: `j${jobSeq++}`, kind, status: 'running', progress: { done: 0, total: 0 }, result: null, error: null, netId, createdAt: Date.now() }; jobs.set(j.id, j); return j.id; },
        finishJob: (id, result) => { const j = jobs.get(id); if (j) { j.status = 'done'; j.result = result; pushEvent('job', jobView(j)); pushEvent('children', { jobId: id, parentId: result.parentId, ranking: result.ranking }); } },
        registerTraining: (tr) => { trainings.set(tr.id, tr); tr.on('training', () => pushEvent('training', trainingView(tr))); },
        startDuel: (opts) => startDuel(opts),
      });
      job.status = 'done'; job.result = res;
      pushEvent('job', jobView(job));
    } catch (e) { job.status = 'error'; job.error = e.message; pushEvent('job', jobView(job)); pushEvent('error', { message: `generación: ${e.message}` }); }
  })();
  return job;
}
function startExamJob(genome) {
  const job = { id: `j${jobSeq++}`, kind: 'exam', status: 'running', progress: { done: 0, total: 96 }, result: null, error: null, netId: genome.id, createdAt: Date.now() };
  jobs.set(job.id, job);
  (async () => {
    try {
      let done = 0;
      const res = await runBulletin(genome, { onScene: () => { done++; if (done % 10 === 0) { job.progress = { done, total: 96 }; pushEvent('job', jobView(job)); } } });
      const out = { netId: genome.id, ts: Date.now(), aim: res.aim, cover: res.cover, survival: res.survival, adaptation: res.adaptation, details: res.details, seeds: res.seeds };
      const dir = join(netsDir(), genome.id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file = join(dir, 'bulletin.json'), tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(out)); renameSync(tmp, file);
      const logId = appendLog({ type: 'exam', netId: genome.id, aim: res.aim, cover: res.cover, survival: res.survival, adaptation: res.adaptation, seeds: res.seeds });
      job.status = 'done'; job.progress = { done: 96, total: 96 }; job.result = { ...out, logId };
      pushEvent('job', jobView(job));
      pushEvent('exam', { netId: genome.id, aim: res.aim, cover: res.cover, survival: res.survival, adaptation: res.adaptation, logId });
    } catch (e) { job.status = 'error'; job.error = e.message; pushEvent('job', jobView(job)); pushEvent('error', { message: `examen de ${genome.id}: ${e.message}` }); }
  })();
  return job;
}
function loadBulletin(netId) {
  const file = join(netsDir(), netId, 'bulletin.json');
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
}
// muestras para las neuronas: trayectorias de las partidas guardadas de la red (más recientes primero, ≤ 500)
function neuronSamples(netId, limit = 500) {
  const out = [];
  const games = listGames({ netId }).reverse();
  for (const meta of games) {
    const g = loadGame(meta.gameId);
    if (!g || !g.trajectories) continue;
    const steps = Object.values(g.trajectories).filter((tr) => tr && tr.netId === netId).flatMap((tr) => Object.values(tr.soldiers || {}).flat());
    steps.sort((a, b) => ((b.decision && b.decision.eventId) || 0) - ((a.decision && a.decision.eventId) || 0));
    for (const st of steps) { if (st && st.obs && st.phase === 'shoot') out.push({ obs: st.obs, decision: st.decision }); if (out.length >= limit) return out; }
  }
  return out;
}
const DIARY_KINDS = new Set(['lesson', 'milestone', 'reign.start', 'reign.end', 'challenge', 'exam']);
const CHRONICLE_KINDS = new Set(['reign.start', 'reign.end', 'challenge', 'dynasty']);
function diaryEntries(filter) {
  const out = [];
  for (const e of readLog()) {
    if (!filter(e)) continue;
    const ph = diaryPhrase(e);
    if (ph) out.push({ ...ph, id: e.id });
  }
  return out.reverse();
}
// moviola: activaciones de la decisión del turno n reproduciendo la trayectoria del soldado (spec/07 §12.8)
function brainOf(gameId, turn, playerId) {
  const g = loadGame(gameId);
  if (!g) return { status: 404, error: 'Partida no encontrada' };
  const decisions = g.events.filter((e) => e.type === 'decision' && e.turn === turn && (!playerId || e.actor.playerId === playerId) && !e.data.truncated);
  const dec = decisions[0];
  if (!dec) return { status: 404, error: `No hay decisión registrada en el turno ${turn}` };
  const tr = g.trajectories && g.trajectories[dec.actor.playerId];
  if (!tr) return { status: 404, error: 'La partida no guarda la trayectoria de ese jugador' };
  const steps = (tr.soldiers && tr.soldiers[dec.actor.soldierId]) || [];
  const idx = steps.findIndex((s) => s.decision && s.decision.eventId === dec.id);
  if (idx < 0) return { status: 404, error: 'La decisión no está en la trayectoria' };
  const nets = loadGameNets(gameId);
  const genome = (nets && nets[tr.netId]) || loadNet(tr.netId);
  if (!genome) return { status: 404, error: `Red no encontrada: ${tr.netId}` };
  const net = compile(genome);
  let st = net.zeroState(), out = null;
  for (let i = 0; i <= idx; i++) { out = net.forward(steps[i].obs, st); st = out.state; }
  const activations = {}; for (const [id, a] of Object.entries(out.activations)) activations[id] = Array.isArray(a) && a[0] && a[0].length !== undefined ? a.map((row) => Array.from(row)) : Array.from(a);
  const attention = {}; for (const [k, v] of Object.entries(out.attention || {})) attention[k] = v.map((h) => Array.from(h));
  return { status: 200, body: { decision: { ...dec.data, eventId: dec.id, id: dec.id, turn: dec.turn, actor: dec.actor }, activations, attention, outputs: { choose: out.outputs.choose ? Array.from(out.outputs.choose.scores) : null, value: out.outputs.value ?? null }, approx: !(nets && nets[tr.netId]), netId: tr.netId } };
}

function throneHooks() {
  return {
    onEvent: (ev) => { pushEvent('throne', { queen: readThroneFull().queen, event: ev.type, ...ev }); },
    startDuel: (opts) => startDuel(opts),
  };
}

// ---------- exhibiciones (spec/04 §10.3): salas creadas por POST /api/rooms ----------
const exhibitionRival = (room, team) => {
  const p = room.players.find((q) => q.team !== team);
  if (!p) return null;
  return p.agentType === 'net' && p.genome ? { type: 'net', genome: p.genome, name: p.name, learn: false } : { type: p.agentType, level: p.level || 2, temperature: p.temperature || 0 };
};
const logUpdate = (netId, room, r, extra = {}) => {
  const refs = [{ game: room.gameId }];
  appendLog({ type: 'update', kind: r.update.kind, netId, roomCode: room.code, games: extra.games, loss: r.update.loss, entropy: r.update.entropy, gradNorm: r.update.gradNorm, meanFitness: r.update.meanFitness, bestFitness: r.update.bestFitness, top: r.update.top, refs });
  if (r.lesson) appendLog({ type: 'lesson', netId, roomCode: room.code, blockId: r.lesson.blockId, name: r.lesson.name, relChange: r.lesson.relChange, bulb: r.lesson.bulb, refs });
  pushEvent('sleep', { netId, roomCode: room.code, games: extra.games, update: r.update });
  if (r.lesson) pushEvent('lesson', { netId, roomCode: room.code, lesson: r.lesson });
};
export function onExhibitionOver(room) {
  const nets = room.players.filter((p) => p.agentType === 'net' && p.netId);
  if (!nets.length || !room.gameId) return;
  const trajectories = {};
  for (const p of nets) if (room.agents[p.id]) trajectories[p.id] = { netId: p.netId, soldiers: room.agents[p.id].trajectories };
  const side = (team) => room.players.find((p) => p.team === team);
  const idOf = (p) => (p ? p.netId || p.agentType || p.name : null);
  const winner = room.result && room.result.winner ? idOf(side(room.result.winner)) : null;
  saveGame({ gameId: room.gameId, kind: 'exhibition', roomCode: room.code, seed: room.seed, soldiers: room.soldiersPerPlayer, left: idOf(side('left')), right: idOf(side('right')), nets: [...new Set(nets.map((p) => p.netId))], winner, kills: Object.fromEntries(room.players.map((p) => [idOf(p), p.kills || 0])), ts: Date.now() }, room.events, trajectories);
  const byNet = new Map();
  for (const p of nets) (byNet.get(p.netId) || byNet.set(p.netId, []).get(p.netId)).push(p);
  for (const [netId, players] of byNet) {
    if (activeTraining(netId)) { appendLog({ type: 'exhibition.skipped', netId, roomCode: room.code, reason: 'la red está entrenando' }); continue; }
    const disk = loadNet(netId);
    if (!disk) continue;
    const L = makeLearner(disk);
    const games = players.map((p) => ({ events: room.events, trajectory: trajectories[p.id] || { netId, soldiers: {} }, playerId: p.id }));
    L.addStats({ games: players.length }); // una exhibición suma partidas, nunca victorias ni bajas (spec/04 §7)
    if (!players.some((p) => p.learn)) { L.absorb(games); L.save(); continue; }
    const r = L.learn(games); // gradiente (o solo memoria si la red es de evolución)
    L.save();
    if (r) logUpdate(netId, room, r, { games: games.length });
    if (L.method === 'evolution' || L.method === 'both') {
      const rival = exhibitionRival(room, players[0].team);
      (async () => {
        const out = await L.evolve({ rival, seed: room.seed, soldiers: room.soldiersPerPlayer });
        if (activeTraining(netId)) { appendLog({ type: 'exhibition.skipped', netId, roomCode: room.code, reason: 'empezó un entreno durante la evolución' }); return; }
        L.save();
        logUpdate(netId, room, out, { games: out.update.games });
      })().catch((e) => pushEvent('error', { message: `exhibición ${room.code}: ${e.message}` }));
    }
  }
}

function startTraining(body) {
  const t = createTrainer(body);
  t.on('training', () => pushEvent('training', trainingView(t)));
  t.on('curve', (d) => pushEvent('curve', { trainingId: t.id, netId: t.netId, point: d.point }));
  t.on('sleep', (d) => pushEvent('sleep', { trainingId: t.id, netId: t.netId, games: d.games, update: d.update }));
  t.on('lesson', (d) => pushEvent('lesson', { trainingId: t.id, netId: t.netId, lesson: d.lesson }));
  t.on('milestone', (d) => pushEvent('milestone', { trainingId: t.id, ...d }));
  t.on('error', (d) => pushEvent('error', { trainingId: t.id, message: d.message }));
  trainings.set(t.id, t);
  t.start();
  return t;
}

const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(JSON.stringify(obj));
};
const readText = (req, limit) => new Promise((resolve) => {
  let d = ''; let over = false;
  req.on('data', (c) => { d += c; if (d.length > limit) { over = true; req.destroy(); } });
  req.on('end', () => resolve({ text: d, over }));
  req.on('close', () => resolve({ text: d, over }));
});
const ID_RE = /^[a-z0-9-]{3,32}$/;

// ---------- catálogo (textos en español, spec/08 §1) ----------
const L = { A: 'aprendiz', B: 'artesano', C: 'cientifico' };
const FAMILIES = [
  { id: 'line', name: 'Recta', explain: 'Una línea recta hacia el objetivo, con pequeñas desviaciones (jitter) para afinar.', params: [{ key: 'jitter', name: 'Desviaciones', explain: 'Factores que multiplican la pendiente exacta: 0 es la recta perfecta.' }] },
  { id: 'parabola', name: 'Parábola', explain: 'Recta al objetivo más una curvatura: salta muros bajos o pasa por debajo.', params: [{ key: 'curvatures', name: 'Curvaturas', explain: 'Coeficiente de x²; positivo curva hacia arriba.' }] },
  { id: 'sine', name: 'Seno', explain: 'Recta al objetivo con una onda encima: sortea obstáculos alternos.', params: [{ key: 'amps', name: 'Amplitudes', explain: 'Altura de la onda (u).' }, { key: 'periods', name: 'Periodos', explain: 'Cuánto tarda en repetirse (u).' }] },
  { id: 'ode1', name: 'EDO (y\')', explain: 'La pendiente cambia con la posición: y\' = a·sin(x/k) + b. Trayectorias que serpentean.', params: [{ key: 'a', name: 'a', explain: 'Amplitud de la pendiente.' }, { key: 'k', name: 'k', explain: 'Periodo.' }, { key: 'b', name: 'b', explain: 'Pendiente base.' }] },
  { id: 'artillery', name: 'Artillería', explain: 'Parábola de cañón: y\'\' = −g con un ángulo inicial. Pasa por encima de casi todo.', params: [{ key: 'gravities', name: 'Gravedades', explain: 'Cuánto cae.' }, { key: 'angles', name: 'Ángulos', explain: 'Ángulo de salida (grados; positivo sube).' }] },
  { id: 'wild', name: 'Salvaje', explain: 'Las plantillas de Chaos: tangentes, senos de alta frecuencia, exponenciales… sorpresas.', params: [{ key: 'a', name: 'a', explain: 'Amplitud.' }, { key: 'k', name: 'k', explain: 'Escala.' }] },
];
const TRAITS = [
  { key: 'temperature', name: 'Temperatura', type: 'number', min: 0.05, max: 3, step: 0.05, default: 1, level: L.A, explain: 'Cuánto arriesga al elegir: baja = casi siempre el mejor candidato; alta = prueba cosas.', example: 'Con 0.1 dispara siempre su favorito; con 2 sorprende (y falla) más.' },
  { key: 'pulse', name: 'Pulso', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, level: L.B, explain: 'Ruido del ajuste fino (Ajustar y Moverse): cuánto tiembla la mano al afinar.', example: '0.1 afina con precisión; 0.5 explora más y acierta menos.' },
  { key: 'teamSpirit', name: 'Espíritu de equipo', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5, level: L.B, explain: 'Cuánto pesa la recompensa del equipo frente a la propia al aprender (τ).', example: '0 = egoísta (solo mis kills); 1 = solo importa que gane el equipo.' },
  { key: 'character', name: 'Carácter', type: 'enum', options: CHARACTERS.map((c) => ({ value: c, name: c, explain: 'estilo de la voz' })), default: 'frio', level: L.A, explain: 'Cómo habla: frío, chulo, dramático o desquiciado. Se hereda y muta.', example: 'Un "chulo" se burla al matar; un "frío" solo informa.' },
];
const REWARD_META = {
  kill: ['Matar', 'premia cada baja enemiga', 'agresiva: busca el kill'],
  die: ['Morir', 'castiga que maten a un soldado tuyo', 'cauta: no se expone'],
  friendlyFire: ['Fuego amigo', 'castiga matar a un aliado', 'cuidadosa con los compañeros'],
  graze: ['Rozar', 'premia pasar cerca de un enemigo sin matarlo', 'insistente: se acerca aunque falle'],
  win: ['Ganar', 'premia ganar la partida (a todos los soldados)', 'competitiva: juega a ganar'],
  lose: ['Perder', 'castiga perder la partida', 'temerosa de la derrota'],
  survive: ['Sobrevivir', 'premia a cada soldado vivo al final', 'cobarde: se esconde tras los muros y dispara poco'],
  cover: ['Cubrirse', 'premia moverse a un sitio donde te ven menos enemigos', 'escurridiza: se tapa tras cada tiro'],
  repeatExpr: ['Repetir tiro', 'castiga repetir una expresión reciente (etiqueta)', 'variada: no insiste con lo mismo'],
  nearFriendly: ['Casi fuego amigo', 'castiga pasar muy cerca de un aliado (etiqueta)', 'respetuosa con las líneas de sus compañeros'],
  slapCaress: ['Bofetada/caricia', 'cuánto pesa tu bofetada o caricia sobre una decisión', 'obediente: aprende de tus reacciones'],
};
const REWARD_TERMS_CAT = REWARD_TERMS.map((key) => ({ key, name: REWARD_META[key][0], type: 'number', min: -5, max: 5, step: 0.1, default: DEFAULT_REWARD[key], level: ['kill', 'die', 'win', 'survive'].includes(key) ? L.A : L.B, explain: REWARD_META[key][1], personality: REWARD_META[key][2] }));
const LEARN_META = {
  method: ['Cómo aprende', 'gradient = aprende de cada partida (RL); evolution = copias perturbadas y se queda con las mejores; both = las dos.', L.A],
  'gradient.lr': ['Tasa de aprendizaje', 'Tamaño de cada paso. Muy alta: se desestabiliza; muy baja: tarda.', L.B],
  'gradient.gamma': ['Descuento', 'Cuánto valen las recompensas futuras frente a las inmediatas.', L.C],
  'gradient.entropy': ['Curiosidad', 'Premio por mantener opciones abiertas (entropía). Evita encasillarse.', L.B],
  'gradient.clipNorm': ['Recorte del gradiente', 'Tope del tamaño del paso para que un turno raro no lo rompa todo.', L.C],
  'gradient.batchGames': ['Partidas por lote', 'Cuántas partidas se juntan antes de cada actualización (sueño).', L.C],
  'gradient.bpttSteps': ['Pasos de memoria', 'Cuántos turnos atrás llega el aprendizaje por la memoria.', L.C],
  'gradient.baseline': ['Referencia', 'Con qué se compara la recompensa: value (Corazonada), mean (media) o none.', L.C],
  'gradient.optimizer': ['Optimizador', 'adam (adaptativo, recomendado) o sgd (simple).', L.C],
  'gradient.adjustLearn': ['Aprender a ajustar', 'Si el bloque Ajustar aprende o se queda como está.', L.C],
  'evolution.population': ['Población', 'Copias perturbadas por paso de evolución.', L.B],
  'evolution.sigma': ['Ruido de la evolución', 'Tamaño de la perturbación de los pesos.', L.B],
  'evolution.lr': ['Paso de la evolución', 'Cuánto se mueve hacia las copias que mejor lo hicieron.', L.C],
  'evolution.gamesPerCandidate': ['Partidas por copia', 'Partidas que juega cada copia para medir su fitness.', L.C],
  'evolution.antithetic': ['Pares espejo', 'Cada perturbación se prueba también con signo contrario (menos ruido).', L.C],
  'evolution.rankNormalize': ['Normalizar por ranking', 'Usa el orden en vez del valor bruto del fitness.', L.C],
  'both.gradientGamesPerCycle': ['Partidas con gradiente por ciclo', 'En modo both: partidas de RL antes de cada paso evolutivo.', L.C],
  'both.evolutionStepsPerCycle': ['Pasos de evolución por ciclo', 'En modo both: pasos evolutivos por ciclo.', L.C],
  'sleep.lessonThreshold': ['Umbral de la bombilla', 'Cambio relativo mínimo para anunciar una lección.', L.C],
};
function learningCatalog() {
  const out = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') { walk(v, key); continue; }
      const meta = LEARN_META[key] || [key, '', L.C];
      const range = LEARNING_RANGES[key];
      const item = { key, name: meta[0], explain: meta[1], level: meta[2], default: v, type: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'enum' };
      if (range) { item.min = range[0]; item.max = range[1]; }
      if (key === 'method') item.options = ['gradient', 'evolution', 'both'].map((o) => ({ value: o, name: o }));
      if (key === 'gradient.baseline') item.options = ['value', 'mean', 'none'].map((o) => ({ value: o, name: o }));
      if (key === 'gradient.optimizer') item.options = ['adam', 'sgd'].map((o) => ({ value: o, name: o }));
      out.push(item);
    }
  };
  walk(DEFAULT_LEARNING, '');
  return out;
}
export function catalog() {
  return {
    blocks: Object.values(BLOCKS).map((b) => ({ ...b })),
    eyes: Object.values(BLOCKS).filter((b) => b.type.startsWith('eye.')).map((b) => ({ type: b.type, layout: eyeLayout({ id: 'x', type: b.type, params: {} }) })),
    families: FAMILIES.map((f) => ({ ...f, defaults: DEFAULT_IMAGINATION.families[f.id] })),
    traits: TRAITS,
    rewardTerms: REWARD_TERMS_CAT,
    learning: learningCatalog(),
    mutation: [],
    limits: LIMITS,
    levels: [L.A, L.B, L.C],
    defaults: { traits: DEFAULT_TRAITS, traitRanges: TRAIT_RANGES, reward: DEFAULT_REWARD, learning: DEFAULT_LEARNING, imagination: DEFAULT_IMAGINATION },
  };
}

// ---------- utilidades de ids ----------
export { slugify };
function uniqueId(base) {
  const taken = new Set(listNets().map((n) => n.id));
  if (!taken.has(base)) return base;
  for (let k = 2; k < 10000; k++) { const id = `${base.slice(0, 32 - String(k).length - 1)}-${k}`; if (!taken.has(id)) return id; }
  return `${base.slice(0, 20)}-${Date.now()}`;
}
const parseBody = (text) => { try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, error: e.message }; } };

// ---------- router ----------
// parts = ['api', 'lab', ...]
export async function labApi(req, res, parts, url) {
  const method = req.method;
  const seg = parts.slice(2);
  const bad = (code, message, extra = {}) => json(res, code, { error: message, ...extra });
  const body = async () => {
    const { text, over } = await readText(req, LIMITS.genomeBytes);
    if (over) return { ok: false, status: 413, error: `El cuerpo supera ${LIMITS.genomeBytes} bytes.` };
    const p = parseBody(text);
    return p.ok ? { ok: true, value: p.value } : { ok: false, status: 400, error: `JSON inválido: ${p.error}` };
  };

  if (seg[0] === 'catalog' && method === 'GET') return json(res, 200, catalog());
  if (seg[0] === 'events' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    const th = readThroneFull(); res.write(`event: hello\ndata: ${JSON.stringify({ throne: { queen: th.queen, since: th.since }, trainings: [...trainings.values()].map((t) => trainingView(t)), jobs: [...jobs.values()].map(jobView), duels: [...duels.values()].map((d) => duelView(d.rec)) })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 20000);
    req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
    return;
  }
  if (seg[0] === 'log' && method === 'GET') {
    if (seg.length === 1) { const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 100)); return json(res, 200, { entries: readLog({ limit }) }); }
    const e = loadLogEntry(seg[1]);
    return e ? json(res, 200, e) : bad(404, 'Entrada no encontrada');
  }
  if (seg[0] === 'chronicle' && method === 'GET') return json(res, 200, { entries: diaryEntries((e) => CHRONICLE_KINDS.has(e.type)) });
  if (seg[0] === 'games' && seg.length === 5 && seg[2] === 'turns' && seg[4] === 'brain' && method === 'GET') {
    const turn = Number(seg[3]);
    if (!Number.isInteger(turn)) return bad(400, 'turno inválido');
    const r = brainOf(seg[1], turn, url.searchParams.get('player'));
    return r.status === 200 ? json(res, 200, r.body) : bad(r.status, r.error);
  }
  if (seg[0] === 'games' && seg.length === 2 && method === 'GET') {
    const g = loadGame(seg[1]);
    return g ? json(res, 200, g) : bad(404, 'Partida no encontrada');
  }
  if (seg[0] === 'duels') {
    if (seg.length === 1 && method === 'GET') return json(res, 200, { duels: [...duels.values()].map((d) => duelView(d.rec)) });
    if (seg.length === 1 && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      for (const k of ['a', 'b']) if (typeof v[k] !== 'string' || !ID_RE.test(v[k]) || !loadNet(v[k])) return bad(404, `Red no encontrada: ${v[k]}`);
      if (v.a === v.b) return bad(400, 'Una red no puede batirse contra sí misma');
      const learning = v.learning ?? 'mix', speed = v.speed ?? 'turbo', soldiers = v.soldiers ?? 'random';
      if (!LEARNING_MODES.includes(learning)) return bad(400, `learning tiene que ser ${LEARNING_MODES.join(', ')}`);
      if (!SPEEDS.includes(speed)) return bad(400, `speed tiene que ser ${SPEEDS.join(', ')}`);
      if (!(soldiers === 'random' || (Number.isInteger(soldiers) && soldiers >= 1 && soldiers <= 4))) return bad(400, 'soldiers tiene que ser "random" o un entero entre 1 y 4');
      if (v.seed !== undefined && !(Number.isInteger(v.seed) && v.seed >= 0)) return bad(400, 'seed tiene que ser un entero ≥ 0');
      if (activeTraining(v.a) || activeTraining(v.b)) return bad(409, 'Una de las redes está entrenando: para el entreno antes del duelo');
      const d = startDuel({ a: v.a, b: v.b, learning, speed, soldiers, seed: v.seed === undefined ? randomSeed() : v.seed, throne: false });
      return json(res, 202, { id: d.id, status: 'running', roomCodes: d.holder.rec.roomCodes });
    }
    const h = duels.get(seg[1]);
    if (!h) return bad(404, 'Duelo no encontrado');
    if (seg.length === 2 && method === 'GET') return json(res, 200, duelView(h.rec));
    if (seg.length === 3 && seg[2] === 'stop' && method === 'POST') { h.stop = true; return json(res, 200, { ok: true, status: h.rec.status }); }
    return bad(404, 'Ruta desconocida');
  }
  if (seg[0] === 'throne') {
    if (seg.length === 1 && method === 'GET') return json(res, 200, throneView());
    if (seg.length === 2 && seg[1] === 'challenge' && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      if (typeof v.challenger !== 'string' || !ID_RE.test(v.challenger)) return bad(404, `Red no encontrada: ${v.challenger}`);
      if (v.learning !== undefined && !LEARNING_MODES.includes(v.learning)) return bad(400, `learning tiene que ser ${LEARNING_MODES.join(', ')}`);
      if (v.speed !== undefined && !SPEEDS.includes(v.speed)) return bad(400, `speed tiene que ser ${SPEEDS.join(', ')}`);
      if (activeTraining(v.challenger)) return bad(409, 'La retadora está entrenando: para el entreno antes del reto');
      let responded = false;
      const hooks = { ...throneHooks(), onDuelStart: ({ duelId, queen }) => { responded = true; json(res, 202, { duelId, queen, status: 'running' }); } };
      try {
        const r = await (async () => {
          const p = challenge({ challenger: v.challenger, learning: v.learning, speed: v.speed, seed: v.seed }, hooks);
          p.catch(() => {});
          return responded ? null : await p;
        })();
        if (responded) return;
        if (r) return json(res, 200, r);
        return;
      } catch (e) {
        if (responded) return;
        return bad(e.status || 500, e.message);
      }
    }
    return bad(404, 'Ruta desconocida');
  }
  if (seg[0] === 'hall-of-fame' && method === 'GET') return json(res, 200, { hallOfFame: readThroneFull().hallOfFame });
  if (seg[0] === 'genealogy' && method === 'GET') return json(res, 200, genealogyView());
  if (seg[0] === 'dynasties') {
    if (seg.length === 1 && method === 'GET') { const t = readThroneFull(); return json(res, 200, { A: t.dynasties.A, B: t.dynasties.B }); }
    if (seg.length === 1 && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      try { return json(res, 200, foundDynasties(b.value || {}, url.searchParams.get('house'))); } catch (e) { return bad(e.status || 500, e.message); }
    }
    if (seg.length === 2 && seg[1] === 'generation' && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const t = readThroneFull();
      if (!t.dynasties.A || !t.dynasties.B) return bad(400, 'Primero funda las dos casas (POST /api/lab/dynasties)');
      for (const h of ['A', 'B']) if (!t.dynasties[h].champion) return bad(400, `La casa ${t.dynasties[h].name} no tiene campeona: vuelve a fundarla con POST /api/lab/dynasties?house=${h}`);
      if (activeTraining(t.dynasties.A.champion) || activeTraining(t.dynasties.B.champion)) return bad(409, 'Una campeona está entrenando');
      const job = startGenerationJob(b.value || {});
      return json(res, 202, { jobId: job.id, status: job.status });
    }
    if (seg.length === 3 && seg[2] === 'challenge-throne' && method === 'POST') {
      const t = readThroneFull();
      const house = t.dynasties[seg[1]];
      if (!house) return bad(404, `Casa no encontrada: ${seg[1]}`);
      if (!house.champion) return bad(400, `La casa ${house.name} no tiene campeona: vuelve a fundarla con POST /api/lab/dynasties?house=${seg[1]}`);
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      let responded = false;
      const hooks = { ...throneHooks(), onDuelStart: ({ duelId, queen }) => { responded = true; json(res, 202, { duelId, queen, status: 'running' }); } };
      try {
        const p = challenge({ challenger: house.champion, learning: v.learning, speed: v.speed, seed: v.seed }, hooks);
        p.catch(() => {});
        const r = responded ? null : await p;
        if (responded) return;
        return json(res, 200, r);
      } catch (e) { if (responded) return; return bad(e.status || 500, e.message); }
    }
    return bad(404, 'Ruta desconocida');
  }
  if (seg[0] === 'jobs' && method === 'GET') {
    if (seg.length === 1) return json(res, 200, { jobs: [...jobs.values()].map(jobView) });
    const j = jobs.get(seg[1]);
    return j ? json(res, 200, jobView(j)) : bad(404, 'Trabajo no encontrado');
  }
  if (seg[0] === 'trainings') {
    if (seg.length === 1 && method === 'GET') return json(res, 200, { trainings: [...trainings.values()].map((t) => trainingView(t)) });
    if (seg.length === 1 && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      if (!loadNet(v.netId)) return bad(404, `Red no encontrada: ${v.netId}`);
      if (v.speed !== undefined && !['turbo', 'x1', 'x10'].includes(v.speed)) return bad(400, 'speed tiene que ser turbo, x1 o x10');
      const d = v.duration || { games: 100 };
      if ((d.games !== undefined && !(Number.isInteger(d.games) && d.games >= 1)) || (d.minutes !== undefined && !(d.minutes > 0)) || (d.plateau !== undefined && !(d.plateau && Number.isInteger(d.plateau.window) && d.plateau.window >= 1))) return bad(400, 'duración inválida: {games ≥ 1} | {minutes > 0} | {plateau:{window ≥ 1, minGain}}');
      if (v.workers !== undefined && !(Number.isInteger(v.workers) && v.workers >= 1 && v.workers <= 32)) return bad(400, 'workers entre 1 y 32');
      if (activeTraining(v.netId)) return bad(409, `La red ${v.netId} ya está entrenando`);
      if (v.exploiter) { const th = readThroneFull(); if (!th.queen) return bad(400, 'No hay reina: la retadora explotadora necesita una reina a la que explotar'); if (th.queen === v.netId) return bad(400, 'La reina no puede explotarse a sí misma'); }
      const t = startTraining({ ...v, duration: d });
      return json(res, 202, { id: t.id, status: t.status });
    }
    const t = trainings.get(seg[1]);
    if (!t) return bad(404, 'Entreno no encontrado');
    if (seg.length === 2 && method === 'GET') return json(res, 200, trainingView(t, true));
    if (seg.length === 3 && method === 'POST' && ['stop', 'pause', 'resume'].includes(seg[2])) { t[seg[2]](); return json(res, 200, { ok: true, status: t.status }); }
    return bad(404, 'Ruta desconocida');
  }
  if (seg[0] === 'templates' && method === 'GET') return json(res, 200, Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, why: t.why, genome: t.genome, paramCount: countParams(t.genome) })));

  if (seg[0] === 'nets') {
    const th = readThroneFull();
    if (seg.length === 1 && method === 'GET') return json(res, 200, { nets: listNets().map((n) => ({ ...n, isQueen: th.queen === n.id, house: th.dynasties.A && th.dynasties.A.champion === n.id ? 'A' : th.dynasties.B && th.dynasties.B.champion === n.id ? 'B' : null, training: !!activeTraining(n.id) })) });
    if (seg.length === 1 && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      if (v.genome) {
        const val = validate(v.genome);
        if (!val.ok) return json(res, 400, { error: 'Genoma inválido', errors: val.errors, warnings: val.warnings });
        if (loadNet(v.genome.id)) return bad(409, `Ya existe una red con id "${v.genome.id}".`);
        const r = saveNet(v.genome);
        registerBirth(loadNet(r.id));
        return json(res, 201, { id: r.id, genome: loadNet(r.id) });
      }
      const t = TEMPLATES[v.template];
      if (!t) return bad(400, `Plantilla desconocida: ${JSON.stringify(v.template)}. Plantillas: ${Object.keys(TEMPLATES).join(', ')}.`);
      const name = String(v.name || t.name.replace(/^\S+\s/, '')).slice(0, 32);
      const id = uniqueId(slugify(v.name || t.genome.id.replace(/^plantilla-/, '')));
      const genome = { ...JSON.parse(JSON.stringify(t.genome)), id, name };
      const r = saveNet(genome);
      if (!r.ok) return json(res, 400, { error: 'Genoma inválido', errors: r.errors });
      registerBirth(loadNet(id));
      return json(res, 201, { id, genome: loadNet(id) });
    }
    if (seg.length === 2 && seg[1] === 'import' && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const g = b.value;
      const val = validate(g);
      if (!val.ok) return json(res, 400, { error: 'Genoma inválido', errors: val.errors, warnings: val.warnings });
      let id = g.id;
      if (loadNet(id)) {
        if (url.searchParams.get('rename') !== '1') return bad(409, `Ya existe una red con id "${id}". Usa ?rename=1 para importarla con otro id.`);
        id = uniqueId(id);
      }
      const r = saveNet({ ...g, id });
      registerBirth(loadNet(r.id));
      return json(res, 201, { id: r.id, warnings: val.warnings });
    }
    const id = seg[1];
    if (!id || !ID_RE.test(id)) return bad(404, 'Red no encontrada');
    const genome = loadNet(id);
    if (!genome) return bad(404, `Red no encontrada: ${id}`);
    if (seg.length === 2) {
      if (method === 'GET') return json(res, 200, { genome, paramCount: countParams(genome), warnings: validate(genome).warnings });
      if ((method === 'DELETE' || method === 'PUT') && activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de editarla o borrarla.`);
      if (method === 'DELETE') {
        // la reina y las campeonas no se borran por accidente (spec/08 §4, spec/06 §7.1)
        const isQueen = th.queen === id, houses = ['A', 'B'].filter((h) => th.dynasties[h] && th.dynasties[h].champion === id);
        if ((isQueen || houses.length) && url.searchParams.get('force') !== '1') {
          return bad(409, isQueen ? `${genome.name} es la reina: si de verdad quieres dejar el trono vacío, bórrala con ?force=1.` : `${genome.name} es la campeona de ${houses.map((h) => th.dynasties[h].name).join(' y ')}: si de verdad quieres dejar la casa sin campeona, bórrala con ?force=1.`);
        }
        const ok = deleteNet(id);
        if (ok && (isQueen || houses.length)) vacateNet(id, { onEvent: (ev) => pushEvent(ev.type === 'dynasty' ? 'dynasty' : 'throne', ev.type === 'dynasty' ? { house: ev.house, event: ev.event, ...ev } : { queen: null, event: ev.type, ...ev }) });
        return json(res, 200, { ok });
      }
      if (method === 'PUT') {
        const b = await body();
        if (!b.ok) return bad(b.status, b.error);
        const g = b.value;
        if (!g || g.id !== id) return bad(400, `El id del genoma (${JSON.stringify(g && g.id)}) no coincide con la ruta (${id}).`);
        const val = validate(g);
        if (!val.ok) return json(res, 400, { error: 'Genoma inválido', errors: val.errors, warnings: val.warnings });
        saveNet(g);
        return json(res, 200, { ok: true, warnings: val.warnings });
      }
      return bad(405, 'Método no permitido');
    }
    if (seg.length === 3 && seg[2] === 'validate' && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const val = validate(b.value);
      return json(res, 200, { ok: val.ok, errors: val.errors, warnings: val.warnings, paramCount: val.ok ? countParams(b.value) : null });
    }
    // ----- F5: hijos, diferencias, cirugía (spec/05 §4, §5, §7, §10.4–10.5) -----
    if (seg.length === 3 && seg[2] === 'children' && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      const n = v.n ?? 4;
      if (!(Number.isInteger(n) && n >= 1 && n <= 16)) return bad(400, 'n tiene que ser un entero entre 1 y 16');
      const pt = v.pretournament || {};
      const games = pt.games ?? 4;
      if (!(Number.isInteger(games) && games >= 0 && games <= 20)) return bad(400, 'pretournament.games tiene que ser un entero entre 0 y 20');
      const soldiers = pt.soldiers ?? 'random';
      if (!(soldiers === 'random' || (Number.isInteger(soldiers) && soldiers >= 1 && soldiers <= 4))) return bad(400, 'pretournament.soldiers tiene que ser "random" o un entero entre 1 y 4');
      if (v.mutation !== undefined && (typeof v.mutation !== 'object' || v.mutation === null)) return bad(400, 'mutation tiene que ser un objeto (spec/05 §1)');
      const seed = v.seed === undefined ? randomSeed() : v.seed;
      if (!Number.isInteger(seed) || seed < 0) return bad(400, 'seed tiene que ser un entero ≥ 0');
      let opponent = null;
      if (pt.opponentId !== undefined && pt.opponentId !== null) { opponent = loadNet(pt.opponentId); if (!opponent) return bad(404, `Rival no encontrado: ${pt.opponentId}`); }
      if (!opponent) { const th = readThrone(); if (th && th.queen) opponent = loadNet(th.queen); }
      if (!opponent) opponent = genome;
      if (activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de pedir hijos.`);
      const job = startChildrenJob({ genome, n, mutation: mutationConfig(v.mutation), games, opponent, soldiers, seed });
      return json(res, 202, { jobId: job.id, status: job.status });
    }
    if (seg.length === 4 && seg[2] === 'diff' && method === 'GET') {
      const other = ID_RE.test(seg[3]) ? loadNet(seg[3]) : null;
      if (!other) return bad(404, `Red no encontrada: ${seg[3]}`);
      try { return json(res, 200, diffGenomes(genome, other)); } catch (e) { return bad(400, e.message); }
    }
    if (seg.length === 3 && seg[2] === 'frozen' && method === 'PUT') {
      if (activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de operarla.`);
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const list = b.value && b.value.blocks;
      if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) return bad(400, 'blocks tiene que ser una lista de ids de bloque');
      const ids = new Set(genome.blocks.map((x) => x.id));
      const missing = list.find((x) => !ids.has(x));
      if (missing !== undefined) return bad(400, `El bloque "${missing}" no existe en ${id}`);
      const frozen = [...new Set(list)];
      saveNet({ ...genome, frozen });
      return json(res, 200, { ok: true, frozen });
    }
    if (seg.length === 4 && seg[2] === 'weights' && method === 'PUT') {
      if (activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de operarla.`);
      const block = genome.blocks.find((x) => x.id === seg[3]);
      if (!block) return bad(404, `El bloque "${seg[3]}" no existe en ${id}`);
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const shapes = weightShapes(block, analyzeGenome(genome).dims[block.id]);
      if (!shapes) return bad(400, `El bloque ${BLOCKS[block.type].name} "${block.id}" no tiene pesos`);
      const errors = [];
      const w = b.value;
      if (!w || typeof w !== 'object' || Array.isArray(w)) return json(res, 400, { error: 'Pesos inválidos', errors: [{ code: 'weights-shape', blockId: block.id, message: 'El cuerpo tiene que ser un objeto {W:[…], b:[…]}' }] });
      for (const [key, arr] of Object.entries(w)) {
        if (!(key in shapes)) { errors.push({ code: 'weights-shape', blockId: block.id, message: `El bloque "${block.id}" no tiene pesos "${key}" (tiene: ${Object.keys(shapes).join(', ')})` }); continue; }
        if (!Array.isArray(arr) || arr.length !== shapes[key]) { errors.push({ code: 'weights-shape', blockId: block.id, message: `Los pesos "${key}" del bloque "${block.id}" tienen que tener ${shapes[key]} números (llegan ${Array.isArray(arr) ? arr.length : 'ninguno'})` }); continue; }
        const badIdx = arr.findIndex((x) => typeof x !== 'number' || !Number.isFinite(x));
        if (badIdx >= 0) errors.push({ code: 'weights-nan', blockId: block.id, message: `Los pesos "${key}" del bloque "${block.id}" llevan un valor que no es un número finito en la posición ${badIdx}` });
      }
      if (errors.length) return json(res, 400, { error: 'Pesos inválidos', errors });
      const g2 = { ...genome, weights: { ...genome.weights, [block.id]: { ...genome.weights[block.id], ...w } } };
      const val = validate(g2);
      if (!val.ok) return json(res, 400, { error: 'Genoma inválido', errors: val.errors });
      saveNet(g2);
      return json(res, 200, { ok: true, warnings: val.warnings });
    }
    if (seg.length === 3 && seg[2] === 'transplant' && method === 'POST') {
      if (activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de operarla.`);
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      const donor = ID_RE.test(String(v.fromNetId)) ? loadNet(v.fromNetId) : null;
      if (!donor) return bad(404, `Red donante no encontrada: ${v.fromNetId}`);
      const dblock = donor.blocks.find((x) => x.id === v.blockId);
      if (!dblock) return bad(404, `El bloque "${v.blockId}" no existe en ${donor.id}`);
      const g2 = JSON.parse(JSON.stringify(genome));
      let targetId;
      if (v.replaceBlockId !== undefined && v.replaceBlockId !== null) {
        const t = g2.blocks.find((x) => x.id === v.replaceBlockId);
        if (!t) return bad(404, `El bloque "${v.replaceBlockId}" no existe en ${id}`);
        t.type = dblock.type; t.params = JSON.parse(JSON.stringify(dblock.params));
        targetId = t.id;
      } else {
        const ids = new Set(g2.blocks.map((x) => x.id));
        targetId = dblock.id;
        for (let k = 2; ids.has(targetId); k++) targetId = `${dblock.id}-${k}`;
        g2.blocks.push({ id: targetId, type: dblock.type, params: JSON.parse(JSON.stringify(dblock.params)) });
      }
      if (donor.weights[dblock.id]) g2.weights[targetId] = JSON.parse(JSON.stringify(donor.weights[dblock.id])); else delete g2.weights[targetId];
      const rep = repair(g2, makeRng(genome.emblem));
      const val = validate(rep.genome);
      if (!val.ok) return json(res, 400, { error: 'El trasplante deja la red inválida', errors: val.errors });
      const warnings = rep.fixes.map((f) => `Formas distintas: ${f}`);
      const text = `Trasplanté ${BLOCKS[dblock.type].name} ${dblock.id} de ${donor.name} como ${targetId}${v.replaceBlockId ? ` (sustituye a ${v.replaceBlockId})` : ' (sin cables)'}${warnings.length ? '; pesos reiniciados' : ''}`;
      rep.genome.lineage.mutations.push({ op: 'transplant', from: donor.id, blockId: targetId, sourceBlockId: dblock.id, text });
      saveNet(rep.genome);
      return json(res, 200, { ok: true, blockId: targetId, warnings });
    }
    // ----- F7: boletín, diario, neuronas, bofetada/caricia, feedback (spec/07 §7, §9, §10, §12) -----
    if (seg.length === 3 && seg[2] === 'bulletin') {
      if (method === 'GET') { const b = loadBulletin(id); return b ? json(res, 200, b) : bad(404, 'Todavía no hay boletín: pide un examen con POST'); }
      if (method === 'POST') {
        if (activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes del examen.`);
        if (!validate(genome, { forPlay: true }).ok) return bad(400, 'La red no puede jugar (falta Elegir)');
        if ([...jobs.values()].some((j) => j.kind === 'exam' && j.netId === id && j.status === 'running')) return bad(409, 'Ya hay un examen en marcha para esta red');
        const job = startExamJob(genome);
        return json(res, 202, { jobId: job.id, status: job.status });
      }
    }
    if (seg.length === 3 && seg[2] === 'diary' && method === 'GET') return json(res, 200, { entries: diaryEntries((e) => e.netId === id && DIARY_KINDS.has(e.type)) });
    if (seg.length === 3 && seg[2] === 'feedback' && method === 'GET') return json(res, 200, { pending: readFeedback(id), applied: readApplied(id) });
    if (seg.length === 3 && seg[2] === 'memory' && method === 'GET') return json(res, 200, memoryOf(genome));
    if (seg.length === 3 && seg[2] === 'neurons' && method === 'GET') {
      const samples = neuronSamples(id, 500);
      const named = nameNeurons(genome, samples);
      const m = samples.length;
      return json(res, 200, { blocks: named, m });
    }
    if (seg.length === 5 && seg[2] === 'neurons' && method === 'PUT') {
      const block = genome.blocks.find((x) => x.id === seg[3]);
      if (!block || !(block.type === 'dense' || ['echo', 'gru', 'lstm', 'teamMemory'].includes(block.type))) return bad(404, `El bloque "${seg[3]}" no existe o no tiene neuronas`);
      const index = Number(seg[4]);
      if (!Number.isInteger(index) || index < 0 || index >= block.params.units) return bad(404, `La neurona ${seg[4]} no existe en ${block.id} (tiene ${block.params.units})`);
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const name = b.value && typeof b.value.name === 'string' ? b.value.name.trim().slice(0, 40) : '';
      if (!name) return bad(400, 'name tiene que ser un texto no vacío');
      const g2 = { ...genome, names: { ...(genome.names || {}), neurons: { ...((genome.names || {}).neurons || {}) } } };
      g2.names.neurons[block.id] = { ...(g2.names.neurons[block.id] || {}), [index]: name };
      saveNet(g2);
      appendLog({ type: 'neuron.name', netId: id, blockId: block.id, index, name, custom: true });
      return json(res, 200, { ok: true, blockId: block.id, index, name });
    }
    if (seg.length === 3 && (seg[2] === 'slap' || seg[2] === 'caress') && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      const game = loadGame(String(v.game || ''));
      if (!game) return bad(404, `Partida no encontrada: ${v.game}`);
      const target = feedbackTarget(game, Number(v.decisionEventId), id); // de esta red y con lo que vio (spec/04 §10.4)
      if (target.error) return bad(target.status, target.error);
      const dec = target.dec;
      const amount = v.amount === undefined ? 1 : Number(v.amount);
      if (!(amount > 0 && amount <= 10)) return bad(400, 'amount tiene que estar entre 0 y 10');
      const kind = seg[2];
      const term = 'slapCaress';
      const reward = (kind === 'slap' ? -1 : 1) * amount * (genome.reward.slapCaress ?? 1);
      const eid = game.events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
      game.events.push({ id: eid, t: Date.now(), game: game.meta.gameId, turn: dec.turn, type: kind, actor: { playerId: 'usuario', soldierId: null, netId: id }, data: { decisionEventId: dec.id, amount, term } });
      saveGame(game.meta, game.events, game.trajectories || null);
      if (activeTraining(id)) {
        // entrenando: el siguiente sueño la aplica con el mismo paso
        const pending = readFeedback(id);
        pending.push({ kind, game: game.meta.gameId, decisionEventId: dec.id, eventId: eid, amount, ts: Date.now() });
        writeFeedback(id, pending);
        appendLog({ type: kind, netId: id, game: game.meta.gameId, decisionEventId: dec.id, amount, term, applied: false });
        return json(res, 200, { ok: true, reward, kind, applied: false, queued: true });
      }
      const L = makeLearner(genome);
      const out = feedbackFromGame({ net: L.net, genome: L.genome, game, decisionEventId: dec.id, reward, kind, eventId: eid });
      if (out.error) return bad(out.status || 400, out.error);
      L.save();
      appendApplied(id, { kind, game: game.meta.gameId, decisionEventId: dec.id, amount, reward, pBefore: out.pBefore, pAfter: out.pAfter, relChange: out.relChange, ts: Date.now() });
      appendLog({ type: kind, netId: id, game: game.meta.gameId, decisionEventId: dec.id, amount, term, applied: true, pBefore: out.pBefore, pAfter: out.pAfter, relChange: out.relChange });
      return json(res, 200, { ok: true, reward, kind, applied: true, update: { pBefore: out.pBefore, pAfter: out.pAfter, relChange: out.relChange, top: out.top } });
    }
    if (seg.length === 3 && seg[2] === 'export' && method === 'GET') {
      return json(res, 200, normalize(genome), { 'Content-Disposition': `attachment; filename="${id}.json"` });
    }
    return bad(404, 'Ruta desconocida');
  }
  return bad(404, 'Ruta desconocida');
}
