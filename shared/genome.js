// Genoma de una red (spec/02): catálogo de bloques, defaults, validación, dimensiones, pesos.
// Puro: sin I/O. Todo texto para personas en español; claves de datos en inglés.
import { LIMITS } from './constants.js';

export { LIMITS };

export class GenomeError extends Error {
  constructor(err) {
    super(err.message);
    this.name = 'GenomeError';
    this.code = err.code;
    this.blockId = err.blockId ?? null;
    this.wire = err.wire ?? null;
    this.example = err.example ?? '';
  }
}

// ---------- defaults de las secciones opcionales ----------
export const ACTIVATIONS = ['relu', 'tanh', 'sigmoid', 'leaky', 'gelu', 'sine', 'linear'];
export const CHARACTERS = ['frio', 'chulo', 'dramatico', 'desquiciado'];
export const FAMILIES = ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild'];
export const MAP_CHANNELS = ['obstacles', 'enemies', 'allies', 'self', 'trails'];

export const DEFAULT_TRAITS = { temperature: 1.0, pulse: 0.1, teamSpirit: 0.5, character: 'frio' };
export const TRAIT_RANGES = { temperature: [0.05, 3], pulse: [0, 1], teamSpirit: [0, 1] };

export const DEFAULT_IMAGINATION = {
  n: 24, targets: 'all',
  families: {
    line: { on: true, weight: 6, jitter: [0, 0.03, -0.03, 0.08, -0.08, 0.15, -0.15] },
    parabola: { on: true, weight: 6, curvatures: [0.004, -0.004, 0.01, -0.01, 0.02, -0.02, 0.04, -0.04] },
    sine: { on: true, weight: 4, amps: [2, -2, 4, -4, 6], periods: [3, 5, 8, 12] },
    ode1: { on: true, weight: 2, a: [-2, -1, 1, 2], k: [3, 6, 12], b: [-1, 0, 1] },
    artillery: { on: true, weight: 4, gravities: [0.02, 0.04, 0.07, 0.1, 0.15], angles: [10, 20, 30, 40, 50, 60, 70] },
    wild: { on: true, weight: 2, a: [-8, -4, -2, 2, 4, 8], k: [1, 3, 6, 12, 20] },
  },
  adaptive: false,
  usage: { line: 0, parabola: 0, sine: 0, ode1: 0, artillery: 0, wild: 0 },
};

export const DEFAULT_REWARD = {
  kill: 1, die: -1, friendlyFire: -1.5, graze: 0.1, win: 2, lose: 0, survive: 0,
  cover: 0, repeatExpr: 0, nearFriendly: 0, slapCaress: 1,
  normalize: true, grazeRadius: 2.0, milestones: true,
};
export const REWARD_TERMS = ['kill', 'die', 'friendlyFire', 'graze', 'win', 'lose', 'survive', 'cover', 'repeatExpr', 'nearFriendly', 'slapCaress'];

export const DEFAULT_LEARNING = {
  method: 'gradient',
  gradient: { lr: 0.003, gamma: 0.95, entropy: 0.01, clipNorm: 5, batchGames: 4, bpttSteps: 8, baseline: 'value', optimizer: 'adam', adjustLearn: true },
  evolution: { population: 16, sigma: 0.02, lr: 0.01, gamesPerCandidate: 2, antithetic: true, rankNormalize: true },
  both: { gradientGamesPerCycle: 16, evolutionStepsPerCycle: 1 },
  sleep: { lessonThreshold: 0.05 },
};
export const LEARNING_RANGES = {
  'gradient.lr': [1e-5, 0.1], 'gradient.gamma': [0, 1], 'gradient.entropy': [0, 0.5], 'gradient.clipNorm': [0.1, 100],
  'gradient.batchGames': [1, 64], 'gradient.bpttSteps': [1, 64],
  'evolution.population': [2, 128], 'evolution.sigma': [1e-4, 1], 'evolution.lr': [1e-5, 1], 'evolution.gamesPerCandidate': [1, 16],
  'both.gradientGamesPerCycle': [1, 1000], 'both.evolutionStepsPerCycle': [1, 100], 'sleep.lessonThreshold': [0, 1],
};

const TOP_FIELDS = new Set(['format', 'id', 'name', 'emblem', 'traits', 'blocks', 'wires', 'weights', 'frozen', 'imagination', 'reward', 'learning', 'lineage', 'stats', 'memory', 'names']);

// ---------- catálogo ----------
const L = { A: 'aprendiz', B: 'artesano', C: 'cientifico' };
const units = (def, explain) => ({ key: 'units', name: 'Neuronas', type: 'int', min: 1, max: LIMITS.units, step: 1, default: def, level: L.A, explain, example: `Con ${def} neuronas la capa saca ${def} números; más neuronas = más matices y más lento.` });

