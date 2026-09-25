// Motor del tutorial (spec/12 §4, relevo s12 §4.1): una máquina de pasos pura y genérica, sin DOM ni reloj (el tiempo
// llega como `now`, en ms). La usa el tutorial de Crear (crear.js + overlay.js) y, en P10, la de Entrenar, Duelo y Trono.
//   capítulo: {key, title, ask, steps: [paso], ensure?(genome, catalog)}
//   paso: {key, kind, target, lit, present, look, title, text, todo, done(ctx, base, p), after(ctx, p), gesture, help,
//          keys, setup, options, auto}
//   kind: show (presenta una zona; se avanza con →) · do (se avanza al hacerlo) · ask (se avanza al responder) ·
//         reto (sin ayuda al principio; «Hazlo por mí» tras 2 fallos) · pause (probar o seguir, con →) · grad (graduación)
// El avance (`p`) es un objeto plano que se guarda tal cual en meta.tutorial del mundo.
export const HELP = { idle1: 25000, idle2: 50000, miss1: 2, miss2: 4, retoMiss: 2, retoIdle: 45000 };
const BY_ARROW = new Set(['show', 'pause', 'grad']);
const WAITS = new Set(['do', 'ask', 'reto']);
const snap = (ctx) => ({ ev: { ...((ctx && ctx.ev) || {}) } });
const clampCh = (chapters, i) => Math.max(0, Math.min(chapters.length - 1, Number(i) | 0));
export const stepId = (chapters, p) => `${chapters[p.ci].key}/${chapters[p.ci].steps[p.si].key}`;

function enter(p, ci, si, ctx, now) { return { ...p, ci, si, t0: now, misses: 0, base: snap(ctx) }; }

// empezar en el capítulo `at` (los anteriores se dan por hechos: camino «Ya sé algo»)
export function start(chapters, { at = 0, now = 0, ctx = null, path = null } = {}) {
  const ci = clampCh(chapters, at);
  const p = { v: 1, on: true, finished: false, skipped: false, path, done: chapters.slice(0, ci).map((c) => c.key), answers: {}, setup: [], data: {}, last: null };
  return settle(chapters, enter(p, ci, 0, ctx, now), ctx, now);
}

export function current(chapters, p) {
  if (!p || !p.on || p.finished) return null;
  const chapter = chapters[p.ci], step = chapter && chapter.steps[p.si];
  return step ? { chapter, step, ci: p.ci, si: p.si } : null;
}

// siguiente paso (o el primero del capítulo siguiente); al pasar del último, se acaba. `last` = el paso de hacer que
// acaba de cumplirse (su «lo que ha cambiado» sale al principio del paso siguiente)
function forward(chapters, p, ctx, now, last) {
  let { ci, si } = p, done = p.done;
  si += 1;
  if (si >= chapters[ci].steps.length) { done = [...new Set([...done, chapters[ci].key])]; ci += 1; si = 0; }
  if (ci >= chapters.length) return { ...p, done, on: false, finished: true, last };
  return enter({ ...p, done, last }, ci, si, ctx, now);
}

// un paso de hacer que ya se cumple al llegar se da por hecho (como en coach.js); nunca se salta uno de presentar, ni un
// reto cuyo cambio de partida (setup) aún no se ha aplicado
function settle(chapters, p, ctx, now) {
  let q = p;
  for (let guard = 0; guard < 500; guard++) {
    const c = current(chapters, q);
    if (!c || !WAITS.has(c.step.kind)) return q;
    if (c.step.setup && !q.setup.includes(stepId(chapters, q))) return q;
    if (!isDone(c.step, ctx, q)) return q;
    q = forward(chapters, q, ctx, now, { ci: q.ci, si: q.si });
  }
  return q;
}
function isDone(step, ctx, p) {
  if (step.kind === 'ask') return p.answers[step.key] !== undefined;
  try { return !!(step.done && ctx && step.done(ctx, p.base, p)); } catch { return false; }
}

