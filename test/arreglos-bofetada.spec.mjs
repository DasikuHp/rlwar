// Arreglo A1 (spec/04 §10.4; spec/revision-opus.md A1): bofetada y caricia con efecto inmediato.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-bofetada.spec.mjs http://localhost:8791
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body: json, text };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error(`tiempo agotado: ${what}`); };
const { compile } = await import('../shared/nn.js');
const { normalize } = await import('../shared/genome.js');
const { softmaxT } = await import('../shared/policy.js');

const mkNet = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };
const genomeOf = async (id) => (await api(`/api/lab/nets/${id}`)).body.genome;
const flat = (g) => Array.from(compile(g).getFlat());
// una exhibición guardada (spec/04 §10.3) donde juega la red: de ahí salen las decisiones que se abofetean
const playExhibition = async (netId, seed) => {
  const room = (await api('/api/rooms', 'POST', { name: 'bofetadas', soldiers: 2, seed })).body;
  await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId, team: 'left' });
  await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'sniper', level: 1, team: 'right' });
  await api(`/api/rooms/${room.code}/start`, 'POST', {});
  const st = await until(async () => { const s = (await api(`/api/rooms/${room.code}/state`)).body; return s.phase === 'over' ? s : null; }, 90000, 'exhibición');
  const gameId = `g-${st.config.seed}-${room.code}`;
  return (await until(async () => { const g = await api(`/api/lab/games/${gameId}`); return g.status === 200 ? g.body : null; }, 20000, 'partida guardada'));
};
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

let netId, game, shootEv;
await check('bofetada con la red quieta: paso inmediato sobre esa decisión (pBefore/pAfter exactos), recuerdo de vergüenza, nada pendiente', async () => {
  netId = await mkNet('seer', 'Bof Uno');
  game = await playExhibition(netId, 41);
  shootEv = game.events.find((e) => e.type === 'decision' && e.actor.netId === netId && e.data.phase === 'shoot' && !e.data.truncated);
  assert.ok(shootEv, 'hay una decisión de disparo de la red');
  const g0 = await genomeOf(netId);
  const p0 = pChosen(g0, game, shootEv);
  const r = await api(`/api/lab/nets/${netId}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: shootEv.id, amount: 1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.applied, true); assert.ok(r.body.reward < 0); assert.equal(r.body.kind, 'slap');
  assert.ok(near(r.body.update.pBefore, p0), `pBefore ${r.body.update.pBefore} ≠ ${p0}`);
  const g1 = await genomeOf(netId);
  assert.ok(flat(g1).some((v, i) => v !== flat(g0)[i]), 'la red cambió al momento');
  const p1 = pChosen(g1, game, shootEv);
  assert.ok(near(r.body.update.pAfter, p1), `pAfter ${r.body.update.pAfter} ≠ ${p1}`);
  assert.ok(p1 < p0, `tras la bofetada baja la probabilidad de lo que eligió (${p0} → ${p1})`);
  assert.ok(typeof r.body.update.relChange === 'number' && r.body.update.relChange > 0);
  const saved = (await api(`/api/lab/games/${game.meta.gameId}`)).body;
  const ev = saved.events.filter((e) => e.type === 'slap').pop();
  const ep = g1.memory.episodes.find((e) => e.outcome === 'slap');
  assert.ok(ep && ep.emotion === 'shame' && ep.ref.game === game.meta.gameId && ep.ref.id === ev.id && ep.intensity === Math.min(1, Math.abs(r.body.reward)), JSON.stringify(ep));
  const fb = (await api(`/api/lab/nets/${netId}/feedback`)).body;
  assert.deepEqual(fb.pending, []); assert.equal(fb.applied.length, 1);
  assert.ok(near(fb.applied[0].pBefore, p0) && near(fb.applied[0].pAfter, p1) && fb.applied[0].kind === 'slap');
});

await check('caricia sobre la misma decisión: sube la probabilidad y deja un recuerdo de orgullo', async () => {
  const g0 = await genomeOf(netId);
  const p0 = pChosen(g0, game, shootEv);
  const r = await api(`/api/lab/nets/${netId}/caress`, 'POST', { game: game.meta.gameId, decisionEventId: shootEv.id, amount: 2 });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.applied, true); assert.ok(r.body.reward > 0);
  const p1 = pChosen(await genomeOf(netId), game, shootEv);
  assert.ok(near(r.body.update.pBefore, p0) && near(r.body.update.pAfter, p1) && p1 > p0, `${p0} → ${p1}`);
  const ep = (await genomeOf(netId)).memory.episodes.find((e) => e.outcome === 'caress');
  assert.ok(ep && ep.emotion === 'pride' && ep.intensity === Math.min(1, Math.abs(r.body.reward)));
});

await check('también sobre una decisión de movimiento', async () => {
  const mv = game.events.find((e) => e.type === 'decision' && e.actor.netId === netId && e.data.phase === 'move' && !e.data.truncated);
  assert.ok(mv, 'hay una decisión de movimiento');
  const p0 = pChosen(await genomeOf(netId), game, mv);
  const r = await api(`/api/lab/nets/${netId}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: mv.id });
  assert.equal(r.status, 200, r.text);
  assert.ok(near(r.body.update.pBefore, p0) && r.body.update.pAfter < p0);
});

await check('decisión de otra red o de otro jugador → 400 con el motivo; la red no cambia', async () => {
  const other = await mkNet('sniper', 'Bof Ajena');
  const g0 = await genomeOf(other);
  const r = await api(`/api/lab/nets/${other}/slap`, 'POST', { game: game.meta.gameId, decisionEventId: shootEv.id });
  assert.equal(r.status, 400, r.text); assert.ok(r.body.error && r.body.error.length > 10);
  assert.deepEqual(flat(await genomeOf(other)), flat(g0));
});

await check('con la red entrenando: queda pendiente y el siguiente sueño la aplica', async () => {
  const id = await mkNet('seer', 'Bof Ocupada');
  const g = await playExhibition(id, 42);
  const ev = g.events.find((e) => e.type === 'decision' && e.actor.netId === id && e.data.phase === 'shoot' && !e.data.truncated);
  const tr = await api('/api/lab/trainings', 'POST', { netId: id, speed: 'turbo', workers: 1, duration: { games: 100000 }, soldiers: 1, seed: 3 });
  assert.equal(tr.status, 202, tr.text);
  try {
    const r = await api(`/api/lab/nets/${id}/slap`, 'POST', { game: g.meta.gameId, decisionEventId: ev.id });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.applied, false); assert.equal(r.body.queued, true);
    assert.equal((await api(`/api/lab/nets/${id}/feedback`)).body.pending.length, 1);
    const fb = await until(async () => { const f = (await api(`/api/lab/nets/${id}/feedback`)).body; return f.pending.length === 0 && f.applied.length === 1 ? f : null; }, 30000, 'el sueño aplica la bofetada');
    assert.ok(typeof fb.applied[0].pBefore === 'number' && fb.applied[0].pAfter < fb.applied[0].pBefore);
  } finally { await api(`/api/lab/trainings/${tr.body.id}/stop`, 'POST', {}); }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: bofetada y caricia)');
process.exitCode = fails ? 1 : 0;