export const BLOCKS = {
  'eye.map': {
    type: 'eye.map', name: 'Mapa', icon: '🗺', group: 'eyes', level: L.A, streams: { in: [], out: 'ctx' },
    explain: 'Una foto del campo en celdas: dónde hay muros, enemigos, aliados y tú. Es una imagen: pásala por Instinto antes de las Manos.',
    example: 'Con celda 2 el mapa tiene 25×15 celdas; con 4 canales son 1 500 números.',
    params: [
      { key: 'cell', name: 'Tamaño de celda (u)', type: 'enum', options: [1, 2, 2.5, 5].map((v) => ({ value: v, name: `${v} u`, explain: `celdas de ${v}×${v} unidades` })), default: 2, level: L.A, explain: 'Celdas pequeñas = más detalle y más números que aprender.', example: 'Celda 5 → 10×6 celdas: sabe si hay muro "por ahí"; celda 1 → 50×30: sabe exactamente dónde.' },
      { key: 'channels', name: 'Canales', type: 'set', options: MAP_CHANNELS.map((v) => ({ value: v, name: v, explain: 'capa del mapa' })), default: ['obstacles', 'enemies', 'allies', 'self'], level: L.B, explain: 'Qué capas ve: muros, enemigos, aliados, tú, y las estelas de los últimos disparos.', example: 'Quita "allies" y la red no sabrá dónde están sus compañeros (más fuego amigo).' },
    ],
  },
  'eye.features': { type: 'eye.features', name: 'Rasgos', icon: '📊', group: 'eyes', level: L.A, streams: { in: [], out: 'ctx' }, params: [],
    explain: '26 números compactos: dónde estás, dónde están los 2 enemigos y los 2 aliados más cercanos, si hay línea de tiro, cuántos quedan.',
    example: 'Es el ojo básico: con Rasgos + Candidatos ya se puede disparar.' },
  'eye.obstacles': { type: 'eye.obstacles', name: 'Obstáculos', icon: '🧱', group: 'eyes', level: L.B, streams: { in: [], out: 'ctx' },
    explain: 'Los muros más cercanos como rectángulos (centro, ancho, alto).', example: 'Con 6 huecos ve hasta 6 muros; los que sobren no los ve.',
    params: [{ key: 'slots', name: 'Huecos', type: 'int', min: 1, max: 8, step: 1, default: 6, level: L.B, explain: 'Cuántos muros puede describir a la vez.', example: 'En la Fortaleza hay 5 muros: con 3 huecos solo ve los 3 más cercanos.' }] },
  'eye.history': { type: 'eye.history', name: 'Historial', icon: '📜', group: 'eyes', level: L.B, streams: { in: [], out: 'ctx' },
    explain: 'Los últimos disparos tuyos y del rival: qué forma tenían y cómo acabaron.', example: 'Sirve para no repetir un tiro que chocó con el muro y para leer el estilo del rival.',
    params: [{ key: 'depth', name: 'Disparos recordados', type: 'int', min: 1, max: 8, step: 1, default: 4, level: L.B, explain: 'Cuántos disparos de cada bando recuerda.', example: 'Con 4 recuerda tus 4 últimos y los 4 últimos del rival (112 números).' }] },
  'eye.radar': { type: 'eye.radar', name: 'Radar', icon: '📡', group: 'eyes', level: L.B, streams: { in: [], out: 'ctx' },
    explain: 'Bigotes: en K direcciones, a qué distancia está el primer muro o borde.', example: 'Como los bigotes de un gato: sabe si tiene una pared pegada a la espalda.',
    params: [{ key: 'rays', name: 'Direcciones', type: 'enum', options: [8, 16, 32].map((v) => ({ value: v, name: String(v), explain: `${v} bigotes` })), default: 16, level: L.B, explain: 'Más direcciones = radar más fino.', example: '8 direcciones = cada 45°; 32 = cada 11°.' }] },
  'eye.clock': { type: 'eye.clock', name: 'Reloj', icon: '⏱', group: 'eyes', level: L.B, streams: { in: [], out: 'ctx' }, params: [],
    explain: 'El momento de la partida: cuántos disparos van, cuánto falta para el empate, cuántos viven, si toca disparar o moverse.', example: 'Con el Reloj puede volverse agresiva cuando se acerca el límite de disparos.' },
  'eye.mates': { type: 'eye.mates', name: 'Compañeros', icon: '👥', group: 'eyes', level: L.B, streams: { in: [], out: 'ctx' }, params: [],
    explain: 'Resumen de tus aliados vivos: cuántos, dónde, si tienen línea de tiro, cómo les fue el último disparo.', example: 'Vale para 1, 2, 3 o 4 soldados: siempre son 12 números.' },
  'eye.candidates': { type: 'eye.candidates', name: 'Candidatos', icon: '🎯', group: 'eyes', level: L.A, streams: { in: [], out: 'cand' }, params: [],
    explain: 'Los N disparos que imagina 🎲 Imaginación, cada uno con su familia (recta, parábola…) y sus parámetros. Obligatorio para Elegir.', example: 'Con N = 24, salen 24 filas de 12 números, una por candidato.' },
  'eye.simulator': { type: 'eye.simulator', name: 'Simulador', icon: '🔮', group: 'eyes', level: L.A, streams: { in: [], out: 'cand' },
    explain: 'Para cada candidato, el futuro: ¿mata? ¿suicidio? ¿choca? ¿a qué distancia pasa del enemigo? Sin él, la red es "ciega": solo geometría.', example: 'Vidente (con Simulador) aprende en cientos de decisiones; ciega, en miles: cuenta con horas de turbo.',
    params: [{ key: 'fine', name: 'Simulación fina', type: 'bool', default: false, level: L.C, explain: 'Barrido fino (más exacto, 5× más lento) en vez del grueso.', example: 'El grueso ya acierta casi siempre; el fino solo para cirugía de precisión.' }] },
  'eye.moves': { type: 'eye.moves', name: 'Destinos', icon: '🦶', group: 'eyes', level: L.A, streams: { in: [], out: 'move' }, params: [],
    explain: 'Los 9 sitios a los que puedes moverte tras disparar (quedarte + 8 direcciones), con su cobertura y distancia al enemigo. Obligatorio para Moverse.', example: 'Si un destino está tapado por un muro, su "enemigos que me ven" es 0.' },

  dense: { type: 'dense', name: 'Instinto', icon: '🧠', group: 'instinct', level: L.A, streams: { in: ['ctx', 'cand', 'move'], out: 'same' },
    explain: 'Capa de neuronas: cada una mezcla todo lo que entra con sus pesos y aplica una activación. Es donde se aprende.', example: '32 neuronas tanh sobre Rasgos + Candidatos → cada candidato recibe una opinión de 32 números.',
    params: [units(32, 'Cuántas neuronas tiene la capa.'),
      { key: 'activation', name: 'Activación', type: 'enum', options: [
        { value: 'relu', name: 'relu', explain: 'deja pasar lo positivo, apaga lo negativo' }, { value: 'tanh', name: 'tanh', explain: 'aplasta entre −1 y 1 (suave, la de siempre)' },
        { value: 'sigmoid', name: 'sigmoide', explain: 'aplasta entre 0 y 1 (como una probabilidad)' }, { value: 'leaky', name: 'leaky', explain: 'relu que deja pasar un 1 % de lo negativo' },
        { value: 'gelu', name: 'gelu', explain: 'relu suave, la de los modelos modernos' }, { value: 'sine', name: 'seno', explain: 'oscila: bueno para cosas periódicas' }, { value: 'linear', name: 'lineal', explain: 'no cambia nada (solo mezcla)' },
      ], default: 'tanh', level: L.B, explain: 'La forma de la respuesta de cada neurona.', example: 'tanh para empezar; relu si la red es grande; seno si quieres que "vea" patrones repetidos.' }] },
  concat: { type: 'concat', name: 'Juntar', icon: '🔗', group: 'instinct', level: L.A, streams: { in: ['ctx', 'cand', 'move'], out: 'same' }, params: [],
    explain: 'Pone un vector detrás de otro. Si juntas contexto con candidatos, el contexto se copia a cada candidato.', example: 'Rasgos (26) + Radar (32) → 58 números.' },
  add: { type: 'add', name: 'Sumar', icon: '➕', group: 'instinct', level: L.B, streams: { in: ['ctx', 'cand', 'move'], out: 'same' }, params: [],
    explain: 'Suma dos o más vectores del mismo tamaño (para atajos residuales).', example: 'Instinto(32) + atajo(32) → 32 números: la capa solo aprende "la diferencia".' },
  mul: { type: 'mul', name: 'Multiplicar', icon: '✖', group: 'instinct', level: L.C, streams: { in: ['ctx', 'cand', 'move'], out: 'same' }, params: [],
    explain: 'Multiplica elemento a elemento: una entrada hace de puerta de la otra.', example: 'sigmoide(0..1) × señal → deja pasar solo lo que la puerta abre.' },
  skip: { type: 'skip', name: 'Atajo', icon: '↪', group: 'instinct', level: L.B, streams: { in: ['ctx', 'cand', 'move'], out: 'same' }, params: [],
    explain: 'No cambia nada: existe para dibujar un cable que salta capas y luego Sumar.', example: 'Rasgos → Atajo → Sumar(con Instinto) → la información cruda llega intacta.' },
  norm: { type: 'norm', name: 'Normalizar', icon: '⚖', group: 'instinct', level: L.B, streams: { in: ['ctx', 'cand', 'move'], out: 'same' },
    explain: 'Recentra y reescala el vector (media 0, tamaño 1) con dos ajustes aprendidos. Estabiliza redes profundas.', example: 'Ponlo después de un Instinto grande si las curvas de entreno bailan.',
    params: [{ key: 'eps', name: 'Épsilon', type: 'number', min: 1e-8, max: 1e-2, step: 1e-6, default: 1e-5, level: L.C, explain: 'Evita dividir por cero.', example: 'Déjalo en 1e-5.' }] },
  attention: { type: 'attention', name: 'Atención', icon: '👁‍🗨', group: 'instinct', level: L.B, streams: { in: ['ctx', 'cand', 'move'], out: 'ctx' },
    explain: 'Mira todos los candidatos (o destinos) y se fija más en unos que en otros; devuelve un resumen al contexto y se ve en quién se fijó. Vale para cualquier número de candidatos.', example: '2 cabezas × 8 → 16 números de resumen y 2 mapas de atención sobre los candidatos.',
    params: [{ key: 'heads', name: 'Cabezas', type: 'int', min: 1, max: 8, step: 1, default: 1, level: L.B, explain: 'Cada cabeza se fija en algo distinto.', example: 'Una cabeza para "el que mata", otra para "el que no me deja al descubierto".' },
      { key: 'keyDim', name: 'Tamaño de clave', type: 'int', min: 4, max: 128, step: 1, default: 16, level: L.C, explain: 'Cuántos números usa para comparar consulta y candidatos.', example: '16 sobra para 24 candidatos.' }] },
  pool: { type: 'pool', name: 'Resumen', icon: '🧮', group: 'instinct', level: L.B, streams: { in: ['cand', 'move'], out: 'ctx' },
    explain: 'Resume todos los candidatos (o destinos) en un solo vector: media o máximo por número.', example: 'Máximo del Simulador → "¿alguno de mis candidatos mata?"',
    params: [{ key: 'op', name: 'Operación', type: 'enum', options: [{ value: 'mean', name: 'media', explain: 'promedio' }, { value: 'max', name: 'máximo', explain: 'el mayor' }], default: 'mean', level: L.B, explain: 'Cómo resume.', example: 'media = "cómo pinta en general"; máximo = "lo mejor que hay".' }] },

  echo: { type: 'echo', name: 'Eco', icon: '🌀', group: 'memory', level: L.A, streams: { in: ['ctx'], out: 'ctx' },
    explain: 'Memoria simple: mezcla lo que ve ahora con lo que recordaba y lo guarda para el turno siguiente. Se olvida deprisa.', example: 'Eco de 16 recuerda "de dónde me dispararon" durante 2 o 3 turnos.',
    params: [units(16, 'Tamaño del recuerdo.')] },
  gru: { type: 'gru', name: 'GRU', icon: '🌀', group: 'memory', level: L.B, streams: { in: ['ctx'], out: 'ctx' },
    explain: 'Memoria con puertas: decide qué olvidar y qué guardar. Recuerda más lejos que el Eco.', example: 'Ideal para la Tortuga: recuerda si el rival tira parábolas y se pega al muro.',
    params: [units(16, 'Tamaño del recuerdo.')] },
  lstm: { type: 'lstm', name: 'LSTM', icon: '🌀', group: 'memory', level: L.B, streams: { in: ['ctx'], out: 'ctx' },
    explain: 'Memoria larga con celda interna: la más capaz y la más pesada.', example: 'Para partidas de 90 disparos donde importa lo que pasó al principio.',
    params: [units(16, 'Tamaño del recuerdo.')] },
  teamMemory: { type: 'teamMemory', name: 'Memoria de equipo', icon: '🤝', group: 'memory', level: L.B, streams: { in: ['ctx'], out: 'ctx' },
    explain: 'Cada soldado escribe su recuerdo y lee la media de los de sus compañeros vivos. Con un solo soldado lee el suyo.', example: 'Un soldado ve al enemigo tras el muro y "avisa" a los demás en el siguiente turno.',
    params: [units(16, 'Tamaño del recuerdo compartido.')] },

  'hand.choose': { type: 'hand.choose', name: 'Elegir', icon: '🎯', group: 'hands', level: L.A, streams: { in: ['cand'], out: 'cand' }, params: [],
    explain: 'Da una puntuación a cada candidato de disparo; la temperatura convierte puntuaciones en probabilidades y se sortea. Obligatoria para disparar.', example: 'Puntuaciones [2.1, 0.3, −1] → con temperatura 1, el primero sale el 84 % de las veces.' },
  'hand.adjust': { type: 'hand.adjust', name: 'Ajustar', icon: '✏', group: 'hands', level: L.B, streams: { in: ['cand'], out: 'cand' },
    explain: 'Afina el candidato elegido: un pequeño empujón a su pendiente, curvatura o ángulo. El ruido del empujón es el rasgo "pulso".', example: 'Recta de pendiente 0.31 + ajuste 0.14 × escala 0.04 → 0.316.',
    params: [{ key: 'params', name: 'Parámetros que ajusta', type: 'int', min: 1, max: 3, step: 1, default: 3, level: L.B, explain: 'Cuántos parámetros del candidato toca (1 = solo el primero).', example: 'Con 1 solo ajusta la pendiente; con 3, también curvatura/periodo.' }] },
  'foot.move': { type: 'foot.move', name: 'Moverse', icon: '🦶', group: 'feet', level: L.A, streams: { in: ['move'], out: 'move' },
    explain: 'Puntúa los 9 destinos y, si quieres, afina el elegido con un desplazamiento pequeño. Sin este bloque, la red se queda quieta.', example: 'Destino "tras el muro" puntuación 3 → casi siempre se esconde.',
    params: [{ key: 'adjust', name: 'Afinar destino', type: 'bool', default: true, level: L.B, explain: 'Además de elegir uno de los 9, empuja el punto hasta 1.5 u (y se vuelve a deslizar).', example: 'Elige "arriba" y lo afina un poco a la derecha para quedar justo tras la esquina.' }] },
  'hand.value': { type: 'hand.value', name: 'Corazonada', icon: '💓', group: 'hands', level: L.B, streams: { in: ['ctx'], out: 'ctx' }, params: [],
    explain: 'Cuánto cree que va a ganar desde aquí (un número). Sirve de referencia al aprendizaje y es la fuente de esperanza y miedo.', example: 'Corazonada 0.8 = "esto lo tengo"; −0.6 = "mal asunto".' },
};

