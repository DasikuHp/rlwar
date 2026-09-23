// Huecos de mutantes del arreglo A3 (spec/07 §13.2; spec/mutantes.md, "R2–R5"): `arreglos-voz` comprueba que lo que
// dicen las redes verifica, pero no QUÉ dicen ni CUÁNDO. Aquí, con eventos hechos a mano: (1) la lista exacta de frases
// candidatas de cada momento según nivel y hechos (la favorita, la segunda, el ojo que más pesa, la simulación, las
// distancias redondeadas, los recuerdos), y (2) en la sala: de dónde salen los eventos de una ref, qué se registra al
// hablar, el sorteo con makeRng(hash32(semilla, clave)), el presupuesto de una frase por turno, la presentación con
// recuerdo y quién habla tras cada disparo. Congelado. Uso: node test/arreglos-voz-extra.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-voz-extra-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng, hash32 } = await import('../shared/rng.js');
const { confidenceOf } = await import('../evo/truth.js');
const voice = await import('../evo/voice.js');
const store = await import('../evo/store.js');
const { Room } = await import('../server/rooms.js');

// ---------- (1) qué dice cada momento ----------
// todas las frases candidatas, en orden: speak elige lines[floor(rng·n) mod n]; con rng = (k + ½)/840 se recorren todas (n ≤ 8)
const lines = (moment, ctx) => {
  const out = [];
  for (let k = 0; k < 840; k++) {
    const r = voice.speak(moment, ctx, () => (k + 0.5) / 840);
    if (r === null) return null;
    const s = `${r.kind}|${r.text}`;
    if (out[out.length - 1] !== s) out.push(s);
  }
  return out;
};
const G = 'gv';
const start = { game: G, id: 1, type: 'game.start', data: { map: { name: '🏜️ Dunas', biome: 'desierto' } } };
// favorita #1 (0.45) en medio de la lista; elegida #2 (0.30), con la simulación diciendo que mata; ojos: el que más pesa, en medio
const dec = { game: G, id: 5, type: 'decision', data: { phase: 'shoot', chosen: 2, candidates: [{ i: 0, p: 0.10, family: 'line' }, { i: 1, p: 0.45, family: 'sine' }, { i: 2, p: 0.30, family: 'parabola', sim: { type: 'kill' } }, { i: 3, p: 0.15, family: 'wild' }], attribution: [{ name: 'Radar', share: 0.2 }, { name: 'Mapa', share: 0.5 }, { name: 'Brújula', share: 0.1 }, { name: 'Oído', share: 0 }] } };
const decBest = { ...dec, id: 6, data: { ...dec.data, chosen: 1 } }; // elige la favorita (sin simulación)
const decNoEye = { ...dec, id: 7, data: { ...dec.data, attribution: [{ name: 'Radar', share: 0 }, { name: 'Mapa', share: 0 }] } };
const ctx = (level, events, extra = {}) => ({ character: 'frio', level, confidence: null, rivalName: '🎯 Sniper', events: { start, ...events }, ...extra });

await check('presentación: mapa y rival sin emoji; recuerdos solo de muertes con autor y bajas con víctima; sin mapa, solo las frases que no lo usan; sin start, nada', () => {
  const recall = [
    { game: 'g-old', id: 7, type: 'death', data: { killerName: '💀 Hydra' } },
    { game: 'g-old', id: 9, type: 'kill', data: { victimName: '🦅 Ñandú' } },
    { game: 'g-old', id: 11, type: 'graze', data: { killerName: 'Nadie', victimName: 'Nadie' } },
    { game: 'g-old', id: 12, type: 'death', data: {} },
    { game: 'g-old', id: 13, type: 'kill', data: {} },
  ];
  assert.deepEqual(lines('intro', ctx('media', { recall })), ['say|Dunas. Objetivo: Sniper.', 'say|Sniper. Mapa: Dunas. Empiezo.', 'say|La última vez me eliminó Hydra. Me acuerdo.', 'say|Ya te eliminé una vez, Ñandú.']);
  assert.deepEqual(lines('intro', { ...ctx('media', {}), character: 'chulo', events: { start: { ...start, data: {} } } }), ['say|Hola, Sniper. Vengo a ganar.']);
  assert.equal(voice.speak('intro', { ...ctx('media', {}), events: {} }, () => 0), null, 'sin start no hay rival ni mapa que citar');
  assert.deepEqual(voice.speak('intro', ctx('media', {}), () => 0).refs, [{ game: G, id: 1 }]);
});

