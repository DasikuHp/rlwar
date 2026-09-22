// API REST del laboratorio (spec/08). Parte F2/F3: catálogo, plantillas y redes (CRUD, validar,
// exportar/importar). Nunca 500 por una entrada mala: 400/404/409 con mensajes en español.
import { BLOCKS, LIMITS, validate, normalize, countParams, DEFAULT_TRAITS, TRAIT_RANGES, DEFAULT_REWARD, REWARD_TERMS, DEFAULT_LEARNING, LEARNING_RANGES, DEFAULT_IMAGINATION, CHARACTERS } from '../shared/genome.js';
import { eyeLayout } from '../shared/percept.js';
import { TEMPLATES } from '../shared/templates.js';
import { listNets, loadNet, saveNet, deleteNet, entryOf } from './store.js';
import { createTrainer } from './train.js';

// ---------- entrenos y SSE global (spec/04 §9.6) ----------
const trainings = new Map();
const sseClients = new Set();
function pushEvent(ev, data) { for (const res of sseClients) { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignorar */ } } }
const activeTraining = (netId) => [...trainings.values()].find((t) => t.netId === netId && ['queued', 'running', 'paused'].includes(t.status)) || null;
function trainingView(t, full = false) {
  const v = { id: t.id, netId: t.netId, status: t.status, games: t.games, updates: t.updates, startedAt: t.startedAt, error: t.error };
  if (full) Object.assign(v, { elapsedMs: t.startedAt ? Date.now() - t.startedAt : 0, curve: t.curve.slice(-500), sampleGames: [], rooms: t.rooms, lastLesson: t.lastLesson, config: { ...t.config, genome: undefined } });
  return v;
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
export function slugify(name) {
  let s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length < 3) s = `red-${s}`.replace(/-+$/, '');
  if (s.length < 3) s = 'red-nueva';
  return s.slice(0, 32).replace(/-+$/, '');
}
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
    res.write(`event: hello\ndata: ${JSON.stringify({ trainings: [...trainings.values()].map((t) => trainingView(t)) })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 20000);
    req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
    return;
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
    if (seg.length === 1 && method === 'GET') return json(res, 200, { nets: listNets().map((n) => ({ ...n, isQueen: false, house: null, training: !!activeTraining(n.id) })) });
    if (seg.length === 1 && method === 'POST') {
      const b = await body();
      if (!b.ok) return bad(b.status, b.error);
      const v = b.value || {};
      if (v.genome) {
        const val = validate(v.genome);
        if (!val.ok) return json(res, 400, { error: 'Genoma inválido', errors: val.errors, warnings: val.warnings });
        if (loadNet(v.genome.id)) return bad(409, `Ya existe una red con id "${v.genome.id}".`);
        const r = saveNet(v.genome);
        return json(res, 201, { id: r.id, genome: loadNet(r.id) });
      }
      const t = TEMPLATES[v.template];
      if (!t) return bad(400, `Plantilla desconocida: ${JSON.stringify(v.template)}. Plantillas: ${Object.keys(TEMPLATES).join(', ')}.`);
      const name = String(v.name || t.name.replace(/^\S+\s/, '')).slice(0, 32);
      const id = uniqueId(slugify(v.name || t.genome.id.replace(/^plantilla-/, '')));
      const genome = { ...JSON.parse(JSON.stringify(t.genome)), id, name };
      const r = saveNet(genome);
      if (!r.ok) return json(res, 400, { error: 'Genoma inválido', errors: r.errors });
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
      return json(res, 201, { id: r.id, warnings: val.warnings });
    }
    const id = seg[1];
    if (!id || !ID_RE.test(id)) return bad(404, 'Red no encontrada');
    const genome = loadNet(id);
    if (!genome) return bad(404, `Red no encontrada: ${id}`);
    if (seg.length === 2) {
      if (method === 'GET') return json(res, 200, { genome, paramCount: countParams(genome), warnings: validate(genome).warnings });
      if ((method === 'DELETE' || method === 'PUT') && activeTraining(id)) return bad(409, `La red ${id} está entrenando: para el entreno antes de editarla o borrarla.`);
      if (method === 'DELETE') return json(res, 200, { ok: deleteNet(id) });
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
    if (seg.length === 3 && seg[2] === 'export' && method === 'GET') {
      return json(res, 200, normalize(genome), { 'Content-Disposition': `attachment; filename="${id}.json"` });
    }
    return bad(404, 'Ruta desconocida');
  }
  return bad(404, 'Ruta desconocida');
}