// eventos: next · check · answer · miss · setup · skipChapter · skipAll · resume · restart · goto · set · tick
export function advance(chapters, p, event, { ctx = null, now = 0, value } = {}) {
  if (!p) return p;
  const c = current(chapters, p);
  switch (event) {
    case 'next':
      if (!c) return p;
      if (BY_ARROW.has(c.step.kind) || (WAITS.has(c.step.kind) && isDone(c.step, ctx, p))) return settle(chapters, forward(chapters, p, ctx, now, BY_ARROW.has(c.step.kind) ? null : { ci: p.ci, si: p.si }), ctx, now);
      return p;
    case 'check': return c ? settle(chapters, p, ctx, now) : p;
    case 'answer':
      if (!c || c.step.kind !== 'ask') return p;
      return settle(chapters, { ...p, answers: { ...p.answers, [c.step.key]: value } }, ctx, now);
    case 'miss': return c ? { ...p, misses: (p.misses || 0) + 1 } : p;
    case 'setup': {
      if (!c || !c.step.setup) return p;
      const id = stepId(chapters, p);
      if (p.setup.includes(id)) return p;
      return settle(chapters, { ...p, setup: [...p.setup, id], t0: now, misses: 0, base: snap(ctx) }, ctx, now);
    }
    case 'skipChapter': {
      if (!c) return p;
      const done = [...new Set([...p.done, chapters[p.ci].key])];
      if (p.ci + 1 >= chapters.length) return { ...p, done, on: false, finished: true, last: null };
      return settle(chapters, enter({ ...p, done, last: null }, p.ci + 1, 0, ctx, now), ctx, now);
    }
    case 'goto': {
      const ci = clampCh(chapters, value);
      const later = new Set(chapters.slice(ci).map((x) => x.key));
      const setup = p.setup.filter((id) => !later.has(id.split('/')[0]));
      return settle(chapters, enter({ ...p, on: true, finished: false, skipped: false, setup, last: null }, ci, 0, ctx, now), ctx, now);
    }
    case 'skipAll': return { ...p, on: false, skipped: true };
    case 'resume':
      if (p.finished) return start(chapters, { now, ctx, path: p.path });
      return settle(chapters, enter({ ...p, on: true, skipped: false }, p.ci, p.si, ctx, now), ctx, now);
    case 'restart': return start(chapters, { now, ctx, path: p.path });
    case 'set': return { ...p, data: { ...p.data, ...(value || {}) } };
    default: return p; // tick: el tiempo solo cuenta para helpLevel
  }
}

// lo que se ilumina (`on`: responde al ratón), lo que se ve a media luz (`known`: lo ya presentado, y lo que presenta el
// paso de ahora) y si el iluminado solo se mira (`look`). Los objetivos pueden depender del estado: target(ctx)
export function lights(chapters, p, ctx = null) {
  const c = current(chapters, p);
  const res = (x) => (typeof x === 'function' ? x(ctx || {}, p) : x);
  const known = new Set();
  chapters.forEach((ch, i) => ch.steps.forEach((s, j) => {
    const before = !p || p.finished || (p.done || []).includes(ch.key) || i < p.ci || (i === p.ci && j <= p.si);
    if (before) for (const k of s.present || []) known.add(k);
  }));
  const on = c ? [res(c.step.target), ...(res(c.step.lit) || [])].filter(Boolean) : [];
  for (const k of on) known.delete(k);
  return { on, known: [...known], look: !!(c && c.step.look) };
}

// escalón de ayuda: 0 nada · 1 mano fantasma · 2 mano y «Hazlo por mí». En un paso con un gesto nuevo, la mano sale
// desde el principio; después, a los 25 s o tras 2 fallos, y «Hazlo por mí» a los 50 s o tras 4. En un reto no hay
// ayuda hasta 2 fallos (o 45 s), y entonces sale todo
export function helpLevel(chapters, p, now) {
  const c = current(chapters, p);
  if (!c) return 0;
  const t = Math.max(0, now - (p.t0 || 0)), m = p.misses || 0;
  if (c.step.kind === 'reto') return m >= HELP.retoMiss || t >= HELP.retoIdle ? 2 : 0;
  if (c.step.kind !== 'do') return 0;
  if (m >= HELP.miss2 || t >= HELP.idle2) return 2;
  if (m >= HELP.miss1 || t >= HELP.idle1 || freshGesture(chapters, p.ci, p.si)) return 1;
  return 0;
}

// ¿es la primera vez que el tutorial pide este gesto? (nombre del gesto: 'arrastrar-cable', 'paleta'…)
export function freshGesture(chapters, ci, si) {
  const name = gestureName(chapters[ci].steps[si]);
  if (!name) return false;
  for (let i = 0; i <= ci; i++) {
    const steps = chapters[i].steps;
    for (let j = 0; j < (i === ci ? si : steps.length); j++) if (gestureName(steps[j]) === name) return false;
  }
  return true;
}
const gestureName = (s) => (s && s.gesture ? s.gesture.name || null : null);

// la barra de capítulos: un punto por capítulo (hecho, ahora o por hacer)
export function bar(chapters, p) {
  return chapters.map((ch, i) => ({ key: ch.key, title: ch.title, state: p && ((p.done || []).includes(ch.key) || p.finished) ? 'done' : p && i === p.ci ? 'now' : 'todo' }));
}
