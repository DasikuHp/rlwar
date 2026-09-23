// Receta de entreno (spec/04 §11): lo que un entreno trae solo para ese entreno, sin cambiar la red guardada.
// Validación, programas que bajan solos, recompensa de práctica, currículo por lecciones y la mejor versión. Puro.
import { DEFAULT_LEARNING, LEARNING_RANGES, TRAIT_RANGES, REWARD_TERMS, BLOCKS } from '../shared/genome.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const INTS = new Set(['gradient.batchGames', 'gradient.bpttSteps', 'evolution.population', 'evolution.gamesPerCandidate', 'both.gradientGamesPerCycle', 'both.evolutionStepsPerCycle']);
const ENUMS = { 'gradient.baseline': ['value', 'mean', 'none'], 'gradient.optimizer': ['adam', 'sgd'] };
const BOOLS = new Set(['gradient.adjustLearn', 'evolution.antithetic', 'evolution.rankNormalize']);
const SECTIONS = ['gradient', 'evolution', 'both', 'sleep'];
const SCHEDULES = { lr: 'gradient.lr', entropy: 'gradient.entropy', sigma: 'evolution.sigma', temperature: null };
const SHAPES = ['constant', 'linear', 'cosine'];
const REWARD_RANGE = [-5, 5];
const RECIPE_KEYS = ['learning', 'schedule', 'reward', 'frozen', 'curriculum', 'exam', 'keepBest'];

// ---------- validación ----------
function checkLearning(raw, err) {
  if (raw === undefined) return;
  if (!isObj(raw)) { err('learning', '"learning" tiene que ser un objeto con las partes del aprendizaje que cambian.', '"learning": {"gradient": {"lr": 0.01}}'); return; }
  for (const [sec, val] of Object.entries(raw)) {
    if (sec === 'method') {
      if (!['gradient', 'evolution', 'both'].includes(val)) err('learning.method', '"learning.method" tiene que ser gradient, evolution o both.', '"method": "both"');
      continue;
    }
    if (!SECTIONS.includes(sec)) { err(`learning.${sec}`, `"learning.${sec}" no existe: las partes son method, gradient, evolution, both y sleep.`, '"learning": {"evolution": {"sigma": 0.05}}'); continue; }
    if (!isObj(val)) { err(`learning.${sec}`, `"learning.${sec}" tiene que ser un objeto.`, `"${sec}": {}`); continue; }
    for (const [key, v] of Object.entries(val)) {
      const path = `${sec}.${key}`;
      const def = DEFAULT_LEARNING[sec] ? DEFAULT_LEARNING[sec][key] : undefined;
      if (def === undefined) { err(`learning.${path}`, `"learning.${path}" no existe (las de ${sec} son: ${Object.keys(DEFAULT_LEARNING[sec]).join(', ')}).`, `"${sec}": {"${Object.keys(DEFAULT_LEARNING[sec])[0]}": ${JSON.stringify(Object.values(DEFAULT_LEARNING[sec])[0])}}`); continue; }
      const ex = `"${key}": ${JSON.stringify(def)}`;
      if (ENUMS[path]) { if (!ENUMS[path].includes(v)) err(`learning.${path}`, `"learning.${path}" tiene que ser ${ENUMS[path].join(', ')}.`, ex); continue; }
      if (BOOLS.has(path)) { if (typeof v !== 'boolean') err(`learning.${path}`, `"learning.${path}" tiene que ser true o false.`, ex); continue; }
      const r = LEARNING_RANGES[path];
      if (typeof v !== 'number' || !Number.isFinite(v) || (r && (v < r[0] || v > r[1]))) { err(`learning.${path}`, `"learning.${path}" tiene que ser un número${r ? ` entre ${r[0]} y ${r[1]}` : ''}.`, ex); continue; }
      if (INTS.has(path) && !Number.isInteger(v)) err(`learning.${path}`, `"learning.${path}" tiene que ser un número entero.`, ex);
    }
  }
}

export function mergeLearning(base, over) {
  const out = clone(base || DEFAULT_LEARNING);
  if (!isObj(over)) return out;
  if (over.method !== undefined) out.method = over.method;
  for (const sec of SECTIONS) if (isObj(over[sec])) out[sec] = { ...(out[sec] || {}), ...over[sec] };
  return out;
}

