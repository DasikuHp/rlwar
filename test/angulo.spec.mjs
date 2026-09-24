// Ángulo de artillería (auditoría de la sesión 3, 2026-09-24; spec/01 §7b y AGENTS.md): la API y los heurísticos dan el
// ángulo de `ode2` en GRADOS (−85..85) y el solver lo quiere en RADIANES (`simulateShot`, como fijan percepcion-extra y
// motor.spec). Antes, la sala y los heurísticos le pasaban los grados tal cual: 30° salía a −81° (casi en picado) y el
// Simulador de una red (que sí convierte) imaginaba un tiro distinto del que disparaba la sala. Escrito ANTES del arreglo
// y congelado. Uso: node test/angulo.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-angulo-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const rad = (deg) => deg * Math.PI / 180;

const { simulateShot } = await import('../shared/solver.js');
const { tryCompile } = await import('../shared/parser.js');
const P = await import('../shared/percept.js');
const lib = await import('../agents/lib.js');
const { createAgent } = await import('../agents/registry.js');
const { makeRng } = await import('../shared/rng.js');
const { Room } = await import('../server/rooms.js');

// sala sin obstáculos cuyo primer turno es de `team`; el tirador en (∓15, −10) y el rival arriba, en la esquina de su mitad
const roomFor = (team, agent = 'sniper') => {
  for (let seed = 1; seed < 200; seed++) {
    const room = new Room('angulo', { soldiersPerPlayer: 1, seed, headless: true });
    room.addAgent(agent, { level: 3, team: 'left' }); room.addAgent(agent, { level: 3, team: 'right' });
    room.start();
    const me = room.soldiers.find((s) => s.id === room.turn.soldierId);
    if (me.team !== team) continue;
    room.obstacles = []; room.bites = [];
    const dir = team === 'left' ? 1 : -1;
    Object.assign(me, { x: -15 * dir, y: -10 });
    for (const s of room.soldiers) if (s !== me) Object.assign(s, { x: 23 * dir, y: 13 });
    return { room, me, dir, pid: room.turn.playerId };
  }
  throw new Error(`premisa: ninguna semilla da el primer turno a ${team}`);
};
const endOf = (r) => [r.x, r.y];

await check('sala: un tiro ode2 con ángulo en grados sigue el recorrido del solver con ese ángulo en radianes (los dos bandos)', () => {
  for (const team of ['left', 'right']) {
    for (const [expr, deg] of [['-0.05', 35], ['-0.05', 30], ['-0.02', 10], ['-0.1', 60], ['-0.05', 85], ['-0.05', -20], ['0', 45]]) {
      const { room, me, dir, pid } = roomFor(team);
      const want = simulateShot({ mode: 'ode2', f: tryCompile(expr).f, start: { x: me.x, y: me.y }, dir, angle: rad(deg), soldiers: room.soldiers, obstacles: [], bites: [], shooterId: me.id }).result;
      const r = room.fire(pid, { mode: 'ode2', expr, angle: deg, move: 'stay' });
      assert.ok(r.ok, JSON.stringify(r));
      assert.deepEqual(endOf(r.result), endOf(want), `${team} ${expr} a ${deg}°: acaba en ${endOf(r.result)} y el solver en radianes dice ${endOf(want)}`);
      assert.equal(r.result.end, want.end);
    }
  }
});

await check('sala: 30° con y\'\' = 0 sube en línea recta con pendiente tan(30°) hasta el borde (spec/01 §7b), en los dos bandos', () => {
  for (const team of ['left', 'right']) {
    const { room, pid } = roomFor(team);
    const r = room.fire(pid, { mode: 'ode2', expr: '0', angle: 30, move: 'stay' });
    // desde (∓15, −10) recorre 40 u de x hasta el borde lateral: y = −10 + 40·tan(30°) ≈ 13,09 (con 30 radianes bajaría en picado)
    assert.equal(r.result.end, 'wall');
    assert.ok(Math.abs(Math.abs(r.result.x) - 25) < 1e-9, `x final ${r.result.x}`);
    assert.ok(Math.abs(r.result.y - (-10 + 40 * Math.tan(rad(30)))) < 0.05, `${team}: y final ${r.result.y}`);
  }
});

await check('lo que imagina el Simulador de una red para un candidato de artillería es lo que dispara la sala', () => {
  for (const team of ['left', 'right']) {
    const { room, me, pid } = roomFor(team);
    const cand = { i: 0, family: 'artillery', params: [0.05, 35, 0], mode: 'ode2', exprLocal: '-0.0500', expr: '-0.0500', angle: 35 };
    const sim = P.simulateCandidate(cand, { soldiers: room.soldiers, obstacles: [], bites: [], soldier: me, team }, false);
    const r = room.fire(pid, { mode: 'ode2', expr: cand.expr, angle: cand.angle, move: 'stay' });
    const endLocal = P.toLocal({ x: r.result.x, y: r.result.y }, team);
    assert.ok(Math.abs(endLocal.x - sim.endX) < 1e-9 && Math.abs(endLocal.y - sim.endY) < 1e-9, `${team}: la sala acaba en (${endLocal.x}, ${endLocal.y}) y el Simulador en (${sim.endX}, ${sim.endY})`);
  }
});

await check('heurísticos: lib.sim convierte el ángulo (grados) igual que la sala', () => {
  for (const team of ['left', 'right']) {
    const { room, me, dir } = roomFor(team);
    const ctx = lib.contextFor(room.soldiers, room.obstacles, me, room.bites);
    for (const deg of [-40, 15, 35, 70]) {
      const s = lib.sim(ctx, { mode: 'ode2', expr: '-0.05', angle: deg }, false);
      const want = simulateShot({ mode: 'ode2', f: tryCompile('-0.05').f, start: { x: me.x, y: me.y }, dir, angle: rad(deg), soldiers: room.soldiers, obstacles: [], bites: [], shooterId: me.id }).result;
      assert.deepEqual(endOf(s.shot.result), endOf(want), `${team} ${deg}°`);
    }
  }
});

await check('heurístico Artillery: el tiro que elige acaba en la sala donde él lo simuló', () => {
  for (const team of ['left', 'right']) {
    const { room, me, pid } = roomFor(team, 'artillery');
    const agent = createAgent('artillery', { level: 3 });
    const choice = agent.chooseShot({ soldiers: room.soldiers, obstacles: room.obstacles, bites: room.bites, soldier: me, history: [], rng: makeRng(5), moveOptions: [] });
    assert.equal(choice.mode, 'ode2', 'premisa: Artillery dispara ode2');
    const ctx = lib.contextFor(room.soldiers, room.obstacles, me, room.bites);
    const imagined = lib.sim(ctx, choice, false).shot.result;
    const r = room.fire(pid, { mode: choice.mode, expr: choice.expr, angle: choice.angle, move: 'stay' });
    assert.deepEqual(endOf(r.result), endOf(imagined), `${team}: ${choice.expr} a ${choice.angle}°`);
    assert.deepEqual(r.result.hits.map((h) => h.soldierId), imagined.hits.map((h) => h.soldierId));
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (ángulo de artillería en grados)');
process.exitCode = fails ? 1 : 0;
