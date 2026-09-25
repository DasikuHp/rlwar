// Ratón y teclado de verdad para tools/sondeo.mjs (sesión 11): clickAt, drag y cover (dice si algo tapa el punto).
// La s10 probó con .click() de JavaScript y no vio que la paleta se movía bajo el ratón; usa esto en los sondeos.
export const mk = ({ ev, send, sleep }) => {
  const rect = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  // qué hay encima del centro del elemento: si no es él ni un hijo suyo, está tapado
  const cover = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'NO EXISTE'; const r=e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; if(x<0||y<0||x>innerWidth||y>innerHeight) return 'FUERA DE PANTALLA '+Math.round(x)+','+Math.round(y); const t=document.elementFromPoint(x,y); if(!t) return 'nada en el punto'; if(t===e||e.contains(t)) return 'ok'; return 'TAPADO por '+t.tagName+'.'+String(t.className.baseVal??t.className).split(' ')[0]})()`);
  const mouse = async (type, x, y, buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const clickAt = async (x, y) => { await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); };
  const click = async (sel, label = sel) => {
    let c = await cover(sel);
    if (c !== 'ok' && c !== 'NO EXISTE') { console.log(`   (desplazo hasta ${label}, como haría una persona)`); await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(200); c = await cover(sel); }
    if (c !== 'ok') { console.log(`   ✘ clic en ${label}: ${c}`); return false; }
    const r = await rect(sel); await clickAt(r.x + r.w / 2, r.y + r.h / 2); return true;
  };
  const drag = async (fromSel, toSel) => {
    const a = await rect(fromSel), b = await rect(toSel);
    if (!a || !b) { console.log('   ✘ arrastre: falta', !a ? fromSel : toSel); return false; }
    const x0 = a.x + a.w / 2, y0 = a.y + a.h / 2, x1 = b.x + b.w / 2, y1 = b.y + b.h / 2;
    await mouse('mouseMoved', x0, y0, 0); await mouse('mousePressed', x0, y0);
    for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8, 1); await sleep(20); }
    await mouse('mouseReleased', x1, y1, 0); return true;
  };
  const key = async (k, mods = 0, code) => {
    const c = code || (k.length === 1 ? 'Key' + k.toUpperCase() : k);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: c, modifiers: mods, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: c, modifiers: mods });
  };
  // cajas que se solapan: a contra una lista
  const overlaps = (a, list) => ev(`(()=>{const A=document.querySelector(${JSON.stringify(a)}); if(!A||A.hidden) return 'sin '+${JSON.stringify(a)}; const r=A.getBoundingClientRect(); const out=[]; for(const e of document.querySelectorAll(${JSON.stringify(list)})){const s=e.getBoundingClientRect(); const ix=Math.min(r.right,s.right)-Math.max(r.left,s.left), iy=Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top); if(ix>2&&iy>2) out.push((e.dataset.node||e.className.baseVal||e.className)+' '+Math.round(ix)+'x'+Math.round(iy));} return out.join(' | ')||'ninguno'})()`);
  return { rect, cover, clickAt, click, drag, key, overlaps, mouse };
};
