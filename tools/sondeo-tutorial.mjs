// Sondeo (sesión 13): el tutorial de Crear entero con ratón y teclado de verdad (relevo s12 §4.4). W=1920 H=1080 para
// 1920. Uso: node tools/sondeo.mjs tools/sondeo-tutorial.mjs   (SP=<carpeta> guarda una captura por paso; START=<capítulo>
// empieza en ese capítulo; REDUCE=1 con «reducir movimiento»; VERBOSE=1 enseña también los ✔ y el texto de cada paso)
// En cada paso: la ventana cabe en pantalla; lo iluminado se ve entero y la ventana no lo tapa; se hace el gesto con el
// ratón (clic, arrastre, quedarse encima) o el teclado. Además: la ayuda con 2 y 4 clics fuera (mano fantasma y luego
// «Hazlo por mí»), que lo oscuro no responde, «Ya sé esto», «Saltar tutorial» y la Guía, y al final que ningún control
// visible del editor quede fuera de una zona presentada. Cada comprobación imprime ✔ o ✘; al final, el total.
import { mk } from './raton.mjs';
import { CHAPTERS } from '../public/js/game/tutorial/crear.js';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);
const PRESENTED = [...new Set(CHAPTERS.flatMap((c) => c.steps.flatMap((s) => s.present || [])))];

