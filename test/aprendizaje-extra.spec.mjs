// F4 — Aprendizaje, casos que la prueba de mutantes mostró sin cubrir en aprendizaje.spec y politica.spec
// (congelados): valores exactos de la media/varianza móvil y el tope 500, τ por defecto, trayectoria ausente,
// borde de "casi fuego amigo" (1.5 u), ventana de 10 tiros de "repetir", cobertura sin ganancia,
// almacén: carpeta anidada, aviso con el mensaje real y borrado con id inválido; entrenador: recorte exacto,
// atribución por bloque, congelado no-primero, evolución acotada y antitética, gameSummary, minutes y plateau.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'gw-evo-extra-'));
process.env.GW_EVO_DIR = TMP;

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const { DEFAULT_REWARD, validate } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const R = await import('../shared/reward.js');
const store = await import('../evo/store.js');

const RW = { ...DEFAULT_REWARD, kill: 1, die: -1, friendlyFire: -1.5, graze: 0.1, win: 2, lose: 0, survive: 0.5, cover: 0.3, repeatExpr: -0.2, nearFriendly: -0.4, normalize: false, grazeRadius: 2 };
const ev = (id, type, actor, data = {}) => ({ id, t: id, game: 'g', turn: 0, type, actor, data });
const P1 = { playerId: 'p1', netId: 'n', soldierId: 's1' };
const step = (turn, phase, eventId) => ({ turn, phase, obs: null, decision: { eventId, phase, soldierId: 's1', chosen: 0, chosenMove: 0, logp: {} } });

// Una partida con k tiros del mismo soldado: decisión 2k, tiro 2k+1; sin evento de fin (así no entra 'sobrevivir')
function shotsGame(shots) {
  const events = [ev(1, 'game.start', { playerId: null }, {})];
  const steps = [];
  shots.forEach((s, k) => {
    const d = 2 * k + 2;
    events.push(ev(d, 'decision', P1, { phase: 'shoot' }));
    events.push(ev(d + 1, 'shot', P1, { expr: s.expr, result: { type: s.type || 'wall' }, minDist: s.minDist ?? 9, minAllyDist: s.minAllyDist ?? 30, decisionEventId: d }));
    steps.push(step(k + 1, 'shoot', d));
  });
  return { events, trajectory: { netId: 'n', soldiers: { s1: steps } } };
}
const termsOf = (r) => Object.fromEntries(r.entries.map((e) => [e.decision.eventId, e.terms]));

check('normalizeStats: media y varianza móviles exactas (α = 1/n) y tope α = 1/500', () => {
  const st = {};
  R.normalizeStats(st, 'x', 1); assert.deepEqual(st.x, { n: 1, mean: 1, var: 0 });
  R.normalizeStats(st, 'x', 3); assert.ok(near(st.x.mean, 2) && near(st.x.var, 1), `tras [1,3]: ${JSON.stringify(st.x)}`);
  R.normalizeStats(st, 'x', 5); assert.ok(near(st.x.mean, 3) && near(st.x.var, 8 / 3), `tras [1,3,5]: ${JSON.stringify(st.x)}`);
  const s2 = {};
  for (let i = 0; i < 500; i++) R.normalizeStats(s2, 'y', 0);
  R.normalizeStats(s2, 'y', 500);
  assert.ok(near(s2.y.mean, 1), `el valor 501 pesa 1/500 exacto: media ${s2.y.mean}`);
  R.normalizeStats(s2, 'y', 0);
  assert.ok(near(s2.y.mean, 1 - 1 / 500), `y el 502 también: ${s2.y.mean}`);
});

check('normalizeStats: el valor nº 20 sale crudo y el nº 21 ya normalizado; sin stats usa reward.stats o uno nuevo', () => {
  const st = {};
  for (let i = 1; i <= 20; i++) assert.equal(R.normalizeStats(st, 'z', 5), 5, `valor nº ${i} crudo`);
  assert.ok(near(R.normalizeStats(st, 'z', 5), 50, 1e-6), 'el 21 se divide por σ mínima 0.1');
  const { events, trajectory } = shotsGame([{ expr: 'A', type: 'kill' }]);
  const own = R.assignRewards({ reward: { ...RW, normalize: true }, teamSpirit: 0, events, trajectory, playerId: 'p1' });
  assert.ok(own.stats && own.stats.kill && own.stats.kill.n === 1, 'sin stats ni reward.stats: crea uno');
  const shared = {};
  R.assignRewards({ reward: { ...RW, normalize: true, stats: shared }, teamSpirit: 0, events, trajectory, playerId: 'p1' });
  assert.equal(shared.kill.n, 1, 'usa reward.stats si existe');
});

