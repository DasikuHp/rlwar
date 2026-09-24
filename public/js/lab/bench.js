// Banco de pruebas del editor (P6): la red decide en una escena congelada, aquí mismo, con el MISMO código que usa el
// servidor en POST /nets/:id/whatif (shared/nn.js + shared/policy.js, spec/08 §9.3). Como corre en el navegador,
// responde al momento mientras cambias un ajuste, y de paso da lo que ve cada ojo y la señal de cada bloque (los
// "nervios" del lienzo). Lógica pura, sin DOM: la prueba test/ui-crear.spec.mjs.
import { compile } from '../../../shared/nn.js';
import { decideShot, decideMove } from '../../../shared/policy.js';
import { makeRng } from '../../../shared/rng.js';
import { validate } from '../../../shared/genome.js';
import { eyeLayout } from '../../../shared/percept.js';

export const PLANE = { xMin: -25, xMax: 25, yMin: -15, yMax: 15 };
const C = (x, y, r) => ({ kind: 'circle', x, y, r });
const S = (id, team, x, y) => ({ id, team, x, y });

// escenas fijas con el terreno de ahora (círculos, P1); quien decide ("yo") está siempre a la izquierda
export const BENCH_SCENES = [
  { key: 'abierto', name: 'A campo abierto', explain: 'Un enemigo enfrente y nada en medio: ¿apunta directo o se complica?',
    scene: { soldiers: [S('yo', 'left', -15, 0), S('rival', 'right', 15, 3)], obstacles: [], soldierId: 'yo' } },
  { key: 'roca', name: 'Tras una roca', explain: 'Una roca grande en medio: hay que pasar por encima o por debajo.',
    scene: { soldiers: [S('yo', 'left', -15, -2), S('rival', 'right', 12, 1)], obstacles: [C(-1, -1, 4)], soldierId: 'yo' } },
  { key: 'dos', name: 'Dos contra dos', explain: 'Dos enemigos a distinta altura, una aliada y dos rocas: ¿a quién prefiere? ¿se cuida de no dar a su aliada?',
    scene: { soldiers: [S('yo', 'left', -16, 4), S('amiga', 'left', -12, -6), S('rival-1', 'right', 14, 5), S('rival-2', 'right', 17, -4)], obstacles: [C(0, 0, 2.5), C(7, 7, 2)], soldierId: 'yo' } },
  { key: 'alto', name: 'Enemigo en alto', explain: 'El rival está arriba del todo, lejos, con rocas en el camino: un tiro difícil.',
    scene: { soldiers: [S('yo', 'left', -18, -10), S('rival', 'right', 16, 11)], obstacles: [C(-4, -3, 4), C(8, 4, 3)], soldierId: 'yo' } },
  { key: 'alineados', name: 'Dos en fila', explain: 'Dos enemigos en línea: el tiro atraviesa, así que una recta puede tumbar a los dos.',
    scene: { soldiers: [S('yo', 'left', -18, -6), S('rival-1', 'right', 6, 0), S('rival-2', 'right', 18, 5)], obstacles: [C(-6, 8, 3)], soldierId: 'yo' } },
];

// ---------- tu escena: se edita arrastrando ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
export const copyScene = (sc) => JSON.parse(JSON.stringify(sc));
export function moveSoldier(sc, id, x, y) {
  const next = copyScene(sc);
  const s = next.soldiers.find((q) => q.id === id);
  if (s) { s.x = r1(clamp(x, PLANE.xMin + 0.5, PLANE.xMax - 0.5)); s.y = r1(clamp(y, PLANE.yMin + 0.5, PLANE.yMax - 0.5)); }
  return next;
}
export function moveObstacle(sc, i, x, y) {
  const next = copyScene(sc);
  const o = next.obstacles[i];
  if (o && o.kind === 'circle') { o.x = r1(clamp(x, PLANE.xMin, PLANE.xMax)); o.y = r1(clamp(y, PLANE.yMin, PLANE.yMax)); }
  return next;
}
export function addRock(sc, x, y, r = 2.5) {
  const next = copyScene(sc);
  if (next.obstacles.length >= 64) return next;
  next.obstacles.push(C(r1(clamp(x, PLANE.xMin, PLANE.xMax)), r1(clamp(y, PLANE.yMin, PLANE.yMax)), r1(clamp(r, 0.8, 6))));
  return next;
}
export function resizeRock(sc, i, r) {
  const next = copyScene(sc);
  if (next.obstacles[i] && next.obstacles[i].kind === 'circle') next.obstacles[i].r = r1(clamp(r, 0.8, 6));
  return next;
}
export function removeRock(sc, i) { const next = copyScene(sc); next.obstacles.splice(i, 1); return next; }
export function addSoldier(sc, team) {
  const next = copyScene(sc);
  if (next.soldiers.length >= 8) return next;
  const n = next.soldiers.filter((s) => s.team === team).length + 1;
  let id = team === 'left' ? `amiga-${n}` : `rival-${n}`;
  for (let k = n + 1; next.soldiers.some((s) => s.id === id); k++) id = team === 'left' ? `amiga-${k}` : `rival-${k}`;
  next.soldiers.push(S(id, team, team === 'left' ? -10 : 10, r1(-10 + 20 * ((n * 0.37) % 1))));
  return next;
}
export function removeSoldier(sc, id) {
  if (id === sc.soldierId) return sc; // quien decide no se quita
  const next = copyScene(sc);
  next.soldiers = next.soldiers.filter((s) => s.id !== id);
  return next;
}
// lo mismo que comprueba el servidor en whatif: si falla, el motivo en una frase
export function sceneError(sc) {
  if (!sc || !Array.isArray(sc.soldiers) || !sc.soldiers.length || sc.soldiers.length > 32) return 'La escena necesita de 1 a 32 soldados.';
  if (sc.obstacles && sc.obstacles.length > 64) return 'Como mucho 64 obstáculos.';
  for (const s of sc.soldiers) if (!(Math.abs(s.x) <= 25 && Math.abs(s.y) <= 15)) return `${s.id} está fuera del plano.`;
  const me = sc.soldiers.find((s) => s.id === sc.soldierId);
  if (!me) return 'Falta el soldado que decide.';
  if (!sc.soldiers.some((s) => s.team !== me.team)) return 'Pon al menos un enemigo: sin enemigos no hay a quién apuntar.';
  return null;
}

