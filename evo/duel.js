// Duelos (spec/06 §1, §6.1–§6.2): 3 mapas × 2 lados con semillas hash32, ranking, modos de aprendizaje
// (frozen / hot / mix) y partidas guardadas para la moviola. `play` y `learner` son inyectables.
import { hash32 } from '../shared/rng.js';
import { playGame } from '../server/headless.js';
import { createRoom } from '../server/rooms.js';
import { loadNet, saveGameKept, saveGameNets, appendLog } from './store.js';
import { makeLearner, settleFeedback } from './train.js';
import { holdNet, releaseNet } from './busy.js';

export const LEARNING_MODES = ['frozen', 'hot', 'mix'];
export const SPEEDS = ['turbo', 'x1', 'x10'];

export function duelPlan({ a, b, seed = 0, soldiers = 'random' } = {}) {
  const rows = [];
  for (let k = 0; k < 6; k++) {
    const m = Math.floor(k / 2);
    const sold = soldiers === 'random' ? 1 + (hash32(seed, 100 + m) % 4) : Math.max(1, Math.min(4, Number(soldiers) || 2));
    rows.push({ k, seed: hash32(seed, m), soldiers: sold, left: k % 2 === 0 ? a : b, right: k % 2 === 0 ? b : a });
  }
  return rows;
}

export function duelScore(rows, a, b, { throne = false, queen = null } = {}) {
  const wins = { [a]: 0, [b]: 0 };
  let killDiff = 0;
  for (const r of rows) {
    if (r.winner === a) wins[a]++; else if (r.winner === b) wins[b]++;
    const k = r.kills || {};
    killDiff += (k[a] || 0) - (k[b] || 0);
  }
  let winner = null, tie = false;
  if (wins[a] !== wins[b]) winner = wins[a] > wins[b] ? a : b;
  else if (killDiff !== 0) winner = killDiff > 0 ? a : b;
  else { tie = true; if (throne && queen) winner = queen; }
  return { wins, killDiff, winner, tie };
}

// ---------- jugar una fila del plan ----------
const netSpec = (genome) => ({ type: 'net', genome, name: genome.name, learn: false });
function summarize(room, row) {
  const byTeam = {};
  for (const p of room.players) byTeam[p.team] = p;
  const ids = { left: row.left, right: row.right };
  const winner = room.result && room.result.winner ? ids[room.result.winner] : null;
  const kills = { [row.left]: (byTeam.left && byTeam.left.kills) || 0, [row.right]: (byTeam.right && byTeam.right.kills) || 0 };
  const trajectories = {}, playerIds = {};
  for (const p of room.players) {
    if (p.agentType === 'net' && room.agents[p.id]) trajectories[p.id] = { netId: ids[p.team], soldiers: room.agents[p.id].trajectories };
    playerIds[ids[p.team]] = p.id;
  }
  return { winner, kills, events: room.events, trajectories, playerIds, gameId: room.gameId, result: room.result };
}

export function makePlay({ speed = 'turbo', duelId = null, saveGames = true, genomes = {}, shouldStop = null, throne = false, onLive = null } = {}) {
  const genomeOf = (id) => genomes[id] || loadNet(id);
  return async (row) => {
    const left = netSpec(genomeOf(row.left)), right = netSpec(genomeOf(row.right));
    let out;
    if (speed === 'turbo') {
      const r = playGame({ seed: row.seed, left, right, soldiers: row.soldiers });
      out = { ...summarize(r.room, row), roomCode: null };
    } else {
      const room = createRoom(`duelo ${left.name} vs ${right.name}`, { soldiersPerPlayer: row.soldiers, seed: row.seed, speed: speed === 'x10' ? 10 : 1 });
      room.addAgent('net', { level: 3, team: 'left', genome: left.genome, learn: false });
      room.addAgent('net', { level: 3, team: 'right', genome: right.genome, learn: false });
      row.roomCode = room.code;
      if (onLive) onLive(room.code); // se puede espectar mientras se juega (M8)
      room.start();
      while (room.phase === 'playing' && !(shouldStop && shouldStop())) await new Promise((r) => setTimeout(r, 200));
      if (room.phase === 'playing') room.gameOver(true);
      out = { ...summarize(room, row), roomCode: room.code };
    }
    if (saveGames) {
      saveGameKept({ gameId: out.gameId, kind: 'duel', duelId, throne: !!throne, seed: row.seed, soldiers: row.soldiers, left: row.left, right: row.right, nets: [row.left, row.right], winner: out.winner, kills: out.kills, ts: Date.now() }, out.events, out.trajectories, { genomes: { [row.left]: left.genome, [row.right]: right.genome } });
      if (throne) saveGameNets(out.gameId, { [row.left]: left.genome, [row.right]: right.genome });
    }
    return out;
  };
}

// aprendiz por defecto: el de evo/train.js (Adam + optim.json), con estadísticas de la red
export function defaultLearner(netId) {
  const L = makeLearner(loadNet(netId));
  return {
    learn: (games, opts) => L.learn(games, opts),
    review: (games) => L.review(games),
    save: () => L.save(),
    addStats: (s) => L.addStats(s),
    method: L.method,
    evolve: (o) => L.evolve(o),
    genome: L.genome,
  };
}

