// F7 — Verdad (spec/07 §1–§12): verificador de frases y compositor, confianza, emoción, memoria episódica y
// recuerdo, boletín determinista, neuronas con nombre, eventos de recompensa/emoción, diario verificable,
// tope de eventos, retención y rotación del registro. Escrito ANTES del código y congelado.
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-verdad-'));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const clone = (v) => JSON.parse(JSON.stringify(v));

const { makeRng } = await import('../shared/rng.js');
const { newGenome, normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const store = await import('../evo/store.js');
const T = await import('../evo/truth.js');
const { runBulletin } = await import('../evo/exam.js');
const { Room } = await import('../server/rooms.js');
const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });

// partida fija g901: Hydra-7 (p1) contra Orca-2 (p2)
const P1 = { playerId: 'p1', soldierId: 's1', netId: 'hydra-7' }, P2 = { playerId: 'p2', soldierId: 's5', netId: 'orca-2' };
const ev = (id, turn, type, actor, data) => ({ id, t: 1000 + id, game: 'g901', turn, type, actor, data });
const GAME = [
  ev(1, 0, 'game.start', { playerId: null, soldierId: null, netId: null }, { seed: 4242, map: { name: '🏰 Fortaleza', biome: 'fortaleza' }, soldiers: 2, players: [{ playerId: 'p1', name: 'Hydra-7', netId: 'hydra-7', agentType: 'net', team: 'left' }, { playerId: 'p2', name: 'Orca-2', netId: 'orca-2', agentType: 'net', team: 'right' }] }),
  ev(88, 3, 'decision', P1, { phase: 'shoot', chosen: 2, margin: 0.4, candidates: [{ i: 0, family: 'line', score: 0.1, p: 0.2 }, { i: 1, family: 'sine', score: 0.3, p: 0.19 }, { i: 2, family: 'parabola', score: 0.82, p: 0.61 }], attribution: [{ blockId: 'map', name: 'Mapa', share: 0.6, drop: { from: 0.82, to: 0.4 } }], value: 0.35 }),
  ev(91, 3, 'shot', P1, { mode: 'ode2', expr: '-0.05', family: 'parabola', params: [0.05, 30, 0], angle: 30, result: { type: 'obstacle', soldierId: null }, minDist: 0.4, minAllyDist: 9, decisionEventId: 88 }),
  ev(92, 3, 'graze', P1, { soldierId: 's5', dist: 0.4, shotEventId: 91 }),
  ev(95, 4, 'shot', P2, { mode: 'function', expr: '0.3*x', family: 'line', params: [0.3, 0, 0], angle: 0, result: { type: 'kill', soldierId: 's2' }, minDist: 0, minAllyDist: 12, decisionEventId: 94 }),
  ev(96, 4, 'kill', P2, { victimSoldierId: 's2', victimPlayerId: 'p1', victimName: 'Hydra-7', shotEventId: 95 }),
  ev(97, 4, 'death', { playerId: 'p1', soldierId: 's2', netId: 'hydra-7' }, { killerSoldierId: 's5', killerPlayerId: 'p2', killerName: 'Orca-2', shotEventId: 95 }),
  ev(100, 5, 'shot', P1, { mode: 'function', expr: 'sin(x/5)*3', family: 'sine', params: [3, 5, 0], angle: 0, result: { type: 'kill', soldierId: 's6' }, minDist: 0, minAllyDist: 20, decisionEventId: 99 }),
  ev(101, 5, 'kill', P1, { victimSoldierId: 's6', victimPlayerId: 'p2', victimName: 'Orca-2', shotEventId: 100 }),
  ev(102, 5, 'death', { playerId: 'p2', soldierId: 's6', netId: 'orca-2' }, { killerSoldierId: 's1', killerPlayerId: 'p1', killerName: 'Hydra-7', shotEventId: 100 }),
  ev(110, 6, 'shot', P1, { mode: 'function', expr: '2*x', family: 'line', params: [2, 0, 0], angle: 0, result: { type: 'suicide', soldierId: 's3' }, minDist: 7, minAllyDist: 0.2, decisionEventId: 109 }),
  ev(111, 6, 'friendlyFire', P1, { victimSoldierId: 's3', victimPlayerId: 'p1', victimName: 'Hydra-7', shotEventId: 110 }),
  ev(120, 7, 'win', { playerId: 'p2', soldierId: null, netId: 'orca-2' }, { winner: 'right', killsLeft: 1, killsRight: 2, shots: 7, byLimit: false }),
  ev(121, 7, 'lose', { playerId: 'p1', soldierId: null, netId: 'hydra-7' }, { winner: 'right', killsLeft: 1, killsRight: 2, shots: 7, byLimit: false }),
];
const load = (ref) => (ref.game === 'g901' ? GAME.filter((e) => e.id === ref.id) : []);
const R = (id) => ({ game: 'g901', id });

