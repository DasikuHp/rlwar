// Arreglo C4 (spec/04 §10.1; spec/revision-opus.md C4): cada partida es un mundo aparte al aprender.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-partidas.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-c4-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const { compile } = await import('../shared/nn.js');
const { TEMPLATES } = await import('../shared/templates.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { playGame } = await import('../server/headless.js');

const saveTemplate = (key, id, patch = {}) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), id, name: id, ...patch }); assert.ok(r.ok, JSON.stringify(r)); return id; };
const learnerGame = (r) => {
  const p = r.room.players.find((x) => x.agentType === 'net' && x.learn);
  return { events: r.events, trajectory: r.trajectories[p.id], playerId: p.id };
};

await check('learnFromGames: una partida y su clon (mismos ids) son episodios distintos; con SGD el paso es exactamente el doble', () => {
  saveTemplate('seer', 'c4-a', { reward: { ...TEMPLATES.seer.genome.reward, normalize: false } });
  saveTemplate('sniper', 'c4-r');
  const g1 = learnerGame(playGame({ seed: 21, left: { type: 'net', netId: 'c4-a', learn: true }, right: { type: 'net', netId: 'c4-r' }, soldiers: 2 }));
  const genome = store.loadNet('c4-a');
  const cfg = { optimizer: 'sgd', lr: 0.01, clipNorm: 1e12, entropy: 0, baseline: 'none' };
  const run = (games) => { const net = compile(genome); const before = net.getFlat(); const r = T.learnFromGames({ net, genome, games, optim: T.adamInit(net), cfg }); const after = net.getFlat(); return { r, delta: Array.from(after, (v, i) => v - before[i]) }; };
  const one = run([structuredClone(g1)]);
  const two = run([structuredClone(g1), structuredClone(g1)]);
  const soldiers = new Set(Object.keys(g1.trajectory.soldiers).filter((s) => g1.trajectory.soldiers[s].length));
  assert.ok(Array.isArray(two.r.episodes), 'learnFromGames devuelve episodes');
  for (const k of [0, 1]) {
    const eps = two.r.episodes.filter((e) => e.game === k);
    assert.equal(eps.length, soldiers.size, `partida ${k}: un episodio por soldado`);
  }
  assert.ok(two.r.episodes.every((e) => e.game === 0 || e.game === 1));
  const max = Math.max(...one.delta.map(Math.abs));
  assert.ok(max > 0, 'la partida enseña algo');
  one.delta.forEach((d, i) => assert.ok(Math.abs(two.delta[i] - 2 * d) <= 1e-9 * Math.max(1, max), `peso ${i}: ${two.delta[i]} ≠ 2·${d}`));
  const byGame = [0, 1].map((k) => two.r.emotions.filter((e) => e.game === k));
  assert.equal(byGame[0].length + byGame[1].length, two.r.emotions.length, 'cada emoción dice de qué partida es');
  for (const list of byGame) assert.equal(new Set(list.map((e) => e.decisionEventId)).size, list.length, 'una emoción por decisión y partida');
});

await check('entreno turbo con 4 hilos y 2 soldados: mismos pesos que con 1 hilo (spec/04 §9.4)', async () => {
  saveTemplate('seer', 'c4-w1'); saveTemplate('seer', 'c4-w4');
  const cfg = (netId, workers) => ({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'c4-r' }, speed: 'turbo', workers, duration: { games: 8 }, soldiers: 2, seed: 100 });
  const t1 = T.createTrainer(cfg('c4-w1', 1)); await t1.start();
  const t4 = T.createTrainer(cfg('c4-w4', 4)); await t4.start();
  assert.equal(t1.status, 'done'); assert.equal(t4.status, 'done');
  const w1 = Array.from(compile(store.loadNet('c4-w1')).getFlat()), w4 = Array.from(compile(store.loadNet('c4-w4')).getFlat());
  assert.ok(w1.some((v, i) => v !== compile(TEMPLATES.seer.genome).getFlat()[i]), 'aprendió algo');
  assert.deepEqual(w4, w1);
});

await check('partidas de muestra de un entreno: como mucho una emoción por decisión de la red, y todas de sus decisiones', async () => {
  saveTemplate('seer', 'c4-m');
  const t = T.createTrainer({ netId: 'c4-m', opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'c4-r' }, speed: 'turbo', workers: 1, duration: { games: 21 }, soldiers: 2, seed: 5 });
  await t.start();
  assert.ok(t.sampleGames.length >= 2, `partidas de muestra: ${t.sampleGames.length}`);
  for (const id of t.sampleGames) {
    const g = store.loadGame(id);
    const learner = Object.keys(g.trajectories)[0];
    const mine = new Set(g.events.filter((e) => e.type === 'decision' && e.actor.playerId === learner).map((e) => e.id));
    const em = g.events.filter((e) => e.type === 'emotion');
    assert.ok(em.length > 0, `${id}: hay emociones`);
    assert.ok(em.every((e) => mine.has(e.data.decisionEventId)), `${id}: emoción de una decisión ajena`);
    assert.equal(new Set(em.map((e) => e.data.decisionEventId)).size, em.length, `${id}: ${em.length} emociones para ${new Set(em.map((e) => e.data.decisionEventId)).size} decisiones`);
    assert.ok(em.length <= mine.size);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: cada partida es un mundo aparte)');
process.exitCode = fails ? 1 : 0;
