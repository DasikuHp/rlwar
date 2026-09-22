// Servidor HTTP: estáticos + API REST + SSE para clientes y agentes IA.
// Sin dependencias externas: Node >= 18.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rooms, getRoom, createRoom } from './rooms.js';
import { listAgents } from '../agents/registry.js';
import * as C from '../shared/constants.js';

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
});

const roomList = () => [...rooms.values()].map((r) => ({
  code: r.code, name: r.name, phase: r.phase,
  players: r.players.map((p) => ({ name: p.name, team: p.team, isBot: p.isBot })),
})).reverse();

async function api(req, res, parts, url) {
  const method = req.method;
  // /api/health
  if (parts[1] === 'health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (parts[1] === 'agents') return json(res, 200, { agents: listAgents() });

  if (parts[1] !== 'rooms') return json(res, 404, { error: 'Ruta desconocida' });

  // /api/rooms
  if (!parts[2]) {
    if (method === 'GET') return json(res, 200, { rooms: roomList() });
    if (method === 'POST') {
      const b = await readBody(req);
      const room = createRoom(b.name, { soldiersPerPlayer: b.soldiers, seed: b.seed });
      return json(res, 201, { code: room.code, name: room.name, soldiers: room.soldiersPerPlayer, seed: room.seed });
    }
    return json(res, 405, { error: 'Método no permitido' });
  }

  const room = getRoom(parts[2]);
  if (!room) return json(res, 404, { error: 'Sala no encontrada' });
  const sub = parts[3];

  if (!sub && method === 'GET') return json(res, 200, room.snapshot());
  if (sub === 'state' && method === 'GET') return json(res, 200, room.snapshot());

  if (sub === 'events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', ...CORS,
    });
    res.write('retry: 2000\n\n');
    res.write(`event: hello\ndata: ${JSON.stringify(room.snapshot())}\n\n`);
    room.listeners.add(res);
    req.on('close', () => room.listeners.delete(res));
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(ping); } }, 20000);
    req.on('close', () => clearInterval(ping));
    return;
  }

  if (method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  const body = await readBody(req);
  const pid = body.playerId;

  switch (sub) {
    case 'join': {
      const r = room.addPlayer(body.name, body.team);
      return r.error ? json(res, 400, r) : json(res, 200, { ...r, code: room.code });
    }
    case 'addbot': return json(res, 200, room.addBot(body.level ?? 2, body.type));
    case 'addagent': return json(res, 200, room.addAgent(body.type, body));
    case 'start': return json(res, 200, room.start(pid || body.playerId));
    case 'fire': return json(res, 200, room.fire(pid, body));
    case 'move': return json(res, 200, room.move(pid, body.stay ? 'stay' : { x: body.x, y: body.y }));
    case 'chat': return json(res, 200, room.addChat(pid, body.text));
    case 'rematch': return json(res, 200, room.rematch());
    default: return json(res, 404, { error: 'Endpoint desconocido' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (parts[0] === 'api') {
    try { await api(req, res, parts, url); }
    catch (e) { json(res, 500, { error: e.message }); }
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const path = normalize(join(PUBLIC_DIR, rel));
  if (!path.startsWith(PUBLIC_DIR) || !existsSync(path)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});

server.listen(PORT, () => {
  console.log(`⚔️  Graphwar Agents en http://localhost:${PORT}`);
  console.log(`    API de agentes: ${C.MODES.FUNCTION ? 'POST /api/rooms/:code/fire' : ''}`);
});
