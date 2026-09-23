// Casos extra de la red ocupada (spec/04 §10.5; spec/mutantes.md): los dos huecos que dejaron los mutantes del
// arreglo de R2. (1) Una red sigue ocupada hasta que la suelta el último que la tiene: soltar a uno no suelta a
// otro del mismo tipo con distinto id, ni a otro con el mismo id y distinto tipo. (2) Lo que queda en cola se
// aplica al soltarla solo si nadie más la tiene: con dos duelos a la vez, el que acaba primero no la toca.
// Congelado. Uso: node test/arreglos-ocupada-extra.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-ocupada-extra-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const { playGame } = await import('../server/headless.js');
const store = await import('../evo/store.js');
const duel = await import('../evo/duel.js');
const busy = await import('../evo/busy.js');

// ---------- (1) quién la tiene: se suelta exactamente al que se nombra ----------
await check('soltar a un duelo no suelta a otro duelo que tiene la misma red (mismo tipo, distinto id)', async () => {
  busy.holdNet('ox-1', { kind: 'duel', id: 'd-a' });
  busy.holdNet('ox-1', { kind: 'duel', id: 'd-b' });
  busy.releaseNet('ox-1', { kind: 'duel', id: 'd-b' });
  assert.deepEqual(busy.heldBy('ox-1'), { kind: 'duel', id: 'd-a' });
  busy.releaseNet('ox-1', { kind: 'duel', id: 'd-a' });
  assert.equal(busy.heldBy('ox-1'), null);
});
await check('soltar a una exhibición no suelta a un duelo con el mismo id (mismo id, distinto tipo)', async () => {
  busy.holdNet('ox-2', { kind: 'duel', id: 'z' });
  busy.holdNet('ox-2', { kind: 'exhibition', id: 'z' });
  busy.releaseNet('ox-2', { kind: 'exhibition', id: 'z' });
  assert.deepEqual(busy.heldBy('ox-2'), { kind: 'duel', id: 'z' });
  busy.releaseNet('ox-2', { kind: 'duel', id: 'z' });
  assert.equal(busy.heldBy('ox-2'), null);
});
await check('soltar a quien no la tiene no cambia nada', async () => {
  busy.holdNet('ox-3', { kind: 'duel', id: 'd-a' });
  busy.releaseNet('ox-3', { kind: 'duel', id: 'd-otro' });
  busy.releaseNet('ox-3', { kind: 'exhibition', id: 'd-a' });
  assert.deepEqual(busy.heldBy('ox-3'), { kind: 'duel', id: 'd-a' });
  busy.releaseNet('ox-3', { kind: 'duel', id: 'd-a' });
  assert.equal(busy.heldBy('ox-3'), null);
});

// ---------- (2) la cola se aplica al soltar solo si nadie más la tiene ----------
// una partida guardada en la que dispara la red: la primera semilla desde `seed` en la que llega a disparar
const savedGameOf = (genome, seed) => {
  let r = null;
  for (let s = seed; s < seed + 50 && !r; s++) {
    const t = playGame({ seed: s, left: { type: 'net', genome, learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 1 });
    if (t.events.some((e) => e.type === 'decision' && e.actor.netId === genome.id && e.data.phase === 'shoot')) r = t;
  }
  assert.ok(r, 'alguna semilla en la que la red dispara');
  const gameId = r.events[0].game;
  store.saveGame({ gameId, kind: 'exhibition', seed, nets: [genome.id], ts: Date.now() }, r.events, r.trajectories);
  return store.loadGame(gameId);
};
await check('dos duelos a la vez con la misma red: al acabar el primero la bofetada sigue en cola y los pesos no cambian; al acabar el segundo se aplica', async () => {
  for (const [id, name] of [['ox-s', 'OX S'], ['ox-r1', 'OX R1'], ['ox-r2', 'OX R2']]) assert.ok(store.saveNet({ ...clone(TEMPLATES.seer.genome), id, name }).ok);
  const game = savedGameOf(store.loadNet('ox-s'), 21);
  const dec = game.events.find((e) => e.type === 'decision' && e.actor.netId === 'ox-s' && e.data.phase === 'shoot');
  store.writeFeedback('ox-s', [{ kind: 'slap', game: game.meta.gameId, decisionEventId: dec.id, eventId: null, amount: 2, ts: Date.now() }]);
  const before = store.loadNet('ox-s');
  const learner = () => ({ learn() {}, review() {}, save() {}, addStats() {} });
  const fast = async (row) => ({ winner: row.left, kills: { [row.left]: 1, [row.right]: 0 }, events: [], trajectories: {}, playerIds: {}, gameId: null });
  let open; const gate = new Promise((r) => { open = r; });
  const slow = async (row) => { await gate; return fast(row); };
  const second = duel.runDuel({ id: 'd-ox-2', a: 'ox-s', b: 'ox-r2', play: slow, learner, seed: 5 });
  try {
    assert.deepEqual(busy.heldBy('ox-s'), { kind: 'duel', id: 'd-ox-2' }, 'el segundo duelo tiene la red desde que empieza');
    await duel.runDuel({ id: 'd-ox-1', a: 'ox-s', b: 'ox-r1', play: fast, learner, seed: 3 });
    assert.deepEqual(busy.heldBy('ox-s'), { kind: 'duel', id: 'd-ox-2' }, 'la red sigue ocupada por el segundo duelo');
    assert.equal(store.readFeedback('ox-s').length, 1, 'la bofetada sigue en cola');
    assert.equal(store.readApplied('ox-s').length, 0, 'nada aplicado todavía');
    assert.deepEqual(store.loadNet('ox-s').weights, before.weights, 'los pesos no cambian mientras otro la tiene');
  } finally { open(); }
  await second;
  assert.equal(busy.heldBy('ox-s'), null);
  assert.equal(store.readFeedback('ox-s').length, 0, 'nada pendiente');
  assert.equal(store.readApplied('ox-s').length, 1, 'aplicada al soltarla el último');
  assert.notDeepEqual(store.loadNet('ox-s').weights, before.weights, 'los pesos cambian');
});

console.log(fails ? `\n✘ ${fails} caso(s) fallan` : '\n✔ arreglos-ocupada-extra: todo en verde');
process.exitCode = fails ? 1 : 0;
