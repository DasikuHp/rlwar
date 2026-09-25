// Moviola en el mismo sitio (P6, sesión 14; diseño del relevo s9): rehace una partida guardada tiro a tiro con el mismo
// solver que el servidor. El motor es determinista: con los obstáculos del mapa, los bocados hasta ese tiro, la posición
// del tirador y su modo, función y ángulo, la curva sale exacta (el test la compara con la del SSE).
// Pero solo en Node: el Math.sin (y exp, tan…) de Chrome difiere del de Node en el último bit, y eso basta para que una
// curva roce o no una roca. Por eso el servidor rehace las curvas (`withCurves`, GET /api/lab/games/:id?solo=jugadas) y el
// navegador solo las dibuja: `replay` usa los puntos que traiga cada `shot` y solo resuelve si no los trae.
// Módulo puro: sin DOM, para el servidor, el editor (Probar ya) y los tests.
import { simulateShot } from './solver.js';
import { tryCompile } from './parser.js';

const copy = (s) => ({ ...s });

// game = {meta?, events} (GET /api/lab/games/:id) →
// {ok, why?, map, obstacles, players, frames, final, result, approx, unknown}
// frames[i] = el tiro i: quién, qué, su curva rehecha (`points`), el resultado guardado, cómo estaba el plano justo antes
// (`soldiers`, `bites`), lo que dijo antes de disparar (`says`), adónde se movió después (`move`) y `exact` (la curva
// rehecha acaba igual que la de la partida: mismos alcanzados, mismo final y mismo bocado).
export function replay(game) {
  const events = (game && Array.isArray(game.events)) ? game.events : [];
  const start = events.find((e) => e.type === 'game.start');
  if (!start || !start.data || !start.data.map || !Array.isArray(start.data.map.obstacles)) {
    return { ok: false, why: 'Esta partida no guarda su mapa: es de antes del terreno nuevo y no se puede rehacer.' };
  }
  const d = start.data;
  const players = (d.players || []).map((p) => ({ id: p.playerId, name: p.name, team: p.team, netId: p.netId || null }));
  const teamOf = (playerId) => (players.find((p) => p.id === playerId) || {}).team || null;
  const obstacles = d.map.obstacles.map(copy);

  // dónde empieza cada soldado: `positions` (desde la sesión 14); en una partida anterior, el primer `move.from` de cada
  // uno (nadie más lo mueve antes). Quien nunca se movió no se sabe dónde estaba.
  const approx = !Array.isArray(d.positions);
  const pos = new Map();
  if (!approx) for (const s of d.positions) pos.set(s.id, { id: s.id, ownerId: s.playerId, team: s.team, x: s.x, y: s.y, alive: true });
  else {
    for (const e of events) {
      const id = e.actor && e.actor.soldierId;
      if (e.type === 'move' && id && !pos.has(id) && e.data && e.data.from) pos.set(id, { id, ownerId: e.actor.playerId, team: teamOf(e.actor.playerId), x: e.data.from.x, y: e.data.from.y, alive: true });
    }
  }
  const unknown = [];
  for (const e of events) {
    const ids = e.type === 'shot' ? ((e.data.result && e.data.result.hits) || []) : e.type === 'death' && e.actor ? [e.actor.soldierId] : [];
    for (const id of ids) if (id && !pos.has(id) && !unknown.includes(id)) unknown.push(id);
  }
  const initial = [...pos.values()].map(copy);

  const soldiers = pos, bites = [], frames = [];
  let says = [], result = null;
  for (const e of events) {
    if (e.type === 'say' && e.actor && e.actor.soldierId) { says.push({ soldierId: e.actor.soldierId, text: e.data.text }); continue; }
    if (e.type === 'win' || e.type === 'lose' || e.type === 'draw') { result = result || { ...e.data }; continue; }
    if (e.type === 'move') {
      const s = soldiers.get(e.actor.soldierId);
      const f = frames[frames.length - 1];
      if (f && f.soldierId === e.actor.soldierId && !f.move) {
        f.move = { from: { ...e.data.from }, to: { ...e.data.to }, stayed: !!e.data.stayed, reason: e.data.reason || null, why: e.data.why || null };
        // el tirador salió de donde la moviola lo tenía: la cadena de posiciones está rota
        if (s && (s.x !== e.data.from.x || s.y !== e.data.from.y)) f.exact = false;
      }
      if (s) { s.x = e.data.to.x; s.y = e.data.to.y; }
      continue;
    }
    if (e.type !== 'shot') continue;
    const sh = soldiers.get(e.actor.soldierId);
    const rec = e.data.result || {};
    const frame = {
      i: frames.length, turn: e.turn, soldierId: e.actor.soldierId, playerId: e.actor.playerId, team: sh ? sh.team : teamOf(e.actor.playerId),
      mode: e.data.mode, expr: e.data.expr, angle: e.data.angle,
      result: { type: rec.type, hits: (rec.hits || []).slice(), kills: rec.kills || 0, friendly: rec.friendly || 0, end: rec.end },
      bite: e.data.bite ? { ...e.data.bite } : null,
      soldiers: [...soldiers.values()].map(copy), bites: bites.map(copy), says, move: null, points: null, exact: false,
    };
    says = [];
    const c = tryCompile(String(e.data.expr));
    if (Array.isArray(e.data.points)) { frame.points = e.data.points; frame.exact = e.data.exact === true; }
    else if (sh && c.ok) {
      const sim = simulateShot({
        mode: e.data.mode, f: c.f, start: { x: sh.x, y: sh.y }, dir: sh.team === 'left' ? 1 : -1,
        angle: (Number(e.data.angle) || 0) * Math.PI / 180, // grados (evento) → radianes (solver), como la sala
        soldiers: [...soldiers.values()], obstacles, bites, shooterId: sh.id,
      });
      frame.points = sim.points;
      const hits = sim.result.hits.map((h) => h.soldierId);
      const sameBite = frame.bite ? sim.result.x === frame.bite.x && sim.result.y === frame.bite.y : true;
      frame.exact = sim.result.type === rec.type && sim.result.end === rec.end && hits.join() === frame.result.hits.join() && sameBite;
    } else frame.points = sh ? [[sh.x, sh.y]] : [];
    frames.push(frame);
    // lo que pasó de verdad (lo guardado), aunque la curva rehecha no coincidiera
    for (const id of frame.result.hits) { const v = soldiers.get(id); if (v) v.alive = false; }
    if (frame.bite) bites.push({ ...frame.bite });
  }
  return {
    ok: true, map: { name: d.map.name, biome: d.map.biome }, obstacles, players, initial, frames,
    final: { soldiers: [...soldiers.values()].map(copy), bites: bites.map(copy), says },
    result, approx, unknown,
  };
}

