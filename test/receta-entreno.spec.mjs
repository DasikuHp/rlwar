// Receta de entreno en el entrenador (spec/04 §11, ronda 17), en proceso y sin servidor. Escrito ANTES del código.
// Oráculos independientes del código nuevo: entrenar con una receta da lo mismo, bit a bit, que entrenar una copia de
// la red a la que se le ha puesto eso para siempre; y la red guardada no cambia más que en lo que aprendió.
// Uso: node test/receta-entreno.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-receta-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const { TEMPLATES } = await import('../shared/templates.js');
const { softmaxT } = await import('../shared/policy.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { runBulletin } = await import('../evo/exam.js');

const save = (id, patch = {}, key = 'sniper') => { const g = { ...clone(TEMPLATES[key].genome), id, name: id, ...patch }; const r = store.saveNet(g); assert.ok(r.ok, JSON.stringify(r)); return store.loadNet(id); };
const SELF = { antagonist: 0, hallOfFame: 0, self: 1 };
const train = async (netId, games, extra = {}) => {
  const t = T.createTrainer({ netId, speed: 'turbo', workers: 1, duration: { games }, soldiers: 1, seed: extra.seed ?? 4100, opponents: extra.opponents || SELF, ...extra });
  const ev = { sleep: [], curriculum: [], exam: [] };
  for (const k of Object.keys(ev)) t.on(k, (d) => ev[k].push(d));
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  return { t, ev };
};
const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const scores4 = (b) => ({ aim: b.aim, cover: b.cover, survival: b.survival, adaptation: b.adaptation });

await check('learning (learnCfg): entrenar con lr 0,02 solo este entreno = entrenar una copia cuya lr es 0,02; la red guarda su 0,003', async () => {
  save('lr-a'); save('lr-b', { learning: { ...clone(TEMPLATES.sniper.genome.learning), gradient: { ...TEMPLATES.sniper.genome.learning.gradient, lr: 0.02 } } });
  await train('lr-a', 8, { learning: { gradient: { lr: 0.02 } } });
  await train('lr-b', 8);
  assert.deepEqual(store.loadNet('lr-a').weights, store.loadNet('lr-b').weights);
  assert.equal(store.loadNet('lr-a').learning.gradient.lr, 0.003);
});

await check('learning: una red de gradiente entrena este entreno por evolución (2 pasos) y sigue siendo de gradiente', async () => {
  save('ev-a');
  const { t } = await train('ev-a', 6, { learning: { method: 'evolution', evolution: { population: 2, gamesPerCandidate: 1 } } });
  assert.equal(t.steps, 2);
  assert.ok(logOf().filter((e) => e.type === 'update' && e.netId === 'ev-a').every((e) => e.kind === 'evolution'), 'sus sueños son de evolución');
  assert.equal(store.loadNet('ev-a').learning.method, 'gradient');
});

await check('programas: la temperatura y la tasa bajan en línea recta y cada lote juega y aprende con la temperatura de su comienzo', async () => {
  save('pg-a');
  const S = 4200, N = 24;
  const { t, ev } = await train('pg-a', N, { seed: S, schedule: { temperature: { shape: 'linear', from: 1.5, to: 0.5 }, lr: { shape: 'linear', to: 0.0003 } } });
  const lin = (from, to, p) => from + (to - from) * p;
  const want = Array.from({ length: 6 }, (_, i) => ({ temperature: lin(1.5, 0.5, (4 * i) / N), lr: lin(0.003, 0.0003, (4 * i) / N) }));
  assert.equal(ev.sleep.length, 6);
  ev.sleep.forEach((s, i) => {
    assert.ok(Math.abs(s.update.applied.temperature - want[i].temperature) < 1e-12, `sueño ${i}: T ${s.update.applied.temperature}`);
    assert.ok(Math.abs(s.update.applied.lr - want[i].lr) < 1e-12, `sueño ${i}: lr ${s.update.applied.lr}`);
  });
  // la partida 20 (lote 5, p = 20/24) se guardó de muestra: sus probabilidades son las del softmax con esa temperatura
  const meta = store.listGames({ netId: 'pg-a' }).find((m) => m.trainingId === t.id && m.seed === S + 20);
  assert.ok(meta, 'premisa: la partida 20 es de muestra');
  const game = store.loadGame(meta.gameId);
  const decisions = game.events.filter((e) => e.type === 'decision' && e.actor.netId === 'pg-a' && e.data.phase === 'shoot' && !e.data.truncated);
  assert.ok(decisions.length > 0, 'premisa: la red disparó');
  for (const d of decisions) {
    const p = softmaxT(d.data.candidates.map((c) => c.score), want[5].temperature);
    d.data.candidates.forEach((c, i) => assert.ok(Math.abs(c.p - p[i]) < 1e-9, `p ${c.p} ≠ ${p[i]}`));
  }
  assert.equal(store.loadNet('pg-a').traits.temperature, 1, 'la red conserva su temperatura');
});

await check('recompensa de práctica: rozar +0,5 solo este entreno = una copia con rozar 0,5; la red conserva pesos y estadísticas', async () => {
  const a0 = save('rw-a'); save('rw-b', { reward: { ...clone(TEMPLATES.sniper.genome.reward), graze: 0.5 } });
  const ra = await train('rw-a', 8, { reward: { graze: 0.5 } });
  const rb = await train('rw-b', 8);
  assert.deepEqual(store.loadNet('rw-a').weights, store.loadNet('rw-b').weights);
  assert.deepEqual(ra.t.curve.map((p) => p.reward), rb.t.curve.map((p) => p.reward));
  assert.deepEqual(store.loadNet('rw-a').reward, a0.reward, 'pesos y stats de antes');
});

await check('congelar solo en este entreno: el bloque d no cambia; los demás sí; los congelados de la red siguen como estaban', async () => {
  const g0 = save('fz-a');
  await train('fz-a', 8, { frozen: ['d'] });
  const g1 = store.loadNet('fz-a');
  assert.deepEqual(g1.weights.d, g0.weights.d);
  assert.notDeepEqual(g1.weights.ch, g0.weights.ch);
  assert.deepEqual(g1.frozen, g0.frozen);
});

await check('currículo: 3 partidas con 1 soldado y después con 2; eventos de inicio y de regla cumplida; resumen de lecciones', async () => {
  save('cu-a');
  const S = 4300;
  const { t, ev } = await train('cu-a', 21, { seed: S, curriculum: [{ name: 'Uno', soldiers: 1, until: { games: 3 } }, { name: 'Dos', soldiers: 2 }] });
  assert.deepEqual(ev.curriculum.map((e) => [e.reason, e.lesson, e.games]), [['start', 0, 0], ['met', 0, 3], ['start', 1, 3]]);
  assert.deepEqual(t.curriculum.map((x) => [x.name, x.from, x.to, x.met]), [['Uno', 0, 2, true], ['Dos', 3, null, false]]);
  const metas = store.listGames({ netId: 'cu-a' }).filter((m) => m.trainingId === t.id);
  assert.equal(metas.find((m) => m.seed === S).soldiers, 1);
  assert.equal(metas.find((m) => m.seed === S + 20).soldiers, 2);
  assert.ok(logOf().some((e) => e.type === 'curriculum' && e.netId === 'cu-a' && e.reason === 'met'));
});

await check('currículo: una regla de recompensa imposible de fallar se cumple justo al llegar al mínimo de partidas', async () => {
  save('cu-b');
  const { ev } = await train('cu-b', 8, { curriculum: [{ name: 'A', until: { reward: -1e9, window: 5, minGames: 5 } }, { name: 'B' }] });
  const met = ev.curriculum.find((e) => e.reason === 'met');
  assert.ok(met && met.games === 5, JSON.stringify(ev.curriculum));
});

await check('examen antes y después: los boletines de la red de antes y de la de después; el de después queda como su boletín', async () => {
  const g0 = save('ex-a');
  const before = scores4(await runBulletin(g0));
  const { t, ev } = await train('ex-a', 4, { exam: true });
  assert.deepEqual(t.exam.before, before);
  assert.deepEqual(t.exam.after, scores4(await runBulletin(store.loadNet('ex-a'))));
  assert.deepEqual(ev.exam.map((e) => e.when), ['before', 'after']);
  const file = join(store.netsDir(), 'ex-a', 'bulletin.json');
  assert.deepEqual(scores4(JSON.parse(readFileSync(file, 'utf8'))), t.exam.after);
});

await check('versión antes del entreno: se guarda la red tal como estaba y el entreno la cita', async () => {
  const g0 = save('vs-a');
  const { t } = await train('vs-a', 4);
  const list = store.listVersions('vs-a');
  assert.ok(list.length >= 1);
  const v = list.find((x) => x.n === t.versionBefore);
  assert.ok(v && v.trainingId === t.id && /antes del entreno/.test(v.reason), JSON.stringify(list));
  assert.deepEqual(store.loadVersion('vs-a', t.versionBefore).genome.weights, g0.weights);
  assert.equal(store.loadVersion('vs-a', 999), null);
});

await check('quedarse con la mejor: con menos de 20 partidas no hace nada y lo dice', async () => {
  save('kb-0');
  const { t } = await train('kb-0', 8, { keepBest: true });
  assert.deepEqual(t.keptBest, { restored: false, reason: 'menos de 20 partidas' });
});

await check('quedarse con la mejor: números sacados de la curva; si vuelve, sus pesos son los de un entreno igual que parase en ese momento', async () => {
  save('kb-r', {}, 'seer');
  const recipe = { reward: { win: -5, lose: 5, kill: -3, die: 3 }, learning: { gradient: { lr: 0.05 } } };
  const opp = { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'kb-r' };
  const rate = (curve, k) => curve.slice(k - 19, k + 1).reduce((s, p) => s + p.win, 0) / 20;
  let found = null;
  for (const seed of [4401, 4402, 4403, 4404, 4405]) {
    const id = `kb-${seed}`;
    save(id);
    const { t } = await train(id, 60, { seed, opponents: opp, keepBest: true, ...recipe });
    const kb = t.keptBest;
    let best = -1, at = -1;
    for (let k = 19; k < t.curve.length; k++) { const r = rate(t.curve, k); if (r > best) { best = r; at = k; } }
    const final = rate(t.curve, t.curve.length - 1);
    assert.deepEqual({ best: kb.best, final: kb.final, atGame: kb.atGame, restored: kb.restored }, { best, final, atGame: at, restored: final < best });
    if (kb.restored) { found = { seed, at, id }; break; }
  }
  assert.ok(found, 'premisa: en alguna de las 5 semillas la red acaba peor que su mejor momento (aprende a perder)');
  // oráculo: el mismo entreno sin keepBest que acaba con los lotes completos anteriores a esa partida
  const D = 4 * Math.floor(found.at / 4);
  save('kb-oraculo');
  await train('kb-oraculo', D, { seed: found.seed, opponents: opp, ...recipe });
  assert.deepEqual(store.loadNet(found.id).weights, store.loadNet('kb-oraculo').weights);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (receta de entreno en el entrenador)');
process.exitCode = fails ? 1 : 0;
