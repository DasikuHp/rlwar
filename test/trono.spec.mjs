// F6 — Trono, duelos, liga, genealogía, dinastías (spec/06 §1–§6): plan del duelo y semillas, ranking, modos de
// aprendizaje, reto al trono (sentar, ganar, perder, empate, auto-reto), liga (pickOpponent, f_hard, fantasma),
// genealogía (sha, edited, orphan) y una generación de dinastías sin pantalla. Escrito ANTES del código y congelado.
// Corregido con OK del usuario (2026-09-23) en 5 aserciones defectuosas del propio test: referencia de hash32 fuera del
// rango de makeRng, un killDiff mal sumado (−2, no −1), una edición de estructura inválida (units sin pesos), un montaje
// de liga con derrotas dentro de la ventana y una comprobación de huérfanos que incluía la huérfana del test anterior.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-trono-'));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const clone = (v) => JSON.parse(JSON.stringify(v));
const norm2 = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const { makeRng, hash32 } = await import('../shared/rng.js');
const { validate } = await import('../shared/genome.js');
const { compile } = await import('../shared/nn.js');
const { TEMPLATES } = await import('../shared/templates.js');
const store = await import('../evo/store.js');
const D = await import('../evo/duel.js');
const TH = await import('../evo/throne.js');
const { makeLearner } = await import('../evo/train.js');
const save = (key, id, patch = {}) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), ...patch, id, name: id }); assert.ok(r.ok, JSON.stringify(r)); return id; };
const flatOf = (id) => Array.from(compile(store.loadNet(id)).getFlat());

await check('hash32: fórmula exacta (mulberry32 de seed ^ imul(k+1, 0x9E3779B1)), entero en [0, 2³¹), determinista', () => {
  for (const [seed, k] of [[0, 0], [4242, 0], [4242, 1], [4242, 100], [7, 3]]) {
    const ref = Math.floor(makeRng((seed ^ Math.imul(k + 1, 0x9E3779B1)) & 0x7fffffff)() * 2 ** 31);
    assert.equal(hash32(seed, k), ref, `seed ${seed} k ${k}`);
    assert.ok(Number.isInteger(ref) && ref >= 0 && ref < 2 ** 31);
  }
  assert.notEqual(hash32(4242, 0), hash32(4242, 1)); assert.notEqual(hash32(4242, 0), hash32(4243, 0));
});

await check('duelPlan: 6 partidas = 3 mapas × 2 lados; misma semilla y soldados en las dos partidas de cada mapa; lados alternos; determinista', () => {
  const rows = D.duelPlan({ a: 'hydra-7', b: 'orca-2', seed: 4242, soldiers: 'random' });
  assert.equal(rows.length, 6);
  rows.forEach((r, k) => {
    const m = Math.floor(k / 2);
    assert.equal(r.k, k); assert.equal(r.seed, hash32(4242, m)); assert.equal(r.soldiers, 1 + (hash32(4242, 100 + m) % 4));
    assert.equal(r.left, k % 2 === 0 ? 'hydra-7' : 'orca-2'); assert.equal(r.right, k % 2 === 0 ? 'orca-2' : 'hydra-7');
  });
  assert.deepEqual(rows, D.duelPlan({ a: 'hydra-7', b: 'orca-2', seed: 4242, soldiers: 'random' }));
  assert.ok(D.duelPlan({ a: 'x', b: 'y', seed: 1 }).every((r) => r.soldiers >= 1 && r.soldiers <= 4));
  assert.ok(D.duelPlan({ a: 'x', b: 'y', seed: 1, soldiers: 3 }).every((r) => r.soldiers === 3));
  const other = D.duelPlan({ a: 'hydra-7', b: 'orca-2', seed: 4243, soldiers: 'random' });
  assert.notDeepEqual(rows.map((r) => r.seed), other.map((r) => r.seed));
});