check('assignRewards: roce justo en el radio (inclusive); cubrirse con ganancia 1', () => {
  const g = shotsGame([{ expr: 'A', minDist: 2 }, { expr: 'B', minDist: 2.01 }]);
  const t = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, ...g, playerId: 'p1' }));
  assert.deepEqual(t[2], { graze: 0.1 }); assert.deepEqual(t[4], {});
  const events = [ev(1, 'game.start', { playerId: null }, {}), ev(2, 'decision', P1, { phase: 'move' }), ev(3, 'move', P1, { coverBefore: 1, coverAfter: 0, decisionEventId: 2 })];
  const trajectory = { netId: 'n', soldiers: { s1: [step(1, 'move', 2)] } };
  const tm = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, events, trajectory, playerId: 'p1' }));
  assert.ok(near(tm[2].cover, 0.3), JSON.stringify(tm));
});

check('assignRewards: τ por defecto = 0.5; sin trayectoria (null o sin soldados) no hay entradas', () => {
  const { events, trajectory } = shotsGame([{ expr: 'A', type: 'kill' }, { expr: 'B' }]);
  const r = R.assignRewards({ reward: RW, events, trajectory, playerId: 'p1' });
  const mean = (1 + 0) / 2;
  assert.equal(r.entries.length, 2);
  for (const e of r.entries) assert.ok(near(e.effective, 0.5 * e.own + 0.5 * mean), `τ por defecto: ${e.effective} propia ${e.own}`);
  assert.deepEqual(R.assignRewards({ reward: RW, events, trajectory: null, playerId: 'p1' }).entries, []);
  assert.deepEqual(R.assignRewards({ reward: RW, events, trajectory: { netId: 'n' }, playerId: 'p1' }).entries, []);
  assert.deepEqual(R.assignRewards({ reward: RW, events, playerId: 'p1' }).entries, []);
});

check('assignRewards: casi fuego amigo exactamente a 1.5 u (inclusive), no a 1.6; nunca si fue suicidio', () => {
  const g = shotsGame([{ expr: 'A', minAllyDist: 1.5 }, { expr: 'B', minAllyDist: 1.6 }, { expr: 'C', minAllyDist: 0.2, type: 'suicide' }, { expr: 'D', minAllyDist: 0 }]);
  const t = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, ...g, playerId: 'p1' }));
  assert.deepEqual(t[2], { nearFriendly: -0.4 });
  assert.deepEqual(t[4], {});
  assert.deepEqual(t[6], { friendlyFire: -1.5 });
  assert.deepEqual(t[8], { nearFriendly: -0.4 });
});

check('assignRewards: "repetir" mira exactamente los 10 tiros anteriores del jugador', () => {
  const others = Array.from({ length: 10 }, (_, i) => ({ expr: `o${i}` }));
  const g11 = shotsGame([{ expr: 'X' }, ...others, { expr: 'X' }]);          // X, 10 distintos, X → X queda fuera de la ventana
  const t11 = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, ...g11, playerId: 'p1' }));
  assert.deepEqual(t11[2 * 11 + 2], {}, 'a 11 tiros de distancia no cuenta');
  const g10 = shotsGame([{ expr: 'X' }, ...others.slice(0, 9), { expr: 'X' }]); // X, 9 distintos, X → sí está entre los 10 últimos
  const t10 = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, ...g10, playerId: 'p1' }));
  assert.deepEqual(t10[2 * 10 + 2], { repeatExpr: -0.2 }, 'a 10 tiros de distancia sí cuenta');
  assert.deepEqual(t10[2], {}, 'el primer X no se penaliza');
});