await check('checkPhrase: 10 frases válidas pasan; número inventado, nombre inventado, #9 inexistente y ref a otra partida fallan con el missing correcto', () => {
  const valid = [
    { text: 'Dijiste #2 y fallaste por 0.4, Orca-2.', refs: [R(88), R(91), R(1)] },
    { text: 'Miraba sobre todo el Mapa (60 %): sin él, la #2 baja de 0.82 a 0.40.', refs: [R(88)] },
    { text: 'Rocé a Orca-2 a 0,4 de distancia.', refs: [R(92), R(1)] },
    { text: 'Orca-2 me mató en el turno 4 con 0.3*x.', refs: [R(95), R(96), R(97)] },
    { text: 'Toma, Orca-2: seno en el turno 5.', refs: [R(100), R(101)] },
    { text: 'Vergüenza: 2*x acabó en fuego amigo a 0.2 de mi soldado.', refs: [R(110), R(111)] },
    { text: 'Perdimos 1 a 2 en 7 disparos.', refs: [R(121)] },
    { text: 'Mapa Fortaleza, semilla 4242, 2 soldados por bando.', refs: [R(1)] },
    { text: 'Hydra-7 contra Orca-2.', refs: [R(1)] },
    { text: 'Elegí la parábola con un margen de 0.40 y valor 0.35.', refs: [R(88)] },
  ];
  for (const p of valid) { const r = T.checkPhrase(p, load); assert.ok(r.ok, `${p.text} → ${JSON.stringify(r.missing)}`); }
  let r = T.checkPhrase({ text: 'Dijiste #2 y fallaste por 0.7, Orca-2.', refs: [R(88), R(91), R(1)] }, load);
  assert.equal(r.ok, false); assert.deepEqual(r.missing, { numbers: ['0.7'], names: [] });
  r = T.checkPhrase({ text: 'Dijiste #2 y fallaste por 0.4, Tiburón-3.', refs: [R(88), R(91), R(1)] }, load);
  assert.equal(r.ok, false); assert.deepEqual(r.missing, { numbers: [], names: ['Tiburón-3'] });
  r = T.checkPhrase({ text: 'Dijiste #9 y fallaste por 0.4, Orca-2.', refs: [R(88), R(91), R(1)] }, load);
  assert.equal(r.ok, false); assert.deepEqual(r.missing, { numbers: ['#9'], names: [] });
  r = T.checkPhrase({ text: 'Dijiste #2 y fallaste por 0.4, Orca-2.', refs: [{ game: 'g902', id: 88 }, { game: 'g902', id: 91 }] }, load);
  assert.equal(r.ok, false); assert.deepEqual(r.missing, { numbers: ['#2', '0.4'], names: ['Orca-2'] });
  r = T.checkPhrase({ text: 'Fallé por 0.44.', refs: [R(91)] }, load);
  assert.equal(r.ok, false, 'dos decimales exigen 0.40, no 0.44');
  assert.ok(T.checkPhrase({ text: 'Sí. No. Vale, otra vez.', refs: [R(1)] }, load).ok, 'palabras comunes exentas');
  assert.ok(T.STOPWORDS.includes('Sí') && T.STOPWORDS.includes('Vale'));
});

await check('compose: rellena huecos con valor y ref, junta refs únicas y extrae números y nombres; rechaza huecos sin evento', () => {
  const c = T.compose('Lo que más cambió fue {name} {blockId} ({pct} %)', { name: { value: 'Instinto', ref: { log: 7 } }, blockId: { value: 'b3', ref: { log: 7 } }, pct: { value: 12.3, ref: { log: 7 } } });
  assert.equal(c.text, 'Lo que más cambió fue Instinto b3 (12.3 %)');
  assert.deepEqual(c.refs, [{ log: 7 }]); assert.deepEqual(c.numbers, ['12.3']); assert.deepEqual(c.names, ['Instinto']);
  const c2 = T.compose('{a} contra {b}', { a: { value: 'Hydra-7', ref: R(1) }, b: { value: 'Orca-2', ref: R(96) } });
  assert.deepEqual(c2.refs, [R(1), R(96)]); assert.deepEqual(c2.names, ['Hydra-7', 'Orca-2']);
  assert.throws(() => T.compose('Hola {x}', {}), /hueco sin evento: x/);
  assert.throws(() => T.compose('Hola {x}', { x: { value: 3 } }), /hueco sin evento: x/);
  const ph = T.phrase('say', 'hydra-7', c2, 5);
  assert.deepEqual({ ...ph, t: 0 }, { text: 'Hydra-7 contra Orca-2', refs: [R(1), R(96)], numbers: [], names: ['Hydra-7', 'Orca-2'], kind: 'say', netId: 'hydra-7', t: 0 });
  assert.ok(T.checkPhrase(ph, load).ok);
});

