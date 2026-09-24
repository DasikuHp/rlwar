// Portada (P5): fondo animado (el plano de Graphwar con curvas que se trazan solas y polvo que huye del ratón) y la
// constelación de la red que reina en el mundo: sus bloques de verdad (el tamaño de cada estrella = cuántos pesos tiene)
// y, si ha jugado, sus pulsos: la activación media de cada bloque en las decisiones de su última partida, una tras otra.
// Todo se para con la pestaña oculta y respeta "reducir movimiento" (un solo dibujo quieto).
const GROUP_COLOR = { eyes: '#3fd0ff', instinct: '#a594ff', memory: '#f5c451', hands: '#3ddc97', feet: '#ff8fa3' };
const CURVES = [
  (x, t) => Math.sin(x / 3 + t) * 5,
  (x, t) => 0.04 * (x - 6 * Math.sin(t / 3)) ** 2 - 8,
  (x, t) => Math.sin(x / 2 + t) * 3 + x * 0.25,
  (x, t) => 6 * Math.exp(-((x - 8 * Math.cos(t / 2)) ** 2) / 30) - 3,
];

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  return { w: canvas.width, h: canvas.height, dpr };
}

// fondo: devuelve stop()
export function startBackground(canvas, { quality = 'alta', reduce = false } = {}) {
  const ctx = canvas.getContext('2d');
  const n = quality === 'alta' ? 140 : quality === 'media' ? 70 : 0;
  const dust = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.15 }));
  const mouse = { x: -1, y: -1 };
  const onMove = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height; };
  window.addEventListener('pointermove', onMove);
  let raf = 0, alive = true;
  const t0 = performance.now();
  const draw = (now) => {
    if (!alive) return;
    const { w, h, dpr } = fit(canvas);
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    // el plano: cuadrícula tenue y ejes
    const s = Math.min(w / 52, h / 32), cx = w / 2, cy = h / 2;
    ctx.lineWidth = dpr;
    ctx.strokeStyle = '#0f1a33';
    ctx.beginPath();
    for (let gx = -25; gx <= 25; gx += 5) { ctx.moveTo(cx + gx * s, 0); ctx.lineTo(cx + gx * s, h); }
    for (let gy = -15; gy <= 15; gy += 5) { ctx.moveTo(0, cy - gy * s); ctx.lineTo(w, cy - gy * s); }
    ctx.stroke();
    ctx.strokeStyle = '#16264a';
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    // curvas que se trazan de izquierda a derecha, cada una a su ritmo, y se apagan
    CURVES.forEach((f, i) => {
      const period = 7 + i * 1.7, ph = ((t + i * 2.3) % period) / period;
      const head = -25 + 50 * Math.min(1, ph * 1.3), fade = ph > 0.77 ? 1 - (ph - 0.77) / 0.23 : 1;
      const col = i % 2 ? '139,108,255' : '63,208,255';
      ctx.lineWidth = 1.6 * dpr;
      ctx.shadowColor = `rgba(${col},0.8)`; ctx.shadowBlur = 10 * dpr;
      ctx.strokeStyle = `rgba(${col},${0.35 * fade})`;
      ctx.beginPath();
      for (let x = -25; x <= head; x += 0.25) { const y = f(x, t * 0.15 + i); const px = cx + x * s, py = cy - y * s; if (x === -25) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (fade > 0.2 && ph < 0.77) { const hy = f(head, t * 0.15 + i); ctx.fillStyle = `rgba(${col},0.9)`; ctx.beginPath(); ctx.arc(cx + head * s, cy - hy * s, 2.4 * dpr, 0, Math.PI * 2); ctx.fill(); }
    });
    // polvo que huye del ratón
    for (const d of dust) {
      const dx = d.x - mouse.x, dy = d.y - mouse.y, dd = dx * dx + dy * dy;
      if (mouse.x >= 0 && dd < 0.012) { d.vx += dx * 0.0009 / (dd + 1e-3); d.vy += dy * 0.0009 / (dd + 1e-3); }
      d.vx = d.vx * 0.94 + 0.00004; d.vy = d.vy * 0.94 - 0.00002;
      d.x = (d.x + d.vx + 1) % 1; d.y = (d.y + d.vy + 1) % 1;
      ctx.fillStyle = `rgba(160,200,255,${d.a})`;
      ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.r * dpr, 0, Math.PI * 2); ctx.fill();
    }
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (alive && !reduce) raf = requestAnimationFrame(draw); };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(draw);
  return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis); };
}

