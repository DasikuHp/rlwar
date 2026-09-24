// Cirugía (parte 4, nivel Científico; spec/05 §7 y §10.5): congelar bloques (sin gradiente, sin mutación, sin
// evolución), ver y tocar pesos a mano (con la misma validación que el servidor) y trasplantar un bloque de otra red.
// Nada se bloquea por nivel: esta vista es para quien quiera meter las manos, y lo dice.
import * as X from './surgery.js';
import * as M from './model.js';
import { api, reasonOf } from './api.js';
import { patch } from '../ui/patch.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f3 = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '—');
const EDIT_MAX = 5000; // más números que esto no caben en un cuadro de texto útil: para eso, exportar/importar

// `bare` (la ficha de red): sin título ni selector de red; `show({netId})` cambia de red.
export function mountSurgery(root, { catalog, toast, bare = false }) {
  const S = { nets: [], netId: '', genome: null, block: null, frozen: new Set(), err: null, tp: { from: '', blockId: '', replace: '' }, donor: null };
  const entry = (type) => M.entryOf(catalog, type) || { name: type };

  async function loadNets() { const r = await api('/api/lab/nets'); if (r.ok) S.nets = r.body.nets; if (!S.netId && S.nets.length) S.netId = S.nets[0].id; }
  async function loadNet() {
    if (!S.netId) { S.genome = null; return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}`);
    S.genome = r.ok ? r.body.genome : null;
    S.frozen = new Set(S.genome && Array.isArray(S.genome.frozen) ? S.genome.frozen : []);
    const list = S.genome ? X.weightBlocks(S.genome) : [];
    if (!list.some((b) => b.id === S.block)) S.block = list.length ? list[0].id : null;
  }
  async function loadDonor() {
    if (!S.tp.from) { S.donor = null; return; }
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.tp.from)}`);
    S.donor = r.ok ? r.body.genome : null;
  }

  function frozenHTML(list) {
    return `<section class="card"><h2>Congelar</h2><p class="hint">Un bloque congelado no cambia al aprender (ni gradiente, ni mutación, ni evolución). Sirve para proteger lo que ya funciona.</p>
      <ul class="frz">${list.map((b) => `<li><label><input type="checkbox" data-frz="${esc(b.id)}" ${S.frozen.has(b.id) ? 'checked' : ''}> ${esc(entry(b.type).name)} <span class="mono">${esc(b.id)}</span></label></li>`).join('')}</ul>
      <button type="button" data-act="frozen">Guardar congelados</button></section>`;
  }
  function weightsHTML(list) {
    const b = list.find((x) => x.id === S.block);
    if (!b) return '<p class="empty">Esta red no tiene bloques con pesos.</p>';
    const w = S.genome.weights[b.id];
    const total = Object.values(b.keys).reduce((s, n) => s + n, 0);
    const keys = Object.entries(w).map(([k, arr]) => {
      const st = X.weightStats(arr);
      const g = X.gridOf(b, k, arr.length);
      return `<figure class="wmat"><figcaption><b class="mono">${esc(k)}</b> <span class="dim">${g.rows > 1 ? `${g.rows} entradas × ${g.cols} neuronas` : `${g.cols} valores`}</span> · mín <span class="mono">${f3(st.min)}</span> · máx <span class="mono">${f3(st.max)}</span> · media <span class="mono">${f3(st.mean)}</span> · norma <span class="mono">${f3(st.norm)}</span></figcaption>
        <canvas data-key="${esc(k)}" data-rows="${g.rows}" data-cols="${g.cols}" role="img" aria-label="Pesos ${esc(k)} de ${esc(b.id)}"></canvas><output class="mono dim" data-out="${esc(k)}"></output></figure>`;
    }).join('');
    return `<section class="card"><h2>Pesos a mano</h2>
      <div class="row wsel"><label for="sgBlock">Bloque</label><select id="sgBlock">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === S.block ? 'selected' : ''}>${esc(entry(x.type).name)} ${esc(x.id)}${x.frozen ? ' (congelado)' : ''}</option>`).join('')}</select><span class="dim">${total} números</span></div>
      <p class="hint">Naranja = negativo, gris = cero, cyan = positivo; más intenso, más lejos de cero (escala: el mayor valor absoluto de cada matriz). Pasa el ratón para ver cada número.</p>
      ${keys}
      <div class="row ops"><label for="sgScale">Multiplicar todo el bloque por</label><input id="sgScale" class="numin mono" type="number" step="0.1" value="0.5"><button type="button" data-act="scale">Aplicar</button><button type="button" data-act="zero">Poner a cero</button></div>
      ${total <= EDIT_MAX ? `<details class="raw"><summary>Editar los números a mano</summary><textarea id="sgRaw" spellcheck="false" rows="8">${esc(JSON.stringify(w))}</textarea><button type="button" data-act="raw">Guardar estos pesos</button></details>` : `<p class="hint">${total} números no caben en un cuadro de texto útil: exporta la red, edítala y vuelve a importarla.</p>`}
      ${S.err ? `<div class="issues"><p class="bad">${esc(S.err.text)}</p>${(S.err.list || []).map((e) => `<p class="explain">${esc(e.message)}${e.example ? `<span class="eg">${esc(e.example)}</span>` : ''}</p>`).join('')}</div>` : ''}
    </section>`;
  }
  function transplantHTML() {
    const donorBlocks = S.donor ? S.donor.blocks : [];
    return `<section class="card"><h2>Trasplante</h2><p class="hint">Copia un bloque (tipo, ajustes y pesos) de otra red. Si sus entradas no encajan, los pesos empiezan de cero y te avisa.</p>
      <div class="ctl"><label for="tpFrom">De la red</label><div class="ctl-in"><select id="tpFrom"><option value="">elige…</option>${S.nets.filter((n) => n.id !== S.netId).map((n) => `<option value="${esc(n.id)}" ${n.id === S.tp.from ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div></div>
      <div class="ctl"><label for="tpBlock">El bloque</label><div class="ctl-in"><select id="tpBlock" ${S.donor ? '' : 'disabled'}><option value="">elige…</option>${donorBlocks.map((b) => `<option value="${esc(b.id)}" ${b.id === S.tp.blockId ? 'selected' : ''}>${esc(entry(b.type).name)} ${esc(b.id)}</option>`).join('')}</select></div></div>
      <div class="ctl"><label for="tpRep">Dónde</label><div class="ctl-in"><select id="tpRep"><option value="">como bloque nuevo, sin cables</option>${(S.genome ? S.genome.blocks : []).map((b) => `<option value="${esc(b.id)}" ${b.id === S.tp.replace ? 'selected' : ''}>sustituyendo a ${esc(entry(b.type).name)} ${esc(b.id)} (conserva sus cables)</option>`).join('')}</select></div></div>
      <button type="button" data-act="transplant" ${S.tp.from && S.tp.blockId ? '' : 'disabled'}>Trasplantar</button></section>`;
  }
  function render() {
    const list = S.genome ? X.weightBlocks(S.genome) : [];
    patch(root, `${bare ? '<p class="hint">Cambios a mano en los pesos: congelar, tocar números y trasplantar. Si la red entrena o juega un duelo, espera a que acabe.</p>' : `<div class="sg-head"><h1>Cirugía</h1><p class="dim">Nivel Científico: cambios a mano en los pesos de una red. Si entrena o juega un duelo, espera a que acabe.</p>
        <label for="sgNet">Red</label><select id="sgNet">${S.nets.map((n) => `<option value="${esc(n.id)}" ${n.id === S.netId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select> <a class="btn small" href="#editor/${esc(S.netId)}">Abrir en el editor</a></div>`}
      ${S.genome ? `<div class="sg-grid"><div>${weightsHTML(list)}</div><aside>${frozenHTML(list)}${transplantHTML()}</aside></div>` : '<p class="empty">Elige una red.</p>'}`);
    paint();
  }
  // lienzos: una celda por peso, color divergente
  function paint() {
    const b = S.genome && S.genome.weights[S.block];
    if (!b) return;
    for (const cv of root.querySelectorAll('canvas[data-key]')) {
      const arr = b[cv.dataset.key], rows = Number(cv.dataset.rows), cols = Number(cv.dataset.cols);
      const cell = Math.max(2, Math.min(14, Math.floor(640 / cols)));
      cv.width = cols * cell; cv.height = Math.min(rows, 400) * cell;
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      const maxAbs = arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      for (let r = 0; r < Math.min(rows, 400); r++) for (let c = 0; c < cols; c++) { ctx.fillStyle = X.divergingColor(arr[r * cols + c], maxAbs); ctx.fillRect(c * cell, r * cell, cell - (cell > 3 ? 1 : 0), cell - (cell > 3 ? 1 : 0)); }
      cv.dataset.cell = cell;
    }
  }
  async function putWeights(value) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/weights/${encodeURIComponent(S.block)}`, 'PUT', value);
    if (!r.ok) { S.err = { text: reasonOf(r), list: (r.body && r.body.errors) || [] }; render(); return; }
    S.err = null; toast('Pesos guardados.');
    await loadNet(); render();
  }

  root.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.id === 'sgNet') { S.netId = el.value; S.err = null; await loadNet(); render(); }
    else if (el.id === 'sgBlock') { S.block = el.value; S.err = null; render(); }
    else if (el.dataset.frz) { if (el.checked) S.frozen.add(el.dataset.frz); else S.frozen.delete(el.dataset.frz); }
    else if (el.id === 'tpFrom') { S.tp.from = el.value; S.tp.blockId = ''; await loadDonor(); render(); }
    else if (el.id === 'tpBlock') { S.tp.blockId = el.value; render(); }
    else if (el.id === 'tpRep') S.tp.replace = el.value;
  });
  root.addEventListener('mousemove', (ev) => {
    const cv = ev.target.closest && ev.target.closest('canvas[data-key]');
    if (!cv) return;
    const cell = Number(cv.dataset.cell), rect = cv.getBoundingClientRect();
    const c = Math.floor((ev.clientX - rect.left) / rect.width * cv.width / cell), r = Math.floor((ev.clientY - rect.top) / rect.height * cv.height / cell);
    const cols = Number(cv.dataset.cols);
    const arr = S.genome.weights[S.block][cv.dataset.key];
    const i = r * cols + c;
    const out = root.querySelector(`output[data-out="${CSS.escape(cv.dataset.key)}"]`);
    if (out && arr && i >= 0 && i < arr.length) out.textContent = Number(cv.dataset.rows) > 1 ? `entrada ${r} → neurona ${c}: ${f3(arr[i])}` : `posición ${c}: ${f3(arr[i])}`;
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'frozen') {
      const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/frozen`, 'PUT', { blocks: [...S.frozen] });
      if (!r.ok) { toast(reasonOf(r), 'error'); return; }
      toast(`Congelados: ${r.body.frozen.length ? r.body.frozen.join(', ') : 'ninguno'}.`);
      await loadNet(); render();
    } else if (act === 'scale' || act === 'zero') {
      const { value, error } = X.scaleWeights(S.genome.weights[S.block], act === 'zero' ? 0 : root.querySelector('#sgScale').value);
      if (error) { S.err = { text: error }; render(); return; }
      putWeights(value);
    } else if (act === 'raw') {
      const { value, error } = X.parseWeights(root.querySelector('#sgRaw').value);
      if (error) { S.err = { text: error }; render(); return; }
      putWeights(value);
    } else if (act === 'transplant') {
      const body = { fromNetId: S.tp.from, blockId: S.tp.blockId };
      if (S.tp.replace) body.replaceBlockId = S.tp.replace;
      const r = await api(`/api/lab/nets/${encodeURIComponent(S.netId)}/transplant`, 'POST', body);
      if (!r.ok) { toast(reasonOf(r), 'error'); return; }
      toast(`Trasplantado como ${r.body.blockId}${(r.body.warnings || []).length ? `. Aviso: ${r.body.warnings.join(' ')}` : ''}${S.tp.replace ? '' : '. Conéctalo en el editor.'}`);
      await loadNet(); render();
    }
  });

  return {
    async start() { await loadNets(); await loadNet(); render(); },
    async show({ netId }) { if (netId !== S.netId) { S.netId = netId; S.err = null; S.tp = { from: '', blockId: '', replace: '' }; S.donor = null; S.block = null; } await this.start(); },
  };
}
