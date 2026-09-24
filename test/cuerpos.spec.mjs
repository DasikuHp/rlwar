// Cuerpos de las peticiones (spec/08 §10.1 y §10.6; auditoría de la sesión 3, 2026-09-24), por la API con servidor
// propio. (1) El tope de /api/lab (48 MiB) es exacto: justo el tope se lee entero; uno más, 413; justo 4× el tope,
// todavía 413; más, se corta sin responder (las rutas de sala ya lo prueban en arreglos-parte3-extra-api). (2) Si la
// conexión se corta antes de que llegue todo el cuerpo anunciado, la ruta no se ejecuta: antes, lo que había llegado se
// procesaba como si fuera el cuerpo entero (un POST /api/rooms cortado creaba una sala). Escrito ANTES del arreglo y
// congelado. Uso: node test/cuerpos.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const { LIMITS } = await import('../shared/constants.js');
const { TEMPLATES } = await import('../shared/templates.js');
const L = LIMITS.genomeBytes;

const port = 30000 + (process.pid % 10000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-cuerpos-')) }, stdio: 'ignore' });
const t0 = Date.now();
for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
// manda `head` (Buffer) y luego espacios hasta `n` bytes en total; {status, body} si responde, {cut: true} si cortan sin responder
const send = (path, n, head = Buffer.alloc(0)) => new Promise((resolve) => {
  const req = request({ host: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': n } }, (res) => {
    const parts = []; res.on('data', (c) => parts.push(c));
    res.on('end', () => { const t = Buffer.concat(parts).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ } resolve({ status: res.statusCode, body: j }); });
  });
  req.on('error', () => resolve({ cut: true }));
  const pad = Buffer.alloc(1 << 16, 0x20);
  let left = n - head.length;
  if (head.length && !req.write(head)) { /* sigue con el relleno al vaciarse */ }
  const pump = () => { while (left > 0) { const k = Math.min(left, pad.length); left -= k; if (!req.write(k === pad.length ? pad : pad.subarray(0, k))) { req.once('drain', pump); return; } } req.end(); };
  pump();
});
// abre una conexión, anuncia `announced` bytes, manda solo `text` y corta
const cutAfter = async (path, text, announced) => {
  const s = net.connect(port, '127.0.0.1');
  await new Promise((r, j) => { s.on('connect', r); s.on('error', j); });
  s.on('error', () => { /* el corte es a propósito */ });
  s.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${announced}\r\n\r\n${text}`);
  await sleep(300);
  s.destroy();
  await sleep(500);
};

try {
  await check('/api/lab: justo 48 MiB se leen enteros (un genoma válido relleno de espacios hasta el tope se importa); uno más → 413 con el motivo', async () => {
    const g = { ...JSON.parse(JSON.stringify(TEMPLATES.sniper.genome)), id: 'tope-exacto', name: 'Tope exacto' };
    const head = Buffer.from(JSON.stringify(g), 'utf8');
    const r = await send('/api/lab/nets/import', L, head);
    assert.ok(r.status === 200 || r.status === 201, `justo el tope: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal((await api('/api/lab/nets/tope-exacto')).status, 200, 'la red importada existe');
    const over = await send('/api/lab/nets/import', L + 1, Buffer.from(JSON.stringify({ ...g, id: 'tope-mas-uno' }), 'utf8'));
    assert.equal(over.status, 413, JSON.stringify(over).slice(0, 200));
    assert.match(over.body.error, new RegExp(String(L)));
    assert.equal((await api('/api/lab/nets/tope-mas-uno')).status, 404, 'no se importa');
  });

  await check('/api/lab: justo 4× el tope todavía responde 413; más de 4× corta la conexión sin responder; el servidor sigue sano', async () => {
    assert.equal((await send('/api/lab/nets/import', 4 * L)).status, 413, 'justo 4× el tope');
    assert.deepEqual(await send('/api/lab/nets/import', 4 * L + 1 + (1 << 18)), { cut: true });
    assert.equal((await api('/api/health')).status, 200);
  });

  await check('sala: cortar la conexión antes de que llegue todo el cuerpo no ejecuta la ruta (no se crea la sala)', async () => {
    const before = (await api('/api/rooms')).body;
    const count = (x) => (Array.isArray(x) ? x : (x && x.rooms) || []).length;
    await cutAfter('/api/rooms', '{"name":"Cortada"}', 1000);
    const after = (await api('/api/rooms')).body;
    const rooms = Array.isArray(after) ? after : (after && after.rooms) || [];
    assert.equal(count(after), count(before), `salas: ${JSON.stringify(rooms.map((r) => r.name))}`);
    assert.ok(!rooms.some((r) => r.name === 'Cortada'));
    const ok = await api('/api/rooms', 'POST', { name: 'Entera' });
    assert.equal(ok.status, 201, ok.text);
    assert.ok((await api('/api/rooms')).body.rooms.some((r) => r.name === 'Entera'), 'una petición entera sí crea su sala');
  });

  await check('/api/lab: cortar la conexión antes de que llegue todo el cuerpo no importa la red aunque lo llegado sea un JSON completo', async () => {
    const g = { ...JSON.parse(JSON.stringify(TEMPLATES.sniper.genome)), id: 'import-cortado', name: 'Cortado' };
    const text = JSON.stringify(g);
    await cutAfter('/api/lab/nets/import', text, Buffer.byteLength(text) + 1000);
    assert.equal((await api('/api/lab/nets/import-cortado')).status, 404, 'no se importa');
    assert.equal((await api('/api/health')).status, 200);
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (cuerpos: tope exacto de /api/lab y cuerpos cortados)');
process.exit(fails ? 1 : 0);
