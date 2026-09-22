// CLI para que un agente IA (p. ej. Cline) juegue Graphwar por HTTP.
// Uso:
//   node agent/agent.mjs rooms
//   node agent/agent.mjs create --name "Sala Cline"
//   node agent/agent.mjs join --room ABCD --name Cline --team left
//   node agent/agent.mjs state
//   node agent/agent.mjs fire --expr "0.5*x" [--mode function|ode1|ode2] [--angle 30]
//   node agent/agent.mjs chat --text "hola"
//   node agent/agent.mjs autopilot [--tries 150]   # juega solo buscando la mejor función
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryCompile } from '../shared/parser.js';
import { simulateShot } from '../shared/solver.js';
import { searchShot } from '../agents/lib.js';

// `opt` debe existir antes de usarse: se define más abajo pero solo se invoca en funciones.

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};

// --url permite apuntar a otro servidor; --session permite varias instancias de agente en paralelo
const BASE = process.env.GRAPHWAR_URL || opt('url', 'http://localhost:8787');
const SESSION = join(dirname(fileURLToPath(import.meta.url)), opt('session', '.agent-session.json'));

async function api(path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function loadSession() {
  if (!existsSync(SESSION)) throw new Error('No hay sesión. Haz join primero.');
  return JSON.parse(readFileSync(SESSION, 'utf8'));
}
function saveSession(s) { writeFileSync(SESSION, JSON.stringify(s, null, 2)); }

const state = async () => {
  const s = loadSession();
  return api(`/api/rooms/${s.code}/state`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  switch (cmd) {
    case 'rooms': console.log(JSON.stringify(await api('/api/rooms'), null, 2)); break;
    case 'create': {
      const r = await api('/api/rooms', 'POST', { name: opt('name', 'Sala') });
      saveSession({ code: r.code });
      console.log(`Sala creada: ${r.code}`);
      break;
    }
    case 'join': {
      const code = opt('room');
      if (!code) throw new Error('--room requerido');
      const r = await api(`/api/rooms/${code}/join`, 'POST', { name: opt('name', 'Cline'), team: opt('team', 'auto') });
      saveSession({ code: code.toUpperCase(), playerId: r.player.id, token: r.token, name: r.player.name, team: r.player.team });
      console.log(`Unido a ${code.toUpperCase()} como ${r.player.name} (equipo ${r.player.team}), playerId=${r.player.id}`);
      break;
    }
    case 'state': {
      const st = await state();
      const s = loadSession();
      const mine = s.playerId ? st.soldiers.filter((q) => q.ownerId === s.playerId) : [];
      console.log(`Sala ${st.code} · fase=${st.phase} · turno=${st.turn ? st.turn.playerId + ' (soldado ' + st.turn.soldierId + ')' : '-'}`);
      console.log('Jugadores:', st.players.map((p) => `${p.name}[${p.team}${p.isBot ? '/CPU' : ''}] x${p.alive}`).join(', '));
      console.log('Mis soldados:', mine.map((m) => `${m.id} (${m.x.toFixed(1)},${m.y.toFixed(1)}) ${m.alive ? 'vivo' : 'muerto'}`).join(' | '));
      console.log('Enemigos:', st.soldiers.filter((q) => q.team !== (mine[0]?.team) && q.alive).map((m) => `${m.id} (${m.x.toFixed(1)},${m.y.toFixed(1)})`).join(' | '));
      console.log('Obstáculos:', st.obstacles.length);
      console.log('Chat:');
      for (const c of st.chat.slice(-8)) console.log(' ', c.text);
      break;
    }
    case 'fire': {
      const s = loadSession();
      const body = { playerId: s.playerId, mode: opt('mode', 'function'), expr: opt('expr', 'x'), angle: Number(opt('angle', '0')) };
      const r = await api(`/api/rooms/${s.code}/fire`, 'POST', body);
      console.log(JSON.stringify(r));
      break;
    }
    case 'chat': {
      const s = loadSession();
      console.log(JSON.stringify(await api(`/api/rooms/${s.code}/chat`, 'POST', { playerId: s.playerId, text: opt('text', '') })));
      break;
    }
    case 'autopilot': {
      const s = loadSession();
      const tries = Number(opt('tries', '150'));
      console.log(`🤖 Modo autopilot en sala ${s.code} (${s.name}, equipo ${s.team})`);
      for (let i = 0; i < 200; i++) {
        const st = await state();
        if (st.phase === 'over') {
          console.log(st.winner === s.team ? '🏆 ¡Ganamos!' : '😖 Perdimos.');
          return;
        }
        if (st.turn && st.turn.playerId === s.playerId && st.turn.stage === 'move') {
          await api(`/api/rooms/${s.code}/move`, 'POST', { playerId: s.playerId, stay: true }); // F1: tras disparar, destino
        } else if (st.turn && st.turn.playerId === s.playerId) {
          const cand = searchShot(st, st.turn.soldierId, tries);
          console.log(`🎯 Disparo: [${cand.mode}] ${cand.expr}${cand.angle != null ? ` (ángulo ${Number(cand.angle).toFixed(0)}°)` : ''}`);
          const r = await api(`/api/rooms/${s.code}/fire`, 'POST', { playerId: s.playerId, ...cand });
          console.log('   →', JSON.stringify(r.result || r.error));
          await sleep(4000);
        } else await sleep(1200);
      }
      break;
    }
    default:
      console.log(`Graphwar Agents — CLI de agente remoto

Uso: node agent/agent.mjs <comando> [opciones]

Comandos:
  rooms                                lista de salas
  create  --name "Sala"                crea sala (guarda sesión)
  join    --room ABCD [--name N] [--team left|right|auto]
  state                                muestra el tablero y el turno actual
  fire    --expr "sin(x/5)*3" [--mode function|ode1|ode2] [--angle 30]
  chat    --text "hola"
  autopilot [--tries 40]               juega solo hasta el final

Opciones globales:
  --url http://host:puerto             servidor (por defecto :8787)
  --session fichero.json               sesión alternativa (varias instancias a la vez)`);
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
