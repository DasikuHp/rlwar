// Lógica pura de la vista de dinastías (parte 4; spec/06 §3 y §6.4). Sin DOM.

const LEARNING = ['frozen', 'hot', 'mix'];
const SPEEDS = ['turbo', 'x10', 'x1'];
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

// fundar las dos casas, o refundar una (`house`) sin usar la campeona de la otra (`otherChampion`)
export function foundBody(form, house = null, otherChampion = null) {
  const errors = [];
  const keys = house ? [house] : ['A', 'B'];
  const body = {};
  for (const h of keys) {
    const f = form[h] || {};
    const name = String(f.name || '').trim() || `Casa ${h}`;
    if (!f.netId) errors.push(`Elige la campeona de la casa ${h}.`);
    if (name.length > 32) errors.push(`El nombre de la casa ${h} tiene que tener como mucho 32 letras.`);
    body[h] = { name, netId: f.netId };
  }
  if (!house && body.A.netId && body.A.netId === body.B.netId) errors.push('Las dos casas necesitan campeonas distintas.');
  if (house && otherChampion && body[house].netId === otherChampion) errors.push('Esa red ya es la campeona de la otra casa.');
  return errors.length ? { body: null, errors } : { body, errors };
}

// los valores por defecto del servidor (spec/06 §6.4)
export const defaultGeneration = () => ({ games: 20, trainSpeed: 'turbo', soldiers: 'random', n: 4, ptGames: 4, learning: 'mix', duelSpeed: 'turbo' });

export function generationBody(f) {
  const errors = [];
  const games = num(f.games), n = num(f.n), pt = num(f.ptGames);
  if (!(Number.isInteger(games) && games >= 1)) errors.push('El entreno de cada campeona necesita 1 partida o más.');
  if (!SPEEDS.includes(f.trainSpeed)) errors.push('La velocidad del entreno tiene que ser turbo, x10 o x1.');
  let soldiers = f.soldiers;
  if (soldiers !== 'random') {
    soldiers = num(soldiers);
    if (!(Number.isInteger(soldiers) && soldiers >= 1 && soldiers <= 4)) errors.push('Los soldados por bando van de 1 a 4, o al azar.');
  }
  if (!(Number.isInteger(n) && n >= 1 && n <= 16)) errors.push('Cada casa cría entre 1 y 16 hijos.');
  if (!(Number.isInteger(pt) && pt >= 0 && pt <= 20)) errors.push('El pre-torneo va de 0 a 20 partidas.');
  if (!LEARNING.includes(f.learning)) errors.push('El aprendizaje del duelo tiene que ser congelado, en caliente o mixto.');
  if (!SPEEDS.includes(f.duelSpeed)) errors.push('La velocidad del duelo tiene que ser turbo, x10 o x1.');
  if (errors.length) return { body: null, errors };
  return { body: { training: { speed: f.trainSpeed, duration: { games }, soldiers }, children: { n, pretournament: { games: pt } }, duel: { learning: f.learning, speed: f.duelSpeed } }, errors };
}

export function houseView(key, d) {
  if (!d) return null;
  return { key, name: d.name, champion: d.champion, generation: d.generation, founder: d.founder, history: (d.history || []).slice().reverse() };
}

// el relato: las entradas de dinastía de la crónica del servidor (frases verificadas con refs), la más reciente primero
export function dynastyStory(entries) {
  return (entries || []).filter((e) => e.kind === 'dynasty').sort((a, b) => (b.t || 0) - (a.t || 0) || (b.id || 0) - (a.id || 0));
}
