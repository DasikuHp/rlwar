// Una sola conexión SSE por URL para toda la página (auditoría P0, 2026-09-23). El navegador solo abre 6 conexiones
// HTTP/1.1 a la vez por servidor, y cada SSE ocupa una para siempre: si cada vista abre la suya, al visitar 5 vistas
// con una sala espectada las peticiones siguientes esperan sin fin y la vista sale en blanco (reproducido con Chrome
// sin ventana: Cirugía se quedó vacía tras abrir Inicio, Entreno, Evolución, Trono, Dinastías y una sala).
// Contrato de public/js/ui/sse.js:
//   createHub({EventSourceImpl}) → {on(url, type, fn) → off(), connections()}
//   - la primera suscripción a una URL abre una conexión; las siguientes (de cualquier vista y tipo) la reutilizan;
//   - cada evento llega a todos los suscritos a su tipo en esa URL, y un suscrito que lanza no corta a los demás;
//   - `hello` (el servidor lo manda al abrir la conexión) se guarda: quien se suscribe a `hello` tarde lo recibe al
//     momento con el último que llegó;
//   - cuando se va el último suscrito de una URL, la conexión se cierra; una suscripción nueva abre otra;
//   - sin EventSource (Node, navegador antiguo), `on` no hace nada y devuelve un `off` que tampoco.
// Además: fuera de public/js/ui/sse.js, ningún fichero de public/js crea un EventSource.
// Uso: node test/ui-sse.spec.mjs
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createHub } = await import('../public/js/ui/sse.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// EventSource de mentira: guarda sus oyentes y deja emitir eventos a mano
function fakeES() {
  const made = [];
  class ES {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; made.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    close() { this.closed = true; }
    fire(type, data) { for (const fn of this.listeners[type] || []) fn({ type, data: JSON.stringify(data) }); }
  }
  return { ES, made, open: () => made.filter((e) => !e.closed) };
}
const LAB = '/api/lab/events';

check('seis vistas suscritas a la misma URL comparten una sola conexión', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  for (const type of ['hello', 'training', 'job', 'duel', 'throne', 'dynasty']) hub.on(LAB, type, () => {});
  assert.equal(f.made.length, 1);
  assert.equal(f.made[0].url, LAB);
  assert.equal(hub.connections(), 1);
});

check('cada evento llega a todos los suscritos a su tipo, con los datos ya leídos, y solo a ellos', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  const got = [];
  hub.on(LAB, 'job', (d) => got.push(['a', d.id]));
  hub.on(LAB, 'job', (d) => got.push(['b', d.id]));
  hub.on(LAB, 'duel', (d) => got.push(['c', d.id]));
  f.made[0].fire('job', { id: 'j1' });
  assert.deepEqual(got, [['a', 'j1'], ['b', 'j1']]);
});

check('un suscrito que lanza no impide que los demás reciban el evento', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  const got = [];
  hub.on(LAB, 'job', () => { throw new Error('vista rota'); });
  hub.on(LAB, 'job', (d) => got.push(d.id));
  f.made[0].fire('job', { id: 'j2' });
  assert.deepEqual(got, ['j2']);
});

check('hello tardío: quien se suscribe después recibe al momento el último hello', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  hub.on(LAB, 'job', () => {});
  f.made[0].fire('hello', { throne: { queen: 'nova' }, n: 1 });
  f.made[0].fire('hello', { throne: { queen: 'orion' }, n: 2 });
  const got = [];
  hub.on(LAB, 'hello', (d) => got.push(d.n));
  assert.deepEqual(got, [2]);
  f.made[0].fire('hello', { n: 3 }); // una reconexión trae otro hello: llega a todos
  assert.deepEqual(got, [2, 3]);
  assert.equal(f.made.length, 1);
});

check('off quita solo a ese suscrito; con el último, la conexión se cierra; una nueva suscripción abre otra', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  const got = [];
  const off1 = hub.on(LAB, 'job', (d) => got.push(['uno', d.id]));
  const off2 = hub.on(LAB, 'training', (d) => got.push(['dos', d.id]));
  off1();
  f.made[0].fire('job', { id: 'x' });
  f.made[0].fire('training', { id: 'y' });
  assert.deepEqual(got, [['dos', 'y']]);
  assert.equal(f.made[0].closed, false);
  off2();
  assert.equal(f.made[0].closed, true);
  assert.equal(hub.connections(), 0);
  off2(); // dos veces no rompe nada
  hub.on(LAB, 'job', () => {});
  assert.equal(f.made.length, 2);
  assert.equal(f.open().length, 1);
});

check('tras cerrar y volver a abrir, el hello guardado de la conexión anterior ya no se repite', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  const off = hub.on(LAB, 'job', () => {});
  f.made[0].fire('hello', { n: 1 });
  off();
  const got = [];
  hub.on(LAB, 'hello', (d) => got.push(d.n));
  assert.deepEqual(got, [], 'la conexión nueva aún no ha dicho hello');
  f.made[1].fire('hello', { n: 9 });
  assert.deepEqual(got, [9]);
});

check('URLs distintas (el laboratorio y una sala) van por conexiones distintas', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  hub.on(LAB, 'job', () => {});
  hub.on('/api/rooms/ABCD/events', 'shot', () => {});
  hub.on('/api/rooms/ABCD/events', 'state', () => {});
  assert.deepEqual(f.made.map((e) => e.url), [LAB, '/api/rooms/ABCD/events']);
});

check('un evento que no es JSON llega como texto, sin romper', () => {
  const f = fakeES(); const hub = createHub({ EventSourceImpl: f.ES });
  const got = [];
  hub.on(LAB, 'ping', (d) => got.push(d));
  for (const fn of f.made[0].listeners.ping) fn({ type: 'ping', data: 'no es json' });
  assert.deepEqual(got, ['no es json']);
});

check('sin EventSource: on no hace nada y su off tampoco', () => {
  const hub = createHub({ EventSourceImpl: undefined });
  const off = hub.on(LAB, 'job', () => {});
  assert.equal(typeof off, 'function');
  off();
  assert.equal(hub.connections(), 0);
});

check('ningún fichero de public/js, salvo ui/sse.js, crea un EventSource', () => {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); continue; }
      if (!p.endsWith('.js')) continue;
      const rel = relative(join(ROOT, 'public', 'js'), p).replace(/\\/g, '/');
      if (rel === 'ui/sse.js') continue;
      if (/new\s+EventSource\s*\(/.test(readFileSync(p, 'utf8'))) found.push(rel);
    }
  };
  walk(join(ROOT, 'public', 'js'));
  assert.deepEqual(found, []);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (una sola conexión SSE por URL)');
process.exitCode = fails ? 1 : 0;
