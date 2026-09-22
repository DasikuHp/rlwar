// Lógica de salas: jugadores, turnos, resolución de disparos, fin de partida.
import { simulateShot } from '../shared/solver.js';
import { tryCompile } from '../shared/parser.js';
import * as C from '../shared/constants.js';
import { genMap } from './mapgen.js';
import { createAgent, agentMeta, DEFAULT_AGENT } from '../agents/registry.js';

const FAST = process.env.GW_FAST === '1';

let seq = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Room {
  constructor(name = 'Sala', { soldiersPerPlayer = C.SOLDIERS_PER_PLAYER } = {}) {
    this.code = randCode();
    this.name = String(name || 'Sala').slice(0, 40);
    // como el original (MAX_SOLDIERS_PER_PLAYER = 4): batallas de 2 a 4x4
    this.soldiersPerPlayer = Math.max(1, Math.min(4, Number(soldiersPerPlayer) || C.SOLDIERS_PER_PLAYER));
    this.createdAt = Date.now();
    this.phase = 'lobby'; // lobby | playing | over
    this.players = [];    // {id, name, token, team, isBot, soldiers}
    this.soldiers = [];   // {id, ownerId, team, x, y, alive, lastExpr}
    this.obstacles = [];
    this.turn = null;     // {playerId, soldierId, deadline}
    this.lastShot = null; // {playerId, expr, mode, result, ts} (los puntos van por el evento 'shot')
    this.chat = [];
    this.winner = null;
    this.listeners = new Set();
    this.timer = null;
    this.afterTimer = null;
    this.order = [];
    this.orderPos = 0;
    this.cursor = {};
    this.history = [];      // expresiones ya disparadas (memoria para los agentes)
    this.shots = 0;         // disparos totales de la partida
    this.shotsNoKill = 0;   // disparos seguidos sin bajas
    this.remaps = 0;        // veces que se renovó el mapa por estancamiento
  }

  broadcast(ev, data) {
    for (const res of this.listeners) {
      try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignorar */ }
    }
  }

  log(text, extra = {}) {
    this.chat.push({ t: Date.now(), text, ...extra });
    if (this.chat.length > 120) this.chat.shift();
    this.broadcast('chat', { chat: this.chat });
  }

  // Un jugador HABLA desde su soldado: sale en bocadillo sobre él (kind 'say')
  // o como pensamiento táctico solo en el registro (kind 'think').
  say(player, soldier, text, kind = 'say') {
    this.log(`${player.name}: ${String(text).slice(0, 140)}`, {
      playerId: player.id, soldierId: soldier?.id || null, kind,
    });
  }

  banter(player, soldier, list, vars = {}) {
    if (!list || !list.length || !soldier) return;
    let text = list[Math.floor(Math.random() * list.length)];
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    this.say(player, soldier, text);
  }

  addPlayer(name, team = 'auto') {
    if (this.phase !== 'lobby') return { error: 'La partida ya empezó' };
    if (this.players.length >= C.MAX_PLAYERS) return { error: 'Sala llena' };
    const counts = { [C.TEAMS.LEFT]: 0, [C.TEAMS.RIGHT]: 0 };
    for (const p of this.players) counts[p.team]++;
    if (team !== C.TEAMS.LEFT && team !== C.TEAMS.RIGHT) {
      team = counts[C.TEAMS.LEFT] <= counts[C.TEAMS.RIGHT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
    }
    if (counts[team] >= Math.ceil(C.MAX_PLAYERS / 2)) return { error: 'Ese equipo está lleno' };
    const player = {
      id: 'p' + seq++, name: String(name || 'Jugador').slice(0, 24),
      token: 't' + seq + '-' + Math.random().toString(36).slice(2, 10),
      team, isBot: false, joinedAt: Date.now(),
    };
    this.players.push(player);
    this.broadcast('state', this.snapshot());
    return { player: { id: player.id, name: player.name, team: player.team }, token: player.token };
  }

  addBot(level = 2, type = DEFAULT_AGENT) {
    return this.addAgent(type, { level });
  }

  addAgent(type = DEFAULT_AGENT, { level = 2, team = 'auto', name = null, temperature = 0 } = {}) {
    if (this.phase !== 'lobby') return { error: 'La partida ya empezó' };
    if (this.players.length >= C.MAX_PLAYERS) return { error: 'Sala llena' };
    const counts = { [C.TEAMS.LEFT]: 0, [C.TEAMS.RIGHT]: 0 };
    for (const p of this.players) counts[p.team]++;
    if (team !== C.TEAMS.LEFT && team !== C.TEAMS.RIGHT) {
      team = counts[C.TEAMS.LEFT] <= counts[C.TEAMS.RIGHT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
    }
    if (counts[team] >= Math.ceil(C.MAX_PLAYERS / 2)) return { error: 'Ese equipo está lleno' };
    const meta = agentMeta(type);
    const sameType = this.players.filter((p) => p.agentType === meta.id).length;
    const player = {
      id: 'p' + seq++, name: (name || `${meta.icon} ${meta.name}`).slice(0, 24) + (sameType ? ` ${sameType + 1}` : ''),
      token: null, team, isBot: true, agentType: meta.id,
      level: Math.max(1, Math.min(3, level | 0)), soldiers: [],
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0)),
    };
    this.players.push(player);
    this.broadcast('state', this.snapshot());
    return { ok: true, player: { id: player.id, name: player.name, team: player.team, agentType: player.agentType } };
  }

  start(playerId) {
    if (this.phase !== 'lobby') return { error: 'Ya started' };
    if (playerId && !this.players.some((p) => p.id === playerId)) return { error: 'Solo un jugador de la sala puede empezar' };
    const teams = new Set(this.players.map((p) => p.team));
    if (this.players.length < 2 || teams.size < 2) return { error: 'Se necesita al menos un jugador en cada equipo (puedes añadir un CPU)' };
    const n = this.soldiersPerPlayer;
    const map = genMap(n);
    this.obstacles = map.obstacles;
    this.soldiers = [];
    for (const p of this.players) {
      const spots = map.placeSide(p.team, n);
      p.soldiers = [];
      for (const s of spots) {
        const soldier = { id: 's' + seq++, ownerId: p.id, team: p.team, x: s.x, y: s.y, alive: true, lastExpr: '' };
        this.soldiers.push(soldier);
        p.soldiers.push(soldier);
      }
    }
    this.phase = 'playing';
    this.winner = null;
    this.lastShot = null;
    // orden de turnos intercalando equipos
    const L = this.players.filter((p) => p.team === C.TEAMS.LEFT);
    const R = this.players.filter((p) => p.team === C.TEAMS.RIGHT);
    this.order = [];
    for (let i = 0; i < Math.max(L.length, R.length); i++) {
      if (L[i]) this.order.push(L[i]);
      if (R[i]) this.order.push(R[i]);
    }
    this.orderPos = Math.floor(Math.random() * this.order.length); // empieza cualquiera
    this.cursor = {};
    this.history = [];
    this.shots = 0;
    this.shotsNoKill = 0;
    this.remaps = 0;
    this.result = null;
    this.log('🎮 ¡Comienza la partida!');
    this.log(`🗺️ Mapa: ${map.name} (${this.soldiersPerPlayer} por jugador)`);
    // cada bot se presenta desde su primer soldado (sale en bocadillo)
    for (const p of this.players) {
      if (p.isBot && p.soldiers && p.soldiers.length) {
        this.banter(p, p.soldiers[0], agentMeta(p.agentType).banter?.intro);
      }
    }
    this.nextTurn();
    return { ok: true };
  }

  nextTurn() {
    clearTimeout(this.timer);
    if (this.phase !== 'playing') return;
    const alive = { [C.TEAMS.LEFT]: 0, [C.TEAMS.RIGHT]: 0 };
    for (const s of this.soldiers) if (s.alive) alive[s.team]++;
    if (!alive[C.TEAMS.LEFT] || !alive[C.TEAMS.RIGHT]) return this.gameOver();

    for (let tries = 0; tries < 300; tries++) {
      const p = this.order[this.orderPos % this.order.length];
      this.orderPos++;
      const soldiersAlive = (p.soldiers || []).filter((s) => s.alive);
      if (!soldiersAlive.length) continue;
      this.cursor[p.id] = (this.cursor[p.id] || 0) + 1;
      const soldier = soldiersAlive[(this.cursor[p.id] - 1) % soldiersAlive.length];
      this.turn = { playerId: p.id, soldierId: soldier.id, deadline: Date.now() + C.TURN_TIME };
      this.broadcast('state', this.snapshot());
      this.timer = setTimeout(() => {
        if (this.turn && this.turn.playerId === p.id) {
          this.log(`⏰ ${p.name} no disparó a tiempo`);
          this.turn = null;
          this.nextTurn();
        }
      }, C.TURN_TIME + 500);
      if (p.isBot) setTimeout(() => this.agentTurn(p), FAST ? 150 : 1000 + Math.random() * 1200);
      return;
    }
    this.gameOver();
  }

  agentTurn(player) {
    if (this.phase !== 'playing' || !this.turn || this.turn.playerId !== player.id) return;
    const soldier = this.soldiers.find((s) => s.id === this.turn.soldierId);
    if (!soldier) return;
    let choice;
    try {
      const agent = createAgent(player.agentType, { level: player.level || 2, temperature: player.temperature || 0 });
      choice = agent.chooseShot({
        soldiers: this.soldiers, obstacles: this.obstacles, soldier,
        history: this.history.slice(-12),
        chat: this.chat.slice(-12).map((c) => c.text), // lo que dijo el rival: le llega de verdad
        temperature: player.temperature || 0,
        state: this.snapshot(),
      });
    } catch (e) {
      this.log(`⚠️ ${player.name} falló al calcular (${e.message})`);
    }
    if (choice && choice.reason) this.say(player, soldier, `💭 ${choice.reason}`, 'think');
    // habla primero y dispara después: da tiempo a leer el bocadillo
    const doFire = () => {
      if (this.phase !== 'playing' || !this.turn || this.turn.playerId !== player.id) return;
      this.fire(player.id, choice || { mode: C.MODES.FUNCTION, expr: '0.1*x' });
    };
    if (choice && choice.say) {
      this.say(player, soldier, choice.say);
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(doFire, FAST ? 400 : 1300);
    } else doFire();
  }

  fire(playerId, { mode = C.MODES.FUNCTION, expr = '', angle = 0 } = {}) {
    if (this.phase !== 'playing') return { error: 'La partida no está en curso' };
    if (!this.turn || this.turn.playerId !== playerId) return { error: 'No es tu turno' };
    const soldier = this.soldiers.find((s) => s.id === this.turn.soldierId);
    const shooter = this.players.find((p) => p.id === playerId);
    if (!soldier || !shooter) return { error: 'Soldado o jugador inválido' };
    if (!soldier.alive) return { error: 'Ese soldado ya está muerto' };
    if (!Object.values(C.MODES).includes(mode)) return { error: 'Modo inválido' };
    const r = tryCompile(String(expr));
    if (!r.ok) return { error: `Función inválida: ${r.error}` };
    angle = Number(angle) || 0;
    if (mode === C.MODES.ODE2 && (angle < -85 || angle > 85)) return { error: 'Ángulo fuera de rango (-85..85)' };

    const dir = soldier.team === C.TEAMS.LEFT ? 1 : -1;
    const shot = simulateShot({
      mode, f: r.f, start: { x: soldier.x, y: soldier.y }, dir, angle,
      soldiers: this.soldiers, obstacles: this.obstacles, shooterId: soldier.id,
    });

    soldier.lastExpr = `${C.MODE_LABELS[mode]} ${String(expr).slice(0, 80)}`;
    let message;
    if (shot.result.type === 'kill') {
      const victim = this.soldiers.find((s) => s.id === shot.result.soldierId);
      const victimOwner = this.players.find((p) => p.id === victim.ownerId);
      victim.alive = false;
      shooter.kills = (shooter.kills || 0) + 1;
      if (victimOwner) victimOwner.deaths = (victimOwner.deaths || 0) + 1;
      message = `💥 ${shooter.name} eliminó a ${victimOwner?.name ?? '?'} con ${soldier.lastExpr}`;
      if (shooter.isBot) this.banter(shooter, soldier, agentMeta(shooter.agentType).banter?.kill, { victim: victimOwner?.name ?? 'rival' });
    } else if (shot.result.type === 'suicide') {
      soldier.alive = false;
      message = `💀 ${shooter.name} eliminó a su propio aliado con ${soldier.lastExpr}`;
    } else if (shot.result.type === 'wall') {
      message = `🧱 ${shooter.name} (${soldier.lastExpr}) se estrelló contra el borde`;
    } else if (shot.result.type === 'obstacle') {
      message = `🪨 ${shooter.name} (${soldier.lastExpr}) chocó con un obstáculo`;
    } else if (shot.result.type === 'invalid') {
      message = `❌ La función de ${shooter.name} explotó: ${soldier.lastExpr}`;
    } else if (shot.result.type === 'steep') {
      message = `📐 La función de ${shooter.name} se puso vertical y explotó`;
    } else {
      message = `💤 ${shooter.name} (${soldier.lastExpr}) se quedó sin recorrido`;
    }
    this.log(message);

    this.lastShot = { playerId, soldierId: soldier.id, expr: String(expr).slice(0, 200), mode, result: shot.result, ts: Date.now() };
    this.turn = null;
    clearTimeout(this.timer);
    this.history.push(String(expr));
    if (this.history.length > 40) this.history.shift();
    this.shots++;
    if (shot.result.type === 'kill' || shot.result.type === 'suicide') this.shotsNoKill = 0; else this.shotsNoKill++;
    this.broadcast('shot', { shot: { ...this.lastShot, points: shot.points, shooterTeam: soldier.team } });

    const animMs = Math.min(9000, Math.max(700, (shot.points.length * C.NETWORK_STEP / C.SHOT_SPEED) * 1000));
    this.afterTimer = setTimeout(() => {
      this.turn = null;
      // anti-estancamiento: nadie muere en muchos disparos → renovar mapa o terminar por empate técnico
      if (this.shots >= C.MAX_SHOTS) {
        this.log('⏳ Límite de disparos alcanzado');
        return this.gameOver(true);
      }
      if (this.shotsNoKill >= C.STALL_SHOTS) {
        this.shotsNoKill = 0;
        this.remaps++;
        const map = genMap(this.soldiersPerPlayer);
        this.log(`🔄 Nadie muere desde hace ${C.STALL_SHOTS} disparos: mapa renovado (${this.remaps})`);
        this.log(`🗺️ Mapa: ${map.name}`);
        this.reposition(map);
      }
      this.nextTurn();
    }, animMs + C.NEXT_TURN_DELAY);
    return { ok: true, result: shot.result };
  }

  // Renueva obstáculos y recoloca a los soldados vivos (los muertos permanecen)
  reposition(pre = null) {
    const map = pre || genMap(this.soldiersPerPlayer);
    this.obstacles = map.obstacles;
    for (const p of this.players) {
      const alive = (p.soldiers || []).filter((s) => s.alive);
      if (!alive.length) continue;
      const spots = map.placeSide(p.team, alive.length);
      alive.forEach((s, i) => { s.x = spots[i].x; s.y = spots[i].y; });
    }
    this.history = [];
    this.broadcast('state', this.snapshot());
  }

  gameOver(byLimit = false) {
    clearTimeout(this.timer);
    clearTimeout(this.afterTimer);
    clearTimeout(this.sayTimer);
    this.turn = null;
    this.phase = 'over';
    const alive = { [C.TEAMS.LEFT]: 0, [C.TEAMS.RIGHT]: 0 };
    for (const s of this.soldiers) if (s.alive) alive[s.team]++;
    const kills = { [C.TEAMS.LEFT]: 0, [C.TEAMS.RIGHT]: 0 };
    for (const p of this.players) kills[p.team] += p.kills || 0;

    if (!alive[C.TEAMS.LEFT] || !alive[C.TEAMS.RIGHT]) {
      this.winner = alive[C.TEAMS.LEFT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
    } else if (byLimit) {
      // empate técnico: deciden bajas, luego supervivientes
      if (kills[C.TEAMS.LEFT] !== kills[C.TEAMS.RIGHT]) {
        this.winner = kills[C.TEAMS.LEFT] > kills[C.TEAMS.RIGHT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
      } else if (alive[C.TEAMS.LEFT] !== alive[C.TEAMS.RIGHT]) {
        this.winner = alive[C.TEAMS.LEFT] > alive[C.TEAMS.RIGHT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
      } else {
        this.winner = null; // empate
      }
    } else {
      this.winner = alive[C.TEAMS.LEFT] ? C.TEAMS.LEFT : C.TEAMS.RIGHT;
    }

    this.result = {
      winner: this.winner, shots: this.shots, remaps: this.remaps, byLimit,
      killsLeft: kills[C.TEAMS.LEFT], killsRight: kills[C.TEAMS.RIGHT],
      aliveLeft: alive[C.TEAMS.LEFT], aliveRight: alive[C.TEAMS.RIGHT],
    };
    this.log(this.winner
      ? `🏆 ¡Victoria del equipo ${this.winner === C.TEAMS.LEFT ? 'IZQUIERDO' : 'DERECHO'}!`
      : '🤝 Empate técnico');
    this.broadcast('gameover', { winner: this.winner, result: this.result });
    this.broadcast('state', this.snapshot());
  }

  rematch() {
    if (this.phase !== 'over') return { error: 'La partida no ha terminado' };
    for (const s of this.soldiers) s.alive = true;
    for (const p of this.players) { p.kills = 0; p.deaths = 0; }
    this.phase = 'lobby';
    this.lastShot = null;
    this.history = [];
    this.shots = 0;
    this.shotsNoKill = 0;
    this.remaps = 0;
    this.result = null;
    this.start(this.players[0]?.id);
    return { ok: true };
  }

  addChat(playerId, text) {
    const p = this.players.find((q) => q.id === playerId);
    this.log(`${p ? p.name : '?'}: ${String(text).slice(0, 200)}`);
    return { ok: true };
  }

  snapshot() {
    return {
      code: this.code, name: this.name, phase: this.phase, winner: this.winner,
      turn: this.turn, lastShot: this.lastShot, result: this.result || null,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, team: p.team, isBot: p.isBot,
        agentType: p.agentType || null, level: p.level || null, temperature: p.temperature ?? null,
        kills: p.kills || 0, deaths: p.deaths || 0,
        alive: p.soldiers ? p.soldiers.filter((s) => s.alive).length : C.SOLDIERS_PER_PLAYER,
      })),
      soldiers: this.soldiers.map((s) => ({ id: s.id, ownerId: s.ownerId, team: s.team, x: s.x, y: s.y, alive: s.alive, lastExpr: s.lastExpr })),
      obstacles: this.obstacles,
      chat: this.chat.slice(-40),
      history: this.history.slice(-12),
      config: { turnTime: C.TURN_TIME, plane: { xMin: -25, xMax: 25, yMin: -15, yMax: 15 } },
    };
  }
}

export const rooms = new Map();

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

export function createRoom(name, opts = {}) {
  const room = new Room(name, opts);
  rooms.set(room.code, room);
  return room;
}

// limpieza de salas antiguas solo con bots
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.length && room.players.every((p) => p.isBot) && now - room.createdAt > 30 * 60 * 1000) rooms.delete(code);
  }
}, 60 * 1000).unref();