check('assignRewards: cubrirse solo con ganancia; cobertura 0 → 0 o ausente no da nada', () => {
  const events = [
    ev(1, 'game.start', { playerId: null }, {}),
    ev(2, 'decision', P1, { phase: 'move' }), ev(3, 'move', P1, { coverBefore: 0, coverAfter: 0, decisionEventId: 2 }),
    ev(4, 'decision', P1, { phase: 'move' }), ev(5, 'move', P1, { decisionEventId: 4 }),
    ev(6, 'decision', P1, { phase: 'move' }), ev(7, 'move', P1, { coverBefore: 3, coverAfter: 1, decisionEventId: 6 }),
    ev(8, 'draw', { playerId: null }, {}),
  ];
  const trajectory = { netId: 'n', soldiers: { s1: [step(1, 'move', 2), step(2, 'move', 4), step(3, 'move', 6)] } };
  const t = termsOf(R.assignRewards({ reward: RW, teamSpirit: 0, events, trajectory, playerId: 'p1' }));
  assert.deepEqual(t[2], {}); assert.deepEqual(t[4], {});
  assert.ok(t[6].cover !== undefined && near(t[6].cover, 0.6));
});

check('store: crea la carpeta anidada; el aviso lleva el mensaje real de validación; borrar con id inválido → false', () => {
  process.env.GW_EVO_DIR = join(TMP, 'a', 'b');
  const nested = store.netsDir();
  assert.ok(existsSync(nested) && nested.startsWith(join(TMP, 'a', 'b')), nested);
  process.env.GW_EVO_DIR = TMP;
  const dir = store.netsDir();
  const g = { ...JSON.parse(JSON.stringify(TEMPLATES[Object.keys(TEMPLATES)[0]].genome)), id: 'buena-1', name: 'Buena' };
  assert.ok(store.saveNet(g).ok);
  const raw = JSON.stringify({ format: 1, id: 'sin-bloques', name: 'Sin bloques' });
  writeFileSync(join(dir, 'sin-bloques.json'), raw);
  const expected = validate(raw).errors[0].message;
  assert.ok(expected && typeof expected === 'string');
  const { nets, warnings } = store.listNets({ withWarnings: true });
  assert.equal(nets.length, 1);
  assert.deepEqual(warnings, [`sin-bloques.json: ${expected}`]);
  assert.equal(store.loadNet('sin-bloques'), null);
  assert.equal(store.deleteNet('Mal Id'), false);
  assert.equal(store.deleteNet('../buena-1'), false);
  assert.equal(store.deleteNet(''), false);
  assert.equal(store.listNets().length, 1, 'un id inválido no borra nada');
  assert.equal(store.deleteNet('buena-1'), true);
});


// ---------- evo/train.js: huecos que destapó la prueba de mutantes ----------
const { compile } = await import('../shared/nn.js');
const { normalize } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const T = await import('../evo/train.js');
const paramRanges = (net) => { const out = {}; let off = 0; for (const p of net.paramList()) { (out[p.blockId] ||= []).push([off, off + p.array.length]); off += p.array.length; } return out; };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; } };
const norm2 = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

check('applyUpdate: el recorte escala todos los gradientes (‖Δθ‖ = lr·clipNorm); perBlock atribuye a su bloque exacto; congelado que no es el primero', () => {
  const g = normalize(TEMPLATES.sniper.genome);
  const net = compile(g); const before = net.getFlat();
  const r = T.applyUpdate(net, Float64Array.from(before, () => 1), T.adamInit(net), { lr: 0.1, clipNorm: 1, optimizer: 'sgd', frozen: [] });
  assert.equal(r.clipped, true);
  const delta = Array.from(net.getFlat(), (v, i) => v - before[i]);
  assert.ok(near(norm2(delta), 0.1, 1e-9), `‖Δθ‖ = ${norm2(delta)} (esperado 0.1)`);
  const n2 = compile(g); const b2 = n2.getFlat(); const ranges = paramRanges(n2);
  const grads = new Float64Array(b2.length);
  for (const [lo, hi] of ranges.md) for (let i = lo; i < hi; i++) grads[i] = 1;
  const r2 = T.applyUpdate(n2, grads, T.adamInit(n2), { lr: 0.1, clipNorm: 1e9, optimizer: 'sgd', frozen: [] });
  assert.ok(r2.perBlock.md.relChange > 0, 'md cambia');
  for (const id of Object.keys(r2.perBlock)) if (id !== 'md') assert.equal(r2.perBlock[id].relChange, 0, `${id} no debe cambiar`);
  assert.equal(r2.top.blockId, 'md');
  const last = g.blocks[g.blocks.length - 1].id;
  const n3 = compile({ ...g, frozen: [last] }); const b3 = n3.getFlat();
  T.applyUpdate(n3, Float64Array.from(b3, () => 1), T.adamInit(n3), { lr: 0.1, clipNorm: 1e9, optimizer: 'sgd', frozen: [last] });
  const a3 = n3.getFlat(); const rg = paramRanges(n3);
  for (const [lo, hi] of rg[last]) for (let i = lo; i < hi; i++) assert.equal(a3[i], b3[i], `congelado ${last} intacto`);
  for (const [lo, hi] of rg.d) for (let i = lo; i < hi; i++) assert.ok(near(a3[i], b3[i] - 0.1, 1e-12), 'd se mueve');
});

