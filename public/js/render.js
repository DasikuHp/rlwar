// Render del tablero: tema neón, trayectorias con glow, partículas y shake.
// Sesión 8 (lo visto en la prueba de P5): las curvas se trazan a la velocidad de la sala (x10 también) y se quedan toda
// la partida, cada vez más tenues; los nombres van en etiqueta como en el original; y los bocadillos salen de
// ui/bubbles.js: primero la función del tiro y luego lo que dice la red, uno por soldado y sin pisarse.
import { createBubbles, expectShot, pushFn, landed, pushSay, tick, place, wrap } from './ui/bubbles.js';

export const R = {
  canvas: null, ctx: null, dpr: 1,
  state: null, myId: null,
  shots: [],       // trayectorias de esta partida {points, team, ts}, la más nueva al final
  current: null,   // disparo animándose
  particles: [],
  shake: 0,
  bq: createBubbles(), placed: new Map(), // cola de bocadillos y dónde se pintó cada uno la última vez
  think: null,     // lo que piensa una red (live.js overlay) + {team, until}: curvas imaginadas o destinos
  onLanded: null,  // (shot) => … cuando la curva llega a su final
  fx: { quality: 'alta', reduce: false },
  _cw: -1, _ch: -1,
  stars: Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + .3, a: Math.random() * .7 + .2 })),
};

export const TEAM_COLOR = { left: '#4fd1ff', right: '#ff9f43' };
const SHOT_SPEED = 55; // u/s a x1, como shared/constants.js (el servidor espera lo mismo antes del siguiente turno)
const MAX_TRAILS = 24;
const MODE_LABEL = { function: 'y =', ode1: "y' =", ode2: "y'' =" };
const SANS = "Bahnschrift, 'Segoe UI', sans-serif", MONO = "'Cascadia Mono', Consolas, monospace";
const speedOf = () => (R.state && R.state.config && R.state.config.speed) || 1;
const lowFx = () => R.fx.quality === 'baja' || R.fx.reduce;

// Ajustes: calidad Baja quita brillos y chispas; "reducir movimiento" quita también la sacudida (las curvas se trazan igual)
export function setFx(fx) { R.fx = { ...R.fx, ...fx }; }

export function initRender(canvas) {
  R.canvas = canvas; R.ctx = canvas.getContext('2d');
  R.canvas.width = 0; R.canvas.height = 0; R._cw = -1; R._ch = -1; // forzar (re)encaje
  const fit = () => {
    R.dpr = window.devicePixelRatio || 1;
    // clientWidth es 0 mientras #game está oculto (display:none): reintentar luego
    const w = R.canvas.clientWidth, h = R.canvas.clientHeight;
    if (!w || !h) return false;
    R.canvas.width = Math.round(w * R.dpr);
    R.canvas.height = Math.round(h * R.dpr);
    R._cw = w; R._ch = h;
    return true;
  };
  R.refit = fit;
  window.addEventListener('resize', fit); fit();
  requestAnimationFrame(frame);
}

// sala nueva (otra partida del duelo): se borra todo lo pintado
export function resetRoom() {
  R.state = null; R.shots = []; R.current = null; R.think = null; R.particles = [];
  R.bq = createBubbles(); R.placed = new Map();
}

// clave de la capa del terreno: el tamaño del lienzo y cada obstáculo y cada bocado (dos partidas de la misma semilla con
// el mismo número de bocados en sitios distintos no pueden compartirla)
export const terrainKey = (obstacles, bites, W, H) =>
  `${W}x${H}|${obstacles.map((o) => (o.kind === 'circle' ? `c${o.x},${o.y},${o.r}` : `r${o.x},${o.y},${o.w},${o.h}`)).join(';')}|${bites.map((b) => `${b.x},${b.y},${b.r}`).join(';')}`;

