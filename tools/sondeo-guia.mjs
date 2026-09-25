// Sondeo (sesión 11): la guía de la s10 entera con ratón de verdad (W=1920 H=1080 para 1920). Uso: node tools/sondeo.mjs tools/sondeo-guia.mjs
import { mk } from './raton.mjs';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 800);
const C = `(document.querySelector('#edCoach .coach')?.innerText||'∅').replace(/\\s+/g,' ')`;
export default async (ctx) => {
  const { api, load, ev, sleep, send, shot } = ctx;
  const u = mk(ctx);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' }); await api('/api/worlds/1/open', 'POST', {});
  await load('/#crear', 4000);
  const snap = async (n) => { if (process.env.SP) await shot(`${process.env.SP}/g${W}-${n}.png`); };
  const step = async (n) => {
    const t = await ev(C);
    console.log(`\n[${n}]`, t.slice(0, 300));
    const tg = await ev(`[...document.querySelectorAll('.coach-target')].map(e=>e.tagName+'.'+String(e.className.baseVal??e.className).split(' ')[0]+(e.dataset.add?'['+e.dataset.add+']':'')).join(',')||'nada'`);
    console.log('   iluminado:', tg, tg !== 'nada' ? '| ' + await u.cover('.coach-target') : '');
    console.log('   👉 se ve:', await u.cover('#edCoach .coach .todo'), '| botones:', await ev(`[...document.querySelectorAll('#edCoach .coach button:not(.x)')].map(b=>b.textContent.trim()).join(', ')||'-'`), await ev(`(()=>{const b=[...document.querySelectorAll('#edCoach .coach .row button')]; const c=document.getElementById('edCoach').getBoundingClientRect(); return b.every(x=>{const r=x.getBoundingClientRect(); return r.bottom<=c.bottom+1&&r.top>=c.top-1})?'enteros':'CORTADOS'})()`));
    console.log('   guía tapa:', await u.overlaps('#edCoach .coach', '[data-node], .wire-plus, .ed-bench, .ed-panel'));
    console.log('   guía cabe:', await ev(`(()=>{const r=document.querySelector('#edCoach .coach')?.getBoundingClientRect(); return r? Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'x'+Math.round(r.height)+(r.bottom>innerHeight||r.right>innerWidth?' SE SALE':''):'-'})()`));
  };
  console.log('nivel:', await ev(`document.querySelector('[data-level][aria-pressed="true"]')?.textContent`));
  // crear desde cero, con clics
  await u.click('[data-tpl="blank"]', 'plantilla Desde cero'); await sleep(400);
  await u.click('form[data-create="blank"] button[type="submit"]', 'Crear red'); await sleep(2500);
  await step('1 inicio'); await snap(1);
  await u.click('.pal [data-add="eye.candidates"]', 'Candidatos'); await sleep(1500); await step('2 tras Candidatos');
  await u.click('.pal [data-add="hand.choose"]', 'Elegir'); await sleep(1500); await step('3 tras Elegir'); await snap(3);
  // cable arrastrando del puerto de Candidatos a Elegir
  const cid = await ev(`(document.querySelector('[data-node] .port.out')?.dataset.port)`);
  const chid = await ev(`[...document.querySelectorAll('[data-node]')].map(e=>e.dataset.node).find(x=>x!==${JSON.stringify(cid)})`);
  console.log('   puerto', cid, '→', chid, '| puerto visible:', await u.cover(`[data-port="${cid}"]`));
  await u.drag(`[data-port="${cid}"]`, `[data-node="${chid}"]`); await sleep(1800); await step('4 tras el cable'); await snap(4);
  await u.click('[data-coach="bet:no"]', 'apuesta No'); await sleep(900); await step('5 tras apostar');
  // pulsar el cable: el hit path del cable Candidatos→Elegir
  const hit = await ev(`(()=>{const p=document.querySelector('svg.wires path.hit[data-wire="0"]'); if(!p) return null; const L=p.getTotalLength(); const pt=p.getPointAtLength(L/2); const m=p.getScreenCTM(); return {x:pt.x*m.a+m.e, y:pt.y*m.d+m.f}})()`);
  console.log('   mitad del cable en pantalla:', JSON.stringify(hit), hit ? await ev(`(()=>{const t=document.elementFromPoint(${hit?.x},${hit?.y}); return t.tagName+'.'+String(t.className.baseVal??t.className)})()`) : '');
  if (hit) { await u.clickAt(hit.x, hit.y); await sleep(700); }
  console.log('   ＋:', await u.cover('.wire-plus'));
  await u.click('.wire-plus', '＋'); await sleep(700);
  console.log('   panel insertar:', (await ev(`(document.getElementById('edInsert')?.innerText||'∅').replace(/\\s+/g,' ')`)).slice(0, 240), '| visible:', await u.cover('#edInsert [data-insert="dense"]'));
  await u.click('#edInsert [data-insert="dense"]', 'Instinto'); await sleep(1500); await step('6 tras Instinto'); await snap(6);
  console.log('   escena roca:', await u.cover('[data-scene="roca"]'));
  await u.click('[data-scene="roca"]', 'escena roca'); await sleep(1500); await step('7 tras la roca');
  await u.click('.pal [data-add="eye.moves"]', 'Destinos'); await sleep(1000);
  await u.click('.pal [data-add="foot.move"]', 'Moverse'); await sleep(1000);
  const nodeOf = (name) => ev(`[...document.querySelectorAll('[data-node]')].find(e=>e.getAttribute('aria-label').startsWith(${JSON.stringify(name)}+' '))?.dataset.node`);
  const wire = async (a, b) => { const A = await nodeOf(a), B = await nodeOf(b); console.log(`   cable ${a}(${A}) → ${b}(${B}); puerto:`, await u.cover(`[data-port="${A}"]`), '| destino:', await u.cover(`[data-node="${B}"]`)); await u.drag(`[data-port="${A}"]`, `[data-node="${B}"]`); await sleep(1500); };
  await wire('Destinos', 'Moverse'); await step('8 tras pies'); await snap(8);
  console.log('   quién tapa Rasgos:', await ev(`(()=>{const e=document.querySelector('.pal [data-add="eye.features"]'); const r=e.getBoundingClientRect(); const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); const q=t.getBoundingClientRect(); return t.outerHTML.slice(0,200)+' @'+Math.round(q.x)+','+Math.round(q.y)+' '+Math.round(q.width)+'x'+Math.round(q.height)+' | rasgos @'+Math.round(r.x)+','+Math.round(r.y)+' | padres: '+[t.parentElement,t.parentElement?.parentElement].map(x=>x&&x.tagName+'.'+x.className).join(' < ')})()`));
  await u.click('.pal [data-add="eye.features"]', 'Rasgos'); await sleep(1000);
  await u.click('.pal [data-add="echo"]', 'Eco'); await sleep(1000);
  await wire('Rasgos', 'Eco'); await wire('Eco', 'Instinto'); await step('9 tras memoria'); await snap(9);
  console.log('   estado:', await ev(`document.querySelector('.ed-status')?.innerText`), '| cables:', await ev(`[...document.querySelectorAll('svg.wires path.hit title')].map(t=>t.textContent.split(':')[0]).join(' | ')`));
  // Ctrl+S con el foco en el fondo del lienzo
  const b = await u.rect('#edBoard'); await u.clickAt(b.x + b.w - 30, b.y + b.h - 20); await sleep(300);
  console.log('   foco tras clic en el fondo:', await ev(`document.activeElement.tagName+'#'+document.activeElement.id`));
  await u.key('s', 2); await sleep(1800);
  console.log('   tras Ctrl+S, toast:', await ev(`document.getElementById('toast')?.textContent`), '| sucio:', await ev(`document.querySelector('.ed-status')?.innerText`));
  await u.click('[data-act="probe"]', 'Probar ya'); await sleep(2500); await step('10 tras Probar ya');
  console.log('   panel probar:', (await ev(`(document.getElementById('edProbe')?.innerText||'∅').replace(/\\s+/g,' ')`)).slice(0, 300));
  await snap(10);
  await u.click('[data-act="probe-close"]', 'cerrar Probar'); await sleep(900); await step('11 tras cerrar');
  const meta = await api('/api/worlds/1/meta'); console.log('meta del mundo:', JSON.stringify(meta.body.tutorial), 'nivel', meta.body.level);
  // deshacer con el foco en el fondo del lienzo
  await u.click('.pal [data-add="dense"]', 'otro Instinto'); await sleep(900);
  const n1 = await ev(`document.querySelectorAll('[data-node]').length`);
  await u.clickAt(b.x + b.w - 30, b.y + b.h - 20); await sleep(300);
  await u.key('z', 2); await sleep(900);
  console.log('   bloques tras añadir:', n1, '→ tras Ctrl+Z:', await ev(`document.querySelectorAll('[data-node]').length`), '| toast:', await ev(`document.getElementById('toast')?.textContent`));
  await u.key('y', 2); await sleep(900);
  console.log('   tras Ctrl+Y:', await ev(`document.querySelectorAll('[data-node]').length`));
  // nivel: cambia a Artesano y recarga
  await u.click('[data-level="artesano"]', 'Artesano'); await sleep(900);
  await load('/#crear', 3500);
  console.log('   nivel tras recargar:', await ev(`document.querySelector('[data-level][aria-pressed="true"]')?.textContent`), '| meta:', (await api('/api/worlds/1/meta')).body.level);
};