export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx; const u = mk(ctx);
  let bad = 0, n = 0;
  const ok = (cond, what, extra = '') => { n++; if (!cond) bad++; if (!cond || process.env.VERBOSE) console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`); };
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // REDUCE=1: con «reducir movimiento» (la mano queda quieta señalando; la graduación no barre)
  if (process.env.REDUCE) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  // START=<capítulo> empieza ahí (para repetir un trozo); el Sistema pone lo que ese capítulo necesita
  const at = process.env.START ? CHAPTERS.findIndex((c) => c.key === process.env.START) : -1;
  if (at > 0) await api('/api/worlds/1/meta', 'PUT', { tutorial: { crear: { v: 1, on: true, finished: false, skipped: false, path: 'cero', done: CHAPTERS.slice(0, at).map((c) => c.key), answers: {}, setup: [], data: {}, last: null, ci: at, si: 0, t0: 0, misses: 0, base: { ev: {} } } } });
  await load('/#crear', 4500);
  const info = async () => JSON.parse(await ev('JSON.stringify(window.gwTut ? window.gwTut.info() : null)') || 'null');
  const text = () => ev(`(document.querySelector('.tut-win') || {}).innerText || ''`);
  const snap = async (name) => { if (process.env.SP) await shot(`${process.env.SP}/tut${W}-${name.replace(/\//g, '_')}.png`); };
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
  const typeInto = async (pt, value) => { await u.clickAt(pt.x, pt.y); await sleep(120); await u.key('a', 2); await send('Input.insertText', { text: String(value) }); await sleep(80); await u.key('Tab', 0, 'Tab'); await sleep(250); };
  // un sitio oscuro donde hacer clic «fuera»: la esquina de abajo a la izquierda (el pie del raíl)
  const darkPt = { x: 60, y: H - 20 };

  console.log(`\n== tutorial a ${W} × ${H}`);
  let i = await waitFor(info);
  ok(i && i.on && !i.hidden, at > 0 ? `empieza en el capítulo «${process.env.START}»` : 'un mundo nuevo empieza el tutorial solo, con la capa a la vista', i && i.id);

  // comprobaciones de la ventana y de lo iluminado en el paso de ahora
  const checkStep = async (s0) => {
    let s = s0;
    const fits = (q) => q.win.x >= 0 && q.win.y >= 0 && q.win.x + q.win.w <= W + 0.5 && q.win.y + q.win.h <= H + 0.5;
    const covers = (q) => (q.room || q.lit).some((r) => overlap(r, q.win) >= 25);
    if (!fits(s) || covers(s)) { await sleep(1500); const s2 = await info(); console.log(`   (ventana fuera a los 0,7 s: ${JSON.stringify(s.win)}; a los 2,2 s: ${JSON.stringify(s2.win)})`); s = s2; }
    ok(s.win.x >= 0 && s.win.y >= 0 && s.win.x + s.win.w <= W + 0.5 && s.win.y + s.win.h <= H + 0.5, `[${s.id}] la ventana del Sistema cabe en pantalla`, `${Math.round(s.win.x)},${Math.round(s.win.y)} ${Math.round(s.win.w)}×${Math.round(s.win.h)}`);
    for (const r of s.lit) ok(!r.cut, `[${s.id}] lo iluminado se ve entero`, `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`);
    // en una zona grande (el lienzo), lo que no se puede tapar son sus tarjetas (room); si no, lo iluminado entero
    for (const r of s.room || s.lit) ok(overlap(r, s.win) < 25, `[${s.id}] la ventana no tapa ${s.room ? 'las tarjetas de lo iluminado' : 'lo iluminado'}`, `${Math.round(overlap(r, s.win))} px² tapados`);
    if (['do', 'reto'].includes(s.kind) && !s.look) ok(s.lit.length > 0, `[${s.id}] hay algo iluminado donde actuar`);
  };
  // el gesto de este paso, con el ratón o el teclado (varias veces si tiene partes: «Desde cero» y luego «Crear red»)
  const act = async (s) => {
    const g = s.gesture;
    if (['show', 'pause'].includes(s.kind)) { await u.click('.tut-next', '→'); return; }
    if (s.kind === 'grad') { await waitFor(() => ev(`!!document.querySelector('.tut-next')`), 15000); await u.click('.tut-next', 'Empezar'); return; }
    if (s.kind === 'ask') { await u.click('.tut-ask button', 'primera respuesta'); return; }
    if (await ev(`!!document.querySelector('.ed-modal:not([hidden]) [data-modal="restore"]')`)) { await u.click('.ed-modal [data-modal="restore"]', 'Volver a la versión'); return; }
    if (s.id.startsWith('caracter/gen-') && await ev(`(document.querySelector('.genes')||{}).isConnected && document.querySelector('[data-genes][aria-selected="true"]')?.dataset.genes === ${JSON.stringify(s.id.split('gen-')[1])}`)) {
      const sel = await ev(`(()=>{const e=document.querySelector('.genes select, .genes input.numin'); if(!e) return null; e.scrollIntoView({block:'nearest'}); const l=e.tagName==='SELECT'? document.querySelector('label[for="'+e.id+'"]') : e; const r=l.getBoundingClientRect(); return {tag:e.tagName, x:r.x+r.width/2, y:r.y+r.height/2, v:e.value}})()`);
      if (sel && sel.tag === 'SELECT') { await u.clickAt(sel.x, sel.y); await sleep(150); await u.key('ArrowDown', 0, 'ArrowDown'); await sleep(300); }
      else if (sel) await typeInto(sel, Math.round((Number(sel.v) + 0.5) * 100) / 100);
      return;
    }
    if (!g.from) { console.log(`   (sin punto para el gesto en ${s.id})`); return; }
    if (g.name === 'numero') { const v = await ev(`(document.elementFromPoint(${g.from.x}, ${g.from.y}) || {}).value`); await typeInto(g.from, s.id.endsWith('neuronas') ? 64 : Number(v || 0) + 1); return; }
    if (g.name === 'pasar' || (g.name === 'capa' && !(await ev(`!!document.querySelector('#edWireTools:not([hidden])')`)) && !(await ev(`!!document.querySelector('#edInsert')`)))) {
      await u.mouse('mouseMoved', g.from.x, g.from.y, 0); await sleep(900); return;
    }
    if (g.to) { await u.dragXY(g.from.x, g.from.y, g.to.x, g.to.y); return; }
    await u.clickAt(g.from.x, g.from.y);
  };

  const seen = new Set();
  let helpTested = false, blockTested = false;
  for (let guard = 0; guard < 140; guard++) {
    i = await info();
    if (!i || !i.on) break;
    if (!seen.has(i.id)) {
      seen.add(i.id);
      await sleep(700); i = await info();
      await checkStep(i); await snap(i.id);
      if (process.env.VERBOSE) console.log(`   [${i.id}] ${(await text()).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    // lo oscuro no responde: la pestaña «Tus redes» no cambia de vista y cuenta como fallo
    if (!blockTested && i.id === 'ver/lienzo') {
      blockTested = true;
      // la pestaña «Tus redes» si la ventana no la tapa; si no, la de Genes del panel (también a oscuras)
      const target = (await u.cover('[data-tut="tab-redes"]')) === 'ok' ? '[data-tut="tab-redes"]' : '[data-tut="tab-genes"]';
      const tab = await u.rect(target), h0 = await ev('location.hash'), g0 = await ev(`document.querySelector('[data-tut="tab-genes"]')?.getAttribute('aria-selected')`);
      await u.clickAt(tab.x + tab.w / 2, tab.y + tab.h / 2); await sleep(400);
      ok(await ev('location.hash') === h0 && await ev(`document.querySelector('[data-tut="tab-genes"]')?.getAttribute('aria-selected')`) === g0, `un clic en lo oscuro (${target}) no hace nada`, await ev('location.hash'));
      const mi = (await info()).misses;
      ok(mi === 1, 'y cuenta como un fallo', `fallos: ${mi}`);
      await u.key('z', 2); await sleep(200);
      ok((await info()).id === 'ver/lienzo', 'Ctrl+Z fuera de su paso no hace nada');
    }
    // escalón de ayuda en un paso que repite gesto: 2 clics fuera → mano; 4 → «Hazlo por mí», que lo cumple
    if (!helpTested && i.id === 'ver/elegir') {
      helpTested = true;
      ok(i.level === 0, 'al llegar a un gesto ya visto, sin ayuda', `nivel ${i.level}`);
      for (let k = 0; k < 2; k++) { await u.clickAt(darkPt.x, darkPt.y); await sleep(150); }
      await sleep(700);
      ok((await info()).level === 1 && await ev(`!document.querySelector('.tut-hand').hidden`), 'con 2 clics fuera sale la mano fantasma');
      for (let k = 0; k < 2; k++) { await u.clickAt(darkPt.x, darkPt.y); await sleep(150); }
      await sleep(700);
      ok(await u.cover('.tut-do') === 'ok', 'con 4, «Hazlo por mí» (y se puede pulsar)', await u.cover('.tut-do'));
      await u.click('.tut-do', 'Hazlo por mí'); await sleep(1400);
      ok((await info()).id !== 'ver/elegir' && await ev(`[...document.querySelectorAll('#edBoard [data-node]')].some(e=>e.getAttribute('aria-label').startsWith('Elegir'))`), '«Hazlo por mí» añade Elegir y pasa al paso siguiente');
      continue;
    }
    // la pausa: «Probar ya» responde (está iluminado), su panel se ilumina y se puede cerrar
    if (i.id === 'banco/pausa' && !seen.has('pausa-probada')) {
      seen.add('pausa-probada');
      await u.click('[data-act="probe"]', 'Probar ya'); await sleep(1500);
      const pi = await info();
      ok(await ev(`!document.getElementById('edProbe').hidden`), 'en la pausa, «Probar ya» abre su panel');
      ok(pi.lit.length >= 2 && await u.cover('[data-act="probe-close"]') === 'ok', 'y el panel se ilumina y se puede cerrar', await u.cover('[data-act="probe-close"]'));
      await u.click('[data-act="probe-close"]', 'cerrar Probar ya'); await sleep(700);
      continue;
    }
    const before = i.id;
    await act(i);
    const moved = await waitFor(async () => { const x = await info(); return x && (!x.on || x.id !== before) ? x : null; }, 3500);
    if (!moved) {
      const again = await info();
      if (again && again.id === before && (again.misses || 0) > 3) { ok(false, `[${before}] no avanza con el gesto`, (await text()).replace(/\s+/g, ' ').slice(0, 200)); break; }
    }
  }
  i = await info();
  ok(i && i.finished, 'el recorrido llega al final', i && (i.id || JSON.stringify(i)));
  ok(await ev(`document.querySelector('.tut-layer').hidden`), 'al acabar, la penumbra se va');
  const all = CHAPTERS.flatMap((c) => c.steps.map((s) => `${c.key}/${s.key}`));
  const missed = all.filter((k) => !seen.has(k));
  if (at <= 0) ok(missed.every((k) => k === 'recordar/rasgos'), 'pasó por todos los pasos (menos «Añade Rasgos», que ya estaba por el reto 2)', missed.join(', '));
  const t = await ev(`(document.getElementById('toast')||{}).textContent||''`);
  ok(/Tutorial acabado/.test(t), 'el aviso dice que ha acabado', t.slice(0, 80));
  const meta = (await api('/api/worlds/1/meta')).body;
  ok(meta.tutorial && meta.tutorial.crear && meta.tutorial.crear.finished, 'el avance queda guardado en el mundo (acabado)');
  ok(await ev(`!document.querySelector('.ed-status')?.classList.contains('bad')`), 'la red del tutorial queda sin errores', await ev(`document.querySelector('.ed-status')?.innerText`));

  // al final, ningún control visible del editor fuera de una zona presentada
  const loose = await ev(`(()=>{const P=new Set(${JSON.stringify(PRESENTED)}); const roots=[document.querySelector('[data-view="crear/editor"]'), document.getElementById('stageSlot'), document.querySelector('.g-tabs')].filter(Boolean);
    const out=[]; for(const R of roots) for(const e of R.querySelectorAll('button, input, select, a, [tabindex]')){ const r=e.getBoundingClientRect(); if(!r.width||!r.height||e.closest('[hidden]')) continue;
      let ok=false; for(let a=e; a && a!==document.body; a=a.parentElement){ const k=(a.dataset&&a.dataset.tut)||''; if(k.split(' ').some(x=>P.has(x))){ok=true;break;} }
      if(!ok) out.push(e.tagName+(e.dataset.act?'['+e.dataset.act+']':'')+' '+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,30)); }
    return out})()`);
  ok(loose.length === 0, 'ningún control visible del editor queda fuera de una zona presentada', loose.join(' | '));

  // la Guía vuelve a empezar; «Ya sé esto» salta el capítulo; «Saltar tutorial» apaga todo y la Guía te devuelve ahí
  await u.click('[data-act="guide"]', 'Guía'); await sleep(1200);
  i = await info();
  ok(i && i.on && i.id === 'ver/hola', 'acabado, la Guía empieza otra vez desde el principio', i && i.id);
  await u.click('[data-tut-act="skipch"]', 'Ya sé esto'); await sleep(1500);
  i = await info();
  ok(i && i.id.startsWith('enchufar/'), '«Ya sé esto» salta al capítulo 2', i && i.id);
  await u.click('[data-tut-act="skip"]', 'Saltar tutorial'); await sleep(900);
  i = await info();
  ok(i && !i.on && await ev(`document.querySelector('.tut-layer').hidden`), '«Saltar tutorial» enciende todo el editor');
  ok(/saltado/.test(await ev(`(document.getElementById('toast')||{}).textContent||''`)), 'y avisa de qué te pierdes y dónde volver');
  const node = await u.rect('#edBoard [data-node]');
  if (node) { await u.clickAt(node.x + node.w / 2, node.y + node.h / 2); await sleep(400); ok(await ev(`!!document.querySelector('#edBoard [data-node].sel')`), 'sin tutorial, el editor responde otra vez (elegir una tarjeta)'); }
  await u.click('[data-act="guide"]', 'Guía'); await sleep(1200);
  i = await info();
  ok(i && i.on && i.id.startsWith('enchufar/'), 'la Guía te devuelve al capítulo en que estabas', i && i.id);

  // una recarga a mitad retoma el tutorial en su capítulo
  await sleep(600);
  await load('/#crear', 4500);
  i = await waitFor(info);
  ok(i && i.on && i.id.startsWith('enchufar/'), 'al recargar, sigue en su capítulo', i && i.id);
  console.log(`\n${bad ? `✘ ${bad} de ${n} comprobaciones fallan` : `✔ las ${n} comprobaciones`}`);
};
