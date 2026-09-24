// Huecos de la prueba de mutantes de la auditoría de la sesión 3 (2026-09-24): lo que ningún test fijaba en el generador
// de mapas, la geometría, la percepción, la sala y agents/lib.js. Escrito DESPUÉS del código (cubre supervivientes; cada
// caso es la spec, no el código) y congelado. En proceso, sin servidor. Uso: node test/huecos-s3.spec.mjs
process.env.GW_FAST = '0'; // sin modo rápido: la partida llega a 90 tiros y el registro de tiros (40) se puede pasar
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-huecos-s3-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const { genMap } = await import('../server/mapgen.js');

const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const E1 = 1 - 2 ** -53; // el mayor valor que da un rng en [0, 1)
// rng trucado: los valores de la cola y después `rest`; la cola se puede rellenar entre llamadas
const rigged = (queue = [], rest = 0.5) => { const R = { q: [...queue], rest }; const f = () => (R.q.length ? R.q.shift() : R.rest); f.R = R; return f; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------- mapas (spec/01 §10.2) ----------
await check('mapas: biomas por el primer número (fortaleza < 0,35 ≤ ruinas < 0,7 ≤ llanura)', () => {
  const biome = (u) => genMap(2, rigged([u])).biome;
  assert.deepEqual([0, 0.3499, 0.35, 0.6999, 0.7, E1].map(biome), ['fortaleza', 'fortaleza', 'ruinas', 'ruinas', 'llanura', 'llanura']);
});

await check('mapas: fortaleza con 2 o 3 grandes (< 0,5 → 2); centro x en −4..4, y = −9 + 7·i ± 1, radio 3,5–4', () => {
  const bigs = (m) => m.obstacles.filter((o) => o.r >= 3.5);
  assert.equal(bigs(genMap(2, rigged([0, 0.4999]))).length, 2);
  // grande 0 con todo a 0; grande 1 con todo casi a 1; grande 2 con todo a 0,5 (el resto, 0,5: radio 1)
  const m = genMap(2, rigged([0, 0.5, 0, 0, 0, E1, E1, E1, 0.5, 0.5, 0.5]));
  const b = bigs(m);
  assert.equal(b.length, 3);
  assert.deepEqual(m.obstacles.slice(0, 3), b, 'los grandes van primero');
  assert.deepEqual(b[0], circle(-4, -10, 3.5));
  assert.ok(b[1].x < 4 && near(b[1].x, 4, 1e-12) && near(b[1].y, -1, 1e-12) && b[1].r <= 4 && near(b[1].r, 4, 1e-12), JSON.stringify(b[1]));
  assert.deepEqual(b[2], circle(0, 5, 3.75));
  assert.equal(m.obstacles.length, 8, 'los de la regla completan hasta el número de la regla (con 0,5: 8)');
  assert.ok(m.obstacles.slice(3).every((o) => o.r === 1 && o.x === 0 && o.y === 0));
});

await check('mapas: llanura con 8–10 círculos de radio 1–2,5 en todo el plano', () => {
  assert.equal(genMap(2, rigged([0.7, 0])).obstacles.length, 8);
  const m = genMap(2, rigged([0.7, E1, 0, 0, 0, 0.5, 0.5, 0.5, E1, E1, E1]));
  assert.equal(m.obstacles.length, 10);
  assert.deepEqual(m.obstacles[0], circle(-25, -15, 1));
  assert.deepEqual(m.obstacles[1], circle(0, 0, 1.75));
  const o = m.obstacles[2];
  assert.ok(o.r <= 2.5 && near(o.r, 2.5, 1e-12) && o.x < 25 && near(o.x, 25, 1e-12) && o.y < 15 && near(o.y, 15, 1e-12), JSON.stringify(o));
});

// soldados: el mapa sin círculos (o con los que se ponen) y la cola del rng para las posiciones
const sideOf = (obstacles, queue, side, count) => {
  const rng = rigged([0.5]); // ruinas
  const m = genMap(2, rng);
  m.obstacles.length = 0; m.obstacles.push(...obstacles);
  rng.R.q = [...queue];
  return m.placeSide(side, count);
};

await check('soldados: x en −23..−6 (izquierda) o 6..23 (derecha), y en −13..13', () => {
  const L = sideOf([], [0, 0, E1, E1, 0.5, 0.5], 'left', 3);
  assert.deepEqual(L[0], { x: -23, y: -13 });
  assert.ok(L[1].x < -6 && near(L[1].x, -6, 1e-12) && L[1].y < 13 && near(L[1].y, 13, 1e-12), JSON.stringify(L[1]));
  assert.deepEqual(L[2], { x: -14.5, y: 0 });
  const R = sideOf([], [0, 0, E1, E1], 'right', 2);
  assert.deepEqual(R[0], { x: 6, y: -13 });
  assert.ok(R[1].x < 23 && near(R[1].x, 23, 1e-12), JSON.stringify(R[1]));
});

await check('soldados: a 3 u justas de un compañero sí; a menos, no; a r + 1 justas de un círculo, no', () => {
  // (−23, −13), luego (−23, −10) a 3 u justas
  assert.ok(-13 + (3 / 26) * 26 === -10, 'premisa: 3/26 da −10 exacto');
  assert.deepEqual(sideOf([], [0, 0, 0, 3 / 26], 'left', 2), [{ x: -23, y: -13 }, { x: -23, y: -10 }]);
  // (−23, −10,5) está a 2,5 u: se descarta y sigue con (−14,5, 0)
  assert.ok(-13 + (2.5 / 26) * 26 === -10.5, 'premisa: 2,5/26 da −10,5 exacto');
  assert.deepEqual(sideOf([], [0, 0, 0, 2.5 / 26, 0.5, 0.5], 'left', 2), [{ x: -23, y: -13 }, { x: -14.5, y: 0 }]);
  // (−14,5, 0) está a 3 u = r + 1 del círculo de r 2 en (−14,5, 3): se descarta; (−23, −13) sí
  assert.deepEqual(sideOf([circle(-14.5, 3, 2)], [0.5, 0.5, 0, 0], 'left', 1), [{ x: -23, y: -13 }]);
});

await check('soldados: 400 intentos exactos; después, la rejilla (el hueco libre más cercano a (±20, 0))', () => {
  const bad = Array(800).fill(0.5); // (−14,5, 0), dentro del círculo
  assert.deepEqual(sideOf([circle(-14.5, 0, 1)], [...bad, 0, 0], 'left', 1), [{ x: -20, y: 0 }], 'el intento 401 cabría, pero ya no se usa');
  assert.deepEqual(sideOf([circle(-14.5, 0, 1)], [...bad.slice(2), 0, 0], 'left', 1), [{ x: -23, y: -13 }], 'el intento 400 sí');
  // con un círculo en (±20, 0) de r 1 (y los 400 intentos en su centro), lo más cercano libre está a √4,25 u (8 empatados): el primero
  // en el orden de la rejilla
  const at = (u) => Array.from({ length: 800 }, (_, k) => (k % 2 ? 0.5 : u));
  assert.deepEqual(sideOf([circle(-20, 0, 1)], at(3 / 17), 'left', 1), [{ x: -22, y: -0.5 }]);
  assert.deepEqual(sideOf([circle(20, 0, 1)], at(14 / 17), 'right', 1), [{ x: 18, y: -0.5 }]);
});

await check('soldados: la rejilla de reserva llega a las cuatro esquinas de cada mitad (extremos incluidos); sin hueco, (±20, 0)', () => {
  const only = (side, cx, cy) => sideOf([circle(cx, cy, 29.9)], [], side, 1)[0];
  assert.deepEqual(only('left', -6, 13), { x: -23, y: -13 });
  assert.deepEqual(only('left', -23, -13), { x: -6, y: 13 });
  assert.deepEqual(only('right', 23, 13), { x: 6, y: -13 });
  assert.deepEqual(only('right', 6, -13), { x: 23, y: 13 });
  assert.deepEqual(sideOf([circle(-14.5, 0, 40)], [], 'left', 1), [{ x: -20, y: 0 }]);
  // la mitad tapada celda a celda (círculos de r 0 en x = ∓7 … ∓23: tapan hasta ∓6) y libre justo fuera (∓5,5): no mira fuera
  const wall = (sign) => { const out = []; for (let x = 7; x <= 23; x += 0.5) for (let y = -13; y <= 13; y += 0.5) out.push(circle(sign * x, y, 0)); return out; };
  assert.deepEqual(sideOf(wall(-1), [], 'left', 1), [{ x: -20, y: 0 }]);
  assert.deepEqual(sideOf(wall(1), [], 'right', 1), [{ x: 20, y: 0 }]);
  assert.deepEqual(sideOf([circle(14.5, 0, 40)], [], 'right', 1), [{ x: 20, y: 0 }]);
});

// ---------- agents/lib.js ----------
const lib = await import('../agents/lib.js');
const { simulateShot } = await import('../shared/solver.js');
const { tryCompile } = await import('../shared/parser.js');
const C = await import('../shared/constants.js');
const G = await import('../shared/geometry.js');
const soldier = (id, team, x, y) => ({ id, team, ownerId: team === 'left' ? 'pL' : 'pR', x, y, alive: true, turns: 0 });

await check('lib.sim: artillería sin ángulo = a 0° (como la sala); con bocados, el tiro pasa por el túnel', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 20, 12);
  const ctx = lib.contextFor([me, e], [], me);
  const got = lib.sim(ctx, { mode: 'ode2', expr: '-0.05' }, false).shot;
  const want = simulateShot({ mode: 'ode2', f: tryCompile('-0.05').f, start: { x: -10, y: 0 }, dir: 1, angle: 0, soldiers: [me, e], obstacles: [], shooterId: 'a', ds: C.STEP, maxSteps: C.MAX_STEPS });
  assert.deepEqual(got.points, want.points);
  // túnel de bocados a lo largo de y = 0 a través de un círculo de r 2 en (0, 0)
  const obstacles = [circle(0, 0, 2)], bites = Array.from({ length: 9 }, (_, k) => ({ x: -2 + k * 0.5, y: 0, r: C.BITE_RADIUS }));
  assert.equal(lib.sim(lib.contextFor([me, e], obstacles, me), { mode: 'function', expr: '0' }, true).shot.result.end, 'obstacle', 'premisa: sin bocados choca');
  assert.equal(lib.sim(lib.contextFor([me, e], obstacles, me, bites), { mode: 'function', expr: '0' }, true).shot.result.end, 'wall');
});

