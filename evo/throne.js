// Trono y dinastías (spec/06 §2, §3, §6.3–§6.4): retar, sentar, sala de la fama con copia congelada,
// fundar casas y correr una generación (entreno cruzado → cría → promoción → duelo entre casas).
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../shared/genome.js';
import { makeRng, randomSeed } from '../shared/rng.js';
import { loadNet, saveNet, netsDir, listNets, appendLog } from './store.js';
import { readThroneFull, writeThrone, updateLeague, registerBirth, structureSha } from './league.js';
import { runDuel as runDuelDefault } from './duel.js';
import { mutate, mutationConfig } from './mutate.js';
import { runPretournamentAsync } from './children.js';
import { createTrainer } from './train.js';

export { emptyThrone, readThroneFull, writeThrone, updateLeague, winrate, recentLoss, pickOpponent, structureSha, registerBirth, genealogyView } from './league.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const clone = (v) => JSON.parse(JSON.stringify(v));

export function throneView() {
  const t = readThroneFull();
  const q = t.queen ? loadNet(t.queen) : null;
  return { ...t, queenName: q ? q.name : null };
}

// registra en la liga las partidas de un duelo (tablas no cuentan)
export function recordDuelInLeague(t, rec) {
  for (const g of rec.games) if (g.winner === rec.a || g.winner === rec.b) updateLeague(t, rec.a, rec.b, g.winner === rec.a);
}

function snapshotQueen(t, queenId, now) {
  const g = loadNet(queenId);
  const dir = join(netsDir(), queenId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const n = t.hallOfFame.filter((h) => h.netId === queenId).length + 1;
  const file = join(dir, `hof-${n}.json`);
  const snap = { ...clone(g), frozen: g.blocks.map((b) => b.id) };
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(snap)); renameSync(tmp, file);
  const reignIdx = t.reigns.length - 1;
  // ruta relativa a la carpeta de datos, con /: sigue valiendo si se mueve la carpeta (B3)
  return { netId: queenId, snapshot: `nets/${queenId}/hof-${n}.json`, reignIdx, reignGames: t.reigns[reignIdx] ? t.reigns[reignIdx].defenses + t.reigns[reignIdx].lost : 0, sha: structureSha(g), ts: now };
}

// challenge(opts, hooks) → {result: seated|queen|challenger|tie, queen, duelId?}
// nombre de una red en este momento, para el registro (M5): el cronista no tiene otro sitio de donde sacarlo
const nameOf = (id) => (id && (loadNet(id) || {}).name) || null;

