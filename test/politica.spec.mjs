// F3 — Política, agente-red, almacén y sala (spec/03 §7, §9.2–§9.4). Escrito ANTES del código y
// congelado. La red juega como agente en una sala sin pantalla y en una sala viva (FAST).
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = await import('../shared/constants.js');
const { makeRng, gaussFrom } = await import('../shared/rng.js');
const { compile } = await import('../shared/nn.js');
const { repair, normalize, validate } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const P = await import('../shared/percept.js');
const pol = await import('../shared/policy.js');
const store = await import('../evo/store.js');
const registry = await import('../agents/registry.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');
const { slideMove } = await import('../shared/geometry.js');
const lib = await import('../agents/lib.js');

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });
const clone = (v) => JSON.parse(JSON.stringify(v));
const withId = (t, id) => ({ ...clone(TEMPLATES[t].genome), id, name: id });

function scene() {
  const mk = (id, ownerId, team, x, y, alive = true) => ({ id, ownerId, team, x, y, alive, lastExpr: '', turns: 1 });
  return {
    code: 'T', phase: 'playing',
    soldiers: [mk('me', 'p1', 'left', -10, 2), mk('a1', 'p1', 'left', -12, 3), mk('e1', 'p2', 'right', 5, 4), mk('e2', 'p2', 'right', 12, -6)],
    obstacles: [{ x: -2, y: 0, w: 2, h: 5 }],
    players: [{ id: 'p1', name: 'Yo', team: 'left', isBot: true, kills: 0, deaths: 0, alive: 2 }, { id: 'p2', name: 'Rival', team: 'right', isBot: true, kills: 0, deaths: 0, alive: 2 }],
    shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE },
  };
}
const softmaxRef = (s, T) => { const z = Array.from(s, (v) => v / T); const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const sum = e.reduce((a, b) => a + b, 0); return e.map((v) => v / sum); };
const logN = (a, mu, sd) => -0.5 * Math.log(2 * Math.PI * sd * sd) - (a - mu) ** 2 / (2 * sd * sd);

// ---------- softmax / muestreo ----------
await check('softmaxT y sampleIndex: probabilidades con temperatura y muestreo acumulado con el rng', () => {
  const s = Float64Array.from([2, 0.5, -1, 0]);
  const p1 = pol.softmaxT(s, 1), p2 = pol.softmaxT(s, 0.1), p3 = pol.softmaxT(s, 3);
  for (const p of [p1, p2, p3]) assert.ok(near(Array.from(p).reduce((a, b) => a + b, 0), 1, 1e-12));
  assert.ok(p2[0] > p1[0] && p1[0] > p3[0], 'temperatura baja = más decidida');
  const ref = softmaxRef(s, 1); for (let i = 0; i < 4; i++) assert.ok(near(p1[i], ref[i], 1e-12));
  const probs = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  for (let seed = 1; seed <= 30; seed++) {
    const r = makeRng(seed)(); let acc = 0, exp = 3;
    for (let i = 0; i < 4; i++) { acc += probs[i]; if (r <= acc) { exp = i; break; } }
    assert.equal(pol.sampleIndex(probs, makeRng(seed)), exp, `seed ${seed}`);
  }
  assert.equal(pol.sampleIndex(Float64Array.from([0.5, 0.5]), () => 0.999999999), 1);
  assert.equal(pol.sampleIndex(Float64Array.from([1]), () => 0.3), 0);
});