await check('antes de disparar: novata piensa (la favorita si no la eligió, y la segunda); media y veterana dicen el ojo que más pesa, la p del elegido y su familia; la veterana, la simulación si mata', () => {
  assert.deepEqual(lines('decision', ctx('novata', { decision: dec })), ['think|Me gusta más #1, pero pruebo #2.', 'think|#2… o #1.', 'think|Dudo entre #2 y #1.']);
  assert.deepEqual(lines('decision', ctx('novata', { decision: decBest })), ['think|#1… o #2.', 'think|Dudo entre #1 y #2.']);
  assert.deepEqual(lines('decision', ctx('media', { decision: dec })), ['say|Miro sobre todo Mapa (50 %).', 'say|#2, parábola: 30 %.', 'say|#2. 30 %.']);
  assert.deepEqual(lines('decision', ctx('veterana', { decision: dec })), ['say|Miro sobre todo Mapa (50 %).', 'say|Mi simulación dice que #2 da.', 'say|#2. 30 %. Fin.', 'say|#2, parábola. Calculado al 30 %.']);
  assert.deepEqual(lines('decision', ctx('veterana', { decision: decBest })), ['say|Miro sobre todo Mapa (50 %).', 'say|#1. 45 %. Fin.', 'say|#1, seno. Calculado al 45 %.']);
  assert.deepEqual(lines('decision', ctx('media', { decision: decNoEye })), ['say|#2, parábola: 30 %.', 'say|#2. 30 %.'], 'ojos con peso 0 no cuentan');
});

await check('antes de disparar, sin hechos → null: sin decisión, sin candidatos, lista vacía, elegida no entera, elegida que no está, elegida sin p', () => {
  const bad = [undefined, { ...dec, data: { phase: 'shoot', chosen: 2 } }, { ...dec, data: { ...dec.data, candidates: [] } }, { ...dec, data: { ...dec.data, chosen: null } }, { ...dec, data: { ...dec.data, chosen: 9 } }, { ...dec, data: { ...dec.data, candidates: [{ i: 2, family: 'line' }] } }];
  for (const d of bad) for (const level of ['novata', 'media']) assert.equal(voice.speak('decision', ctx(level, { decision: d }), () => 0), null, JSON.stringify(d && d.data));
});

await check('al matar: la víctima sin emoji y, si no es novata y la simulación lo decía, "Lo decía mi simulación"; sin víctima, nada', () => {
  const kill = { game: G, id: 20, type: 'kill', data: { victimName: '🦅 Ñandú' } };
  assert.deepEqual(lines('kill', ctx('media', { kill, decision: dec })), ['say|Ñandú: eliminado.', 'say|Uno menos. Ñandú.', 'say|Lo decía mi simulación: #2.']);
  assert.deepEqual(lines('kill', ctx('novata', { kill, decision: dec })), ['say|Ñandú: eliminado.', 'say|Uno menos. Ñandú.']);
  assert.deepEqual(lines('kill', ctx('media', { kill, decision: decBest })), ['say|Ñandú: eliminado.', 'say|Uno menos. Ñandú.']);
  assert.deepEqual(lines('kill', ctx('media', { kill })), ['say|Ñandú: eliminado.', 'say|Uno menos. Ñandú.']);
  for (const k of [undefined, { ...kill, data: undefined }, { ...kill, data: {} }]) assert.equal(voice.speak('kill', ctx('media', { kill: k, decision: dec }), () => 0), null);
});

await check('al rozar: la distancia con 2 decimales; sin distancia numérica, nada', () => {
  const graze = { game: G, id: 21, type: 'graze', data: { dist: 0.8765 } };
  assert.deepEqual(lines('graze', ctx('media', { graze })), ['say|Por 0.88 u.', 'say|Fallo por 0.88.']);
  for (const g of [undefined, { ...graze, data: undefined }, { ...graze, data: {} }, { ...graze, data: { dist: '0.8' } }]) assert.equal(voice.speak('graze', ctx('media', { graze: g }), () => 0), null);
});

await check('al fallar: la distancia con 1 decimal (antes, "Obstáculo" si chocó); a 30 u o más, matando o suicidándose, o sin distancia, nada', () => {
  const shot = { game: G, id: 22, type: 'shot', data: { result: { type: 'miss' }, minDist: 3.456 } };
  assert.deepEqual(lines('miss', ctx('media', { shot })), ['say|A 3.5 de Sniper. Corrijo.', 'say|Fallo: 3.5.']);
  assert.deepEqual(lines('miss', ctx('media', { shot: { ...shot, data: { ...shot.data, result: { type: 'obstacle' } } } })), ['say|Obstáculo. A 3.5 de Sniper.', 'say|A 3.5 de Sniper. Corrijo.', 'say|Fallo: 3.5.']);
  assert.deepEqual(lines('miss', ctx('media', { shot: { ...shot, data: { ...shot.data, minDist: 29.94 } } })), ['say|A 29.9 de Sniper. Corrijo.', 'say|Fallo: 29.9.']);
  const bad = [undefined, { ...shot, data: undefined }, { ...shot, data: { minDist: 3 } }, ...['kill', 'suicide'].map((type) => ({ ...shot, data: { ...shot.data, result: { type } } })), { ...shot, data: { ...shot.data, minDist: 30 } }, { ...shot, data: { ...shot.data, minDist: '3' } }];
  for (const s of bad) assert.equal(voice.speak('miss', ctx('media', { shot: s }), () => 0), null, JSON.stringify(s && s.data));
});

