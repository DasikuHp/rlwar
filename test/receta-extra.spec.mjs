// Receta de entreno (spec/04 §11), casos que destapó la auditoría del 2026-09-24. Escrito ANTES del código y congelado.
// - A1: con `duration.minutes`, el reloj del entreno (y el avance de los programas) empieza tras el examen de antes y no
//   cuenta las pausas: pedir 12 s de entreno es entrenar 12 s.
// - Huecos de la prueba de mutantes de evo/recipe.js: el coseno con destino distinto de 0, pesos de rivales negativos o
//   que no son números, una regla de recompensa que no es un número, exactamente 20 partidas, una primera ventana sin
//   victorias, los bordes de cada rango (valen) y lo que queda fuera (no vale), y `given` solo con lo pedido.
// Uso: node test/receta-extra.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-receta-extra-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const R = await import('../evo/recipe.js');
const T = await import('../evo/train.js');
const store = await import('../evo/store.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');

const net = () => normalize({ ...clone(TEMPLATES.sniper.genome), id: 'n1', name: 'N1', frozen: ['md'] });
const G = { games: 100 };
const ok = (body, g = net()) => { const r = R.validateRecipe({ duration: G, ...body }, g); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r.recipe; };
const bad = (body, re, g = net()) => {
  const r = R.validateRecipe({ duration: G, ...body }, g);
  assert.equal(r.ok, false, `debería fallar: ${JSON.stringify(body)}`);
  assert.ok(r.errors.some((e) => re.test(e.message) || re.test(e.field || '')), `${JSON.stringify(body)} → ${r.errors.map((e) => e.message).join(' | ')}`);
};
const L = (over = {}) => ({ name: 'Lección', ...over });

// ---------- A1: el reloj del entreno ----------
await check('minutos: el reloj del entreno y el de los programas empiezan tras el examen de antes y no cuentan las pausas', async () => {
  const r0 = store.saveNet({ ...clone(TEMPLATES.sniper.genome), id: 'reloj-a', name: 'reloj-a' }); assert.ok(r0.ok);
  const MIN = 0.2, PAUSE = 2500; // 12 s de entreno pedidos; una pausa de 2,5 s en medio
  const t = T.createTrainer({ netId: 'reloj-a', speed: 'turbo', workers: 1, duration: { minutes: MIN }, soldiers: 1, seed: 4500,
    opponents: { antagonist: 0, hallOfFame: 0, self: 1 }, exam: true, schedule: { temperature: { shape: 'linear', from: 1.5, to: 0.5 } } });
  const at = {}; const sleeps = [];
  t.on('exam', (d) => { if (d.when === 'before') { at.before = Date.now(); setTimeout(() => t.pause(), 2000); setTimeout(() => t.resume(), 2000 + PAUSE); } });
  t.on('training', () => { if (t.phase === 'exam-after' && !at.loopEnd) at.loopEnd = Date.now(); });
  t.on('sleep', (d) => sleeps.push(d.update.applied));
  await t.start();
  assert.equal(t.status, 'done', t.error || '');
  assert.ok(at.before && at.loopEnd, 'premisa: hubo examen de antes y de después');
  const trained = at.loopEnd - at.before;
  // margen de 1 s: la pausa empieza de verdad cuando acaba la partida en curso (sin el arreglo salen 7–12 s)
  assert.ok(trained >= MIN * 60000 + PAUSE - 1000, `entrenó ${trained} ms tras el examen (pedidos ${MIN * 60000} + ${PAUSE} de pausa)`);
  assert.ok(sleeps.length > 0 && Math.abs(sleeps[0].temperature - 1.5) < 0.02, `T del primer lote ${sleeps.length ? sleeps[0].temperature : '—'} (empieza en 1,5)`);
});

// ---------- programas ----------
await check('scheduleValue: el coseno con destino distinto de 0', () => {
  const cos = { shape: 'cosine', from: 1, to: 0.2 };
  assert.ok(Math.abs(R.scheduleValue(cos, 0.25) - (0.2 + 0.8 * (1 + Math.cos(Math.PI / 4)) / 2)) < 1e-12);
  assert.ok(Math.abs(R.scheduleValue(cos, 1) - 0.2) < 1e-12);
  assert.ok(Math.abs(R.scheduleValue({ shape: 'linear', from: 2, to: 1 }, 0.5) - 1.5) < 1e-12);
});
await check('programas: los extremos de cada rango valen', () => {
  ok({ schedule: { lr: { shape: 'linear', from: 1e-5, to: 0.1 }, temperature: { shape: 'cosine', from: 0.05, to: 3 }, entropy: { shape: 'linear', from: 0, to: 0.5 } } });
});

