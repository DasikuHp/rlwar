// Núcleo compartido de agentes: utilidades de simulación y búsqueda sobre el motor
// (`shared/parser.js` + `shared/solver.js`). Cualquier agente usa esto, y los agentes
// remotos (p. ej. un LLM por HTTP) pueden replicarlo importando este mismo módulo.
// Toda aleatoriedad recibe un `rng` (función () → [0,1)); por defecto Math.random (spec/01 §5).
import { tryCompile } from '../shared/parser.js';
import { simulateShot } from '../shared/solver.js';
import { slideMove, los } from '../shared/geometry.js';
import { gaussFrom } from '../shared/rng.js';
import { STEP, MAX_STEPS, MODES, TEAMS, MOVE_OPTION_RADIUS, MOVE_DIRS } from '../shared/constants.js';

export const COARSE = { ds: 0.05, maxSteps: 2500 };

export function contextFor(soldiers, obstacles, soldier, bites = []) {
  const enemies = soldiers.filter((s) => s.alive && s.team !== soldier.team);
  const dir = soldier.team === TEAMS.LEFT ? 1 : -1;
  return { soldiers, obstacles, bites, soldier, enemies, dir };
}

// Simula un candidato (coarse = barrido rápido para puntuar)
export function sim(ctx, cand, coarse) {
  const r = tryCompile(cand.expr);
  if (!r.ok) return null;
  const shot = simulateShot({
    mode: cand.mode, f: r.f, start: { x: ctx.soldier.x, y: ctx.soldier.y },
    angle: (cand.angle || 0) * Math.PI / 180, // grados, como la sala → radianes (solver)
    soldiers: ctx.soldiers, obstacles: ctx.obstacles, bites: ctx.bites || [],
    shooterId: ctx.soldier.id, dir: ctx.dir,
    ds: coarse ? COARSE.ds : STEP, maxSteps: coarse ? COARSE.maxSteps : MAX_STEPS,
  });
  return { shot, f: r.f };
}

export function scoreShot(shot, enemies, soldier) {
  // el tiro atraviesa (spec/01 §10.3): dar a un aliado se evita siempre; cada enemigo alcanzado suma
  const hits = shot.result.hits || [];
  const allies = hits.filter((h) => h.team === soldier.team).length, foes = hits.length - allies;
  if (allies || shot.result.type === 'suicide') return -1000;
  if (foes || shot.result.type === 'kill') return 1000 * Math.max(1, foes);
  let near = 0;
  for (const e of enemies) for (const [px, py] of shot.points) {
    const d = Math.hypot(e.x - px, e.y - py);
    if (d < 3) near = Math.max(near, 60 - d * 15);
  }
  return near * 2 + Math.abs(shot.result.x - soldier.x);
}

