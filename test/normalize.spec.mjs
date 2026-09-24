// normalize() y las decisiones de la red (auditoría de la sesión 3, 2026-09-24; H4). Antes, cada decisión copiaba el
// genoma entero (pesos incluidos) dos veces: decideShot/decideMove lo normalizaban y observe() volvía a hacerlo (12 % del
// tiempo de una partida). Para quitar una copia sin cambiar nada hacen falta dos cosas, que fija este test: (1) normalize
// es idempotente (normalizar lo ya normalizado da lo mismo) en las plantillas y en hijas mutadas; (2) ni observe ni
// decideShot ni decideMove tocan el genoma que reciben, y observar el genoma tal cual o ya normalizado da lo mismo.
// Guarda escrita ANTES del cambio (pasa ya: el cambio no debe alterar ningún resultado) y congelada.
// Uso: node test/normalize.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-normalize-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const { normalize } = await import('../shared/genome.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { compile } = await import('../shared/nn.js');
const { mutate, DEFAULT_MUTATION } = await import('../evo/mutate.js');
const { makeRng } = await import('../shared/rng.js');
const P = await import('../shared/percept.js');
const policy = await import('../shared/policy.js');
const { Room } = await import('../server/rooms.js');

// genomas: las plantillas, una sin la mitad de sus campos y 30 hijas mutadas de cada plantilla que juega
const genomes = [];
for (const [key, t] of Object.entries(TEMPLATES)) {
  genomes.push(clone(t.genome));
  const { traits, reward, learning, ...rest } = clone(t.genome); genomes.push({ ...rest, id: `sin-campos-${key}` });
  if (!t.genome.blocks || !t.genome.blocks.length) continue;
  for (let s = 1; s <= 30; s++) genomes.push(mutate({ ...clone(t.genome), id: `madre-${key}`, name: `Madre ${key}` }, DEFAULT_MUTATION, makeRng(s), { sibling: s }).child);
}

await check(`normalize es idempotente (${genomes.length} genomas: plantillas, incompletos e hijas mutadas)`, () => {
  for (const g of genomes) {
    const a = normalize(g);
    assert.ok(isDeepStrictEqual(normalize(a), a), `${g.id}: normalizar dos veces cambia el genoma`);
  }
});

// una sala real a medio jugar: el estado que ve una red
const state = (() => {
  const room = new Room('normalize', { soldiersPerPlayer: 2, seed: 12, headless: true });
  room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' });
  room.start();
  for (let i = 0; i < 3 && room.phase === 'playing'; i++) room.fire(room.turn.playerId, { mode: 'function', expr: `${0.1 * (i + 1)}*x`, move: 'stay' });
  return room.snapshot();
})();
const netsPlaying = genomes.filter((g) => g.blocks && g.blocks.some((b) => b.type === 'hand.choose')).slice(0, 25);

await check('observe no toca el genoma y da lo mismo con el genoma tal cual o ya normalizado', () => {
  const me = state.soldiers.find((s) => s.alive);
  for (const g of netsPlaying) {
    const raw = clone(g), norm = normalize(g), keep = clone(norm);
    const a = P.observe(state, me.id, raw, { phase: 'shoot', rng: makeRng(3) });
    const b = P.observe(state, me.id, norm, { phase: 'shoot', rng: makeRng(3) });
    assert.ok(isDeepStrictEqual(a, b), `${g.id}: observar el genoma normalizado da otra cosa`);
    assert.ok(isDeepStrictEqual(norm, keep), `${g.id}: observe modificó el genoma`);
    assert.ok(isDeepStrictEqual(P.observe(state, me.id, norm, { phase: 'move' }), P.observe(state, me.id, raw, { phase: 'move' })));
  }
});

await check('decideShot y decideMove no tocan el genoma que reciben', () => {
  const me = state.soldiers.find((s) => s.alive);
  for (const g of netsPlaying) {
    const norm = normalize(g), keep = clone(norm);
    const net = compile(norm);
    policy.decideShot({ net, genome: norm, state, soldierId: me.id, memory: net.zeroState(), rng: makeRng(5) });
    policy.decideMove({ net, genome: norm, state, soldierId: me.id, memory: net.zeroState(), rng: makeRng(6) });
    assert.ok(isDeepStrictEqual(norm, keep), `${g.id}: la decisión modificó el genoma`);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (normalize idempotente; las decisiones no tocan el genoma)');
process.exitCode = fails ? 1 : 0;
