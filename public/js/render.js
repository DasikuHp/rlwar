// Render del tablero: tema neón, trayectorias con glow, partículas y shake.
export const R = {
  canvas: null, ctx: null, dpr: 1,
  state: null, myId: null,
  shots: [],       // trayectorias previas {points, team, ts}
  current: null,   // disparo animándose
  particles: [],
  shake: 0,
  bubbles: [],     // {soldierId, text, until} bocadillos sobre el soldado
  lastSayTs: 0,    // cuándo se habló por última vez (para retrasar el disparo)
  _cw: -1, _ch: -1,
  stars: Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + .3, a: Math.random() * .7 + .2 })),
};

export const TEAM_COLOR = { left: '#4fd1ff', right: '#ff9f43' };

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

export const w2s = (x, y) => {
  const W = R.canvas.width, H = R.canvas.height;
  const s = Math.min(W / 52, H / 32);
  return [W / 2 + x * s, H / 2 - y * s, s];
};

export function startShot(shot) {
  // si acaba de hablar en bocadillo, el cañonazo espera a que se lea
  const delay = (Date.now() - (R.lastSayTs || 0) < 3000) ? 1200 : 0;
  R.current = { ...shot, t0: performance.now() + delay };
  if (R.shots.length > 4) R.shots.shift();
}

export function shotFinished(shot) {
  R.shots.push({ points: shot.points, team: shot.shooterTeam, ts: Date.now() });
  R.current = null;
  const end = shot.points[shot.points.length - 1];
  burst(end[0], end[1], shot.result.type === 'kill' || shot.result.type === 'suicide' ? 60 : 26, shot.shooterTeam);
  R.shake = shot.result.type === 'kill' ? 16 : 8;
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
  for (const s of R.stars) {
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

  for (const o of st.obstacles) {
    const [ox, oy] = w2s(o.x, o.y + o.h);
    ctx.fillStyle = '#1c2647'; ctx.strokeStyle = '#43538a'; ctx.lineWidth = R.dpr;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ox, oy, o.w * s, o.h * s, 4 * R.dpr);
    else ctx.rect(ox, oy, o.w * s, o.h * s);
    ctx.fill(); ctx.stroke();
  }

  const age = (sh) => (Date.now() - sh.ts) / 1000;
  for (const sh of R.shots) drawTrail(sh.points, TEAM_COLOR[sh.team], Math.max(0, .35 - age(sh) * .05), false);
  if (R.current) animateCurrent();

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
    ctx.shadowColor = color; ctx.shadowBlur = 12 * R.dpr;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, 6 * R.dpr, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0f1a';
    ctx.beginPath(); ctx.arc(sx, sy, 2.4 * R.dpr, 0, 7); ctx.fill();
    if (active) {
      const t = performance.now() / 400;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * R.dpr; ctx.globalAlpha = .5 + .5 * Math.sin(t);
      ctx.beginPath(); ctx.arc(sx, sy, 11 * R.dpr, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const owner = st.players.find((p) => p.id === sol.ownerId);
    ctx.fillStyle = color; ctx.globalAlpha = .8; ctx.font = `${11 * R.dpr}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(owner ? owner.name : '?', sx, sy - 14 * R.dpr);
    ctx.restore();
  }

  // bocadillos de diálogo sobre el soldado que habló
  const now = Date.now();
  R.bubbles = (R.bubbles || []).filter((b) => b.until > now);
  for (const b of R.bubbles) {
    const sol = st.soldiers.find((s) => s.id === b.soldierId);
    if (!sol || !sol.alive) continue;
    const [sx, sy] = w2s(sol.x, sol.y);
    const color = TEAM_COLOR[sol.team];
    let txt = b.text;
    const cut = txt.indexOf(': ');
    if (cut >= 0 && cut < 30) txt = txt.slice(cut + 2); // fuera el "Nombre: "
    if (txt.length > 80) txt = txt.slice(0, 80) + '…';
    ctx.save();
    ctx.font = `${12 * R.dpr}px sans-serif`; ctx.textAlign = 'center';
    const w = Math.min(ctx.measureText(txt).width + 18 * R.dpr, R.canvas.width * .6);
    const h = 24 * R.dpr;
    const bx = Math.min(Math.max(sx - w / 2, 4), R.canvas.width - w - 4);
    const by = sy - 40 * R.dpr - h;
    ctx.fillStyle = '#0d1322ee'; ctx.strokeStyle = color; ctx.lineWidth = 1.5 * R.dpr;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 8 * R.dpr);
    else ctx.rect(bx, by, w, h);
    ctx.fill(); ctx.stroke();
    // colita hacia el soldado
    ctx.fillStyle = '#0d1322ee';
    ctx.beginPath();
    ctx.moveTo(sx - 5 * R.dpr, by + h); ctx.lineTo(sx + 5 * R.dpr, by + h); ctx.lineTo(sx, by + h + 8 * R.dpr);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, bx + w / 2, by + 16.5 * R.dpr, w - 12 * R.dpr);
    ctx.restore();
  }
}

function animateCurrent() {
  const pts = R.current.points;
  const elapsed = (performance.now() - R.current.t0) / 1000;
  const spd = 55;
  let n = 0, dist = 0;
  while (n < pts.length - 1 && dist < elapsed * spd) {
    n++; dist += Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]);
  }
  drawTrail(pts.slice(0, n + 1), TEAM_COLOR[R.current.shooterTeam], .95, true, pts[n]);
  if (n >= pts.length - 1 && pts.length >= 2) shotFinished(R.current);
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