// ---------- geometría (spec/01 §3 y §10) ----------
await check('geometría: los cuatro bordes exactos de un círculo agrandado están dentro (dx = ±R, dy = ±R)', () => {
  const o = circle(0, 0, 1); // R = 1 + 0,5
  for (const P of [{ x: -1.5, y: 0 }, { x: 1.5, y: 0 }, { x: 0, y: -1.5 }, { x: 0, y: 1.5 }]) assert.equal(G.insideExpanded(P, o, 0.5), true, JSON.stringify(P));
  for (const P of [{ x: -1.5000001, y: 0 }, { x: 0, y: 1.5000001 }]) assert.equal(G.insideExpanded(P, o, 0.5), false, JSON.stringify(P));
});

await check('geometría: la línea de tiro de un segmento de menos de 0,25 u mira solo su extremo', () => {
  const t = [circle(0.1, 0, 0.05)];
  assert.equal(G.los({ x: 0, y: 0 }, { x: 0.2, y: 0 }, t), true, 'el círculo del medio no se muestrea');
  assert.equal(G.los({ x: 0, y: 0 }, { x: 0.1, y: 0 }, t), false, 'el extremo sí');
});

// ---------- percepción (spec/03, spec/01 §10.5) ----------
const P = await import('../shared/percept.js');
const { makeRng } = await import('../shared/rng.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
const stateOf = (soldiers, obstacles, bites, extra = {}) => ({
  code: 'T', phase: 'playing', soldiers, obstacles, bites,
  players: [{ id: 'pL', team: 'left', kills: 0 }, { id: 'pR', team: 'right', kills: 0 }],
  shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, history: [], chat: [], config: { plane: C.PLANE }, ...extra,
});
const withEye = (block) => normalize({ ...clone(TEMPLATES.empty.genome), blocks: [...clone(TEMPLATES.empty.genome.blocks), block] });
const eye = (st, id, block, phase = 'shoot') => Array.from(P.observe(st, id, withEye(block), { phase, rng: makeRng(1) }).ctx[block.id]);

await check('Simulador: una expresión que no compila da el resultado inválido entero, también sin `team` en el contexto (se toma del soldado)', () => {
  const me = soldier('a', 'left', -10, 2), e = soldier('e', 'right', 10, 0);
  const want = { type: 'invalid', end: 'invalid', minDist: 30, endX: -10, endY: 2, points: 1, victimId: null, hitIds: [], enemiesHit: 0, alliesHit: 0, polyline: [[-10, 2], [-10, 2]] };
  assert.deepEqual(P.simulateCandidate({ mode: 'function', expr: '((' }, { soldiers: [me, e], obstacles: [], bites: [], soldier: me }), want);
  const r = soldier('r', 'right', 10, 2);
  assert.deepEqual(P.simulateCandidate({ mode: 'function', expr: '((' }, { soldiers: [r, me], obstacles: [], bites: [], soldier: r }), { ...want, endX: -10 }, 'en local: la derecha se ve reflejada');
  const shot = P.simulateCandidate({ mode: 'function', expr: '0' }, { soldiers: [r, me], obstacles: [], bites: [], soldier: r });
  assert.equal(shot.type, 'kill', 'la derecha dispara hacia la izquierda y alcanza a (−10, 2)');
  // lo que ve el ojo del inválido: sin impactos, "otro final", a 30 u (tope 1), 1 punto (1/200)
  assert.deepEqual(Array.from(P.simulatorFeatures(P.simulateCandidate({ mode: 'function', expr: '((' }, { soldiers: [me, e], obstacles: [], bites: [], soldier: me, team: 'left' }), { soldiers: [me, e], soldier: me, team: 'left' })),
    [0, 0, 0, 0, 1, 1, -10 / 25, 2 / 15, 1 / 200, 0]);
});

await check('Simulador: sin enemigos, la distancia mínima es 30; el recorrido se corta en 2 500 pasos (grueso) y 20 000 (fino)', () => {
  const me = soldier('a', 'left', -24, 0);
  const lone = P.simulateCandidate({ mode: 'function', expr: '0' }, { soldiers: [me], obstacles: [], bites: [], soldier: me });
  assert.equal(lone.minDist, 30); assert.equal(lone.end, 'wall');
  const e = soldier('e', 'right', 20, 13);
  const ctx = { soldiers: [me, e], obstacles: [], bites: [], soldier: me, team: 'left' };
  const f = tryCompile('3*sin(4*x)').f;
  for (const [fine, ds, maxSteps] of [[false, 0.05, 2500], [true, 0.01, 20000]]) {
    const s = P.simulateCandidate({ mode: 'function', expr: '3*sin(4*x)' }, ctx, fine);
    const want = simulateShot({ mode: 'function', f, start: { x: -24, y: 0 }, dir: 1, angle: 0, soldiers: [me, e], obstacles: [], bites: [], shooterId: 'a', ds, maxSteps });
    assert.equal(want.result.end, 'maxlen', 'premisa: el recorrido es más largo que el tope');
    assert.equal(s.end, 'maxlen'); assert.equal(s.points, want.points.length, `${fine ? 'fino' : 'grueso'}: ${s.points}`);
    assert.deepEqual([s.endX, s.endY], [want.result.x, want.result.y], `${fine ? 'fino' : 'grueso'}: acaba donde el tope`);
  }
});

await check('Simulador (ojo): topes de alcanzados (4), distancia (1) y puntos (1); el final solo cuenta sin impactos; "el más cercano" con un solo enemigo', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 10, 0);
  const ctx = { soldiers: [me, e], soldier: me, team: 'left' };
  const f = (sim) => Array.from(P.simulatorFeatures({ enemiesHit: 0, alliesHit: 0, end: 'wall', minDist: 5, endX: 0, endY: 0, points: 100, hitIds: [], ...sim }, ctx));
  assert.deepEqual(f({ enemiesHit: 6, alliesHit: 5, end: 'maxlen', minDist: 25, endX: 12.5, endY: -7.5, points: 400, hitIds: ['e'] }), [4, 4, 0, 0, 0, 1, 0.5, -0.5, 1, 1]);
  assert.deepEqual(f({ end: 'invalid' }), [0, 0, 0, 0, 1, 0.5, 0, 0, 0.5, 0]);
  assert.deepEqual(f({ end: 'obstacle' }).slice(2, 5), [1, 0, 0]);
  assert.deepEqual(f({ end: 'wall' }).slice(2, 5), [0, 1, 0]);
  assert.deepEqual(f({ end: 'wall', enemiesHit: 1, hitIds: ['e'] }).slice(2, 5), [0, 0, 0], 'con impactos, ningún final');
  assert.equal(Array.from(P.simulatorFeatures({ enemiesHit: 0, alliesHit: 0, end: 'wall', minDist: 30, endX: 0, endY: 0, points: 1, hitIds: [] }, { soldiers: [me], soldier: me, team: 'left' }))[9], 0, 'sin enemigos, 0');
});

