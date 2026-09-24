// Recompensa (spec/04 §2, §9.3): asigna cada término a la decisión que le corresponde a partir de los
// eventos de la partida, normaliza por término (NERO) y calcula retornos. Puro.
export function normalizeStats(stats, term, value) {
  const s = stats[term] || (stats[term] = { n: 0, mean: 0, var: 0 });
  s.n++;
  const alpha = 1 / Math.min(s.n, 500);
  const delta = value - s.mean;
  s.mean += alpha * delta;
  s.var += alpha * (delta * (value - s.mean) - s.var);
  if (s.n <= 20) return value; // sin normalizar hasta tener una σ fiable
  return value / Math.max(0.1, Math.sqrt(Math.max(0, s.var)));
}

// G_t = Σ_k γ^(k−t) r_k
export function returns(values, gamma) {
  const out = new Float64Array(values.length);
  let acc = 0;
  for (let t = values.length - 1; t >= 0; t--) { acc = values[t] + gamma * acc; out[t] = acc; }
  return out;
}

export function assignRewards({ reward, teamSpirit = 0.5, events, trajectory, playerId, stats = null, extraTerms = null }) {
  const st = stats || reward.stats || {};
  const soldiers = trajectory && trajectory.soldiers ? trajectory.soldiers : {};
  const entries = [];
  for (const [soldierId, steps] of Object.entries(soldiers)) {
    for (const s of steps) {
      if (!s.decision || s.decision.error || !Number.isInteger(s.decision.eventId)) continue;
      entries.push({ soldierId, turn: s.turn, phase: s.phase, decision: s.decision, obs: s.obs, terms: {}, own: 0, team: 0, effective: 0 });
    }
  }
  const byDecision = new Map(entries.map((e) => [e.decision.eventId, e]));
  const add = (e, term, value) => { if (!e) return; e.terms[term] = (e.terms[term] || 0) + value; };
  const myShots = events.filter((ev) => ev.type === 'shot' && ev.actor.playerId === playerId);
  for (const ev of events) {
    if (ev.type === 'shot' && ev.actor.playerId === playerId) {
      const e = byDecision.get(ev.data.decisionEventId);
      if (!e) continue;
      const res = ev.data.result || {};
      const t = res.type;
      // el tiro atraviesa (spec/01 §10.3): kill por cada enemigo y friendlyFire por cada aliado; sin cuentas (partidas antiguas), uno
      const kills = Number.isInteger(res.kills) ? res.kills : t === 'kill' ? 1 : 0;
      const friendly = Number.isInteger(res.friendly) ? res.friendly : t === 'suicide' ? 1 : 0;
      if (kills) add(e, 'kill', reward.kill * kills);
      if (friendly) add(e, 'friendlyFire', reward.friendlyFire * friendly);
      if (!kills && !friendly && typeof ev.data.minDist === 'number' && ev.data.minDist <= reward.grazeRadius) add(e, 'graze', reward.graze);
      if (!friendly && typeof ev.data.minAllyDist === 'number' && ev.data.minAllyDist <= 1.5) add(e, 'nearFriendly', reward.nearFriendly);
      const prev = myShots.filter((s) => s.id < ev.id).slice(-10);
      if (prev.some((s) => s.data.expr === ev.data.expr)) add(e, 'repeatExpr', reward.repeatExpr);
    } else if (ev.type === 'move' && ev.actor.playerId === playerId) {
      const e = byDecision.get(ev.data.decisionEventId);
      const gain = Math.max(0, (ev.data.coverBefore || 0) - (ev.data.coverAfter || 0));
      if (e && gain > 0) add(e, 'cover', reward.cover * gain);
      // pidió un sitio imposible y perdió el movimiento (spec/10 §6)
      if (ev.data.reason === 'blocked') add(e, 'impossibleMove', reward.impossibleMove);
    } else if (ev.type === 'death' && ev.actor.playerId === playerId) {
      const mine = entries.filter((e) => e.soldierId === ev.actor.soldierId && e.decision.eventId < ev.id);
      if (mine.length) add(mine[mine.length - 1], 'die', reward.die);
    }
  }
  if (extraTerms) for (const [id, terms] of Object.entries(extraTerms)) { const e = byDecision.get(Number(id)); if (e) for (const [term, value] of Object.entries(terms)) add(e, term, value); }
  const end = events.filter((ev) => (ev.type === 'win' || ev.type === 'lose') && ev.actor.playerId === playerId).pop();
  const dead = new Set(events.filter((ev) => ev.type === 'death' && ev.actor.playerId === playerId).map((ev) => ev.actor.soldierId));
  for (const soldierId of Object.keys(soldiers)) {
    const mine = entries.filter((e) => e.soldierId === soldierId);
    if (!mine.length) continue;
    const last = mine[mine.length - 1];
    if (end) add(last, end.type, reward[end.type]);
    if (!dead.has(soldierId) && events.some((ev) => ['win', 'lose', 'draw'].includes(ev.type))) add(last, 'survive', reward.survive);
  }
  for (const e of entries) {
    let own = 0;
    for (const [term, value] of Object.entries(e.terms)) own += reward.normalize ? normalizeStats(st, term, value) : value;
    e.own = own;
  }
  const team = entries.length ? entries.reduce((s, e) => s + e.own, 0) / entries.length : 0;
  for (const e of entries) { e.team = team; e.effective = (1 - teamSpirit) * e.own + teamSpirit * team; }
  return { entries, stats: st };
}