await check('fuego amigo y muerte: sus frases con el evento que las justifica; sin evento (o sin autor), nada', () => {
  const ff = { game: G, id: 23, type: 'friendlyFire', data: {} };
  assert.deepEqual(lines('friendlyFire', ctx('media', { friendlyFire: ff })), ['say|Error mío: fuego amigo.', 'say|Anotado: fuego amigo.']);
  assert.deepEqual(voice.speak('friendlyFire', ctx('media', { friendlyFire: ff }), () => 0).refs, [{ game: G, id: 23 }]);
  assert.equal(voice.speak('friendlyFire', ctx('media', {}), () => 0), null);
  const death = { game: G, id: 24, type: 'death', data: { killerName: '💀 Hydra' } };
  assert.deepEqual(lines('death', ctx('novata', { death })), ['say|Me eliminó Hydra.', 'say|Baja propia. Autor: Hydra.']);
  for (const d of [undefined, { ...death, data: undefined }, { ...death, data: {} }]) assert.equal(voice.speak('death', ctx('media', { death: d }), () => 0), null);
});

await check('réplica: con la decisión del rival cita su candidato; sin ella, solo la distancia; novata, a 30 u o más o si el rival mató, nada', () => {
  const rivalShot = { game: G, id: 25, type: 'shot', data: { result: { type: 'miss' }, minDist: 2.04 } };
  const rivalDecision = { game: G, id: 26, type: 'decision', data: { phase: 'shoot', chosen: 3, candidates: [{ i: 3, p: 0.6 }, { i: 0, p: 0.4 }] } };
  assert.deepEqual(lines('retort', ctx('media', { rivalShot, rivalDecision })), ['say|#3 de Sniper: a 2.0 de nosotros.']);
  assert.deepEqual(voice.speak('retort', ctx('media', { rivalShot, rivalDecision }), () => 0).refs, [{ game: G, id: 26 }, { game: G, id: 1 }, { game: G, id: 25 }]);
  assert.deepEqual(lines('retort', ctx('veterana', { rivalShot })), ['say|Fallaste por 2.0, Sniper.']);
  const bad = [undefined, { ...rivalShot, data: undefined }, { ...rivalShot, data: { minDist: 2 } }, ...['kill', 'suicide'].map((type) => ({ ...rivalShot, data: { ...rivalShot.data, result: { type } } })), { ...rivalShot, data: { ...rivalShot.data, minDist: 30 } }, { ...rivalShot, data: { result: { type: 'miss' } } }];
  for (const s of bad) assert.equal(voice.speak('retort', ctx('media', { rivalShot: s, rivalDecision }), () => 0), null, JSON.stringify(s && s.data));
  assert.equal(voice.speak('retort', ctx('novata', { rivalShot, rivalDecision }), () => 0), null);
});

await check('speak: momento desconocido, sin ctx, sin eventos o carácter desconocido → null', () => {
  assert.equal(voice.speak('nope', ctx('media', {}), () => 0), null);
  assert.equal(voice.speak('intro', null, () => 0), null);
  assert.equal(voice.speak('intro', { character: 'frio', level: 'media' }, () => 0), null);
  assert.equal(voice.speak('death', { ...ctx('media', { death: { game: G, id: 24, type: 'death', data: { killerName: 'Hydra' } } }), character: 'zen' }, () => 0), null);
});

