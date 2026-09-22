// F1 — Geometría del movimiento (spec/01 §3): propiedades sobre escenas aleatorias y casos de borde.
// Complementa test/motor.spec.mjs (que la prueba de mutantes mostró corto en este módulo). Sin servidor.
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
// mejor distancia a T sobre una rejilla fina del disco (fuerza bruta)
const bruteBest = (T, from, soldiers, selfId, obstacles, step = 0.02) => {
  let best = Infinity;
  for (let x = from.x - R; x <= from.x + R + 1e-9; x += step) for (let y = from.y - R; y <= from.y + R + 1e-9; y += step) {
    const P = { x, y };
    if (valid(P, from, soldiers, selfId, obstacles)) best = Math.min(best, dist(P, T));
  }
  return best;
};
const polarHasValid = (from, soldiers, selfId, obstacles) => {
  for (let i = 1; i <= 40; i++) for (let k = 0; k < 72; k++) {
    const r = i * 0.05, th = k * 5 * Math.PI / 180;
    if (valid({ x: from.x + r * Math.cos(th), y: from.y + r * Math.sin(th) }, from, soldiers, selfId, obstacles)) return true;
  }
  return false;
};

check('escenas aleatorias (150): válido o quieto, sin deslizar cuando no hace falta, casi óptimo al deslizar, "blocked" solo si nada vale', () => {
  let slides = 0, blocked = 0, direct = 0;
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
    if (r.stayed) {
      assert.ok(near(r.to.x, from.x) && near(r.to.y, from.y), `seed ${seed}: quieto = from`);
      if (requested === 'stay') assert.equal(r.reason, 'stay');
      else if (typeof requested === 'object' && !Number.isFinite(requested.x)) assert.equal(r.reason, 'invalid');
      else { assert.equal(r.reason, 'blocked'); assert.equal(r.slid, true, 'blocked cuenta como deslizado'); assert.ok(!polarHasValid(from, soldiers, 'me', obstacles), `seed ${seed}: blocked pero hay puntos válidos`); blocked++; }
      continue;
    }
    assert.ok(valid(r.to, from, soldiers, 'me', obstacles), `seed ${seed}: destino inválido ${JSON.stringify(r)}`);
    let T = requested;
    const d = dist(T, from);
    if (d > R) T = { x: from.x + (T.x - from.x) * R / d, y: from.y + (T.y - from.y) * R / d };
    if (valid(T, from, soldiers, 'me', obstacles)) {
      assert.equal(r.slid, false, `seed ${seed}: T válido no se desliza`);
      assert.ok(near(r.to.x, T.x) && near(r.to.y, T.y), `seed ${seed}: to = T`);
      direct++;
    } else {
      assert.equal(r.slid, true, `seed ${seed}: T inválido se desliza`);
      const best = bruteBest(T, from, soldiers, 'me', obstacles);
      assert.ok(dist(r.to, T) <= best + 0.1, `seed ${seed}: a ${dist(r.to, T).toFixed(3)} de T, fuerza bruta ${best.toFixed(3)}`);
      slides++;
    }
  }
  assert.ok(slides >= 20 && direct >= 20 && blocked >= 1, `cobertura: ${direct} directos, ${slides} deslizados, ${blocked} bloqueados`);
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

check('deslizamiento: escoge la menor distancia a T; empates → menor radio, luego menor ángulo', () => {
  // T inaccesible por una pared por delante, huecos simétricos arriba y abajo → empate resuelto por el ángulo menor (arriba, 90° < 270°)
  const from = { x: 0, y: 0 };
  const wall = [{ x: 0.6, y: -1.5, w: 0.2, h: 3 }];
  const r = slideMove({ from, requested: { x: 1.5, y: 0 }, soldiers: [], obstacles: wall, selfId: 'me' });
  assert.equal(r.slid, true);
  const T = { x: 1.5, y: 0 };
  const best = bruteBest(T, from, [], 'me', wall);
  assert.ok(dist(r.to, T) <= best + 0.1, `${dist(r.to, T)} vs ${best}`);
  assert.ok(r.to.x <= 0.1 + 1e-9, 'se queda a este lado del muro');
  // el mismo punto pedido dos veces da lo mismo; y una T ya válida no se toca aunque haya obstáculos alrededor
  assert.deepEqual(r, slideMove({ from, requested: { x: 1.5, y: 0 }, soldiers: [], obstacles: wall, selfId: 'me' }));
  const ok = slideMove({ from, requested: { x: -1, y: 1 }, soldiers: [], obstacles: wall, selfId: 'me' });
  assert.equal(ok.slid, false); assert.ok(near(ok.to.x, -1) && near(ok.to.y, 1));
  // empate exacto a la misma distancia: T por encima de un bloque, dos huecos equidistantes → menor ángulo (0° antes que 180°)
  const box = [{ x: -0.7, y: 0.6, w: 1.4, h: 1 }];
  const t2 = slideMove({ from, requested: { x: 0, y: 0.8 }, soldiers: [], obstacles: box, selfId: 'me' });
  assert.equal(t2.slid, true);
  assert.ok(t2.to.x > 0, `empate → ángulo menor (derecha): ${JSON.stringify(t2.to)}`);
});

check('rejilla polar: encuentra el único hueco angular (300°) entre soldados', () => {
  // única zona válida: un anillo lejano en dirección 300°; el destino debe estar a r ≈ 2 y θ ≈ 300°
  const from = { x: 0, y: 0 };
  const obstacles = [{ x: -3, y: -3, w: 6, h: 6 }]; // todo tapado…
  const gapCenter = { x: 2 * Math.cos(300 * Math.PI / 180), y: 2 * Math.sin(300 * Math.PI / 180) };
  // …salvo que quitamos el bloque: usamos otros soldados como barrera con un hueco exacto en 300°
  const soldiers = [];
  for (let k = 0; k < 72; k++) { if (k === 60) continue; const th = k * 5 * Math.PI / 180; soldiers.push({ id: 's' + k, x: 2.4 * Math.cos(th), y: 2.4 * Math.sin(th), alive: true }); }
  const r = slideMove({ from, requested: { x: gapCenter.x * 1.5, y: gapCenter.y * 1.5 }, soldiers, obstacles: [], selfId: 'me' });
  assert.equal(r.stayed, false);
  const ang = ((Math.atan2(r.to.y, r.to.x) * 180 / Math.PI) + 360) % 360;
  assert.ok(Math.abs(ang - 300) < 6 && dist(r.to, from) > 1.0, `destino ${JSON.stringify(r.to)} (ángulo ${ang.toFixed(1)})`);
  void obstacles;
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (geometría F1)');
process.exit(fails ? 1 : 0);