await check('confianza: certainty = margin, experience = (1 − e^(−games/50))·(0.5 + 0.5·acierto), niveles y probabilidad de hablar', () => {
  const rows = [
    { margin: 0.6, games: 50, recentShots: [1, 1, 1, 0], level: 'media' },
    { margin: 0.9, games: 400, recentShots: [1, 1, 1, 1, 1], level: 'veterana' },
    { margin: 0.2, games: 3, recentShots: [], level: 'novata' },
    { margin: 1.4, games: 0, recentShots: [0, 0], level: 'novata' },
  ];
  for (const r of rows) {
    const c = T.confidenceOf(r);
    const acc = r.recentShots.length ? r.recentShots.reduce((s, v) => s + v, 0) / r.recentShots.length : 0.5;
    const exp = (1 - Math.exp(-r.games / 50)) * (0.5 + 0.5 * acc);
    const cert = Math.min(1, Math.max(0, r.margin));
    assert.ok(near(c.certainty, cert) && near(c.experience, exp) && near(c.confidence, cert * exp), JSON.stringify(c));
    assert.equal(c.level, r.level); assert.ok(near(c.sayProbability, 0.2 + 0.6 * cert * exp));
  }
  const many = T.confidenceOf({ margin: 1, games: 1000, recentShots: Array.from({ length: 30 }, (_, i) => (i < 10 ? 0 : 1)) });
  assert.ok(near(many.experience, (1 - Math.exp(-20)) * 1), 'solo cuentan los últimos 20 tiros');
});

await check('emoción: hope = clamp(V), fear = clamp(−V), joy = tanh(A⁺), disappointment = tanh(A⁻), surprise = tanh(|A|); sin valor → 0', () => {
  let e = T.emotionOf({ V: 0.4, A: 0.3 });
  assert.deepEqual({ hope: e.hope, fear: e.fear, joy: e.joy, disappointment: e.disappointment, surprise: e.surprise }, { hope: 0.4, fear: 0, joy: Math.tanh(0.3), disappointment: 0, surprise: Math.tanh(0.3) });
  e = T.emotionOf({ V: -0.2, A: -1 });
  assert.deepEqual({ hope: e.hope, fear: e.fear, joy: e.joy, disappointment: e.disappointment, surprise: e.surprise }, { hope: 0, fear: 0.2, joy: 0, disappointment: Math.tanh(1), surprise: Math.tanh(1) });
  e = T.emotionOf({ V: 3, A: 0 });
  assert.equal(e.hope, 1); assert.equal(e.surprise, 0);
  e = T.emotionOf({ V: null, A: 0.5 });
  assert.equal(e.hope, 0); assert.equal(e.fear, 0); assert.equal(e.valueSource, 'none'); assert.ok(near(e.joy, Math.tanh(0.5)));
});

