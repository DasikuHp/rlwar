// Arena de self-play: enfrenta agentes entre sí (IA vs IA, tú contra ti mismo),
// opcionalmente en una sala en vivo que puedes ver en el navegador.
//
// Uso:
//   node arena/selfplay.mjs --agents sniper,greedy --games 3 --spawn-fast
//   node arena/selfplay.mjs --agents sniper,greedy,artillery,chaos --games 6
//
// --spawn-fast levanta un servidor propio en modo rápido (GW_FAST=1) para que las
// partidas duren segundos; sin él usa el servidor indicado en --url (por defecto 8787).
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pairings } from './pairings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes('--' + n);

// --log <archivo>: además de consola, escribe resultados en un fichero (para seguirlo)
const LOG = opt('log', null);
const emit = (line) => { console.log(line); if (LOG) appendFileSync(LOG, line + '\n'); };
if (LOG) writeFileSync(LOG, '');


const spawnFast = flag('spawn-fast');
const PORT = Number(opt('port', spawnFast ? 8790 : 8787));
const BASE = opt('url', `http://localhost:${PORT}`);
const GAMES = Number(opt('games', 3));
const SOLDIERS = Math.max(1, Math.min(4, Number(opt('soldiers', 2)) || 2));
const LEVEL = Number(opt('level', 3));
const TIMEOUT_MS = Number(opt('timeout', 180000));
const agentsArg = opt('agents', 'sniper,greedy');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, m = 'GET', b = null) => {
  const res = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await res.json();
  if (!res.ok) throw new Error(`${p}: ${d.error || res.statusText}`);
  return d;
};

async function waitForServer(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await api('/api/health'); return true; } catch { await sleep(300); }
  }
  throw new Error(`El servidor ${BASE} no respondió`);
}

async function playGame(typeA, typeB, gameNo, total) {
  const room = await api('/api/rooms', 'POST', { name: `selfplay ${typeA} vs ${typeB}`, soldiers: SOLDIERS });
  const code = room.code;
  await api(`/api/rooms/${code}/addagent`, 'POST', { type: typeA, level: LEVEL, team: 'left' });
  await api(`/api/rooms/${code}/addagent`, 'POST', { type: typeB, level: LEVEL, team: 'right' });
  await api(`/api/rooms/${code}/start`, 'POST', {});
  emit(`▶ Partida ${gameNo}/${total}: ${typeA} (cyan) vs ${typeB} (naranja) → ${BASE}/#room=${code}`);

  const t0 = Date.now();
  let lastTs = 0, shots = 0;
  while (Date.now() - t0 < TIMEOUT_MS) {
    const st = await api(`/api/rooms/${code}/state`);
    if (st.lastShot && st.lastShot.ts > lastTs) { lastTs = st.lastShot.ts; shots++; }
    if (st.phase === 'over') {
      const mine = st.players.filter((p) => p.agentType === typeA);
      const rival = st.players.filter((p) => p.agentType === typeB);
      const aKills = mine.reduce((s, p) => s + (p.kills || 0), 0);
      const bKills = rival.reduce((s, p) => s + (p.kills || 0), 0);
      return {
        code, winner: st.winner, shots, seconds: (Date.now() - t0) / 1000,
        a: { type: typeA, kills: aKills, left: st.soldiers.filter((s) => s.alive && s.team === 'left').length },
        b: { type: typeB, kills: bKills, left: st.soldiers.filter((s) => s.alive && s.team === 'right').length },
      };
    }
    await sleep(400);
  }
  return { code, winner: null, shots, seconds: (Date.now() - t0) / 1000, a: { type: typeA, kills: 0 }, b: { type: typeB, kills: 0 }, timeout: true };
}

// Enfrentamientos: round-robin con alternancia de lados (función en pairings.mjs)
async function main() {
  const types = agentsArg.split(',').map((s) => s.trim()).filter(Boolean);
  let child = null;
  if (spawnFast) {
    emit(`🧪 Levantando servidor rápido en :${PORT} (GW_FAST=1)...`);
    child = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], {
      env: { ...process.env, GW_FAST: '1', PORT: String(PORT) }, stdio: 'ignore',
    });
  }
  try {
    await waitForServer();
    const available = (await api('/api/agents')).agents.map((a) => a.id);
    emit(`🤖 Agentes disponibles: ${available.join(', ')}`);
    for (const t of types) if (!available.includes(t)) throw new Error(`Agente desconocido: ${t}`);

    const results = [];
    const schedule = pairings(types, GAMES);
    for (let g = 0; g < schedule.length; g++) {
      const [a, b] = schedule[g];
      results.push(await playGame(a, b, g + 1, schedule.length));
    }

    // tabla de posiciones
    const table = {};
    for (const t of types) table[t] = { type: t, games: 0, wins: 0, kills: 0, left: 0 };
    emit('\n📊 Resumen de partidas');
    for (const r of results) {
      const w = r.winner === 'left' ? r.a.type : r.winner === 'right' ? r.b.type : 'empate';
      emit(`  ${r.code}: ${r.a.type} vs ${r.b.type} → gana ${r.winner ? w : '— (timeout)'} · ${r.shots} disparos · ${r.seconds.toFixed(1)}s · kills ${r.a.kills}-${r.b.kills}`);
      for (const side of ['a', 'b']) {
        const t = table[r[side].type];
        t.games++; t.kills += r[side].kills || 0; t.left += r[side].left || 0;
      }
      if (r.winner === 'left') table[r.a.type].wins++;
      if (r.winner === 'right') table[r.b.type].wins++;
    }
    emit('\n🏆 Tabla');
    const rows = Object.values(table).sort((x, y) => y.wins - x.wins || y.kills - x.kills);
    for (const r of rows) {
      emit(`  ${r.type.padEnd(10)} partidas ${r.games}  victorias ${r.wins}  kills ${r.kills}  supervivientes ${r.left}`);
    }
    const winner = rows[0];
    emit(`\n✨ Mejor agente: ${winner.type} (${winner.wins} victorias)`);
  } finally {
    if (child) child.kill();
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