// ---------- decideShot ----------
await check('decideShot (Vidente): elección, margen, ajuste, valor, logp y determinismo; el rng se consume en el orden fijado', () => {
  const g = withId('seer', 'vidente-1'); const st = scene();
  const net = compile(g);
  const r = pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(7), attribution: true });
  const d = r.decision;
  assert.equal(d.phase, 'shoot'); assert.equal(d.soldierId, 'me'); assert.equal(d.netId, 'vidente-1'); assert.equal(typeof d.ms, 'number');
  assert.equal(d.candidates.length, 24);
  d.candidates.forEach((c, i) => {
    assert.equal(c.i, i); assert.ok(typeof c.score === 'number' && c.p >= 0 && c.p <= 1 && Array.isArray(c.points) && c.points.length >= 2 && c.points.length <= 100);
    assert.ok(c.sim && typeof c.sim.type === 'string' && typeof c.sim.minDist === 'number', 'la Vidente ve la simulación');
    assert.ok(typeof c.exprLocal === 'string' && typeof c.expr === 'string' && Array.isArray(c.params));
  });
  assert.ok(near(d.candidates.reduce((s, c) => s + c.p, 0), 1, 1e-9));
  // probabilidades = softmax(scores/temperature) de la red sobre la observación
  const obs = P.observe(st, 'me', g, { phase: 'shoot', cands: d.candidates.map((c) => ({ i: c.i, family: c.family, params: c.paramsBefore || c.params, mode: c.mode, exprLocal: c.exprLocal, expr: c.expr, angle: c.angle })) });
  const out = net.forward(obs, net.zeroState());
  const p = softmaxRef(out.outputs.choose.scores, g.traits.temperature);
  for (let i = 0; i < 24; i++) { assert.ok(near(d.candidates[i].score, out.outputs.choose.scores[i], 1e-9)); assert.ok(near(d.candidates[i].p, p[i], 1e-9)); }
  const rng = makeRng(7);
  assert.equal(d.chosen, pol.sampleIndex(Float64Array.from(p), rng), 'primero se muestrea el candidato');
  const others = p.filter((_, i) => i !== d.chosen);
  assert.ok(near(d.margin, p[d.chosen] - Math.max(...others), 1e-12));
  assert.ok(near(d.logp.choose, Math.log(p[d.chosen]), 1e-12));
  // ajuste: a_i = clip(mu_i + pulse·gauss, −3, 3), un gauss por parámetro, en orden
  const mu = out.outputs.adjust.mu[d.chosen];
  assert.equal(d.adjust.mu.length, 3);
  let logAdj = 0;
  for (let i = 0; i < 3; i++) {
    const a = Math.max(-3, Math.min(3, mu[i] + g.traits.pulse * gaussFrom(rng)));
    assert.ok(near(d.adjust.mu[i], mu[i], 1e-9)); assert.ok(near(d.adjust.sample[i], a, 1e-9), `sample ${i}`);
    logAdj += logN(a, mu[i], g.traits.pulse);
  }
  assert.ok(near(d.logp.adjust, logAdj, 1e-9));
  assert.equal(d.logp.move, null); assert.equal(d.moves, null); assert.equal(d.chosenMove, null);
  const chosen = d.candidates[d.chosen];
  assert.deepEqual(d.adjust.paramsBefore, chosen.params);
  const adj = P.applyAdjust({ ...chosen, params: chosen.params }, d.adjust.sample);
  assert.deepEqual(d.adjust.paramsAfter, adj.params); assert.equal(d.adjust.expr, adj.expr); assert.equal(d.adjust.exprLocal, adj.exprLocal);
  assert.equal(r.choice.expr, adj.expr); assert.equal(r.choice.mode, adj.mode); assert.equal(r.choice.family, chosen.family); assert.deepEqual(r.choice.params, adj.params);
  assert.equal(r.choice.angle, adj.mode === 'ode2' ? adj.angle : null);
  assert.ok(near(d.value, out.outputs.value, 1e-9)); assert.equal(d.attention, null);
  assert.ok(Array.isArray(d.attribution) && d.attribution.length === 3, 'un renglón por ojo (Rasgos, Candidatos, Simulador)');
  const shareSum = d.attribution.reduce((s, a) => s + a.share, 0);
  assert.ok(near(shareSum, 1, 1e-9) || d.attribution.every((a) => a.share === 0));
  for (const a of d.attribution) assert.ok(['f', 'c', 's'].includes(a.blockId) && typeof a.name === 'string' && typeof a.drop === 'number');
  assert.ok(r.memory && typeof r.memory === 'object');
  const r2 = pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(7), attribution: true });
  const strip = (x) => { const y = clone(x); delete y.ms; return y; };
  assert.deepEqual(strip(r2.decision), strip(d), 'determinista');
  assert.notEqual(pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(8) }).decision.chosen + '|' + JSON.stringify(pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(8) }).decision.adjust.sample), d.chosen + '|' + JSON.stringify(d.adjust.sample), 'otra semilla, otra elección o ajuste');
});