// terreno (spec/01 §10): círculos y rectángulos, con los bocados recortados en una capa aparte (así la cuadrícula se ve
// a través de los agujeros); la capa se rehace solo cuando cambian el terreno o el tamaño
function drawTerrain(obstacles, bites, s) {
  const W = R.canvas.width, H = R.canvas.height;
  const key = terrainKey(obstacles, bites, W, H);
  if (!R.terrain || R.terrainKey !== key) {
    const layer = R.terrain || document.createElement('canvas');
    layer.width = W; layer.height = H;
    const c = layer.getContext('2d');
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1c2647'; c.strokeStyle = '#43538a'; c.lineWidth = R.dpr;
    for (const o of obstacles) {
      c.beginPath();
      if (o.kind === 'circle') { const [cx, cy] = w2s(o.x, o.y); c.arc(cx, cy, o.r * s, 0, Math.PI * 2); }
      else { const [ox, oy] = w2s(o.x, o.y + o.h); if (c.roundRect) c.roundRect(ox, oy, o.w * s, o.h * s, 4 * R.dpr); else c.rect(ox, oy, o.w * s, o.h * s); }
      c.fill(); c.stroke();
    }
    c.globalCompositeOperation = 'destination-out';
    for (const b of bites) { const [bx, by] = w2s(b.x, b.y); c.beginPath(); c.arc(bx, by, b.r * s, 0, Math.PI * 2); c.fill(); }
    c.globalCompositeOperation = 'source-over';
    R.terrain = layer; R.terrainKey = key;
  }
  R.ctx.drawImage(R.terrain, 0, 0);
}

export const w2s = (x, y) => {
  const W = R.canvas.width, H = R.canvas.height;
  const s = Math.min(W / 52, H / 32);
  return [W / 2 + x * s, H / 2 - y * s, s];
};

// la función tal como la escribiría una persona en el original: "y = …", "y' = …" o "y'' = … · 35°"
export const fnText = (shot) => `${MODE_LABEL[shot.mode] || 'y ='} ${shot.expr}${shot.mode === 'ode2' && Number.isFinite(shot.angle) ? ` · ${Math.round(shot.angle)}°` : ''}`;

// una red ha decidido su tiro: lo que diga ahora espera a que salga su función
export const expect = (soldierId) => expectShot(R.bq, soldierId, Date.now(), speedOf());
export const say = ({ soldierId, text, level = null }) => {
  const sol = R.state && R.state.soldiers.find((s) => s.id === soldierId);
  pushSay(R.bq, { soldierId, text, level, team: sol ? sol.team : null }, Date.now());
};

export function startShot(shot) {
  if (R.current) shotFinished(R.current); // llega otro tiro antes de acabar de trazar este: se completa de golpe
  R.current = { ...shot, t0: performance.now() };
  pushFn(R.bq, { soldierId: shot.soldierId, text: fnText(shot), team: shot.shooterTeam }, Date.now());
}

export function shotFinished(shot) {
  R.shots.push({ points: shot.points, team: shot.shooterTeam, ts: Date.now() });
  if (R.shots.length > MAX_TRAILS) R.shots.shift();
  R.current = null;
  if (R.think && R.think.kind === 'shoot') R.think = null; // la elegida ya se ha trazado
  landed(R.bq, shot.soldierId, Date.now(), speedOf());
  const end = shot.points[shot.points.length - 1];
  const big = shot.result.type === 'kill' || shot.result.type === 'suicide';
  if (!R.fx.reduce) burst(end[0], end[1], (big ? 60 : 26) / (R.fx.quality === 'baja' ? 3 : R.fx.quality === 'media' ? 1.6 : 1), shot.shooterTeam);
  if (!lowFx()) R.shake = shot.result.type === 'kill' ? 16 : 8;
  if (R.onLanded) { try { R.onLanded(shot); } catch { /* la vista ya no está */ } }
}

function burst(x, y, n, team) {
  const color = TEAM_COLOR[team];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * 4 + .5;
    R.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: Math.random() < .5 ? color : '#ffffff' });
  }
}