check('evolutionStep: perturbaciones acotadas (≤ 5.5σ) y, con fitness = Σθ, la suma de pesos sube en 10 semillas (parejas antitéticas)', () => {
  const g = normalize(TEMPLATES.sniper.genome);
  for (let seed = 1; seed <= 10; seed++) {
    const net = compile(g); const base = net.getFlat(); let maxDev = 0;
    const fit = (theta) => { for (let i = 0; i < theta.length; i++) maxDev = Math.max(maxDev, Math.abs(theta[i] - base[i])); return theta.reduce((s, v) => s + v, 0); };
    T.evolutionStep(net, fit, { population: 16, sigma: 0.1, lr: 0.05, antithetic: true, rankNormalize: true, frozen: [] }, makeRng(seed));
    assert.ok(maxDev <= 0.55, `desvío máximo ${maxDev} > 5.5σ`);
    const after = net.getFlat();
    const sumDelta = Array.from(after).reduce((s, v, i) => s + (v - base[i]), 0);
    assert.ok(sumDelta > 0, `semilla ${seed}: Σθ bajó (${sumDelta})`);
  }
});

check('gameSummary: victoria 1/0 y recuentos de kills y muertes del jugador', () => {
  const ev = (type, playerId) => ({ type, actor: { playerId } });
  const res = { result: { winner: 'left' }, events: [ev('kill', 'p1'), ev('kill', 'p2'), ev('death', 'p1'), ev('kill', 'p1'), ev('win', 'p1'), ev('lose', 'p2')], trajectories: {} };
  assert.deepEqual(T.gameSummary(res, 'p1'), { result: res.result, events: res.events, trajectories: {}, kills: 2, deaths: 1, win: 1 });
  assert.deepEqual(T.gameSummary(res, 'p2'), { result: res.result, events: res.events, trajectories: {}, kills: 1, deaths: 0, win: 0 });
  assert.equal(T.gameSummary({ result: null, events: [], trajectories: {} }, 'p1').win, 0);
});

await checkAsync('createTrainer: minutes largo no para antes que games; plateau con ventana 2 para exactamente en la 4ª partida', async () => {
  const save = (key, id) => { const r = store.saveNet({ ...JSON.parse(JSON.stringify(TEMPLATES[key].genome)), id, name: id }); assert.ok(r.ok); };
  save('sniper', 'ex-a'); save('sniper', 'ex-b'); save('sniper', 'ex-r');
  const base = (netId, duration) => ({ netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: 'ex-r' }, speed: 'turbo', workers: 1, duration, soldiers: 1, seed: 3 });
  const t1 = T.createTrainer(base('ex-a', { games: 3, minutes: 10 }));
  let reason = null; t1.on('done', (d) => { reason = d.reason; });
  await t1.start();
  assert.equal(t1.status, 'done'); assert.equal(t1.games, 3); assert.equal(reason, 'games');
  const t2 = T.createTrainer(base('ex-b', { plateau: { window: 2, minGain: 1000 } }));
  reason = null; t2.on('done', (d) => { reason = d.reason; });
  await t2.start();
  assert.equal(t2.status, 'done'); assert.equal(reason, 'plateau'); assert.equal(t2.games, 4, `para en la 4ª partida (2 ventanas de 2): ${t2.games}`);
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\naprendizaje-extra OK');