await check('decideShot (Francotirador, ciega): sin sim, sin ajuste, sin valor; puntos de todos los candidatos; sin atribución si no se pide', () => {
  const g = withId('sniper', 'sniper-1'); const net = compile(g);
  const r = pol.decideShot({ net, genome: g, state: scene(), soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(1) });
  const d = r.decision;
  assert.ok(d.candidates.every((c) => c.sim === null && c.points.length >= 2));
  assert.equal(d.adjust, null); assert.equal(d.logp.adjust, null); assert.equal(d.value, null); assert.equal(d.attribution, null);
  assert.equal(r.choice.expr, d.candidates[d.chosen].expr); assert.equal(r.choice.exprLocal, d.candidates[d.chosen].exprLocal);
  assert.ok(['function', 'ode1', 'ode2'].includes(r.choice.mode));
});

await check('decideShot: la temperatura del genoma cambia las probabilidades; equipo derecho dispara con la expresión mundo', () => {
  const g = withId('sniper', 'sniper-2'); const net = compile(g);
  const hot = { ...g, traits: { ...g.traits, temperature: 3 } }, cold = { ...g, traits: { ...g.traits, temperature: 0.05 } };
  const ph = pol.decideShot({ net, genome: hot, state: scene(), soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(1) }).decision.candidates.map((c) => c.p);
  const pc = pol.decideShot({ net, genome: cold, state: scene(), soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(1) }).decision.candidates.map((c) => c.p);
  assert.ok(Math.max(...pc) > Math.max(...ph), 'fría = más concentrada');
  const st = scene(); const right = st.soldiers.find((s) => s.id === 'e1');
  const r = pol.decideShot({ net, genome: g, state: st, soldierId: 'e1', memory: net.zeroState(), team: null, rng: makeRng(1) });
  const c = r.decision.candidates[r.decision.chosen];
  assert.equal(c.expr, P.localToWorldExpr(c.exprLocal, c.mode, 'right'));
  assert.equal(r.choice.expr, c.expr);
  assert.ok(right.team === 'right');
});

// ---------- decideMove ----------
await check('decideMove (Tortuga con ajuste): 9 destinos con probabilidades, ajuste de 0.5 u y re-deslizado; sin Pies → stay', () => {
  const g = withId('turtle', 'tortuga-1'); const net = compile(g); const st = scene();
  const shot = pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(3) });
  const r = pol.decideMove({ net, genome: g, state: st, soldierId: 'me', memory: shot.memory, team: null, rng: makeRng(4), shot: null });
  const d = r.decision;
  assert.equal(d.phase, 'move'); assert.equal(d.candidates, null); assert.equal(d.chosen, null); assert.equal(d.adjust, null);
  assert.equal(d.moves.length, 9);
  d.moves.forEach((m, i) => { assert.equal(m.i, i); assert.equal(m.stay, i === 0); assert.ok(typeof m.score === 'number' && m.p >= 0 && m.to && Number.isFinite(m.to.x)); });
  assert.ok(near(d.moves.reduce((s, m) => s + m.p, 0), 1, 1e-9));
  const obs = P.observe(st, 'me', g, { phase: 'move' });
  const out = net.forward(obs, shot.memory);
  const p = softmaxRef(out.outputs.move.scores, g.traits.temperature);
  const rng = makeRng(4);
  assert.equal(d.chosenMove, pol.sampleIndex(Float64Array.from(p), rng));
  for (let i = 0; i < 9; i++) assert.ok(near(d.moves[i].p, p[i], 1e-9));
  assert.ok(near(d.logp.move, Math.log(p[d.chosenMove]), 1e-12));
  const mu = out.outputs.move.mu[d.chosenMove];
  const a = [0, 1].map(() => 0); let logA = 0;
  for (let i = 0; i < 2; i++) { a[i] = Math.max(-3, Math.min(3, mu[i] + g.traits.pulse * gaussFrom(rng))); logA += logN(a[i], mu[i], g.traits.pulse); }
  assert.ok(near(d.moveAdjust.sample[0], a[0], 1e-9) && near(d.moveAdjust.sample[1], a[1], 1e-9));
  assert.ok(near(d.moveAdjust.mu[0], mu[0], 1e-9)); assert.ok(near(d.logp.moveAdjust, logA, 1e-9));
  const me = st.soldiers[0];
  const dest = d.moves[d.chosenMove].to;
  const localTarget = { x: dest.x + 0.5 * a[0], y: dest.y + 0.5 * a[1] };
  const slid = slideMove({ from: { x: me.x, y: me.y }, requested: localTarget, soldiers: st.soldiers, obstacles: st.obstacles, selfId: 'me' });
  assert.ok(near(r.move.x, slid.to.x, 1e-9) && near(r.move.y, slid.to.y, 1e-9), 'destino final = destino + 0.5·ajuste, deslizado');
  assert.ok(near(d.moveAdjust.to.x, r.move.x)); assert.equal(d.logp.choose, null); assert.equal(d.logp.adjust, null);
  const empty = withId('empty', 'vacia-1'); const ne = compile(empty);
  const rm = pol.decideMove({ net: ne, genome: empty, state: st, soldierId: 'me', memory: ne.zeroState(), team: null, rng: makeRng(1), shot: null });
  assert.equal(rm.move, 'stay'); assert.equal(rm.decision.moves, null); assert.equal(rm.decision.chosenMove, null);
  const noAdj = withId('sniper', 'sniper-3'); const nn2 = compile(noAdj);
  const r3 = pol.decideMove({ net: nn2, genome: noAdj, state: st, soldierId: 'me', memory: nn2.zeroState(), team: null, rng: makeRng(1), shot: null });
  assert.equal(r3.decision.moveAdjust, null); assert.equal(r3.decision.logp.moveAdjust, null);
  const chosenTo = r3.decision.moves[r3.decision.chosenMove].to;
  if (r3.decision.chosenMove === 0) assert.equal(r3.move, 'stay'); else assert.ok(near(r3.move.x, chosenTo.x) && near(r3.move.y, chosenTo.y));
});