function frame() {
  const { ctx } = R;
  if (!ctx) { requestAnimationFrame(frame); return; }
  // reencajar si cambió el tamaño (incluido pasar de oculto 0x0 a visible)
  if (R.refit && (R.canvas.clientWidth !== R._cw || R.canvas.clientHeight !== R._ch)) R.refit();
  if (!R.canvas.width || !R.canvas.height) { requestAnimationFrame(frame); return; }
  const W = R.canvas.width, H = R.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const g = ctx.createRadialGradient(W * .3, H * .1, 50, W / 2, H / 2, Math.max(W, H) * .8);
  g.addColorStop(0, '#101a33'); g.addColorStop(1, '#080b14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (R.fx.quality !== 'baja') for (const s of R.stars) {
    ctx.globalAlpha = s.a; ctx.fillStyle = '#cfe4ff';
    ctx.fillRect(s.x * W, s.y * H, s.r * R.dpr, s.r * R.dpr);
  }
  ctx.globalAlpha = 1;

  if (R.shake > 0) {
    ctx.translate((Math.random() - .5) * R.shake, (Math.random() - .5) * R.shake);
    R.shake *= .9; if (R.shake < .4) R.shake = 0;
  }

  if (R.state) drawWorld();

  for (let i = R.particles.length - 1; i >= 0; i--) {
    const p = R.particles[i];
    p.x += p.vx * .016; p.y += p.vy * .016; p.vy -= .04; p.life -= .025;
    if (p.life <= 0) { R.particles.splice(i, 1); continue; }
    const [sx, sy] = w2s(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx, sy, 2.4 * R.dpr, 2.4 * R.dpr);
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}

function drawWorld() {
  const { ctx } = R;
  const st = R.state, P = st.config.plane;
  const [x0, y0] = w2s(P.xMin, P.yMax);
  const [x1, y1, s] = w2s(P.xMax, P.yMin);

  ctx.strokeStyle = '#2a3860'; ctx.lineWidth = R.dpr;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

  ctx.strokeStyle = '#141d33'; ctx.beginPath();
  for (let x = Math.ceil(P.xMin / 5) * 5; x <= P.xMax; x += 5) { const [a] = w2s(x, 0); ctx.moveTo(a, y0); ctx.lineTo(a, y1); }
  for (let y = Math.ceil(P.yMin / 5) * 5; y <= P.yMax; y += 5) { const [, b] = w2s(0, y); ctx.moveTo(x0, b); ctx.lineTo(x1, b); }
  ctx.stroke();
  const [ax, ay] = w2s(0, 0);
  ctx.strokeStyle = '#3a4a7a'; ctx.beginPath();
  ctx.moveTo(ax, y0); ctx.lineTo(ax, y1); ctx.moveTo(x0, ay); ctx.lineTo(x1, ay); ctx.stroke();

  drawTerrain(st.obstacles || [], st.bites || [], s);

  // las curvas de la partida se quedan: la última bien visible y las anteriores cada vez más tenues, sin llegar a borrarse
  const n = R.shots.length;
  R.shots.forEach((sh, i) => drawTrail(sh.points, TEAM_COLOR[sh.team], Math.max(0.13, 0.6 * 0.74 ** (n - 1 - i)), false));
  if (R.think && Date.now() < R.think.until) drawThink(R.think); else R.think = null;
  if (R.current) animateCurrent();

  const labels = [];
  for (const sol of st.soldiers) {
    const [sx, sy] = w2s(sol.x, sol.y);
    const color = TEAM_COLOR[sol.team];
    const active = st.turn && st.turn.soldierId === sol.id;
    ctx.save();
    if (!sol.alive) {
      ctx.globalAlpha = .25; ctx.fillStyle = '#666';
      ctx.beginPath(); ctx.arc(sx, sy, 5 * R.dpr, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (!lowFx()) { ctx.shadowColor = color; ctx.shadowBlur = 12 * R.dpr; }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, 6 * R.dpr, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0f1a';
    ctx.beginPath(); ctx.arc(sx, sy, 2.4 * R.dpr, 0, 7); ctx.fill();
    if (active) {
      const t = performance.now() / 400;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * R.dpr; ctx.globalAlpha = R.fx.reduce ? .8 : .5 + .5 * Math.sin(t);
      ctx.beginPath(); ctx.arc(sx, sy, 11 * R.dpr, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    const owner = st.players.find((p) => p.id === sol.ownerId);
    labels.push(nameLabel(owner ? owner.name : '?', sx, sy, color));
  }
  drawBubbles(st, labels, [x0, y0, x1, y1]);
}

// el nombre en etiqueta, como en el original: caja redondeada con el borde del color del bando; si no cabe arriba, abajo
function nameLabel(name, sx, sy, color) {
  const { ctx } = R, d = R.dpr;
  ctx.save();
  ctx.font = `${11 * d}px ${SANS}`;
  const w = ctx.measureText(name).width + 10 * d, h = 16 * d;
  let x = sx - w / 2, y = sy - 12 * d - h;
  if (y < 2 * d) y = sy + 12 * d;
  x = Math.min(Math.max(x, 2 * d), R.canvas.width - w - 2 * d);
  ctx.fillStyle = '#0b1122d9'; ctx.strokeStyle = color; ctx.lineWidth = d;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6 * d); else ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, x + w / 2, y + h / 2 + 0.5 * d);
  ctx.restore();
  return { x, y, w, h };
}

// bocadillos: la cola decide qué se ve (bubbles.tick) y la colocación, dónde (bubbles.place); aquí solo se pintan
function drawBubbles(st, labels, [x0, y0, x1, y1]) {
  const { ctx } = R, d = R.dpr;
  const vis = tick(R.bq, Date.now(), speedOf());
  const items = [];
  for (const b of vis) {
    const sol = st.soldiers.find((s) => s.id === b.soldierId);
    if (!sol || !sol.alive) continue;
    const [sx, sy] = w2s(sol.x, sol.y);
    const fn = b.kind === 'fn';
    ctx.font = fn ? `${12.5 * d}px ${MONO}` : `${12.5 * d}px ${SANS}`;
    const lines = wrap(b.text, 250 * d, (t) => ctx.measureText(t).width, fn ? 2 : 3);
    const head = !fn && b.level ? 13 * d : 0;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width), head ? 60 * d : 0) + 20 * d;
    const h = lines.length * 16 * d + 14 * d + head;
    items.push({ id: b.id, ax: sx, ay: sy, w: Math.ceil(w), h: Math.ceil(h), b, lines, head, team: sol.team });
  }
  const blocks = st.soldiers.filter((s) => s.alive).map((s) => { const [sx, sy] = w2s(s.x, s.y); return { x: sx, y: sy, r: 10 * d }; })
    .concat(labels.map((l) => ({ x: l.x + l.w / 2, y: l.y + l.h / 2, r: Math.max(l.w, l.h) / 2 })));
  const spots = place(items, blocks, { x: x0 + 2 * d, y: y0 + 2 * d, w: x1 - x0 - 4 * d, h: y1 - y0 - 4 * d }, R.placed, 18 * d);
  R.placed = new Map(spots.map((p) => [p.id, { x: p.x, y: p.y }]));
  spots.forEach((p, i) => {
    const it = items[i], color = TEAM_COLOR[it.team] || '#fff', fn = it.b.kind === 'fn';
    ctx.save();
    if (p.guide) { // línea guía hasta su soldado
      ctx.strokeStyle = color; ctx.globalAlpha = .7; ctx.lineWidth = d;
      if (ctx.setLineDash) ctx.setLineDash([3 * d, 3 * d]);
      ctx.beginPath(); ctx.moveTo(p.guide.x1, p.guide.y1); ctx.lineTo(p.guide.x2, p.guide.y2); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = fn ? '#0a1020f2' : '#111a30f2'; ctx.strokeStyle = color; ctx.lineWidth = (fn ? 1.6 : 1.1) * d;
    if (fn && !lowFx()) { ctx.shadowColor = color; ctx.shadowBlur = 10 * d; }
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(p.x, p.y, p.w, p.h, 8 * d); else ctx.rect(p.x, p.y, p.w, p.h); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (!p.guide) { // colita hacia el soldado desde el borde más cercano
      const cx = Math.min(Math.max(p.ax, p.x + 10 * d), p.x + p.w - 10 * d), below = p.ay > p.y + p.h;
      const ey = below ? p.y + p.h : p.y;
      if (below || p.ay < p.y) {
        ctx.fillStyle = fn ? '#0a1020f2' : '#111a30f2';
        ctx.beginPath(); ctx.moveTo(cx - 5 * d, ey); ctx.lineTo(cx + 5 * d, ey); ctx.lineTo(cx, ey + (below ? 7 : -7) * d); ctx.closePath(); ctx.fill();
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let y = p.y + 7 * d;
    if (it.head) { // lo segura que está la red al hablar (spec/07 §4): novata, media o veterana
      ctx.font = `${10 * d}px ${SANS}`; ctx.fillStyle = color; ctx.globalAlpha = .9;
      ctx.fillText(String(it.b.level), p.x + 10 * d, y + 9 * d); ctx.globalAlpha = 1;
      y += it.head;
    }
    ctx.font = fn ? `${12.5 * d}px ${MONO}` : `${12.5 * d}px ${SANS}`;
    ctx.fillStyle = fn ? color : '#eef3ff';
    it.lines.forEach((l, k) => ctx.fillText(l, p.x + 10 * d, y + 12 * d + k * 16 * d));
    ctx.restore();
  });
}

function animateCurrent() {
  const pts = R.current.points;
  const elapsed = (performance.now() - R.current.t0) / 1000;
  const spd = SHOT_SPEED * speedOf(); // a x10 la sala espera 10 veces menos: la curva se traza 10 veces más deprisa
  let n = 0, dist = 0;
  while (n < pts.length - 1 && dist < elapsed * spd) {
    n++; dist += Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]);
  }
  drawTrail(pts.slice(0, n + 1), TEAM_COLOR[R.current.shooterTeam], .95, !lowFx(), pts[n]);
  if (n >= pts.length - 1 && pts.length >= 2) shotFinished(R.current);
}

// lo que imagina una red: sus tiros candidatos tenues (más probable, más visible) y la elegida discontinua en firme;
// en la fase de mover, los destinos (más grandes cuanto más probables) y el elegido con anillo
function drawThink(t) {
  const { ctx } = R;
  const color = TEAM_COLOR[t.team] || '#fff';
  if (t.kind === 'shoot') {
    for (const c of t.faint) drawTrail(c.points, color, c.alpha, false);
    if (t.chosen) {
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([6 * R.dpr, 5 * R.dpr]);
      drawTrail(t.chosen.points, '#ffffff', 0.9, false);
      ctx.restore();
    }
    return;
  }
  for (const s of t.spots) {
    const [x, y] = w2s(s.x, s.y);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.6 * Math.min(1, s.p * 3);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, (2 + 7 * Math.min(1, s.p * 2)) * R.dpr, 0, 7); ctx.fill();
    if (s.i === t.chosen) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * R.dpr; ctx.beginPath(); ctx.arc(x, y, 11 * R.dpr, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
}

function drawTrail(pts, color, alpha, glow, head) {
  if (!pts || pts.length < 2) return;
  const { ctx } = R;
  ctx.save();
  ctx.strokeStyle = color; ctx.globalAlpha = alpha;
  ctx.lineWidth = (glow ? 2.6 : 1.6) * R.dpr;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14 * R.dpr; }
  ctx.beginPath();
  const [x0, y0] = w2s(pts[0][0], pts[0][1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) { const [a, b] = w2s(pts[i][0], pts[i][1]); ctx.lineTo(a, b); }
  ctx.stroke();
  if (head) {
    const [hx, hy] = w2s(head[0], head[1]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 3.4 * R.dpr, 0, 7); ctx.fill();
  }
  ctx.restore();
}