await check('memoria: episodios de la partida fija (orgullo, rencor, susto, vergüenza), rivales, tiros recientes, gamesAgo, recall por la fórmula, tope 300', () => {
  assert.deepEqual(T.memoryOf({ memory: [] }), { episodes: [], rivals: {}, recentShots: [] });
  assert.deepEqual(T.memoryOf({}), { episodes: [], rivals: {}, recentShots: [] });
  const rewards = { entries: [{ decision: { eventId: 88 }, effective: -0.3 }, { decision: { eventId: 99 }, effective: 1.8 }, { decision: { eventId: 109 }, effective: -1.5 }] };
  const mem = T.memoryOf({});
  mem.episodes.push({ ref: { game: 'g0', id: 1 }, rivalId: 'x', biome: 'llanura', family: 'line', outcome: 'kill', emotion: 'pride', intensity: 0.5, gamesAgo: 0 });
  T.updateMemory(mem, { netId: 'hydra-7', playerId: 'p1', events: GAME, rewards });
  assert.equal(mem.episodes[0].gamesAgo, 1, 'los viejos envejecen');
  const news = mem.episodes.slice(1);
  assert.deepEqual(news.map((e) => [e.outcome, e.emotion, e.intensity, e.ref.id]), [['graze', 'fear', 0.3, 92], ['death', 'grudge', 0.5, 97], ['kill', 'pride', 1, 101], ['friendlyFire', 'shame', 1, 111]]);
  assert.ok(news.every((e) => e.rivalId === 'orca-2' && e.biome === 'fortaleza' && e.gamesAgo === 0 && e.ref.game === 'g901'));
  assert.deepEqual(news.map((e) => e.family), ['parabola', 'line', 'sine', 'line']);
  assert.deepEqual(mem.rivals['orca-2'], { alias: null, games: 1, wins: 0, killsBy: 1, killsOf: 1, pride: 1, grudge: 1, respect: 1 });
  assert.deepEqual(mem.recentShots, [0, 1, 0]);
  const ctx = { rivalId: 'orca-2', biome: 'fortaleza', family: 'sine', outcome: 'kill' };
  const score = (e) => e.intensity * 0.9 ** e.gamesAgo * (1 + (e.rivalId === ctx.rivalId ? 1 : 0) + 0.5 * (e.biome === ctx.biome) + 0.5 * (e.family === ctx.family) + 0.5 * (e.outcome === ctx.outcome));
  const top = T.recall(mem, ctx);
  assert.equal(top.length, 3);
  const sorted = mem.episodes.slice().sort((a, b) => score(b) - score(a)).slice(0, 3);
  assert.deepEqual(top.map((e) => e.ref), sorted.map((e) => e.ref));
  assert.equal(top[0].ref.id, 101, 'el kill de seno contra orca-2 en fortaleza es el recuerdo más fuerte');
  const big = T.memoryOf({});
  for (let i = 0; i < 320; i++) big.episodes.push({ ref: { game: 'g', id: i }, rivalId: 'x', biome: 'b', family: 'line', outcome: 'kill', emotion: 'pride', intensity: (i % 10) / 10 + 0.05, gamesAgo: i % 7 });
  T.updateMemory(big, { netId: 'n', playerId: 'p1', events: [] });
  assert.equal(big.episodes.length, 300);
  const kept = big.episodes.map((e) => e.intensity * 0.9 ** e.gamesAgo);
  assert.ok(Math.min(...kept) >= 0.05 * 0.9 ** 7, 'se borran los de menor intensidad·0.9^gamesAgo');
});

await check('eventos de recompensa y emoción: continúan los ids y llevan los campos de spec/07 §1', () => {
  const events = GAME.slice(0, 3).map(clone);
  const rewards = { entries: [{ decision: { eventId: 88 }, terms: { graze: 0.1 }, own: 0.1, team: 0.05, effective: 0.075 }] };
  const n = T.rewardEvents(events, rewards, { playerId: 'p1', netId: 'hydra-7', tau: 0.5, normalized: false });
  assert.equal(n, 1); assert.equal(events.length, 4);
  const r = events[3];
  assert.equal(r.id, 92); assert.equal(r.type, 'reward'); assert.deepEqual(r.actor, { playerId: 'p1', soldierId: null, netId: 'hydra-7' });
  assert.deepEqual(r.data, { decisionEventId: 88, terms: { graze: 0.1 }, own: 0.1, team: 0.05, effective: 0.075, normalized: false, tau: 0.5 });
  assert.equal(r.game, 'g901'); assert.equal(r.turn, 3);
  T.emotionEvents(events, [{ decisionEventId: 88, ...T.emotionOf({ V: 0.35, A: 0.2 }) }], { playerId: 'p1', netId: 'hydra-7' });
  const e = events[4];
  assert.equal(e.id, 93); assert.equal(e.type, 'emotion'); assert.equal(e.data.decisionEventId, 88); assert.ok(near(e.data.hope, 0.35) && near(e.data.joy, Math.tanh(0.2)) && e.data.V === 0.35 && e.data.advantage === 0.2);
});

