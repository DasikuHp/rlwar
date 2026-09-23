// Laboratorio de redes (spec/08): arranque y rutas. #inicio (o nada) → inicio; #editor[/<id>] → editor.
// Las vistas no se desmontan al cambiar: el editor conserva sus cambios sin guardar al ir y volver.
import { api, reasonOf } from './api.js';
import { mountEditor } from './editor.js';
import { mountHome } from './inicio.js';
import { mountTraining } from './entreno.js';
import { mountEvolution } from './evolucion.js';
import { mountThrone } from './trono.js';
import { mountDynasties } from './dinastias.js';
import { mountTruth } from './verdad.js';
import { mountSurgery } from './cirugia.js';

const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
let timer = null;
function toast(msg, kind = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `show ${kind}`;
  clearTimeout(timer);
  timer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 6000 : 2600);
}

const parse = () => {
  const h = location.hash;
  const m = /^#editor(?:\/([a-z0-9-]{3,32}))?$/.exec(h);
  if (m) return { name: 'editor', id: m[1] || null };
  if (h === '#entreno') return { name: 'entreno', id: null };
  if (h === '#evolucion') return { name: 'evolucion', id: null };
  if (h === '#trono') return { name: 'trono', id: null };
  if (h === '#dinastias') return { name: 'dinastias', id: null };
  if (h === '#verdad') return { name: 'verdad', id: null };
  if (h === '#cirugia') return { name: 'cirugia', id: null };
  return { name: 'inicio', id: null };
};

const cat = await api('/api/lab/catalog');
if (!cat.ok) {
  view.innerHTML = `<div class="board-empty"><p>No se pudo cargar el catálogo de bloques: ${reasonOf(cat).replace(/[<>&]/g, '')}</p><p class="dim">¿Está el servidor en marcha? (npm start)</p></div>`;
} else {
  view.innerHTML = '<div class="lab-home" id="vInicio" hidden></div><div class="lab-ed" id="vEditor" hidden></div><div class="lab-tr" id="vEntreno" hidden></div><div class="lab-tr" id="vEvolucion" hidden></div><div class="lab-thr" id="vTrono" hidden></div><div class="lab-thr" id="vDinastias" hidden></div><div class="lab-tv" id="vVerdad" hidden></div><div class="lab-sg" id="vCirugia" hidden></div>';
  const home = mountHome(document.getElementById('vInicio'));
  const editor = mountEditor(document.getElementById('vEditor'), { catalog: cat.body, toast });
  const training = mountTraining(document.getElementById('vEntreno'), { toast });
  const evolution = mountEvolution(document.getElementById('vEvolucion'), { catalog: cat.body, toast });
  const throne = mountThrone(document.getElementById('vTrono'), { toast });
  const dynasties = mountDynasties(document.getElementById('vDinastias'), { toast });
  const truthView = mountTruth(document.getElementById('vVerdad'), { catalog: cat.body, toast });
  const surgery = mountSurgery(document.getElementById('vCirugia'), { catalog: cat.body, toast });
  let editorStarted = false;
  const show = async () => {
    const r = parse();
    document.getElementById('vInicio').hidden = r.name !== 'inicio';
    document.getElementById('vEditor').hidden = r.name !== 'editor';
    document.getElementById('vEntreno').hidden = r.name !== 'entreno';
    document.getElementById('vEvolucion').hidden = r.name !== 'evolucion';
    document.getElementById('vTrono').hidden = r.name !== 'trono';
    document.getElementById('vDinastias').hidden = r.name !== 'dinastias';
    document.getElementById('vVerdad').hidden = r.name !== 'verdad';
    document.getElementById('vCirugia').hidden = r.name !== 'cirugia';
    for (const a of document.querySelectorAll('.lab-nav [data-view]')) {
      if (a.dataset.view === r.name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    document.title = `${{ editor: 'Editor de redes', entreno: 'Entreno', evolucion: 'Evolución', trono: 'Trono y duelos', dinastias: 'Dinastías', verdad: 'Verdad', cirugia: 'Cirugía' }[r.name] || 'Laboratorio'} · Graphwar`;
    if (r.name === 'inicio') home.start(); // vuelve a pedir redes y trono; el SSE se abre una vez
    if (r.name === 'entreno') training.start();
    if (r.name === 'evolucion') evolution.start();
    if (r.name === 'trono') throne.start();
    if (r.name === 'dinastias') dynasties.start();
    if (r.name === 'verdad') truthView.start();
    if (r.name === 'cirugia') surgery.start();
    if (r.name === 'editor') {
      if (!editorStarted) { editorStarted = true; await editor.start(r.id); }
      else if (r.id && r.id !== editor.state.netId) editor.open(r.id);
    }
  };
  window.addEventListener('hashchange', show);
  await show();
}
