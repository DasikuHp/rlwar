// Terreno (spec/01 §10.1), caso de la auditoría de la sesión 3 (2026-09-24): "solo se guarda el bocado si toca algún
// obstáculo". Tocar = el círculo del bocado (radio BITE_RADIUS) y el obstáculo se solapan: distancia del punto final al
// obstáculo menor que 0,78 u. Antes, con un rectángulo se miraba su caja agrandada 0,78 u y un final junto a la esquina
// (a 0,99 u de ella) guardaba un bocado que no tocaba nada. Escrito ANTES del arreglo y congelado.
// Uso: node test/terreno-extra-c.spec.mjs   (todo en proceso, sin servidor)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-terreno-c-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const C = await import('../shared/constants.js');
const { Room } = await import('../server/rooms.js');
const BR = C.BITE_RADIUS;

// sala sin terreno; el tirador del turno en (∓12, 0) dispara la recta y = 0, que acaba en el borde lateral (±25, 0); los
// demás, lejos del recorrido. `obstacles` se da para el equipo izquierdo y se refleja (x → −x) si tira el derecho
const shootFlat = (team, obstacles) => {
  let room = null, me = null;
  for (let seed = 1; seed < 200 && !room; seed++) {
    const r0 = new Room('bocado', { soldiersPerPlayer: 2, seed, headless: true });
    r0.addAgent('chaos', { level: 1, team: 'left' }); r0.addAgent('chaos', { level: 1, team: 'right' });
    r0.start();
    const m0 = r0.soldiers.find((s) => s.id === r0.turn.soldierId);
    if (m0.team === team) { room = r0; me = m0; }
  }
  assert.ok(room, `premisa: alguna semilla da el primer turno a ${team}`);
  const dir = me.team === 'left' ? 1 : -1;
  const flip = (o) => (o.kind === 'circle' ? { ...o, x: o.x * dir } : dir > 0 ? { ...o } : { ...o, x: -(o.x + o.w) });
  room.obstacles = obstacles.map(flip); room.bites = [];
  Object.assign(me, { x: -12 * dir, y: 0 });
  let k = 0;
  for (const s of room.soldiers) if (s !== me) { Object.assign(s, { x: (s.team === me.team ? -20 : 20) * dir, y: k % 2 ? 10 : -10 }); k++; }
  const r = room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: 'stay' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.end, 'wall', 'premisa: la recta acaba en el borde');
  assert.ok(Math.abs(Math.abs(r.result.x) - 25) < 1e-9 && Math.abs(r.result.y) < 1e-9, `premisa: acaba en (±25, 0): ${r.result.x}, ${r.result.y}`);
  return room.bites;
};

await check('rectángulo: un final a 0,99 u en diagonal de la esquina no le arranca bocado (la caja agrandada sí lo tocaba)', () => {
  // esquina de abajo a la derecha en (24,3, 0,7): a √(0,7² + 0,7²) ≈ 0,99 u de (25, 0)
  for (const team of ['left', 'right']) assert.deepEqual(shootFlat(team, [{ x: 21.3, y: 0.7, w: 3, h: 3 }]), []);
});

await check('rectángulo: un final a 0,7 u de su lado de abajo sí le arranca bocado', () => {
  for (const team of ['left', 'right']) {
    const bites = shootFlat(team, [{ x: 23, y: 0.7, w: 4, h: 2 }]);
    assert.equal(bites.length, 1);
    assert.equal(bites[0].r, BR);
  }
});

await check('círculo: toca si la distancia entre centros es menor que r + 0,78 (justo por debajo sí, justo por encima no)', () => {
  for (const team of ['left', 'right']) {
    assert.equal(shootFlat(team, [{ kind: 'circle', x: 25, y: 1 + BR - 0.01, r: 1 }]).length, 1);
    assert.deepEqual(shootFlat(team, [{ kind: 'circle', x: 25, y: 1 + BR + 0.01, r: 1 }]), []);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (terreno: el bocado solo si toca)');
process.exitCode = fails ? 1 : 0;
