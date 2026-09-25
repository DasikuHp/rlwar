// La capa del tutorial (spec/12 §4.1, maqueta REFERENCIATUTORIAL.png; relevo s12 §4.1): genérica, sirve para cualquier
// etapa. Encima de la vista, en una capa fija:
//  - penumbra: un SVG a pantalla completa con máscara (blanco = a oscuras; gris = media luz, lo ya presentado; negro =
//    iluminado, con el borde difuminado) y el halo azul que late alrededor de lo iluminado;
//  - solo responde lo iluminado: escuchas en fase de captura cancelan el ratón y las teclas que caen fuera (cada clic
//    fuera cuenta como un fallo). pointermove y pointerup no se tocan: un arrastre empieza en lo iluminado y acaba donde sea;
//  - la ventana del Sistema, pegada a lo iluminado sin taparlo, unida por una línea con un punto brillante;
//  - la barra: capítulo, sus puntos, «Ya sé esto» y «Saltar tutorial»;
//  - la mano fantasma, que hace el gesto en bucle.
// La lógica (qué paso toca, qué se ilumina, cuándo hay ayuda) es de engine.js; los cambios en la red, del adaptador.
import * as E from './engine.js';
import { lines, ghost, burst, countUp } from '../../ui/fx/anim.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nums = (html) => html.replace(/(^|[\s(#])(\d+(?:,\d+)?)(?=[\s).,:;]|$)/g, '$1<b class="n">$2</b>');
const BY_ARROW = new Set(['show', 'pause', 'grad']);
const HAND = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2 L3 19 L7.5 15 L10.5 22 L13.5 20.8 L10.6 14 L16.5 14 Z" fill="#eaf6ff" stroke="#0a1426" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const PAD = 6;

