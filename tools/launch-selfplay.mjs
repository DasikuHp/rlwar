// Lanzador: deja el servidor corriendo, crea una partida IA vs IA con
// temperaturas distintas y la abre en el navegador. Uso: node tools/launch-selfplay.mjs
import { spawn, exec } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 8787;
const BASE = `http://localhost:${PORT}`;

async function api(path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} en ${path}`);
  return data;
}

async function healthy() {
  try {
    const r = await fetch(BASE + '/api/health');
    return r.ok;
  } catch { return false; }
}

if (!(await healthy())) {
  console.log('Arrancando servidor...');
  const srv = spawn(process.execPath, ['server/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(PORT) },
  });
  srv.unref();
  for (let i = 0; i < 30 && !(await healthy()); i++) await sleep(500);
}
if (!(await healthy())) {
  console.error('No se pudo arrancar el servidor en ' + BASE);
  process.exit(1);
}

const room = await api('/api/rooms', 'POST', { name: 'MAD de agentes 4v4', soldiers: 4 });
// pareja rotatoria para no ver siempre lo mismo (cada agente con su temperatura)
const pairs = [['sniper', 'artillery'], ['greedy', 'chaos'], ['sniper', 'chaos'], ['greedy', 'artillery'], ['artillery', 'chaos'], ['sniper', 'greedy']];
const temps = { sniper: 0.1, artillery: 0.6, greedy: 0.4, chaos: 0.9 };
const [a, b] = pairs[Math.floor(Math.random() * pairs.length)];
await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: a, level: 3, team: 'left', temperature: temps[a] });
await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: b, level: 3, team: 'right', temperature: temps[b] });
await api(`/api/rooms/${room.code}/start`, 'POST', {});

const url = `${BASE}/#room=${room.code}`;
console.log(`\n🤖 MAD en vivo: ${url}`);
console.log(`   Izquierda: ${a} · Derecha: ${b} (4 por jugador)`);
console.log('   El razonamiento de cada agente sale en el panel Registro (💭).');
exec(`cmd /c start "" "${url}"`);
