// Bocadillos del duelo (plan ronda 17; sesión 8: "la comunicación tiene que ser mejor, mira el original"): lógica pura de
// public/js/ui/bubbles.js. Primero la función y luego el comentario, uno por soldado, y nunca se pisan.
// Uso: node test/ui-bubbles.spec.mjs
import { strict as assert } from 'node:assert';
const B = await import('../public/js/ui/bubbles.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

check('una frase que llega tras decidir espera a la función, que sale primero; después sale la frase', () => {
  const q = B.createBubbles();
  B.expectShot(q, 's1', 0);
  B.pushSay(q, { soldierId: 's1', text: 'Voy a por ti' }, 10);
  assert.deepEqual(B.tick(q, 20).map((x) => x.kind), [], 'la frase no sale antes de la función');
  B.pushFn(q, { soldierId: 's1', text: 'y = 0.3*x' }, 100);
  assert.deepEqual(B.tick(q, 150).map((x) => x.kind), ['fn']);
  B.landed(q, 's1', 1000);
  assert.deepEqual(B.tick(q, 1500).map((x) => x.kind), ['fn'], 'la función sigue un rato tras caer la curva');
  const after = B.tick(q, 3000);
  assert.deepEqual(after.map((x) => [x.kind, x.text]), [['say', 'Voy a por ti']]);
});

check('sin tiro anunciado, lo que se dice sale al momento; uno por soldado y en orden', () => {
  const q = B.createBubbles();
  B.pushSay(q, { soldierId: 'a', text: 'uno' }, 0);
  B.pushSay(q, { soldierId: 'a', text: 'dos' }, 0);
  B.pushSay(q, { soldierId: 'b', text: 'hola' }, 0);
  const v = B.tick(q, 1);
  assert.deepEqual(v.map((x) => x.text).sort(), ['hola', 'uno']);
  const t2 = B.tick(q, 1 + B.readMs('uno') + 1);
  assert.ok(t2.some((x) => x.text === 'dos') && !t2.some((x) => x.text === 'uno'));
});

check('como mucho 2 frases esperando por soldado (las viejas quedan solo en el registro)', () => {
  const q = B.createBubbles();
  B.expectShot(q, 'a', 0);
  for (const t of ['1', '2', '3', '4']) B.pushSay(q, { soldierId: 'a', text: t }, 0);
  assert.deepEqual(q.items.filter((x) => x.kind === 'say').map((x) => x.text), ['3', '4']);
});

check('a x10 duran menos, pero nunca menos de lo que se tarda en leer por encima', () => {
  assert.ok(B.readMs('hola que tal', 10) < B.readMs('hola que tal', 1));
  assert.ok(B.readMs('x', 10) >= 400);
  assert.ok(B.readMs('a'.repeat(400), 1) <= 8000);
});

check('colocación: 4 bocadillos sobre soldados muy juntos no se pisan y quedan dentro del plano', () => {
  const box = { x: 0, y: 0, w: 800, h: 480 };
  const items = [1, 2, 3, 4].map((i) => ({ id: i, ax: 380 + i * 8, ay: 240, w: 180, h: 44 }));
  const soldiers = items.map((i) => ({ x: i.ax, y: i.ay, r: 8 }));
  const out = B.place(items, soldiers, box);
  assert.equal(out.length, 4);
  assert.ok(!B.overlaps(out), JSON.stringify(out));
  for (const r of out) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 800 && r.y + r.h <= 480);
  assert.ok(out.some((r) => r.guide), 'los que se alejan llevan línea guía');
});

check('colocación: pegado al borde de arriba, el bocadillo baja y sigue dentro', () => {
  const out = B.place([{ id: 1, ax: 10, ay: 5, w: 200, h: 40 }], [{ x: 10, y: 5, r: 8 }], { x: 0, y: 0, w: 800, h: 480 });
  assert.ok(out[0].x >= 0 && out[0].y >= 0);
});

check('colocación estable: si el sitio de antes sigue libre, no se mueve', () => {
  const box = { x: 0, y: 0, w: 800, h: 480 };
  const prev = new Map([[7, { x: 500, y: 300 }]]);
  const out = B.place([{ id: 7, ax: 400, ay: 240, w: 100, h: 30 }], [], box, prev);
  assert.deepEqual([out[0].x, out[0].y], [500, 300]);
});

check('wrap: parte en líneas que caben y corta con … a la 3.ª', () => {
  const m = (s) => s.length * 7;
  const lines = B.wrap('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece', 70, m, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => m(l) <= 70), JSON.stringify(lines));
  assert.ok(lines[2].endsWith('…'));
  assert.deepEqual(B.wrap('corto', 70, m), ['corto']);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (bocadillos: cola y colocación)');
process.exitCode = fails ? 1 : 0;