await check('duelScore: más victorias; empate → diferencia de kills; empate total → tie y winner null; con throne gana la reina', () => {
  const g = (winner, ka, kb) => ({ winner, kills: { a: ka, b: kb } });
  assert.deepEqual(D.duelScore([g('a', 2, 0), g('a', 1, 1), g('b', 0, 2), g('a', 2, 1), g(null, 1, 1), g('b', 0, 1)], 'a', 'b'), { wins: { a: 3, b: 2 }, killDiff: 0, winner: 'a', tie: false });
  assert.deepEqual(D.duelScore([g('a', 2, 0), g('b', 0, 2), g('a', 1, 0), g('b', 0, 3), g(null, 0, 0), g(null, 1, 1)], 'a', 'b'), { wins: { a: 2, b: 2 }, killDiff: -2, winner: 'b', tie: false });
  assert.deepEqual(D.duelScore([g('a', 2, 0), g('b', 0, 2), g(null, 1, 1), g(null, 1, 1), g(null, 0, 0), g(null, 0, 0)], 'a', 'b'), { wins: { a: 1, b: 1 }, killDiff: 0, winner: null, tie: true });
  assert.deepEqual(D.duelScore([g('a', 2, 0), g('b', 0, 2)], 'a', 'b', { throne: true, queen: 'b' }), { wins: { a: 1, b: 1 }, killDiff: 0, winner: 'b', tie: true });
  assert.deepEqual(D.duelScore([], 'a', 'b'), { wins: { a: 0, b: 0 }, killDiff: 0, winner: null, tie: true });
});

// juego y aprendiz inyectados: el plan manda; se registra cada llamada
function fakePlay(table) {
  const calls = [];
  const play = async (row) => {
    calls.push({ k: row.k, seed: row.seed, left: row.left, right: row.right, soldiers: row.soldiers });
    const t = table[row.k];
    return { winner: t.winner, kills: t.kills, events: [{ type: 'game.start' }], trajectories: { pl: { netId: row.left, soldiers: {} }, pr: { netId: row.right, soldiers: {} } }, playerIds: { [row.left]: 'pl', [row.right]: 'pr' }, gameId: `g-${row.k}`, roomCode: null };
  };
  return { play, calls };
}
function fakeLearner() {
  const log = [];
  const learner = (netId) => ({
    learn: (games, opts = {}) => { log.push({ netId, kind: 'learn', n: games.length, lrScale: opts.lrScale ?? 1, mine: games.every((g) => g.trajectory && g.trajectory.netId === netId) }); },
    review: (games) => { log.push({ netId, kind: 'review', n: games.length, mine: games.every((g) => g.trajectory && g.trajectory.netId === netId) }); },
    save: () => { log.push({ netId, kind: 'save' }); },
  });
  return { learner, log };
}
const TABLE = [{ winner: 'x', kills: { x: 2, y: 1 } }, { winner: 'y', kills: { x: 0, y: 2 } }, { winner: 'x', kills: { x: 1, y: 0 } }, { winner: 'x', kills: { x: 2, y: 2 } }, { winner: null, kills: { x: 1, y: 1 } }, { winner: 'y', kills: { x: 1, y: 3 } }];

