// Smoke test: juega una partida completa agente (esta CLI) vs bot CPU vía la API.
// Uso: node test/smoke.mjs [http://localhost:8787]
import { tryCompile } from '../shared/parser.js';
import { simulateShot } from '../shared/solver.js';
import { searchShot } from '../agents/lib.js';

const BASE = process.argv[2] || 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, m = 'GET', b = null) => {
  const res = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await res.json();
  if (!res.ok) throw new Error(`${p}: ${d.error || res.statusText}`);
  return d;
};

async function main() {
  await api('/api/health');
  console.log('✓ servidor vivo');

  const room = await api('/api/rooms', 'POST', { name: 'smoke' });
  const code = room.code;
  console.log(`✓ sala ${code} creada`);

  const me = await api(`/api/rooms/${code}/join`, 'POST', { name: 'ClineAgent', team: 'left' });
  await api(`/api/rooms/${code}/addbot`, 'POST', { level: 3 });
  const st0 = await api(`/api/rooms/${code}/state`);
  if (st0.players.filter((p) => !p.isBot).length !== 1 || !st0.players.some((p) => p.isBot)) throw new Error('jugadores incorrectos');
  await api(`/api/rooms/${code}/start`, 'POST', { playerId: me.player.id });
  console.log('✓ partida iniciada (ClineAgent vs CPU nivel 3)');

  let kills = 0, suicide = 0, shots = 0, lastTs = 0;
  const myId = me.player.id;
  for (let i = 0; i < 400; i++) {
    const st = await api(`/api/rooms/${code}/state`);
    if (st.lastShot && st.lastShot.ts > lastTs) {
      lastTs = st.lastShot.ts; shots++;
      if (st.lastShot.result.type === 'kill') kills++;
      if (st.lastShot.result.type === 'suicide') suicide++;
    }
    if (st.phase === 'over') {
      console.log(`✓ partida terminada. Ganador: ${st.winner}. Disparos=${shots} kills=${kills} suicidios=${suicide}`);
      if (shots < 2) throw new Error('se esperaban más disparos');
      if (kills < 1) throw new Error('nadie murió: la simulación no está matando');
      console.log('PASS ✔');
      return;
    }
    if (st.turn && st.turn.playerId === myId) {
      const cand = searchShot(st, st.turn.soldierId, 30);
      const r = await api(`/api/rooms/${code}/fire`, 'POST', { playerId: myId, ...cand });
      if (r.error) console.log('  (fire error:', r.error, ')');
    }
    await sleep(500);
  }
  throw new Error('timeout: la partida no terminó');
}

main().catch((e) => { console.error('FAIL ✘:', e.message); process.exit(1); });