// ---------- utilidades ----------
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isEye = (type) => type.startsWith('eye.');
const isMemory = (type) => ['echo', 'gru', 'lstm', 'teamMemory'].includes(type);
const isHead = (type) => ['hand.choose', 'hand.adjust', 'foot.move', 'hand.value'].includes(type);
export const BLOCK_FLAGS = { isEye, isMemory, isHead };

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function defaultParams(type) {
  const out = {};
  for (const p of BLOCKS[type].params) out[p.key] = clone(p.default);
  return out;
}

function deepDefaults(value, def) {
  if (!isObj(def)) return value === undefined ? clone(def) : value;
  const out = {};
  for (const k of Object.keys(def)) out[k] = deepDefaults(isObj(value) ? value[k] : undefined, def[k]);
  if (isObj(value)) for (const k of Object.keys(value)) if (!(k in out)) out[k] = clone(value[k]);
  return out;
}

// Copia con todas las secciones opcionales rellenas (no muta la entrada)
export function normalize(genome) {
  const g = clone(genome);
  g.format = g.format ?? 1;
  g.traits = deepDefaults(g.traits, DEFAULT_TRAITS);
  g.imagination = deepDefaults(g.imagination, DEFAULT_IMAGINATION);
  g.reward = deepDefaults(g.reward, DEFAULT_REWARD);
  g.learning = deepDefaults(g.learning, DEFAULT_LEARNING);
  g.frozen = Array.isArray(g.frozen) ? g.frozen : [];
  g.lineage = deepDefaults(g.lineage, { generation: 0, parents: [], born: null, mutations: [] });
  g.stats = deepDefaults(g.stats, { games: 0, wins: 0, kills: 0, deaths: 0, reigns: 0 });
  g.emblem = Number.isInteger(g.emblem) ? g.emblem : hashStr(String(g.id || '')) % 2147483647;
  g.weights = isObj(g.weights) ? g.weights : {};
  g.blocks = (Array.isArray(g.blocks) ? g.blocks : []).map((b) => (isObj(b) && BLOCKS[b.type]
    ? { ...b, params: { ...defaultParams(b.type), ...(isObj(b.params) ? b.params : {}) } }
    : b));
  g.wires = Array.isArray(g.wires) ? g.wires : [];
  return g;
}