function checkSchedule(raw, duration, learning, genome, err) {
  const out = {};
  if (raw === undefined) return out;
  if (!isObj(raw)) { err('schedule', '"schedule" tiene que ser un objeto con los programas (lr, entropy, temperature, sigma).', '"schedule": {"lr": {"shape": "linear", "to": 0.0003}}'); return out; }
  if (Object.keys(raw).length && duration && duration.plateau) err('schedule', 'Los programas necesitan saber cuánto dura el entreno: usa partidas o minutos (con meseta no se sabe).', '"duration": {"games": 200}');
  for (const [key, e] of Object.entries(raw)) {
    if (!(key in SCHEDULES)) { err(`schedule.${key}`, `No hay programa para "${key}": solo lr, entropy, temperature y sigma.`, '"schedule": {"temperature": {"shape": "linear", "to": 0.8}}'); continue; }
    const range = key === 'temperature' ? TRAIT_RANGES.temperature : LEARNING_RANGES[SCHEDULES[key]];
    const ex = `"${key}": {"shape": "linear", "to": ${range[0] + (range[1] - range[0]) / 10}}`;
    if (!isObj(e)) { err(`schedule.${key}`, `"schedule.${key}" tiene que ser {shape, to, from?}.`, ex); continue; }
    if (!SHAPES.includes(e.shape)) err(`schedule.${key}.shape`, `La forma (shape) de "schedule.${key}" tiene que ser constant, linear o cosine.`, ex);
    const inRange = (v) => typeof v === 'number' && Number.isFinite(v) && v >= range[0] && v <= range[1];
    if (!inRange(e.to)) err(`schedule.${key}.to`, `"schedule.${key}.to" tiene que ser un número entre ${range[0]} y ${range[1]}${key === 'temperature' ? ' (temperatura)' : ''}.`, ex);
    if (e.from !== undefined && !inRange(e.from)) err(`schedule.${key}.from`, `"schedule.${key}.from" tiene que ser un número entre ${range[0]} y ${range[1]}.`, ex);
    const [sec, k] = SCHEDULES[key] ? SCHEDULES[key].split('.') : [null, null];
    const from = e.from !== undefined ? e.from : key === 'temperature' ? genome.traits.temperature : learning[sec][k];
    out[key] = { shape: e.shape, from, to: e.to };
  }
  return out;
}

function checkReward(raw, field, err) {
  if (raw === undefined) return null;
  if (!isObj(raw)) { err(field, `"${field}" tiene que ser un objeto con pesos de la recompensa.`, '"reward": {"graze": 0.5}'); return null; }
  for (const [k, v] of Object.entries(raw)) {
    if (!REWARD_TERMS.includes(k)) { err(`${field}.${k}`, `"${k}" no es un término de la recompensa (son: ${REWARD_TERMS.join(', ')}).`, '"reward": {"graze": 0.5}'); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < REWARD_RANGE[0] || v > REWARD_RANGE[1]) err(`${field}.${k}`, `El peso de "${k}" tiene que ser un número entre −5 y 5.`, `"${k}": 0.5`);
  }
  return { ...raw };
}

function checkFrozen(raw, genome, err) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { err('frozen', '"frozen" tiene que ser una lista de ids de bloque.', '"frozen": ["d"]'); return []; }
  const byId = new Map(genome.blocks.map((b) => [b.id, b]));
  const withWeights = genome.blocks.filter((b) => genome.weights && genome.weights[b.id] && Object.keys(genome.weights[b.id]).length).map((b) => b.id);
  for (const id of raw) {
    if (!byId.has(id)) err('frozen', `El bloque "${id}" no existe en esta red.`, `"frozen": [${withWeights.slice(0, 1).map((x) => `"${x}"`).join('')}]`);
    else if (!withWeights.includes(id)) err('frozen', `El bloque "${id}" (${(BLOCKS[byId.get(id).type] || {}).name || byId.get(id).type}) no tiene pesos: no hay nada que congelar.`, `"frozen": [${withWeights.slice(0, 1).map((x) => `"${x}"`).join('')}]`);
  }
  const all = new Set([...(genome.frozen || []), ...raw]);
  if (withWeights.length && withWeights.every((id) => all.has(id))) err('frozen', 'Con esos congelados no queda nada que aprender: deja al menos un bloque con pesos libre.', `"frozen": [${withWeights.slice(0, 1).map((x) => `"${x}"`).join('')}]`);
  return [...new Set(raw)];
}

