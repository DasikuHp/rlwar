// Dinastías (parte 4, spec/prompt-opus-ui.md §3.1; spec/06 §3 y §6.4): lógica pura de public/js/lab/dynasty.js. Fundar
// las casas (las dos o una), el cuerpo de una generación con los valores por defecto del servidor y errores en
// español, la vista de una casa (historia, la más reciente primero) y el relato de las casas sacado de la crónica
// verificada del servidor (sin redactar frases nuevas). Escrito ANTES del código. Uso: node test/ui-dinastias.spec.mjs
import { strict as assert } from 'node:assert';
const Y = await import('../public/js/lab/dynasty.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('fundar las dos casas: nombre (o "Casa A/B" si va vacío) y campeona; distintas', () => {
  assert.deepEqual(Y.foundBody({ A: { name: ' Casa del Norte ', netId: 'hydra' }, B: { name: '', netId: 'orca' } }), { body: { A: { name: 'Casa del Norte', netId: 'hydra' }, B: { name: 'Casa B', netId: 'orca' } }, errors: [] });
  const r = Y.foundBody({ A: { name: 'x', netId: 'hydra' }, B: { name: 'y', netId: 'hydra' } });
  assert.equal(r.body, null); assert.ok(r.errors.some((e) => /distintas/.test(e)));
  assert.ok(Y.foundBody({ A: { name: 'x', netId: '' }, B: { name: 'y', netId: 'orca' } }).errors.some((e) => /campeona de la casa A/.test(e)));
  assert.ok(Y.foundBody({ A: { name: 'x'.repeat(33), netId: 'hydra' }, B: { name: 'y', netId: 'orca' } }).errors.some((e) => /32/.test(e)));
});

check('refundar una casa: solo esa, y no con la campeona de la otra', () => {
  assert.deepEqual(Y.foundBody({ A: { name: 'Casa Sur', netId: 'lince' } }, 'A', 'orca'), { body: { A: { name: 'Casa Sur', netId: 'lince' } }, errors: [] });
  assert.ok(Y.foundBody({ A: { name: 'Casa Sur', netId: 'orca' } }, 'A', 'orca').errors.some((e) => /otra casa/.test(e)));
});

check('una generación: entreno, cría y duelo con los valores por defecto del servidor', () => {
  const d = Y.defaultGeneration();
  assert.deepEqual(d, { games: 20, trainSpeed: 'turbo', soldiers: 'random', n: 4, ptGames: 4, learning: 'mix', duelSpeed: 'turbo' });
  assert.deepEqual(Y.generationBody(d), { body: { training: { speed: 'turbo', duration: { games: 20 }, soldiers: 'random' }, children: { n: 4, pretournament: { games: 4 } }, duel: { learning: 'mix', speed: 'turbo' } }, errors: [] });
  assert.deepEqual(Y.generationBody({ ...d, games: '5', soldiers: '2', n: '1', ptGames: '0', learning: 'frozen', duelSpeed: 'x10' }).body, { training: { speed: 'turbo', duration: { games: 5 }, soldiers: 2 }, children: { n: 1, pretournament: { games: 0 } }, duel: { learning: 'frozen', speed: 'x10' } });
});

check('una generación: errores en español', () => {
  const d = Y.defaultGeneration();
  const bad = (patch, re) => { const r = Y.generationBody({ ...d, ...patch }); assert.equal(r.body, null); assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${r.errors}`); };
  bad({ games: '0' }, /entreno/);
  bad({ n: '17' }, /hijos/);
  bad({ ptGames: '21' }, /pre-torneo/);
  bad({ soldiers: '5' }, /soldados/);
  bad({ learning: 'x' }, /aprendizaje/);
  bad({ duelSpeed: 'x3' }, /velocidad/);
  bad({ trainSpeed: 'x3' }, /velocidad/);
});

check('vista de una casa: su historia, la generación más reciente primero; sin fundar, null', () => {
  const h = { name: 'Casa Hydra', champion: 'hydra-9', generation: 2, founder: 'hydra-7', history: [{ generation: 1, champion: 'hydra-7', won: true }, { generation: 2, champion: 'hydra-9', won: false }] };
  assert.deepEqual(Y.houseView('A', h), { key: 'A', name: 'Casa Hydra', champion: 'hydra-9', generation: 2, founder: 'hydra-7', history: [{ generation: 2, champion: 'hydra-9', won: false }, { generation: 1, champion: 'hydra-7', won: true }] });
  assert.equal(Y.houseView('B', null), null);
  assert.deepEqual(Y.houseView('A', { ...h, history: undefined }).history, []);
});

check('relato de las casas: solo las entradas de dinastía de la crónica, tal cual y la más reciente primero', () => {
  const entries = [
    { text: 'Casa Hydra: Hydra-7 entrena contra Orca-2', kind: 'dynasty', t: 1, id: 5, refs: [{ log: 5 }] },
    { text: 'Hydra-7 se sienta en el trono', kind: 'reign.start', t: 2, id: 6, refs: [{ log: 6 }] },
    { text: 'Duelo de campeonas: gana Hydra-7', kind: 'dynasty', t: 3, id: 9, refs: [{ log: 9 }] },
  ];
  assert.deepEqual(Y.dynastyStory(entries).map((e) => e.id), [9, 5]);
  assert.equal(Y.dynastyStory(entries)[0].text, 'Duelo de campeonas: gana Hydra-7');
  assert.deepEqual(Y.dynastyStory(undefined), []);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (dinastías: lógica)');
process.exitCode = fails ? 1 : 0;
