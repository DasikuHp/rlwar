// Arreglo A3 (spec/07 §13.2; spec/revision-opus.md A3): las redes hablan con frases verificadas, sin relleno,
// y hablar no cambia la partida. Escrito ANTES del código y congelado. Uso: node test/arreglos-voz.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-a3-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const { makeRng } = await import('../shared/rng.js');
const { checkPhrase } = await import('../evo/truth.js');
const voice = await import('../evo/voice.js');
const store = await import('../evo/store.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');

const FILLER = ['Calculando.', 'Observo.', 'Mis ojos están abiertos.', 'Previsto.', 'Lo vi venir', 'Un candidato menos que imaginar.'];
// una red "veterana": política afilada (temperatura mínima), mucha experiencia y buena puntería reciente
const veteran = (id, character) => ({ ...clone(TEMPLATES.seer.genome), id, name: id === 'voz-a' ? 'Hydra Siete' : 'Orca Dos', traits: { ...TEMPLATES.seer.genome.traits, temperature: 0.05, character }, stats: { games: 1000, wins: 600, kills: 900, deaths: 400, reigns: 0 }, memory: { episodes: [], rivals: {}, recentShots: Array(20).fill(1) } });
for (const [id, ch] of [['voz-a', 'chulo'], ['voz-b', 'dramatico']]) assert.ok(store.saveNet(veteran(id, ch)).ok);
const byId = (events) => (ref) => events.filter((e) => ref.game === e.game && ref.id === e.id);

await check('voice.speak: en cada momento y carácter, lo que dice verifica contra sus eventos; determinista; con variedad', () => {
  const g = playGame({ seed: 12, left: { type: 'net', netId: 'voz-a' }, right: { type: 'sniper', level: 2 }, soldiers: 2 });
  const ev = g.events;
  const net = g.room.players.find((p) => p.agentType === 'net');
  const start = ev.find((e) => e.type === 'game.start');
  const decision = ev.find((e) => e.type === 'decision' && e.actor.playerId === net.id && e.data.phase === 'shoot');
  const shot = ev.find((e) => e.type === 'shot' && e.data.decisionEventId === decision.id);
  const rivalShot = ev.find((e) => e.type === 'shot' && e.actor.playerId !== net.id);
  const kill = ev.find((e) => e.type === 'kill' && e.actor.playerId === net.id) || null;
  const death = ev.find((e) => e.type === 'death' && e.actor.playerId === net.id) || null;
  const graze = ev.find((e) => e.type === 'graze' && e.actor.playerId === net.id) || null;
  const events = { start, decision, shot, kill, death, graze, rivalShot };
  const moments = ['intro', 'decision', 'miss', 'retort', ...(kill ? ['kill'] : []), ...(death ? ['death'] : []), ...(graze ? ['graze'] : [])];
  let said = 0;
  for (const character of ['frio', 'chulo', 'dramatico', 'desquiciado']) for (const level of ['novata', 'media', 'veterana']) for (const moment of moments) {
    const texts = new Set();
    for (let s = 1; s <= 12; s++) {
      const p = voice.speak(moment, { character, level, confidence: decision.data.confidence, rivalName: 'Sniper', events }, makeRng(s));
      if (!p) continue;
      said++;
      assert.ok(p.text && Array.isArray(p.refs) && p.refs.length && ['say', 'think'].includes(p.kind), JSON.stringify(p));
      const c = checkPhrase(p, byId(ev));
      assert.ok(c.ok, `${character}/${level}/${moment}: «${p.text}» ${JSON.stringify(c.missing)}`);
      if (moment === 'decision' && level === 'novata') assert.equal(p.kind, 'think', 'la novata piensa en voz baja');
      if (moment === 'decision' && level !== 'novata') assert.equal(p.kind, 'say');
      texts.add(p.text);
      assert.deepEqual(voice.speak(moment, { character, level, confidence: decision.data.confidence, rivalName: 'Sniper', events }, makeRng(s)), p, 'mismo rng, misma frase');
    }
    if (moment === 'decision' || moment === 'intro') assert.ok(texts.size >= 2, `${character}/${level}/${moment}: sin variedad (${[...texts]})`);
  }
  assert.ok(said > 100);
});

