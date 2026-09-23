// Revisión de Fable (spec/04 §10.5; spec/revision-opus.md §9 R1, R2, R4): el paso de evolución cede el bucle de
// verdad, una red ocupada (duelo, exhibición que aprende) no pierde lo que se le hace, y contra una persona la
// exhibición evoluciona contra sí misma. Escrito ANTES del código y congelado.
// Uso: node test/arreglos-ocupada.spec.mjs [http://localhost:8791]   (sin URL, solo las partes en proceso)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ocupada-'));

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const { compile } = await import('../shared/nn.js');
const { normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const { softmaxT } = await import('../shared/policy.js');
const { playGame } = await import('../server/headless.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const duel = await import('../evo/duel.js');
const busy = await import('../evo/busy.js');
const lab = await import('../evo/api.js');

const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const untilLocal = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); } throw new Error(`tiempo agotado: ${what}`); };
// oráculo independiente: probabilidad de lo que eligió, reproduciendo la trayectoria del soldado desde cero
const pChosen = (genome, game, decisionEv) => {
  const g = normalize(genome); const net = compile(g);
  const steps = game.trajectories[decisionEv.actor.playerId].soldiers[decisionEv.actor.soldierId];
  const idx = steps.findIndex((s) => s.decision && s.decision.eventId === decisionEv.id);
  let st = net.zeroState(), out = null;
  for (let i = 0; i <= idx; i++) { out = net.forward(steps[i].obs, st); st = out.state; }
  const d = steps[idx].decision;
  if (d.phase === 'move') return softmaxT(out.outputs.move.scores, g.traits.temperature)[d.chosenMove];
  return softmaxT(out.outputs.choose.scores, g.traits.temperature)[d.chosen];
};

// ---------- R1: el paso de evolución cede el bucle entre partida y partida ----------
await check('R1: evolutionRound con el play por defecto cede el bucle antes de cada partida (una vuelta del bucle por partida) y da lo mismo que jugarlas a mano', async () => {
  const g = normalize({ ...clone(TEMPLATES.seer.genome), id: 'oc-r1', name: 'R1' });
  const cfg = { population: 4, sigma: 0.05, lr: 0.05, gamesPerCandidate: 3, antithetic: true, rankNormalize: true };
  const seeds = [11, 12, 13], games = 4 * seeds.length;
  const rival = { type: 'greedy', level: 1 };
  let ticks = 0, spinning = true;
  const spin = () => { if (spinning) { ticks++; setImmediate(spin); } };
  setImmediate(spin);
  const net1 = compile(g);
  const r1 = await T.evolutionRound({ net: net1, genome: g, rival, soldiers: 1, seeds, cfg, rng: makeRng(9) });
  spinning = false;
  assert.ok(ticks >= games - 1, `el bucle dio ${ticks} vueltas durante ${games} partidas: tiene que ceder antes de cada una`);
  const net2 = compile(g);
  const r2 = await T.evolutionRound({ net: net2, genome: g, rival, soldiers: 1, seeds, cfg, rng: makeRng(9), play: async (spec) => T.playOne(spec) });
  assert.deepEqual(r1.fitness, r2.fitness, 'mismas fitness que jugando cada partida a mano');
  assert.deepEqual(Array.from(net1.getFlat()), Array.from(net2.getFlat()), 'mismos pesos');
});

