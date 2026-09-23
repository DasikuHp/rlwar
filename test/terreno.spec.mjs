// Terreno de círculos que se rompe y tiro que atraviesa (spec/01 §10, ronda 17; fiel al Graphwar original).
// Escrito ANTES del código y congelado. En proceso, sin servidor. Uso: node test/terreno.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const G = await import('../shared/geometry.js');
const { simulateShot } = await import('../shared/solver.js');
const { tryCompile } = await import('../shared/parser.js');
const { genMap } = await import('../server/mapgen.js');
const { makeRng } = await import('../shared/rng.js');
const { Room } = await import('../server/rooms.js');
const { playGame } = await import('../server/headless.js');
const { assignRewards } = await import('../shared/reward.js');
const P = await import('../shared/percept.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize, eyeDim: eyeDimOf } = await import('../shared/genome.js');

const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const f = (expr) => tryCompile(expr).f;

// ---------- solidez ----------
await check('isSolid: círculo, rectángulo de siempre y bocado; el margen agranda obstáculos y encoge bocados', () => {
  const T = { obstacles: [circle(0, 0, 2), { x: 5, y: 5, w: 2, h: 2 }], bites: [{ x: 1, y: 0, r: 0.78 }] };
  assert.equal(G.isSolid({ x: -1, y: -1 }, T), true);
  assert.equal(G.isSolid({ x: 1.5, y: 1.5 }, T), false, 'fuera del círculo (d = 2,12)');
  assert.equal(G.isSolid({ x: 6, y: 6 }, T), true, 'el rectángulo sigue valiendo');
  assert.equal(G.isSolid({ x: 1, y: 0 }, T), false, 'dentro del bocado');
  assert.equal(G.isSolid({ x: 1.9, y: 0 }, T), true, 'en el círculo, fuera del bocado');
  assert.equal(G.isSolid({ x: 2.1, y: 0 }, T, 0.2), true, 'el margen agranda el círculo');
  assert.equal(G.isSolid({ x: 1.75, y: 0 }, T), true, 'a 0,75 del centro del bocado: fuera de él');
  assert.equal(G.isSolid({ x: 1.7, y: 0 }, T, 0.1), true, 'a 0,70 < 0,78: dentro del bocado, pero el margen lo encoge a 0,68');
  assert.equal(G.isSolid({ x: 0, y: 0 }, [circle(0, 0, 1)]), true, 'también con una lista de obstáculos');
  assert.equal(C.BITE_RADIUS, 0.78);
});

// ---------- el tiro ----------
const shooter = { id: 'a', team: 'left', x: -10, y: 0, alive: true };
await check('un bocado abre un paso que antes estaba cerrado', () => {
  const enemy = { id: 'e', team: 'right', x: 10, y: 0, alive: true };
  const base = { mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [shooter, enemy], shooterId: 'a', obstacles: [circle(0, 0, 0.6)] };
  const blocked = simulateShot(base);
  assert.equal(blocked.result.type, 'obstacle');
  assert.equal(blocked.result.end, 'obstacle');
  const open = simulateShot({ ...base, bites: [{ x: 0, y: 0, r: 0.78 }] });
  assert.equal(open.result.type, 'kill');
  assert.deepEqual(open.result.hits.map((h) => h.soldierId), ['e']);
});
await check('el tiro atraviesa: aliado, enemigo y enemigo en orden; se para en el borde; type kill; el primero en soldierId', () => {
  const ally = { id: 'b', team: 'left', x: -6, y: 0, alive: true };
  const e1 = { id: 'e1', team: 'right', x: 0, y: 0, alive: true }, e2 = { id: 'e2', team: 'right', x: 10, y: 0, alive: true };
  const far = { id: 'e3', team: 'right', x: 5, y: 8, alive: true };
  const s = simulateShot({ mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [shooter, ally, e1, e2, far], shooterId: 'a', obstacles: [] });
  assert.deepEqual(s.result.hits.map((h) => [h.soldierId, h.team]), [['b', 'left'], ['e1', 'right'], ['e2', 'right']]);
  assert.equal(s.result.end, 'wall');
  assert.equal(s.result.type, 'kill');
  assert.equal(s.result.soldierId, 'b');
  const onlyAlly = simulateShot({ mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [shooter, ally], shooterId: 'a', obstacles: [] });
  assert.equal(onlyAlly.result.type, 'suicide');
  const none = simulateShot({ mode: 'function', f: f('0'), start: { x: -10, y: 0 }, dir: 1, soldiers: [shooter], shooterId: 'a', obstacles: [circle(3, 0, 1)] });
  assert.deepEqual([none.result.type, none.result.end, none.result.hits], ['obstacle', 'obstacle', []]);
});

// ---------- la sala ----------
function scene({ seed = 21 } = {}) {
  const room = new Room('terreno', { soldiersPerPlayer: 2, seed, headless: true });
  room.addAgent('chaos', { level: 1, team: 'left' }); room.addAgent('chaos', { level: 1, team: 'right' });
  room.start();
  const pid = room.turn.playerId;
  const sh = room.soldiers.find((s) => s.id === room.turn.soldierId);
  const dir = sh.team === 'left' ? 1 : -1;
  room.obstacles = []; room.bites = [];
  sh.x = -12 * dir; sh.y = 0;
  const ally = room.soldiers.find((s) => s.ownerId === pid && s.id !== sh.id);
  const enemies = room.soldiers.filter((s) => s.team !== sh.team);
  return { room, pid, sh, ally, enemies, dir };
}
await check('sala: un tiro que atraviesa mata a un aliado y a dos enemigos; kill por enemigo, friendlyFire por el aliado, el tirador vivo', () => {
  const { room, pid, sh, ally, enemies, dir } = scene();
  ally.x = -6 * dir; ally.y = 0;
  enemies[0].x = 0; enemies[0].y = 0; enemies[1].x = 10 * dir; enemies[1].y = 0;
  const n0 = room.events.length;
  const r = room.fire(pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([ally.alive, enemies[0].alive, enemies[1].alive, sh.alive], [false, false, false, true]);
  const evs = room.events.slice(n0);
  assert.deepEqual(evs.filter((e) => ['kill', 'friendlyFire'].includes(e.type)).map((e) => [e.type, e.data.victimSoldierId]), [['friendlyFire', ally.id], ['kill', enemies[0].id], ['kill', enemies[1].id]]);
  assert.equal(evs.filter((e) => e.type === 'death').length, 3);
  const shot = evs.find((e) => e.type === 'shot');
  assert.deepEqual([shot.data.result.kills, shot.data.result.friendly, shot.data.result.end], [2, 1, 'wall']);
  assert.deepEqual(shot.data.result.hits, [ally.id, enemies[0].id, enemies[1].id]);
  assert.equal(room.players.find((p) => p.id === pid).kills, 2);
});
await check('sala: el tiro que choca con un círculo arranca un bocado en su final; el mismo tiro después llega más lejos', () => {
  const { room, pid, sh, ally, enemies, dir } = scene({ seed: 22 });
  ally.x = -20 * dir; ally.y = 10; enemies[0].x = 20 * dir; enemies[0].y = 10; enemies[1].x = 20 * dir; enemies[1].y = -10;
  room.obstacles = [circle(0, 0, 3)];
  const r1 = room.fire(pid, { mode: 'function', expr: '0', move: 'stay' });
  assert.equal(r1.result.end, 'obstacle');
  assert.equal(room.bites.length, 1);
  const b = room.bites[0];
  assert.ok(Math.abs(b.x - r1.result.x) < 1e-9 && Math.abs(b.y - r1.result.y) < 1e-9 && b.r === C.BITE_RADIUS, JSON.stringify(b));
  const shotEv = room.events.filter((e) => e.type === 'shot').pop();
  assert.deepEqual(shotEv.data.bite, b, 'el evento del tiro lleva su bocado (para la moviola)');
  assert.deepEqual(room.snapshot().bites, room.bites, 'el snapshot lleva los bocados');
  // el mismo tiro desde el mismo sitio: el terreno se ha comido y llega más adentro
  const again = simulateShot({ mode: 'function', f: f('0'), start: { x: sh.x, y: sh.y }, dir, soldiers: [], shooterId: sh.id, obstacles: room.obstacles, bites: room.bites });
  assert.ok(dir * again.result.x > dir * r1.result.x + 0.3, `${again.result.x} más allá de ${r1.result.x}`);
});
await check('sin renovación: 12 fallos seguidos no cambian el mapa; la partida sigue hasta el tope de disparos', () => {
  const { room } = scene({ seed: 23 });
  const map0 = JSON.stringify(room.obstacles);
  for (let i = 0; i < 12 && room.phase === 'playing'; i++) {
    const s = room.soldiers.find((x) => x.id === room.turn.soldierId);
    const r = room.fire(room.turn.playerId, { mode: 'function', expr: 'sqrt(-1)', move: 'stay' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(s.alive);
  }
  assert.equal(room.remaps, 0);
  assert.equal(JSON.stringify(room.obstacles), map0, 'los obstáculos no cambian (solo se añaden bocados)');
  assert.ok(!room.chat.some((c) => /renovado/.test(c.text)));
  while (room.phase === 'playing') room.fire(room.turn.playerId, { mode: 'function', expr: 'sqrt(-1)', move: 'stay' });
  assert.equal(room.result.byLimit, true);
  assert.equal(room.result.shots, C.MAX_SHOTS);
  assert.equal(room.result.remaps, 0);
});

// ---------- mapas ----------
await check('mapas: con semilla, deterministas; 8–22 círculos de radio 1–4; soldados fuera de los círculos con 1 u de margen y a 3 u entre sí', () => {
  const biomes = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const a = genMap(4, makeRng(seed)), b = genMap(4, makeRng(seed));
    assert.deepEqual(a.obstacles, b.obstacles, `semilla ${seed}`);
    biomes.add(a.biome);
    assert.ok(a.obstacles.length >= 8 && a.obstacles.length <= 22, `semilla ${seed}: ${a.obstacles.length} círculos`);
    for (const o of a.obstacles) { assert.equal(o.kind, 'circle'); assert.ok(o.r >= 1 && o.r <= 4, `r ${o.r}`); assert.ok(o.x >= C.PLANE.xMin && o.x <= C.PLANE.xMax && o.y >= C.PLANE.yMin && o.y <= C.PLANE.yMax); }
    if (a.biome === 'fortaleza') assert.ok(a.obstacles.filter((o) => o.r >= 3.5 && Math.abs(o.x) <= 4).length >= 2, `fortaleza ${seed}`);
    if (a.biome === 'llanura') { assert.ok(a.obstacles.length >= 8 && a.obstacles.length <= 10); assert.ok(a.obstacles.every((o) => o.r <= 2.5)); }
    for (const side of ['left', 'right']) {
      const pts = a.placeSide(side, 4);
      for (const p of pts) for (const o of a.obstacles) assert.ok(Math.hypot(p.x - o.x, p.y - o.y) > o.r + 1 - 1e-9, `semilla ${seed}: soldado en (${p.x},${p.y}) pegado a un círculo`);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 3 - 1e-9);
    }
  }
  assert.deepEqual([...biomes].sort(), ['fortaleza', 'llanura', 'ruinas']);
});
await check('una partida sin pantalla con semilla es la misma dos veces, con sus bocados; los bocados salen de los tiros', () => {
  const a = playGame({ seed: 77, left: 'artillery', right: 'greedy', soldiers: 2 });
  const b = playGame({ seed: 77, left: 'artillery', right: 'greedy', soldiers: 2 });
  assert.deepEqual(a.room.bites, b.room.bites);
  assert.deepEqual(a.room.events.map((e) => [e.type, e.data && e.data.result ? e.data.result.hits : null]), b.room.events.map((e) => [e.type, e.data && e.data.result ? e.data.result.hits : null]));
  const fromShots = a.room.events.filter((e) => e.type === 'shot' && e.data.bite).map((e) => e.data.bite);
  assert.deepEqual(fromShots, a.room.bites, 'la moviola puede rehacer el terreno turno a turno');
  const start = a.room.events.find((e) => e.type === 'game.start');
  assert.deepEqual(start.data.map.obstacles, a.room.obstacles, 'el inicio de la partida lleva los obstáculos (los bocados salen de los tiros)');
  assert.ok(a.room.obstacles.every((o) => o.kind === 'circle'));
});

// ---------- recompensa ----------
await check('recompensa: kill cuenta por cada enemigo del tiro y friendlyFire por cada aliado', () => {
  const reward = { ...TEMPLATES.sniper.genome.reward, normalize: false };
  const events = [
    { id: 1, type: 'decision', actor: { playerId: 'p', soldierId: 's' }, data: {} },
    { id: 2, type: 'shot', actor: { playerId: 'p', soldierId: 's' }, data: { decisionEventId: 1, result: { type: 'kill', soldierId: 'x', hits: ['x', 'y', 'z'], kills: 2, friendly: 1, end: 'wall' }, minDist: 0 } },
  ];
  const trajectory = { soldiers: { s: [{ turn: 1, phase: 'shoot', obs: null, decision: { eventId: 1 } }] } };
  const r = assignRewards({ reward, teamSpirit: 0, events, trajectory, playerId: 'p' });
  assert.equal(r.entries[0].terms.kill, 2 * reward.kill);
  assert.equal(r.entries[0].terms.friendlyFire, reward.friendlyFire);
});

// ---------- percepción ----------
await check('percepción: mismas longitudes con círculos y bocados; el hueco de un círculo es su caja; el Radar ve el bocado', () => {
  const g = normalize(TEMPLATES.turtle.genome); // Rasgos + Radar + Reloj
  const soldiers = [{ id: 'a', team: 'left', ownerId: 'pL', x: -10, y: 0, alive: true, turns: 0 }, { id: 'e', team: 'right', ownerId: 'pR', x: 15, y: 5, alive: true, turns: 0 }];
  const base = { code: 'T', phase: 'playing', soldiers, obstacles: [circle(0, 0, 2)], bites: [], players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE } };
  const o1 = P.observe(base, 'a', g, { phase: 'shoot', rng: makeRng(1) });
  const o2 = P.observe({ ...base, bites: [{ x: -2, y: 0, r: 0.78 }] }, 'a', g, { phase: 'shoot', rng: makeRng(1) });
  for (const [id, v] of Object.entries(o1.ctx)) assert.equal(o2.ctx[id].length, v.length, `ojo ${id}`);
  const radar = g.blocks.find((b) => b.type === 'eye.radar');
  const d1 = o1.ctx[radar.id][0], d2 = o2.ctx[radar.id][0]; // rayo 0: hacia +x (marco local del equipo izquierdo)
  assert.ok(Math.abs(d1 * 58 - 8) <= 0.26, `rayo hasta el círculo (spec/03: distancia / 58): ${d1 * 58}`);
  assert.ok(d2 > d1, 'con el bocado, el rayo llega más lejos');
  const ob = { id: 'ob', type: 'eye.obstacles', params: { slots: 2 } };
  const g2 = normalize({ ...TEMPLATES.empty.genome, blocks: [...TEMPLATES.empty.genome.blocks, ob] });
  const o3 = P.observe(base, 'a', g2, { phase: 'shoot', rng: makeRng(1) });
  assert.deepEqual(Array.from(o3.ctx.ob).slice(0, 5), [0, 0, 4 / 10, 4 / 15, 1]);
});

await check('Simulador: con un tiro que atraviesa, mata a alguno y da a un aliado; fin = primer impacto; "Contar bajas" añade las cuentas', () => {
  const me = { id: 'a', team: 'left', ownerId: 'pL', x: -10, y: 0, alive: true, turns: 0 };
  const ally = { id: 'b', team: 'left', ownerId: 'pL', x: -6, y: 0, alive: true, turns: 0 };
  const e1 = { id: 'e1', team: 'right', ownerId: 'pR', x: 0, y: 0, alive: true, turns: 0 }, e2 = { id: 'e2', team: 'right', ownerId: 'pR', x: 10, y: 0, alive: true, turns: 0 };
  const ctx = { soldiers: [me, ally, e1, e2], obstacles: [], bites: [], soldier: me, team: 'left' };
  const cand = { family: 'line', mode: 'function', expr: '0', params: [0, 0, 0], angle: 0, team: 'left' };
  const sim = P.simulateCandidate(cand, ctx, true);
  const v = P.simulatorFeatures(sim, ctx);
  assert.equal(v.length, 10);
  assert.deepEqual(Array.from(v).slice(0, 5), [1, 1, 0, 0, 0], 'mata a alguno, da a un aliado; sin fin porque alcanzó a alguien');
  assert.ok(Math.abs(v[6] * 25 - (-6)) < 0.2, `fin = el primer impacto (el aliado en x = −6): ${v[6] * 25}`);
  const v2 = P.simulatorFeatures(sim, ctx, { counts: true });
  assert.equal(v2.length, 12);
  assert.deepEqual(Array.from(v2).slice(10), [2 / 4, 1 / 4]);
  const g = normalize(TEMPLATES.seer.genome);
  const simBlock = g.blocks.find((b) => b.type === 'eye.simulator');
  assert.equal(eyeDimOf({ ...simBlock, params: { ...simBlock.params, counts: true } }, g), 12);
  assert.equal(eyeDimOf(simBlock, g), 10);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (terreno de círculos que se rompe y tiro que atraviesa)');
process.exitCode = fails ? 1 : 0;