await check('memoria y equipo: el estado avanza y se reutiliza; la lectura de equipo cambia la decisión; atribución por ojo', () => {
  const g = withId('turtle', 'tortuga-2'); const net = compile(g); const st = scene();
  const z = net.zeroState();
  const r1 = pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: z, team: null, rng: makeRng(1) });
  assert.ok(Array.from(r1.memory.g).some((v) => v !== 0), 'la GRU escribe');
  assert.ok(Array.from(z.g).every((v) => v === 0), 'el estado de entrada no se muta');
  const r2 = pol.decideShot({ net, genome: g, state: st, soldierId: 'me', memory: r1.memory, team: null, rng: makeRng(1) });
  assert.ok(r2.decision.candidates.some((c, i) => !near(c.score, r1.decision.candidates[i].score)), 'con memoria distinta, puntuaciones distintas');
  const tg = repair({ format: 1, id: 'equipo-1', name: 'Equipo', imagination: { n: 6 },
    blocks: [B('f', 'eye.features'), B('t', 'teamMemory', { units: 4 }), B('c', 'eye.candidates'), B('d', 'dense', { units: 4 }), B('ch', 'hand.choose')],
    wires: [W('f', 't'), W('t', 'd'), W('c', 'd'), W('d', 'ch')] }, makeRng(2)).genome;
  const tn = compile(tg);
  const a = pol.decideShot({ net: tn, genome: tg, state: st, soldierId: 'me', memory: tn.zeroState(), team: { t: Float64Array.from([0.9, -0.9, 0.5, 0.1]) }, rng: makeRng(1) });
  const b = pol.decideShot({ net: tn, genome: tg, state: st, soldierId: 'me', memory: tn.zeroState(), team: null, rng: makeRng(1) });
  assert.ok(a.decision.candidates.some((c, i) => !near(c.score, b.decision.candidates[i].score)), 'la memoria de equipo se lee');
  const obs = P.observe(st, 'me', tg, { phase: 'shoot', cands: a.decision.candidates.map((c) => ({ ...c })) });
  const att = pol.attribute(tn, obs, tn.zeroState(), a.decision.chosen, 'shoot');
  assert.deepEqual(att.map((x) => x.blockId), ['f', 'c']);
  assert.ok(att.every((x) => typeof x.drop === 'number' && x.share >= 0 && x.share <= 1));
  const pos = att.filter((x) => x.drop > 0).reduce((s, x) => s + x.share, 0);
  assert.ok(near(pos, 1, 1e-9) || att.every((x) => x.share === 0));
  const plain = P.observe(st, 'me', tg, { phase: 'shoot', cands: obs.candidates });
  const p0 = pol.softmaxT(tn.forward(plain, tn.zeroState()).outputs.choose.scores, tg.traits.temperature)[a.decision.chosen];
  const zeroed = { ...plain, ctx: { ...plain.ctx, f: new Float64Array(26) } };
  const pf = pol.softmaxT(tn.forward(zeroed, tn.zeroState()).outputs.choose.scores, tg.traits.temperature)[a.decision.chosen];
  assert.ok(near(att[0].drop, p0 - pf, 1e-9), 'drop = p con el ojo − p con el ojo tapado');
});