await check('destinos: los bocados abren un destino; "pegado a terreno" a 1 u justa del cuerpo; compañero más cercano (sin compañeros, 1; tope 10 u)', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 20, 10);
  // círculo de r 0,3 en (−8, 0) y un túnel de bocados: el destino 1 (→, a 1,5 u desde P1b, OK del usuario) es posible
  const bites = [-8.75, -8.3, -8].map((x) => ({ x, y: 0, r: C.BITE_RADIUS }));
  const d = P.moveDestinations(stateOf([me, e], [circle(-8, 0, 0.3)], bites), me);
  assert.deepEqual(d[1].to, { x: -8.5, y: 0 }); assert.equal(d[1].impossible, false, 'gracias a los bocados');
  // quedarse (destino 0): a r + 1,5 justas de un círculo está pegado; a r + 1,6, no
  assert.equal(P.moveDestinations(stateOf([me, e], [circle(-7.5, 0, 1)], []), me)[0].feat[8], 1);
  assert.equal(P.moveDestinations(stateOf([me, e], [circle(-7.4, 0, 1)], []), me)[0].feat[8], 0);
  // compañero más cercano: sin compañeros 1; a 5 u, 0,5; a 12 u, 1
  const allyAt = (x, y) => P.moveDestinations(stateOf(x === null ? [me, e] : [me, soldier('b', 'left', x, y), e], [], []), me)[0].feat[6];
  assert.deepEqual([allyAt(null), allyAt(-7, 4), allyAt(-10, 12)], [1, 0.5, 1]);
});