function checkOpponents(o, field, err) {
  if (!isObj(o)) { err(field, `"${field}" tiene que ser la mezcla de rivales {antagonist, hallOfFame, self}.`, '"opponents": {"antagonist": 0, "hallOfFame": 0, "self": 1}'); return; }
  const sum = ['antagonist', 'hallOfFame', 'self'].reduce((s, k) => s + (Number(o[k]) || 0), 0);
  if (['antagonist', 'hallOfFame', 'self'].some((k) => o[k] !== undefined && !(typeof o[k] === 'number' && o[k] >= 0))) err(field, `Los pesos de los rivales de "${field}" tienen que ser números ≥ 0.`, '"opponents": {"antagonist": 1, "hallOfFame": 0, "self": 0}');
  else if (!(sum > 0)) err(field, `La mezcla de rivales de "${field}" está a cero: sube al menos uno (antagonista, sala de la fama o ella misma).`, '"opponents": {"antagonist": 0, "hallOfFame": 0, "self": 1}');
}

function checkUntil(u, field, err) {
  if (u === undefined || u === null) return null;
  const ex = '"until": {"winRate": 0.6, "window": 20, "minGames": 40}';
  if (!isObj(u)) { err(field, `"${field}" tiene que ser la regla para pasar de lección.`, ex); return null; }
  if ('games' in u) {
    if (!(Number.isInteger(u.games) && u.games >= 1)) err(`${field}.games`, 'Las partidas de una lección (until.games) tienen que ser un entero de 1 o más.', '"until": {"games": 100}');
    return { kind: 'games', n: u.games };
  }
  const kind = 'winRate' in u ? 'winRate' : 'reward' in u ? 'reward' : null;
  if (!kind) { err(field, `"${field}" tiene que ser {games}, {winRate, window?, minGames?} o {reward, window?, minGames?}: es la regla para pasar de lección.`, ex); return null; }
  const threshold = u[kind];
  if (kind === 'winRate' && !(typeof threshold === 'number' && threshold >= 0 && threshold <= 1)) err(`${field}.winRate`, 'La tasa de victorias para pasar (until.winRate) tiene que estar entre 0 y 1, p. ej. 0.6.', ex);
  if (kind === 'reward' && !(typeof threshold === 'number' && Number.isFinite(threshold))) err(`${field}.reward`, 'La recompensa media para pasar (until.reward) tiene que ser un número.', '"until": {"reward": 0.2, "window": 20}');
  const window = u.window ?? 20;
  if (!(Number.isInteger(window) && window >= 5 && window <= 100)) err(`${field}.window`, 'La ventana (until.window) tiene que ser un entero de 5 a 100 partidas.', ex);
  const minGames = u.minGames ?? window;
  if (!(Number.isInteger(minGames) && minGames >= window)) err(`${field}.minGames`, 'El mínimo de partidas (until.minGames) tiene que ser un entero, como poco igual a la ventana.', ex);
  return { kind, threshold, window, minGames };
}

function checkCurriculum(raw, exploiter, err) {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length < 1) { err('curriculum', 'El currículo tiene que ser una lista de 1 a 16 lecciones.', '"curriculum": [{"name": "Uno contra uno", "soldiers": 1, "until": {"games": 50}}, {"name": "Al azar"}]'); return null; }
  if (raw.length > 16) { err('curriculum', 'El currículo admite como mucho 16 lecciones.', '"curriculum": [{"name": "A"}, {"name": "B"}]'); return null; }
  return raw.map((l, i) => {
    const f = `curriculum[${i}]`;
    if (!isObj(l)) { err(f, `La lección ${i + 1} tiene que ser un objeto {name, soldiers?, opponents?, reward?, until?}.`, '{"name": "Contra la reina", "soldiers": 2}'); return null; }
    if (typeof l.name !== 'string' || !l.name.trim()) err(`${f}.name`, `La lección ${i + 1} necesita un nombre (name).`, '"name": "Uno contra uno"');
    else if (l.name.length > 40) err(`${f}.name`, `El nombre de la lección ${i + 1} tiene como mucho 40 caracteres.`, '"name": "Contra la reina"');
    if (l.soldiers !== undefined && !(l.soldiers === 'random' || (Number.isInteger(l.soldiers) && l.soldiers >= 1 && l.soldiers <= 4))) err(`${f}.soldiers`, `Los soldados de la lección ${i + 1} tienen que ser de 1 a 4, o "random".`, '"soldiers": 2');
    if (l.opponents !== undefined) {
      if (exploiter) err(`${f}.opponents`, `Con la retadora explotadora (que solo juega contra la reina) ninguna lección puede traer rivales propios: quita "opponents" de la lección ${i + 1}.`, '{"name": "Contra la reina", "soldiers": 2}');
      else checkOpponents(l.opponents, `${f}.opponents`, err);
    }
    const reward = checkReward(l.reward, `${f}.reward`, err);
    const until = checkUntil(l.until, `${f}.until`, err);
    return { name: typeof l.name === 'string' ? l.name.trim() : '', soldiers: l.soldiers, opponents: l.opponents ? { ...l.opponents } : undefined, reward, until: i === raw.length - 1 ? until : until };
  });
}