// ---------- almacén ----------
await check('store: guardar (validado, atómico), listar, cargar, borrar; ficheros rotos se ignoran con aviso', () => {
  const dir = store.netsDir();
  assert.ok(dir.startsWith(process.env.GW_EVO_DIR));
  const g = withId('seer', 'hydra-7');
  const r = store.saveNet(g);
  assert.deepEqual(r, { ok: true, id: 'hydra-7' });
  assert.ok(existsSync(join(dir, 'hydra-7.json')) && !readdirSync(dir).some((f) => f.includes('tmp')), 'fichero final sin temporales');
  const list = store.listNets();
  assert.equal(list.length, 1);
  const e = list[0];
  assert.equal(e.id, 'hydra-7'); assert.equal(e.name, 'hydra-7'); assert.ok(Number.isInteger(e.emblem) && e.traits.temperature === 1 && e.stats.games === 0 && e.generation === 0);
  assert.ok(e.paramCount > 0 && e.blocks === g.blocks.length && typeof e.updatedAt === 'number');
  assert.deepEqual(store.loadNet('hydra-7'), normalize(g));
  assert.equal(store.loadNet('nadie'), null);
  const bad = store.saveNet({ ...g, id: 'Mal Id' });
  assert.equal(bad.ok, false); assert.ok(bad.errors.some((x) => x.code === 'id'));
  assert.equal(store.listNets().length, 1);
  writeFileSync(join(dir, 'roto.json'), '{ esto no es json');
  writeFileSync(join(dir, 'invalido.json'), JSON.stringify({ ...g, id: 'invalido', blocks: 'nope' }));
  const l2 = store.listNets({ withWarnings: true });
  assert.equal(l2.nets.length, 1); assert.ok(l2.warnings.length === 2 && l2.warnings.every((w) => /roto|invalido/.test(w)));
  assert.equal(store.loadNet('roto'), null);
  const piece = repair({ format: 1, id: 'pieza-1', name: 'Pieza', blocks: [B('f', 'eye.features'), B('v', 'hand.value')], wires: [W('f', 'v')] }, makeRng(1)).genome;
  assert.equal(store.saveNet(piece).ok, true, 'una pieza sin Elegir se guarda (forPlay: false)');
  assert.equal(store.saveNet({ ...piece, id: 'pieza-2', name: 'Pieza 2' }).ok, true);
  assert.equal(store.deleteNet('pieza-1'), true); assert.equal(store.deleteNet('pieza-1'), false);
  assert.ok(!existsSync(join(dir, 'pieza-1.json')));
  store.saveNet({ ...g, name: 'Hydra renombrada' });
  assert.equal(store.loadNet('hydra-7').name, 'Hydra renombrada', 'guardar de nuevo sobreescribe');
});

// ---------- registro y agente-red ----------
await check('registry: las redes guardadas aparecen como net:<id>; createAgent por id o con genoma', () => {
  const list = registry.listAgents();
  assert.ok(list.some((a) => a.id === 'sniper') && list.some((a) => a.id === 'chaos'));
  const n = list.find((a) => a.id === 'net:hydra-7');
  assert.ok(n, 'la red está'); assert.equal(n.net, true); assert.equal(n.netId, 'hydra-7'); assert.equal(n.icon, '🧠'); assert.equal(n.name, 'Hydra renombrada');
  assert.ok(typeof n.description === 'string' && n.description.length > 5 && Number.isInteger(n.emblem));
  assert.ok(!list.some((a) => a.id === 'net:pieza-2'), 'las piezas sin Elegir no se listan como agentes');
  assert.equal(registry.agentMeta('net:hydra-7').id, 'net');
  const a = registry.createAgent('net:hydra-7');
  assert.equal(a.meta.id, 'net'); assert.equal(a.meta.netId, 'hydra-7'); assert.equal(a.meta.name, 'Hydra renombrada');
  const b = registry.createAgent('net', { netId: 'hydra-7', learn: true });
  assert.equal(b.meta.netId, 'hydra-7'); assert.equal(b.learn, true); assert.equal(a.learn, false);
  const c = registry.createAgent('net', { genome: withId('empty', 'vacia-9') });
  assert.equal(c.meta.netId, 'vacia-9');
  const d = registry.createAgent('net:no-existe');
  assert.equal(d.meta.id, 'net'); assert.equal(d.broken, true, 'una red que no existe no revienta al crearse');
});

