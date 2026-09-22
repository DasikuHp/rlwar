// F0 — Selector de tropas del self-play (DOM simulado, sin navegador ni servidor).
// Contrato: el usuario elige QUÉ agente pelea en cada bando y CUÁNTOS soldados (1–4);
// las POSICIONES nunca las toca (las sortea el servidor). Escrito ANTES del código.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- DOM de mentira (mínimo) ----------
const elements = new Map();
const makeEl = (id) => {
  const el = {
    id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', scrollTop: 0,
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll: () => [],
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }),
    clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  };
  return el;
};
globalThis.document = {
  getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); },
};
globalThis.window = {
  devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: () => {},
  location: { hash: '' }, history: { replaceState() {} },
};
globalThis.requestAnimationFrame = () => {};
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
globalThis.EventSource = class { constructor(url) { this.url = url; } addEventListener() {} close() {} };

// ---------- API de mentira ----------
// 'neuro' no existe en el cliente: si aparece en el selector, la lista sale de /api/agents (no está cableada a mano).
const AGENTS = [
  { id: 'sniper', name: 'Sniper', icon: '🎯' }, { id: 'greedy', name: 'Greedy', icon: '🤑' },
  { id: 'artillery', name: 'Artillery', icon: '💣' }, { id: 'chaos', name: 'Chaos', icon: '🌀' },
  { id: 'neuro', name: 'Neuro', icon: '🧠' },
];
const BUILTIN = ['sniper', 'greedy', 'artillery', 'chaos'];
let agentsApiDown = false;
const calls = [];
const snapshot = { code: 'TEST', phase: 'playing', winner: null, turn: null, players: [], soldiers: [], obstacles: [], chat: [], history: [], config: { turnTime: 60000, plane: { xMin: -25, xMax: 25, yMin: -15, yMax: 15 } } };
globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url, method: opts.method || 'GET', body });
  const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
  if (url.endsWith('/api/agents')) {
    if (agentsApiDown) throw new Error('red caída');
    return reply({ agents: AGENTS });
  }
  if (url.endsWith('/api/rooms') && opts.method === 'POST') return reply({ code: 'TEST', soldiers: body.soldiers });
  if (url.endsWith('/addagent')) return reply({ ok: true, player: { id: 'p' + calls.length, team: body.team } });
  if (url.endsWith('/start')) return reply({ ok: true });
  if (url.endsWith('/state')) return reply(snapshot);
  return reply({ ok: true });
};

const el = (id) => globalThis.document.getElementById(id);
const optionValues = (id) => [...el(id).innerHTML.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
const selfplay = async () => {
  calls.length = 0;
  await el('btnSelfplay').onclick();
  const rooms = calls.filter((c) => c.url.endsWith('/api/rooms') && c.method === 'POST');
  const adds = calls.filter((c) => c.url.endsWith('/addagent'));
  const starts = calls.filter((c) => c.url.endsWith('/start'));
  return { rooms, adds, starts };
};

// ---------- 0) el HTML trae los controles ----------
await check('index.html tiene spLeft, spRight y spSoldiers (1..4)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['spLeft', 'spRight', 'spSoldiers']) assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  const sel = html.slice(html.indexOf('id="spSoldiers"'), html.indexOf('</select>', html.indexOf('id="spSoldiers"')));
  for (const n of [1, 2, 3, 4]) assert.ok(sel.includes(`value="${n}"`), `spSoldiers sin opción ${n}`);
});

// ---------- 1) arranque normal: la lista sale de /api/agents ----------
await import('../public/js/app.js?run=1');
await tick(); await tick();

await check('los selectores listan "Aleatorio" + los agentes de /api/agents', () => {
  for (const id of ['spLeft', 'spRight']) {
    const vals = optionValues(id);
    assert.equal(vals[0], 'random', `${id}: la primera opción debe ser "random"`);
    for (const a of AGENTS) assert.ok(vals.includes(a.id), `${id}: falta ${a.id}`);
  }
});

await check('elección explícita: sniper (izq) vs chaos (der), 2 soldados', async () => {
  el('spLeft').value = 'sniper'; el('spRight').value = 'chaos'; el('spSoldiers').value = '2';
  const { rooms, adds, starts } = await selfplay();
  assert.equal(rooms.length, 1, 'debe crear 1 sala');
  assert.equal(rooms[0].body.soldiers, 2, 'la sala debe pedir 2 soldados');
  assert.equal(adds.length, 2, 'debe sentar 2 agentes');
  const left = adds.find((c) => c.body.team === 'left'); const right = adds.find((c) => c.body.team === 'right');
  assert.ok(left && right, 'un agente por bando');
  assert.equal(left.body.type, 'sniper'); assert.equal(right.body.type, 'chaos');
  assert.equal(starts.length, 1, 'debe iniciar la partida');
});