// ---------- dimensiones de los ojos ----------
export function eyeDim(block, genome) {
  const p = block.params;
  switch (block.type) {
    case 'eye.map': return p.channels.length * Math.round(50 / p.cell) * Math.round(30 / p.cell);
    case 'eye.features': return 26;
    case 'eye.obstacles': return 5 * p.slots + 1;
    case 'eye.history': return 2 * p.depth * 14;
    case 'eye.radar': return 2 * p.rays;
    case 'eye.clock': return 8;
    case 'eye.mates': return 12;
    case 'eye.candidates': return 12;
    case 'eye.simulator': return 10;
    case 'eye.moves': return 9;
    default: return 0;
  }
}

// formas de pesos de un bloque dados sus tamaños de entrada
export function weightShapes(block, dims) {
  const p = block.params, i = dims.in ?? 0;
  switch (block.type) {
    case 'dense': return { W: i * p.units, b: p.units };
    case 'norm': return { g: i, b: i };
    case 'attention': { const hk = p.heads * p.keyDim; const s = { Wk: dims.kv * hk, Wv: dims.kv * hk }; if (dims.ctx > 0) s.Wq = dims.ctx * hk; else s.q0 = hk; return s; }
    case 'echo': case 'teamMemory': return { Wx: i * p.units, Wh: p.units * p.units, b: p.units };
    case 'gru': { const n = (i + p.units) * p.units; return { Wz: n, Wr: n, Wh: n, bz: p.units, br: p.units, bh: p.units }; }
    case 'lstm': { const n = (i + p.units) * p.units; return { Wi: n, Wf: n, Wo: n, Wg: n, bi: p.units, bf: p.units, bo: p.units, bg: p.units }; }
    case 'hand.choose': case 'hand.value': return { W: i, b: 1 };
    case 'hand.adjust': return { W: i * p.params, b: p.params };
    case 'foot.move': return p.adjust ? { W: i, b: 1, Wa: i * 2, ba: 2 } : { W: i, b: 1 };
    default: return null;
  }
}

// número de entradas y salidas de una matriz (para Xavier) según su clave
function fanOf(block, key, dims) {
  const p = block.params, i = dims.in ?? 0;
  switch (block.type) {
    case 'dense': return [i, p.units];
    case 'attention': { const hk = p.heads * p.keyDim; return key === 'Wq' ? [dims.ctx, hk] : key === 'q0' ? [1, hk] : [dims.kv, hk]; }
    case 'echo': case 'teamMemory': return key === 'Wx' ? [i, p.units] : [p.units, p.units];
    case 'gru': case 'lstm': return [i + p.units, p.units];
    case 'hand.choose': case 'hand.value': return [i, 1];
    case 'hand.adjust': return [i, p.params];
    case 'foot.move': return key === 'Wa' ? [i, 2] : [i, 1];
    default: return [1, 1];
  }
}