// ---------- aprendizaje ----------
await check('learning: los extremos valen; NaN, infinito o fuera del rango no', () => {
  ok({ learning: { gradient: { lr: 0.1, entropy: 0, batchGames: 64 }, evolution: { sigma: 1e-4, population: 2 } } });
  ok({ learning: { gradient: { lr: 1e-5, batchGames: 1 }, evolution: { population: 128 } } });
  bad({ learning: { gradient: { lr: NaN } } }, /lr/);
  bad({ learning: { gradient: { lr: Infinity } } }, /lr/);
  bad({ learning: { gradient: { batchGames: 65 } } }, /batchGames/);
  bad({ learning: { evolution: { sigma: 0 } } }, /sigma/);
});

// ---------- recompensa de práctica ----------
await check('recompensa: ±5 valen; 5,5, −5,5 y lo que no es un número no', () => {
  assert.deepEqual(ok({ reward: { kill: 5, die: -5 } }).reward, { kill: 5, die: -5 });
  bad({ reward: { kill: 5.5 } }, /kill/);
  bad({ reward: { die: -5.5 } }, /die/);
  bad({ reward: { kill: '1' } }, /kill/);
  bad({ reward: { kill: NaN } }, /kill/);
});

// ---------- currículo ----------
await check('currículo: 16 lecciones, un nombre de 40 letras, 4 soldados y ventana 100 valen; 0 soldados y ventana 101 no', () => {
  assert.equal(ok({ curriculum: Array.from({ length: 16 }, (_, i) => L({ name: `L${i}` })) }).curriculum.length, 16);
  ok({ curriculum: [L({ name: 'x'.repeat(40), soldiers: 4, until: { winRate: 0.5, window: 100 } }), L()] });
  bad({ curriculum: [L({ soldiers: 0 })] }, /soldados|soldiers/);
  bad({ curriculum: [L({ until: { winRate: 0.5, window: 101 } }), L()] }, /window|ventana/);
});
await check('currículo: tasa de victorias 0 y 1 valen; −0,1 no; una recompensa que no es un número no', () => {
  ok({ curriculum: [L({ until: { winRate: 0 } }), L({ until: { winRate: 1 } }), L()] });
  bad({ curriculum: [L({ until: { winRate: -0.1 } }), L()] }, /winRate|tasa/);
  bad({ curriculum: [L({ until: { reward: 'mucho' } }), L()] }, /reward|recompensa/);
  bad({ curriculum: [L({ until: { reward: Infinity } }), L()] }, /reward|recompensa/);
});
await check('currículo: los pesos de los rivales de una lección tienen que ser números de 0 o más', () => {
  bad({ curriculum: [L({ opponents: { antagonist: -1, hallOfFame: 0, self: 2 } })] }, /≥ 0|rivales/);
  bad({ curriculum: [L({ opponents: { antagonist: '1', hallOfFame: 0, self: 1 } })] }, /≥ 0|rivales/);
  ok({ curriculum: [L({ opponents: { antagonist: 0, hallOfFame: 0, self: 0.5 } })] });
});

// ---------- quedarse con la mejor ----------
await check('mejor versión: con exactamente 20 partidas ya hay tasa; una primera ventana sin victorias cuenta como la mejor', () => {
  const t = R.createBestTracker(20);
  const improved = Array.from({ length: 20 }, (_, k) => t.record(0, k));
  assert.deepEqual(improved.slice(0, 19), Array(19).fill(false));
  assert.equal(improved[19], true, 'la primera tasa (0) mejora a "ninguna"');
  assert.deepEqual(t.result(), { best: 0, final: 0, atGame: 19 });
  assert.equal(t.record(0, 20), false, 'una tasa igual no mejora');
  assert.equal(t.result().atGame, 19);
});

// ---------- lo pedido ----------
await check('given: la receta guarda solo lo que se pidió (sin duración ni campos del entreno)', () => {
  const r = R.validateRecipe({ duration: G, speed: 'turbo', learning: { gradient: { lr: 0.01 } }, keepBest: false }, net());
  assert.deepEqual(r.recipe.given, { learning: { gradient: { lr: 0.01 } }, keepBest: false });
  assert.deepEqual(R.validateRecipe({ duration: G }, net()).recipe.given, {});
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (receta de entreno: casos de la auditoría)');
process.exitCode = fails ? 1 : 0;