// ---------- R2: registro de redes ocupadas ----------
await check('R2: runDuel tiene ocupadas las dos redes todo el duelo ({kind: duel, id}) y las suelta al acabar, también si falla', async () => {
  assert.equal(busy.heldBy('oc-a'), null);
  const seen = [];
  const play = async (row) => { seen.push([busy.heldBy('oc-a'), busy.heldBy('oc-b')]); return { winner: row.left, kills: { [row.left]: 1, [row.right]: 0 }, events: [], trajectories: {}, playerIds: {}, gameId: null }; };
  const learner = () => ({ learn() {}, review() {}, save() {}, addStats() {} });
  const rec = await duel.runDuel({ a: 'oc-a', b: 'oc-b', play, learner, seed: 1 });
  assert.ok(seen.length > 0);
  for (const [ha, hb] of seen) { assert.deepEqual(ha, { kind: 'duel', id: rec.id }); assert.deepEqual(hb, { kind: 'duel', id: rec.id }); }
  assert.equal(busy.heldBy('oc-a'), null); assert.equal(busy.heldBy('oc-b'), null);
  const boom = async () => { throw new Error('partida rota'); };
  await duel.runDuel({ a: 'oc-a', b: 'oc-b', play: boom, learner, seed: 2 }).catch(() => null);
  assert.equal(busy.heldBy('oc-a'), null, 'un duelo que falla también suelta las redes');
  // dos que la tienen: hasta que no la suelta el último, sigue ocupada
  busy.holdNet('oc-c', { kind: 'duel', id: 'd-uno' }); busy.holdNet('oc-c', { kind: 'exhibition', id: 'SALA' });
  busy.releaseNet('oc-c', { kind: 'duel', id: 'd-uno' });
  assert.deepEqual(busy.heldBy('oc-c'), { kind: 'exhibition', id: 'SALA' });
  busy.releaseNet('oc-c', { kind: 'exhibition', id: 'SALA' });
  assert.equal(busy.heldBy('oc-c'), null);
});

