// Auditoría P0 (2026-09-23): huecos antiguos de F4 que anotó spec/mutantes.md ("Parte 3", train.js:604), probados
// contra la spec y no contra el código (el código ya existe: este test cierra cobertura, como los "extra").
// - spec/04 §4: en turbo "1 de cada 20 se guarda para la moviola": de cada tramo de 20 partidas seguidas (0–19,
//   20–39, 40…) queda guardada exactamente una.
// - spec/04 §9.4: la partida k se juega con la semilla `seed + k` y la red va a la izquierda si k es par; la partida
//   guardada lo cuenta (`meta.seed`, `meta.left`).
// - spec/07 §5: cada recuerdo de la memoria lleva `rivalId` = el `netId` del rival contra el que pasó.
// Y el hueco de F6 (throne.js:41): spec/06 §8.1, `reignGames` de la copia de la sala de la fama = retos que jugó ese
// reinado (sus defensas, ganadas o empatadas, más el que perdió).
// Uso: node test/auditoria-p0.spec.mjs   (en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-p0entreno-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const { TEMPLATES } = await import('../shared/templates.js');
const T = await import('../evo/train.js');
const TH = await import('../evo/throne.js');
const store = await import('../evo/store.js');
const save = (key, id) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), id, name: id }); assert.ok(r.ok, JSON.stringify(r)); };

const S = 7300, N = 41;
save('sniper', 'p0-a');
save('seer', 'p0-r');
const t = T.createTrainer({ netId: 'p0-a', speed: 'turbo', workers: 1, duration: { games: N }, soldiers: 1, seed: S, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'p0-r' } });
await t.start();

await check('premisa: el entreno acaba con sus 41 partidas', () => {
  assert.equal(t.status, 'done', t.error || '');
  assert.equal(t.games, N);
});

await check('turbo: de cada tramo de 20 partidas seguidas se guarda exactamente una para la moviola', () => {
  const metas = store.listGames({ netId: 'p0-a' }).filter((m) => m.trainingId === t.id);
  assert.equal(metas.length, t.sampleGames.length, 'las guardadas son las de sampleGames');
  const ks = metas.map((m) => m.seed - S).sort((a, b) => a - b);
  assert.ok(ks.every((k) => Number.isInteger(k) && k >= 0 && k < N), `partidas guardadas: ${ks}`);
  const perBlock = [0, 0, 0];
  for (const k of ks) perBlock[Math.floor(k / 20)]++;
  assert.deepEqual(perBlock, [1, 1, 1], `k guardadas ${ks}`);
});

await check('cada partida guardada es la k-ésima: semilla seed + k y la red a la izquierda si k es par', () => {
  for (const m of store.listGames({ netId: 'p0-a' }).filter((x) => x.trainingId === t.id)) {
    const k = m.seed - S;
    assert.equal(k % 2 ? m.right : m.left, 'p0-a', `partida ${k}: lados ${m.left} | ${m.right}`);
    assert.equal(k % 2 ? m.left : m.right, 'p0-r', `partida ${k}: la rival en el otro lado`);
  }
});

await check('memoria: cada recuerdo de la red lleva rivalId = la red contra la que pasó', () => {
  const mem = store.loadNet('p0-a').memory || {};
  const eps = mem.episodes || [];
  assert.ok(eps.length > 0, 'premisa: en 41 partidas hubo algún recuerdo (kill, death o graze)');
  assert.ok(eps.every((e) => e.rivalId === 'p0-r'), `rivalId: ${[...new Set(eps.map((e) => e.rivalId))]}`);
});

await check('sala de la fama: reignGames = retos que jugó el reinado (2 defensas —una ganada y una empatada— y el perdido = 3)', async () => {
  save('sniper', 'p0-q'); save('sniper', 'p0-c');
  const fixed = (winner, tie = false) => async (o) => ({ id: `d-${winner}-${tie}`, a: o.a, b: o.b, status: 'done', games: [{ k: 0 }], wins: { [o.a]: winner === o.a ? 4 : 2, [o.b]: winner === o.b ? 4 : 2 }, killDiff: 0, winner, tie, throne: true, ms: 1 });
  const hooks = { now: () => 1000 };
  assert.equal((await TH.challenge({ challenger: 'p0-q' }, hooks)).result, 'seated');
  assert.equal((await TH.challenge({ challenger: 'p0-c' }, { ...hooks, runDuel: fixed('p0-q') })).result, 'queen');
  assert.equal((await TH.challenge({ challenger: 'p0-c' }, { ...hooks, runDuel: fixed('p0-q', true) })).result, 'tie');
  assert.equal((await TH.challenge({ challenger: 'p0-c' }, { ...hooks, runDuel: fixed('p0-c') })).result, 'challenger');
  const h = TH.readThroneFull().hallOfFame.find((x) => x.netId === 'p0-q');
  assert.ok(h, 'la ex-reina está en la sala de la fama');
  assert.equal(h.reignGames, 3);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (auditoría P0: huecos antiguos del entreno y del trono)');
process.exitCode = fails ? 1 : 0;
