// Trono y duelos (parte 4, spec/prompt-opus-ui.md §3.1; spec/06 §1, §2, §6.5): lógica pura de public/js/lab/duels.js.
// Cuerpos de POST /duels y /throne/challenge (con errores en español), el marcador 3 mapas × 2 lados, el árbol
// genealógico (madres antes que hijas, huérfanas como raíz, marcas edited/orphan) y la sala de la fama.
// Escrito ANTES del código. Uso: node test/ui-trono.spec.mjs
import { strict as assert } from 'node:assert';
const D = await import('../public/js/lab/duels.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('duelo libre: cuerpo con aprendizaje, velocidad, soldados y semilla solo si se da', () => {
  assert.deepEqual(D.duelBody({ a: 'hydra', b: 'orca', learning: 'mix', speed: 'turbo', soldiers: 'random', seed: '' }), { body: { a: 'hydra', b: 'orca', learning: 'mix', speed: 'turbo', soldiers: 'random' }, errors: [] });
  assert.deepEqual(D.duelBody({ a: 'hydra', b: 'orca', learning: 'frozen', speed: 'x10', soldiers: '2', seed: '9' }).body, { a: 'hydra', b: 'orca', learning: 'frozen', speed: 'x10', soldiers: 2, seed: 9 });
});

check('duelo libre: errores en español (faltan redes, la misma red, listas cerradas, soldados, semilla)', () => {
  const ok = { a: 'hydra', b: 'orca', learning: 'mix', speed: 'turbo', soldiers: 'random', seed: '' };
  const bad = (patch, re) => { const r = D.duelBody({ ...ok, ...patch }); assert.equal(r.body, null); assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${r.errors}`); };
  bad({ a: '' }, /elige las dos redes/i);
  bad({ b: 'hydra' }, /distintas/);
  bad({ learning: 'lento' }, /aprendizaje/);
  bad({ speed: 'x3' }, /velocidad/);
  bad({ soldiers: '9' }, /soldados/);
  bad({ seed: '1.5' }, /semilla/);
});

check('reto al trono: retadora, aprendizaje y velocidad', () => {
  assert.deepEqual(D.challengeBody({ challenger: 'orca', learning: 'mix', speed: 'x10' }), { body: { challenger: 'orca', learning: 'mix', speed: 'x10' }, errors: [] });
  assert.ok(D.challengeBody({ challenger: '', learning: 'mix', speed: 'turbo' }).errors.some((e) => /retadora/.test(e)));
});

const duel = {
  id: 'd1', a: 'hydra', b: 'orca', status: 'done', wins: { hydra: 2, orca: 1 }, killDiff: 3, winner: 'hydra', tie: false,
  games: [
    { k: 0, seed: 11, soldiers: 1, left: 'hydra', right: 'orca', winner: 'hydra', kills: { hydra: 1, orca: 0 }, gameId: 'g1', roomCode: null },
    { k: 1, seed: 11, soldiers: 1, left: 'orca', right: 'hydra', winner: 'orca', kills: { orca: 1, hydra: 0 }, gameId: 'g2', roomCode: null },
    { k: 2, seed: 22, soldiers: 3, left: 'hydra', right: 'orca', winner: null, kills: { hydra: 2, orca: 2 }, gameId: 'g3', roomCode: 'ABCD' },
  ],
};
check('marcador: 3 mapas × 2 lados; los que faltan, pendientes; totales tal cual del duelo', () => {
  const s = D.scoreboard(duel);
  assert.equal(s.maps.length, 3);
  assert.deepEqual(s.maps.map((m) => [m.seed, m.soldiers]), [[11, 1], [22, 3], [null, null]]);
  assert.deepEqual(s.maps[0].games.map((g) => g && g.winner), ['hydra', 'orca']);
  assert.deepEqual(s.maps[1].games.map((g) => g && g.gameId), ['g3', null], 'la segunda partida del mapa 2 aún no se ha jugado');
  assert.deepEqual(s.maps[2].games, [null, null]);
  assert.equal(s.maps[1].games[0].roomCode, 'ABCD');
  assert.deepEqual([s.wins, s.killDiff, s.winner, s.tie, s.played], [{ hydra: 2, orca: 1 }, 3, 'hydra', false, 3]);
});

check('árbol genealógico: madres antes que hijas, huérfanas y fundadoras como raíces, por fecha de nacimiento', () => {
  const g = {
    nets: {
      hydra: { parents: [], generation: 0, born: 10, exists: true, edited: false, orphan: false },
      'hydra-1b': { parents: ['hydra'], generation: 1, born: 30, exists: true, edited: true, orphan: false },
      'hydra-1a': { parents: ['hydra'], generation: 1, born: 20, exists: false, edited: false, orphan: false },
      'hydra-2a': { parents: ['hydra-1a'], generation: 2, born: 40, exists: true, edited: false, orphan: false },
      perdida: { parents: ['borrada'], generation: 3, born: 5, exists: true, edited: false, orphan: true },
    },
  };
  const t = D.genealogyTree(g);
  assert.deepEqual(t.map((n) => n.id), ['perdida', 'hydra'], 'raíces por fecha');
  assert.deepEqual(t[1].children.map((n) => n.id), ['hydra-1a', 'hydra-1b']);
  assert.deepEqual(t[1].children[0].children.map((n) => n.id), ['hydra-2a']);
  const flat = D.flattenTree(t);
  assert.deepEqual(flat.map((n) => [n.id, n.depth]), [['perdida', 0], ['hydra', 0], ['hydra-1a', 1], ['hydra-2a', 2], ['hydra-1b', 1]]);
  assert.deepEqual(flat.find((n) => n.id === 'hydra-1b').marks, ['editada']);
  assert.deepEqual(flat.find((n) => n.id === 'hydra-1a').marks, ['borrada']);
  assert.deepEqual(flat.find((n) => n.id === 'perdida').marks, ['huérfana']);
  assert.deepEqual(D.genealogyTree({ nets: {} }), []);
  // un ciclo imposible no cuelga
  assert.equal(D.flattenTree(D.genealogyTree({ nets: { x: { parents: ['y'], born: 1 }, y: { parents: ['x'], born: 2 } } })).length, 2);
});

check('sala de la fama: ex-reinas con su reinado y partidas, en orden', () => {
  const hof = [{ netId: 'orca', snapshot: 'nets/orca/hof-1.json', reignIdx: 0, reignGames: 12 }, { netId: 'hydra', snapshot: 'nets/hydra/hof-1.json', reignIdx: 1, reignGames: 3 }];
  assert.deepEqual(D.hallRows(hof), [{ netId: 'orca', reign: 1, games: 12 }, { netId: 'hydra', reign: 2, games: 3 }]);
  assert.deepEqual(D.hallRows(undefined), []);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (trono y duelos: lógica)');
process.exitCode = fails ? 1 : 0;