// una partida guardada donde decide la red (para bofetadas en proceso)
const savedGameOf = (genome, seed) => {
  const r = playGame({ seed, left: { type: 'net', genome, learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  const gameId = r.events[0].game;
  store.saveGame({ gameId, kind: 'exhibition', seed, nets: [genome.id], ts: Date.now() }, r.events, r.trajectories);
  return store.loadGame(gameId);
};
await check('R2: la bofetada que quedó en cola mientras la red estaba en un duelo se aplica al soltarla (pesos, applied con pAfter exacto, nada pendiente)', async () => {
  const g0 = { ...clone(TEMPLATES.seer.genome), id: 'oc-d', name: 'OC D' };
  assert.ok(store.saveNet(g0).ok);
  const game = savedGameOf(store.loadNet('oc-d'), 21);
  const dec = game.events.find((e) => e.type === 'decision' && e.actor.netId === 'oc-d' && e.data.phase === 'shoot');
  assert.ok(dec, 'hay una decisión de disparo de la red');
  store.writeFeedback('oc-d', [{ kind: 'slap', game: game.meta.gameId, decisionEventId: dec.id, eventId: null, amount: 2, ts: Date.now() }]);
  const before = store.loadNet('oc-d');
  const p0 = pChosen(before, game, dec);
  const play = async (row) => ({ winner: row.left, kills: { [row.left]: 1, [row.right]: 0 }, events: [], trajectories: {}, playerIds: {}, gameId: null });
  const learner = () => ({ learn() {}, review() {}, save() {}, addStats() {} });
  await duel.runDuel({ a: 'oc-d', b: 'oc-a', play, learner, seed: 3 });
  assert.equal(store.readFeedback('oc-d').length, 0, 'nada pendiente');
  const applied = store.readApplied('oc-d');
  assert.equal(applied.length, 1);
  const after = store.loadNet('oc-d');
  assert.ok(near(applied[0].pBefore, p0), `pBefore ${applied[0].pBefore} ≠ ${p0}`);
  assert.ok(near(applied[0].pAfter, pChosen(after, game, dec)), 'pAfter = la probabilidad con los pesos guardados');
  assert.ok(applied[0].pAfter < p0, 'la bofetada baja la probabilidad');
  assert.ok((after.memory.episodes || []).some((ep) => ep.outcome === 'slap' && ep.emotion === 'shame'), 'recuerdo de vergüenza');
});

await check('R2: una exhibición que acaba con la red ocupada no la toca (exhibition.skipped con el motivo)', async () => {
  const g0 = { ...clone(TEMPLATES.seer.genome), id: 'oc-e', name: 'OC E' };
  assert.ok(store.saveNet(g0).ok);
  const r = playGame({ seed: 31, left: { type: 'net', netId: 'oc-e', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  busy.holdNet('oc-e', { kind: 'duel', id: 'd-oc' });
  try { lab.onExhibitionOver(r.room); } finally { busy.releaseNet('oc-e', { kind: 'duel', id: 'd-oc' }); }
  const sk = logOf().find((e) => e.type === 'exhibition.skipped' && e.netId === 'oc-e');
  assert.ok(sk, 'queda exhibition.skipped'); assert.match(sk.reason, /duelo/);
  assert.equal(store.loadNet('oc-e').stats.games, 0, 'no suma la partida');
});

// ---------- R4: exhibición contra una persona ----------
await check('R4: exhibición con learn:true de una red de evolución contra una persona → las copias juegan contra la propia red (rival self); contra un agente, su tipo', async () => {
  const mk = (id) => { const t = clone(TEMPLATES.seer.genome); assert.ok(store.saveNet({ ...t, id, name: id, learning: { ...t.learning, method: 'evolution', evolution: { ...t.learning.evolution, population: 2, gamesPerCandidate: 1 } } }).ok); };
  mk('oc-h'); mk('oc-g');
  const human = playGame({ seed: 41, left: { type: 'net', netId: 'oc-h', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  const seat = human.room.players.find((p) => p.team === 'right');
  Object.assign(seat, { isBot: false, agentType: null, netId: null, genome: null, name: 'Hugo' }); // se sentó con join: una persona
  lab.onExhibitionOver(human.room);
  const agent = playGame({ seed: 42, left: { type: 'net', netId: 'oc-g', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
  lab.onExhibitionOver(agent.room);
  const upH = await untilLocal(() => logOf().find((e) => e.type === 'update' && e.netId === 'oc-h' && e.kind === 'evolution'), 60000, 'paso contra la persona');
  const upG = await untilLocal(() => logOf().find((e) => e.type === 'update' && e.netId === 'oc-g' && e.kind === 'evolution'), 60000, 'paso contra el agente');
  assert.equal(upH.rival, 'self'); assert.equal(upG.rival, 'greedy');
  assert.equal(busy.heldBy('oc-h'), null, 'al acabar el paso la red queda libre');
});

// ---------- R2 por la API ----------
if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text };
  };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
  const mkNet = async (template, name, patch = null) => {
    const r = await api('/api/lab/nets', 'POST', { template, name });
    assert.equal(r.status, 201, r.text);
    if (patch) { const g = { ...r.body.genome, ...patch(r.body.genome) }; const p = await api(`/api/lab/nets/${r.body.id}`, 'PUT', g); assert.equal(p.status, 200, p.text); }
    return r.body.id;
  };
  const genomeOf = async (id) => (await api(`/api/lab/nets/${id}`)).body.genome;
  const exhibition = async (netId, { seed, soldiers = 1, learn = false }) => {
    const room = (await api('/api/rooms', 'POST', { name: 'ocupada', soldiers, seed })).body;
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId, learn, team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'greedy', level: 1, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', {});
    const st = await until(async () => { const s = (await api(`/api/rooms/${room.code}/state`)).body; return s.phase === 'over' ? s : null; }, 120000, 'fin de la exhibición');
    return { code: room.code, gameId: `g-${st.config.seed}-${room.code}` };
  };
  const decisionOf = async (netId, gameId) => {
    const game = await until(async () => { const g = await api(`/api/lab/games/${gameId}`); return g.status === 200 ? g.body : null; }, 20000, 'partida guardada');
    return { game, dec: game.events.find((e) => e.type === 'decision' && e.actor.netId === netId && e.data.phase === 'shoot') };
  };

  await check('API: con la red en un duelo, editar/borrar/entrenar/otro duelo → 409 con el motivo; la bofetada queda en cola y se aplica al acabar el duelo', async () => {
    const a = await mkNet('seer', 'Ocupada Duelo'), b = await mkNet('sniper', 'Rival Duelo'), c = await mkNet('seer', 'Tercera');
    const { game, dec } = await decisionOf(a, (await exhibition(a, { seed: 51 })).gameId);
    assert.ok(dec, 'hay una decisión de disparo');
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'mix', speed: 'turbo', soldiers: 4, seed: 7 });
    assert.equal(d.status, 202, d.text);
    await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.status === 'running' && r.games.length >= 1 ? r : null; }, 60000, 'duelo en marcha');
    const g = await genomeOf(a);
    const put = await api(`/api/lab/nets/${a}`, 'PUT', { ...g, name: 'Otro nombre' });
    assert.equal(put.status, 409, put.text); assert.match(put.body.error, /duelo/);
    const del = await api(`/api/lab/nets/${a}`, 'DELETE');
    assert.equal(del.status, 409, del.text); assert.match(del.body.error, /duelo/);
    const tr = await api('/api/lab/trainings', 'POST', { netId: a, speed: 'turbo', duration: { games: 2 } });
    assert.equal(tr.status, 409, tr.text);
    const d2 = await api('/api/lab/duels', 'POST', { a: c, b, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 8 });
    assert.equal(d2.status, 409, 'la rival también está ocupada: ' + d2.text);
    const s = await api(`/api/lab/nets/${a}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: dec.id, amount: 2 });
    assert.equal(s.status, 200, s.text); assert.equal(s.body.applied, false); assert.equal(s.body.queued, true);
    const done = await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, 'fin del duelo');
    assert.equal(done.status, 'done');
    const fb = await until(async () => { const f = (await api(`/api/lab/nets/${a}/feedback`)).body; return f.applied.length ? f : null; }, 20000, 'bofetada aplicada');
    assert.equal(fb.pending.length, 0);
    assert.ok(near(fb.applied[0].pAfter, pChosen(await genomeOf(a), game, dec)), 'los pesos guardados son los de después de la bofetada');
    const put2 = await api(`/api/lab/nets/${a}`, 'PUT', { ...(await genomeOf(a)), name: 'Libre otra vez' });
    assert.equal(put2.status, 200, 'al acabar el duelo se puede editar: ' + put2.text);
  });

  await check('API: mientras una exhibición aprende (paso de evolución), el servidor responde, la red está ocupada (409) y la bofetada se aplica al terminar', async () => {
    const id = await mkNet('seer', 'Ocupada Exhibición', (g) => ({ learning: { ...g.learning, method: 'evolution', evolution: { ...g.learning.evolution, population: 32, gamesPerCandidate: 8 } } }));
    const ex = await exhibition(id, { seed: 61, soldiers: 3, learn: true });
    const t0 = Date.now();
    const put = await api(`/api/lab/nets/${id}`, 'PUT', { ...(await genomeOf(id)), name: 'Otro nombre' });
    const ms = Date.now() - t0;
    assert.equal(put.status, 409, put.text); assert.match(put.body.error, /exhibición/);
    assert.ok(ms < 3000, `el servidor tardó ${ms} ms en responder durante el paso`);
    const { game, dec } = await decisionOf(id, ex.gameId);
    const s = await api(`/api/lab/nets/${id}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: dec.id, amount: 2 });
    assert.equal(s.body.queued, true, s.text);
    await until(async () => (await api('/api/lab/log?limit=2000')).body.entries.find((e) => e.type === 'update' && e.netId === id && e.kind === 'evolution'), 180000, 'paso de evolución');
    const fb = await until(async () => { const f = (await api(`/api/lab/nets/${id}/feedback`)).body; return f.applied.length ? f : null; }, 20000, 'bofetada aplicada');
    assert.equal(fb.pending.length, 0);
    assert.ok(near(fb.applied[0].pAfter, pChosen(await genomeOf(id), game, dec)), 'la bofetada no se pierde');
  });

  await check('API: un reto con la reina ocupada (en otro duelo) → 409', async () => {
    const q = await mkNet('seer', 'Reina Ocupada'), x = await mkNet('sniper', 'Rival Reina'), c = await mkNet('seer', 'Retadora');
    const th = (await api('/api/lab/throne')).body;
    if (!th.queen) { const s = await api('/api/lab/throne/challenge', 'POST', { challenger: q }); assert.equal(s.status, 200, s.text); }
    const queen = (await api('/api/lab/throne')).body.queen;
    const d = await api('/api/lab/duels', 'POST', { a: queen, b: x, learning: 'frozen', speed: 'turbo', soldiers: 4, seed: 9 });
    assert.equal(d.status, 202, d.text);
    const ch = await api('/api/lab/throne/challenge', 'POST', { challenger: c });
    assert.equal(ch.status, 409, ch.text); assert.match(ch.body.error, /reina/);
    await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, 'fin del duelo');
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: red ocupada y evolución que cede el bucle)');
process.exitCode = fails ? 1 : 0;