// un id por duelo, único también entre reinicios y procesos (spec/06 §7.2): d<ms base 36><pid>-<n>
let duelSeq = 0;
export function newDuelId() {
  const pid = (typeof process !== 'undefined' ? process.pid : 0) % 1296;
  return `d${Date.now().toString(36)}${pid.toString(36).padStart(2, '0')}-${++duelSeq}`;
}
export async function runDuel(opts = {}) {
  const id = opts.id || newDuelId();
  // las dos redes quedan ocupadas todo el duelo, también el paso de evolución del final (spec/04 §10.5)
  const holder = { kind: 'duel', id }, nets = [...new Set([opts.a, opts.b])];
  for (const netId of nets) holdNet(netId, holder);
  try {
    return await playDuel({ ...opts, id });
  } finally {
    for (const netId of nets) releaseNet(netId, holder);
    // lo que quedó en cola mientras estaba ocupada se aplica ya, si nadie más la tiene
    for (const netId of nets) {
      try { settleFeedback(netId); } catch (e) { appendLog({ type: 'error', netId, duelId: id, message: `no se pudo aplicar la cola de bofetadas y caricias: ${e.message}` }); }
    }
  }
}
async function playDuel(opts) {
  const { id, a, b, learning = 'mix', speed = 'turbo', soldiers = 'random', seed = 0, throne = false, queen = null, onGame = null, shouldStop = null, saveGames = true } = opts;
  const rec = { id, a, b, status: 'running', learning, speed, throne, soldiers, seed, games: [], wins: { [a]: 0, [b]: 0 }, killDiff: 0, winner: null, tie: false, ms: 0, roomCodes: [], liveRoom: null, startedAt: Date.now() };
  if (opts.onStart) opts.onStart(rec);
  const stop = () => !!(shouldStop && shouldStop());
  const learners = {};
  const learnEnabled = a !== b;
  const learnerOf = (netId) => learners[netId] || (learners[netId] = (opts.learner || defaultLearner)(netId));
  const play = opts.play || makePlay({ speed, duelId: id, saveGames, genomes: {}, shouldStop, throne, onLive: (code) => { rec.liveRoom = code; } });
  const plan = duelPlan({ a, b, seed, soldiers });
  const played = [];
  const t0 = Date.now();
  const gameFor = (out, netId) => ({ events: out.events, trajectory: out.trajectories[out.playerIds[netId]] || { netId, soldiers: {} }, playerId: out.playerIds[netId] });
  for (const row of plan) {
    if (stop()) break;
    if (speed === 'turbo') await new Promise((r) => setImmediate(r));
    const out = await play(row);
    rec.liveRoom = null;
    const game = { k: row.k, seed: row.seed, soldiers: row.soldiers, left: row.left, right: row.right, winner: out.winner, kills: out.kills, gameId: out.gameId || null, roomCode: out.roomCode || row.roomCode || null };
    rec.games.push(game);
    if (game.roomCode) rec.roomCodes.push(game.roomCode);
    played.push(out);
    if (learnEnabled) {
      for (const netId of [a, b]) {
        const L = learnerOf(netId);
        if (L.addStats) L.addStats({ games: 1, wins: out.winner === netId ? 1 : 0, kills: (out.kills || {})[netId] || 0, deaths: (out.kills || {})[netId === a ? b : a] || 0 });
        if (learning === 'hot') L.learn([gameFor(out, netId)], { lrScale: 1 });
        else if (learning === 'mix') L.learn([gameFor(out, netId)], { lrScale: 0.25 });
        L.save();
      }
    }
    Object.assign(rec, duelScore(rec.games, a, b, { throne, queen }));
    rec.ms = Date.now() - t0;
    if (onGame) onGame(row.k, game, rec);
  }
  if (learnEnabled && (learning === 'frozen' || learning === 'mix') && played.length) {
    for (const netId of [a, b]) { const L = learnerOf(netId); L.review(played.map((out) => gameFor(out, netId))); L.save(); }
  }
  // redes con evolución: al acabar el duelo, un paso de evolución contra la rival tal como quedó (spec/04 §10.2)
  if (learnEnabled && played.length) {
    const evolvers = [a, b].filter((netId) => { const L = learnerOf(netId); return L.evolve && (L.method === 'evolution' || L.method === 'both'); });
    const endOf = (netId) => { const L = learnerOf(netId); return L.genome ? JSON.parse(JSON.stringify({ ...L.genome, weights: L.net ? L.net.serialize() : L.genome.weights })) : loadNet(netId); };
    const rivals = Object.fromEntries(evolvers.map((netId) => [netId, endOf(netId === a ? b : a)]));
    for (const netId of evolvers) {
      const L = learnerOf(netId);
      const out = await L.evolve({ rival: { type: 'net', genome: rivals[netId], name: rivals[netId].name, learn: false }, seed, soldiers });
      L.save();
      appendLog({ type: 'update', kind: 'evolution', netId, duelId: id, games: out.update.games, meanFitness: out.update.meanFitness, bestFitness: out.update.bestFitness, top: out.update.top });
      if (out.lesson) appendLog({ type: 'lesson', netId, duelId: id, blockId: out.lesson.blockId, name: out.lesson.name, relChange: out.lesson.relChange, bulb: out.lesson.bulb });
    }
  }
  Object.assign(rec, duelScore(rec.games, a, b, { throne, queen }));
  rec.status = rec.games.length === plan.length ? 'done' : 'stopped';
  rec.ms = Date.now() - t0;
  return rec;
}
