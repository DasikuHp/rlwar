// Moverse solo donde se puede (spec/10, P1b): huecos de la prueba de mutantes. La tolerancia de 2 u con coma flotante,
// los bocados en los destinos de lib (imposible y línea de tiro), el desempate por distancia de Sniper/Artillery, las
// escalas del ajuste fino y `move: {stay: true}`. Escrito DESPUÉS del código (cubre supervivientes) y congelado.
// En proceso, sin servidor. Uso: node test/moverse-b.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-moverse-b-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const G = await import('../shared/geometry.js');
const lib = await import('../agents/lib.js');
const pol = await import('../shared/policy.js');
const { Room } = await import('../server/rooms.js');
const { compile } = await import('../shared/nn.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');
const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const S = (id, team, x, y) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive: true, turns: 1, lastExpr: '' });

await check('a 2 u calculadas con senos y cosenos (un pelo más por la coma flotante) sigue valiendo', () => {
  const from = { x: 0.3, y: 0.7 };
  const pts = Array.from({ length: 360 }, (_, k) => ({ x: from.x + 2 * Math.cos(k * Math.PI / 180), y: from.y + 2 * Math.sin(k * Math.PI / 180) }));
  const over = pts.filter((p) => Math.hypot(p.x - from.x, p.y - from.y) > 2);
  assert.ok(over.length > 0, 'premisa: alguno sale a más de 2 por redondeo');
  for (const p of over) assert.equal(G.slideMove({ from, requested: p }).reason, 'ok', JSON.stringify(p));
});

await check('lib.moveOptions ve los bocados: un destino abierto por ellos es posible y la línea de tiro pasa por el túnel', () => {
  const me = S('me', 'left', -10, 0), e = S('e', 'right', 10, 0);
  const open = lib.moveOptions(lib.contextFor([me, e], [circle(-8, 0, 0.3)], me, [-8.75, -8.3, -8].map((x) => ({ x, y: 0, r: C.BITE_RADIUS }))));
  assert.equal(open[1].impossible, false, 'el destino → (−8,5, 0) lo abren los bocados');
  assert.equal(lib.moveOptions(lib.contextFor([me, e], [circle(-8, 0, 0.3)], me))[1].impossible, true, 'premisa: sin bocados es imposible');
  // un círculo grande entre los dos y un túnel de bocados a lo largo de y = 0: desde quedarse se ve al enemigo
  const tunnel = Array.from({ length: 13 }, (_, k) => ({ x: -3 + k * 0.5, y: 0, r: C.BITE_RADIUS }));
  const o = lib.moveOptions(lib.contextFor([me, e], [circle(0, 0, 3)], me, tunnel));
  assert.deepEqual([o[0].cover, o[0].los], [1, true]);
  const blind = lib.moveOptions(lib.contextFor([me, e], [circle(0, 0, 3)], me));
  assert.deepEqual([blind[0].cover, blind[0].los], [0, false], 'premisa: sin el túnel no lo ve');
});

await check('Sniper y Artillery: con la misma cobertura gana el destino más lejos del enemigo (y luego el índice)', () => {
  const opt = (i, cover, distEnemy) => ({ i, to: { x: i, y: 0 }, stay: i === 0, impossible: false, why: null, cover, distEnemy, los: cover > 0 });
  const opts = [opt(0, 2, 10), opt(1, 0, 5), opt(2, 0, 8), opt(3, 0, 6), opt(4, 0, 8), opt(5, 1, 20), opt(6, 0, 7), opt(7, 2, 30), opt(8, 0, 4)];
  assert.deepEqual(lib.coverMove(opts, { stayIfCovered: false }), { x: 2, y: 0 });
  assert.deepEqual(lib.coverMove(opts, { stayIfCovered: true }), { x: 2, y: 0 });
  // más empates: con cobertura 0 están el 2 y el 3 (a 7), el 6 (a 6), el 7 (a 11) y el 8 (a 5) → el 7
  const cd = [[2, 10], [1, 8], [0, 7], [0, 7], [1, 12], [1, 19], [0, 6], [0, 11], [0, 5]];
  assert.deepEqual(lib.coverMove(cd.map(([c, d], i) => opt(i, c, d)), { stayIfCovered: false }), { x: 7, y: 0 });
});

await check('red con ajuste: las escalas del ajuste son 0,5 u en x e y', () => {
  const g = normalize({ ...JSON.parse(JSON.stringify(TEMPLATES.turtle.genome)), id: 'escalas-1', name: 'e' });
  const net = compile(g);
  const st = { code: 'T', phase: 'playing', soldiers: [S('me', 'left', -10, 0), S('e', 'right', 10, 5)], obstacles: [], bites: [], players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE } };
  const r = pol.decideMove({ net, genome: g, state: st, soldierId: 'me', memory: net.zeroState(), team: null, rng: makeRng(2), shot: null });
  assert.deepEqual(r.decision.moveAdjust.scales, [0.5, 0.5]);
});

await check('sala: `move: {stay: true}` es quedarse (reason "stay"), no una entrada inválida', () => {
  for (let seed = 1; seed < 100; seed++) {
    const room = new Room('quieto', { soldiersPerPlayer: 1, seed, headless: true });
    room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' });
    room.start();
    const me = room.soldiers.find((s) => s.id === room.turn.soldierId);
    const foe = room.soldiers.find((s) => s !== me);
    Object.assign(foe, { y: me.y > 0 ? me.y - 8 : me.y + 8 }); room.obstacles = []; room.bites = [];
    assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: { stay: true } }).ok);
    assert.deepEqual([room.lastMove.reason, room.lastMove.stayed, room.lastMove.requested], ['stay', true, null]);
    return;
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (moverse-b: huecos de los mutantes de P1b)');
process.exit(fails ? 1 : 0);
