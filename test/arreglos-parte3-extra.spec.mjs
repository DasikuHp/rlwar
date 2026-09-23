// Parte 3, casos extra en proceso (sin servidor): huecos que dejaron los mutantes sobre el código de la parte 3
// (spec/mutantes.md "Parte 3") y un fallo de M5 que destapó la interfaz (el fin de una generación salía en el cronista
// como "Casa B: generation"). Almacén: orden con empates, regla exacta de compactación del índice, reconstrucción con
// partidas antiguas, siguiente id tras reiniciar. Verdad: certeza con dos candidatos, neuronas nombradas solo con las
// muestras de disparo que tienen observación, frases con el nombre al borrar la reina o una campeona, y el fin de una
// generación en español. La parte de la API está en arreglos-parte3-extra-api.spec.mjs.
// Uso: node test/arreglos-parte3-extra.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const EVO = mkdtempSync(join(tmpdir(), 'gw-evo-p3extra-'));
process.env.GW_EVO_DIR = EVO;
const store = await import('../evo/store.js');
const T = await import('../evo/truth.js');
const TR = await import('../evo/train.js');
const { normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const gamesDir = () => store.gamesDir();
const indexFile = () => join(gamesDir(), 'index.jsonl');
const indexLines = () => readFileSync(indexFile(), 'utf8').split('\n').filter((l) => l.trim()).length;
const clearGames = () => { for (const f of readdirSync(gamesDir())) rmSync(join(gamesDir(), f), { force: true }); };

// ---------- almacén ----------
await check('listGames: por ts; con el mismo ts, por gameId; sin ts cuenta como 0', () => {
  clearGames();
  for (const [id, ts] of [['g-b', 5], ['g-a', 5], ['g-c', undefined], ['g-d', 2]]) store.saveGame({ gameId: id, kind: 'training', nets: ['n1'], ...(ts === undefined ? {} : { ts }) }, []);
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['g-c', 'g-d', 'g-a', 'g-b']);
});

await check('índice: se compacta solo cuando pasa de 2·vivas + 200 líneas (con 202 no, con 203 sí)', () => {
  clearGames();
  store.saveGame({ gameId: 'g1', kind: 'training', nets: ['n1'], ts: 1 }, []);
  store.listGames(); // crea el índice (sin índice, saveGame no lo crea: lo reconstruye el primer listGames)
  const meta = JSON.parse(readFileSync(indexFile(), 'utf8').trim()).a;
  const lines = [{ a: meta }];
  for (let i = 0; i < 100; i++) lines.push({ a: { ...meta, gameId: 'g2' } }, { d: 'g2' });
  lines.push({ a: meta });
  writeFileSync(indexFile(), lines.map((l) => JSON.stringify(l) + '\n').join(''));
  assert.equal(indexLines(), 202);
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['g1']);
  assert.equal(indexLines(), 202, 'con 202 líneas y 1 viva (2·1 + 200) no se compacta');
  writeFileSync(indexFile(), readFileSync(indexFile(), 'utf8') + JSON.stringify({ d: 'nadie' }) + '\n');
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['g1']);
  assert.equal(indexLines(), 1, 'con 203 se compacta a las vivas');
});

await check('sin índice: se reconstruye con las metas, las partidas antiguas en .json enteras y sin los .nets.json ni los rotos', () => {
  clearGames();
  store.saveGame({ gameId: 'nueva', kind: 'duel', nets: ['n1'], ts: 20 }, []);
  writeFileSync(join(gamesDir(), 'vieja.json'), JSON.stringify({ meta: { gameId: 'vieja', kind: 'training', nets: ['n1'], ts: 10 }, events: [] }));
  writeFileSync(join(gamesDir(), 'vieja-gz.json.gz'), gzipSync(JSON.stringify({ meta: { gameId: 'vieja-gz', kind: 'training', nets: ['n1'], ts: 15 }, events: [] })));
  writeFileSync(join(gamesDir(), 'nueva.nets.json'), JSON.stringify({ n1: { id: 'n1' } }));
  writeFileSync(join(gamesDir(), 'rota.json'), '{ esto no es json');
  rmSync(indexFile(), { force: true });
  assert.deepEqual(store.listGames().map((m) => m.gameId), ['vieja', 'vieja-gz', 'nueva']);
  assert.equal(indexLines(), 3, 'índice reconstruido');
});

