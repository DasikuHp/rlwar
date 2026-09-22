// Partidas sin pantalla (spec/01 §6): una sala en proceso, síncrona, sin temporizadores.
// playGame({seed, left, right, soldiers, maxTurns, hooks}) → {seed, result, events, trajectories, chat, room}
// `left`/`right`: 'sniper' | {type, level?, temperature?, name?, netId?}
import { Room } from './rooms.js';

export function playGame({ seed, left, right, soldiers = 2, maxTurns = 400, hooks = {} } = {}) {
  const room = new Room('sin pantalla', { soldiersPerPlayer: soldiers, seed, headless: true });
  const seat = (spec, team) => {
    const s = typeof spec === 'string' ? { type: spec } : (spec || {});
    const r = room.addAgent(s.type, { level: s.level ?? 3, temperature: s.temperature ?? 0, team, name: s.name ?? null, netId: s.netId ?? null, genome: s.genome ?? null, learn: !!s.learn });
    if (r.error) throw new Error(r.error);
  };
  seat(left, 'left');
  seat(right, 'right');
  const started = room.start();
  if (started.error) throw new Error(started.error);
  for (let i = 0; i < maxTurns && room.phase === 'playing'; i++) {
    room.step();
    if (hooks.onTurn) hooks.onTurn(room);
  }
  if (room.phase === 'playing') room.gameOver(true);
  return {
    seed: room.seed, result: room.result, events: room.events || [], trajectories: room.trajectories || {},
    chat: room.chat.slice(), room,
  };
}
