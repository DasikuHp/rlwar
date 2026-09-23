// Jugador remoto genérico: el "cerebro" puede ser cualquiera — tú, un RWKV local
// (Vectormind), otro script o el heurístico incluido. El cerebro habla por el chat
// (trashtalk de verdad, lo ve el rival y los espectadores) y dispara por la API.
//
// Uso:
//   node agent/remote.mjs --room ABCD --name Muse --team left
//   node agent/remote.mjs --room ABCD --name RWKV --brain http --brain-url http://localhost:8000/decide
//
// Cerebro HTTP: POST a --brain-url con {you, soldier, soldiers, enemies, obstacles, bites,
// history, chat, temperature} y responde {mode, expr, angle?, say?}. `obstacles`: círculos {kind:'circle', x, y, r}
// o rectángulos {x, y, w, h}; `bites`: bocados {x, y, r} que las explosiones le han comido al terreno (spec/01 §10).
// `say` se publica en el chat ANTES de disparar, para que el rival lo lea en vivo.
import { searchShot } from '../agents/lib.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BASE = process.env.GRAPHWAR_URL || opt('url', 'http://localhost:8787');
const ROOM = (opt('room', '') || '').toUpperCase();
const NAME = opt('name', 'Remoto');
const TEAM = opt('team', 'auto');
const BRAIN = opt('brain', 'heuristic');
const BRAIN_URL = opt('brain-url', '');
const TEMPERATURE = Math.max(0, Math.min(1, Number(opt('temperature', '0.7')) || 0));
const TIMEOUT = Number(opt('timeout', '20000'));

if (!ROOM) { console.error('Falta --room ABCD'); process.exit(1); }
if (BRAIN === 'http' && !BRAIN_URL) { console.error('Falta --brain-url http://...'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, method = 'GET', body = null) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path}: ${res.status}`);
  return data;
}

async function askHttpBrain(payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(BRAIN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`cerebro HTTP ${res.status}`);
    const d = await res.json();
    if (!d || typeof d.expr !== 'string' || !d.expr.trim()) throw new Error('cerebro sin expr');
    return { mode: d.mode || 'function', expr: d.expr.trim().slice(0, 200), angle: Number(d.angle) || 0, say: String(d.say || '').slice(0, 200) };
  } finally { clearTimeout(t); }
}

function heuristicBrain(st, soldier) {
  const shot = searchShot(st, soldier.id, 60);
  return { ...shot, say: '' };
}

async function main() {
  const j = await api(`/api/rooms/${ROOM}/join`, 'POST', { name: NAME, team: TEAM });
  const me = { id: j.player.id, team: j.player.team };
  console.log(`Unido a ${ROOM} como ${j.player.name} (equipo ${me.team}, playerId=${me.id}). Cerebro: ${BRAIN}. Esperando turno...`);
  let talked = new Set();
  for (;;) {
    const st = await api(`/api/rooms/${ROOM}/state`);
    if (st.phase === 'over') {
      console.log(st.winner ? (st.winner === me.team ? '🏆 ¡Ganamos!' : '😖 Perdimos.') : '🤝 Empate.');
      return;
    }
    if (st.phase !== 'playing') { await sleep(1500); continue; }
    if (st.turn && st.turn.playerId === me.id) {
      const soldier = st.soldiers.find((s) => s.id === st.turn.soldierId);
      const enemies = st.soldiers.filter((s) => s.alive && s.team !== me.team);
      const payload = {
        you: { name: NAME, team: me.team }, temperature: TEMPERATURE,
        soldier: { id: soldier.id, x: soldier.x, y: soldier.y },
        soldiers: st.soldiers.map((s) => ({ id: s.id, team: s.team, x: s.x, y: s.y, alive: s.alive })),
        enemies: enemies.map((s) => ({ id: s.id, x: s.x, y: s.y })),
        obstacles: st.obstacles, bites: st.bites || [], history: st.history || [],
        chat: (st.chat || []).slice(-10).map((c) => c.text),
      };
      let decision;
      try {
        decision = BRAIN === 'http' ? await askHttpBrain(payload) : heuristicBrain(st, soldier);
      } catch (e) {
        console.log(`⚠ cerebro falló (${e.message}), tiro heurístico de respaldo`);
        decision = heuristicBrain(st, soldier);
      }
      if (decision.say && !talked.has(decision.say)) {
        talked.add(decision.say);
        try { await api(`/api/rooms/${ROOM}/chat`, 'POST', { playerId: me.id, text: decision.say }); } catch {}
        await sleep(900); // que el rival lo lea antes del cañonazo
      }
      console.log(`🎯 [${decision.mode}] ${decision.expr}${decision.angle ? ` ángulo ${decision.angle}°` : ''}${decision.say ? ` 💬 "${decision.say}"` : ''}`);
      const r = await api(`/api/rooms/${ROOM}/fire`, 'POST', { playerId: me.id, mode: decision.mode, expr: decision.expr, angle: decision.angle || 0 });
      console.log('   →', JSON.stringify(r.result || r.error));
      await sleep(2500);
    } else await sleep(1000);
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