// Barrido grueso + verificación fina. Devuelve candidatos ordenados por puntuación.
export function search(ctx, cands, { topN = 6, verify = true, earlyKill = true } = {}) {
  const scored = [];
  for (const cand of cands) {
    const s = sim(ctx, cand, true);
    if (!s) continue;
    scored.push({ cand, score: scoreShot(s.shot, ctx.enemies, ctx.soldier) });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!verify) return scored;
  const out = [];
  for (const item of scored.slice(0, topN)) {
    const s = sim(ctx, item.cand, false);
    out.push({ cand: item.cand, score: s ? scoreShot(s.shot, ctx.enemies, ctx.soldier) : item.score });
    if (earlyKill && out[out.length - 1].score >= 1000) break;
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function best(ctx, cands, opts) {
  const r = search(ctx, cands, opts);
  return r.length ? r[0].cand : { mode: MODES.FUNCTION, expr: '0.1*x' };
}

// Disparos rectos hacia cada enemigo que esté por delante (jitter 0 = puntería exacta)
export function directShots(ctx, { jitter = 0.05, count = 6, rng = Math.random } = {}) {
  const out = [];
  for (const e of ctx.enemies) {
    const dx = e.x - ctx.soldier.x;
    if (Math.sign(dx) !== ctx.dir) continue;
    const slope = (e.y - ctx.soldier.y) / dx;
    for (let i = 0; i < count; i++) {
      const a = slope * (1 + (rng() * 2 - 1) * jitter * i);
      out.push({ mode: MODES.FUNCTION, expr: `${a.toFixed(5)}*x` });
    }
  }
  return out;
}

// Evita repetir disparos que ya fallaron (memoria corta del agente)
export function avoidRepeats(cands, history = [], rng = Math.random) {
  if (!history.length) return cands;
  const recent = new Set(history.slice(-10));
  const filtered = cands.filter((c) => !recent.has(c.expr));
  if (filtered.length >= 4) return filtered;
  // si filtramos demasiado, mezclamos variantes con algo de ruido
  const extra = cands.filter((c) => recent.has(c.expr)).slice(0, 10).map((c) => ({
    ...c,
    expr: c.mode === MODES.FUNCTION
      ? `${c.expr}+${((rng() * 2 - 1) * 0.003).toFixed(4)}`
      : c.expr,
  }));
  return [...filtered, ...extra];
}

// Plantillas de funciones variadas, parametrizadas al azar
export function randomTemplates(n = 40, rng = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (rng() * 2 - 1) * 6;
    const k = 0.5 + rng() * 12;
    const list = [
      `${a.toFixed(3)}*x`,
      `${a.toFixed(3)}*x^2/${k.toFixed(2)}`,
      `${a.toFixed(3)}*sin(x/${k.toFixed(2)})`,
      `x*sin(x/${k.toFixed(2)})*${(a / 6).toFixed(3)}`,
      `${a.toFixed(3)}*(1-exp(-x/${k.toFixed(2)}))`,
      `${a.toFixed(3)}*ln(abs(x)+1)`,
      `${a.toFixed(3)}*sqrt(abs(x))`,
      `${a.toFixed(3)}*x+${(a / k).toFixed(3)}*sin(x/${(k * 2).toFixed(2)})`,
    ];
    out.push({ mode: MODES.FUNCTION, expr: list[Math.floor(rng() * list.length)] });
  }
  return out;
}

// Explicación en español de por qué se eligió ese disparo (va al chat para que
// el rival y los espectadores la vean en vivo).
export function describeShot(choice, ctx) {
  let target = null; let best = Infinity;
  for (const e of ctx.enemies) {
    const d = Math.hypot(e.x - ctx.soldier.x, e.y - ctx.soldier.y);
    if (d < best) { best = d; target = e; }
  }
  const blocked = ctx.obstacles.length
    ? `, ${ctx.obstacles.length} obstáculo(s) en el campo`
    : ', campo despejado';
  const tgt = target
    ? `enemigo más cercano a ${best.toFixed(1)}u en (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`
    : 'sin enemigos a la vista';
  const how = choice.mode === 'ode2'
    ? `parábola y''=${choice.expr} con ángulo ${choice.angle}°`
    : choice.mode === 'ode1'
      ? `EDO y'=${choice.expr}`
      : `recta/curva y=${choice.expr}`;
  return `veo ${tgt}${blocked} → disparo ${how}`;
}

// Voz del agente: razón táctica (registro) + frase corta hablada (bocadillo).
// `say` sale con probabilidad p para no spamear; el servidor la muestra ANTES de disparar.
export function withVoice(shot, ctx, sayPool, p = 0.6, rng = Math.random) {
  shot.reason = describeShot(shot, ctx);
  if (sayPool && sayPool.length && rng() < p) {
    shot.say = sayPool[Math.floor(rng() * sayPool.length)];
  }
  return shot;
}

// Elección ponderada entre los mejores: como la IA original (evolutiva y falible),
// el nivel alto suele clavar la mejor opción pero a veces falla. Sin esto, el que
// calcula la pendiente exacta gana siempre y las partidas duran 3 disparos.
export function pickWeighted(ranked, weights = [0.7, 0.2, 0.1], temperature = 0, rng = Math.random) {
  const n = Math.min(ranked.length, weights.length);
  if (!n) return null;
  const tmp = Math.max(0, Math.min(1, Number(temperature) || 0));
  const flat = tmp * 0.5; // la temperatura aplana los pesos: más sorpresa
  const w = weights.slice(0, n).map((x) => x * (1 - flat) + flat / n);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * sum;
  for (let i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return ranked[i].cand; }
  return ranked[n - 1].cand;
}

// Ruido gaussiano decente sin dependencias
export function gauss(rng = Math.random) {
  return gaussFrom(rng);
}

// Error de ejecución (pulso humano): perturba la pendiente DESPUÉS de elegir,
// porque elegir entre 3 kills perfectos sigue matando siempre. Solo modo función.
export function addMissNoise(shot, sigma, rng = Math.random) {
  if (!sigma || !shot || shot.mode !== 'function') return shot;
  const m = String(shot.expr).match(/^(-?\d+(?:\.\d+)?)\*x/);
  if (!m) return shot;
  const a = Number(m[1]) * (1 + gauss(rng) * sigma);
  return { ...shot, expr: shot.expr.replace(/^(-?\d+(?:\.\d+)?)\*x/, `${a.toFixed(5)}*x`) };
}
export function searchShot(state, soldierId, tries = 40, opts = {}) {
  const rng = opts.rng || Math.random;
  const soldier = state.soldiers.find((s) => s.id === soldierId);
  if (!soldier) return { mode: MODES.FUNCTION, expr: '0.1*x' };
  const ctx = contextFor(state.soldiers, state.obstacles, soldier, state.bites || []);
  const cands = avoidRepeats([
    ...directShots(ctx, { jitter: 0.03, count: 5, rng }),
    ...randomTemplates(tries, rng),
  ], state.history || [], rng);
  for (let i = 0; i < 8; i++) {
    cands.push({ mode: MODES.ODE2, expr: (-0.02 - rng() * 0.12).toFixed(4), angle: (rng() * 2 - 1) * 60 });
  }
  return best(ctx, cands, opts);
}

// ---------- movimiento (spec/01 §3 y §5) ----------

// Línea de tiro: vive en shared/geometry.js (la usan también la percepción y la sala)
export { los };

// Los 9 destinos (quedarse + 8 direcciones a MOVE_OPTION_RADIUS, spec/10 §3): `to` = el punto pedido (también si es
// imposible: `impossible` y la regla que falla en `why`). Los rasgos, donde acabaría de verdad (en `from` si es imposible):
// cover = enemigos vivos con línea de tiro · distEnemy = distancia al enemigo vivo más cercano (null si no hay) · los =
// línea de tiro a ese enemigo
export function moveOptions(ctx) {
  const from = { x: ctx.soldier.x, y: ctx.soldier.y };
  const terrain = { obstacles: ctx.obstacles, bites: ctx.bites || [] };
  const out = [];
  for (let i = 0; i <= MOVE_DIRS; i++) {
    let to = { x: from.x, y: from.y }, why = null;
    if (i > 0) {
      const th = (i - 1) * (2 * Math.PI / MOVE_DIRS);
      to = { x: from.x + MOVE_OPTION_RADIUS * Math.cos(th), y: from.y + MOVE_OPTION_RADIUS * Math.sin(th) };
      why = slideMove({ from, requested: to, soldiers: ctx.soldiers, obstacles: ctx.obstacles, bites: ctx.bites || [], selfId: ctx.soldier.id }).why;
    }
    const at = why ? from : to;
    let cover = 0, distEnemy = null, nearest = null;
    for (const e of ctx.enemies) {
      const d = Math.hypot(e.x - at.x, e.y - at.y);
      if (distEnemy === null || d < distEnemy) { distEnemy = d; nearest = e; }
      if (los(at, e, terrain)) cover++;
    }
    out.push({ i, to, stay: i === 0, impossible: !!why, why, cover, distEnemy, los: nearest ? los(at, nearest, terrain) : false });
  }
  return out;
}

// Reglas de esquiva de los heurísticos (spec/01 §5). Devuelven {x,y} o 'stay'.
// solo entre los destinos posibles (spec/10 §5); quedarse (el 0) siempre lo es
export function coverMove(all, { stayIfCovered = false } = {}) {
  const options = all.filter((o) => !o.impossible);
  const ranked = options.slice().sort((a, b) => a.cover - b.cover || b.distEnemy - a.distEnemy || a.i - b.i);
  const bestOpt = ranked[0];
  if (stayIfCovered && options[0].cover === bestOpt.cover) return 'stay';
  return bestOpt.stay ? 'stay' : { x: bestOpt.to.x, y: bestOpt.to.y };
}
export function greedyMove(all) {
  const options = all.filter((o) => !o.impossible);
  const withLos = options.filter((o) => o.cover > 0).sort((a, b) => a.distEnemy - b.distEnemy || a.i - b.i);
  const pick = withLos.length ? withLos[0] : options.slice().sort((a, b) => a.cover - b.cover || a.i - b.i)[0];
  return pick.stay ? 'stay' : { x: pick.to.x, y: pick.to.y };
}
