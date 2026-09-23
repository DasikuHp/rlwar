// Lógica pura de la vista Verdad (parte 4; spec/07 §6, §7, §9 y §12.5–§12.8). Sin DOM.

const r2 = (v) => Math.round(v * 100) / 100;
const AXES = [['aim', 'puntería'], ['cover', 'cobertura'], ['survival', 'supervivencia'], ['adaptation', 'adaptación']];

// radar del boletín: un eje por examen, en el sentido de las agujas del reloj desde arriba
export function radar(scores, { cx, cy, r }) {
  const s = scores || {};
  const axes = AXES.map(([key, label], k) => {
    const raw = typeof s[key] === 'number' ? s[key] : null;
    const value = raw === null ? 0 : Math.min(1, Math.max(0, raw));
    const ang = -Math.PI / 2 + k * Math.PI / 2;
    return { key, label, raw, value, x: cx + Math.cos(ang) * r * value, y: cy + Math.sin(ang) * r * value, ex: cx + Math.cos(ang) * r, ey: cy + Math.sin(ang) * r };
  });
  return { axes, polygon: axes.map((a) => `${r2(a.x)},${r2(a.y)}`).join(' ') };
}

// decisiones de una red en una partida (moviola), en orden; las recortadas por el tope no tienen cerebro
export function netTurns(game, netId) {
  return ((game && game.events) || [])
    .filter((e) => e.type === 'decision' && e.actor && e.actor.netId === netId && !(e.data && e.data.truncated))
    .sort((a, b) => a.id - b.id)
    .map((e) => ({ turn: e.turn, phase: e.data.phase, eventId: e.id, playerId: e.actor.playerId, soldierId: e.actor.soldierId }));
}

// de cada bloque, la fila que importa: en un disparo, la candidata elegida; al moverse, el destino elegido
export function activationRows(activations, decision) {
  const d = decision || {};
  return Object.entries(activations || {}).map(([blockId, a]) => {
    let row = null, values = a;
    if (Array.isArray(a) && Array.isArray(a[0])) {
      row = 0;
      if (d.phase === 'shoot' && Array.isArray(d.candidates) && a.length === d.candidates.length && Number.isInteger(d.chosen)) row = d.chosen;
      else if (d.phase === 'move' && Array.isArray(d.moves) && a.length === d.moves.length && Number.isInteger(d.chosenMove)) row = d.chosenMove;
      values = a[row] || [];
    }
    const max = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return { blockId, row, values, norm: values.map((v) => (max ? Math.abs(v) / max : 0)), max };
  });
}

export function rivalRows(memory) {
  const rivals = (memory && memory.rivals) || {};
  return Object.entries(rivals)
    .map(([rivalId, r]) => ({ rivalId, games: r.games, wins: r.wins, killsBy: r.killsBy, killsOf: r.killsOf, pride: r.pride, grudge: r.grudge, respect: r.respect }))
    .sort((a, b) => b.games - a.games || a.rivalId.localeCompare(b.rivalId));
}

// recuerdos: menos partidas atrás primero; empate, el que se añadió después
export function lastEpisodes(memory, n = 20) {
  const eps = (memory && memory.episodes) || [];
  return eps.map((e, i) => ({ e, i })).sort((a, b) => (a.e.gamesAgo || 0) - (b.e.gamesAgo || 0) || b.i - a.i).slice(0, n).map((x) => x.e);
}