// posiciones de los bloques: columna por profundidad en los cables (los ojos a la izquierda, las manos y pies a la derecha)
export function constellationLayout(genome, groupOf) {
  const ids = genome.blocks.map((b) => b.id);
  const depth = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let k = 0; k < ids.length; k++) for (const w of genome.wires) if (depth[w.to] !== undefined && depth[w.from] !== undefined) depth[w.to] = Math.max(depth[w.to], depth[w.from] + 1);
  const maxD = Math.max(1, ...Object.values(depth));
  const cols = {};
  for (const b of genome.blocks) (cols[depth[b.id]] ||= []).push(b);
  const pos = {};
  for (const [d, list] of Object.entries(cols)) list.forEach((b, i) => { pos[b.id] = { x: 0.08 + 0.84 * (Number(d) / maxD), y: (i + 1) / (list.length + 1), group: groupOf(b.type) }; });
  return pos;
}
const paramsOf = (genome, id) => Object.values((genome.weights || {})[id] || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);

// constelación: devuelve stop(). `beats` = [{blockId: media de |activación|}] de decisiones reales (puede ir vacío)
export function startQueen(canvas, { genome, groupOf, beats = [], reduce = false }) {
  const ctx = canvas.getContext('2d');
  const pos = constellationLayout(genome, groupOf);
  const size = Object.fromEntries(genome.blocks.map((b) => [b.id, paramsOf(genome, b.id)]));
  const maxP = Math.max(1, ...Object.values(size));
  const maxA = Math.max(1e-9, ...beats.flatMap((b) => Object.values(b)));
  let raf = 0, alive = true;
  const t0 = performance.now();
  const draw = (now) => {
    if (!alive) return;
    const { w, h, dpr } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000;
    const beat = beats.length ? beats[Math.floor(t / 0.9) % beats.length] : null;
    const phase = (t / 0.9) % 1;
    const P = (id) => [pos[id].x * w, (0.06 + 0.8 * pos[id].y) * h];
    // cables, con un pulso que corre por ellos según la activación del bloque de origen
    for (const wi of genome.wires) {
      if (!pos[wi.from] || !pos[wi.to]) continue;
      const [x1, y1] = P(wi.from), [x2, y2] = P(wi.to);
      const col = GROUP_COLOR[pos[wi.from].group] || '#7c89a8';
      ctx.strokeStyle = col + '33'; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2); ctx.stroke();
      const a = beat && beat[wi.from] !== undefined ? beat[wi.from] / maxA : beat ? 0.35 : 0;
      if (a > 0 && !reduce) {
        const u = phase, iu = 1 - u;
        const px = iu ** 3 * x1 + 3 * iu * iu * u * (x1 + x2) / 2 + 3 * iu * u * u * (x1 + x2) / 2 + u ** 3 * x2;
        const py = iu ** 3 * y1 + 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u ** 3 * y2;
        ctx.fillStyle = col; ctx.globalAlpha = 0.25 + 0.75 * a;
        ctx.shadowColor = col; ctx.shadowBlur = 12 * dpr;
        ctx.beginPath(); ctx.arc(px, py, (1.5 + 2.5 * a) * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    }
    // estrellas: una por bloque
    for (const b of genome.blocks) {
      const [x, y] = P(b.id);
      const col = GROUP_COLOR[pos[b.id].group] || '#7c89a8';
      const r = (4 + 10 * Math.sqrt(size[b.id] / maxP)) * dpr;
      const act = beat && beat[b.id] !== undefined ? beat[b.id] / maxA : 0;
      const glow = reduce ? 0.6 : 0.45 + 0.55 * act * (1 - phase * 0.6);
      ctx.shadowColor = col; ctx.shadowBlur = (8 + 22 * glow) * dpr;
      ctx.fillStyle = col; ctx.globalAlpha = 0.35 + 0.65 * glow;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      ctx.fillStyle = '#e3ebf8'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5 * dpr, r * 0.3), 0, Math.PI * 2); ctx.fill();
    }
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (alive && !reduce) raf = requestAnimationFrame(draw); };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(draw);
  return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
}