await check('destinos: "quedarse" solo en el 0; acercarse al enemigo 1 da (d − d0)/2; línea de tiro al enemigo 1; sin enemigos, ceros', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 10, 0);
  const d = P.moveDestinations(stateOf([me, e], [], []), me);
  assert.deepEqual(d.map((x) => x.feat[2]), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(near(d[1].feat[5], -0.75, 1e-12), `→ acerca 1,5 u (P1b, OK del usuario): ${d[1].feat[5]}`);
  assert.ok(d.every((x) => x.feat[7] === 1), 'sin terreno, todos ven al enemigo');
  const hidden = P.moveDestinations(stateOf([me, e], [circle(0, 0, 3)], []), me);
  assert.equal(hidden[0].feat[7], 0, 'con un círculo en medio, no lo ve');
  const lone = P.moveDestinations(stateOf([me], [], []), me);
  assert.ok(lone.every((x) => x.feat[5] === 0 && x.feat[7] === 0), 'sin enemigos: 0 en acercarse y en línea de tiro');
});

await check('ojo Obstáculos: de más cerca a más lejos (un círculo por su caja)', () => {
  const me = soldier('a', 'left', -10, 0), e = soldier('e', 'right', 20, 10);
  const obstacles = [circle(10, 5, 2), { x: -2, y: 3, w: 2, h: 3 }, circle(-5, 0, 1)];
  const v = eye(stateOf([me, e], obstacles, []), 'a', { id: 'ob', type: 'eye.obstacles', params: { slots: 3 } });
  const want = [-5 / 25, 0, 2 / 10, 2 / 15, 1, -1 / 25, 4.5 / 15, 2 / 10, 3 / 15, 1, 10 / 25, 5 / 15, 4 / 10, 4 / 15, 1, 3 / 8];
  assert.equal(v.length, want.length);
  for (let i = 0; i < want.length; i++) assert.ok(near(v[i], want[i], 1e-12), `entrada ${i}: ${v[i]} ≠ ${want[i]}`);
  const one = eye(stateOf([me, e], [circle(-5, 0, 1)], []), 'a', { id: 'ob', type: 'eye.obstacles', params: { slots: 3 } });
  assert.deepEqual(one.slice(5), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 / 8], 'las ranuras sin obstáculo, a cero');
});