// validateRecipe(cuerpo del entreno, genoma normalizado de la red) → {ok, errors: [{field, message, example}], recipe}
export function validateRecipe(body = {}, genome) {
  const errors = [];
  const err = (field, message, example) => errors.push({ field, message, example });
  const b = body || {};
  checkLearning(b.learning, err);
  const learning = mergeLearning(genome.learning, errors.length ? {} : b.learning);
  const schedule = checkSchedule(b.schedule, b.duration, learning, genome, err);
  const reward = checkReward(b.reward, 'reward', err);
  const frozen = checkFrozen(b.frozen, genome, err);
  const curriculum = checkCurriculum(b.curriculum, !!b.exploiter, err);
  for (const k of ['exam', 'keepBest']) if (b[k] !== undefined && typeof b[k] !== 'boolean') err(k, `"${k}" tiene que ser true o false.`, `"${k}": true`);
  const recipe = {
    learning, schedule, reward, frozen, frozenAll: [...new Set([...(genome.frozen || []), ...frozen])],
    curriculum, exam: b.exam === true, keepBest: b.keepBest === true,
    given: Object.fromEntries(RECIPE_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, clone(b[k])])),
  };
  return { ok: errors.length === 0, errors, recipe };
}

// ---------- programas ----------
export function scheduleValue({ shape, from, to }, p) {
  const q = Math.min(1, Math.max(0, Number(p) || 0));
  if (shape === 'linear') return from + (to - from) * q;
  if (shape === 'cosine') return to + (from - to) * (1 + Math.cos(Math.PI * q)) / 2;
  return from;
}
export function progressOf(duration, { games = 0, elapsedMs = 0 } = {}) {
  const d = duration || {};
  if (d.games) return Math.min(1, games / d.games);
  if (d.minutes) return Math.min(1, elapsedMs / (d.minutes * 60000));
  return null;
}

// ---------- recompensa de práctica ----------
// capas de menos a más prioridad; las estadísticas de un término cuyo peso cambia empiezan vacías, las demás se copian
export function mergeReward(netReward, ...layers) {
  const reward = clone(netReward) || {};
  delete reward.stats;
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) reward[k] = v;
  const stats = {};
  for (const [term, s] of Object.entries((netReward && netReward.stats) || {})) if (reward[term] === netReward[term]) stats[term] = clone(s);
  reward.stats = stats;
  return { reward, stats };
}
// ¿cambia algún peso respecto a la red?
export const rewardChanges = (netReward, ...layers) => layers.some((l) => l && Object.entries(l).some(([k, v]) => netReward[k] !== v));

// ---------- currículo ----------
export function createCurriculum(lessons) {
  const list = lessons || [];
  let i = 0;
  const runs = list.map(() => ({ from: null, to: null, met: false, measure: null, games: [] }));
  const measureOf = (u, games) => {
    const last = games.slice(-u.window);
    return u.kind === 'winRate' ? last.reduce((s, g) => s + g.win, 0) / last.length : last.reduce((s, g) => s + g.reward, 0) / last.length;
  };
  return {
    index: () => i,
    lesson: () => list[i] || null,
    record({ game, win, reward }) {
      const run = runs[i];
      if (!run) return null;
      if (run.from === null) run.from = game;
      run.to = game;
      run.games.push({ win: win ? 1 : 0, reward: Number(reward) || 0 });
      const u = list[i].until;
      if (!u || i === list.length - 1) return null;
      const n = run.games.length;
      let met = false;
      if (u.kind === 'games') { met = n >= u.n; run.measure = n; }
      else if (n >= u.minGames) { run.measure = measureOf(u, run.games); met = run.measure >= u.threshold; }
      if (!met) return null;
      run.met = true;
      i++;
      return { from: i - 1, to: i, measure: run.measure, games: n };
    },
    summary: () => list.map((l, k) => ({ name: l.name, from: runs[k].from, to: k === i ? null : runs[k].to, met: runs[k].met, measure: runs[k].measure })),
  };
}

// ---------- quedarse con la mejor ----------
export function createBestTracker(window = 20) {
  const wins = [];
  let best = -1, atGame = null;
  const rate = () => wins.slice(-window).reduce((s, w) => s + w, 0) / window;
  return {
    record(win, game) {
      wins.push(win ? 1 : 0);
      if (wins.length < window) return false;
      const r = rate();
      if (r > best) { best = r; atGame = game; return true; }
      return false;
    },
    result: () => (wins.length < window ? null : { best, final: rate(), atGame }),
  };
}