// ---------- (2) la voz en la sala ----------
const veteran = (id, name, character, extra = {}) => ({ ...clone(TEMPLATES.seer.genome), id, name, traits: { ...TEMPLATES.seer.genome.traits, temperature: 0.05, character }, stats: { games: 1000, wins: 600, kills: 900, deaths: 300, reigns: 0 }, ...extra });
for (const g of [veteran('vx-a', 'Hydra Siete', 'chulo'), veteran('vx-b', 'Orca Dos', 'dramatico'), veteran('vx-c', 'Lince Uno', 'frio')]) assert.ok(store.saveNet(g).ok);
const SURE = { certainty: 1, experience: 1, recentAccuracy: 1, confidence: 1, level: 'veterana', sayProbability: 1 };
const MUTE = { certainty: 0, experience: 0, recentAccuracy: 0, confidence: 0, level: 'media', sayProbability: 0 };
const live = (seed, left = 'net:vx-a', right = 'net:vx-b', soldiers = 2) => {
  const room = new Room('vx', { soldiersPerPlayer: soldiers, seed });
  room.addAgent(left, { team: 'left' }); room.addAgent(right, { team: 'right' });
  room.start();
  return room;
};
const soldiersOf = (room, p) => room.soldiers.filter((s) => s.ownerId === p.id);
// oráculo (spec/07 §13.2): rng = makeRng(hash32(semilla, clave)); habla si rng() < sayProbability (0.2 sin confianza), salvo la presentación
const expected = (room, player, soldier, moment, events, conf, key, always = false) => {
  const rng = makeRng(hash32(room.seed, key));
  if (!always && rng() >= (conf ? conf.sayProbability : 0.2)) return null;
  const rival = room.players.find((q) => q.team !== player.team);
  const c = { character: (player.genome.traits && player.genome.traits.character) || 'frio', level: conf ? conf.level : 'novata', confidence: conf, rivalName: rival ? rival.name : null, events: { start: room.events.find((e) => e.type === 'game.start'), ...events } };
  const ph = voice.speak(moment, c, rng);
  return ph && { playerId: player.id, soldierId: soldier.id, text: ph.text, kind: ph.kind, refs: ph.refs, confidence: conf ? { certainty: conf.certainty, experience: conf.experience, confidence: conf.confidence, level: conf.level } : null };
};
const saysFrom = (room, n) => room.events.slice(n).filter((e) => e.type === 'say').map((e) => ({ playerId: e.actor.playerId, soldierId: e.actor.soldierId, text: e.data.text, kind: e.data.kind, refs: e.data.refs, confidence: e.data.confidence }));
const shootDecision = (room, s, chosen = 2) => room.emit('decision', room.actorOf(s), clone({ ...dec.data, chosen }));

await check('eventsFor: la ref de esta partida, la de una partida guardada, la de una entrada del registro; sin ref, partida que no existe o ref vacía → []', () => {
  const room = live(71);
  const own = room.events.find((e) => e.type === 'game.start');
  assert.deepEqual(room.eventsFor({ game: room.gameId, id: own.id }), [own]);
  assert.ok(store.saveGame({ gameId: 'g-vx-old', kind: 'exhibition', seed: 1 }, [{ id: 1, game: 'g-vx-old', type: 'game.start', data: {} }, { id: 2, game: 'g-vx-old', type: 'death', data: { killerName: 'Orca Dos' } }]) !== false);
  assert.deepEqual(room.eventsFor({ game: 'g-vx-old', id: 2 }).map((e) => e.data.killerName), ['Orca Dos']);
  assert.deepEqual(room.eventsFor({ game: 'g-vx-nada', id: 2 }), []);
  const logId = store.appendLog({ type: 'reign.start', netId: 'vx-a' });
  assert.deepEqual(room.eventsFor({ log: logId }).map((e) => [e.id, e.type]), [[logId, 'reign.start']]);
  assert.deepEqual(room.eventsFor({ log: 999999 }), []);
  assert.deepEqual(room.eventsFor(null), []);
  assert.deepEqual(room.eventsFor({}), []);
  room.gameOver(true);
});

await check('sayVerified: una frase que verifica devuelve true, deja el evento say con la confianza resumida y la línea "<nombre>: <frase>" en el chat con sus campos', () => {
  const room = live(72);
  const [A] = room.players, [s] = soldiersOf(room, A);
  const st = room.events.find((e) => e.type === 'game.start');
  const phrase = { text: `${st.data.map.name.replace(/^[^\p{L}\d]+/u, '').trim()}.`, refs: [{ game: room.gameId, id: st.id }] };
  const n = room.events.length, chat0 = room.chat.length;
  assert.equal(room.sayVerified(A, s, phrase, 'think', SURE), true);
  assert.deepEqual(saysFrom(room, n), [{ playerId: A.id, soldierId: s.id, text: phrase.text, kind: 'think', refs: phrase.refs, confidence: { certainty: 1, experience: 1, confidence: 1, level: 'veterana' } }]);
  const line = room.chat[chat0];
  assert.equal(room.chat.length, chat0 + 1);
  assert.equal(line.text, `${A.name}: ${phrase.text}`);
  assert.deepEqual([line.playerId, line.soldierId, line.kind, line.confidence, line.level], [A.id, s.id, 'think', 1, 'veterana']);
  assert.deepEqual(line.refs, phrase.refs);
  assert.equal(room.sayVerified(A, null, phrase, 'say', null), true);
  const last = room.chat[room.chat.length - 1];
  assert.deepEqual([last.soldierId, last.confidence, last.level], [null, null, null]);
  assert.equal(room.events[room.events.length - 1].data.confidence, null);
  room.gameOver(true);
});