await check('diario: la lección, el hito, el reto y el examen se componen con plantilla fija y pasan checkPhrase contra el registro', () => {
  const entries = [
    { id: 1, ts: 5, type: 'lesson', netId: 'hydra-7', blockId: 'b3', name: 'Instinto', relChange: 0.123, bulb: true },
    { id: 2, ts: 6, type: 'milestone', netId: 'hydra-7', kind: 'winrate', value: 0.65, n: 20 },
    { id: 3, ts: 7, type: 'challenge', netId: 'hydra-7', challenger: 'hydra-7', queen: 'orca-2', result: 'challenger', duelId: 'd3' },
    { id: 4, ts: 8, type: 'exam', netId: 'hydra-7', aim: 0.425, cover: 0.5, survival: 0.35, adaptation: 0.8 },
    { id: 5, ts: 9, type: 'reign.start', netId: 'hydra-7', queen: 'hydra-7' },
  ];
  const loadLog = (ref) => (ref.log ? entries.filter((e) => e.id === ref.log) : []);
  for (const e of entries) {
    const ph = T.diaryPhrase(e);
    assert.ok(ph && typeof ph.text === 'string' && ph.text.length > 5 && ph.refs.some((r) => r.log === e.id), JSON.stringify(ph));
    const r = T.checkPhrase(ph, loadLog);
    assert.ok(r.ok, `${ph.text} → ${JSON.stringify(r.missing)}`);
  }
  assert.ok(/Instinto b3/.test(T.diaryPhrase(entries[0]).text) && /12\.3/.test(T.diaryPhrase(entries[0]).text));
});

await check('neuronas con nombre: una unidad igual a "mi x" recibe ese nombre; una suma de 58 entradas → "sin nombre claro"; pocas muestras → "sin datos"; el nombre del usuario manda', () => {
  const g = normalize(newGenome({ id: 'nombres-1', name: 'n', imagination: { n: 4 }, blocks: [B('f', 'eye.features'), B('r', 'eye.radar', { rays: 16 }), B('c', 'eye.candidates'), B('d', 'dense', { units: 2, activation: 'linear' }), B('cd', 'dense', { units: 3 }), B('ch', 'hand.choose')], wires: [W('f', 'd'), W('r', 'd'), W('d', 'cd'), W('c', 'cd'), W('cd', 'ch')] }, makeRng(1)));
  g.weights.d.W = g.weights.d.W.map(() => 0); g.weights.d.b = [0, 0];
  g.weights.d.W[0 * 2 + 0] = 1;                       // unidad 0 = entrada 0 ("mi x")
  for (let i = 0; i < 58; i++) g.weights.d.W[i * 2 + 1] = 0.2; // unidad 1 = suma de las 58 entradas (26 rasgos + 32 del radar): corr ≈ 0.13 con cada una
  const rng = makeRng(9);
  const samples = Array.from({ length: 1000 }, () => ({ obs: { ctx: { f: Float64Array.from({ length: 26 }, () => rng.gauss()), r: Float64Array.from({ length: 32 }, () => rng.gauss()) }, cand: { c: Array.from({ length: 4 }, () => Float64Array.from({ length: 12 }, () => rng.gauss())) }, move: {}, team: {} } }));
  const named = T.nameNeurons(g, samples);
  assert.equal(named.d[0].name, 'mi x'); assert.ok(named.d[0].corr > 0.99 && named.d[0].feature === 'mi x' && named.d[0].m === 1000, JSON.stringify(named.d[0]));
  assert.equal(named.d[1].name, 'sin nombre claro'); assert.ok(Math.abs(named.d[1].corr) <= 0.3);
  assert.ok(Array.isArray(named.cd) && named.cd.length === 3);
  const few = T.nameNeurons(g, samples.slice(0, 30));
  assert.equal(few.d[0].name, 'sin datos'); assert.equal(few.d[0].m, 30);
  const g2 = { ...g, names: { neurons: { d: { 1: 'la sumadora' } } } };
  assert.equal(T.nameNeurons(g2, samples).d[1].name, 'la sumadora');
});

