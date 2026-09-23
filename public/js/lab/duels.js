// Lógica pura de la vista de trono y duelos (parte 4; spec/06 §1, §2 y §6.5). Sin DOM.

const LEARNING = ['frozen', 'hot', 'mix'];
const SPEEDS = ['turbo', 'x10', 'x1'];
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

export function duelBody(f) {
  const errors = [];
  if (!f.a || !f.b) errors.push('Elige las dos redes del duelo.');
  else if (f.a === f.b) errors.push('Tienen que ser dos redes distintas.');
  if (!LEARNING.includes(f.learning)) errors.push('El aprendizaje tiene que ser congelado, en caliente o mixto.');
  if (!SPEEDS.includes(f.speed)) errors.push('La velocidad tiene que ser turbo, x10 o x1.');
  let soldiers = f.soldiers;
  if (soldiers !== 'random') {
    soldiers = num(soldiers);
    if (!(Number.isInteger(soldiers) && soldiers >= 1 && soldiers <= 4)) errors.push('Los soldados por bando van de 1 a 4, o al azar por mapa.');
  }
  let seed;
  if (f.seed !== '' && f.seed !== null && f.seed !== undefined) {
    seed = num(f.seed);
    if (!(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31)) errors.push('La semilla tiene que ser un entero entre 0 y 2147483647 (o vacía para una al azar).');
  }
  if (errors.length) return { body: null, errors };
  const body = { a: f.a, b: f.b, learning: f.learning, speed: f.speed, soldiers };
  if (seed !== undefined) body.seed = seed;
  return { body, errors };
}

export function challengeBody(f) {
  const errors = [];
  if (!f.challenger) errors.push('Elige la retadora.');
  if (!LEARNING.includes(f.learning)) errors.push('El aprendizaje tiene que ser congelado, en caliente o mixto.');
  if (!SPEEDS.includes(f.speed)) errors.push('La velocidad tiene que ser turbo, x10 o x1.');
  return errors.length ? { body: null, errors } : { body: { challenger: f.challenger, learning: f.learning, speed: f.speed }, errors };
}

// 3 mapas × 2 lados (spec/06 §1): la partida k va al mapa ⌊k/2⌋, lado k mod 2
export function scoreboard(duel) {
  const maps = [0, 1, 2].map(() => ({ seed: null, soldiers: null, games: [null, null] }));
  for (const g of (duel && duel.games) || []) {
    const m = maps[Math.floor(g.k / 2)];
    if (!m) continue;
    m.games[g.k % 2] = g;
    if (m.seed === null) { m.seed = g.seed; m.soldiers = g.soldiers; }
  }
  return { maps, wins: duel.wins, killDiff: duel.killDiff, winner: duel.winner, tie: duel.tie, played: ((duel && duel.games) || []).length };
}

// árbol: la hija cuelga de su primera madre conocida; sin madres conocidas (fundadora o huérfana), es raíz.
// Hermanas y raíces por fecha de nacimiento. Lo que no se alcanza (un ciclo imposible) también sale como raíz.
export function genealogyTree(genealogy) {
  const nets = (genealogy && genealogy.nets) || {};
  const ids = Object.keys(nets);
  const byBorn = (a, b) => (nets[a].born || 0) - (nets[b].born || 0) || a.localeCompare(b);
  const kids = new Map(ids.map((id) => [id, []]));
  const roots = [];
  for (const id of ids) {
    const mother = (nets[id].parents || []).find((p) => p in nets && p !== id);
    if (mother) kids.get(mother).push(id); else roots.push(id);
  }
  const seen = new Set();
  const build = (id) => {
    seen.add(id);
    const n = nets[id];
    return { id, generation: n.generation ?? 0, born: n.born, exists: n.exists !== false, edited: !!n.edited, orphan: !!n.orphan, children: kids.get(id).sort(byBorn).filter((c) => !seen.has(c)).map(build) };
  };
  const out = roots.sort(byBorn).map(build);
  for (const id of ids.slice().sort(byBorn)) if (!seen.has(id)) out.push(build(id));
  return out;
}

export function flattenTree(tree, depth = 0, out = []) {
  for (const n of tree) {
    const marks = [];
    if (n.edited) marks.push('editada');
    if (!n.exists) marks.push('borrada');
    if (n.orphan) marks.push('huérfana');
    out.push({ id: n.id, depth, generation: n.generation, marks });
    flattenTree(n.children, depth + 1, out);
  }
  return out;
}

export function hallRows(hof) {
  return (hof || []).map((h) => ({ netId: h.netId, reign: h.reignIdx + 1, games: h.reignGames }));
}
