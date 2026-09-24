// F1 — Geometría del movimiento (spec/01 §3): propiedades sobre escenas aleatorias y casos de borde.
// Complementa test/motor.spec.mjs (que la prueba de mutantes mostró corto en este módulo). Sin servidor.
// P1b (2026-09-24, OK del usuario): ya no se desliza; se retiran "deslizamiento" y "rejilla polar" (los sustituye
// test/moverse.spec.mjs) y las 150 escenas comprueban la regla nueva.
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const C = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const { slideMove, isValidMove, insideExpanded, segmentClear } = await import('../shared/geometry.js');

const PLANE = C.PLANE, R = C.MOVE_RADIUS, BODY = C.BODY, SEP = C.MIN_SEPARATION;
// validez independiente (copiada de la spec, no del código)
const inRect = (P, o) => !(P.x < o.x - BODY || P.x > o.x + o.w + BODY || P.y < o.y - BODY || P.y > o.y + o.h + BODY);
const segOk = (from, P, obstacles) => {
  for (let k = 1; k <= 10; k++) {
    const t = k / 10, Q = { x: from.x + (P.x - from.x) * t, y: from.y + (P.y - from.y) * t };
    if (obstacles.some((o) => inRect(Q, o))) return false;
  }
  return true;
};
const valid = (P, from, soldiers, selfId, obstacles) =>
  dist(P, from) <= R + 1e-9 &&
  P.x >= PLANE.xMin + BODY && P.x <= PLANE.xMax - BODY && P.y >= PLANE.yMin + BODY && P.y <= PLANE.yMax - BODY &&
  obstacles.every((o) => !inRect(P, o)) &&
  soldiers.every((s) => s.id === selfId || !s.alive || dist(P, s) >= SEP) &&
  segOk(from, P, obstacles);


check('escenas aleatorias (150): lo pedido tal cual si vale; si no, quieto con "blocked" y su motivo (sin deslizar, spec/10)', () => {
  let blocked = 0, direct = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rng = makeRng(seed);
    const from = { x: PLANE.xMin + 1 + rng() * 48, y: PLANE.yMin + 1 + rng() * 28 };
    const obstacles = Array.from({ length: rng.int(5) }, () => ({ x: from.x - 4 + rng() * 8, y: from.y - 4 + rng() * 8, w: 0.3 + rng() * 5, h: 0.3 + rng() * 5 }));
    const soldiers = [{ id: 'me', team: 'left', x: from.x, y: from.y, alive: true }];
    for (let i = 0; i < rng.int(4); i++) soldiers.push({ id: 's' + i, team: rng() < 0.5 ? 'left' : 'right', x: from.x - 3 + rng() * 6, y: from.y - 3 + rng() * 6, alive: rng() < 0.7 });
    const roll = rng();
    const requested = roll < 0.1 ? 'stay' : roll < 0.15 ? { x: NaN, y: 1 } : { x: from.x - 3 + rng() * 6, y: from.y - 3 + rng() * 6 };
    const r = slideMove({ from, requested, soldiers, obstacles, selfId: 'me' });
    assert.ok(r && r.to && Number.isFinite(r.to.x) && Number.isFinite(r.to.y), `seed ${seed}: salida numérica`);
    assert.ok(!('slid' in r), `seed ${seed}: ya no se desliza (spec/10)`);
    if (requested === 'stay') { assert.deepEqual([r.reason, r.stayed], ['stay', true]); continue; }
    if (!Number.isFinite(requested.x)) { assert.deepEqual([r.reason, r.stayed], ['invalid', true]); continue; }
    if (valid(requested, from, soldiers, 'me', obstacles)) {
      assert.deepEqual([r.reason, r.stayed, r.why], ['ok', false, null], `seed ${seed}`);
      assert.ok(near(r.to.x, requested.x) && near(r.to.y, requested.y), `seed ${seed}: to = lo pedido, tal cual`);
      direct++;
    } else {
      assert.deepEqual([r.reason, r.stayed], ['blocked', true], `seed ${seed}: imposible → pierde el movimiento`);
      assert.ok(near(r.to.x, from.x) && near(r.to.y, from.y), `seed ${seed}: quieto = from`);
      assert.ok(['far', 'edge', 'terrain', 'soldier', 'wall'].includes(r.why), `seed ${seed}: motivo ${r.why}`);
      blocked++;
    }
  }
  assert.ok(direct >= 15 && blocked >= 20, `cobertura: ${direct} directos, ${blocked} imposibles`);
});