await check('sayVerified: una frase con un número inventado no se dice (error "frase no verificable", nada en el chat)', () => {
  const room = new Room('v', { soldiersPerPlayer: 1, seed: 3 });
  room.addAgent('net:voz-a', { team: 'left' }); room.addAgent('sniper', { team: 'right' });
  room.start();
  const p = room.players[0], s = room.soldiers.find((x) => x.ownerId === p.id);
  const chat0 = room.chat.length;
  const ok = room.sayVerified(p, s, { text: 'Fallé por 9.99 exactos.', refs: [{ game: room.gameId, id: 1 }] }, 'say', null);
  assert.equal(ok, false);
  assert.equal(room.chat.length, chat0, 'no sale en el chat');
  const err = room.events.filter((e) => e.type === 'error').pop();
  assert.ok(err && err.data.message === 'frase no verificable' && err.data.text === 'Fallé por 9.99 exactos.' && err.data.missing.numbers.includes('9.99'));
  assert.ok(!room.events.some((e) => e.type === 'say'));
  room.gameOver(true);
});

let live = null;
await check('sala viva (FAST): todo lo que dicen las redes lleva refs y verifica; cada frase tiene su evento say; sin relleno', async () => {
  const room = new Room('voz', { soldiersPerPlayer: 2, seed: 21 });
  room.addAgent('net:voz-a', { team: 'left' }); room.addAgent('net:voz-b', { team: 'right' });
  room.start();
  const t0 = Date.now();
  while (room.phase === 'playing' && Date.now() - t0 < 120000) await sleep(100);
  assert.equal(room.phase, 'over', 'la partida termina');
  live = room;
  const nets = new Set(room.players.map((p) => p.id));
  const lines = room.chat.filter((c) => nets.has(c.playerId) && (c.kind === 'say' || c.kind === 'think'));
  assert.ok(lines.length >= 3, `hablan (${lines.length})`);
  const says = room.events.filter((e) => e.type === 'say');
  for (const c of lines) {
    assert.ok(Array.isArray(c.refs) && c.refs.length, `sin refs: ${c.text}`);
    assert.ok(!FILLER.some((f) => c.text.includes(f)), `relleno: ${c.text}`);
    const ev = says.find((e) => c.text.endsWith(e.data.text) && e.actor.playerId === c.playerId);
    assert.ok(ev, `sin evento say: ${c.text}`);
    assert.ok(checkPhrase({ text: ev.data.text, refs: ev.data.refs }, (ref) => room.events.filter((e) => e.game === ref.game && e.id === ref.id)).ok, `no verifica: ${ev.data.text}`);
    assert.ok(ev.data.confidence === null || typeof ev.data.confidence.confidence === 'number');
    assert.ok(typeof c.level === 'string' || c.level === undefined || c.level === null);
  }
  assert.ok(!room.chat.some((c) => nets.has(c.playerId) && FILLER.some((f) => c.text.includes(f))));
});

await check('hablar no cambia la partida: la sala viva y la partida sin pantalla con la misma semilla disparan lo mismo', () => {
  assert.ok(live, 'hace falta la partida viva anterior');
  const g = playGame({ seed: 21, left: { type: 'net', netId: 'voz-a' }, right: { type: 'net', netId: 'voz-b' }, soldiers: 2 });
  const seq = (events) => events.filter((e) => e.type === 'shot').map((e) => `${e.data.expr}|${e.data.result.type}`);
  assert.deepEqual(seq(live.events), seq(g.events));
  assert.ok(!g.events.some((e) => e.type === 'say'), 'sin pantalla no hablan');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: voz verificada)');
process.exitCode = fails ? 1 : 0;