await check('las posiciones nunca se envían (las sortea el servidor)', async () => {
  el('spLeft').value = 'greedy'; el('spRight').value = 'artillery'; el('spSoldiers').value = '4';
  await selfplay();
  const forbidden = /"(x|y|pos|position|positions|placement)"\s*:/;
  for (const c of calls) if (c.body) assert.ok(!forbidden.test(JSON.stringify(c.body)), `cuerpo con posición: ${JSON.stringify(c.body)}`);
});

await check('1 soldado por bando se respeta', async () => {
  el('spLeft').value = 'sniper'; el('spRight').value = 'greedy'; el('spSoldiers').value = '1';
  const { rooms } = await selfplay();
  assert.equal(rooms[0].body.soldiers, 1);
});

await check('ambos aleatorios: agentes válidos y distintos (30 sorteos)', async () => {
  el('spLeft').value = 'random'; el('spRight').value = 'random'; el('spSoldiers').value = '4';
  const valid = new Set(AGENTS.map((a) => a.id));
  for (let i = 0; i < 30; i++) {
    const { adds } = await selfplay();
    const l = adds.find((c) => c.body.team === 'left').body.type;
    const r = adds.find((c) => c.body.team === 'right').body.type;
    assert.ok(valid.has(l) && valid.has(r), `tipo inválido: ${l} / ${r}`);
    assert.notEqual(l, r, 'el sorteo doble no debe repetir agente');
  }
});

await check('uno fijo y otro aleatorio: el aleatorio es distinto del fijo (20 sorteos)', async () => {
  el('spLeft').value = 'sniper'; el('spRight').value = 'random';
  for (let i = 0; i < 20; i++) {
    const { adds } = await selfplay();
    assert.equal(adds.find((c) => c.body.team === 'left').body.type, 'sniper');
    assert.notEqual(adds.find((c) => c.body.team === 'right').body.type, 'sniper');
  }
});

await check('la elección se recuerda en localStorage (gw-troops)', async () => {
  el('spLeft').value = 'chaos'; el('spRight').value = 'greedy'; el('spSoldiers').value = '3';
  await selfplay();
  const saved = JSON.parse(storage.get('gw-troops') || 'null');
  assert.deepEqual(saved, { left: 'chaos', right: 'greedy', soldiers: 3 });
});

// ---------- 2) al volver, se restaura la elección ----------
await check('al recargar se restaura la elección guardada', async () => {
  storage.set('gw-troops', JSON.stringify({ left: 'artillery', right: 'neuro', soldiers: 1 }));
  await import('../public/js/app.js?run=2');
  await tick(); await tick();
  assert.equal(el('spLeft').value, 'artillery');
  assert.equal(el('spRight').value, 'neuro');
  assert.equal(el('spSoldiers').value, '1');
});

await check('una elección guardada que ya no existe vuelve a "Aleatorio"', async () => {
  storage.set('gw-troops', JSON.stringify({ left: 'fantasma', right: 'sniper', soldiers: 9 }));
  await import('../public/js/app.js?run=3');
  await tick(); await tick();
  assert.equal(el('spLeft').value, 'random');
  assert.equal(el('spRight').value, 'sniper');
  assert.equal(el('spSoldiers').value, '4', 'un nº de soldados inválido vuelve a 4');
});

// ---------- 3) sin /api/agents el selector sigue funcionando ----------
await check('si /api/agents falla, se usan los 4 agentes de serie y no rompe', async () => {
  storage.delete('gw-troops');
  agentsApiDown = true;
  await import('../public/js/app.js?run=4');
  await tick(); await tick();
  for (const id of ['spLeft', 'spRight']) {
    const vals = optionValues(id);
    assert.equal(vals[0], 'random');
    for (const a of BUILTIN) assert.ok(vals.includes(a), `${id}: falta ${a} de serie`);
  }
  el('spLeft').value = 'sniper'; el('spRight').value = 'chaos'; el('spSoldiers').value = '2';
  const { adds } = await selfplay();
  assert.equal(adds.length, 2);
});

console.log(fails ? `FAIL ✘ (${fails} fallos)` : 'PASS ✔ (selector de tropas)');
process.exit(fails ? 1 : 0);
