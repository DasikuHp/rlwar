// Boletín de habilidades (spec/07 §7, §12.6): cuatro exámenes con semilla fija. Determinista.
import { Room } from '../server/rooms.js';
import { playGame } from '../server/headless.js';
import { normalize, validate } from '../shared/genome.js';
import { threads } from './threads.js';

export const EXAM_SEEDS = { aim: 9001, cover: 9002, survival: 9003, adaptation: 9004 };
// blanco inofensivo (spec/07 §13.1): su disparo explota en el primer punto y nunca alcanza a nadie.
// (`y = 1000` no valía: en modo función la constante no cuenta y era la horizontal que pasa por él)
const DUMMY = { chooseShot: () => ({ mode: 'function', expr: 'sqrt(-1)', reason: '' }), chooseMove: () => 'stay' };
// adaptación = tasa media × (1 − (máx − mín)) sobre las tasas por tamaño: perder todo da 0 (spec/07 §13.1)
export function adaptationScore(rates) {
  const r = Object.values(rates);
  if (!r.length) return 0;
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  return mean * (1 - (Math.max(...r) - Math.min(...r)));
}

const isGenome = (s) => s && typeof s === 'object' && Array.isArray(s.blocks);
function seatSubject(room, subject, team) {
  if (isGenome(subject)) return room.addAgent('net', { level: 3, team, genome: subject, learn: false, name: subject.name });
  return room.addAgent(subject.type || 'sniper', { level: subject.level ?? 3, team, temperature: subject.temperature ?? 0 });
}
const subjectSpec = (subject) => (isGenome(subject) ? { type: 'net', genome: subject, learn: false, name: subject.name } : { type: subject.type || 'sniper', level: subject.level ?? 3, temperature: subject.temperature ?? 0 });

// una escena: el examinado a la izquierda, un agente ficticio a la derecha que dispara y = 1000 (fuera del plano)
function scene(subject, seed, { untilMove = false } = {}) {
  const room = new Room('examen', { soldiersPerPlayer: 1, seed, headless: true });
  const me = seatSubject(room, subject, 'left');
  const dummy = room.addAgent('sniper', { level: 1, team: 'right', name: 'blanco' });
  if (me.error || dummy.error) throw new Error(me.error || dummy.error);
  room.start();
  const dummyId = room.players.find((p) => p.team === 'right').id;
  room.agents[dummyId] = DUMMY;
  const myId = room.players.find((p) => p.team === 'left').id;
  let shots = 0;
  for (let i = 0; i < 12 && room.phase === 'playing'; i++) {
    room.step();
    const myShots = room.events.filter((e) => e.type === 'shot' && e.actor.playerId === myId);
    const myMoves = room.events.filter((e) => e.type === 'move' && e.actor.playerId === myId);
    if (myShots.length >= 1 && (!untilMove || myMoves.length >= 1 || room.phase !== 'playing')) { shots = myShots.length; break; }
  }
  const shot = room.events.find((e) => e.type === 'shot' && e.actor.playerId === myId) || null;
  const move = room.events.find((e) => e.type === 'move' && e.actor.playerId === myId) || null;
  if (room.phase === 'playing') room.gameOver(true);
  return { room, myId, shot, move, shots };
}

export async function runBulletin(subject, { onScene = null } = {}) {
  const subj = isGenome(subject) ? normalize(subject) : subject;
  if (isGenome(subj) && !validate(subj, { forPlay: true }).ok) throw Object.assign(new Error('la red no puede jugar (falta Elegir)'), { status: 400 });
  // en el servidor, el examen entero se hace en un hilo (evo/threads.js): mismo código, mismo resultado
  const T = threads();
  if (T) return (await T.run({ type: 'bulletin', subject: subj }, (p) => { if (onScene) onScene(...p.args); })).value;
  const details = { aim: [], cover: [], survival: [], adaptation: {} };
  const yieldNow = () => new Promise((r) => setImmediate(r));
  // puntería: 40 escenas
  for (let i = 0; i < 40; i++) {
    const seed = EXAM_SEEDS.aim + i;
    const s = scene(subj, seed);
    const kill = !!(s.shot && s.shot.data.result && s.shot.data.result.type === 'kill');
    details.aim.push({ seed, kill, result: s.shot ? s.shot.data.result.type : null, minDist: s.shot ? s.shot.data.minDist : null, expr: s.shot ? s.shot.data.expr : null });
    if (onScene) onScene('aim', i, 40);
    if (i % 10 === 9) await yieldNow();
  }
  // cobertura: 30 escenas
  for (let i = 0; i < 30; i++) {
    const seed = EXAM_SEEDS.cover + i;
    const s = scene(subj, seed, { untilMove: true });
    const before = s.move ? s.move.data.coverBefore : null, after = s.move ? s.move.data.coverAfter : null;
    details.cover.push({ seed, improved: s.move ? after < before : false, coverBefore: before, coverAfter: after, stayed: s.move ? !!s.move.data.stayed : null });
    if (onScene) onScene('cover', i, 30);
    if (i % 10 === 9) await yieldNow();
  }
  // supervivencia: 10 partidas vs Sniper L3, 2 soldados, lados alternos
  for (let i = 0; i < 10; i++) {
    const seed = EXAM_SEEDS.survival + i;
    const me = subjectSpec(subj), rival = { type: 'sniper', level: 3, temperature: 0 };
    const left = i % 2 === 0 ? me : rival, right = i % 2 === 0 ? rival : me;
    const r = playGame({ seed, left, right, soldiers: 2 });
    const team = i % 2 === 0 ? 'left' : 'right';
    const alive = r.room.soldiers.filter((s) => s.team === team && s.alive).length;
    details.survival.push({ seed, alive, total: 2, winner: r.result ? r.result.winner : null, side: team });
    if (onScene) onScene('survival', i, 10);
    await yieldNow();
  }
  // adaptación: 16 partidas vs Greedy L3, 4 por tamaño (1..4 soldados), dos a cada lado (spec/07 §13.1)
  const byN = { 1: [], 2: [], 3: [], 4: [] };
  details.adaptationGames = [];
  for (let i = 0; i < 16; i++) {
    const seed = EXAM_SEEDS.adaptation + i;
    const n = 1 + Math.floor(i / 4);
    const me = subjectSpec(subj), rival = { type: 'greedy', level: 3, temperature: 0 };
    const left = i % 2 === 0 ? me : rival, right = i % 2 === 0 ? rival : me;
    const r = playGame({ seed, left, right, soldiers: n });
    const team = i % 2 === 0 ? 'left' : 'right';
    const win = r.result && r.result.winner === team ? 1 : 0;
    byN[n].push(win);
    details.adaptationGames.push({ seed, soldiers: n, side: team, win });
    if (onScene) onScene('adaptation', i, 16);
    await yieldNow();
  }
  for (const n of [1, 2, 3, 4]) details.adaptation[n] = byN[n].length ? byN[n].reduce((s, v) => s + v, 0) / byN[n].length : 0;
  const aim = details.aim.filter((x) => x.kill).length / 40;
  const cover = details.cover.filter((x) => x.improved).length / 30;
  const survival = details.survival.reduce((s, x) => s + x.alive, 0) / details.survival.reduce((s, x) => s + x.total, 0);
  const adaptation = adaptationScore(details.adaptation);
  return { aim, cover, survival, adaptation, details, seeds: { ...EXAM_SEEDS } };
}