export function mountTutorial({ chapters, root, ctx, help, setup, ensure, save, finish, allowed = () => false, clip = '', onChange = () => {} }) {
  let p = null, busy = false, frame = 0, sig = '', winHTML = '', lastId = null, lastLevel = -1, litEls = [], lastU = null;
  let ghostTok = null, stopGhost = null, ghostSig = '', grad = null, scrolledAt = 0, snap = true;
  const main = chapters.filter((c) => c.key !== 'grad').length;
  const layer = document.createElement('div');
  layer.className = 'tut-layer'; layer.hidden = true;
  layer.innerHTML = `<svg class="tut-dim" aria-hidden="true"></svg><svg class="tut-link" aria-hidden="true"><line/><circle r="4.5"/></svg>
    <section class="tut-win" role="dialog" aria-label="El Sistema"></section><nav class="tut-bar" aria-label="Tutorial"></nav>
    <div class="tut-hand" aria-hidden="true" hidden>${HAND}</div>`;
  document.body.appendChild(layer);
  const $ = (s) => layer.querySelector(s);
  const now = () => Date.now();
  const visible = () => root.isConnected && root.offsetParent !== null && !root.closest('[hidden]');
  const on = () => !!(p && p.on);

  // ---------- qué hay en pantalla ----------
  const resolve = (spec) => {
    if (!spec) return [];
    const sel = /^[a-z0-9-]+$/.test(spec) ? `[data-tut~="${spec}"]` : spec;
    try { return [...document.querySelectorAll(sel)].filter((e) => !layer.contains(e) && e.getClientRects().length); } catch { return []; }
  };
  const rectOf = (el) => {
    let r = el.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    const box = clip && el.parentElement ? el.parentElement.closest(clip) : null;
    if (box) { const b = box.getBoundingClientRect(); x0 = Math.max(x0, b.left); y0 = Math.max(y0, b.top); x1 = Math.min(x1, b.right); y1 = Math.min(y1, b.bottom); }
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + 2 * PAD, h: y1 - y0 + 2 * PAD };
  };
  const rects = (els) => els.map(rectOf).filter(Boolean);
  const union = (rs) => (rs.length ? rs.reduce((u, r) => ({ x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), r: Math.max(u.r, r.x + r.w), b: Math.max(u.b, r.y + r.h) }), { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity }) : null);
  // el punto donde actúa la mano: el centro, o la mitad de un cable
  const pointOf = (el) => {
    if (!el) return null;
    if (el.getTotalLength && el.getScreenCTM) { const L = el.getTotalLength(), q = el.getPointAtLength(L / 2), m = el.getScreenCTM(); return { x: q.x * m.a + m.e, y: q.y * m.d + m.f }; }
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // ---------- las luces de ahora ----------
  function lightsNow(x) {
    const c = E.current(chapters, p);
    const L = E.lights(chapters, p, x);
    if (c && c.step.kind === 'grad' && grad) {
      if (grad.i < c.step.zones.length) return { on: [c.step.zones[grad.i][0]], known: L.known, look: true, all: false };
      return { on: [], known: [], look: false, all: true };
    }
    return { ...L, all: false };
  }

  function draw() {
    const x = ctx(), L = lightsNow(x);
    const onEls = L.on.flatMap(resolve), onR = rects(onEls);
    const knR = L.all ? [] : rects(L.known.flatMap(resolve));
    litEls = L.all ? [document.body] : L.look ? [] : onEls;
    const W = innerWidth, H = innerHeight, k = (r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    const s = `${W}x${H}|${L.all}|${onR.map(k).join(';')}|${knR.map(k).join(';')}|${winHTML.length}`;
    if (s === sig) return;
    sig = s;
    const rr = (r, fill) => `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="10" fill="${fill}"/>`;
    $('.tut-dim').setAttribute('viewBox', `0 0 ${W} ${H}`);
    $('.tut-dim').innerHTML = L.all ? '' : `<defs><filter id="tutBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>
      <mask id="tutMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><g filter="url(#tutBlur)">${knR.map((r) => rr(r, '#484848')).join('')}${onR.map((r) => rr(r, '#000')).join('')}</g></mask></defs>
      <rect class="tut-shade" width="${W}" height="${H}" mask="url(#tutMask)"/>${onR.map((r) => `<rect class="tut-halo" x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="10"/>`).join('')}`;
    const U = union(onR);
    if (U) lastU = U;
    const c0 = E.current(chapters, p), v0 = (f) => (typeof f === 'function' ? f(x, p) : f);
    const room = c0 && c0.step.room ? rects(resolve(v0(c0.step.room))) : null;
    // además, lo que da sentido a lo iluminado (keep: p. ej., las tarjetas de los dos extremos de un cable) y el aviso de abajo
    const keep = rects([...(c0 && c0.step.keep ? (v0(c0.step.keep) || []).filter(Boolean).flatMap(resolve) : []), ...resolve('#toast.show')]);
    if (onEls.some((e) => { const z = e.parentElement && e.parentElement.closest(clip); if (!z) return false; const a = e.getBoundingClientRect(), b = z.getBoundingClientRect(); return a.height < b.height && (a.top < b.top - 1 || a.bottom > b.bottom + 1); }) && Date.now() - scrolledAt > 400) { scrolledAt = Date.now(); scrollTargets(); sig = ''; return; }
    place(U, [...(room || onR), ...keep]);
  }

  // la ventana: a la derecha de lo iluminado si cabe; si no, a la izquierda, debajo o encima; sin taparlo y dentro de la
  // pantalla (si nada cabe, donde menos tape). La línea va del borde de lo iluminado al de la ventana
  function place(U, onR = []) {
    const win = $('.tut-win'), link = $('.tut-link');
    const W = innerWidth, H = innerHeight, M = 10, top = $('.tut-bar').getBoundingClientRect().bottom + 8;
    const clampv = (v, a, b) => Math.max(a, Math.min(b, v));
    win.style.width = '';
    const base = win.offsetWidth;
    let w = base, h = win.offsetHeight, pos = null;
    if (!U) pos = { x: (W - w) / 2, y: clampv((H - h) / 2, top, H - h - M) };
    else for (const ww of [base, 470, 590]) {
      if (ww !== base) { win.style.width = `${ww}px`; w = win.offsetWidth; h = win.offsetHeight; }
      // lo que no se puede tapar: cada cosa iluminada por separado (entre dos zonas separadas sí cabe la ventana)
      const vis = onR.map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), r: Math.min(W, r.x + r.w), b: Math.min(H, r.y + r.h) }));
      const inside = (q) => q.x >= M && q.y >= top && q.x + w <= W - M && q.y + h <= H - M;
      const cover = (q) => vis.reduce((s, r) => s + Math.max(0, Math.min(q.x + w, r.r) - Math.max(q.x, r.x)) * Math.max(0, Math.min(q.y + h, r.b) - Math.max(q.y, r.y)), 0);
      const cx = (U.x + U.r) / 2, cy = (U.y + U.b) / 2;
      const tries = [];
      for (const G of [34, 14]) tries.push({ x: U.r + G, y: clampv(cy - h / 2, top, H - M - h) }, { x: U.x - G - w, y: clampv(cy - h / 2, top, H - M - h) },
        { x: clampv(cx - w / 2, M, W - M - w), y: U.b + G }, { x: clampv(cx - w / 2, M, W - M - w), y: U.y - G - h });
      pos = tries.find((q) => inside(q) && cover(q) === 0);
      if (!pos) {
        // si no cabe al lado, el sitio de la pantalla que no tape nada y quede más cerca; si ninguno, el que menos tape
        const dist = (q) => Math.hypot(Math.max(0, U.x - (q.x + w), q.x - U.r), Math.max(0, U.y - (q.y + h), q.y - U.b));
        let best = null;
        for (let y = top; y <= H - M - h; y += 16) for (let x = M; x <= W - M - w; x += 16) {
          const q = { x, y }, c = cover(q), d = dist(q);
          if (!best || c < best.c || (c === best.c && d < best.d)) best = { ...q, c, d };
        }
        pos = best && (best.c === 0 || ww === 590) ? best : null;
      }
      if (pos) break;
    }
    if (!pos) { win.style.width = ''; w = base; h = win.offsetHeight; pos = { x: clampv((U.x + U.r) / 2 - w / 2, M, W - M - w), y: top }; }
    // al cambiar de paso, la ventana aparece ya en su sitio (sin deslizarse desde el anterior, que asomaba fuera)
    if (snap) { win.style.transition = 'none'; snap = false; }
    win.style.left = `${Math.round(pos.x)}px`; win.style.top = `${Math.round(pos.y)}px`;
    if (win.style.transition) { void win.offsetWidth; win.style.transition = ''; }
    if (!U) { link.style.display = 'none'; return; }
    const R = { x: pos.x, y: pos.y, r: pos.x + w, b: pos.y + h };
    if (Math.min(R.r, U.r) > Math.max(R.x, U.x) && Math.min(R.b, U.b) > Math.max(R.y, U.y)) { link.style.display = 'none'; return; }
    const wc = { x: (R.x + R.r) / 2, y: (R.y + R.b) / 2 };
    const a = { x: clampv(wc.x, U.x, U.r), y: clampv(wc.y, U.y, U.b) }, b = { x: clampv(a.x, R.x, R.r), y: clampv(a.y, R.y, R.b) };
    link.style.display = '';
    const ln = link.querySelector('line'), dot = link.querySelector('circle');
    ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
    dot.setAttribute('cx', a.x); dot.setAttribute('cy', a.y);
  }

  // ---------- la ventana del Sistema y la barra ----------
  function winContent() {
    const c = E.current(chapters, p);
    if (!c) return '';
    const x = ctx(), st = c.step, val = (f) => (typeof f === 'function' ? f(x, p) : f);
    const n = c.chapter.steps.length, lvl = E.helpLevel(chapters, p, now());
    const prev = p.last && chapters[p.last.ci] && chapters[p.last.ci].steps[p.last.si];
    const after = prev && prev.after ? val(prev.after) : '';
    const dots = c.chapter.steps.map((s, j) => `<i class="${j < c.si ? 'ok' : j === c.si ? 'now' : ''}"></i>`).join('');
    const isGrad = st.kind === 'grad' && grad;
    const zone = isGrad && grad.i < st.zones.length ? st.zones[grad.i] : null;
    const next = BY_ARROW.has(st.kind) && !(isGrad && zone);
    return `<header><b>◆ SISTEMA</b><span class="mono">${c.ci < main ? `cap. ${c.ci + 1}` : 'graduación'} · ${c.si + 1}/${n}</span></header>
      ${c.si === 0 ? `<p class="tut-ch">${c.ci < main ? `Capítulo ${c.ci + 1} · ` : ''}${esc(c.chapter.title)} — <i>${esc(c.chapter.ask)}</i></p>` : ''}
      <h3><em>${c.si + 1}/${n}</em> ${esc(val(st.title))}</h3>
      ${after ? `<div class="tut-after"><b>✓ Hecho.</b> <span>${nums(esc(after))}</span></div>` : ''}
      ${zone ? `<p class="tut-zone"><b>${esc(zone[1])}</b> · ya la conoces</p>` : `<p class="tut-text">${esc(val(st.text))}</p>`}
      ${st.todo ? `<p class="tut-todo">👉 ${esc(val(st.todo))}</p>` : ''}
      ${st.kind === 'ask' ? `<div class="tut-ask">${st.options.map((o) => `<button type="button" data-tut-ans="${esc(o.v)}">${esc(o.label)}</button>`).join('')}</div>` : ''}
      ${st.kind === 'reto' && lvl < 2 ? '<p class="tut-note">Sin ayuda. Si te equivocas dos veces, sale «Hazlo por mí».</p>' : ''}
      ${st.kind === 'do' && lvl === 1 ? '<p class="tut-note">Mira la mano: hace el gesto por ti. Imítala.</p>' : ''}
      <footer><span class="tut-dots">${dots}</span>
        ${lvl >= 2 && st.help ? '<button type="button" class="tut-do" data-tut-act="help" title="Lo hace por ti; mira qué cambia">Hazlo por mí</button>' : ''}
        ${next ? `<button type="button" class="tut-next${st.kind === 'pause' || st.kind === 'grad' ? ' wide' : ''}" data-tut-act="next" aria-label="${st.kind === 'grad' ? 'Acabar el tutorial' : 'Siguiente'}">${st.kind === 'pause' ? 'Seguir con el tutorial ' : st.kind === 'grad' ? 'Empezar ' : ''}→</button>` : ''}</footer>`;
  }
  function barContent() {
    const c = E.current(chapters, p);
    if (!c) return '';
    return `<b class="tut-brand">TUTORIAL</b><span class="tut-where">${c.ci < main ? `cap. ${c.ci + 1} de ${main}` : 'graduación'} · ${esc(c.chapter.title)}</span>
      <span class="tut-chs">${E.bar(chapters, p).map((b, i) => `<button type="button" class="${b.state}" data-tut-goto="${i}" title="${i < main ? `Capítulo ${i + 1}: ` : ''}${esc(b.title)}" aria-label="Ir al ${i < main ? `capítulo ${i + 1}` : 'final'}: ${esc(b.title)}"></button>`).join('')}</span>
      <button type="button" data-tut-act="skipch" title="Salta este capítulo (lo que necesita el siguiente, lo pone el Sistema)">Ya sé esto</button>
      <button type="button" data-tut-act="skip" title="Enciende todo el editor; la Guía te devuelve aquí">Saltar tutorial</button>`;
  }
  function render(fresh = false) {
    const html = winContent();
    if (html !== winHTML || fresh) {
      winHTML = html;
      const win = $('.tut-win');
      win.innerHTML = html;
      $('.tut-bar').innerHTML = barContent();
      if (fresh) {
        lines(win.querySelector('.tut-text'));
        countUp(win.querySelector('.tut-after'));
        const b = win.querySelector('.tut-next');
        if (b) b.focus({ preventScroll: true });
      }
      sig = '';
    }
    handNow();
  }

  // ---------- la mano fantasma ----------
  function handNow() {
    const c = E.current(chapters, p);
    const lvl = c ? E.helpLevel(chapters, p, now()) : 0;
    const g = c && c.step.gesture, x = ctx(), val = (f) => (typeof f === 'function' ? f(x, p) : f);
    let from = null, to = null, kind = 'clic';
    if (g && lvl >= 1) {
      const at = val(g.at), fr = val(g.from), tt = val(g.to);
      if (fr) { from = pointOf(resolve(fr)[0]); kind = 'drag'; to = tt && typeof tt === 'object' ? (from && { x: from.x + tt.dx, y: from.y + tt.dy }) : pointOf(resolve(tt)[0]); }
      else if (at) { from = pointOf(resolve(at)[0]); kind = g.name === 'pasar' ? 'hover' : 'clic'; }
    }
    const s = from ? `${kind}|${Math.round(from.x / 4)},${Math.round(from.y / 4)}|${to ? `${Math.round(to.x / 4)},${Math.round(to.y / 4)}` : ''}` : '';
    if (s === ghostSig) return;
    ghostSig = s;
    if (stopGhost) { stopGhost(); stopGhost = null; }
    ghostTok = null;
    if (!from) { $('.tut-hand').hidden = true; return; }
    const tok = {}; ghostTok = tok;
    ghost($('.tut-hand'), { kind: kind === 'drag' && to ? 'drag' : kind, from, to }).then((stop) => { if (ghostTok === tok) stopGhost = stop; else stop(); });
  }

  // ---------- avanzar ----------
  async function commit(q, before) {
    p = q;
    if (q !== before) save(q);
    if (!q.on) { off(); finish(q.finished ? 'done' : 'skip'); onChange(); return; }
    // al entrar en un capítulo, el Sistema pone lo que necesita (si empiezas en él o lo saltas); después, el cambio del reto
    let ensured = before && before.on ? before.ci : -1;
    for (let guard = 0; guard < 12 && p.on && p.ci !== ensured; guard++) {
      ensured = p.ci;
      busy = true;
      try { await ensure(p.ci); } finally { busy = false; }
      p = E.advance(chapters, p, 'check', { ctx: ctx(), now: now() });
    }
    const c = E.current(chapters, p);
    if (c && c.step.setup && !p.setup.includes(E.stepId(chapters, p))) {
      busy = true;
      try { await setup(c.step.setup); } finally { busy = false; }
      p = E.advance(chapters, p, 'setup', { ctx: ctx(), now: now() });
    }
    save(p);
    if (!p.on) { off(); finish(p.finished ? 'done' : 'skip'); onChange(); return; }
    stepChanged();
  }
  function stepChanged() {
    const id = E.stepId(chapters, p);
    if (id === lastId) { render(); return; }
    const hadDone = p.last && lastId;
    lastId = id; lastLevel = -1;
    const c = E.current(chapters, p);
    grad = null;
    if (c.step.kind === 'grad') startGrad(c.step);
    if (hadDone && lastU) burst((lastU.x + lastU.r) / 2, (lastU.y + lastU.b) / 2);
    scrollTargets();
    layer.hidden = !visible();
    snap = true;
    render(true);
    if (!layer.hidden) draw();
    onChange();
  }
  function startGrad(step) {
    grad = { i: 0 };
    const tick = () => { if (!grad || !on()) return; grad.i += 1; render(); if (grad.i < step.zones.length) grad.t = setTimeout(tick, 1500); };
    if (document.body.classList.contains('reduce') || matchMedia('(prefers-reduced-motion: reduce)').matches) grad.i = step.zones.length;
    else grad.t = setTimeout(tick, 1500);
  }
  // lo que toca se trae a la vista dentro de su zona con desplazamiento (el raíl, el lienzo, el banco, el panel)
  function scrollTargets() {
    const x = ctx(), L = lightsNow(x), groups = new Map();
    for (const el of L.on.flatMap(resolve)) {
      const box = el.parentElement && el.parentElement.closest(clip);
      if (box) groups.set(box, [...(groups.get(box) || []), el]);
    }
    for (const [box, els] of groups) {
      const b = box.getBoundingClientRect(), rs = els.map((e) => e.getBoundingClientRect());
      let t = Math.min(...rs.map((r) => r.top)), bt = Math.max(...rs.map((r) => r.bottom));
      if (bt - t > b.height - 16) { t = rs[0].top; bt = rs[0].bottom; }
      if (bt > b.bottom - 8) box.scrollTop += bt - b.bottom + Math.min(40, (b.height - (bt - t)) / 2);
      else if (t < b.top + 8) box.scrollTop -= b.top - t + Math.min(40, (b.height - (bt - t)) / 2);
    }
  }
  async function go(event, value) {
    if (!p || busy) return;
    const before = p;
    const q = E.advance(chapters, p, event, { ctx: ctx(), now: now(), value });
    if (q !== before) await commit(q, before);
    else render(); // el mismo paso, pero su 👉 puede depender del estado (p. ej., «ahora pulsa Crear red»)
  }
  function off() {
    layer.hidden = true; grad = null;
    if (stopGhost) { stopGhost(); stopGhost = null; }
    ghostTok = null; ghostSig = ''; lastId = null; litEls = [];
  }

  // ---------- el bucle: posiciones (cada 3 fotogramas) y ayuda (cada medio segundo) ----------
  const loop = () => {
    requestAnimationFrame(loop);
    if (!on()) return;
    const vis = visible();
    if (layer.hidden === vis) { layer.hidden = !vis; sig = ''; }
    if (!vis || (frame++ % 3)) return;
    draw();
  };
  requestAnimationFrame(loop);
  setInterval(() => {
    if (!on() || busy || !visible()) return;
    const q = E.advance(chapters, p, 'check', { ctx: ctx(), now: now() });
    if (q !== p) { commit(q, p); return; }
    const lvl = E.helpLevel(chapters, p, now());
    if (lvl !== lastLevel) { lastLevel = lvl; render(); } else handNow();
  }, 500);

  // ---------- solo responde lo iluminado ----------
  const inLayer = (t) => !!(t && t.nodeType === 1 && layer.contains(t));
  const inLit = (t) => litEls.some((e) => e === t || e.contains(t));
  function guard(ev) {
    if (!on() || !visible()) return;
    const t = ev.target;
    if (inLayer(t) || inLit(t) || allowed(t)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.type === 'pointerdown') {
      p = E.advance(chapters, p, 'miss');
      const win = $('.tut-win');
      win.classList.remove('nudge'); void win.offsetWidth; win.classList.add('nudge');
      render();
    }
  }
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'auxclick']) window.addEventListener(type, guard, true);
  window.addEventListener('keydown', (ev) => {
    if (!on() || !visible()) return;
    const t = ev.target, c = E.current(chapters, p), mod = ev.ctrlKey || ev.metaKey;
    const combo = [mod && 'ctrl', ev.altKey && 'alt', ev.key.toLowerCase()].filter(Boolean).join('+');
    if (c && (c.step.keys || []).includes(combo)) return;
    if (inLayer(t)) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(t.tagName || '');
    if ((inLit(t) || allowed(t)) && (typing || !mod)) return;
    if (['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.key === 'Enter' && c && BY_ARROW.has(c.step.kind)) go('next');
  }, true);

  // ---------- los botones de la ventana y de la barra ----------
  layer.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b || !p) return;
    if (b.dataset.tutAns !== undefined) { const x = ctx(); await go('answer', { v: b.dataset.tutAns, pick: x.pick || null }); return; }
    if (b.dataset.tutGoto !== undefined) { await go('goto', Number(b.dataset.tutGoto)); return; }
    const act = b.dataset.tutAct;
    if (act === 'next') await go('next');
    else if (act === 'skipch') await go('skipChapter');
    else if (act === 'skip') await go('skipAll');
    else if (act === 'help') {
      const c = E.current(chapters, p);
      if (!c || !c.step.help || busy) return;
      busy = true;
      try { await help(c.step.help, c.step); } finally { busy = false; }
      await go('check');
    }
  });
  addEventListener('resize', () => { sig = ''; });

  // para los sondeos con ratón real (tools/sondeo-tutorial.mjs): qué paso toca, dónde está lo iluminado y la ventana, y
  // dónde haría el gesto la mano (aunque aún no se vea). Solo lee
  function info() {
    const c = E.current(chapters, p);
    if (!c) return { on: false, finished: !!(p && p.finished), skipped: !!(p && p.skipped) };
    const x = ctx(), val = (f) => (typeof f === 'function' ? f(x, p) : f), g = c.step.gesture || {};
    const L = lightsNow(x), fr = val(g.from), tt = val(g.to), at = val(g.at);
    const from = pointOf(resolve(fr || at)[0]);
    const to = fr ? (tt && typeof tt === 'object' ? from && { x: from.x + tt.dx, y: from.y + tt.dy } : pointOf(resolve(tt)[0])) : null;
    const box = (e) => {
      const r = e.getBoundingClientRect(), z = clip && e.parentElement ? e.parentElement.closest(clip) : null, b = z ? z.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const cut = r.left < Math.max(0, b.left) - 1 || r.top < Math.max(0, b.top) - 1 || r.right > Math.min(innerWidth, b.right) + 1 || r.bottom > Math.min(innerHeight, b.bottom) + 1;
      return { x: r.left, y: r.top, w: r.width, h: r.height, cut };
    };
    return { on: true, id: E.stepId(chapters, p), kind: c.step.kind, level: E.helpLevel(chapters, p, now()), misses: p.misses, busy,
      lit: L.on.flatMap(resolve).map(box), look: L.look, room: c.step.room ? resolve(val(c.step.room)).map(box) : null, win: box($('.tut-win')), gesture: { name: g.name || null, from, to }, keys: c.step.keys || [], hidden: layer.hidden };
  }
  window.gwTut = { info };

  return {
    active: on,
    update() { if (on() && !busy) go('check'); },
    async start(at = 0) { await commit(E.start(chapters, { at, ctx: ctx(), now: now(), path: (ctx() || {}).path || null }), null); },
    async resume(saved = null) { const base = saved || p; if (!base) return; await commit(E.advance(chapters, base, 'resume', { ctx: ctx(), now: now() }), null); },
    set(data) { if (!p) return; p = E.advance(chapters, p, 'set', { value: data }); save(p); },
    get progress() { return p; },
  };
}