// Xavier uniforme con semilla; sesgos a 0 (bf del LSTM a 1, g de norm a 1)
export function initWeights(block, inDim, rng) {
  const dims = typeof inDim === 'number' ? { in: inDim } : (inDim || {});
  const b = { ...block, params: { ...defaultParams(block.type), ...(block.params || {}) } };
  const shapes = weightShapes(b, dims);
  if (!shapes) return null;
  const out = {};
  for (const [key, len] of Object.entries(shapes)) {
    const arr = new Array(len);
    const isBias = /^(b|ba|bz|br|bh|bi|bf|bo|bg|g)$/.test(key);
    if (isBias) { const v = key === 'bf' || key === 'g' ? 1 : 0; for (let k = 0; k < len; k++) arr[k] = v; }
    else { const [fi, fo] = fanOf(b, key, dims); const lim = Math.sqrt(6 / (fi + fo)); for (let k = 0; k < len; k++) arr[k] = (rng() * 2 - 1) * lim; }
    out[key] = arr;
  }
  return out;
}

// ---------- análisis del grafo ----------
// Devuelve {order, streams, dims, inputs, errors}; dims[id] = {in, ctx, kv, out}
function analyze(g, errors) {
  const E = (code, message, extra = {}) => errors.push({ code, message, example: extra.example ?? '', ...extra });
  const byId = new Map(g.blocks.map((b) => [b.id, b]));
  const inputs = new Map(g.blocks.map((b) => [b.id, []]));
  for (const w of g.wires) inputs.get(w.to).push(w.from);
  // orden topológico (Kahn)
  const indeg = new Map(g.blocks.map((b) => [b.id, inputs.get(b.id).length]));
  const outs = new Map(g.blocks.map((b) => [b.id, []]));
  for (const w of g.wires) outs.get(w.from).push(w.to);
  const order = [];
  const queue = g.blocks.filter((b) => indeg.get(b.id) === 0).map((b) => b.id);
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const nx of outs.get(id)) { indeg.set(nx, indeg.get(nx) - 1); if (indeg.get(nx) === 0) queue.push(nx); }
  }
  if (order.length < g.blocks.length) {
    const inCycle = g.blocks.filter((b) => !order.includes(b.id)).map((b) => b.id);
    E('cycle', `Hay un bucle de cables entre ${inCycle.join(', ')}: dentro de un turno la señal solo puede ir hacia delante (los únicos "bucles" son la memoria entre turnos).`, { blockId: inCycle[0], example: 'Quita uno de los cables del bucle o pon una Memoria (Eco/GRU/LSTM) para recordar entre turnos.' });
    return null;
  }
  const streams = {}, dims = {};
  const N = g.imagination.n;
  for (const id of order) {
    const b = byId.get(id);
    const ins = inputs.get(id);
    if (isEye(b.type)) {
      streams[id] = BLOCKS[b.type].streams.out;
      dims[id] = { in: 0, out: eyeDim(b, g) };
      continue;
    }
    const inStreams = new Set(ins.map((i) => streams[i]));
    if (inStreams.has('cand') && inStreams.has('move')) {
      E('stream-mix', `${BLOCKS[b.type].name} "${id}" recibe candidatos de disparo y destinos de movimiento a la vez: no se pueden juntar; usa Atención o Resumen para convertir uno de los dos en contexto.`, { blockId: id, example: 'Candidatos → Atención → (contexto) → Juntar con Destinos.' });
      return null;
    }
    let stream = inStreams.has('cand') ? 'cand' : inStreams.has('move') ? 'move' : 'ctx';
    const spec = BLOCKS[b.type].streams;
    const ctxDim = ins.filter((i) => streams[i] === 'ctx').reduce((s, i) => s + dims[i].out, 0);
    const kvDim = ins.filter((i) => streams[i] !== 'ctx').reduce((s, i) => s + dims[i].out, 0);
    const inDim = ctxDim + kvDim;
    if (isMemory(b.type) && stream !== 'ctx') {
      E('stream-mix', `La memoria "${id}" solo trabaja sobre contexto (un vector por soldado), no sobre candidatos ni destinos.`, { blockId: id, example: 'Pasa los candidatos por Atención o Resumen antes de la memoria.' });
      return null;
    }
    if (b.type === 'hand.value' && stream !== 'ctx') { E('stream-mix', `Corazonada "${id}" necesita contexto, no candidatos ni destinos.`, { blockId: id, example: 'Rasgos → Instinto → Corazonada.' }); return null; }
    if ((b.type === 'hand.choose' || b.type === 'hand.adjust') && stream !== 'cand') { E('stream-mix', `${BLOCKS[b.type].name} "${id}" necesita la corriente de candidatos (cablea Candidatos, directa o a través de Instinto).`, { blockId: id, example: 'Candidatos → Instinto → Elegir.' }); return null; }
    if (b.type === 'foot.move' && stream !== 'move') { E('stream-mix', `Moverse "${id}" necesita la corriente de destinos (cablea Destinos).`, { blockId: id, example: 'Destinos → Instinto → Moverse.' }); return null; }
    if ((b.type === 'attention' || b.type === 'pool') && stream === 'ctx') { E('stream-mix', `${BLOCKS[b.type].name} "${id}" necesita candidatos o destinos que resumir.`, { blockId: id, example: 'Candidatos → Atención; Rasgos → Atención (consulta).' }); return null; }
    if ((b.type === 'add' || b.type === 'mul') && ins.length) {
      const d0 = dims[ins[0]].out;
      if (ins.some((i) => dims[i].out !== d0)) { E('dim', `${BLOCKS[b.type].name} "${id}" recibe vectores de tamaños distintos (${ins.map((i) => `${i}: ${dims[i].out}`).join(', ')}): para sumar o multiplicar tienen que medir lo mismo.`, { blockId: id, example: 'Usa Juntar, o pon un Instinto con el mismo número de neuronas en cada rama.' }); return null; }
    }
    void spec;
    let outDim;
    switch (b.type) {
      case 'dense': outDim = b.params.units; break;
      case 'concat': case 'skip': outDim = inDim; break;
      case 'add': case 'mul': outDim = ins.length ? dims[ins[0]].out : 0; break;
      case 'norm': outDim = inDim; break;
      case 'attention': outDim = b.params.heads * b.params.keyDim; stream = 'ctx'; break;
      case 'pool': outDim = kvDim; stream = 'ctx'; break;
      case 'echo': case 'gru': case 'lstm': case 'teamMemory': outDim = b.params.units; break;
      case 'hand.choose': case 'hand.value': outDim = 1; break;
      case 'hand.adjust': outDim = b.params.params; break;
      case 'foot.move': outDim = 1 + (b.params.adjust ? 2 : 0); break;
      default: outDim = inDim;
    }
    streams[id] = stream;
    dims[id] = { in: inDim, ctx: ctxDim, kv: kvDim, out: outDim, n: stream === 'cand' ? N : stream === 'move' ? 9 : 1 };
  }
  return { order, streams, dims, inputs: Object.fromEntries(inputs) };
}