await check('ojo Reloj: disparos sin bajas, mapas renovados y turnos con tope 1; fase de mover = 1', () => {
  const me = { ...soldier('a', 'left', -10, 0), turns: 40 }, e = soldier('e', 'right', 20, 10);
  const block = { id: 'rl', type: 'eye.clock', params: {} };
  const hi = eye(stateOf([me, e], [], [], { stats: { shots: 45, shotsNoKill: 2 * C.STALL_SHOTS, remaps: 5 } }), 'a', block, 'move');
  assert.deepEqual([hi[0], hi[1], hi[2], hi[6], hi[7]], [45 / C.MAX_SHOTS, 1, 1, 1, 1]);
  const lo = eye(stateOf([{ ...me, turns: 10 }, e], [], [], { stats: { shots: 9, shotsNoKill: C.STALL_SHOTS / 2, remaps: 1 } }), 'a', block);
  assert.deepEqual([lo[0], lo[1], lo[2], lo[6], lo[7]], [9 / C.MAX_SHOTS, 0.5, 1 / 3, 0.5, 0]);
});

await check('ojo Compañeros: con cuentas a 0 no mataron ni hicieron fuego amigo aunque el tipo diga otra cosa; distancia del último tiro con tope (sin dato, 30)', () => {
  const me = soldier('a', 'left', -10, 0), b = soldier('b', 'left', -10, 6), c = soldier('c', 'left', -10, -6), e = soldier('e', 'right', 10, 0);
  const shotLog = [
    { turn: 1, soldierId: 'b', team: 'left', result: { type: 'kill', soldierId: 'e9', hits: [], kills: 0, friendly: 0, end: 'wall' }, minDist: 5, stayed: false },
    { turn: 2, soldierId: 'c', team: 'left', result: { type: 'suicide', soldierId: 'x', hits: [], kills: 0, friendly: 0, end: 'wall' }, stayed: true },
  ];
  const v = eye(stateOf([me, b, c, e], [], [], { shotLog }), 'a', { id: 'mt', type: 'eye.mates', params: {} });
  assert.deepEqual([v[6], v[7], v[8], v[9]], [0, 0, (0.5 + 1) / 2, 1 / 2]);
});

