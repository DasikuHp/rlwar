// Parte 3, casos extra b (en proceso): lo que dejó la segunda pasada de mutantes (spec/mutantes.md "Parte 3").
// La compactación del índice con más de una partida viva, una partida sin ts frente a una con ts 1, el tope de eventos
// que no salta antes de tiempo (R5) y las frases de reinado y de duelo de campeonas con los nombres guardados (M5).
// Uso: node test/arreglos-parte3-extra-b.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-p3extrab-'));
const store = await import('../evo/store.js');
const T = await import('../evo/truth.js');
const { Room } = await import('../server/rooms.js');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const gamesDir = () => store.gamesDir();
const indexFile = () => join(gamesDir(), 'index.jsonl');
const indexLines = () => readFileSync(indexFile(), 'utf8').split('\n').filter((l) => l.trim()).length;
const clearGames = () => { for (const f of readdirSync(gamesDir())) rmSync(join(gamesDir(), f), { force: true }); };

await check('índice con 2 partidas vivas: con 204 líneas (2·2 + 200) no se compacta; con 205, sí', () => {
  clearGames();
  store.saveGame({ gameId: 'v1', kind: 'training', nets: ['n1'], ts: 1 }, []);
  store.saveGame({ gameId: 'v2', kind: 'training', nets: ['n1'], ts: 2 }, []);
  store.listGames();
  const metas = readFileSync(indexFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l).a);
  const lines = metas.map((m) => ({ a: m }));
  for (let i = 0; i < 101; i++) lines.push({ a: { ...metas[0], gameId: 'x' } }, { d: 'x' });
  writeFileSync(indexFile(), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  assert.equal(indexLines(), 204);
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['v1', 'v2']);
  assert.equal(indexLines(), 204, 'no se compacta');
  writeFileSync(indexFile(), readFileSync(indexFile(), 'utf8') + JSON.stringify({ d: 'nadie' }) + '\n');
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['v1', 'v2']);
  assert.equal(indexLines(), 2, 'se compacta a las 2 vivas');
});

await check('una partida sin ts va antes que una con ts 1 (sin ts cuenta como 0, no como un empate)', () => {
  clearGames();
  for (const [id, ts] of [['g-z', undefined], ['g-a', 1], ['g-m', undefined], ['g-b', 1]]) store.saveGame({ gameId: id, kind: 'training', nets: ['n1'], ...(ts === undefined ? {} : { ts }) }, []);
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['g-m', 'g-z', 'g-a', 'g-b']);
});

await check('tope de eventos: no salta antes de tiempo; con 5 000 eventos que cuentan aún no hay error, con el siguiente sí; solo say y el error "frase no verificable" son voz (R5)', () => {
  const room = new Room('tope-b', { soldiersPerPlayer: 1, seed: 2, headless: true });
  room.addAgent('sniper', { level: 3, team: 'left' }); room.addAgent('sniper', { level: 3, team: 'right' });
  room.start();
  const isCap = (e) => e.type === 'error' && /tope/.test(e.data.message);
  assert.ok(!room.events.some(isCap), 'al empezar, ningún error de tope');
  const nobody = { playerId: null, soldierId: null, netId: null };
  // cuentan: otros errores y un evento que no es error aunque su mensaje coincida; no cuentan: say y el error de frase
  for (let i = 0; i < 40; i++) room.emit('error', nobody, { message: 'el agente falló' });
  for (let i = 0; i < 40; i++) room.emit('relleno', nobody, { message: 'frase no verificable' });
  for (let i = 0; i < 30; i++) room.emit('error', nobody, { message: 'frase no verificable', text: 'x' });
  const voiceSoFar = 30;
  for (let i = room.events.length - voiceSoFar; i < 4999; i++) room.emit('relleno', nobody, {});
  room.emit('say', { playerId: null, soldierId: null, netId: null }, { text: 'la voz no cuenta' });
  room.emit('relleno', { playerId: null, soldierId: null, netId: null }, {});
  assert.equal(room.events.length - 1 - voiceSoFar, 5000);
  assert.ok(!room.events.some(isCap), 'con 5 000 que cuentan, todavía no');
  room.emit('relleno', { playerId: null, soldierId: null, netId: null }, {});
  assert.equal(room.events.filter(isCap).length, 1, 'el siguiente, sí');
});

await check('frases con los nombres guardados: la que se sienta en el trono y la ganadora del duelo de campeonas (M5)', () => {
  const start = { id: 5, ts: 1, type: 'reign.start', netId: 'hydra-7', queen: 'hydra-7', name: 'Hydra Siete' };
  assert.equal(T.diaryPhrase(start).text, 'Hydra Siete se sienta en el trono');
  const duel = { id: 6, ts: 1, type: 'dynasty', house: 'A', houseName: 'Casa del Norte', event: 'duel', a: 'hydra-7', b: 'orca-2', winner: 'orca-2', tie: false, aName: 'Hydra Siete', bName: 'Orca Dos', winnerName: 'Orca Dos' };
  assert.equal(T.diaryPhrase(duel).text, 'Duelo de campeonas: gana Orca Dos');
  assert.ok(T.checkPhrase(T.diaryPhrase(duel), () => duel).ok);
  assert.equal(T.diaryPhrase({ ...duel, id: 7, winner: null, winnerName: null, tie: true }).text, 'Duelo de campeonas: empate');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (parte 3, casos extra b)');
process.exitCode = fails ? 1 : 0;
