// Sondeo sin ventana (sesiones 7 y 8): arranca el servidor en el puerto 8799 con una carpeta temporal (GW_EVO_DIR) y
// recorre el juego en Chrome headless por el protocolo de DevTools (WebSocket nativo de Node 24). Imprime excepciones y
// errores de consola. Uso: node tools/sondeo.mjs tools/sondeo-crear.mjs  (los pasos exportan default async ({go, ev, sleep, api, load, shot}) => {...})
// Las capturas van a la carpeta de la variable SP (SP=<carpeta> node tools/sondeo.mjs …).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PPORT || 8799), DBG = Number(process.env.DBG || 9339); // PPORT y DBG: para correr dos sondeos a la vez
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evo = mkdtempSync(join(tmpdir(), 'gw-probe-'));
const srv = spawn(process.execPath, ['server/server.js'], { cwd: 'E:/grafwar', env: { ...process.env, PORT: String(PORT), GW_EVO_DIR: evo }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', (d) => process.stdout.write(`[servidor] ${d}`));
const base = `http://127.0.0.1:${PORT}`;
const api = async (path, method = 'GET', body) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/worlds'); break; } catch { await sleep(200); } }

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'gw-chrome-'))}`, '--window-size=1280,800', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
let tabs;
for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find((t) => t.type === 'page')) break; } catch { /* aún no */ } await sleep(200); }
const page = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const problems = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') problems.push(`EXCEPCIÓN ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) problems.push(`consola.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  // un diálogo del navegador (p. ej. «¿salir con cambios sin guardar?» al recargar el editor) pararía el sondeo: se acepta y se dice
  if (msg.method === 'Page.javascriptDialogOpening') { console.log(`   (diálogo ${msg.params.type} aceptado${msg.params.message ? `: ${msg.params.message}` : ''})`); send('Page.handleJavaScriptDialog', { accept: true }); }
});
// cada orden espera su respuesta 30 s como mucho: si Chrome no contesta, se apunta y el sondeo sigue (antes se colgaba)
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); problems.push(`Chrome no contestó a ${method}`); r({}); } }, 30000);
});
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const go = async (hash, wait = 1500) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(wait); };
const load = async (path, wait = 2500) => { await send('Page.navigate', { url: base + path }); await sleep(wait); };
const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(file, Buffer.from(r.result.data, 'base64')); };

try {
  const steps = (await import(pathToFileURL(process.argv[2]).href)).default;
  await steps({ go, ev, sleep, api, load, shot, problems, send });
} catch (e) { console.log('FALLO DEL SONDEO', e); }
console.log(problems.length ? `\n${problems.length} problema(s):\n${problems.join('\n')}` : '\nsin excepciones ni errores de consola');
ws.close(); chrome.kill(); srv.kill();
process.exit(0);