await check('runDuel (inyectado): sigue el plan, puntúa, guarda filas con gameId; frozen = solo repaso de 6; hot = 6 lotes de 1; mix = 6 × lr/4 + repaso', async () => {
  for (const [learning, expect] of [['frozen', { learns: 0, reviews: 1 }], ['hot', { learns: 6, reviews: 0 }], ['mix', { learns: 6, reviews: 1 }]]) {
    const { play, calls } = fakePlay(TABLE); const { learner, log } = fakeLearner();
    const rec = await D.runDuel({ id: `d-${learning}`, a: 'x', b: 'y', learning, speed: 'turbo', soldiers: 2, seed: 9, play, learner, saveGames: false });
    assert.equal(rec.status, 'done'); assert.equal(rec.games.length, 6); assert.equal(calls.length, 6);
    assert.deepEqual(calls.map((c) => [c.left, c.right]), [['x', 'y'], ['y', 'x'], ['x', 'y'], ['y', 'x'], ['x', 'y'], ['y', 'x']]);
    assert.deepEqual(calls.map((c) => c.seed), D.duelPlan({ a: 'x', b: 'y', seed: 9, soldiers: 2 }).map((r) => r.seed));
    assert.ok(rec.games.every((g, k) => g.k === k && g.gameId === `g-${k}` && g.roomCode === null && g.winner === TABLE[k].winner && g.kills.x === TABLE[k].kills.x));
    assert.deepEqual({ wins: rec.wins, killDiff: rec.killDiff, winner: rec.winner, tie: rec.tie }, { wins: { x: 3, y: 2 }, killDiff: -2, winner: 'x', tie: false });
    assert.ok(typeof rec.ms === 'number' && rec.ms >= 0 && rec.a === 'x' && rec.b === 'y' && rec.learning === learning);
    for (const id of ['x', 'y']) {
      const mine = log.filter((l) => l.netId === id);
      assert.equal(mine.filter((l) => l.kind === 'learn').length, expect.learns, `${learning}/${id} learns`);
      assert.equal(mine.filter((l) => l.kind === 'review').length, expect.reviews, `${learning}/${id} reviews`);
      assert.ok(mine.every((l) => l.kind === 'save' || l.mine), 'cada red aprende solo de su trayectoria');
      if (expect.learns) assert.ok(mine.filter((l) => l.kind === 'learn').every((l) => l.n === 1 && near(l.lrScale, learning === 'mix' ? 0.25 : 1)));
      if (expect.reviews) assert.ok(mine.filter((l) => l.kind === 'review').every((l) => l.n === 6));
      assert.ok(mine.filter((l) => l.kind === 'save').length >= 1, 'guarda al menos una vez');
    }
  }
  const { play } = fakePlay(TABLE); const { learner, log } = fakeLearner();
  await D.runDuel({ a: 'x', b: 'x', learning: 'hot', speed: 'turbo', soldiers: 1, seed: 1, play, learner, saveGames: false });
  assert.equal(log.length, 0, 'contra sí misma no aprende');
  let stops = 0;
  const rec = await D.runDuel({ a: 'x', b: 'y', learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 1, play: fakePlay(TABLE).play, learner: fakeLearner().learner, saveGames: false, shouldStop: () => ++stops > 2 });
  assert.equal(rec.status, 'stopped'); assert.equal(rec.games.length, 2); assert.deepEqual(rec.wins, { x: 1, y: 1 });
});

await check('modos de aprendizaje con redes reales (turbo): frozen no cambia hasta el repaso; hot cambia tras la 1ª; mix cambia menos que hot tras la 1ª y más tras el repaso', async () => {
  const first = {}, final = {}, init = {};
  for (const learning of ['frozen', 'hot', 'mix']) {
    const a = save('sniper', `la-${learning}`), b = save('turtle', `lb-${learning}`);
    init[learning] = flatOf(a);
    await D.runDuel({ a, b, learning, speed: 'turbo', soldiers: 1, seed: 3, saveGames: false, onGame: (k) => { if (k === 0) first[learning] = flatOf(a); } });
    final[learning] = flatOf(a);
  }
  const d1 = Object.fromEntries(['frozen', 'hot', 'mix'].map((m) => [m, norm2(first[m], init[m])]));
  const dF = Object.fromEntries(['frozen', 'hot', 'mix'].map((m) => [m, norm2(final[m], init[m])]));
  assert.equal(d1.frozen, 0, 'frozen: sin cambios tras la 1ª'); assert.ok(dF.frozen > 0, 'frozen: cambia tras el repaso');
  assert.ok(d1.hot > 0, 'hot: cambia tras la 1ª');
  assert.ok(d1.mix > 0 && d1.mix < d1.hot, `mix (${d1.mix}) cambia menos que hot (${d1.hot}) tras la 1ª`);
  assert.ok(dF.mix > d1.mix, 'mix: más tras el repaso');
});

await check('makeLearner: aprende de partidas propias con lrScale y guarda red + optim.json', async () => {
  const id = save('seer', 'learner-1');
  const L = makeLearner(store.loadNet(id));
  const { playGame } = await import('../server/headless.js');
  const r = playGame({ seed: 5, left: { type: 'net', netId: id, learn: true }, right: { type: 'sniper' }, soldiers: 1 });
  const p = r.room.players.find((x) => x.agentType === 'net');
  const before = Array.from(L.net.getFlat());
  const res = L.learn([{ events: r.events, trajectory: r.trajectories[p.id], playerId: p.id }], { lrScale: 0.5 });
  assert.ok(res && res.update && res.rewards.steps > 0);
  assert.ok(norm2(Array.from(L.net.getFlat()), before) > 0);
  L.save();
  assert.ok(norm2(flatOf(id), before) > 0, 'guardado'); assert.ok(existsSync(join(store.netsDir(), id, 'optim.json')));
});