await check('agents/net.js: chooseShot y chooseMove con el contrato de agentes; memoria por soldado; fallo → 0.1*x con decision.error', () => {
  const agent = registry.createAgent('net', { genome: withId('turtle', 'tortuga-3') });
  const st = scene(); const me = st.soldiers[0];
  const ctx = lib.contextFor(st.soldiers, st.obstacles, me);
  const shot = agent.chooseShot({ soldiers: st.soldiers, obstacles: st.obstacles, soldier: me, history: [], chat: [], temperature: 0, rng: makeRng(5), moveOptions: lib.moveOptions(ctx), state: st });
  assert.ok(['function', 'ode1', 'ode2'].includes(shot.mode) && typeof shot.expr === 'string' && Array.isArray(shot.params) && typeof shot.family === 'string' && typeof shot.exprLocal === 'string');
  assert.equal(shot.reason, ''); assert.equal(shot.decision.phase, 'shoot'); assert.equal(shot.decision.soldierId, 'me');
  assert.ok(Array.from(agent.memoryFor('me').g).some((v) => v !== 0), 'memoria escrita para este soldado');
  assert.ok(Array.from(agent.memoryFor('a1').g).every((v) => v === 0), 'el otro soldado tiene la suya a cero');
  const mv = agent.chooseMove({ soldiers: st.soldiers, obstacles: st.obstacles, soldier: me, shot: { result: { type: 'wall' }, points: [] }, moveOptions: lib.moveOptions(ctx), history: [], rng: makeRng(6), state: st });
  assert.ok(mv === 'stay' || (Number.isFinite(mv.x) && Number.isFinite(mv.y) && mv.decision && mv.decision.phase === 'move'));
  const broken = registry.createAgent('net', { genome: { format: 1, id: 'rota-1', name: 'Rota', blocks: [B('c', 'eye.candidates')], wires: [] } });
  const fb = broken.chooseShot({ soldiers: st.soldiers, obstacles: st.obstacles, soldier: me, history: [], rng: makeRng(1), moveOptions: [], state: st });
  assert.equal(fb.mode, 'function'); assert.equal(fb.expr, '0.1*x'); assert.ok(fb.decision && typeof fb.decision.error === 'string');
  assert.equal(broken.chooseMove({ soldiers: st.soldiers, obstacles: st.obstacles, soldier: me, shot: null, moveOptions: [], history: [], rng: makeRng(1), state: st }), 'stay');
});