export async function challenge({ challenger, learning = 'mix', speed = 'turbo', seed } = {}, hooks = {}) {
  const now = hooks.now || Date.now;
  const emit = (ev) => { if (hooks.onEvent) hooks.onEvent(ev); appendLog(ev); };
  const g = loadNet(challenger);
  if (!g) throw httpError(404, `Red no encontrada: ${challenger}`);
  if (!validate(g, { forPlay: true }).ok) throw httpError(400, `La red ${challenger} no puede jugar (falta Elegir)`);
  let t = readThroneFull();
  if (t.queen === challenger) throw httpError(400, 'Una red no puede retarse a sí misma');
  if (!t.queen) {
    const ts = now();
    t.queen = challenger; t.since = ts;
    t.reigns.push({ netId: challenger, from: ts, to: null, defenses: 0, won: 0, lost: 0 });
    writeThrone(t);
    emit({ type: 'reign.start', netId: challenger, queen: challenger, name: nameOf(challenger), ts });
    return { result: 'seated', queen: challenger };
  }
  if (!loadNet(t.queen)) {
    // la reina ya no existe (spec/06 §7.1): se cierra su reinado y se sienta la retadora, sin duelo
    const ts = now(), gone = t.queen;
    const old = t.reigns[t.reigns.length - 1];
    if (old && !old.to) { old.to = ts; old.ended = 'missing'; }
    t.queen = challenger; t.since = ts;
    t.reigns.push({ netId: challenger, from: ts, to: null, defenses: 0, won: 0, lost: 0 });
    writeThrone(t);
    emit({ type: 'reign.end', netId: gone, queen: challenger, reason: 'missing', ts });
    emit({ type: 'reign.start', netId: challenger, queen: challenger, name: nameOf(challenger), ts });
    return { result: 'seated', queen: challenger };
  }
  const queen = t.queen;
  const duelOpts = { a: challenger, b: queen, learning, speed, seed: Number.isInteger(seed) ? seed : randomSeed(), throne: true, queen };
  const started = hooks.startDuel ? hooks.startDuel(duelOpts) : null;
  const duelId = started ? started.id : null;
  if (hooks.onDuelStart) hooks.onDuelStart({ duelId, queen, challenger });
  const rec = started ? await started.promise : await (hooks.runDuel || runDuelDefault)(duelOpts);
  t = readThroneFull();
  if (!rec || rec.status === 'error' || (rec.status === 'stopped' && !(Array.isArray(rec.games) && rec.games.length))) {
    // un duelo que falla o no juega nada no decide nada: reto anulado (spec/06 §7.1)
    const ts = now(), cid = `c${t.challenges.length + 1}`;
    const error = (rec && rec.error) || 'el duelo no jugó ninguna partida';
    t.challenges.push({ id: cid, challenger, queen, duelId: rec ? rec.id : duelId, result: 'void', error, ts });
    writeThrone(t);
    emit({ type: 'challenge', id: cid, challenger, queen, duelId: rec ? rec.id : duelId, result: 'void', error, challengerName: nameOf(challenger), queenName: nameOf(queen), ts });
    return { result: 'void', queen, duelId: rec ? rec.id : duelId };
  }
  recordDuelInLeague(t, rec);
  const ts = now();
  const result = rec.tie ? 'tie' : rec.winner === challenger ? 'challenger' : 'queen';
  const cid = `c${t.challenges.length + 1}`;
  t.challenges.push({ id: cid, challenger, queen, duelId: rec.id, result, ts });
  const reign = t.reigns[t.reigns.length - 1];
  if (result === 'challenger') {
    if (reign) { reign.to = ts; reign.lost++; }
    t.hallOfFame.push(snapshotQueen(t, queen, ts));
    t.queen = challenger; t.since = ts;
    t.reigns.push({ netId: challenger, from: ts, to: null, defenses: 0, won: 0, lost: 0 });
    writeThrone(t);
    emit({ type: 'challenge', id: cid, challenger, queen, duelId: rec.id, result, challengerName: nameOf(challenger), queenName: nameOf(queen), ts });
    emit({ type: 'reign.end', netId: queen, queen: challenger, duelId: rec.id, name: nameOf(queen), ts });
    emit({ type: 'reign.start', netId: challenger, queen: challenger, duelId: rec.id, name: nameOf(challenger), ts });
  } else {
    if (reign) { reign.defenses++; reign.won++; }
    writeThrone(t);
    emit({ type: 'challenge', id: cid, challenger, queen, duelId: rec.id, result, challengerName: nameOf(challenger), queenName: nameOf(queen), ts });
  }
  return { result, queen: t.queen, duelId: rec.id };
}

// al borrar con force a la reina o a una campeona (spec/06 §7.1): su reinado se cierra / la casa queda sin campeona
export function vacateNet(netId, hooks = {}) {
  const t = readThroneFull(), ts = Date.now();
  const out = { queen: false, houses: [] };
  if (t.queen === netId) {
    const reign = t.reigns[t.reigns.length - 1];
    if (reign && !reign.to) { reign.to = ts; reign.ended = 'deleted'; }
    t.queen = null; t.since = null; out.queen = true;
  }
  for (const h of ['A', 'B']) if (t.dynasties[h] && t.dynasties[h].champion === netId) { t.dynasties[h].champion = null; out.houses.push(h); }
  if (!out.queen && !out.houses.length) return out;
  writeThrone(t);
  const name = hooks.name || nameOf(netId); // al borrar, la red ya no está en el disco: el nombre llega en hooks.name
  const events = [...(out.queen ? [{ type: 'reign.end', netId, queen: null, reason: 'deleted', name, ts }] : []), ...out.houses.map((h) => ({ type: 'dynasty', house: h, houseName: t.dynasties[h].name, event: 'champion.deleted', netId, name, ts }))];
  for (const ev of events) { appendLog(ev); if (hooks.onEvent) hooks.onEvent(ev); }
  return out;
}