await check('trono: sin reina sienta a la retadora; reto ganado → reign.end/start y copia en la sala de la fama con sha; perdido/empate → defenses++; auto-reto → 400; inexistente → 404', async () => {
  const q = save('sniper', 'reina-1'), c = save('turtle', 'retadora-1');
  const events = [];
  const opts = { onEvent: (e) => events.push(e), now: () => 1000 };
  let r = await TH.challenge({ challenger: q }, opts);
  assert.equal(r.result, 'seated'); assert.equal(r.queen, q);
  let t = TH.readThroneFull();
  assert.equal(t.queen, q); assert.equal(t.since, 1000); assert.deepEqual(t.reigns, [{ netId: q, from: 1000, to: null, defenses: 0, won: 0, lost: 0 }]);
  assert.ok(events.some((e) => e.type === 'reign.start' && e.netId === q));
  await assert.rejects(() => TH.challenge({ challenger: q }, opts), (e) => e.status === 400);
  await assert.rejects(() => TH.challenge({ challenger: 'nadie' }, opts), (e) => e.status === 404);
  const fixed = (winner, tie = false) => async (o) => ({ id: 'd-fake', a: o.a, b: o.b, status: 'done', games: [], wins: { [o.a]: winner === o.a ? 4 : 2, [o.b]: winner === o.b ? 4 : 2 }, killDiff: 0, winner, tie, throne: o.throne, ms: 1 });
  r = await TH.challenge({ challenger: c }, { ...opts, runDuel: fixed(q) });
  assert.equal(r.result, 'queen'); t = TH.readThroneFull();
  assert.equal(t.queen, q); assert.equal(t.reigns[0].defenses, 1); assert.equal(t.reigns[0].won, 1); assert.equal(t.challenges.length, 1);
  assert.deepEqual({ ...t.challenges[0], ts: 0 }, { id: 'c1', challenger: c, queen: q, duelId: 'd-fake', result: 'queen', ts: 0 });
  r = await TH.challenge({ challenger: c }, { ...opts, runDuel: fixed(q, true) });
  assert.equal(r.result, 'tie'); t = TH.readThroneFull(); assert.equal(t.reigns[0].defenses, 2); assert.equal(t.queen, q);
  r = await TH.challenge({ challenger: c }, { ...opts, runDuel: fixed(c), now: () => 2000 });
  assert.equal(r.result, 'challenger'); t = TH.readThroneFull();
  assert.equal(t.queen, c); assert.equal(t.since, 2000); assert.equal(t.reigns.length, 2);
  assert.equal(t.reigns[0].to, 2000); assert.equal(t.reigns[0].lost, 1); assert.deepEqual(t.reigns[1], { netId: c, from: 2000, to: null, defenses: 0, won: 0, lost: 0 });
  assert.equal(t.hallOfFame.length, 1);
  const h = t.hallOfFame[0];
  // la ruta de la copia es relativa a la carpeta de datos (B3, spec/06 §2; cambio autorizado 2026-09-23)
  const snapFile = join(process.env.GW_EVO_DIR, h.snapshot);
  assert.equal(h.netId, q); assert.equal(h.reignIdx, 0); assert.ok(existsSync(snapFile), `copia ${h.snapshot}`);
  const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
  assert.ok(validate(snap).ok && snap.id === q); assert.equal(h.sha, TH.structureSha(snap)); assert.ok(typeof h.reignGames === 'number');
  assert.ok(events.some((e) => e.type === 'reign.end' && e.netId === q) && events.filter((e) => e.type === 'reign.start').length === 2);
  assert.equal(t.challenges.length, 3); assert.equal(t.challenges[2].result, 'challenger');
});

