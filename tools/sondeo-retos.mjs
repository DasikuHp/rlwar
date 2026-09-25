// Sondeo (sesión 14): los retos del tutorial con ratón de verdad (relevo s13 §4: «Hazlo por mí» solo se probaba en el test
// puro). Para cada reto: empieza sin ayuda; tras 2 clics en lo oscuro sale «Hazlo por mí», se ve entero y sin tapar; al
// pulsarlo con el ratón, el reto se cumple y el tutorial pasa al paso siguiente. W=1920 H=1080 para 1920.
// Uso: node tools/sondeo.mjs tools/sondeo-retos.mjs   (SP=<carpeta> guarda capturas; VERBOSE=1 enseña también los ✔)
import { mk } from './raton.mjs';
import { CHAPTERS } from '../public/js/game/tutorial/crear.js';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);

export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx; const u = mk(ctx);
  let bad = 0, n = 0;
  const ok = (cond, what, extra = '') => { n++; if (!cond) bad++; if (!cond || process.env.VERBOSE) console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`); };
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
  const info = async () => JSON.parse(await ev('JSON.stringify(window.gwTut ? window.gwTut.info() : null)') || 'null');
  const visible = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; const r=e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width>0 && r.height>0})()`);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  const darkPt = { x: 60, y: H - 20 };
  console.log(`\n== retos a ${W} × ${H}`);
  const retos = CHAPTERS.flatMap((c, ci) => c.steps.map((s, si) => ({ ci, si, id: `${c.key}/${s.key}`, kind: s.kind }))).filter((x) => x.kind === 'reto');
  for (const r of retos) {
    // primero fuera del editor: si no, la página vieja puede guardar su avance encima del que se pone aquí
    await send('Page.navigate', { url: 'about:blank' }); await sleep(800);
    await api('/api/worlds/1/meta', 'PUT', { tutorial: { crear: { v: 1, on: true, finished: false, skipped: false, path: 'cero', done: CHAPTERS.slice(0, r.ci).map((c) => c.key), answers: {}, setup: [], data: {}, last: null, ci: r.ci, si: r.si, t0: 0, misses: 0, base: { ev: {} } } } });
    await load(`/?reto=${r.ci}#crear`, 4500); // otra URL: con la misma, el navegador no recarga
    let i = await waitFor(async () => { const x = await info(); return x && x.id === r.id ? x : null; }, 6000);
    ok(!!i, `[${r.id}] el tutorial está en el reto`, i ? i.id : JSON.stringify(await info()));
    if (!i) continue;
    await sleep(800);
    ok(i.level === 0 && !await visible('.tut-do') && await ev(`!!document.querySelector('.tut-hand')?.hidden`), `[${r.id}] empieza sin ayuda (ni mano ni «Hazlo por mí»)`, `nivel ${i.level}`);
    ok((await info()).id === r.id, `[${r.id}] el cambio del Sistema deja el reto por hacer (no se da por hecho solo)`);
    for (let k = 0; k < 2; k++) { await u.clickAt(darkPt.x, darkPt.y); await sleep(200); }
    const help = await waitFor(() => visible('.tut-do'), 3000);
    ok(!!help, `[${r.id}] tras 2 clics fuera sale «Hazlo por mí»`, `fallos ${(await info()).misses}`);
    ok(await u.cover('.tut-do') === 'ok', `[${r.id}] «Hazlo por mí» se ve entero y responde`, await u.cover('.tut-do'));
    if (process.env.SP) await shot(`${process.env.SP}/reto${W}-${r.id.replace('/', '_')}.png`);
    await u.click('.tut-do', 'Hazlo por mí');
    const moved = await waitFor(async () => { const x = await info(); return x && (x.id !== r.id || !x.on) ? x : null; }, 6000);
    ok(!!moved, `[${r.id}] con el ratón, «Hazlo por mí» cumple el reto y pasa al paso siguiente`, moved ? `→ ${moved.on ? moved.id : 'fin'}` : (await ev(`(document.querySelector('.tut-win')||{}).innerText||''`)).replace(/\s+/g, ' ').slice(0, 160));
  }
  console.log(`\n${bad ? `✘ ${bad} de ${n} comprobaciones fallan` : `✔ las ${n} comprobaciones`}`);
};
