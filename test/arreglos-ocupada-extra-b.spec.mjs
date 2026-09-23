// Huecos de mutantes de la revisión de Fable y de los arreglos de Opus (spec/mutantes.md, "Revisión de Fable" y
// "R2–R5"): el 409 de una red ocupada en las rutas que no lo probaban (pedir hijos, operar ×3, examinar, criar,
// reto de dinastía, la reina entrenando), el nombre de la red en el mensaje y la rival de las copias en una
// exhibición (una persona, una red sentada con addagent, un agente). Congelado.
// Uso: node test/arreglos-ocupada-extra-b.spec.mjs [http://localhost:8791]   (sin URL, solo las partes en proceso)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ocupada-b-'));

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const { playGame } = await import('../server/headless.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const busy = await import('../evo/busy.js');
const lab = await import('../evo/api.js');

const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const untilLocal = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); } throw new Error(`tiempo agotado: ${what}`); };

// ---------- la rival de las copias en una exhibición (spec/04 §10.3, §10.5): oráculo exacto del paso ----------
// red de evolución pequeña: 2 copias, 2 partidas por copia (en la segunda la copia juega a la derecha: ahí se nota si la rival
// llevara learn:true, porque la fitness se mediría sobre ella)
const mkEvo = (id) => { const t = clone(TEMPLATES.seer.genome); const r = store.saveNet({ ...t, id, name: `Red ${id}`, learning: { ...t.learning, method: 'evolution', evolution: { ...t.learning.evolution, population: 2, gamesPerCandidate: 2 } } }); assert.ok(r.ok, JSON.stringify(r)); };
// lo que hace onExhibitionOver con esa red, a mano, con la rival que dice la spec → pesos esperados
const oracle = async (before, room, netId, rivalSpec) => {
  const L = T.makeLearner(clone(before));
  const players = room.players.filter((p) => p.agentType === 'net' && p.netId === netId);
  L.learn(players.map((p) => ({ events: room.events, trajectory: { netId, soldiers: room.agents[p.id].trajectories }, playerId: p.id })));
  const out = await L.evolve({ rival: rivalSpec, seed: room.seed, soldiers: room.soldiersPerPlayer });
  // también la fitness: con dos copias y rankNormalize solo cuenta su orden, y el orden puede salir igual
  return { weights: clone(L.genome.weights), meanFitness: out.update.meanFitness, bestFitness: out.update.bestFitness };
};
const sameStep = (up, netId, want, what) => {
  assert.deepEqual(clone(store.loadNet(netId).weights), want.weights, `pesos: ${what}`);
  assert.deepEqual([up.meanFitness, up.bestFitness], [want.meanFitness, want.bestFitness], `fitness: ${what}`);
};
const stepOf = async (netId, what) => {
  const up = await untilLocal(() => logOf().find((e) => e.type === 'update' && e.netId === netId && e.kind === 'evolution'), 60000, what);
  await untilLocal(() => busy.heldBy(netId) === null, 20000, `${netId} libre`);
  return up;
};