function paramCountFrom(g, analysis) {
  let n = 0;
  for (const b of g.blocks) { const s = weightShapes(b, analysis.dims[b.id]); if (s) for (const v of Object.values(s)) n += v; }
  return n;
}

// ---------- validación ----------
const rangeErr = (errors, code, path, v, [lo, hi], example) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors.push({ code, message: `"${path}" tiene que ser un número entre ${lo} y ${hi} (ahora: ${JSON.stringify(v)}).`, example });
};

export function validate(genomeOrText, { forPlay = false } = {}) {
  const errors = [], warnings = [];
  let raw = genomeOrText;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.genomeBytes) return { ok: false, errors: [{ code: 'limit', message: `El genoma ocupa ${raw.length} bytes; el máximo es ${LIMITS.genomeBytes} (48 MB).`, example: 'Exporta la red con menos neuronas o quita bloques.' }], warnings };
    try { raw = JSON.parse(raw); } catch (e) { return { ok: false, errors: [{ code: 'format', message: `El texto no es JSON válido: ${e.message}`, example: '{"format":1,"id":"mi-red","name":"Mi red","blocks":[…],"wires":[…]}' }], warnings }; }
  }
  if (!isObj(raw)) return { ok: false, errors: [{ code: 'format', message: 'El genoma tiene que ser un objeto JSON.', example: '{"format":1, …}' }], warnings };
  // fase 1: campos
  if (raw.format !== 1) errors.push({ code: 'format', message: `"format" tiene que ser 1 (ahora: ${JSON.stringify(raw.format)}).`, example: '"format": 1' });
  if (typeof raw.id !== 'string' || !/^[a-z0-9-]{3,32}$/.test(raw.id)) errors.push({ code: 'id', message: `"id" tiene que tener 3–32 caracteres, solo minúsculas, dígitos y guiones (ahora: ${JSON.stringify(raw.id)}).`, example: '"id": "hydra-7"' });
  if (typeof raw.name !== 'string' || !raw.name.length || raw.name.length > 32) errors.push({ code: 'name', message: '"name" tiene que ser un texto de 1 a 32 caracteres.', example: '"name": "Hydra-7"' });
  for (const k of Object.keys(raw)) if (!TOP_FIELDS.has(k)) errors.push({ code: 'unknown-field', message: `Campo desconocido "${k}": solo se admiten ${[...TOP_FIELDS].join(', ')}.`, example: 'Quita el campo o revisa la ortografía.' });
  if (!Array.isArray(raw.blocks)) errors.push({ code: 'format', message: '"blocks" tiene que ser una lista de bloques.', example: '"blocks": [{"id":"f","type":"eye.features","params":{}}]' });
  if (!Array.isArray(raw.wires)) errors.push({ code: 'format', message: '"wires" tiene que ser una lista de cables {from, to}.', example: '"wires": [{"from":"f","to":"d"}]' });
  if (raw.traits !== undefined) {
    if (!isObj(raw.traits)) errors.push({ code: 'traits', message: '"traits" tiene que ser un objeto.', example: '"traits": {"temperature": 1}' });
    else {
      for (const [k, r] of Object.entries(TRAIT_RANGES)) if (raw.traits[k] !== undefined) rangeErr(errors, 'traits', `traits.${k}`, raw.traits[k], r, `"${k}": ${DEFAULT_TRAITS[k]}`);
      if (raw.traits.character !== undefined && !CHARACTERS.includes(raw.traits.character)) errors.push({ code: 'traits', message: `"traits.character" tiene que ser uno de ${CHARACTERS.join(', ')}.`, example: '"character": "chulo"' });
    }
  }
  if (raw.imagination !== undefined) {
    if (!isObj(raw.imagination)) errors.push({ code: 'imagination', message: '"imagination" tiene que ser un objeto.', example: '"imagination": {"n": 24}' });
    else {
      if (raw.imagination.n !== undefined) rangeErr(errors, 'imagination', 'imagination.n', raw.imagination.n, [LIMITS.candidatesMin, LIMITS.candidatesMax], '"n": 24');
      if (raw.imagination.targets !== undefined && !['all', 'nearest'].includes(raw.imagination.targets)) errors.push({ code: 'imagination', message: '"imagination.targets" tiene que ser "all" o "nearest".', example: '"targets": "all"' });
      if (raw.imagination.families !== undefined) {
        if (!isObj(raw.imagination.families)) errors.push({ code: 'imagination', message: '"imagination.families" tiene que ser un objeto por familia.', example: '"families": {"line": {"on": true, "weight": 6}}' });
        else for (const [f, v] of Object.entries(raw.imagination.families)) {
          if (!FAMILIES.includes(f)) errors.push({ code: 'imagination', message: `Familia desconocida "${f}": solo ${FAMILIES.join(', ')}.`, example: '"line", "parabola", …' });
          else if (isObj(v) && v.weight !== undefined) rangeErr(errors, 'imagination', `imagination.families.${f}.weight`, v.weight, [0, 100], '"weight": 6');
        }
      }
    }
  }
  if (raw.reward !== undefined) {
    if (!isObj(raw.reward)) errors.push({ code: 'reward', message: '"reward" tiene que ser un objeto.', example: '"reward": {"kill": 1}' });
    else {
      for (const t of REWARD_TERMS) if (raw.reward[t] !== undefined) rangeErr(errors, 'reward', `reward.${t}`, raw.reward[t], [-5, 5], `"${t}": ${DEFAULT_REWARD[t]}`);
      if (raw.reward.grazeRadius !== undefined) rangeErr(errors, 'reward', 'reward.grazeRadius', raw.reward.grazeRadius, [0.5, 10], '"grazeRadius": 2');
      for (const k of Object.keys(raw.reward)) if (!(k in DEFAULT_REWARD) && k !== 'stats') errors.push({ code: 'reward', message: `Término de recompensa desconocido "${k}".`, example: `Solo: ${REWARD_TERMS.join(', ')}, normalize, grazeRadius, milestones.` });
    }
  }
  if (raw.learning !== undefined) {
    if (!isObj(raw.learning)) errors.push({ code: 'learning', message: '"learning" tiene que ser un objeto.', example: '"learning": {"method": "gradient"}' });
    else {
      if (raw.learning.method !== undefined && !['gradient', 'evolution', 'both'].includes(raw.learning.method)) errors.push({ code: 'learning', message: '"learning.method" tiene que ser gradient, evolution o both.', example: '"method": "gradient"' });
      for (const [path, r] of Object.entries(LEARNING_RANGES)) {
        const [sec, key] = path.split('.');
        const v = isObj(raw.learning[sec]) ? raw.learning[sec][key] : undefined;
        if (v !== undefined) rangeErr(errors, 'learning', `learning.${path}`, v, r, `"${key}": ${DEFAULT_LEARNING[sec][key]}`);
      }
      const gr = raw.learning.gradient;
      if (isObj(gr) && gr.baseline !== undefined && !['value', 'mean', 'none'].includes(gr.baseline)) errors.push({ code: 'learning', message: '"learning.gradient.baseline" tiene que ser value, mean o none.', example: '"baseline": "value"' });
      if (isObj(gr) && gr.optimizer !== undefined && !['adam', 'sgd'].includes(gr.optimizer)) errors.push({ code: 'learning', message: '"learning.gradient.optimizer" tiene que ser adam o sgd.', example: '"optimizer": "adam"' });
    }
  }
  if (raw.frozen !== undefined && !Array.isArray(raw.frozen)) errors.push({ code: 'format', message: '"frozen" tiene que ser una lista de ids de bloque.', example: '"frozen": ["b3"]' });
  if (errors.length) return { ok: false, errors, warnings };

  const g = normalize(raw);
  // fase 2: bloques
  if (g.blocks.length > LIMITS.blocks) errors.push({ code: 'limit', message: `Hay ${g.blocks.length} bloques; el máximo es ${LIMITS.blocks}.`, example: 'Junta capas o quita ojos que no uses.' });
  const seen = new Set();
  for (const b of g.blocks) {
    if (!isObj(b) || typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(b.id)) { errors.push({ code: 'id', message: `Un bloque tiene un id inválido: ${JSON.stringify(b && b.id)}.`, example: '"id": "b3"' }); continue; }
    if (seen.has(b.id)) errors.push({ code: 'id', blockId: b.id, message: `El id de bloque "${b.id}" está repetido.`, example: 'Cada bloque necesita un id distinto: "b3", "b4"…' });
    seen.add(b.id);
    const cat = BLOCKS[b.type];
    if (!cat) { errors.push({ code: 'block-type', blockId: b.id, message: `El bloque "${b.id}" es de un tipo desconocido: ${JSON.stringify(b.type)}.`, example: `Tipos: ${Object.keys(BLOCKS).join(', ')}.` }); continue; }
    for (const [k, v] of Object.entries(b.params)) {
      const p = cat.params.find((q) => q.key === k);
      if (!p) { errors.push({ code: 'block-param', blockId: b.id, message: `${cat.name} "${b.id}" no tiene un parámetro "${k}".`, example: cat.params.length ? `Parámetros de ${cat.name}: ${cat.params.map((q) => q.key).join(', ')}.` : `${cat.name} no tiene parámetros.` }); continue; }
      const bad = (why) => errors.push({ code: 'block-param', blockId: b.id, message: `${cat.name} "${b.id}": "${k}" ${why} (ahora: ${JSON.stringify(v)}).`, example: p.example });
      if (p.type === 'int') { if (!Number.isInteger(v) || v < p.min || v > p.max) bad(`tiene que ser un entero entre ${p.min} y ${p.max}`); }
      else if (p.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max) bad(`tiene que ser un número entre ${p.min} y ${p.max}`); }
      else if (p.type === 'bool') { if (typeof v !== 'boolean') bad('tiene que ser true o false'); }
      else if (p.type === 'enum') { if (!p.options.some((o) => o.value === v)) bad(`tiene que ser uno de ${p.options.map((o) => JSON.stringify(o.value)).join(', ')}`); }
      else if (p.type === 'set') { if (!Array.isArray(v) || !v.length || v.some((x) => !p.options.some((o) => o.value === x)) || new Set(v).size !== v.length) bad(`tiene que ser una lista (sin repetir) con elementos de ${p.options.map((o) => o.value).join(', ')}`); }
    }
  }
  if (errors.length) return { ok: false, errors, warnings };
  // fase 3: cables
  if (g.wires.length > LIMITS.wires) errors.push({ code: 'limit', message: `Hay ${g.wires.length} cables; el máximo es ${LIMITS.wires}.`, example: 'Quita cables redundantes.' });
  const ids = new Set(g.blocks.map((b) => b.id));
  const wireKeys = new Set();
  g.wires.forEach((w, i) => {
    if (!isObj(w) || typeof w.from !== 'string' || typeof w.to !== 'string') { errors.push({ code: 'wire-ref', wire: i, message: `El cable nº ${i + 1} no tiene "from" y "to".`, example: '{"from": "f", "to": "d"}' }); return; }
    if (!ids.has(w.from)) errors.push({ code: 'wire-ref', wire: i, message: `El cable nº ${i + 1} sale de un bloque que no existe: "${w.from}".`, example: 'Crea el bloque o borra el cable.' });
    if (!ids.has(w.to)) errors.push({ code: 'wire-ref', wire: i, message: `El cable nº ${i + 1} llega a un bloque que no existe: "${w.to}".`, example: 'Crea el bloque o borra el cable.' });
    else if (isEye(g.blocks.find((b) => b.id === w.to).type)) errors.push({ code: 'stream-mix', wire: i, blockId: w.to, message: `Los ojos no reciben cables: el cable nº ${i + 1} llega al ojo "${w.to}".`, example: 'Los ojos solo envían: Rasgos → Instinto.' });
    const key = `${w.from}→${w.to}`;
    if (wireKeys.has(key)) warnings.push({ code: 'duplicate-wire', wire: i, message: `El cable ${key} está repetido.` });
    wireKeys.add(key);
  });
  if (errors.length) return { ok: false, errors, warnings };
  // fase 4: grafo, corrientes, dimensiones, límites de tamaño
  const analysis = analyze(g, errors);
  if (!analysis) return { ok: false, errors, warnings };
  const hands = {};
  for (const b of g.blocks) if (isHead(b.type)) { if (hands[b.type]) errors.push({ code: 'duplicate-hand', blockId: b.id, message: `Solo puede haber un bloque ${BLOCKS[b.type].name} por red ("${hands[b.type]}" y "${b.id}").`, example: 'Quita uno de los dos o júntalos con Instinto antes.' }); else hands[b.type] = b.id; }
  if (forPlay && !hands['hand.choose']) errors.push({ code: 'missing-choose', message: 'La red no tiene el bloque Elegir: sin él no puede disparar.', example: 'Candidatos → Instinto → Elegir.' });
  const nParams = paramCountFrom(g, analysis);
  if (nParams > LIMITS.params) errors.push({ code: 'limit', message: `La red tiene ${nParams} parámetros; el máximo es ${LIMITS.params}.`, example: 'Baja las neuronas de las capas grandes (512 × 512 ya son 262 144 pesos).' });
  // avisos: bloques sin camino ojo → mano/pie
  const reach = new Set();
  for (const id of analysis.order) if (isEye(g.blocks.find((b) => b.id === id).type) || analysis.inputs[id].some((i) => reach.has(i))) reach.add(id);
  const feeds = new Set();
  for (const id of [...analysis.order].reverse()) { const b = g.blocks.find((x) => x.id === id); if (isHead(b.type) || g.wires.some((w) => w.from === id && feeds.has(w.to))) feeds.add(id); }
  for (const b of g.blocks) if (!reach.has(b.id) || !feeds.has(b.id)) warnings.push({ code: 'unconnected', blockId: b.id, message: `El bloque "${b.id}" (${BLOCKS[b.type].name}) no está en ningún camino de ojo a mano/pie: no influye en nada.` });
  for (const f of g.frozen) if (!ids.has(f)) warnings.push({ code: 'frozen-ref', message: `"frozen" cita un bloque que no existe: "${f}".` });
  if (errors.length) return { ok: false, errors, warnings };
  // fase 5: pesos
  for (const b of g.blocks) {
    const shapes = weightShapes(b, analysis.dims[b.id]);
    if (!shapes) { if (g.weights[b.id] !== undefined) warnings.push({ code: 'weights-extra', blockId: b.id, message: `El bloque "${b.id}" no tiene parámetros pero trae pesos; se ignoran.` }); continue; }
    const w = g.weights[b.id];
    if (!isObj(w)) { errors.push({ code: 'weights-shape', blockId: b.id, message: `Faltan los pesos del bloque "${b.id}" (${BLOCKS[b.type].name}).`, example: 'Usa repair() o el editor para rellenarlos.' }); continue; }
    for (const [key, len] of Object.entries(shapes)) {
      const arr = w[key];
      if (!Array.isArray(arr) || arr.length !== len) { errors.push({ code: 'weights-shape', blockId: b.id, message: `Los pesos "${key}" del bloque "${b.id}" deberían tener ${len} números (ahora: ${Array.isArray(arr) ? arr.length : 'faltan'}).`, example: 'Cambiar neuronas o cables cambia la forma: usa repair().' }); continue; }
      for (let k = 0; k < len; k++) if (typeof arr[k] !== 'number' || !Number.isFinite(arr[k])) { errors.push({ code: 'weights-nan', blockId: b.id, message: `Los pesos "${key}" del bloque "${b.id}" contienen un valor que no es un número finito (posición ${k}).`, example: 'Reinicializa el bloque.' }); break; }
    }
    for (const key of Object.keys(w)) if (!(key in shapes)) warnings.push({ code: 'weights-extra', blockId: b.id, message: `Pesos "${key}" del bloque "${b.id}" no se usan.` });
  }
  return { ok: errors.length === 0, errors, warnings };
}

