// Bocadillos del duelo (plan ronda 17, adelantado de P7 por lo visto en la prueba de P5). Dos piezas puras, sin DOM ni
// lienzo, para que se puedan probar en Node:
//  1. La COLA de cada soldado: primero su función (mientras se traza la curva y un poco después) y luego lo que dice, de
//     uno en uno. Una frase que llega cuando la red ya ha decidido pero aún no ha disparado espera a su función.
//  2. La COLOCACIÓN: cada bocadillo prueba sitios alrededor de su soldado y se queda en el primero que no pisa a otro
//     bocadillo, a otro soldado ni el borde; si se aleja de su soldado, lleva una línea guía hasta él.
// `now` va en milisegundos; `speed` es la de la sala (1 o 10): a x10 todo dura menos, pero nunca menos de lo que se tarda
// en leerlo por encima.

const MAX_WAITING = 2; // frases en espera por soldado: si llegan más, las más viejas solo quedan en el registro
export const readMs = (text, speed = 1) => Math.round(Math.max(1400, Math.min(8000, 1200 + 48 * String(text).length)) / Math.min(3, Math.max(1, speed)));

export function createBubbles() { return { items: [], expect: {}, seq: 0 }; }

// la red de `soldierId` ya ha decidido su tiro: lo que diga desde ahora espera a que se vea su función
export function expectShot(B, soldierId, now, speed = 1) { B.expect[soldierId] = now + 9000 / Math.min(3, Math.max(1, speed)); }

// la función del tiro: se ve desde ya hasta que la curva acaba (`landed`) y un rato más
export function pushFn(B, { soldierId, text, team = null }, now) {
  for (const it of B.items) if (it.kind === 'fn' && it.end === null) it.end = now; // la anterior, si seguía, se cierra
  delete B.expect[soldierId];
  B.items.push({ id: ++B.seq, kind: 'fn', soldierId, text, team, start: now, end: null });
}
export function landed(B, soldierId, now, speed = 1) {
  for (const it of B.items) if (it.kind === 'fn' && it.soldierId === soldierId && it.end === null) it.end = now + Math.round(1800 / Math.min(3, Math.max(1, speed)));
}

// lo que dice un soldado: entra en su cola
export function pushSay(B, { soldierId, text, level = null, team = null }, now) {
  const waiting = B.items.filter((it) => it.kind === 'say' && it.soldierId === soldierId && it.start === null);
  if (waiting.length >= MAX_WAITING) B.items.splice(B.items.indexOf(waiting[0]), 1);
  B.items.push({ id: ++B.seq, kind: 'say', soldierId, text, level, team, start: null, end: null, born: now });
}

// avanza las colas y devuelve lo que se ve en `now`: como mucho un bocadillo por soldado
export function tick(B, now, speed = 1) {
  B.items = B.items.filter((it) => it.end === null || it.end > now);
  const bySoldier = new Map();
  for (const it of B.items) { if (!bySoldier.has(it.soldierId)) bySoldier.set(it.soldierId, []); bySoldier.get(it.soldierId).push(it); }
  const out = [];
  for (const [sid, list] of bySoldier) {
    const fn = list.find((it) => it.kind === 'fn' && it.start <= now);
    if (fn) { out.push(fn); continue; } // su función manda mientras dura
    if (B.expect[sid] && B.expect[sid] > now) continue; // ha decidido y va a disparar: espera a la función
    delete B.expect[sid];
    let say = list.find((it) => it.kind === 'say' && it.start !== null);
    if (!say) { say = list.find((it) => it.kind === 'say'); if (say) { say.start = now; say.end = now + readMs(say.text, speed); } }
    if (say) out.push(say);
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === 'fn' ? -1 : 1));
}

// ---------- colocación ----------
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r, box) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
// sitios alrededor del soldado, en anillos cada vez más lejos: arriba primero (como en un cómic), después los lados y
// abajo. En cada sitio, el borde del bocadillo queda a `gap·k` del soldado en esa dirección.
const ANGLES = [-90, -60, -120, -30, -150, 0, 180, 30, 150, 60, 120, 90].map((a) => (a * Math.PI) / 180);
function spots(ax, ay, w, h, gap) {
  const out = [];
  for (const k of [1, 2, 3.5, 5, 7, 9]) for (const a of ANGLES) {
    const cx = ax + Math.cos(a) * (gap * k + w / 2), cy = ay + Math.sin(a) * (gap * k + h / 2);
    out.push([cx - w / 2, cy - h / 2]);
  }
  return out;
}
// items: [{id, ax, ay, w, h}] en orden de prioridad (las funciones primero); soldiers: [{x, y, r}] en píxeles;
// box: {x, y, w, h} (el plano); prev: Map id → {x, y} de la vez anterior (si sigue libre, no se mueve: nada salta)
// Devuelve [{id, x, y, w, h, ax, ay, guide}] con guide = null o {x1, y1, x2, y2} (del borde del bocadillo al soldado)
export function place(items, soldiers, box, prev = new Map(), gap = 16) {
  const taken = [], out = [];
  const blocks = soldiers.map((s) => ({ x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }));
  for (const it of items) {
    const tries = [];
    const p = prev.get(it.id);
    if (p) tries.push([p.x, p.y]);
    tries.push(...spots(it.ax, it.ay, it.w, it.h, gap));
    let best = null, bestCost = Infinity;
    for (const [x, y] of tries) {
      const r = { x: Math.round(x), y: Math.round(y), w: it.w, h: it.h };
      const clamped = { ...r, x: Math.min(Math.max(r.x, box.x), box.x + box.w - r.w), y: Math.min(Math.max(r.y, box.y), box.y + box.h - r.h) };
      const c = inside(r, box) ? r : clamped;
      const cost = taken.reduce((s, t) => s + overlapArea(c, t) * 4, 0) + blocks.reduce((s, b) => s + overlapArea(c, b), 0);
      if (cost === 0) { best = c; bestCost = 0; break; }
      if (cost < bestCost) { best = c; bestCost = cost; }
    }
    taken.push(best);
    const cx = Math.min(Math.max(it.ax, best.x), best.x + best.w), cy = Math.min(Math.max(it.ay, best.y), best.y + best.h);
    const far = Math.hypot(cx - it.ax, cy - it.ay) > gap * 1.5;
    out.push({ id: it.id, x: best.x, y: best.y, w: best.w, h: best.h, ax: it.ax, ay: it.ay, guide: far ? { x1: cx, y1: cy, x2: it.ax, y2: it.ay } : null });
  }
  return out;
}
export const overlaps = (list) => list.some((a, i) => list.some((b, j) => j > i && hit(a, b)));

// parte un texto en líneas que caben en `maxW` según `measure(text) → ancho`; como mucho `maxLines` (la última con …)
export function wrap(text, maxW, measure, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const keep = lines.slice(0, maxLines);
  let last = keep[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxW) last = last.slice(0, -1);
  keep[maxLines - 1] = `${last}…`;
  return keep;
}