await check('siguiente id de entrenos y trabajos: detrás del mayor guardado (t12 → 13), aunque haya otros ficheros', () => {
  const dir = join(EVO, 'records', 'trainings');
  mkdirSync(dir, { recursive: true });
  for (const f of ['t3.json', 't12.json', 'x.json', 't9.json.tmp', 'tt4.json']) writeFileSync(join(dir, f), '{}');
  assert.equal(store.nextRecordSeq('trainings', 't'), 13);
  assert.equal(store.nextRecordSeq('jobs', 'j'), 1, 'sin guardados, 1');
});

// ---------- verdad ----------
await check('certeza con exactamente dos candidatos: la diferencia entre los dos (M1)', () => {
  assert.equal(T.certaintyOf([{ p: 0.25 }, { p: 0.75 }]), 0.5);
  assert.equal(T.certaintyOf([{ p: 0.5 }, { p: 0.5 }]), 0);
});

await check('neuronas: se nombran con las muestras de disparo que tienen observación; las de moverse y las vacías no cuentan en m (M6)', () => {
  const g = normalize(JSON.parse(JSON.stringify(TEMPLATES.turtle.genome)));
  g.id = 'nn-extra';
  const r = TR.playOne({ seed: 3, left: { type: 'net', genome: g, learn: true }, right: { type: 'sniper', level: 1 }, soldiers: 2 });
  const samples = [];
  for (const [sid, steps] of Object.entries(r.trajectories[r.playerId].soldiers)) for (const st of steps) samples.push({ obs: st.obs, decision: st.decision, ep: sid, use: st.phase === 'shoot' });
  const shoot = samples.filter((x) => x.use).length, moves = samples.length - shoot;
  assert.ok(shoot >= 2 && moves >= 1, `premisa: disparos ${shoot}, movimientos ${moves}`);
  const extraMoves = samples.filter((x) => !x.use).slice(0, 1).map((x) => ({ ...x, ep: 'extra' }));
  const all = [...samples, ...extraMoves, ...extraMoves, { decision: {}, ep: 'vacía', use: true }, null];
  const named = T.nameNeurons(g, all, { min: 1 });
  const units = Object.values(named).flat();
  assert.ok(units.length, 'premisa: hay neuronas');
  for (const u of units) assert.equal(u.m, shoot, `m ${u.m} ≠ ${shoot} disparos`);
});

await check('frases al borrar: la reina y la campeona se nombran por su nombre, no por su id (M5)', () => {
  const end = { id: 3, ts: 1, type: 'reign.end', netId: 'hydra-7', queen: null, reason: 'deleted', name: 'Hydra Siete' };
  assert.equal(T.diaryPhrase(end).text, 'Hydra Siete deja el trono: la borraron');
  const del = { id: 4, ts: 1, type: 'dynasty', house: 'A', houseName: 'Casa del Norte', event: 'champion.deleted', netId: 'orca-2', name: 'Orca Dos' };
  assert.equal(T.diaryPhrase(del).text, 'Casa del Norte: se borró a su campeona Orca Dos');
  assert.ok(T.checkPhrase(T.diaryPhrase(del), () => del).ok);
});

await check('cronista: el fin de una generación en español, con el nombre de la casa y su cuenta; empate sin ganadora', () => {
  const won = { id: 7, ts: 1, type: 'dynasty', house: 'B', houseName: 'Casa del Sur', event: 'generation', A: { champion: 'hydra', generation: 0, promoted: false }, B: { champion: 'orca', generation: 2, promoted: true }, duelId: 'd9', tie: false };
  const p = T.diaryPhrase(won);
  assert.equal(p.text, 'Casa del Sur gana la generación y ya lleva 2');
  assert.deepEqual(T.checkPhrase(p, (r) => (r.log === 7 ? won : null)), { ok: true, missing: { numbers: [], names: [] } });
  const tie = { ...won, id: 8, house: 'A', houseName: 'Casa del Norte', tie: true };
  const q = T.diaryPhrase(tie);
  assert.equal(q.text, 'Generación sin ganadora: las casas empatan');
  assert.ok(T.checkPhrase(q, (r) => (r.log === 8 ? tie : null)).ok);
  const old = { ...won, id: 9, houseName: undefined };
  assert.equal(T.diaryPhrase(old).text, 'Casa B gana la generación y ya lleva 2', 'entradas antiguas sin nombre: "Casa B"');
  for (const e of [won, tie, old]) assert.ok(!/generation/.test(T.diaryPhrase(e).text));
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (parte 3, casos extra en proceso)');
process.exitCode = fails ? 1 : 0;