await check('tras un disparo fallido: el tirador comenta el fallo y la red rival replica (presupuesto aparte), cada una con su clave de sorteo; en el mismo turno el tirador ya no vuelve a hablar, la réplica sí', () => {
  const room = live(73);
  const [A, B] = room.players, [sA] = soldiersOf(room, A), [sB] = soldiersOf(room, B);
  room.lastConfidence[A.id] = SURE; room.lastConfidence[B.id] = SURE;
  for (const round of [1, 2]) {
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: 'miss' }, minDist: 3.456 });
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const shot = room.events[shotId - 1], decision = room.events[d - 1];
    const want = [
      round === 1 ? expected(room, A, sA, 'miss', { shot, decision, kill: undefined, friendlyFire: undefined, graze: null }, SURE, shotId * 4 + 1) : null,
      expected(room, B, sB, 'retort', { rivalShot: shot, rivalDecision: decision }, SURE, shotId * 4 + 3),
    ].filter(Boolean);
    assert.equal(want.length, round === 1 ? 2 : 1, 'premisa: con confianza total hablan los dos (y en la segunda ronda, solo la réplica)');
    assert.deepEqual(saysFrom(room, n), want, `ronda ${round}`);
  }
  // la réplica va fuera del presupuesto: en ese mismo turno la rival aún puede decir una frase suya
  const m = room.events.length, dB = shootDecision(room, sB);
  room.voiceTry(B, sB, 'decision', { decision: room.events[dB - 1] }, SURE, 4242);
  assert.deepEqual(saysFrom(room, m), [expected(room, B, sB, 'decision', { decision: room.events[dB - 1] }, SURE, 4242)]);
  room.gameOver(true);
});

await check('tras un disparo que roza: comenta el roce más cercano; tras uno que mata: "kill" (solo con los eventos de ese disparo) y la víctima (otro jugador) dice "death" con su soldado, sin réplica; tras fuego amigo: "friendlyFire", sin réplica ni "death" propio', () => {
  const room = live(74);
  const [A, B] = room.players, [sA, sA2] = soldiersOf(room, A), [sB, sB2] = soldiersOf(room, B);
  room.lastConfidence[A.id] = SURE; room.lastConfidence[B.id] = SURE;
  const step = (fn) => { room.shots++; return fn(); };
  // roce: dos roces, gana el más cercano
  step(() => {
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: 'miss' }, minDist: 0.4 });
    const g1 = room.emit('graze', room.actorOf(sA), { soldierId: sB.id, dist: 0.9, shotEventId: shotId });
    const g2 = room.emit('graze', room.actorOf(sA), { soldierId: sB2.id, dist: 0.4, shotEventId: shotId });
    assert.ok(g1 < g2);
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const shot = room.events[shotId - 1], decision = room.events[d - 1];
    assert.deepEqual(saysFrom(room, n), [expected(room, A, sA, 'graze', { shot, decision, kill: undefined, friendlyFire: undefined, graze: room.events[g2 - 1] }, SURE, shotId * 4 + 1), expected(room, B, sB, 'retort', { rivalShot: shot, rivalDecision: decision }, SURE, shotId * 4 + 3)].filter(Boolean));
  });
  // baja: kill + death de la víctima (con un roce, que no cuenta)
  step(() => {
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: 'kill' }, minDist: 0 });
    room.emit('kill', room.actorOf(sA), { victimSoldierId: sB.id, victimPlayerId: B.id, victimName: 'Ajena', shotEventId: 999999 }); // de otro disparo: no cuenta
    room.emit('graze', room.actorOf(sA), { soldierId: sB.id, dist: 0.3, shotEventId: shotId });
    const k = room.emit('kill', room.actorOf(sA), { victimSoldierId: sB2.id, victimPlayerId: B.id, victimName: B.name, shotEventId: shotId });
    const de = room.emit('death', room.actorOf(sB2), { killerSoldierId: sA.id, killerPlayerId: A.id, killerName: A.name, shotEventId: shotId });
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const shot = room.events[shotId - 1], decision = room.events[d - 1];
    const want = [expected(room, A, sA, 'kill', { shot, decision, kill: room.events[k - 1], friendlyFire: undefined, graze: room.events[k - 2] }, SURE, shotId * 4 + 1), expected(room, B, sB2, 'death', { death: room.events[de - 1] }, SURE, shotId * 4 + 2)].filter(Boolean);
    assert.equal(want.length, 2, 'premisa: hablan el tirador y la víctima');
    assert.deepEqual(saysFrom(room, n), want);
  });
  // fuego amigo: el tirador mata a su aliado
  step(() => {
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: 'suicide' }, minDist: 0 });
    const ff = room.emit('friendlyFire', room.actorOf(sA), { victimSoldierId: sA2.id, victimPlayerId: A.id, shotEventId: shotId });
    room.emit('death', room.actorOf(sA2), { killerSoldierId: sA.id, killerPlayerId: A.id, killerName: A.name, shotEventId: shotId });
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const shot = room.events[shotId - 1], decision = room.events[d - 1];
    assert.deepEqual(saysFrom(room, n), [expected(room, A, sA, 'friendlyFire', { shot, decision, kill: undefined, friendlyFire: room.events[ff - 1], graze: null }, SURE, shotId * 4 + 1)].filter(Boolean));
  });
  room.gameOver(true);
});

