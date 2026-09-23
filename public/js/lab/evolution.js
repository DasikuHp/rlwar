// Lógica pura de la vista de evolución (parte 4; spec/05 §1, §4, §5 y §10.3–§10.4). Sin DOM.

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

// la configuración de mutación por defecto: la del catálogo, tipo a tipo (copia nueva cada vez)
export function defaultMutation(catalogMutation) {
  return Object.fromEntries((catalogMutation || []).map((t) => [t.key, Object.fromEntries((t.params || []).map((p) => [p.key, clone(p.default)]))]));
}

// formulario → cuerpo de POST /api/lab/nets/:id/children, con los límites del servidor (spec/05 §10.4)
export function childrenBody(f) {
  const errors = [];
  const n = num(f.n), games = num(f.games);
  if (!(Number.isInteger(n) && n >= 1 && n <= 16)) errors.push('Pide entre 1 y 16 hijos.');
  if (!(Number.isInteger(games) && games >= 0 && games <= 20)) errors.push('Las partidas del pre-torneo van de 0 (sin pre-torneo) a 20.');
  let soldiers = f.soldiers;
  if (soldiers !== 'random') {
    soldiers = num(soldiers);
    if (!(Number.isInteger(soldiers) && soldiers >= 1 && soldiers <= 4)) errors.push('Los soldados por bando van de 1 a 4, o al azar.');
  }
  let seed;
  if (f.seed !== '' && f.seed !== null && f.seed !== undefined) {
    seed = num(f.seed);
    if (!(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31)) errors.push('La semilla tiene que ser un entero entre 0 y 2147483647 (o vacía para una al azar).');
  }
  if (errors.length) return { body: null, errors };
  const body = { n, mutation: f.mutation, pretournament: { games, opponentId: f.opponentId || null, soldiers } };
  if (seed !== undefined) body.seed = seed;
  return { body, errors };
}

export function rankingRows(ranking) {
  return (ranking || []).map((r, i) => ({ pos: i + 1, best: i === 0, id: r.id, name: r.name, wins: r.wins, killDiff: r.killDiff, kills: r.kills, deaths: r.deaths, opsText: r.opsText || [] }));
}

// mapa de calor: una sola tinta, del fondo (#0e1627, sin cambio) al cyan (#4fd1ff, el mayor cambio del bloque)
const LO = [14, 22, 39], HI = [79, 209, 255];
export function heatColor(v) {
  const t = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return `rgb(${LO.map((a, i) => Math.round(a + (HI[i] - a) * t)).join(',')})`;
}

export function diffSummary(diff) {
  const count = (s) => (diff.blocks || []).filter((b) => b.status === s).length;
  const before = (diff.traits && diff.traits.before) || {}, after = (diff.traits && diff.traits.after) || {};
  const keys = [...Object.keys(before), ...Object.keys(after).filter((k) => !(k in before))];
  return {
    same: count('same'), changed: count('changed'), added: count('added'), removed: count('removed'),
    wiresAdded: ((diff.wires && diff.wires.added) || []).length, wiresRemoved: ((diff.wires && diff.wires.removed) || []).length,
    traits: keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ key: k, before: before[k], after: after[k] })),
    imaginationChanged: JSON.stringify((diff.imagination || {}).before) !== JSON.stringify((diff.imagination || {}).after),
  };
}
