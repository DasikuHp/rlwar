// Diagnóstico temporal: reproduce una partida de agentes dentro del mismo proceso.
process.env.GW_FAST = '1';
const { createRoom } = await import('../server/rooms.js');

const room = createRoom('debug');
room.addAgent('sniper', { level: 3, team: 'left' });
room.addAgent('greedy', { level: 3, team: 'right' });
console.log('inicio:', JSON.stringify(room.start(room.players[0].id)));

let last = '';
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const snap = room.snapshot();
  const line = `t=${(i * 0.5).toFixed(1)}s fase=${snap.phase} turno=${snap.turn ? snap.turn.playerId : 'null'} vivos=${snap.soldiers.filter((s) => s.alive).length} chat=${snap.chat.length}`;
  if (line !== last) console.log(line);
  last = line;
  if (snap.phase === 'over') break;
}
console.log('--- chat ---');
for (const c of room.snapshot().chat) console.log(' ', c.text);
