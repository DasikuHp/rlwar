// Test de self-play: los agentes juegan solos (IA vs IA) y la partida debe terminar.
// Uso: node test/agents.spec.mjs [url]   (por defecto http://localhost:8787)
import { pairings } from '../arena/pairings.mjs';

const BASE = process.argv[2] || 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, m = 'GET', b = null) => {
  const res = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p}: ${d.error || res.statusText}`);
  return d;
};

async function main() {
  const agents = (await api('/api/agents')).agents.map((a) => a.id);
  console.log('✓ agentes registrados:', agents.join(', '));
  if (agents.length < 3) throw new Error('se esperaban al menos 3 agentes');

  for (const [a, b] of pairings(['sniper', 'greedy', 'chaos'], 3)) {
    const room = await api('/api/rooms', 'POST', { name: `spec ${a} vs ${b}` });
    const code = room.code;
    await api(`/api/rooms/${code}/addagent`, 'POST', { type: a, level: 3, team: 'left' });
    await api(`/api/rooms/${code}/addagent`, 'POST', { type: b, level: 3, team: 'right' });
    const started = await api(`/api/rooms/${code}/start`, 'POST', {});
    if (started.error) throw new Error('start: ' + started.error);

    const t0 = Date.now();
    let state = null;
    while (Date.now() - t0 < 90000) {
      state = await api(`/api/rooms/${code}/state`);
      if (state.phase === 'over') break;
      await sleep(300);
    }
    if (!state || state.phase !== 'over') throw new Error(`la sala ${code} (${a} vs ${b}) no terminó`);
    const shots = state.chat.filter((c) => /eliminó|estrelló|chocó|explotó|recorrido/.test(c.text)).length;
    if (shots < 2) throw new Error(`los agentes no dispararon en ${code}`);
    console.log(`✓ ${a} vs ${b}: ganó ${state.winner} · ${shots} disparos · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log('PASS ✔ (self-play de agentes)');
}

main().catch((e) => { console.error('FAIL ✘:', e.message); process.exit(1); });
