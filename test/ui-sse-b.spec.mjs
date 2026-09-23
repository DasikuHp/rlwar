// Una sola conexión SSE por URL (public/js/ui/sse.js), hueco de la prueba de mutantes (auditoría del 2026-09-24):
// darse de baja dos veces cuenta una sola; si restara dos, cerraría la conexión que aún usa otra vista.
// Escrito tras el código (solo fija el contrato) y congelado. Uso: node test/ui-sse-b.spec.mjs
import { strict as assert } from 'node:assert';
const { createHub } = await import('../public/js/ui/sse.js');

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
function fakeES() {
  const made = [];
  class ES {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; made.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    close() { this.closed = true; }
    fire(type, data) { for (const fn of this.listeners[type] || []) fn({ type, data: JSON.stringify(data) }); }
  }
  return { ES, made };
}

check('darse de baja dos veces cuenta una: la conexión sigue abierta para la otra vista y le llegan sus eventos', () => {
  const f = fakeES();
  const hub = createHub({ EventSourceImpl: f.ES });
  const got = [];
  const offA = hub.on('/api/lab/events', 'training', () => {});
  hub.on('/api/lab/events', 'training', (d) => got.push(d));
  offA(); offA();
  assert.equal(f.made.length, 1);
  assert.equal(f.made[0].closed, false, 'la otra vista sigue suscrita');
  assert.equal(hub.connections(), 1);
  f.made[0].fire('training', { id: 't1' });
  assert.deepEqual(got, [{ id: 't1' }]);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (SSE compartida: darse de baja dos veces)');
process.exitCode = fails ? 1 : 0;