// ---------- sala (server/rooms.js) ----------
const { Room } = await import('../server/rooms.js');
const { saveNet } = await import('../evo/store.js');
const BR = C.BITE_RADIUS;
// sala sin pantalla (solo agentes) cuyo primer turno es de `team`; con `human`, sala con pantalla y una persona a la derecha
const roomFor = (team, { soldiers = 2, left = 'chaos', right = 'chaos', human = false, extra = {} } = {}) => {
  for (let seed = 1; seed < 400; seed++) {
    const r = new Room('huecos', { soldiersPerPlayer: soldiers, seed, headless: !human });
    r.addAgent(left, { level: 1, team: 'left', ...extra });
    if (human) r.addPlayer('Hugo', 'right'); else r.addAgent(right, { level: 1, team: 'right' });
    r.start();
    const me = r.soldiers.find((s) => s.id === r.turn.soldierId);
    if (me.team === team) return { room: r, me, seed };
    r.phase = 'over';
  }
  throw new Error(`premisa: ninguna semilla da el primer turno a ${team}`);
};
// el tirador en (∓12, y0) dispara la recta y = y0 sin moverse; los demás se colocan con `place` (o lejos de la recta)
const fireFlat = (room, me, { y0 = 0, obstacles = [], place = null } = {}) => {
  const dir = me.team === 'left' ? 1 : -1;
  const flip = (o) => (o.kind === 'circle' ? { ...o, x: o.x * dir } : dir > 0 ? { ...o } : { ...o, x: -(o.x + o.w) });
  room.obstacles = obstacles.map(flip); room.bites = [];
  Object.assign(me, { x: -12 * dir, y: y0 });
  let k = 0;
  for (const s of room.soldiers) if (s !== me) { const p = place && place(s); Object.assign(s, p ? { x: p.x * dir, y: p.y } : { x: (s.team === me.team ? -20 : 20) * dir, y: y0 + (k++ % 2 ? 8 : -8) }); }
  const n = room.chat.length;
  const r = room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: 'stay' });
  assert.ok(r.ok, JSON.stringify(r));
  return { r, chat: room.chat.slice(n) };
};