// Análisis validado (lanza GenomeError)
export function analyzeGenome(genome, opts = {}) {
  const v = validate(genome, opts);
  if (!v.ok) throw new GenomeError(v.errors[0]);
  const g = normalize(genome);
  const errors = [];
  const a = analyze(g, errors);
  if (!a) throw new GenomeError(errors[0]);
  return { genome: g, ...a };
}

// Análisis sin validar (para el laboratorio, que ya trabaja con genomas normalizados y válidos):
// null si la estructura no cuadra (ciclo, corrientes mezcladas, tamaños). No comprueba los pesos.
export function analyzeUnchecked(genome) {
  const errors = [];
  const a = analyze(genome, errors);
  return a ? { genome, ...a } : null;
}

export function outDims(genome) {
  const a = analyzeGenome(genome);
  return Object.fromEntries(a.order.map((id) => [id, { stream: a.streams[id], dim: a.dims[id].out }]));
}

export function countParams(genome) {
  const a = analyzeGenome(genome);
  return paramCountFrom(a.genome, a);
}

// Rellena pesos que falten o tengan forma incorrecta y quita cables sueltos. Nunca cambia lo válido.
export function repair(genome, rng) {
  const fixes = [];
  const g = normalize(genome);
  const ids = new Set(g.blocks.map((b) => b.id));
  const kept = [];
  g.wires.forEach((w, i) => {
    if (isObj(w) && ids.has(w.from) && ids.has(w.to)) kept.push({ from: w.from, to: w.to });
    else fixes.push(`cable nº ${i + 1} (${w && w.from} → ${w && w.to}) quitado: apunta a un bloque que no existe`);
  });
  g.wires = kept;
  const errors = [];
  const a = analyze(g, errors);
  if (!a) return { genome: g, fixes };
  for (const b of g.blocks) {
    const shapes = weightShapes(b, a.dims[b.id]);
    if (!shapes) continue;
    const w = isObj(g.weights[b.id]) ? g.weights[b.id] : {};
    const fresh = initWeights(b, a.dims[b.id], rng);
    let changed = false;
    const out = {};
    for (const [key, len] of Object.entries(shapes)) {
      const arr = w[key];
      if (Array.isArray(arr) && arr.length === len && arr.every((v) => typeof v === 'number' && Number.isFinite(v))) out[key] = arr;
      else { out[key] = fresh[key]; changed = true; }
    }
    if (changed) fixes.push(`pesos del bloque "${b.id}" (${BLOCKS[b.type].name}) rellenados`);
    if (changed || Object.keys(w).some((k) => !(k in shapes))) g.weights[b.id] = out;
  }
  for (const id of Object.keys(g.weights)) if (!ids.has(id)) { delete g.weights[id]; fixes.push(`pesos del bloque inexistente "${id}" quitados`); }
  return { genome: g, fixes };
}

export function newGenome({ id, name, blocks = [], wires = [], ...rest } = {}, rng) {
  const r = repair({ format: 1, id, name: name || id, blocks, wires, ...rest }, rng);
  return r.genome;
}