// ---------- sala ----------
const headlessNet = (seed, netId, soldiers = 2, rival = 'sniper') => {
  const room = new Room('h', { soldiersPerPlayer: soldiers, seed, headless: true });
  const a = room.addAgent('net', { netId, team: 'left' });
  assert.ok(a.ok, a.error);
  room.addAgent(rival, { level: 3, team: 'right' });
  return room;
};
await check('sala sin pantalla: la red juega contra Sniper hasta el final; shotLog con familia y params; decisiones guardadas; determinista', () => {
  const trace = (seed) => {
    const room = headlessNet(seed, 'hydra-7');
    room.start();
    const p = room.players.find((x) => x.agentType === 'net');
    assert.equal(p.netId, 'hydra-7'); assert.equal(p.learn, false); assert.equal(p.name, 'Hydra renombrada');
    const out = [];
    for (let i = 0; i < 400 && room.phase === 'playing'; i++) { room.step(); out.push([room.lastShot.expr, room.lastShot.result.type, room.lastMove && room.lastMove.to.x]); }
    assert.equal(room.phase, 'over');
    return { out, room };
  };
  const { out, room } = trace(21);
  assert.deepEqual(out, trace(21).out, 'misma semilla, misma partida con la red');
  const netShots = room.shotLog.filter((s) => s.playerId === room.players.find((x) => x.agentType === 'net').id);
  assert.ok(netShots.length >= 1);
  for (const s of netShots) {
    assert.ok(['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild'].includes(s.family) && s.params.length === 3 && typeof s.minDist === 'number' && typeof s.stayed === 'boolean');
    assert.ok(typeof s.turn === 'number' && s.result && typeof s.result.type === 'string');
  }
  const sniperShots = room.shotLog.filter((s) => s.playerId !== netShots[0].playerId);
  assert.ok(sniperShots.every((s) => ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild'].includes(s.family)), 'los tiros del heurístico se clasifican');
  assert.ok(room.shotLog.length <= 40);
  assert.ok(room.decisions.length >= 2 && room.decisions.some((d) => d.phase === 'shoot') && room.decisions.some((d) => d.phase === 'move'));
  assert.ok(room.decisions.length <= 50);
  const snap = room.snapshot();
  assert.ok(snap.shotLog.length <= 16 && snap.shotLog.slice(0, -4).every((s) => s.points === undefined) && snap.shotLog.slice(-4).every((s) => Array.isArray(s.points)));
  assert.ok(snap.lastDecision && ['shoot', 'move'].includes(snap.lastDecision.phase) && snap.lastDecision.activationsSummary === undefined);
  assert.deepEqual(Object.keys(snap.stats).sort(), ['remaps', 'shots', 'shotsNoKill']);
  assert.ok(snap.soldiers.every((s) => typeof s.turns === 'number') && snap.soldiers.some((s) => s.turns > 0));
  assert.equal(snap.players.find((p) => p.agentType === 'net').netId, 'hydra-7');
});

await check('sala: addAgent("net:<id>"), 1..4 soldados con memoria por soldado, learn, y playGame con una red', () => {
  const room = new Room('h', { soldiersPerPlayer: 3, seed: 5, headless: true });
  assert.ok(room.addAgent('net:hydra-7', { team: 'left', learn: true }).ok);
  room.addAgent('chaos', { level: 1, team: 'right' });
  room.start();
  const p = room.players.find((x) => x.agentType === 'net');
  assert.equal(p.learn, true);
  for (let i = 0; i < 6 && room.phase === 'playing'; i++) room.step();
  const agent = room.agents[p.id];
  assert.ok(agent && typeof agent.memoryFor === 'function');
  const bad = room.addAgent('net:no-existe', { team: 'left' });
  assert.ok(bad.error, 'red inexistente → error en la sala');
  const g = playGame({ seed: 77, left: { type: 'net', netId: 'hydra-7' }, right: { type: 'greedy' }, soldiers: 1 });
  assert.ok(g.result && typeof g.result.shots === 'number' && g.result.shots > 0);
  assert.deepEqual(g.result, playGame({ seed: 77, left: { type: 'net', netId: 'hydra-7' }, right: { type: 'greedy' }, soldiers: 1 }).result);
});

await check('sala viva (FAST): evento SSE decision antes de shot y antes de move; players[].netId en el snapshot', async () => {
  const room = new Room('viva', { soldiersPerPlayer: 1, seed: 1 });
  room.addAgent('net', { netId: 'hydra-7', team: 'left' });
  room.addAgent('chaos', { level: 1, team: 'right' });
  const events = [];
  room.listeners.add({ write: (chunk) => { const m = /^event: (\w+)/.exec(chunk); if (m) events.push({ ev: m[1], data: chunk }); } });
  room.start();
  const t0 = Date.now();
  while (Date.now() - t0 < 12000 && events.filter((e) => e.ev === 'decision').length < 2) await sleep(40);
  room.gameOver(true);
  const seq = events.map((e) => e.ev);
  const iDec = seq.indexOf('decision'), iShot = seq.indexOf('shot');
  assert.ok(iDec >= 0 && iShot > iDec, `decision antes de shot: ${seq.slice(0, 12).join(',')}`);
  const moveIdx = seq.indexOf('move');
  const decBefore = seq.slice(iShot, moveIdx).filter((e) => e === 'decision').length;
  assert.ok(moveIdx > iShot && decBefore >= 1, 'una decisión de fase move entre shot y move');
  const first = JSON.parse(events[iDec].data.split('\n')[1].slice(6)).decision;
  assert.equal(first.phase, 'shoot'); assert.ok(first.candidates.length === 24 && first.activationsSummary && typeof first.activationsSummary === 'object');
  assert.ok(room.snapshot().players.some((p) => p.netId === 'hydra-7'));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (política F3)');
process.exit(fails ? 1 : 0);