// los puntos de una curva, uno cada `step` u como poco (y el último), redondeados a milésimas de unidad: a la escala del
// plano no se nota y la partida pasa de megas a cientos de kB
export function thin(points, step = 0.1) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const out = [];
  let last = null;
  for (const p of points) if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= step) { out.push([r(p[0]), r(p[1])]); last = p; }
  const end = points[points.length - 1];
  if (end && last !== end) out.push([r(end[0]), r(end[1])]);
  return out;
}

// para el servidor: los eventos de la partida con la curva rehecha de cada tiro (`points`, aligerada) y si cuadra (`exact`)
export function withCurves(events, step = 0.1) {
  const rp = replay({ events });
  if (!rp.ok) return events;
  let i = 0;
  return events.map((e) => {
    if (e.type !== 'shot') return e;
    const f = rp.frames[i++];
    return { ...e, data: { ...e.data, points: thin(f.points, step), exact: f.exact } };
  });
}

// el plano después de `k` tiros (0 = al empezar; frames.length = al acabar): soldados, bocados, las curvas ya trazadas y
// las bajas de cada bando
export function stateAt(rp, k) {
  const n = rp.frames.length, at = Math.max(0, Math.min(n, k));
  const base = at < n ? rp.frames[at] : rp.final;
  const kills = { left: 0, right: 0 };
  for (const f of rp.frames.slice(0, at)) kills[f.team] = (kills[f.team] || 0) + f.result.kills;
  return {
    k: at, soldiers: base.soldiers.map(copy), bites: base.bites.map(copy), kills,
    trails: rp.frames.slice(0, at).filter((f) => f.points && f.points.length > 1).map((f) => ({ points: f.points, team: f.team })),
  };
}

// qué pasó con un tiro, en palabras (para la barra de la función)
export function shotText(f, nameOf = (id) => id) {
  const r = f.result;
  if (r.kills && r.friendly) return `💥 ${r.kills === 1 ? 'una baja' : `${r.kills} bajas`} y 💀 ${r.friendly === 1 ? 'un aliado' : `${r.friendly} aliados`}`;
  if (r.kills) return `💥 ${r.kills === 1 ? `acierta a ${nameOf(r.hits[0])}` : `${r.kills} bajas de un tiro`}`;
  if (r.friendly) return `💀 ${r.friendly === 1 ? 'mata a un aliado' : `mata a ${r.friendly} aliados`}`;
  return { obstacle: '🪨 choca con una roca', wall: '🧱 sale del plano', invalid: '❌ la función explota', steep: '📐 se pone vertical' }[r.end] || '💤 se queda sin recorrido';
}