await check('quién habla: sin confianza, la probabilidad es 0.2 (con esta semilla habla una clave y la otra no); un tirador que no es red, una red muda o un rival sin soldados vivos no hablan; sin pantalla, nadie', () => {
  // semillas buscadas para que la primera tirada de la clave del tirador quede por debajo de 0.2 en una y por encima en la otra
  const probe = live(1, 'net:vx-c', 'net:vx-b', 1);
  const shotAt = probe.events.length + 2; // la decisión y luego el disparo
  probe.gameOver(true);
  const pick = (want) => { for (let seed = 1; seed < 5000; seed++) { const r = makeRng(hash32(seed, shotAt * 4 + 1))(); if (want ? r < 0.2 : r >= 0.2 && r < 0.9) return seed; } throw new Error('sin semilla'); };
  for (const speaks of [true, false]) {
    const seed = pick(speaks);
    const room = live(seed, 'net:vx-c', 'net:vx-b', 1);
    assert.equal(room.seed, seed, 'premisa: la semilla de la sala');
    const [A, B] = room.players, [sA] = soldiersOf(room, A);
    room.lastConfidence[B.id] = MUTE;
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: 'miss' }, minDist: 5 });
    assert.equal(shotId, shotAt, 'premisa: la clave del tirador');
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const shot = room.events[shotId - 1], decision = room.events[d - 1];
    const want = expected(room, A, sA, 'miss', { shot, decision, kill: undefined, friendlyFire: undefined, graze: null }, null, shotId * 4 + 1);
    assert.equal(!!want, speaks, 'premisa de la semilla');
    assert.deepEqual(saysFrom(room, n), want ? [want] : [], `sin confianza: ${speaks ? 'habla' : 'calla'}; la rival, muda (probabilidad 0)`);
    room.gameOver(true);
  }
  // el tirador no es una red: solo replica la red rival
  const room = live(75, 'sniper', 'net:vx-b', 1);
  const [A, B] = room.players, [sA] = soldiersOf(room, A), [sB] = soldiersOf(room, B);
  room.lastConfidence[A.id] = SURE; room.lastConfidence[B.id] = SURE;
  const shotId = room.emit('shot', room.actorOf(sA), { result: { type: 'miss' }, minDist: 4.2 });
  let n = room.events.length;
  room.voiceAfterShot(A, sA, shotId);
  const shot = room.events[shotId - 1];
  assert.deepEqual(saysFrom(room, n), [expected(room, B, sB, 'retort', { rivalShot: shot, rivalDecision: null }, SURE, shotId * 4 + 3)].filter(Boolean));
  // la rival sin soldados vivos no replica; sin soldado, el tirador no habla
  sB.alive = false;
  const shot2 = room.emit('shot', room.actorOf(sA), { result: { type: 'miss' }, minDist: 4.2 });
  n = room.events.length;
  room.voiceAfterShot(A, sA, shot2);
  assert.deepEqual(saysFrom(room, n), []);
  assert.equal(room.voiceTry(B, null, 'intro', {}, SURE, 1, { always: true, budget: false }), false);
  room.gameOver(true);
  // sin pantalla nadie habla
  const quiet = new Room('vx', { soldiersPerPlayer: 1, seed: 76, headless: true });
  quiet.addAgent('net:vx-a', { team: 'left' }); quiet.addAgent('net:vx-b', { team: 'right' });
  quiet.start();
  const [qA] = quiet.players, [qs] = soldiersOf(quiet, qA);
  quiet.lastConfidence[qA.id] = SURE;
  const qShot = quiet.emit('shot', quiet.actorOf(qs), { result: { type: 'miss' }, minDist: 1 });
  quiet.voiceAfterShot(qA, qs, qShot);
  assert.equal(quiet.voiceTry(qA, qs, 'intro', {}, SURE, 1, { always: true, budget: false }), false);
  assert.ok(!quiet.events.some((e) => e.type === 'say'));
});

