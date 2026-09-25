// Sondeo (sesiones 11 y 12): enchufar y desenchufar con ratón de verdad en Tortuga (a 1280 × 800 el zoom es 58 %).
// W=1920 H=1080 para 1920. Uso: node tools/sondeo.mjs tools/sondeo-enchufe.mjs
// Cada comprobación imprime ✔ o ✘; al final, el total.
import { mk } from './raton.mjs';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);
export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx; const u = mk(ctx);
  let bad = 0;
  const ok = (cond, what, extra = '') => { if (!cond) bad++; console.log(`${cond ? '✔' : '✘'} ${what}${extra ? ` — ${extra}` : ''}`); };
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  const a = await api('/api/lab/nets', 'POST', { template: 'turtle', name: 'Tortu' });
  await load('/#crear/' + (a.body?.net?.id || a.body?.id), 3500);
  const wires = () => ev(`[...document.querySelectorAll('svg.wires path.hit title')].map(t=>t.textContent.split(':')[0].replace(' → ','>')).join(' ')`);
  const has = async (w) => (' ' + await wires() + ' ').includes(` ${w} `);
  const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,l:r.left,r:r.right,t:r.top,b:r.bottom}})()`);
  const toastTxt = () => ev(`(document.getElementById('toast')||{}).textContent||''`);
  const tip = () => ev(`(()=>{const t=document.getElementById('edDropTip'); return t&&!t.hidden? t.className+' | '+t.textContent : 'sin cartel'})()`);
  // un sitio vacío del lienzo: lejos (> 70 px) de toda tarjeta
  const voidPt = () => ev(`(()=>{const b=document.getElementById('edBoard').getBoundingClientRect(); const cs=[...document.querySelectorAll('[data-node]')].map(n=>n.getBoundingClientRect());
    for(let y=b.bottom-20;y>b.top+60;y-=15) for(let x=b.right-20;x>b.left+20;x-=15){ if(cs.every(r=>Math.hypot(Math.max(r.left-x,0,x-r.right),Math.max(r.top-y,0,y-r.bottom))>70)) return {x,y}; } return null})()`);
  const undoKey = async () => { const b = await u.rect('#edBoard'); const v = await voidPt(); await u.clickAt(v.x, v.y); await sleep(200); await u.key('z', 2); await sleep(900); };
  const mid = (i) => ev(`(()=>{const p=[...document.querySelectorAll('svg.wires path.hit')].find(p=>p.querySelector('title').textContent.startsWith(${JSON.stringify(i)}+':')); if(!p) return null; const L=p.getTotalLength(); const pt=p.getPointAtLength(L/2); const m=p.getScreenCTM(); return {x:pt.x*m.a+m.e, y:pt.y*m.d+m.f, i:p.dataset.wire}})()`);

  console.log(`\n== ${W} × ${H} · zoom ${await ev(`document.getElementById('edZoom').textContent`)} · cables: ${await wires()}`);

  // A. zona de agarre de 28 px en pantalla, con cualquier zoom
  const po = await center('[data-node="c"] .port.out');
  ok(Math.abs(po.w - 28) < 1.5, 'la salida atrapa el ratón en 28 px de pantalla', `${po.w.toFixed(1)} px`);
  const pi = await center('[data-node="cd"] .port.in');
  ok(Math.abs(pi.w - 28) < 1.5, 'la entrada también', `${pi.w.toFixed(1)} px`);
  const at = (x, y) => ev(`(()=>{const t=document.elementFromPoint(${x},${y}); const p=t&&t.closest('[data-port],[data-portin]'); return p? (p.dataset.port||'in:'+p.dataset.portin) : (t? t.tagName+'.'+String(t.className.baseVal??t.className).split(' ')[0] : 'nada')})()`);
  ok(await at(po.x + 10, po.y) === 'c', 'fallar por 10 px a la derecha de la salida sigue cogiendo el punto', await at(po.x + 10, po.y));
  ok(await at(pi.x - 10, pi.y) === 'in:cd', 'fallar por 10 px a la izquierda de la entrada sigue cogiendo el punto', await at(pi.x - 10, pi.y));

  // B. enchufar con imán: soltar a 25 px de la tarjeta, sin tocarla
  // a 25 px de Instinto d, por el lado que queda más lejos de las demás tarjetas (si no, el imán escoge la vecina)
  const near = await ev(`(()=>{const r=document.querySelector('[data-node="d"]').getBoundingClientRect(); const cs=[...document.querySelectorAll('[data-node]')].filter(n=>n.dataset.node!=='d').map(n=>n.getBoundingClientRect());
    const dist=(x,y)=>Math.min(...cs.map(q=>Math.hypot(Math.max(q.left-x,0,x-q.right),Math.max(q.top-y,0,y-q.bottom))));
    return [{x:r.left-25,y:r.top+r.height/2},{x:r.right+25,y:r.top+r.height/2},{x:r.left+r.width/2,y:r.top-25},{x:r.left+r.width/2,y:r.bottom+25}].map(p=>({...p,far:dist(p.x,p.y)})).sort((a,b)=>b.far-a.far)[0]})()`);
  const pr = await center('[data-node="r"] .port.out');
  const seenB = await u.dragXY(pr.x, pr.y, near.x, near.y, tip);
  ok(/Suelta para unir .*Radar.*\(r\).*\(d\)/.test(seenB), 'antes de soltar, el cartel dice qué va a pasar', seenB);
  await sleep(900);
  ok(await has('r>d'), 'soltar a 25 px de la tarjeta la une (imán)', await toastTxt());
  await undoKey();
  ok(!(await has('r>d')), 'Ctrl+Z lo deshace');

  // C. desenchufar como en Blender: coger la punta desde la entrada y soltarla en el vacío
  const v = await voidPt();
  const seenC = await u.dragXY(pi.x, pi.y, v.x, v.y, tip);
  ok(/desenchufar/.test(seenC), 'con la punta en el vacío, el cartel avisa de que se desenchufa', seenC);
  await sleep(900);
  ok(!(await has('c>cd')) && await has('d>cd'), 'soltarla en el vacío quita ese cable (el último que llegó) y solo ese', await wires());
  ok(/Desenchufado/.test(await toastTxt()), 'el aviso lo cuenta y ofrece deshacer', await toastTxt());
  const tb = await center('#toast .toast-act');
  ok(tb && (await u.cover('#toast .toast-act')) === 'ok', 'el botón «Deshacer» del aviso se ve y se puede pulsar');
  if (tb) { await u.clickAt(tb.x, tb.y); await sleep(900); }
  ok(await has('c>cd'), 'pulsar «Deshacer» lo vuelve a enchufar');

  // D. cambiar un cable de sitio: la punta de c → cd se suelta en Instinto d
  const pi2 = await center('[data-node="cd"] .port.in'), rd2 = await center('[data-node="d"]');
  const seenD = await u.dragXY(pi2.x, pi2.y, rd2.x, rd2.y, tip);
  await sleep(900);
  ok(await has('c>d') && !(await has('c>cd')), 'soltar la punta en otra tarjeta que vale cambia el cable de sitio', `${seenD} → ${await wires()}`);
  await undoKey();
  ok(await has('c>cd') && !(await has('c>d')), 'Ctrl+Z lo devuelve');

  // E. pasar el ratón por un cable: se ilumina y salen ✕ y ＋ encima de su mitad
  const m1 = await mid('g → d');
  await u.mouse('mouseMoved', m1.x - 30, m1.y - 40, 0); await sleep(100);
  await u.mouse('mouseMoved', m1.x, m1.y, 0); await sleep(400);
  ok(await ev(`!!document.querySelector('svg.wires path.wire.hov')`), 'el cable bajo el ratón se ilumina');
  ok((await u.cover('#edWireTools [data-unwire]')) === 'ok' && (await u.cover('#edWireTools .wire-plus')) === 'ok', 'sus botones ✕ Desenchufar y ＋ Añadir capa se ven enteros', await ev(`document.getElementById('edWireTools').innerText.replace(/\\s+/g,' ')`));
  const bx = await center('#edWireTools [data-unwire]');
  ok(bx && bx.h >= 22, 'a tamaño de pantalla', bx && `${bx.w.toFixed(0)} × ${bx.h.toFixed(0)} px`);
  // el ratón viaja del cable a los botones sin que se vayan
  await u.mouse('mouseMoved', m1.x, m1.y - 14, 0); await sleep(120);
  if (bx) { await u.mouse('mouseMoved', bx.x, bx.y, 0); await sleep(400); }
  ok(!(await ev(`document.getElementById('edWireTools').hidden`)), 'siguen ahí al llevar el ratón hasta ellos');
  if (bx) { await u.clickAt(bx.x, bx.y); await sleep(900); }
  ok(!(await has('g>d')), '✕ Desenchufar lo quita', await toastTxt());
  await undoKey();
  ok(await has('g>d'), 'Ctrl+Z lo devuelve');
  // pulsar en la mitad del cable lo elige (los botones están encima, no en medio)
  const m2 = await mid('g → d');
  await u.clickAt(m2.x, m2.y); await sleep(700);
  ok(await ev(`!!document.querySelector('svg.wires path.wire.sel')`) && await has('g>d'), 'pulsar la mitad del cable lo elige y no lo quita');
  const plus = await center('#edWireTools .wire-plus');
  if (plus) { await u.clickAt(plus.x, plus.y); await sleep(900); }
  ok((await u.cover('#edInsert [data-insert="dense"]')) === 'ok', '＋ Añadir capa abre la lista de lo que cabe en medio', await u.cover('#edInsert [data-insert="dense"]'));

  // F. Alt + clic en un punto quita todos sus cables (Unreal)
  const pc = await center('[data-node="cat"] .port.in');
  await u.mouse('mouseMoved', pc.x, pc.y, 0); await u.mouse('mousePressed', pc.x, pc.y, 1, 1); await u.mouse('mouseReleased', pc.x, pc.y, 0, 1); await sleep(900);
  ok(!(await has('f>cat')) && !(await has('r>cat')) && !(await has('k>cat')), 'Alt + clic en la entrada de Juntar quita sus 3 cables', await toastTxt());
  await undoKey();
  ok(await has('f>cat') && await has('k>cat'), 'Ctrl+Z los devuelve');

  // G. soltar una tarjeta sin cables encima de un cable la mete en medio (Blender)
  await u.click('.pal [data-add="dense"]', 'Instinto de la paleta'); await sleep(1200);
  const nid = await ev(`[...document.querySelectorAll('[data-node]')].map(n=>n.dataset.node).find(x=>/^d\\d/.test(x))`);
  const card = await center(`[data-node="${nid}"]`), m3 = await mid('cd → ch');
  const seenG = await u.dragXY(card.x, card.y, m3.x, m3.y, async () => `${await tip()} | cable: ${await ev(`document.querySelector('svg.wires path.wire.ins-ok')?'se abre el hueco':'sin hueco'`)}`, 14);
  ok(/meterlo en medio/.test(seenG) && /hueco/.test(seenG) && !/sin hueco/.test(seenG), 'al pasar la tarjeta por encima del cable, se abre el hueco y el cartel lo dice', seenG);
  await sleep(1000);
  ok(await has(`cd>${nid}`) && await has(`${nid}>ch`) && !(await has('cd>ch')), `al soltarla queda cd → ${nid} → ch`, await toastTxt());

  // H. al revés: desde la entrada vacía de un bloque nuevo hasta unos ojos
  await u.click('.pal [data-add="dense"]', 'otro Instinto'); await sleep(1200);
  const nid2 = await ev(`[...document.querySelectorAll('[data-node]')].map(n=>n.dataset.node).filter(x=>/^d\\d/.test(x)).pop()`);
  const pn = await center(`[data-node="${nid2}"] .port.in`), rf = await center('[data-node="f"]');
  await u.dragXY(pn.x, pn.y, rf.x, rf.y); await sleep(900);
  ok(await has(`f>${nid2}`), `desde la entrada vacía de ${nid2} hasta Rasgos hace el cable f → ${nid2}`, await toastTxt());

  // I. soltar donde no vale: dice por qué y no cambia nada
  const before = await wires();
  const pc2 = await center('[data-node="c"] .port.out'), rk = await center('[data-node="k"]');
  const seenI = await u.dragXY(pc2.x, pc2.y, rk.x, rk.y, tip);
  await sleep(900);
  ok(/^drop-tip no/.test(seenI) && (await wires()) === before && /ojos/.test(await toastTxt()), 'soltar en unos ojos no cambia nada y dice por qué (antes y después de soltar)', `${seenI} | ${await toastTxt()}`);

  if (process.env.SP) await shot(`${process.env.SP}/enchufe-${W}.png`);
  console.log(bad ? `\n✘ ${bad} comprobación(es) fallida(s)` : '\n✔ todas las comprobaciones');
};
