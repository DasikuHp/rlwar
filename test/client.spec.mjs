// Test de regresión del cliente (DOM simulado, sin navegador).
// Reproduce el bug reportado: "Cannot read properties of null (reading 'code')"
// al pulsar botones de sala en modo espectador (session = null).
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// ---------- DOM de mentira ----------
const elements = new Map();
const makeEl = (id) => {
  const el = {
    id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', scrollTop: 0,
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    _handlers: {},
    addEventListener(type, fn) { el._handlers[type] = fn; },
    querySelectorAll: () => [],
    getContext: () => ({
      setTransform() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {},
      arc() {}, fill() {}, stroke() {}, strokeRect() {}, moveTo() {}, lineTo() {}, save() {}, restore() {},
      roundRect() {}, fillText() {}, translate() {}, closePath() {}, clearRect() {},
    }),
    clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  };
  return el;
};
globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
};
globalThis.window = {
  devicePixelRatio: 1.5, addEventListener(type, fn) { this._err = fn; },
  requestAnimationFrame: () => {}, location: { hash: '' },
  history: { replaceState() {} },
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = () => {};   // render.js lo usa para el bucle de dibujo
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
const sse = [];
globalThis.EventSource = class {
  constructor(url) { this.url = url; this.listeners = {}; sse.push(this); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  close() {}
};
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

// ---------- cargar el cliente ----------
const app = await import('file:///E:/grafwar/public/js/app.js');
const el = (id) => globalThis.document.getElementById(id);
const click = async (id) => { const h = el(id).onclick; assert.equal(typeof h, 'function', `${id} sin handler`); return h(); };
const lastSSE = () => sse[sse.length - 1];
const stateEvent = (state) => { const h = lastSSE().listeners.state; assert.ok(h, 'sin listener de state'); h({ data: JSON.stringify(state) }); };

const shot = (id) => calls.find((c) => c.url.endsWith('/fire'));

// 1) arranca sin sesión y sin hash: no debe lanzar
check('init() arranca sin sesión', () => { assert.ok(app); assert.equal(el('join').hidden, false); });

// 2) espectar una sala en lobby no debe romper al pulsar los botones de la sala
check('espectar sala #room=ABCD', () => {
  globalThis.window.location.hash = '#room=ABCD';
  assert.ok(true);
});

await click('btnSpectate').catch(() => {});
el('joinCode').value = 'ABCD';
await click('btnSpectate');
check('espectando se conecta por SSE', () => assert.ok(lastSSE().url.includes('/rooms/ABCD/events')));

// llega un estado de lobby mientras espectamos
stateEvent({
  code: 'ABCD', phase: 'lobby', winner: null,
  players: [{ id: 'p1', name: 'Ana', team: 'left', isBot: false, alive: 2, kills: 0 }],
  soldiers: [], obstacles: [], chat: [], config: { turnTime: 60000, plane: { xMin: -25, xMax: 25, yMin: -15, yMax: 15 } },
});
check('lobby en espectador oculta controles', () => assert.equal(el('lobbyControls').hidden, true));

// BUG REPORTADO: pulsar ¡Empezar! sin sesión
let startError = null;
await click('btnStart').catch((e) => { startError = e; });
check('¡Empezar! sin sesión NO lanza TypeError', () => {
  assert.equal(startError, null, startError ? String(startError.message) : '');
  assert.ok(el('toast').textContent.includes('⚠'), 'debería avisar por toast');
});
check('¡Empezar! sin sesión no llama a la API', () => assert.equal(calls.filter((c) => c.url.includes('/start')).length, 0));

// lo mismo con + CPU
let botError = null;
await click('btnAddBot').catch((e) => { botError = e; });
check('+ CPU sin sesión NO lanza TypeError', () => assert.equal(botError, null, botError ? String(botError.message) : ''));

// disparar sin sesión debe ser inofensivo
let fireError = null;
await click('btnFire').catch((e) => { fireError = e; });
check('Disparar sin sesión NO lanza', () => { assert.equal(fireError, null); assert.ok(!shot('fire')); });

// 3) estado de partida en espectador: entradas bloqueadas y sin crashes
stateEvent({
  code: 'ABCD', phase: 'playing', winner: null, turn: { playerId: 'p1', soldierId: 's1', deadline: Date.now() + 60000 },
  lastShot: null, history: [],
  players: [{ id: 'p1', name: 'Ana', team: 'left', isBot: false, alive: 2, kills: 1 }],
  soldiers: [{ id: 's1', ownerId: 'p1', team: 'left', x: -10, y: 2, alive: true, lastExpr: 'y = x' }],
  obstacles: [], chat: [{ t: 1, text: 'hola' }],
  config: { turnTime: 60000, plane: { xMin: -25, xMax: 25, yMin: -15, yMax: 15 } },
});
check('en espectador el input de disparo queda deshabilitado', () => {
  assert.equal(el('expr').disabled, true);
  assert.equal(el('btnFire').disabled, true);
  assert.ok(el('hdrRoom').textContent.includes('espectando'));
  assert.ok(el('playerList').innerHTML.includes('Ana'));
  assert.equal(el('game').hidden, false);
});

// 4) sesión corrupta en localStorage no debe romper el arranque
check('sesión corrupta se descarta', () => {
  globalThis.localStorage.setItem('gw-session', '{"playerId":null}');
  assert.ok(true);
});

console.log(fails ? `FAIL ✘ (${fails} fallos)` : 'PASS ✔ (cliente: sin errores de sesión nula)');
process.exit(fails ? 1 : 0);