await check('sala: el bocado con y ≠ 0 y las tangencias exactas (a r + 0,78 justas de un círculo, a 0,78 justas de un rectángulo, no toca)', () => {
  const bitesOf = (team, y0, obstacles) => { const { room, me } = roomFor(team); const { r } = fireFlat(room, me, { y0, obstacles }); assert.equal(r.result.end, 'wall', 'premisa: acaba en el borde'); return room.bites.length; };
  assert.ok(Math.hypot(0, 5 - 7) === 1.22 + BR && 1 - 0.22 === BR, 'premisa: distancias exactas en coma flotante');
  for (const team of ['left', 'right']) {
    assert.equal(bitesOf(team, 5, [circle(25, 7, 1.22)]), 0, `${team}: círculo a r + 0,78 justas`);
    assert.equal(bitesOf(team, 5, [circle(25, 7, 1.23)]), 1, `${team}: círculo a menos`);
    assert.equal(bitesOf(team, 0.22, [{ x: 23, y: 1, w: 4, h: 2 }]), 0, `${team}: rectángulo a 0,78 justas`);
    assert.equal(bitesOf(team, 0.22, [{ x: 23, y: 0.99, w: 4, h: 2 }]), 1, `${team}: rectángulo a menos`);
  }
});

await check('sala: el registro de tiros numera el turno y recorta la expresión a 200 caracteres', () => {
  const { room } = roomFor('left');
  const expr = '0' + '+0'.repeat(125);
  assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr, move: 'stay' }).ok);
  const e1 = room.shotLog[room.shotLog.length - 1];
  assert.equal(e1.turn, 1); assert.equal(e1.expr, expr.slice(0, 200)); assert.equal(room.lastShot.expr, expr.slice(0, 200));
  assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: 'stay' }).ok);
  assert.equal(room.shotLog[room.shotLog.length - 1].turn, 2);
});

await check('sala: el registro de tiros guarda los 40 últimos (con 41, el primero ya no está)', () => {
  const { room } = roomFor('left');
  room.obstacles = []; room.bites = [];
  room.soldiers.forEach((s, k) => Object.assign(s, { x: s.team === 'left' ? -15 : 15, y: -12 + k * 6 })); // rectas que no alcanzan a nadie
  for (let k = 0; k < 41; k++) assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0', move: 'stay' }).ok, `tiro ${k + 1}`);
  assert.equal(room.shotLog.length, 40);
  assert.deepEqual([room.shotLog[0].turn, room.shotLog[39].turn], [2, 41]);
});

