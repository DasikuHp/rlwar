// Test del parser y del solver (regresión): la ruptura de compile() rompía TODO en silencio.
import { compile, tryCompile } from '../shared/parser.js';
import { simulateShot } from '../shared/solver.js';

let fails = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const check = (name, cond) => { console.log(`${cond ? '✓' : '✘'} ${name}`); if (!cond) fails++; };

// 1) evaluación de expresiones
const cases = [
  ['2*x', [3, 0, 0, 0], 6],
  ['-0.03704*x', [-15, 3, 0, 0], 0.5556],
  ['sin(x/5)*3', [0, 0, 0, 0], 0],
  ['x^2/50', [10, 0, 0, 0], 2],
  ['sqrt(abs(x))', [-9, 0, 0, 0], 3],
  ['2x', [4, 0, 0, 0], 8],
  ['3(x+1)', [2, 0, 0, 0], 9],
  ['-x^2', [3, 0, 0, 0], -9],
  ['y+y\'', [0, 5, 2, 0], 7],
  ['e^x', [1, 0, 0, 0], Math.E],
  ['pi', [0, 0, 0, 0], Math.PI],
];
for (const [src, args, expected] of cases) {
  let got;
  try { got = compile(src)(...args); } catch (e) { got = NaN; }
  check(`${src} con x=${args[0]} → ${expected}`, near(got, expected, 1e-4));
}

// 2) errores de sintaxis detectados
check('expresión vacía → error', !tryCompile('').ok);
check('paréntesis sin cerrar → error', !tryCompile('sin(x').ok);
check('identificador desconocido → error', !tryCompile('foo(x)').ok);
check('y\'\'\' inválido → error', !tryCompile("y'''").ok);

// 3) solver: disparo recto mata al enemigo (regresión del bug de NaN)
const soldiers = [
  { id: 's1', ownerId: 'p1', team: 'left', x: -15, y: 3, alive: true },
  { id: 's2', ownerId: 'p2', team: 'right', x: 12, y: 2, alive: true },
];
const slope = (2 - 3) / (12 - -15);
const straight = simulateShot({
  mode: 'function', f: compile(`${slope}*x`), start: { x: -15, y: 3 }, dir: 1,
  soldiers, obstacles: [], shooterId: 's1',
});
check('disparo recto → kill', straight.result.type === 'kill' && straight.result.soldierId === 's2');

// 4) solver: obstáculo detiene el disparo
const blocked = simulateShot({
  mode: 'function', f: compile(`${slope}*x`), start: { x: -15, y: 3 }, dir: 1,
  soldiers, obstacles: [{ x: -5, y: 0, w: 2, h: 6 }], shooterId: 's1',
});
check('obstáculo → obstacle', blocked.result.type === 'obstacle');

// 5) solver: EDO2 con gravedad dibuja parábola (no explota al inicio)
const ode2 = simulateShot({
  mode: 'ode2', f: compile('-0.05'), start: { x: -15, y: 3 }, dir: 1, angle: 30,
  soldiers: [soldiers[0]], obstacles: [], shooterId: 's1',
});
check('ode2 parabólica avanza', ode2.points.length > 50);

// 6) solver: EDO1 llega al borde sin explotar al inicio
const ode1 = simulateShot({
  mode: 'ode1', f: compile('-y/3'), start: { x: -15, y: 3 }, dir: 1,
  soldiers: [soldiers[0]], obstacles: [], shooterId: 's1',
});
check('ode1 avanza', ode1.points.length > 20);

// 7) expresión inválida (sqrt de negativo) explota de inmediato
const bad = simulateShot({
  mode: 'function', f: compile('sqrt(x)'), start: { x: -15, y: 3 }, dir: 1,
  soldiers, obstacles: [], shooterId: 's1',
});
check('sqrt(x) en x<0 → invalid', bad.result.type === 'invalid');

console.log(fails ? `FAIL ✘ (${fails} fallos)` : 'PASS ✔ (parser + solver)');
process.exit(fails ? 1 : 0);
