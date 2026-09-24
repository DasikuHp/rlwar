// recorrido desde cero: plantilla en blanco → añadir con los botones de "le falta" → unir → lista → deshacer →
// guardar (versión) → versiones y diferencias → qué ve → avisos con arreglo → cable imposible arrastrando
const txt = (s) => `(document.querySelector(${JSON.stringify(s)})||{}).innerText`;
export default async ({ api, load, go, ev, sleep, shot }) => {
  await api('/api/worlds/1/new', 'POST', { path: 'cero', name: 'Prueba' });
  await api('/api/worlds/1/open', 'POST', {});
  await load('/#crear', 4000);
  await ev(`document.querySelector('[data-tpl="blank"]').click()`); await sleep(300);
  await ev(`document.querySelector('form[data-create="blank"]').requestSubmit()`); await sleep(1800);
  console.log('1 inicio:', String(await ev(txt('.board-start'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await shot(process.env.SP + '/p6-c-vacia.png');
  await ev(`document.querySelector('.board-start [data-add="eye.candidates"]').click()`); await sleep(700);
  console.log('2 le falta:', String(await ev(txt('.needs'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await ev(`document.querySelector('.needs [data-add="hand.choose"]').click()`); await sleep(700);
  console.log('3 le falta:', String(await ev(txt('.needs'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await ev(`document.querySelector('.needs [data-wireup]').click()`); await sleep(900);
  console.log('4 estado:', await ev(txt('.ed-status')), '| needs:', await ev(`!!document.querySelector('.needs')`));
  console.log('4 banco:', String(await ev(txt('.b-out'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await ev(`document.querySelector('[data-act="undo"]').click()`); await sleep(500);
  console.log('5 tras deshacer:', await ev(txt('.ed-status')), '| rehacer:', await ev(`document.querySelector('[data-act="redo"]').title`));
  await ev(`document.querySelector('[data-act="redo"]').click()`); await sleep(500);
  await ev(`document.querySelector('[data-act="save"]').click()`); await sleep(1200);
  console.log('6 toast:', await ev(`document.getElementById('toast').textContent`));
  // un cambio más y guardar: la de antes queda como versión
  await ev(`document.querySelector('[data-add="dense"]').click()`); await sleep(600);
  await ev(`document.querySelector('[data-act="save"]').click()`); await sleep(1200);
  console.log('7 toast:', await ev(`document.getElementById('toast').textContent`));
  await ev(`document.querySelector('[data-ptab="versiones"]').click()`); await sleep(1200);
  await ev(`document.querySelector('[data-vdiff]')?.click()`); await sleep(1200);
  console.log('8 versiones:', String(await ev(txt('.ed-panel .panel-body'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await ev(`document.querySelector('[data-ptab="ve"]').click()`); await sleep(600);
  console.log('9 qué ve:', String(await ev(txt('.ed-panel .panel-body'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await ev(`document.querySelector('[data-ptab="avisos"]').click()`); await sleep(600);
  console.log('10 avisos:', String(await ev(txt('.ed-panel .panel-body'))).split(String.fromCharCode(10)).join(' ').slice(0,300));
  await shot(process.env.SP + '/p6-d.png');
  // Tu escena
  await ev(`document.querySelector('[data-scene="mia"]').click()`); await sleep(600);
  await ev(`document.querySelector('[data-bench="enemy"]').click()`); await sleep(600);
  console.log('11 tu escena:', await ev(`document.querySelectorAll('#benchSvg [data-soldier]').length + ' soldados'`), await ev(txt('.b-out')));
  await shot(process.env.SP + '/p6-e.png');
};