await check('red sin carácter ni estadísticas (genoma en línea): habla como "frio" y su presentación usa la confianza de 0 partidas', () => {
  const g = clone(veteran('vx-raw', 'Crudo', 'chulo'));
  delete g.traits.character; delete g.stats;
  const room = new Room('vx', { soldiersPerPlayer: 1, seed: 77 });
  room.addAgent('net', { team: 'left', genome: g }); room.addAgent('greedy', { team: 'right' });
  room.start();
  const [A] = room.players, [sA] = soldiersOf(room, A);
  assert.equal(A.genome.traits.character, undefined, 'premisa: el genoma de la sala no lleva carácter');
  const n = room.events.length;
  room.voiceIntro();
  const conf = confidenceOf({ margin: 1, games: 0, recentShots: [] });
  assert.deepEqual(saysFrom(room, n), [expected(room, A, sA, 'intro', { recall: [] }, conf, 900000, true)]);
  assert.ok(/Objetivo|Mapa|Empiezo/.test(saysFrom(room, n)[0].text), `frase de "frio": ${saysFrom(room, n)[0].text}`);
  room.gameOver(true);
});

await check('presentación: cada red habla siempre (clave 900000 + su posición), con la confianza de su experiencia y, si recuerda a la rival (su netId o su tipo), el mejor recuerdo de muerte o baja con partida, solo entre los 3 primeros; las que no son red, no; fuera de juego, nadie', () => {
  // la partida recordada: vx-b mató a vx-a
  const old = 'g-vx-rec';
  assert.ok(store.saveGame({ gameId: old, kind: 'exhibition', seed: 2 }, [{ id: 1, game: old, type: 'game.start', data: {} }, { id: 5, game: old, type: 'death', data: { killerName: 'Orca Dos' } }, { id: 6, game: old, type: 'kill', data: { victimName: 'Orca Dos' } }, { id: 7, game: old, type: 'death', data: { killerName: 'Orca Dos' } }]) !== false);
  const ep = (o) => ({ rivalId: 'sniper', biome: null, family: null, outcome: 'death', emotion: 'grudge', intensity: 0.5, gamesAgo: 0, ...o });
  const memory = { episodes: [
    ep({ outcome: 'graze', intensity: 1, ref: { game: old, id: 5 } }), ep({ outcome: 'graze', intensity: 0.95, ref: { game: old, id: 5 } }), ep({ intensity: 0.92 }), // tres por delante que no valen (roces; una muerte sin partida)
    ep({ rivalId: 'otra', intensity: 1, ref: { game: old, id: 5 } }), // de otra rival: puntúa menos
    ep({ intensity: 0.9, ref: { game: old, id: 5 } }), // el cuarto sí valdría: queda fuera de los 3 primeros
  ], rivals: {}, recentShots: [true, true, false] };
  const memory2 = { ...memory, episodes: [ep({ intensity: 0.9, ref: { game: old, id: 5 } }), ep({ outcome: 'kill', intensity: 0.8, ref: { game: old, id: 6 } }), ep({ intensity: 0.7, ref: { game: old, id: 7 } })] }; // tres válidos: se usa solo el mejor
  // con n frases candidatas elige floor(r·n): con r ≥ 0.75, 2, 3 o 4 candidatas dan frases distintas
  let introSeed = 78; while (makeRng(hash32(introSeed, 900001))() < 0.75) introSeed++;
  for (const [mem, recalled] of [[memory, []], [memory2, [5]]]) {
    store.saveNet({ ...veteran('vx-m', 'Memoriosa', 'frio'), memory: mem });
    const room = live(introSeed, 'sniper', 'net:vx-m', 2);
    const [, M] = room.players;
    const n = room.events.length;
    room.voiceIntro();
    const recall = recalled.map((id) => store.loadGame(old).events.find((e) => e.id === id));
    const confM = confidenceOf({ margin: 1, games: 1000, recentShots: mem.recentShots });
    const want = [expected(room, M, soldiersOf(room, M)[0], 'intro', { recall }, confM, 900001, true)];
    assert.deepEqual(saysFrom(room, n), want, `recuerdos: ${JSON.stringify(recalled)}`);
    const sM = soldiersOf(room, M)[0], k = room.events.length, dM = shootDecision(room, sM);
    room.voiceTry(M, sM, 'decision', { decision: room.events[dM - 1] }, SURE, 4343); // la presentación va fuera del presupuesto
    assert.deepEqual(saysFrom(room, k), [expected(room, M, sM, 'decision', { decision: room.events[dM - 1] }, SURE, 4343)]);
    room.gameOver(true);
    const m = room.events.length;
    room.voiceIntro();
    assert.equal(room.events.length, m, 'acabada la partida, no se presenta nadie');
  }
});