// ---------- decidir: igual que el servidor ----------
// genome: el que editas (o el guardado); phase: 'shoot' | 'move'. Devuelve {ok, decision, obs, error}
export function decide(genome, sc, { phase = 'shoot', seed = 1 } = {}) {
  const err = sceneError(sc);
  if (err) return { ok: false, error: err };
  const val = validate(genome, { forPlay: true });
  if (!val.ok) return { ok: false, error: val.errors[0].message, errors: val.errors };
  const soldiers = sc.soldiers.map((s) => ({ ownerId: s.ownerId || (s.team === 'left' ? 'pL' : 'pR'), alive: s.alive !== false, turns: 0, ...s, alive: s.alive !== false }));
  const state = { soldiers, obstacles: sc.obstacles || [], bites: sc.bites || [], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, players: [] };
  try {
    const net = compile(genome);
    const rng = makeRng(Number.isInteger(seed) && seed >= 0 ? seed : 1);
    const args = { net, genome, state, soldierId: sc.soldierId, memory: net.zeroState(), team: null, rng };
    const r = phase === 'move' ? decideMove({ ...args, shot: null }) : decideShot({ ...args, attribution: true });
    return { ok: true, decision: r.decision, obs: r.obs };
  } catch (e) { return { ok: false, error: `La red no pudo decidir: ${e.message}` }; }
}

// el elegido y su certeza (lo mismo que whatif.js hace con la respuesta del servidor)
export function pick(d) {
  if (!d) return null;
  if (d.phase === 'move') {
    if (!Array.isArray(d.moves) || d.chosenMove === null) return null;
    const m = d.moves[d.chosenMove], ps = d.moves.map((x) => x.p).sort((a, b) => b - a);
    return { kind: 'move', i: m.i, to: m.to, stay: m.stay, p: m.p, certainty: ps.length > 1 ? ps[0] - ps[1] : 1 };
  }
  const c = Array.isArray(d.candidates) ? d.candidates.find((x) => x.i === d.chosen) : null;
  if (!c) return null;
  const ps = d.candidates.map((x) => x.p).sort((a, b) => b - a);
  return { kind: 'shot', i: c.i, family: c.family, expr: c.expr, mode: c.mode, angle: c.angle, p: c.p, certainty: ps.length > 1 ? ps[0] - ps[1] : 1, points: c.points };
}
// ¿la red editada escoge lo mismo que la guardada? (por lo que es el tiro, no por su número: spec/08 §12)
export function sameChoice(a, b) {
  const x = pick(a), y = pick(b);
  if (!x || !y) return false;
  if (x.kind === 'move') return x.stay === y.stay && x.to.x === y.to.x && x.to.y === y.to.y;
  return x.mode === y.mode && x.family === y.family && x.expr === y.expr && String(x.angle ?? null) === String(y.angle ?? null);
}

// ---------- lo que ve cada ojo y cuánto se activa cada bloque ----------
const meanAbs = (a) => { let s = 0, n = 0; for (const v of a) { s += Math.abs(v); n++; } return n ? s / n : 0; };
const flat = (x) => (Array.isArray(x) ? x.flatMap((r) => Array.from(r)) : Array.from(x || []));
// por ojo: {blockId, stream, names, rows: [[valores]]} — rows tiene 1 fila (contexto), N (candidatos) o 9 (destinos)
export function eyesView(genome, obs) {
  if (!obs) return [];
  return genome.blocks.filter((b) => String(b.type).startsWith('eye.')).map((b) => {
    const names = eyeLayout(b).map((x) => x.name);
    const src = obs.ctx[b.id] ? { stream: 'ctx', rows: [Array.from(obs.ctx[b.id])] } : obs.cand[b.id] ? { stream: 'cand', rows: obs.cand[b.id].map((r) => Array.from(r)) } : obs.move[b.id] ? { stream: 'move', rows: obs.move[b.id].map((r) => Array.from(r)) } : { stream: null, rows: [] };
    return { blockId: b.id, type: b.type, names, ...src };
  });
}
// señal de cada bloque, de 0 a 1 respecto al más activo: para que los nervios del lienzo laten con datos reales.
// {id: {level, mean, sample}} — level 0..1; sample = hasta 32 valores reales (para los puntos de las neuronas)
export function signal(genome, decision, obs) {
  const out = {};
  const sum = (decision && decision.activationsSummary) || {};
  for (const [id, s] of Object.entries(sum)) out[id] = { mean: s.mean, sample: s.sample.slice() };
  if (obs) for (const b of genome.blocks) if (String(b.type).startsWith('eye.')) {
    const v = flat(obs.ctx[b.id] || obs.cand[b.id] || obs.move[b.id] || []);
    const k = Math.min(32, v.length);
    out[b.id] = { mean: meanAbs(v), sample: Array.from({ length: k }, (_, i) => v[Math.floor((i * v.length) / k)]) };
  }
  const max = Math.max(1e-9, ...Object.values(out).map((x) => x.mean));
  for (const x of Object.values(out)) x.level = Math.min(1, x.mean / max);
  return out;
}
