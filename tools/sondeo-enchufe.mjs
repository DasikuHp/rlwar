// Sondeo (sesión 11): enchufar y desenchufar con ratón de verdad en Tortuga a 1280. Uso: node tools/sondeo.mjs tools/sondeo-enchufe.mjs
import { mk } from './raton.mjs';
export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx; const u = mk(ctx);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  const a = await api('/api/lab/nets', 'POST', { template: 'turtle', name: 'Tortu' });
  await load('/#crear/' + (a.body?.net?.id || a.body?.id), 3500);
  const wires = () => ev(`[...document.querySelectorAll('svg.wires path.hit title')].map(t=>t.textContent.split(':')[0]).join(' | ')`);
  console.log('zoom', await ev(`document.getElementById('edZoom').textContent`), '| cables:', await wires());
  console.log('tamaño del puerto en pantalla:', await ev(`(()=>{const r=document.querySelector('.port.out').getBoundingClientRect(); return r.width.toFixed(1)+'px'})()`));
  // 1) pulsar un cable a mitad
  const mid = async (i) => ev(`(()=>{const p=document.querySelector('svg.wires path.hit[data-wire="${i}"]'); const L=p.getTotalLength(); const pt=p.getPointAtLength(L/2); const m=p.getScreenCTM(); return {x:pt.x*m.a+m.e, y:pt.y*m.d+m.f}})()`);
  const m = await mid(0); console.log('mitad del cable 0:', JSON.stringify(m), '→ encima hay', await ev(`(()=>{const t=document.elementFromPoint(${m.x},${m.y}); return t.tagName+'.'+String(t.className.baseVal??t.className)})()`));
  await u.clickAt(m.x, m.y); await sleep(700);
  console.log('seleccionado:', await ev(`document.querySelector('svg.wires path.wire.sel')?.getAttribute('data-key')||'nada'`), '| «Quitar cable» se ve:', await u.cover('[data-act="unwire"]'), '| pestaña:', await ev(`document.querySelector('.ed-panel [aria-selected="true"]')?.textContent`));
  // 2) Supr con el cable elegido
  await u.key('Delete', 0, 'Delete'); await sleep(800);
  console.log('tras Supr:', await wires());
  await u.key('z', 2); await sleep(800);
  // 3) arrastrar desde el punto de ENTRADA de un bloque (lo que prueba la gente para desenchufar)
  const inId = await ev(`[...document.querySelectorAll('[data-node]')].find(n=>n.querySelector('.port.in'))?.dataset.node`);
  const pin = await ev(`(()=>{const r=document.querySelector('[data-node="${inId}"] .port.in').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const before = await ev(`document.querySelector('[data-node="${inId}"]').style.left`);
  await u.mouse('mouseMoved', pin.x, pin.y, 0); await u.mouse('mousePressed', pin.x, pin.y);
  for (let k = 1; k <= 8; k++) { await u.mouse('mouseMoved', pin.x - k * 10, pin.y + k * 6, 1); await sleep(20); }
  await u.mouse('mouseReleased', pin.x - 80, pin.y + 48, 0); await sleep(800);
  console.log('arrastrar desde la entrada de', inId, '→ el bloque se movió de', before, 'a', await ev(`document.querySelector('[data-node="${inId}"]').style.left`), '| cables:', await wires());
  // 4) enchufar: arrastrar desde un puerto de salida fallando por 4 px
  const outs = await ev(`(()=>{const p=document.querySelector('.port.out'); const r=p.getBoundingClientRect(); return {id:p.dataset.port,x:r.x+r.width/2+5,y:r.y+r.height/2}})()`);
  console.log('a 5 px del centro del puerto', outs.id, 'hay:', await ev(`(()=>{const t=document.elementFromPoint(${outs.x},${outs.y}); return t.tagName+'.'+String(t.className.baseVal??t.className).slice(0,30)})()`));
  if (process.env.SP) await shot(process.env.SP + '/enchufe.png');
};
