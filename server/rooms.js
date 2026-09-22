// Lógica de salas: jugadores, turnos, resolución de disparos, movimiento, fin de partida.
// F1 (spec/01): movimiento tras disparar (etapa `move`), semilla (`rng`) y modo sin pantalla (`headless`).
import { simulateShot } from '../shared/solver.js';
import { tryCompile } from '../shared/parser.js';
import { slideMove } from '../shared/geometry.js';
import { makeRng } from '../shared/rng.js';
import * as C from '../shared/constants.js';
import { genMap } from './mapgen.js';
import { createAgent, agentMeta, DEFAULT_AGENT } from '../agents/registry.js';
import { contextFor, moveOptions } from '../agents/lib.js';

const FAST = process.env.GW_FAST === '1';

let seq = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Room {
  constructor(name = 'Sala', { soldiersPerPlayer = C.SOLDIERS_PER_PLAYER, seed = null, headless = false } = {}) {
    this.code = randCode();
    this.name = String(name || 'Sala').slice(0, 40);
    // como el original (MAX_SOLDIERS_PER_PLAYER = 4): batallas de 2 a 4x4
    this.soldiersPerPlayer = Math.max(1, Math.min(4, Number(soldiersPerPlayer) || C.SOLDIERS_PER_PLAYER));
    this.headless = !!headless;   // sin temporizadores ni broadcast: la partida avanza con step()/play()
    this.rng = makeRng(seed);     // toda la aleatoriedad de la partida (mapa, orden, agentes, banter)
    this.seed = this.rng.seed;
    this.createdAt = Date.now();
    this.phase = 'lobby'; // lobby | playing | over
    this.players = [];    // {id, name, token, team, isBot, soldiers}
    this.soldiers = [];   // {id, ownerId, team, x, y, alive, lastExpr}
    this.obstacles = [];
    this.turn = null;     // {playerId, soldierId, stage: 'shoot'|'move', deadline, radius?}
    this.lastShot = null; // {playerId, expr, mode, result, ts} (los puntos van por el evento 'shot')
    this.lastMove = null; // {playerId, soldierId, from, to, requested, slid, stayed, reason, ts}
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
    this.agents = {};       // agente en proceso por jugador (se crean al empezar; guardan estado)
    this.pending = {};      // por jugador: {agent, choice} del turno en curso (para chooseMove)
    this.animEnd = 0;       // cuándo termina la animación del último disparo (ms)
  }

  broadcast(ev, data) {
    if (this.headless) return;
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
    let text = list[this.rng.int(list.length)];
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    this.say(player, soldier, text);
  }

  addPlayer(name, team = 'auto') {
    if (this.headless) return { error: 'Sala sin pantalla: solo agentes' };
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
    const map = genMap(n, this.rng);
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
    this.lastMove = null;
    this.agents = {};
    this.pending = {};
    for (const p of this.players) {
      if (p.isBot) this.agents[p.id] = createAgent(p.agentType, { level: p.level || 2, temperature: p.temperature || 0 });
    }
    // orden de turnos intercalando equipos
    const L = this.players.filter((p) => p.team === C.TEAMS.LEFT);
    const R = this.players.filter((p) => p.team === C.TEAMS.RIGHT);
    this.order = [];
    for (let i = 0; i < Math.max(L.length, R.length); i++) {
      if (L[i]) this.order.push(L[i]);
      if (R[i]) this.order.push(R[i]);
    }
    this.orderPos = this.rng.int(this.order.length); // empieza cualquiera
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
      this.turn = { playerId: p.id, soldierId: soldier.id, stage: 'shoot', deadline: Date.now() + C.TURN_TIME };
      this.broadcast('state', this.snapshot());
      if (this.headless) return; // sin pantalla: step() ejecuta el turno cuando toque
      this.timer = setTimeout(() => {
        if (this.turn && this.turn.playerId === p.id && this.turn.stage === 'shoot') {
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

  // Sin pantalla: ejecuta un turno completo (elegir → disparar → mover → siguiente) de forma síncrona
  step() {
    if (this.phase !== 'playing' || !this.turn) return null;
    const player = this.players.find((p) => p.id === this.turn.playerId);
    if (!player || !player.isBot) return null;
    this.agentTurn(player);
    return this.lastShot;
  }

  play({ maxTurns = 400 } = {}) {
    for (let i = 0; i < maxTurns && this.phase === 'playing'; i++) this.step();
    if (this.phase === 'playing') this.gameOver(true);
    return this.result;
  }

  moveOptionsFor(soldier) {
    return moveOptions(contextFor(this.soldiers, this.obstacles, soldier));
  }

  agentTurn(player) {
    if (this.phase !== 'playing' || !this.turn || this.turn.playerId !== player.id || this.turn.stage !== 'shoot') return;
    const soldier = this.soldiers.find((s) => s.id === this.turn.soldierId);
    if (!soldier) return;
    const agent = this.agents[player.id] || (this.agents[player.id] = createAgent(player.agentType, { level: player.level || 2, temperature: player.temperature || 0 }));
    let choice;
    try {
      choice = agent.chooseShot({
        soldiers: this.soldiers, obstacles: this.obstacles, soldier,
        history: this.history.slice(-12),
        chat: this.chat.slice(-12).map((c) => c.text), // lo que dijo el rival: le llega de verdad
        temperature: player.temperature || 0,
        rng: this.rng,
        moveOptions: this.moveOptionsFor(soldier),
        state: this.snapshot(),
      });
    } catch (e) {
      this.log(`⚠️ ${player.name} falló al calcular (${e.message})`);
    }
    this.pending[player.id] = { agent, choice };
    if (choice && choice.reason) this.say(player, soldier, `💭 ${choice.reason}`, 'think');
    // habla primero y dispara después: da tiempo a leer el bocadillo
    const doFire = () => {
      if (this.phase !== 'playing' || !this.turn || this.turn.playerId !== player.id) return;
      this.fire(player.id, choice || { mode: C.MODES.FUNCTION, expr: '0.1*x' });
    };
    if (choice && choice.say) {
      this.say(player, soldier, choice.say);
      if (this.headless) return doFire();
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(doFire, FAST ? 400 : 1300);
    } else doFire();
  }

  fire(playerId, { mode = C.MODES.FUNCTION, expr = '', angle = 0, move = undefined } = {}) {
    if (this.phase !== 'playing') return { error: 'La partida no está en curso' };
    if (!this.turn || this.turn.playerId !== playerId) return { error: 'No es tu turno' };
    if (this.turn.stage === 'move') return { error: 'Ya disparaste: elige destino o espera' };
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
    clearTimeout(this.timer);
    this.history.push(String(expr));
    if (this.history.length > 40) this.history.shift();
    this.shots++;
    if (shot.result.type === 'kill' || shot.result.type === 'suicide') this.shotsNoKill = 0; else this.shotsNoKill++;
    this.broadcast('shot', { shot: { ...this.lastShot, points: shot.points, shooterTeam: soldier.team } });

    const animMs = Math.min(9000, Math.max(700, (shot.points.length * C.NETWORK_STEP / C.SHOT_SPEED) * 1000));
    this.animEnd = Date.now() + (this.headless ? 0 : animMs);

    // ---- movimiento tras disparar (spec/01 §2) ----
    if (move !== undefined) {
      // pre-decidido en el mismo cuerpo (agente por API o humano que ya eligió)
      this.turn = { ...this.turn, stage: 'move', radius: C.MOVE_RADIUS };
      const m = this.move(playerId, move);
      return { ok: true, result: shot.result, move: m.move };
    }
    if (shooter.isBot) {
      // agente en proceso: chooseMove ahora mismo (ve el resultado), o el move de chooseShot, o quieto
      this.turn = { ...this.turn, stage: 'move', radius: C.MOVE_RADIUS };
      const pend = this.pending[playerId] || {};
      let requested = 'stay';
      try {
        if (pend.agent && typeof pend.agent.chooseMove === 'function' && soldier.alive) {
          requested = pend.agent.chooseMove({
            soldiers: this.soldiers, obstacles: this.obstacles, soldier,
            shot: { ...this.lastShot, points: shot.points }, moveOptions: this.moveOptionsFor(soldier),
            history: this.history.slice(-12), rng: this.rng, state: this.snapshot(),
          });
        } else if (pend.choice && pend.choice.move !== undefined) requested = pend.choice.move;
      } catch (e) {
        this.log(`⚠️ ${shooter.name} falló al moverse (${e.message})`);
        requested = 'stay';
      }
      const m = this.move(playerId, requested == null ? 'stay' : requested);
      return { ok: true, result: shot.result, move: m.move };
    }
    // humano o agente externo: ventana para elegir destino (spec/01 §2.2)
    this.turn = { playerId, soldierId: soldier.id, stage: 'move', deadline: this.animEnd + C.MOVE_TIME, radius: C.MOVE_RADIUS };
    this.broadcast('state', this.snapshot());
    this.timer = setTimeout(() => {
      if (this.phase === 'playing' && this.turn && this.turn.playerId === playerId && this.turn.stage === 'move') {
        this.move(playerId, null, { timeout: true });
      }
    }, animMs + C.MOVE_TIME + 50);
    return { ok: true, result: shot.result };
  }

  // Único validador del movimiento (spec/01 §4). `requested` = {x,y} | 'stay' | null.
  move(playerId, requested, { timeout = false } = {}) {
    if (this.phase !== 'playing') return { error: 'La partida no está en curso' };
    if (!this.turn || this.turn.playerId !== playerId) return { error: 'No es tu turno' };
    if (this.turn.stage !== 'move') return { error: 'Primero dispara; después eliges destino' };
    const soldier = this.soldiers.find((s) => s.id === this.turn.soldierId);
    const player = this.players.find((p) => p.id === playerId);
    if (!soldier || !player) return { error: 'Soldado o jugador inválido' };
    if (!soldier.alive) return { error: 'Ese soldado ya está muerto' };
    const from = { x: soldier.x, y: soldier.y };
    const r = slideMove({ from, requested, soldiers: this.soldiers, obstacles: this.obstacles, selfId: soldier.id });
    soldier.x = r.to.x;
    soldier.y = r.to.y;
    const asked = requested && typeof requested === 'object' && Number.isFinite(requested.x) && Number.isFinite(requested.y) && r.reason !== 'invalid'
      ? { x: requested.x, y: requested.y } : null;
    this.lastMove = {
      playerId, soldierId: soldier.id, from, to: { x: r.to.x, y: r.to.y }, requested: asked,
      slid: r.slid, stayed: r.stayed, reason: timeout ? 'timeout' : r.reason, ts: Date.now(),
    };
    if (r.stayed) this.log(`🦶 ${player.name} se queda quieto${timeout ? ' (se acabó el tiempo)' : ''}`);
    else this.log(`${r.slid ? '↪️' : '🦶'} ${player.name} se mueve a (${r.to.x.toFixed(1)}, ${r.to.y.toFixed(1)})${r.slid ? ' (deslizado)' : ''}`);
    this.finishTurn();
    return { ok: true, move: this.lastMove };
  }

  // Cierra el turno tras el movimiento: evento `move`, y el siguiente turno cuando acabe la animación
  finishTurn() {
    clearTimeout(this.timer);
    this.turn = null;
    this.broadcast('move', { move: this.lastMove });
    if (this.headless) return this.afterShot();
    const animLeft = Math.max(0, this.animEnd - Date.now());
    clearTimeout(this.afterTimer);
    this.afterTimer = setTimeout(() => this.afterShot(), animLeft + C.NEXT_TURN_DELAY);
  }

  afterShot() {
    if (this.phase !== 'playing') return;
    this.turn = null;
    // anti-estancamiento: nadie muere en muchos disparos → renovar mapa o terminar por empate técnico
    if (this.shots >= C.MAX_SHOTS) {
      this.log('⏳ Límite de disparos alcanzado');
      return this.gameOver(true);
    }
    if (this.shotsNoKill >= C.STALL_SHOTS) {
      this.shotsNoKill = 0;
      this.remaps++;
      const map = genMap(this.soldiersPerPlayer, this.rng);
      this.log(`🔄 Nadie muere desde hace ${C.STALL_SHOTS} disparos: mapa renovado (${this.remaps})`);
      this.log(`🗺️ Mapa: ${map.name}`);
      this.reposition(map);
    }
    this.nextTurn();
  }

  // Renueva obstáculos y recoloca a los soldados vivos (los muertos permanecen)
  reposition(pre = null) {
    const map = pre || genMap(this.soldiersPerPlayer, this.rng);
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
    // semilla nueva derivada del rng de la sala: una serie de revanchas también es reproducible
    this.rng = makeRng(this.rng.int(2 ** 31));
    this.seed = this.rng.seed;
    for (const s of this.soldiers) s.alive = true;
    for (const p of this.players) { p.kills = 0; p.deaths = 0; }
    this.phase = 'lobby';
    this.lastShot = null;
    this.lastMove = null;
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
      turn: this.turn, lastShot: this.lastShot, lastMove: this.lastMove, result: this.result || null,
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
      config: {
        turnTime: C.TURN_TIME, plane: { xMin: -25, xMax: 25, yMin: -15, yMax: 15 },
        seed: this.seed, moveRadius: C.MOVE_RADIUS, moveTime: C.MOVE_TIME, body: C.BODY, minSeparation: C.MIN_SEPARATION,
      },
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