await check('liga: pares ordenados, last ≤ 20, winrate 0.5 sin datos; pickOpponent respeta los pesos (10 000 sorteos ± 2 %), f_hard, fantasma solo con derrota reciente', () => {
  const t = TH.emptyThrone();
  for (let i = 0; i < 25; i++) TH.updateLeague(t, 'zeta', 'alfa', i >= 5); // zeta pierde las 5 primeras y gana las 20 últimas
  const pair = t.league.pairs['alfa|zeta'];
  assert.ok(pair && pair.wins === 5 && pair.losses === 20 && pair.last.length === 20, JSON.stringify(pair));
  assert.ok(near(TH.winrate(t, 'zeta', 'alfa'), 0.8) && near(TH.winrate(t, 'alfa', 'zeta'), 0.2) && TH.winrate(t, 'alfa', 'nadie') === 0.5);
  const hall = [{ netId: 'alfa', kind: 'hallOfFame', snapshot: 'x' }, { netId: 'beta', kind: 'hallOfFame', snapshot: 'y' }];
  const mix = { antagonist: 0.6, hallOfFame: 0.25, self: 0.15, ghost: 0, hard: 2, antagonistId: 'rival' };
  const rng = makeRng(11); const count = {}; const hallPick = {};
  for (let i = 0; i < 10000; i++) { const o = TH.pickOpponent('zeta', mix, rng, { throne: t, hall }); count[o.kind] = (count[o.kind] || 0) + 1; if (o.kind === 'hallOfFame') hallPick[o.netId] = (hallPick[o.netId] || 0) + 1; }
  assert.ok(Math.abs(count.antagonist / 10000 - 0.6) < 0.02 && Math.abs(count.hallOfFame / 10000 - 0.25) < 0.02 && Math.abs(count.self / 10000 - 0.15) < 0.02, JSON.stringify(count));
  const fa = (1 - 0.8) ** 2, fb = (1 - 0.5) ** 2;
  assert.ok(Math.abs(hallPick.alfa / count.hallOfFame - fa / (fa + fb)) < 0.03, `f_hard: alfa ${hallPick.alfa}/${count.hallOfFame} esperado ${(fa / (fa + fb)).toFixed(3)}`);
  assert.ok(!count.ghost);
  const gmix = { ...mix, ghost: 0.5 };
  let ghosts = 0; for (let i = 0; i < 2000; i++) if (TH.pickOpponent('zeta', gmix, rng, { throne: t, hall }).kind === 'ghost') ghosts++;
  assert.equal(ghosts, 0, 'zeta no ha perdido recientemente contra ninguna ex-reina');
  for (let i = 0; i < 3; i++) TH.updateLeague(t, 'zeta', 'beta', false);
  ghosts = 0; let ghostIds = new Set(); for (let i = 0; i < 2000; i++) { const o = TH.pickOpponent('zeta', gmix, rng, { throne: t, hall }); if (o.kind === 'ghost') { ghosts++; ghostIds.add(o.netId); } }
  assert.ok(Math.abs(ghosts / 2000 - 0.5) < 0.04 && ghostIds.size === 1 && ghostIds.has('beta'), `fantasmas ${ghosts} ${[...ghostIds]}`);
  const noAnt = TH.pickOpponent('zeta', { antagonist: 1, hallOfFame: 0, self: 0, ghost: 0 }, makeRng(1), { throne: t, hall });
  assert.equal(noAnt.kind, 'self', 'sin antagonista ni reina → sí misma');
  t.queen = 'alfa';
  assert.deepEqual(TH.pickOpponent('zeta', { antagonist: 1, hallOfFame: 0, self: 0, ghost: 0 }, makeRng(1), { throne: t, hall }), { kind: 'antagonist', netId: 'alfa' }, 'sin antagonista pero con reina → la reina');
  assert.equal(TH.pickOpponent('alfa', { antagonist: 1, hallOfFame: 0, self: 0, ghost: 0 }, makeRng(1), { throne: t, hall }).kind, 'self', 'la reina no se enfrenta a sí misma');
});

