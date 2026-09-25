// Sondeo (sesión 14): la moviola en el mismo sitio con ratón de verdad, dentro de la pausa del capítulo 4 del tutorial
// («Tu red ya juega»): se juega el duelo entero de Probar ya y, al acabar, se ve otra vez cada partida (▶, pausa a mitad de
// curva, ⏭, ⏮, deslizador, velocidad). También comprueba, con el módulo de la página, que las curvas rehechas de las 6
// partidas guardadas cuadran con lo que pasó. PLAIN=1: sin tutorial (una red de plantilla). W=1920 H=1080 para 1920.
// Uso: node tools/sondeo.mjs tools/sondeo-moviola.mjs   (SP=<carpeta> guarda capturas; VERBOSE=1 enseña también los ✔)
import { mk } from './raton.mjs';
import { CHAPTERS } from '../public/js/game/tutorial/crear.js';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);

export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx; const u = mk(ctx);
  let bad = 0, n = 0;
  const ok = (cond, what, extra = '') => { n++; if (!cond) bad++; if (!cond || process.env.VERBOSE) console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`); };
  const snap = async (name) => { if (process.env.SP) await shot(`${process.env.SP}/mv${W}-${name}.png`); };
  const waitFor = async (fn, ms = 5000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
  const txt = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const tut = async () => JSON.parse(await ev('JSON.stringify(window.gwTut ? window.gwTut.info() : null)') || 'null');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  console.log(`\n== moviola a ${W} × ${H}${process.env.PLAIN ? ' (sin tutorial)' : ' (en la pausa del tutorial)'}`);

  if (process.env.PLAIN) {
    const a = await api('/api/lab/nets', 'POST', { template: 'turtle', name: 'Tortu' });
    await load('/#crear/' + (a.body?.net?.id || a.body?.id), 3500);
  } else {
    const ci = CHAPTERS.findIndex((c) => c.key === 'banco'), si = CHAPTERS[ci].steps.findIndex((s) => s.key === 'pausa');
    await api('/api/worlds/1/meta', 'PUT', { tutorial: { crear: { v: 1, on: true, finished: false, skipped: false, path: 'cero', done: CHAPTERS.slice(0, ci).map((c) => c.key), answers: {}, setup: [], data: {}, last: null, ci, si, t0: 0, misses: 0, base: { ev: {} } } } });
    await load('/#crear', 4500);
    const i = await waitFor(tut);
    ok(i && i.on && i.id === 'banco/pausa', 'el tutorial está en la pausa del capítulo 4', i && i.id);
    ok(await u.cover('[data-act="probe"]') === 'ok', '«Probar ya» se ve y responde', await u.cover('[data-act="probe"]'));
  }

  // 1. Probar ya: el duelo entero (6 partidas a x10)
  await u.click('[data-act="probe"]', 'Probar ya'); await sleep(1500);
  const go = (await ev(`!!document.querySelector('[data-act="probe-save-go"]')`)) ? '[data-act="probe-save-go"]' : '[data-act="probe-go"]';
  ok(await u.cover(go) === 'ok', `«${go.includes('save') ? 'Guardar y probar' : 'Empezar'}» se ve y responde`, await u.cover(go));
  await u.click(go, 'Empezar'); const t0 = Date.now();
  const mid = await waitFor(async () => /\d\/6 partidas/.test(await txt('#prScore')) && (await txt('#prFn')).includes('='), 60000, 500);
  ok(!!mid, 'el duelo se ve en directo en el plano del panel', await txt('#prScore'));
  await snap('directo');
  if (!process.env.PLAIN) { const i = await tut(); ok(i && i.on && i.id === 'banco/pausa' && !i.misses, 'durante el duelo el tutorial sigue en la pausa, sin fallos', i && `${i.id} · fallos ${i.misses}`); }
  const ended = await waitFor(() => ev(`!!document.querySelector('#prEnd .mv-bar')`), 8 * 60000, 1000);
  ok(!!ended, 'el duelo acaba y sale «Ver otra vez»', `${Math.round((Date.now() - t0) / 1000)} s`);
  if (!ended) { console.log(`\n✘ ${bad + 1} de ${n} (sin duelo acabado no se sigue)`); return; }
  await sleep(600); await snap('acabado');

  // 2. las 6 partidas, a la vista y sin tapar
  const chips = await ev(`[...document.querySelectorAll('.mv-game')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())`);
  ok(chips.length === 6, 'seis partidas para elegir', chips.join(' | '));
  for (let k = 0; k < 6; k++) ok(await u.cover(`.mv-game[data-k="${k}"]`) === 'ok', `la partida ${k + 1} se ve entera y responde`, await u.cover(`.mv-game[data-k="${k}"]`));
  ok(/Elige una partida/.test(await txt('#mvCtl')), 'dice qué hacer antes de elegir', (await txt('#mvCtl')).slice(0, 90));
  const cv = await u.rect('#prCanvas');
  ok(cv && cv.h >= 260 && cv.y >= 0 && cv.y + cv.h <= H, 'el plano sigue teniendo sitio (≥ 260 px de alto)', cv && `${Math.round(cv.w)}×${Math.round(cv.h)}`);

  // 3. cada curva de las 6 partidas, rehecha en el servidor (?solo=jugadas), cuadra con lo que pasó, y la partida pesa poco
  const exact = await ev(`(async()=>{const {replay}=await import('/shared/moviola.js'); const d=(await (await fetch('/api/lab/duels')).json()).duels.find(x=>x.status!=='running'&&x.games.length===6);
    const out=[]; for(const [k,g] of d.games.entries()){ const t=await (await fetch('/api/lab/games/'+g.gameId+'?solo=jugadas')).text(); const rp=replay(JSON.parse(t));
      const o={ok:rp.ok,approx:rp.approx,n:rp.frames.length,bad:rp.frames.filter(f=>!f.exact).map(f=>f.i).join(' '),kb:Math.round(t.length/1024)};
      if(k===0) o.fullKb=Math.round((await (await fetch('/api/lab/games/'+g.gameId)).text()).length/1024);
      out.push(o); } return out})()`);
  ok(Array.isArray(exact) && exact.every((g) => g.ok && !g.approx && g.n > 0 && !g.bad), 'las curvas de las 6 partidas (rehechas en el servidor) cuadran con lo que pasó', JSON.stringify(exact));
  ok(Array.isArray(exact) && exact.every((g) => g.kb < 900), 'la moviola pide la partida ligera', exact && `${exact.map((g) => g.kb).join(', ')} kB (la completa: ${exact[0].fullKb} kB)`);

  // 4. ver la partida 2: se carga y se reproduce sola
  await u.click('.mv-game[data-k="1"]', 'partida 2');
  const playing = await waitFor(async () => /Pausa/.test(await txt('.mv-play')), 6000);
  ok(!!playing, 'al elegir la partida 2, se reproduce sola', await txt('#mvCtl'));
  ok(await ev(`document.querySelector('.mv-game[data-k="1"]').getAttribute('aria-pressed')`) === 'true', 'y queda marcada');
  ok(/Partida 2 de 6 .* tu red: .*(azul|naranja)/.test(await txt('#prScore')), 'el marcador dice qué partida es y de qué color es tu red', await txt('#prScore'));
  const tracing = await waitFor(async () => /trazando/.test(await txt('#prFn')), 8000, 100);
  ok(!!tracing, 'se ve la función del tiro mientras se traza', (await txt('#prFn')).slice(0, 90));
  await snap('reproduce');

  // 5. pausa a mitad de curva: no avanza; «Seguir» la acaba
  await u.click('.mv-play', 'Pausa');
  const at1 = await txt('.mv-n'), f1 = await txt('#prFn'); await sleep(1500);
  ok(/Seguir/.test(await txt('.mv-play')), 'pausa: el botón pasa a «▶ Seguir»', await txt('.mv-play'));
  ok(await txt('.mv-n') === at1 && await txt('#prFn') === f1, 'en pausa nada avanza (ni a mitad de curva)', `${at1} · ${f1.slice(0, 60)}`);
  // 6. ⏭ acaba el tiro de golpe y dice qué pasó; otro ⏭ traza el siguiente y se para
  await u.click('[data-act="mv-step"]', '⏭');
  const res = await waitFor(async () => !/trazando/.test(await txt('#prFn')) && /(acierta|bajas|aliado|roca|plano|explota|vertical|recorrido)/.test(await txt('#prFn')), 3000, 100);
  ok(!!res, '⏭ acaba el tiro y dice qué pasó y adónde se movió', (await txt('#prFn')).slice(0, 120));
  const nBefore = await txt('.mv-n');
  await u.click('[data-act="mv-step"]', '⏭');
  const stepped = await waitFor(async () => await txt('.mv-n') !== nBefore && !/trazando/.test(await txt('#prFn')), 15000, 100);
  ok(!!stepped && /Seguir/.test(await txt('.mv-play')), 'otro ⏭ traza el tiro siguiente y se para', `${nBefore} → ${await txt('.mv-n')}`);
  // 7. ⏮ quita el último tiro
  const nb = await txt('.mv-n');
  await u.click('[data-act="mv-back"]', '⏮'); await sleep(400);
  const num = (s) => Number((/tiro (\d+)/.exec(s) || [])[1]);
  ok(num(await txt('.mv-n')) === num(nb) - 1, '⏮ vuelve un tiro atrás', `${nb} → ${await txt('.mv-n')}`);
  // 8. el deslizador, arrastrado con el ratón hasta el final
  const r = await u.rect('[data-mv-at]');
  await u.dragXY(r.x + 4, r.y + r.h / 2, r.x + r.w + 30, r.y + r.h / 2); await sleep(500);
  const all = /tiro (\d+) de (\d+)/.exec(await txt('.mv-n'));
  ok(all && all[1] === all[2], 'el deslizador lleva al último tiro', await txt('.mv-n'));
  ok(/Desde el principio/.test(await txt('.mv-play')), 'y el botón ofrece verla desde el principio', await txt('.mv-play'));
  await snap('final');
  // 9. velocidad x10 y verla entera sin que nada «no cuadre»
  await u.click('[data-act="mv-speed"][data-v="10"]', 'x10');
  ok(await ev(`document.querySelector('[data-act="mv-speed"][data-v="10"]').getAttribute('aria-pressed')`) === 'true', 'x10 queda marcado');
  await u.click('.mv-play', 'Desde el principio');
  ok(!!await waitFor(async () => /Pausa/.test(await txt('.mv-play')), 3000, 100), '«Desde el principio» la reproduce otra vez');
  let warn = false;
  const done = await waitFor(async () => { if (/no cuadra/.test(await txt('#prFn'))) warn = true; return /Desde el principio/.test(await txt('.mv-play')); }, 180000, 250);
  ok(!!done && !warn, 'a x10 se ve entera, sin ningún «no cuadra»', await txt('.mv-n'));
  // 10. los mandos se ven enteros y ningún control de la moviola queda tapado (también por la ventana del Sistema)
  for (const sel of ['[data-act="mv-back"]', '.mv-play', '[data-act="mv-step"]', '[data-mv-at]', '[data-act="mv-speed"][data-v="0.5"]', '[data-act="probe-again"]', '[data-act="probe-close"]']) ok(await u.cover(sel) === 'ok', `${sel} se ve y responde`, await u.cover(sel));
  // 11. otra partida mientras se reproduce: cambia limpio
  await u.click('.mv-game[data-k="4"]', 'partida 5');
  ok(!!await waitFor(async () => /Partida 5 de 6/.test(await txt('#prScore')), 5000), 'cambiar a la partida 5 a mitad de otra funciona', await txt('#prScore'));
  // 12. cerrar el panel y, en el tutorial, seguir
  await u.click('[data-act="probe-close"]', 'cerrar'); await sleep(700);
  ok(await ev(`document.getElementById('edProbe').hidden`), 'el ✕ cierra el panel');
  if (!process.env.PLAIN) {
    await snap('cerrado');
    ok(await u.cover('.tut-next') === 'ok', '«Seguir con el tutorial» se ve y responde', await u.cover('.tut-next'));
    await u.click('.tut-next', '→'); await sleep(1500);
    const i = await tut();
    ok(i && i.on && i.id.startsWith('mover/'), 'tras la pausa, el tutorial sigue en el capítulo 5', i && i.id);
  }
  console.log(`\n${bad ? `✘ ${bad} de ${n} comprobaciones fallan` : `✔ las ${n} comprobaciones`}`);
};
