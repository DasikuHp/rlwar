// Lógica pura de la vista de inicio del laboratorio (parte 4; spec/06 §2, spec/08 §4). Sin DOM. Los números salen tal
// cual de la API; las palabras de los retos son las del diario (spec/07 §12, M5).

// la reina primero, después las campeonas de casa, después las más recientes
export function netRows(nets) {
  const rank = (n) => (n.isQueen ? 0 : n.house ? 1 : 2);
  return (nets || []).slice().sort((a, b) => rank(a) - rank(b) || (b.updatedAt || 0) - (a.updatedAt || 0)).map((n) => {
    const s = n.stats || {};
    const games = s.games || 0, wins = s.wins || 0;
    const tags = [];
    if (n.isQueen) tags.push('reina');
    if (n.house) tags.push(`campeona de la casa ${n.house}`);
    if (n.training) tags.push('entrenando');
    if (n.playable === false) tags.push('no puede jugar');
    return { id: n.id, name: n.name, emblem: n.emblem, generation: n.generation ?? 0, paramCount: n.paramCount, blocks: n.blocks, games, wins, kills: s.kills || 0, deaths: s.deaths || 0, winRate: games ? wins / games : null, tags, updatedAt: n.updatedAt };
  });
}

// el reinado abierto de la reina actual; `number` = cuántos reinados lleva el trono contando este
export function reignOf(throne, now = Date.now()) {
  if (!throne || !throne.queen) return null;
  const reigns = throne.reigns || [];
  const idx = reigns.map((r, i) => (r.netId === throne.queen && r.to == null ? i : -1)).filter((i) => i >= 0).pop();
  const r = idx === undefined ? null : reigns[idx];
  return { queen: throne.queen, queenName: throne.queenName || null, since: throne.since, ms: Math.max(0, now - (throne.since || now)), defenses: r ? r.defenses : 0, won: r ? r.won : 0, lost: r ? r.lost : 0, number: idx === undefined ? reigns.length : idx + 1 };
}

const RESULT = { challenger: 'ganó la retadora', queen: 'la reina defendió el trono', tie: 'empate, la reina conserva el trono', void: 'reto anulado' };
export function lastChallenges(throne, n = 5) {
  return ((throne && throne.challenges) || []).slice(-n).reverse().map((c) => ({ ...c, text: RESULT[c.result] || String(c.result) }));
}

export function duration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'menos de 1 min';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return mm ? `${h} h ${mm} min` : `${h} h`;
  return `${mm} min`;
}

export function housesOf(throne) {
  const d = (throne && throne.dynasties) || {};
  return ['A', 'B'].map((key) => ({ key, name: d[key] ? d[key].name : null, champion: d[key] ? d[key].champion : null }));
}