check('bordes exactos: en la línea del rect ampliado es inválido; a MIN_SEPARATION justa es válido; en el margen del plano es válido', () => {
  const o = { x: 1, y: -1, w: 2, h: 2 };
  const from = { x: -1, y: 0 };
  const ctx = { from, soldiers: [{ id: 'me', x: -1, y: 0, alive: true }], obstacles: [o], selfId: 'me' };
  assert.equal(insideExpanded({ x: 1 - BODY, y: 0 }, o), true, 'borde izquierdo ampliado: dentro');
  assert.equal(insideExpanded({ x: 1 - BODY - 1e-9, y: 0 }, o), false);
  assert.equal(insideExpanded({ x: 3 + BODY, y: 0 }, o), true, 'borde derecho ampliado: dentro');
  assert.equal(insideExpanded({ x: 2, y: 1 + BODY }, o), true, 'borde superior');
  assert.equal(insideExpanded({ x: 2, y: -1 - BODY }, o), true, 'borde inferior');
  assert.equal(insideExpanded({ x: 2, y: -1 - BODY - 1e-9 }, o), false);
  assert.equal(isValidMove({ x: 0.5 - 1e-9, y: 0 }, ctx), true);
  assert.equal(isValidMove({ x: 0.5, y: 0 }, ctx), false, 'justo en la línea ampliada: inválido');
  const other = { id: 'o', x: 0, y: 1, alive: true };
  const ctx2 = { from, soldiers: [ctx.soldiers[0], other], obstacles: [], selfId: 'me' };
  assert.equal(isValidMove({ x: 0, y: 0 }, ctx2), true, 'a 1.0 exacto: válido');
  assert.equal(isValidMove({ x: 0, y: 0.001 }, ctx2), false);
  assert.equal(isValidMove({ x: 0, y: 0 }, { ...ctx2, soldiers: [ctx.soldiers[0], { ...other, alive: false }] }), true, 'muerto no cuenta');
  assert.equal(isValidMove({ x: 0, y: 0 }, { ...ctx2, soldiers: [ctx.soldiers[0], { ...other, id: 'me' }] }), true, 'uno mismo no cuenta');
  const corner = { x: PLANE.xMax - 1, y: PLANE.yMax - 1 };
  const cctx = { from: corner, soldiers: [], obstacles: [], selfId: 'me' };
  assert.equal(isValidMove({ x: PLANE.xMax - BODY, y: PLANE.yMax - BODY }, cctx), true, 'margen exacto: válido');
  assert.equal(isValidMove({ x: PLANE.xMax - BODY + 1e-9, y: PLANE.yMax - BODY }, cctx), false);
  assert.equal(isValidMove({ x: PLANE.xMax - BODY, y: PLANE.yMax - BODY + 1e-9 }, cctx), false);
  const low = { x: PLANE.xMin + 1, y: PLANE.yMin + 1 };
  const lctx = { from: low, soldiers: [], obstacles: [], selfId: 'me' };
  assert.equal(isValidMove({ x: PLANE.xMin + BODY, y: PLANE.yMin + BODY }, lctx), true);
  assert.equal(isValidMove({ x: PLANE.xMin + BODY - 1e-9, y: PLANE.yMin + BODY }, lctx), false);
  assert.equal(isValidMove({ x: PLANE.xMin + BODY, y: PLANE.yMin + BODY - 1e-9 }, lctx), false);
  assert.equal(isValidMove({ x: from.x + R, y: 0 }, { ...ctx, obstacles: [] }), true, 'radio exacto: válido');
  assert.equal(isValidMove({ x: from.x + R + 1e-6, y: 0 }, { ...ctx, obstacles: [] }), false);
});

check('segmento: muestreo t = 0.1 … 1.0 (ni antes del origen ni después del destino)', () => {
  const from = { x: 0, y: 0 }, P = { x: 1.5, y: 0 };
  const between = [{ x: 0.9, y: -3, w: 0.05, h: 6 }];         // muro fino entre medias, que no toca P (P.x=1.5 > 0.95+0.5)
  assert.equal(segmentClear(from, P, between), false);
  assert.equal(isValidMove(P, { from, soldiers: [], obstacles: between, selfId: 'me' }), false);
  const beyond = [{ x: 2.05, y: -3, w: 1, h: 6 }];             // justo después de P (t > 1): no molesta
  assert.equal(segmentClear(from, P, beyond), true);
  assert.equal(isValidMove(P, { from, soldiers: [], obstacles: beyond, selfId: 'me' }), true);
  const behind = [{ x: -2, y: -3, w: 1.4, h: 6 }];             // justo detrás del origen (t < 0): no molesta
  assert.equal(segmentClear(from, P, behind), true);
  assert.equal(isValidMove(P, { from, soldiers: [], obstacles: behind, selfId: 'me' }), true);
  const thin = [{ x: 0.62, y: -3, w: 0.01, h: 6 }];            // muro finísimo: lo pilla alguna muestra (ampliado ±0.5)
  assert.equal(segmentClear(from, P, thin), false);
  const diagonal = { x: 1.2, y: 1.2 };                           // en diagonal, el muestreo usa x e y
  assert.equal(segmentClear(from, diagonal, [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }]), false);
  assert.equal(segmentClear(from, diagonal, [{ x: 0.5, y: -1.2, w: 0.2, h: 0.2 }]), true, 'obstáculo bajo la diagonal: fuera del ±0.5');
  assert.equal(segmentClear(from, diagonal, [{ x: -1.2, y: 0.5, w: 0.2, h: 0.2 }]), true, 'obstáculo a la izquierda: fuera');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (geometría F1)');
process.exit(fails ? 1 : 0);