await check('boletín: determinista (misma semilla → mismas puntuaciones) y Sniper L3 ≥ red vacía en puntería; formas y detalles', async () => {
  const empty = normalize(TEMPLATES.empty.genome);
  const a = await runBulletin(empty), b = await runBulletin(empty);
  assert.deepEqual(a, b, 'determinista');
  for (const k of ['aim', 'cover', 'survival', 'adaptation']) assert.ok(typeof a[k] === 'number' && a[k] >= 0 && a[k] <= 1, k);
  assert.equal(a.details.aim.length, 40); assert.equal(a.details.cover.length, 30); assert.equal(a.details.survival.length, 10);
  assert.deepEqual(Object.keys(a.details.adaptation).sort(), ['1', '2', '3', '4']);
  assert.ok(near(a.aim, a.details.aim.filter((x) => x.kill).length / 40));
  assert.deepEqual(a.seeds, { aim: 9001, cover: 9002, survival: 9003, adaptation: 9004 });
  const sniper = await runBulletin({ type: 'sniper', level: 3 });
  assert.ok(sniper.aim >= a.aim, `sniper ${sniper.aim} ≥ vacía ${a.aim}`);
  assert.ok(sniper.aim > 0.3, `un Sniper L3 acierta más del 30 % de blancos quietos (${sniper.aim})`);
});

await check('sala: tope de 5 000 eventos → error una vez y decisiones truncadas; graze en la sala real', () => {
  const room = new Room('tope', { soldiersPerPlayer: 1, seed: 1, headless: true });
  room.addAgent('sniper', { level: 3, team: 'left' }); room.addAgent('sniper', { level: 3, team: 'right' });
  room.start();
  const n0 = room.events.length;
  // relleno con eventos que no son de voz: say y 'frase no verificable' no cuentan para el tope (R5, spec/07 §12.1; cambio autorizado 2026-09-23)
  for (let i = n0; i < 5000; i++) room.emit('relleno', { playerId: null, soldierId: null, netId: null }, { text: 'relleno' });
  assert.equal(room.events.length, 5000);
  const id = room.emit('relleno', { playerId: null, soldierId: null, netId: null }, { text: 'uno más' });
  assert.ok(room.events.some((e) => e.type === 'error' && /tope/.test(e.data.message)), 'error de tope');
  const errors = room.events.filter((e) => e.type === 'error').length;
  room.emit('relleno', { playerId: null, soldierId: null, netId: null }, { text: 'y otro' });
  assert.equal(room.events.filter((e) => e.type === 'error').length, errors, 'el error se emite una sola vez');
  const s = room.soldiers[0];
  room.pushDecision({ phase: 'shoot', soldierId: s.id, chosen: 1, candidates: [{ i: 0 }, { i: 1 }], margin: 0.2 });
  const last = room.events[room.events.length - 1];
  assert.equal(last.type, 'decision'); assert.deepEqual(last.data, { phase: 'shoot', chosen: 1, chosenMove: null, truncated: true });
  assert.ok(Number.isInteger(id));
});

await check('retención: pruneGames deja 200 partidas por red (los duelos de trono no se borran); appendLog devuelve id y rota', () => {
  for (let i = 0; i < 205; i++) store.saveGame({ gameId: `t-${String(i).padStart(3, '0')}`, kind: 'training', nets: ['ret-a'], ts: 1000 + i }, [{ id: 1, type: 'game.start' }]);
  store.saveGame({ gameId: 'throne-1', kind: 'duel', throne: true, nets: ['ret-a', 'ret-b'], ts: 1 }, []);
  store.saveGame({ gameId: 'other-1', kind: 'training', nets: ['ret-b'], ts: 2 }, []);
  const removed = store.pruneGames('ret-a', 200);
  assert.equal(removed.length, 5); assert.deepEqual(removed.sort(), ['t-000', 't-001', 't-002', 't-003', 't-004']);
  assert.ok(!store.loadGame('t-000') && store.loadGame('t-005') && store.loadGame('throne-1') && store.loadGame('other-1'));
  assert.equal(store.pruneGames('ret-a', 200).length, 0);
  const ids = [store.appendLog({ type: 'lesson', netId: 'x' }), store.appendLog({ type: 'lesson', netId: 'x' })];
  assert.ok(Number.isInteger(ids[0]) && ids[1] === ids[0] + 1);
  const log = store.readLog();
  assert.ok(log.length >= 2 && log[log.length - 1].id === ids[1] && log[log.length - 1].type === 'lesson');
  for (let i = 0; i < 50; i++) store.appendLog({ type: 'relleno', pad: 'x'.repeat(100) }, { maxBytes: 2000 });
  assert.ok(existsSync(join(store.evoDir(), 'log.1.jsonl')), 'rotación a log.1.jsonl');
  assert.ok(statSync(join(store.evoDir(), 'log.jsonl')).size < 2000 + 400);
  const after = store.readLog();
  assert.ok(after.length < 52 && after.every((e) => Number.isInteger(e.id)));
});

if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\nverdad OK');