await check('sala: el agente que se mueve recibe los 9 destinos de lib.moveOptions desde donde está', () => {
  const { room, me } = roomFor('left', { left: 'greedy', right: 'greedy' });
  const agent = room.agents[room.turn.playerId];
  const orig = agent.chooseMove.bind(agent);
  let got = null, want = null;
  agent.chooseMove = (args) => { got = args.moveOptions; want = lib.moveOptions(lib.contextFor(room.soldiers, room.obstacles, me, room.bites)); return orig(args); };
  assert.ok(room.fire(room.turn.playerId, { mode: 'function', expr: '0' }).ok);
  assert.ok(Array.isArray(got) && got.length === 9, JSON.stringify(got));
  assert.deepEqual(got, want);
});

await check('sala: game.start lleva netId y agentType de cada jugador (null si no los tiene)', () => {
  const g = normalize({ ...clone(TEMPLATES.sniper.genome), id: 'huecos-red', name: 'Huecos' });
  saveNet(g);
  const { room } = roomFor('left', { left: 'net', extra: { netId: 'huecos-red' } });
  const start = room.events.find((e) => e.type === 'game.start');
  assert.deepEqual(start.data.players.map(({ netId, agentType, team }) => ({ netId, agentType, team })), [{ netId: 'huecos-red', agentType: 'net', team: 'left' }, { netId: null, agentType: 'chaos', team: 'right' }]);
});

await check('sala: el mensaje de un tiro que atraviesa cuenta a los aliados ("y a un aliado", "y a 2 aliados", o solo aliados)', () => {
  const kill = (soldiers, spots) => {
    const { room, me } = roomFor('left', { soldiers });
    const mates = room.soldiers.filter((s) => s !== me && s.team === 'left'), foes = room.soldiers.filter((s) => s.team === 'right');
    const at = new Map(); spots.mates.forEach((x, i) => at.set(mates[i], { x, y: 0 })); spots.foes.forEach((x, i) => at.set(foes[i], { x, y: 0 }));
    const { chat } = fireFlat(room, me, { place: (s) => at.get(s) || null });
    const name = room.players.find((p) => p.team === 'left').name, victim = room.players.find((p) => p.team === 'right').name;
    return { text: chat.map((c) => c.text).find((t) => t.includes('eliminó')), name, victim };
  };
  let k = kill(2, { mates: [5], foes: [0] });
  assert.equal(k.text, `💥 ${k.name} eliminó a ${k.victim} 💀 y a un aliado con y = 0`);
  k = kill(3, { mates: [4, 8], foes: [0] });
  assert.equal(k.text, `💥 ${k.name} eliminó a ${k.victim} 💀 y a 2 aliados con y = 0`);
  k = kill(2, { mates: [0], foes: [] });
  assert.equal(k.text, `💀 ${k.name} eliminó a un aliado con y = 0`);
});

await check('sala: al matar, un bot presume con el nombre de su víctima; una persona nunca presume', () => {
  let named = null;
  for (let s = 0; s < 60 && !named; s++) {
    const { room, me } = roomFor('left', { soldiers: 1, left: 'greedy', human: true });
    for (let i = 0; i < s; i++) room.rng.int(4); // otra línea de presumir en cada vuelta
    const { chat } = fireFlat(room, me, { place: () => ({ x: 0, y: 0 }) });
    const says = chat.filter((c) => c.kind === 'say').map((c) => c.text);
    assert.ok(says.every((t) => !t.includes('{victim}') && !t.includes('undefined')), JSON.stringify(says));
    named = says.find((t) => t.includes('outfarmeado')) || null;
    room.phase = 'over';
  }
  assert.equal(named, '🧠 Greedy: Hugo, has sido outfarmeado.');
  const { room, me } = roomFor('right', { soldiers: 1, left: 'greedy', human: true });
  const human = room.players.find((p) => !p.isBot);
  const { chat, r } = fireFlat(room, me, { place: () => ({ x: 0, y: 0 }) });
  assert.equal(r.result.type, 'kill', 'premisa: la persona mata');
  assert.ok(!chat.some((c) => c.kind === 'say' && c.playerId === human.id), JSON.stringify(chat));
  room.phase = 'over';
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (huecos s3: mapas, geometría, percepción, sala y lib)');
process.exit(fails ? 1 : 0);
