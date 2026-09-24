// Huecos de la prueba de mutantes de la auditoría de la sesión 3 (2026-09-24), por la API: un cuerpo cortado a mitad no
// ejecuta la ruta tampoco al crear una red (POST /api/lab/nets) ni en las rutas de una sala (POST /api/rooms/:code/join).
// cuerpos.spec solo lo probaba al importar una red y al crear una sala. Escrito DESPUÉS del código (cubre supervivientes)
// y congelado. Levanta su propio servidor. Uso: node test/huecos-s3-api.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

const port = 30000 + ((process.pid + 5000) % 10000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: mkdtempSync(join(tmpdir(), 'gw-evo-huecos-api-')) }, stdio: 'ignore' });
const t0 = Date.now();
for (;;) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* aún no */ } if (Date.now() - t0 > 20000) throw new Error('el servidor no arranca'); await sleep(100); }
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* no es JSON */ }
  return { status: r.status, body: j, text: t };
};
// abre una conexión, anuncia `announced` bytes, manda solo `text` (un JSON entero) y corta
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
  await check('/api/lab/nets: cortar la conexión antes del final del cuerpo no crea la red aunque lo llegado sea un JSON completo', async () => {
    const before = (await api('/api/lab/nets')).body.nets.length;
    const text = JSON.stringify({ template: 'sniper', name: 'Cortada' });
    await cutAfter('/api/lab/nets', text, Buffer.byteLength(text) + 1000);
    const nets = (await api('/api/lab/nets')).body.nets;
    assert.equal(nets.length, before, JSON.stringify(nets.map((n) => n.name)));
    const ok = await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Entera' });
    assert.equal(ok.status, 201, 'entera sí: ' + ok.text);
  });

  await check('/api/lab/nets/:id/children: un cuerpo cortado no pone en marcha el trabajo (con {} sí arrancaría, con los valores por defecto)', async () => {
    const id = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Madre' })).body.id;
    const text = JSON.stringify({ n: 2 });
    await cutAfter(`/api/lab/nets/${id}/children`, text, Buffer.byteLength(text) + 1000);
    assert.deepEqual((await api('/api/lab/jobs')).body.jobs, [], 'ningún trabajo');
  });

  await check('sala: sus rutas de acción solo admiten POST (otro método → 405 con el motivo)', async () => {
    const room = (await api('/api/rooms', 'POST', { name: 'Metodos' })).body;
    for (const m of ['PUT', 'DELETE']) {
      const r = await api(`/api/rooms/${room.code}/join`, m, { name: 'X', team: 'left' });
      assert.equal(r.status, 405, `${m}: ${r.text}`); assert.ok(r.body && r.body.error, r.text);
    }
    assert.equal((await api(`/api/rooms/${room.code}/state`)).body.players.length, 0);
  });

  await check('sala: cortar la conexión en una de sus rutas (join) no la ejecuta; entera, sí', async () => {
    const room = (await api('/api/rooms', 'POST', { name: 'Huecos' })).body;
    const text = JSON.stringify({ name: 'Cortado', team: 'left' });
    await cutAfter(`/api/rooms/${room.code}/join`, text, Buffer.byteLength(text) + 1000);
    const st = (await api(`/api/rooms/${room.code}/state`)).body;
    assert.ok(!st.players.some((p) => p.name === 'Cortado'), JSON.stringify(st.players.map((p) => p.name)));
    const ok = await api(`/api/rooms/${room.code}/join`, 'POST', { name: 'Entero', team: 'left' });
    assert.equal(ok.status, 200, ok.text);
    assert.ok((await api(`/api/rooms/${room.code}/state`)).body.players.some((p) => p.name === 'Entero'));
    assert.equal((await api('/api/health')).status, 200);
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (huecos s3 por la API: cuerpos cortados al crear una red y en una sala)');
process.exit(fails ? 1 : 0);