// ---------- dinastías ----------
const houseOf = (h) => (h === 'A' || h === 'B' ? h : null);
export function foundDynasties(body = {}, house = null) {
  const t = readThroneFull();
  const houses = house ? [house] : ['A', 'B'];
  for (const h of houses) {
    if (!houseOf(h)) throw httpError(404, `Casa desconocida: ${h}`);
    const spec = body[h];
    if (!spec || typeof spec.netId !== 'string') throw httpError(400, `Falta la casa ${h}: {name, netId}`);
    if (!loadNet(spec.netId)) throw httpError(404, `Red no encontrada: ${spec.netId}`);
  }
  const ids = houses.map((h) => body[h].netId);
  const otherId = house ? (t.dynasties[house === 'A' ? 'B' : 'A'] || {}).champion : null;
  if (new Set([...ids, ...(otherId ? [otherId] : [])]).size < ids.length + (otherId ? 1 : 0)) throw httpError(400, 'Las dos casas no pueden usar la misma red');
  for (const h of houses) t.dynasties[h] = { name: String(body[h].name || `Casa ${h}`).slice(0, 32), champion: body[h].netId, generation: 0, founder: body[h].netId, history: [] };
  writeThrone(t);
  return { A: t.dynasties.A, B: t.dynasties.B };
}

function nextJobId() { return `cj${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`; }