await check('exhibición contra una persona: las copias juegan contra la propia red tal como acabó la partida, con learn:false (rival "self"; pesos del oráculo)', async () => {
  mkEvo('xb-h');
  const g = playGame({ seed: 43, left: { type: 'net', netId: 'xb-h', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  const seat = g.room.players.find((p) => p.team === 'right');
  Object.assign(seat, { isBot: false, agentType: null, netId: null, genome: null, name: 'Hugo' }); // se sentó con join
  const before = store.loadNet('xb-h');
  const want = await oracle(before, g.room, 'xb-h', { type: 'net', genome: clone(before), name: before.name, learn: false });
  lab.onExhibitionOver(g.room);
  const up = await stepOf('xb-h', 'paso contra la persona');
  assert.equal(up.rival, 'self');
  sameStep(up, 'xb-h', want, 'contra la propia red con learn:false');
});

await check('exhibición contra una red sentada con addagent: las copias juegan contra su genoma con learn:false (rival = su netId; pesos del oráculo)', async () => {
  mkEvo('xb-n'); mkEvo('xb-r');
  const g = playGame({ seed: 44, left: { type: 'net', netId: 'xb-n', learn: true }, right: { type: 'net', netId: 'xb-r' }, soldiers: 1 });
  const seat = g.room.players.find((p) => p.team === 'right');
  assert.ok(seat.genome, 'la red sentada lleva su genoma');
  const before = store.loadNet('xb-n');
  const want = await oracle(before, g.room, 'xb-n', { type: 'net', genome: seat.genome, name: seat.name, learn: false });
  lab.onExhibitionOver(g.room);
  const up = await stepOf('xb-n', 'paso contra la red sentada');
  assert.equal(up.rival, 'xb-r');
  sameStep(up, 'xb-n', want, 'contra la red sentada');
});

await check('exhibición contra un agente: las copias juegan contra su tipo, su nivel y su temperatura (rival = su tipo; pesos y fitness del oráculo), también con temperatura 0', async () => {
  for (const [id, seed, type, level, temperature] of [['xb-a', 45, 'greedy', 1, 1], ['xb-a0', 50, 'sniper', 2, 0]]) {
    mkEvo(id);
    const g = playGame({ seed, left: { type: 'net', netId: id, learn: true }, right: { type, level, temperature }, soldiers: 1 });
    const seat = g.room.players.find((p) => p.team === 'right');
    assert.deepEqual([seat.level, seat.temperature], [level, temperature]);
    const before = store.loadNet(id);
    const want = await oracle(before, g.room, id, { type, level, temperature });
    lab.onExhibitionOver(g.room);
    const up = await stepOf(id, `paso contra ${type}`);
    assert.equal(up.rival, type);
    sameStep(up, id, want, `contra ${type} nivel ${level}, temperatura ${temperature}`);
  }
});

// lo que queda guardado de la exhibición: lados, redes y ganador por su id (red), su tipo (agente) o su nombre (persona)
const savedMeta = (room) => store.listGames().find((m) => m.gameId === room.gameId);
const winnerId = (room, ids) => (room.result && room.result.winner ? ids[room.result.winner] : null);

await check('exhibición guardada: izquierda y derecha por su netId, su tipo o su nombre; el ganador igual; sin una red con netId no se guarda ni se aprende nada', async () => {
  mkEvo('xb-s');
  const g = playGame({ seed: 46, left: { type: 'greedy', level: 1 }, right: { type: 'net', netId: 'xb-s', learn: true }, soldiers: 1 });
  const seat = g.room.players.find((p) => p.team === 'left');
  Object.assign(seat, { isBot: false, agentType: null, netId: null, genome: null, name: 'Ana' });
  lab.onExhibitionOver(g.room);
  await stepOf('xb-s', 'paso de la exhibición guardada');
  const m = savedMeta(g.room);
  assert.ok(m, 'la exhibición se guarda');
  assert.deepEqual([m.kind, m.left, m.right, m.nets, m.winner], ['exhibition', 'Ana', 'xb-s', ['xb-s'], winnerId(g.room, { left: 'Ana', right: 'xb-s' })]);
  const a = savedMeta((await (async () => { const r = playGame({ seed: 47, left: { type: 'net', netId: 'xb-s' }, right: { type: 'greedy', level: 1 }, soldiers: 1 }); lab.onExhibitionOver(r.room); return r; })()).room);
  assert.deepEqual([a.left, a.right], ['xb-s', 'greedy']);
  const games0 = store.listGames().length, log0 = logOf().length;
  const none = playGame({ seed: 48, left: { type: 'greedy', level: 1 }, right: { type: 'greedy', level: 2 }, soldiers: 1 });
  lab.onExhibitionOver(none.room);
  const inline = playGame({ seed: 49, left: { type: 'net', netId: 'xb-s', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  inline.room.players.find((p) => p.agentType === 'net').netId = null; // una red sin id (genoma en línea): no se puede guardar
  lab.onExhibitionOver(inline.room);
  await sleep(200);
  assert.equal(store.listGames().length, games0, 'sin red con netId no se guarda ninguna partida');
  assert.equal(logOf().length, log0, 'ni se registra nada');
});

// ---------- trono (spec/06 §7.1) ----------
const TH = await import('../evo/throne.js');
const saveT = (id) => { const t = clone(TEMPLATES.seer.genome); const r = store.saveNet({ ...t, id, name: `Red ${id}` }); assert.ok(r.ok, JSON.stringify(r)); };

await check('reto con la reina borrada del disco: la retadora se sienta sin duelo, el reinado anterior acaba "missing" y el nuevo empieza a cero', async () => {
  TH.writeThrone(TH.emptyThrone()); saveT('tr-q'); saveT('tr-c');
  assert.equal((await TH.challenge({ challenger: 'tr-q' }, { now: () => 1000 })).result, 'seated');
  store.deleteNet('tr-q'); // fuera de la API: nadie llamó a vacateNet
  assert.deepEqual(await TH.challenge({ challenger: 'tr-c' }, { now: () => 2000 }), { result: 'seated', queen: 'tr-c' });
  assert.deepEqual(TH.readThroneFull().reigns, [{ netId: 'tr-q', from: 1000, to: 2000, defenses: 0, won: 0, lost: 0, ended: 'missing' }, { netId: 'tr-c', from: 2000, to: null, defenses: 0, won: 0, lost: 0 }]);
});

await check('reto: un duelo parado que ya jugó partidas decide; uno que falla o no jugó nada lo anula con su motivo', async () => {
  TH.writeThrone(TH.emptyThrone()); saveT('tr-q2'); saveT('tr-c2');
  await TH.challenge({ challenger: 'tr-q2' }, { now: () => 1000 });
  const fake = (rec) => async (o) => ({ id: 'd-x', a: o.a, b: o.b, games: [], wins: {}, killDiff: 0, winner: null, tie: false, throne: true, ms: 1, ...rec });
  assert.equal((await TH.challenge({ challenger: 'tr-c2' }, { runDuel: fake({ status: 'stopped', games: [{ winner: 'tr-q2' }], winner: 'tr-q2' }), now: () => 2000 })).result, 'queen');
  assert.equal((await TH.challenge({ challenger: 'tr-c2' }, { runDuel: fake({ status: 'error', error: 'se cayó el duelo' }), now: () => 3000 })).result, 'void');
  assert.equal((await TH.challenge({ challenger: 'tr-c2' }, { runDuel: fake({ status: 'stopped', games: [] }), now: () => 4000 })).result, 'void');
  assert.deepEqual(TH.readThroneFull().challenges.map((c) => [c.result, c.error ?? null]), [['queen', null], ['void', 'se cayó el duelo'], ['void', 'el duelo no jugó ninguna partida']]);
});

await check('vacateNet: la campeona borrada deja su casa sin campeona y solo avisa de la casa ({queen:false, houses:[A]}); una red que no es nada no toca el trono ni el registro', () => {
  TH.writeThrone(TH.emptyThrone()); saveT('tr-va'); saveT('tr-vb');
  TH.foundDynasties({ A: { name: 'Norte', netId: 'tr-va' }, B: { name: 'Sur', netId: 'tr-vb' } });
  const evs = [], log0 = logOf().length;
  assert.deepEqual(TH.vacateNet('tr-va', { onEvent: (e) => evs.push(e) }), { queen: false, houses: ['A'] });
  assert.deepEqual(evs.map((e) => [e.type, e.event ?? null, e.house ?? null, e.netId]), [['dynasty', 'champion.deleted', 'A', 'tr-va']]);
  assert.equal(TH.readThroneFull().dynasties.A.champion, null);
  assert.deepEqual(TH.vacateNet('nadie', { onEvent: (e) => evs.push(e) }), { queen: false, houses: [] });
  assert.equal(evs.length, 1); assert.equal(logOf().length, log0 + 1);
});

await check('runGeneration con una casa sin campeona → 400 que nombra esa casa (A o B)', async () => {
  TH.writeThrone(TH.emptyThrone());
  TH.foundDynasties({ A: { name: 'Norte', netId: 'tr-va' }, B: { name: 'Sur', netId: 'tr-vb' } });
  for (const [h, other] of [['B', 'A'], ['A', 'B']]) {
    const t = TH.readThroneFull(); t.dynasties[h].champion = null; t.dynasties[other].champion = other === 'A' ? 'tr-va' : 'tr-vb'; TH.writeThrone(t);
    await assert.rejects(TH.runGeneration({}), (e) => e.status === 400 && e.message.startsWith(`La casa ${h} no tiene campeona`), `sin campeona en ${h}`);
  }
});

// ---------- boletín (spec/07 §13.1) ----------
const exam = await import('../evo/exam.js');
await check('boletín: una partida de adaptación es victoria solo si gana el lado del examinado (oráculo de las 16 partidas); avisa escena a escena ("adaptation", i, 16); adaptationScore({}) = 0', async () => {
  const me = { type: 'sniper', level: 2, temperature: 0 }, rival = { type: 'greedy', level: 3, temperature: 0 };
  const scenes = [];
  const r = await exam.runBulletin(me, { onScene: (...a) => scenes.push(a) });
  assert.equal(scenes.length, 96);
  assert.deepEqual(scenes.filter((s) => s[0] === 'adaptation'), Array.from({ length: 16 }, (_, i) => ['adaptation', i, 16]));
  const want = Array.from({ length: 16 }, (_, i) => {
    const seed = exam.EXAM_SEEDS.adaptation + i, soldiers = 1 + Math.floor(i / 4), side = i % 2 === 0 ? 'left' : 'right';
    const g = playGame({ seed, left: side === 'left' ? me : rival, right: side === 'left' ? rival : me, soldiers });
    return { seed, soldiers, side, win: g.result && g.result.winner === side ? 1 : 0 };
  });
  assert.deepEqual(r.details.adaptationGames, want);
  assert.ok(want.some((w) => w.win) && want.some((w) => !w.win), `premisa: hay victorias y derrotas (${want.map((w) => w.win).join('')})`);
  for (const n of [1, 2, 3, 4]) assert.equal(r.details.adaptation[n], want.filter((w) => w.soldiers === n).reduce((s, w) => s + w.win, 0) / 4);
  assert.equal(exam.adaptationScore({}), 0);
});

// ---------- bofetada y caricia (spec/04 §10.4) ----------
const { compile } = await import('../shared/nn.js');
const { normalize } = await import('../shared/genome.js');
saveT('sl-net');
const slGame = (() => {
  const r = playGame({ seed: 52, left: { type: 'net', netId: 'sl-net', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  const p = r.room.players.find((x) => x.learn);
  return { meta: { gameId: r.room.gameId }, events: r.events, trajectories: { [p.id]: r.trajectories[p.id] } };
})();
const slSteps = Object.values(Object.values(slGame.trajectories)[0].soldiers)[0];
const NOTRAJ = 'Esta partida no guarda lo que vio la red en esa decisión (su trayectoria), así que no se le puede enseñar nada con ella.';

await check('feedbackTarget: sin trayectoria del jugador, sin soldados, sin pasos o sin esa decisión entre los pasos → 400 con el motivo', () => {
  const dec = slGame.events.find((e) => e.type === 'decision' && e.actor.netId === 'sl-net');
  const pid = dec.actor.playerId, sid = dec.actor.soldierId;
  for (const tr of [undefined, {}, { [pid]: { netId: 'sl-net' } }, { [pid]: { netId: 'sl-net', soldiers: {} } }, { [pid]: { netId: 'sl-net', soldiers: { [sid]: [{ decision: { eventId: -1 } }] } } }]) {
    assert.deepEqual(T.feedbackTarget({ ...slGame, trajectories: tr }, dec.id, 'sl-net'), { status: 400, error: NOTRAJ }, JSON.stringify(tr));
  }
});

await check('feedbackFromGame en una decisión que no es la primera: un paso de gradiente con Adam nuevo, ventaja = recompensa SOLO en esa decisión (pesos del oráculo)', () => {
  const k = slSteps.findIndex((s, i) => i >= 2 && s.decision && Number.isInteger(s.decision.eventId));
  assert.ok(k >= 2, 'premisa: hay una decisión con pasos antes');
  const g0 = store.loadNet('sl-net');
  const net = compile(clone(g0)), g = clone(g0);
  const out = T.feedbackFromGame({ net, genome: g, game: slGame, decisionEventId: slSteps[k].decision.eventId, reward: -2, kind: 'slap', eventId: 901 });
  assert.equal(out.ok, true);
  const net2 = compile(clone(g0)), lc = normalize(g0).learning.gradient;
  const ep = { steps: slSteps.slice(0, k + 1).map((s, i) => ({ obs: s.obs, phase: s.phase, chosen: s.decision.chosen, chosenMove: s.decision.chosenMove, adjustSample: s.decision.adjust ? s.decision.adjust.sample : null, moveAdjustSample: s.decision.moveAdjust ? s.decision.moveAdjust.sample : null, advantage: i === k ? -2 : 0 })) };
  const pg = T.policyGradient(net2, g0, [ep], { ...lc, entropy: 0, baseline: 'none' });
  T.applyUpdate(net2, pg.grads, T.adamInit(net2), { lr: lc.lr, clipNorm: lc.clipNorm, optimizer: lc.optimizer, frozen: g0.frozen });
  assert.deepEqual(clone(g.weights), clone(net2.serialize()));
});

await check('feedbackFromGame con todos los bloques congelados: no cambia nada (pesos iguales, pAfter = pBefore, relChange 0)', () => {
  const g0 = store.loadNet('sl-net');
  const g = { ...clone(g0), frozen: g0.blocks.map((b) => b.id) }, net = compile(g);
  const dec = slSteps.find((s) => s.decision && s.phase === 'shoot').decision;
  const out = T.feedbackFromGame({ net, genome: g, game: slGame, decisionEventId: dec.eventId, reward: -2, kind: 'slap', eventId: 902 });
  assert.deepEqual([out.ok, out.relChange, out.pAfter], [true, 0, out.pBefore]);
  assert.deepEqual(clone(g.weights), clone(g0.weights));
});

await check('feedbackFromGame guarda el recuerdo: ref al evento, rival (su tipo), bioma, familia del candidato elegido (null si se mueve o la decisión va recortada), vergüenza u orgullo con intensidad mín(1, |recompensa|), hace 0 partidas', () => {
  const start = slGame.events.find((e) => e.type === 'game.start');
  const shoot = slSteps.find((s) => s.decision && s.phase === 'shoot').decision, move = slSteps.find((s) => s.decision && s.phase === 'move').decision;
  const shootEv = slGame.events.find((e) => e.id === shoot.eventId);
  const run = (game, decisionEventId, reward, kind, eventId) => { const g = clone(store.loadNet('sl-net')); T.feedbackFromGame({ net: compile(g), genome: g, game, decisionEventId, reward, kind, eventId }); const e = g.memory.episodes[g.memory.episodes.length - 1]; return [e.ref, e.rivalId, e.biome, e.family, e.outcome, e.emotion, e.intensity, e.gamesAgo]; };
  assert.deepEqual(run(slGame, shoot.eventId, -2.5, 'slap', 903), [{ game: slGame.meta.gameId, id: 903 }, 'greedy', start.data.map.biome, shootEv.data.candidates[shootEv.data.chosen].family, 'slap', 'shame', 1, 0]);
  assert.deepEqual(run(slGame, move.eventId, 0.4, 'caress', 904), [{ game: slGame.meta.gameId, id: 904 }, 'greedy', start.data.map.biome, null, 'caress', 'pride', 0.4, 0]);
  const cut = { ...slGame, events: slGame.events.map((e) => (e.id === shoot.eventId ? { ...e, data: { phase: 'shoot', chosen: e.data.chosen, chosenMove: null, truncated: true } } : e)) };
  assert.equal(run(cut, shoot.eventId, -1, 'slap', 905)[3], null, 'decisión recortada (tope de eventos): sin familia');
});

// ---------- catálogo y almacén ----------
await check('catálogo: los parámetros de cada operación de mutación con su tipo, rango y paso exactos', () => {
  const P = { on: { name: 'Activado', type: 'bool' }, rate: { name: 'Probabilidad', type: 'number', min: 0, max: 1, step: 0.05 }, sigma: { name: 'Intensidad (σ)', type: 'number', min: 0, max: 1, step: 0.01 }, fraction: { name: 'Fracción de pesos', type: 'number', min: 0, max: 1, step: 0.05 }, max: { name: 'Máximo por vez', type: 'int', min: 1, max: 64, step: 1 }, types: { name: 'Tipos de bloque', type: 'set', options: ['dense', 'norm', 'skip', 'attention', 'pool', 'echo', 'gru', 'lstm', 'teamMemory', 'eye.*'] } };
  const ops = lab.catalog().mutation;
  assert.ok(ops.length > 0);
  for (const op of ops) for (const p of op.params) { const { key, default: _d, ...rest } = p; assert.deepEqual(rest, P[key], `${op.key}.${key}`); }
  assert.ok(ops.some((op) => op.params.some((p) => p.key === 'sigma')) && ops.some((op) => op.params.some((p) => p.key === 'max')), 'premisa: salen σ y el máximo');
});

await check('listGames: usa la meta de al lado aunque la partida esté rota; sin meta de al lado (partidas antiguas), la del fichero entero', () => {
  const dir = store.gamesDir();
  assert.ok(store.saveGame({ gameId: 'g-meta-a', kind: 'exhibition', nets: ['sl-net'], seed: 1 }, [{ id: 1, game: 'g-meta-a', type: 'game.start', data: {} }]) !== false);
  assert.ok(store.saveGame({ gameId: 'g-meta-b', kind: 'exhibition', nets: ['sl-net'], seed: 2 }, [{ id: 1, game: 'g-meta-b', type: 'game.start', data: {} }]) !== false);
  assert.ok(existsSync(join(dir, 'g-meta-a.meta.json')), 'premisa: se guarda la meta de al lado');
  writeFileSync(join(dir, 'g-meta-a.json'), '{ esto no es json');
  unlinkSync(join(dir, 'g-meta-b.meta.json'));
  const ids = store.listGames({ netId: 'sl-net' }).map((m) => m.gameId);
  assert.ok(ids.includes('g-meta-a'), 'la rota se lista por su meta de al lado');
  assert.ok(ids.includes('g-meta-b'), 'la antigua se lista por la meta de dentro');
});

await check('curvas: hasta 6000 líneas no se recorta; al pasar de 6000 quedan las 5000 últimas; sin curvas, []', () => {
  assert.deepEqual(store.readCurves('nadie'), []);
  const pts = (a, b) => Array.from({ length: b - a }, (_, i) => ({ game: a + i }));
  store.appendCurve('sl-net', 't1', pts(0, 6000));
  assert.equal(store.readCurves('sl-net')[0].points.length, 6000, 'exactamente 6000: sin recortar');
  store.appendCurve('sl-net', 't1', pts(6000, 6001));
  const c = store.readCurves('sl-net');
  assert.deepEqual([c.length, c[0].trainingId, c[0].points.length, c[0].points[0].game, c[0].points[4999].game], [1, 't1', 5000, 1001, 6000]);
});

// ---------- 409 de red ocupada por la API ----------
if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text };
  };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
  const mkNet = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };
  const nameOf = async (id) => (await api(`/api/lab/nets/${id}`)).body.genome.name;
  const refused = (r, start, what) => {
    assert.equal(r.status, 409, `${what}: ${r.text}`);
    assert.ok(r.body.error.startsWith(start), `${what}: el mensaje empieza por "${start}" → ${r.body.error}`);
  };
  const running = (id, what) => until(async () => { const r = (await api(`/api/lab/duels/${id}`)).body; return r && r.status === 'running' ? r : null; }, 60000, what);
  const finished = (id, what) => until(async () => { const r = (await api(`/api/lab/duels/${id}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, what);
  const exhibition = async (netId, seed) => {
    const room = (await api('/api/rooms', 'POST', { name: 'extra b', soldiers: 1, seed })).body;
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId, team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', {});
    const st = await until(async () => { const x = (await api(`/api/rooms/${room.code}/state`)).body; return x.phase === 'over' ? x : null; }, 120000, 'fin de la exhibición');
    const gameId = `g-${st.config.seed}-${room.code}`;
    const game = await until(async () => { const g = await api(`/api/lab/games/${gameId}`); return g.status === 200 ? g.body : null; }, 20000, 'partida guardada');
    return { game, dec: game.events.find((e) => e.type === 'decision' && e.actor.netId === netId && e.data.phase === 'shoot') };
  };
  const listen = () => {
    const ctrl = new AbortController(); const events = [];
    const ready = fetch(BASE + '/api/lab/events', { signal: ctrl.signal }).then((res) => {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = /^event: (.*)$/m.exec(chunk), data = /^data: (.*)$/m.exec(chunk);
              if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null });
            }
          }
        } catch { /* cerrado */ }
      })();
    });
    return { events, ready, close: () => ctrl.abort() };
  };
  const found = async (a, b) => { const r = await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Norte', netId: a }, B: { name: 'Casa Sur', netId: b } }); assert.equal(r.status, 200, r.text); };

  // una reina (la que haya, o una nueva) y una red libre que la reta
  const c = await mkNet('seer', 'Libre Extra B');
  if (!(await api('/api/lab/throne')).body.queen) { const s = await api('/api/lab/throne/challenge', 'POST', { challenger: await mkNet('seer', 'Reina Extra B') }); assert.equal(s.status, 200, s.text); }
  const queen = (await api('/api/lab/throne')).body.queen;
  const queenName = await nameOf(queen);

  await check('API: con la reina entrenando, retarla (trono o dinastía) → 409 "La reina <nombre> está entrenando (t…)"', async () => {
    const d = await mkNet('sniper', 'Campeona Sur B');
    await found(c, d);
    const tr = await api('/api/lab/trainings', 'POST', { netId: queen, speed: 'x1', duration: { games: 50 } });
    assert.equal(tr.status, 202, tr.text);
    try {
      refused(await api('/api/lab/throne/challenge', 'POST', { challenger: c }), `La reina ${queenName} está entrenando (${tr.body.id})`, 'reto al trono');
      refused(await api('/api/lab/dynasties/A/challenge-throne', 'POST', {}), `La reina ${queenName} está entrenando (${tr.body.id})`, 'reto de dinastía');
    } finally {
      await api(`/api/lab/trainings/${tr.body.id}/stop`, 'POST', {});
      await until(async () => { const t = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return t && !['queued', 'running', 'paused'].includes(t.status) ? t : null; }, 60000, 'entreno parado');
    }
  });

  await check('API: con la red en un duelo, pedir hijos, congelar, cambiar pesos, trasplantar, examinar, otro duelo, entrenar, criar y el reto de dinastía → 409 con su nombre (no su id); con la reina en un duelo, el reto de dinastía → 409 "La reina <nombre> está en el duelo"', async () => {
    const a = await mkNet('seer', 'Nova Ocupada B'), b = await mkNet('sniper', 'Rival Ocupada B');
    const [nameA, nameB] = [await nameOf(a), await nameOf(b)];
    const d1 = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'x10', soldiers: 4, seed: 17 });
    assert.equal(d1.status, 202, d1.text);
    const x = queen === a || queen === b ? null : await mkNet('sniper', 'Rival Reina B');
    const d2 = x ? await api('/api/lab/duels', 'POST', { a: queen, b: x, learning: 'frozen', speed: 'x10', soldiers: 4, seed: 18 }) : null;
    if (d2) assert.equal(d2.status, 202, d2.text);
    await running(d1.body.id, 'duelo de la red en marcha');
    if (d2) await running(d2.body.id, 'duelo de la reina en marcha');
    const inDuel = `${nameA} está en el duelo ${d1.body.id}`;
    refused(await api(`/api/lab/nets/${a}/children`, 'POST', { n: 1, pretournament: { games: 0 }, seed: 1 }), inDuel, 'pedir hijos');
    refused(await api(`/api/lab/nets/${a}/frozen`, 'PUT', { frozen: [] }), inDuel, 'congelar');
    refused(await api(`/api/lab/nets/${a}/weights/b1`, 'PUT', { values: [] }), inDuel, 'cambiar pesos');
    refused(await api(`/api/lab/nets/${a}/transplant`, 'POST', { from: c }), inDuel, 'trasplantar');
    refused(await api(`/api/lab/nets/${a}/bulletin`, 'POST', {}), inDuel, 'examinar');
    refused(await api('/api/lab/duels', 'POST', { a: c, b: a, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 19 }), inDuel, 'otro duelo (sin nombre en la llamada: el del disco)');
    refused(await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 2 } }), inDuel, 'entrenar (sin nombre en la llamada: el del disco)');
    await found(a, c);
    refused(await api('/api/lab/dynasties/generation', 'POST', {}), inDuel, 'criar con la campeona de la casa A en un duelo');
    refused(await api('/api/lab/dynasties/A/challenge-throne', 'POST', {}), inDuel, 'reto de dinastía con la campeona en un duelo');
    await found(c, b);
    refused(await api('/api/lab/dynasties/generation', 'POST', {}), `${nameB} está en el duelo ${d1.body.id}`, 'criar con la campeona de la casa B en un duelo');
    if (d2) refused(await api('/api/lab/dynasties/A/challenge-throne', 'POST', {}), `La reina ${queenName} está en el duelo ${d2.body.id}`, 'reto de dinastía con la reina en un duelo');
    assert.equal((await finished(d1.body.id, 'fin del duelo')).status, 'done');
    if (d2) await finished(d2.body.id, 'fin del duelo de la reina');
  });

  await check('API: bofetada a una red libre → aplicada (GET feedback 200; registro applied:true con pBefore y pAfter); caricia con la red en un duelo → {ok:true, applied:false, queued:true} y registro applied:false', async () => {
    const s = await mkNet('seer', 'Abofeteada B'), r = await mkNet('sniper', 'Rival Abofeteada B');
    let game = null, dec = null;
    for (const seed of [51, 53, 55, 57, 59]) { ({ game, dec } = await exhibition(s, seed)); if (dec) break; }
    assert.ok(dec, 'premisa: hay una decisión de disparo');
    const a1 = await api(`/api/lab/nets/${s}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: dec.id, amount: 1 });
    assert.equal(a1.status, 200, a1.text); assert.deepEqual([a1.body.ok, a1.body.applied], [true, true]);
    const fb = await api(`/api/lab/nets/${s}/feedback`);
    assert.equal(fb.status, 200); assert.equal(fb.body.applied.length, 1);
    const logOfApi = async (type) => (await api('/api/lab/log?limit=1000')).body.entries.filter((e) => e.type === type && e.netId === s);
    assert.deepEqual((await logOfApi('slap')).map((e) => [e.applied, e.pBefore, e.pAfter]), [[true, a1.body.update.pBefore, a1.body.update.pAfter]]);
    const d = await api('/api/lab/duels', 'POST', { a: s, b: r, learning: 'frozen', speed: 'x10', soldiers: 4, seed: 23 });
    assert.equal(d.status, 202, d.text);
    await running(d.body.id, 'duelo de la abofeteada');
    const q = await api(`/api/lab/nets/${s}/caress`, 'POST', { game: game.meta.gameId, decisionEventId: dec.id, amount: 0.5 });
    assert.equal(q.status, 200, q.text); assert.deepEqual([q.body.ok, q.body.applied, q.body.queued], [true, false, true]);
    assert.deepEqual((await logOfApi('caress')).map((e) => [e.applied, e.amount]), [[false, 0.5]]);
    await finished(d.body.id, 'fin del duelo de la abofeteada');
  });

  await check('API: el examen es un trabajo con progreso {done, total: 96} que avanza de 10 en 10 y acaba en 96/96', async () => {
    const e = await mkNet('seer', 'Examinada B');
    const p = await api(`/api/lab/nets/${e}/bulletin`, 'POST', {});
    assert.equal(p.status, 202, p.text);
    const seen = [];
    for (;;) { const j = (await api(`/api/lab/jobs/${p.body.jobId}`)).body; seen.push(j.progress); if (j.status !== 'running') { assert.equal(j.status, 'done', JSON.stringify(j).slice(0, 200)); break; } await sleep(10); }
    assert.deepEqual(seen[seen.length - 1], { done: 96, total: 96 });
    for (const x of seen) assert.ok(x.total === 96 && (x.done === 96 || x.done % 10 === 0), JSON.stringify(x));
    assert.ok(seen.some((x) => x.done > 0 && x.done < 96), `se ve algún avance intermedio: ${JSON.stringify(seen.map((x) => x.done))}`);
  });

  await check('API: /games de la más reciente a la más antigua; limit=1 → una, sin limit → 50; filtra por kind y por duelId', async () => {
    const x = await mkNet('seer', 'Lista X'), y = await mkNet('sniper', 'Lista Y');
    const duelIds = [];
    const count = async () => (await api('/api/lab/games?limit=500')).body.games.length;
    for (let i = 0; i < 12 && (i === 0 || (await count()) <= 50); i++) {
      const d = await api('/api/lab/duels', 'POST', { a: x, b: y, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 100 + i });
      assert.equal(d.status, 202, d.text); duelIds.push(d.body.id);
      await finished(d.body.id, 'duelo turbo');
    }
    const all = (await api('/api/lab/games?limit=500')).body.games;
    assert.ok(all.length > 50, `premisa: más de 50 partidas (${all.length})`);
    assert.equal((await api('/api/lab/games')).body.games.length, 50);
    assert.deepEqual((await api('/api/lab/games?limit=1')).body.games, all.slice(0, 1));
    assert.deepEqual((await api('/api/lab/games?limit=-5')).body.games, all.slice(0, 1), 'un limit negativo cuenta como 1');
    assert.ok(all.some((m) => m.kind !== 'duel'), 'premisa: hay partidas que no son de duelo');
    const duels = (await api('/api/lab/games?kind=duel&limit=500')).body.games;
    assert.ok(duels.length >= 6 && duels.every((m) => m.kind === 'duel'), 'kind=duel: solo duelos');
    assert.deepEqual((await api(`/api/lab/games?duelId=${duelIds[0]}&limit=500`)).body.games.map((m) => m.duelId), Array(6).fill(duelIds[0]));
  });

  await check('API: whatif valida la escena (32 soldados sí, 33 no; más de 64 obstáculos o uno sin ancho → 400) y por defecto usa dueño por equipo, vivo y semilla 1', async () => {
    const w = await mkNet('seer', 'Hipótesis B');
    const base = { soldierId: 's0', soldiers: [{ id: 's0', team: 'left', x: -10, y: 0 }, { id: 's1', team: 'right', x: 10, y: 2 }, { id: 's2', team: 'left', x: -12, y: -5 }, { id: 's3', team: 'right', x: 12, y: -4 }], obstacles: [{ x: -2, y: -3, w: 2, h: 4 }] };
    const wi = (scene, extra = {}) => api(`/api/lab/nets/${w}/whatif`, 'POST', { scene, ...extra });
    const sol = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, team: i % 2 ? 'right' : 'left', x: -24 + (i % 8) * 6.5, y: -14 + Math.floor(i / 8) * 7 }));
    assert.equal((await wi({ ...base, soldiers: sol(32) })).status, 200, '32 soldados');
    for (const [what, sc] of [['sin escena', undefined], ['sin soldados', { ...base, soldiers: [] }], ['soldados que no son lista', { ...base, soldiers: 'abc' }]]) {
      const r = await wi(sc);
      assert.equal(r.status, 400, what); assert.match(r.body.error, /de 1 a 32 soldados/, what);
    }
    const r33 = await wi({ ...base, soldiers: sol(33) });
    assert.equal(r33.status, 400); assert.match(r33.body.error, /de 1 a 32 soldados/);
    const many = await wi({ ...base, obstacles: Array.from({ length: 65 }, (_, i) => ({ x: -24 + (i % 13) * 3.5, y: 10 + Math.floor(i / 13) * 0.8, w: 0.5, h: 0.5 })) });
    assert.equal(many.status, 400); assert.match(many.body.error, /64 obstáculos/);
    assert.equal((await wi({ ...base, obstacles: Array.from({ length: 64 }, (_, i) => ({ x: -24 + (i % 13) * 3.5, y: 10 + Math.floor(i / 13) * 0.8, w: 0.5, h: 0.5 })) })).status, 200, 'exactamente 64 obstáculos valen');
    const flat = await wi({ ...base, obstacles: [{ x: 0, y: 0, w: 0, h: 1 }] });
    assert.equal(flat.status, 400); assert.match(flat.body.error, /w y h positivos/);
    const thin = await wi({ ...base, obstacles: [{ x: 0, y: 0, w: 1, h: 0 }] });
    assert.equal(thin.status, 400); assert.match(thin.body.error, /w y h positivos/);
    assert.equal((await wi({ ...base, obstacles: [{ x: 3, y: 3, w: 0.5, h: 0.5 }] })).status, 200, 'un obstáculo pequeño (0 < w, h ≤ 1) vale');
    const sameAs = (a, b, what) => { const strip = (r) => { const d = clone(r.body); delete d.decision.ms; return d; }; assert.deepEqual(strip(a), strip(b), what); }; // ms = tiempo de cálculo
    const dflt = await wi(base);
    assert.equal(dflt.status, 200, dflt.text);
    sameAs(await wi({ ...base, soldiers: base.soldiers.map((s) => ({ ...s, ownerId: s.team === 'left' ? 'pL' : 'pR', alive: true })) }), dflt, 'dueño por equipo y vivo por defecto');
    // dueño por defecto: pL a la izquierda, pR a la derecha, también mezclado con dueños explícitos (la tortuga ve cuántos suyos quedan)
    const tt = await mkNet('turtle', 'Hipótesis tortuga B');
    const wt = (scene) => api(`/api/lab/nets/${tt}/whatif`, 'POST', { scene });
    const full = { ...base, soldiers: base.soldiers.map((x) => ({ ...x, ownerId: x.team === 'left' ? 'pL' : 'pR' })) };
    const mixed = { ...base, soldiers: base.soldiers.map((x, i) => (i === 0 ? { ...x, ownerId: 'pL' } : x)) };
    const other = { ...full, soldiers: full.soldiers.map((x) => (x.id === 's2' ? { ...x, ownerId: 'pX' } : x)) };
    const [rFull, rMixed, rOther] = [await wt(full), await wt(mixed), await wt(other)];
    assert.equal(rFull.status, 200, rFull.text);
    sameAs(rMixed, rFull, 'sin ownerId, el de su equipo aunque otros lo lleven');
    assert.throws(() => sameAs(rOther, rFull, ''), 'premisa: la tortuga distingue cuántos soldados suyos quedan');
    const [rT0, rT10] = [await wt({ ...full, soldiers: full.soldiers.map((x) => ({ ...x, turns: 0 })) }), await wt({ ...full, soldiers: full.soldiers.map((x) => ({ ...x, turns: 10 })) })];
    sameAs(rT0, rFull, 'turns por defecto 0');
    assert.throws(() => sameAs(rT10, rFull, ''), 'premisa: la tortuga ve los turnos del soldado');
    const s1 = await wi(base, { seed: 1 }), s2 = await wi(base, { seed: 2 });
    sameAs(s1, dflt, 'sin semilla = semilla 1');
    assert.throws(() => sameAs(s2, s1, ''), 'premisa: la semilla cambia la decisión');
  });

  await check('API: borrar una red normal → 200; a la reina sin ?force=1 → 409 "es la reina"; con force → 200 y SSE throne (reign.end, reina null); a una campeona con force → SSE dynasty champion.deleted, sin tocar el trono', async () => {
    const ev = listen(); await ev.ready;
    const n = await mkNet('seer', 'Normal B');
    assert.equal((await api(`/api/lab/nets/${n}`, 'DELETE')).status, 200, 'una red normal se borra sin más');
    const r409 = await api(`/api/lab/nets/${queen}`, 'DELETE');
    assert.equal(r409.status, 409, r409.text); assert.match(r409.body.error, /es la reina/);
    const ch = await mkNet('seer', 'Campeona Borrada B'), ch2 = await mkNet('sniper', 'Campeona Queda B');
    await found(ch, ch2);
    assert.equal((await api(`/api/lab/nets/${ch}?force=1`, 'DELETE')).status, 200);
    assert.equal((await api(`/api/lab/nets/${queen}?force=1`, 'DELETE')).status, 200);
    await until(async () => ev.events.some((e) => e.event === 'throne' && e.data.event === 'reign.end' && e.data.netId === queen), 10000, 'SSE del trono');
    assert.deepEqual(ev.events.filter((e) => e.event === 'dynasty' && e.data.event === 'champion.deleted').map((e) => [e.data.house, e.data.netId]), [['A', ch]]);
    const thr = ev.events.filter((e) => e.event === 'throne' && e.data.event === 'reign.end');
    assert.deepEqual(thr.map((e) => [e.data.queen, e.data.netId, e.data.reason]), [[null, queen, 'deleted']]);
    ev.close();
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: red ocupada, casos extra b)');
process.exitCode = fails ? 1 : 0;
