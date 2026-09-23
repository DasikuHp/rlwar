// Servidor HTTP: estáticos + API REST + SSE para clientes y agentes IA.
// Sin dependencias externas: Node >= 18.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rooms, getRoom, createRoom } from './rooms.js';
import { listAgents } from '../agents/registry.js';
import { labApi, onExhibitionOver } from '../evo/api.js';
import * as C from '../shared/constants.js';

const PORT = Number(process.env.PORT) || 8787;
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT_DIR, 'public');
// módulos que el navegador comparte con el servidor (spec/08 §9.3): shared/*.js y la verdad; nada más
const SHARED_JS = /^\/shared\/[a-z0-9-]+\.js$/;
const EVO_JS = new Set(['/evo/truth.js', '/evo/voice.js']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
};
// pasado el tope deja de guardar y lee hasta el final sin guardar, para poder responder 413 (M10); más de 4× el tope, corta
const BODY_LIMIT = 1e5;
const OVER = Symbol('cuerpo demasiado grande');
// el tope es de bytes y el cuerpo se decodifica entero al final: una letra partida entre dos trozos llega intacta
// (spec/08 §10.6)
const readBody = (req) => new Promise((resolve) => {
  const parts = []; let bytes = 0, over = false, done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (over) return resolve(OVER);
    const d = Buffer.concat(parts).toString('utf8');
    try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); }
  };
  req.on('data', (c) => {
    bytes += c.length;
    if (over) { if (bytes > 4 * BODY_LIMIT) req.destroy(); return; }
    if (bytes > BODY_LIMIT) { over = true; parts.length = 0; return; }
    parts.push(c);
  });
  req.on('end', finish);
  req.on('close', finish);
});
const tooBig = (res) => json(res, 413, { error: `El cuerpo supera ${BODY_LIMIT} bytes.` });

const roomList = () => [...rooms.values()].map((r) => ({
  code: r.code, name: r.name, phase: r.phase,
  players: r.players.map((p) => ({ name: p.name, team: p.team, isBot: p.isBot })),
})).reverse();

async function api(req, res, parts, url) {
  const method = req.method;
  // /api/health
  if (parts[1] === 'health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (parts[1] === 'agents') return json(res, 200, { agents: listAgents() });
  if (parts[1] === 'lab') return labApi(req, res, parts, url); // laboratorio (spec/08), cuerpos hasta 48 MB

  if (parts[1] !== 'rooms') return json(res, 404, { error: 'Ruta desconocida' });

  // /api/rooms
  if (!parts[2]) {
    if (method === 'GET') return json(res, 200, { rooms: roomList() });
    if (method === 'POST') {
      const b = await readBody(req);
      if (b === OVER) return tooBig(res);
      const room = createRoom(b.name, { soldiersPerPlayer: b.soldiers, seed: b.seed, speed: b.speed });
      room.onGameOver = onExhibitionOver; // exhibición: cuenta, se guarda y, con learn:true, enseña (spec/04 §10.3)
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
  if (body === OVER) return tooBig(res);
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
  if (SHARED_JS.test(url.pathname) || EVO_JS.has(url.pathname)) {
    const file = join(ROOT_DIR, url.pathname.slice(1));
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(readFileSync(file));
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