await check('36 disparos con probabilidad 0.5: la réplica habla según la clave 4·disparo + 3, la víctima según 4·disparo + 2 y quien mata a un aliado no dice "death" aunque su clave lo permitiera', () => {
  const HALF = { certainty: 0.5, experience: 1, recentAccuracy: 1, confidence: 0.5, level: 'media', sayProbability: 0.5 };
  const room = live(79);
  const [A, B] = room.players, [sA, sA2] = soldiersOf(room, A), [sB, sB2] = soldiersOf(room, B);
  room.lastConfidence[A.id] = HALF; room.lastConfidence[B.id] = HALF;
  const seen = { retort: [0, 0], death: [0, 0], ownDeath: 0 };
  const draw = (key) => makeRng(hash32(room.seed, key))();
  for (let r = 0; r < 36; r++) {
    room.shots++;
    const kind = ['miss', 'kill', 'ff'][r % 3];
    const d = shootDecision(room, sA);
    const shotId = room.emit('shot', room.actorOf(sA), { decisionEventId: d, result: { type: kind === 'miss' ? 'miss' : kind === 'kill' ? 'kill' : 'suicide' }, minDist: kind === 'miss' ? 2.5 : 0 });
    let kill, ff, death;
    if (kind === 'kill') { kill = room.emit('kill', room.actorOf(sA), { victimSoldierId: sB2.id, victimPlayerId: B.id, victimName: B.name, shotEventId: shotId }); death = room.emit('death', room.actorOf(sB2), { killerSoldierId: sA.id, killerPlayerId: A.id, killerName: A.name, shotEventId: shotId }); }
    if (kind === 'ff') { ff = room.emit('friendlyFire', room.actorOf(sA), { victimSoldierId: sA2.id, victimPlayerId: A.id, shotEventId: shotId }); death = room.emit('death', room.actorOf(sA2), { killerSoldierId: sA.id, killerPlayerId: A.id, killerName: A.name, shotEventId: shotId }); }
    const n = room.events.length;
    room.voiceAfterShot(A, sA, shotId);
    const ev = (id) => (id ? room.events[id - 1] : undefined);
    const shot = ev(shotId), decision = ev(d);
    const mine = expected(room, A, sA, kind === 'miss' ? 'miss' : kind === 'kill' ? 'kill' : 'friendlyFire', { shot, decision, kill: ev(kill), friendlyFire: ev(ff), graze: null }, HALF, shotId * 4 + 1);
    const other = kind === 'miss' ? expected(room, B, sB, 'retort', { rivalShot: shot, rivalDecision: decision }, HALF, shotId * 4 + 3) : kind === 'kill' ? expected(room, B, sB2, 'death', { death: ev(death) }, HALF, shotId * 4 + 2) : null;
    assert.deepEqual(saysFrom(room, n), [mine, other].filter(Boolean), `disparo ${r} (${kind})`);
    if (kind === 'miss') seen.retort[other ? 0 : 1]++;
    if (kind === 'kill') seen.death[other ? 0 : 1]++;
    if (kind === 'ff' && !mine && draw(shotId * 4 + 2) < 0.5) seen.ownDeath++;
  }
  assert.ok(seen.retort[0] && seen.retort[1] && seen.death[0] && seen.death[1], `premisa: la réplica y la muerte a veces hablan y a veces no (${JSON.stringify(seen)})`);
  assert.ok(seen.ownDeath > 0, 'premisa: hay un fuego amigo en el que, si el tirador pudiera decir "death", lo diría');
  room.gameOver(true);
});

await check('presentación en 10 salas: la frase elegida sigue la clave 900000 + posición del jugador', () => {
  store.saveNet(veteran('vx-p', 'Presentadora', 'frio'));
  for (let seed = 80; seed < 90; seed++) {
    const room = live(seed, 'sniper', 'net:vx-p', 1);
    const [, P] = room.players;
    const n = room.events.length;
    room.voiceIntro();
    assert.deepEqual(saysFrom(room, n), [expected(room, P, soldiersOf(room, P)[0], 'intro', { recall: [] }, confidenceOf({ margin: 1, games: 1000, recentShots: [] }), 900001, true)], `semilla ${seed}`);
    room.gameOver(true);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: voz, casos extra)');
process.exitCode = fails ? 1 : 0;