// una generación completa (spec/06 §3, §6.4). hooks: onEvent, registerJob, startDuel, onProgress
export async function runGeneration(body = {}, hooks = {}) {
  let t = readThroneFull();
  const emit = (house, event, extra = {}) => { const ev = { type: 'dynasty', house, houseName: (t.dynasties[house] || {}).name || null, event, ...extra }; if (hooks.onEvent) hooks.onEvent(ev); appendLog(ev); };
  if (!t.dynasties.A || !t.dynasties.B) throw httpError(400, 'Primero funda las dos casas (POST /api/lab/dynasties)');
  const seed = Number.isInteger(body.seed) ? body.seed : randomSeed();
  const training = { speed: 'turbo', duration: { games: 20 }, soldiers: 'random', workers: 1, ...(body.training || {}) };
  delete training.netId; delete training.antagonistId;
  const childrenCfg = { n: 4, mutation: null, pretournament: { games: 4, soldiers: 'random' }, ...(body.children || {}) };
  const duelCfg = { learning: 'frozen', speed: 'turbo', soldiers: 'random', ...(body.duel || {}) };
  if (!t.dynasties.A.champion || !t.dynasties.B.champion) throw httpError(400, `La casa ${t.dynasties.A.champion ? 'B' : 'A'} no tiene campeona: vuelve a fundarla con ?house=`);
  // los duelos de la generación pasan por el registro del API (ids únicos, SSE) si lo hay (spec/06 §7.2)
  const runDuel = hooks.runDuel || (hooks.startDuel ? (opts) => hooks.startDuel(opts).promise : runDuelDefault);
  let done = 0; const total = 6;
  const progress = () => { done++; if (hooks.onProgress) hooks.onProgress(done, total); };
  const result = { trainings: {}, children: {}, promoted: {}, duelId: null, winner: null, tie: false, A: null, B: null };
  const champ = (h) => readThroneFull().dynasties[h].champion;
  // 1. entreno cruzado
  for (const h of ['A', 'B']) {
    const other = h === 'A' ? 'B' : 'A';
    const tr = createTrainer({ ...training, netId: champ(h), opponents: { antagonist: 1, hallOfFame: 0, self: 0, ...(training.opponents || {}), antagonistId: champ(other) }, seed: seed + (h === 'A' ? 1 : 2) });
    if (hooks.registerTraining) hooks.registerTraining(tr);
    emit(h, 'train', { trainingId: tr.id, netId: champ(h), against: champ(other), name: nameOf(champ(h)), againstName: nameOf(champ(other)) });
    await tr.start();
    if (tr.status === 'error') throw new Error(`entreno de la casa ${h}: ${tr.error}`);
    result.trainings[h] = tr.id;
    progress();
  }
  // 2. cría y promoción
  for (const h of ['A', 'B']) {
    const other = h === 'A' ? 'B' : 'A';
    const mother = loadNet(champ(h)), rival = loadNet(champ(other));
    const jobId = hooks.registerJob ? hooks.registerJob('children', mother.id) : nextJobId();
    const all = listNets();
    const existing = new Set(all.map((x) => x.id)), names = new Set(all.map((x) => x.name));
    const kids = [];
    for (let k = 0; k < childrenCfg.n; k++) {
      const { child } = mutate(mother, mutationConfig(childrenCfg.mutation), makeRng(seed + 100 * (h === 'A' ? 1 : 2) + k), { sibling: k, existingIds: existing, existingNames: names });
      existing.add(child.id); names.add(child.name);
      const r = saveNet(child);
      if (!r.ok) throw new Error(`hijo ${child.id} inválido`);
      registerBirth(loadNet(child.id));
      kids.push(loadNet(child.id));
    }
    const pre = await runPretournamentAsync({ children: kids, opponent: rival, games: childrenCfg.pretournament.games ?? 4, seed: seed + 1000 * (h === 'A' ? 1 : 2), soldiers: childrenCfg.pretournament.soldiers ?? 'random' });
    if (hooks.finishJob) hooks.finishJob(jobId, { parentId: mother.id, ranking: pre.ranking });
    emit(h, 'children', { jobId, parentId: mother.id, ranking: pre.ranking, motherName: mother.name || null });
    result.children[h] = jobId;
    const best = pre.ranking[0];
    let promoted = false;
    if (best) {
      const duel = await runDuel({ a: best.id, b: mother.id, learning: duelCfg.learning, speed: duelCfg.speed, soldiers: duelCfg.soldiers, seed: seed + 2000 * (h === 'A' ? 1 : 2), throne: false, league: false }); // la liga la cuenta aquí
      t = readThroneFull(); recordDuelInLeague(t, duel);
      if (duel.winner === best.id && !duel.tie) { t.dynasties[h].champion = best.id; promoted = true; }
      writeThrone(t);
      emit(h, 'promote', { duelId: duel.id, child: best.id, mother: mother.id, promoted, childName: nameOf(best.id) || best.name || null, motherName: mother.name || null });
    }
    result.promoted[h] = promoted;
    progress();
  }
  // 3. duelo entre casas
  const a = champ('A'), b = champ('B');
  const duel = await runDuel({ a, b, learning: duelCfg.learning, speed: duelCfg.speed, soldiers: duelCfg.soldiers, seed: seed + 3000, throne: false, league: false });
  t = readThroneFull(); recordDuelInLeague(t, duel);
  result.duelId = duel.id; result.winner = duel.winner; result.tie = duel.tie;
  for (const h of ['A', 'B']) {
    const d = t.dynasties[h];
    const won = duel.winner === d.champion && !duel.tie;
    if (won) d.generation++;
    d.history.push({ generation: d.generation, champion: d.champion, trainingId: result.trainings[h], childrenJobId: result.children[h], duelId: duel.id, won });
    result[h] = { champion: d.champion, generation: d.generation, promoted: result.promoted[h] };
  }
  writeThrone(t);
  emit('A', 'duel', { duelId: duel.id, a, b, winner: duel.winner, tie: duel.tie, aName: nameOf(a), bName: nameOf(b), winnerName: nameOf(duel.winner) });
  progress(); progress();
  emit(duel.winner === t.dynasties.A.champion ? 'A' : duel.winner === t.dynasties.B.champion ? 'B' : 'A', 'generation', { A: result.A, B: result.B, duelId: duel.id, tie: duel.tie });
  return result;
}