await check('genealogía: registerBirth guarda sha de la estructura; aprender no edita; cambiar la estructura sí; padres desconocidos → orphan', () => {
  const p = save('sniper', 'gen-madre');
  const child = { ...clone(TEMPLATES.sniper.genome), id: 'gen-hija', name: 'gen-hija', lineage: { generation: 1, parents: [p], born: '2026-09-22T00:00:00.000Z', mutations: [] } };
  assert.ok(store.saveNet(child).ok);
  TH.registerBirth(store.loadNet(p)); TH.registerBirth(store.loadNet('gen-hija'));
  let v = TH.genealogyView();
  assert.deepEqual(v.nets['gen-hija'].parents, [p]); assert.equal(v.nets['gen-hija'].generation, 1); assert.equal(v.nets['gen-hija'].edited, false); assert.equal(v.nets['gen-hija'].orphan, false);
  assert.equal(v.nets['gen-hija'].sha, TH.structureSha(store.loadNet('gen-hija'))); assert.equal(v.nets['gen-hija'].sha.length, 64);
  const g = store.loadNet('gen-hija'); g.weights.d.W = g.weights.d.W.map((x) => x + 0.01); store.saveNet(g);
  assert.equal(TH.genealogyView().nets['gen-hija'].edited, false, 'cambiar pesos (aprender) no es editar');
  g.blocks.find((b) => b.id === 'd').params.activation = 'relu'; assert.ok(store.saveNet(g).ok);
  assert.equal(TH.genealogyView().nets['gen-hija'].edited, true, 'cambiar la estructura sí');
  const orphan = { ...clone(TEMPLATES.empty.genome), id: 'gen-huerfana', name: 'h', lineage: { generation: 1, parents: ['nadie-1'], born: null, mutations: [] } };
  store.saveNet(orphan); TH.registerBirth(store.loadNet('gen-huerfana'));
  assert.equal(TH.genealogyView().nets['gen-huerfana'].orphan, true);
});

await check('dinastías: fundar (400 misma red, 404 inexistente) y una generación completa sin pantalla (semilla fija) termina, actualiza history y generation, sin huérfanos', async () => {
  const a = save('sniper', 'casa-a'), b = save('turtle', 'casa-b');
  assert.throws(() => TH.foundDynasties({ A: { name: 'Casa A', netId: a }, B: { name: 'Casa B', netId: a } }), (e) => e.status === 400);
  assert.throws(() => TH.foundDynasties({ A: { name: 'Casa A', netId: 'nadie' }, B: { name: 'Casa B', netId: b } }), (e) => e.status === 404);
  const d = TH.foundDynasties({ A: { name: 'Casa A', netId: a }, B: { name: 'Casa B', netId: b } });
  assert.deepEqual(d.A, { name: 'Casa A', champion: a, generation: 0, founder: a, history: [] });
  assert.deepEqual(d.B, { name: 'Casa B', champion: b, generation: 0, founder: b, history: [] });
  const events = [];
  const res = await TH.runGeneration({ training: { speed: 'turbo', duration: { games: 2 }, soldiers: 1 }, children: { n: 2, pretournament: { games: 1, soldiers: 1 } }, duel: { learning: 'frozen', speed: 'turbo', soldiers: 1 }, seed: 12 }, { onEvent: (e) => events.push(e) });
  const t = TH.readThroneFull();
  for (const h of ['A', 'B']) {
    assert.equal(t.dynasties[h].history.length, 1, `history de ${h}`);
    const H = t.dynasties[h].history[0];
    assert.ok(H.trainingId && H.childrenJobId && H.duelId && typeof H.won === 'boolean' && H.champion === t.dynasties[h].champion, JSON.stringify(H));
    assert.ok(store.loadNet(t.dynasties[h].champion), 'la campeona existe');
  }
  const gens = [t.dynasties.A.generation, t.dynasties.B.generation];
  assert.ok((gens[0] === 1 && gens[1] === 0) || (gens[0] === 0 && gens[1] === 1) || (res.tie && gens[0] === 0 && gens[1] === 0), JSON.stringify(gens));
  assert.ok(res.duelId && res.children.A && res.children.B && typeof res.promoted.A === 'boolean');
  const kinds = new Set(events.filter((e) => e.type === 'dynasty').map((e) => e.event));
  for (const k of ['train', 'children', 'duel', 'generation']) assert.ok(kinds.has(k), `evento dynasty ${k}`);
  const v = TH.genealogyView();
  assert.ok(Object.entries(v.nets).filter(([id]) => id.startsWith('casa-')).every(([, n]) => !n.orphan), 'sin huérfanos entre las casas y sus hijos');
  assert.ok(Object.keys(v.nets).some((id) => id.startsWith('casa-a-1') || id.startsWith('casa-b-1')), 'los hijos están en la genealogía');
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\ntrono OK');
