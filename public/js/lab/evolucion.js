// Evolución (parte 4, spec/prompt-opus-ui.md §3.1; spec/05 §1, §4, §5): criar hijos con la mutación que elijas, verlos
// jugar el pre-torneo (sin pantalla, mismas semillas para todos) y compararlos con su madre: qué bloques cambiaron y
// cuánto (mapa de calor), qué cables, qué rasgos, y las frases exactas de cada mutación (opsText).
import * as E from './evolution.js';
import * as M from './model.js';
import { emblemSVG } from './emblem.js';
import { api, reasonOf } from './api.js';
import { hub } from '../ui/sse.js';
const LAB_EVENTS = '/api/lab/events'; // una conexión para todas las vistas (spec/08 §11)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (Number.isFinite(v) ? `${(Math.round(v * 1000) / 10).toLocaleString('es-ES')} %` : '—');
const STATUS = { running: 'jugando el pre-torneo', done: 'terminado', error: 'con error' };
const BSTATUS = { same: 'igual', changed: 'cambiado', added: 'nuevo', removed: 'quitado' };
const LS = 'gw.lab.level';

export function mountEvolution(root, { catalog, toast }) {
  const S = { nets: [], jobs: [], sel: null, job: null, diff: null, diffPair: null, form: null, cmp: { a: '', b: '' } };
  let es = null, timer = null;
  const level = () => { try { return JSON.parse(localStorage.getItem(LS)) || 'aprendiz'; } catch { return 'aprendiz'; } };
  const net = (id) => S.nets.find((n) => n.id === id);
  const nameOf = (id) => (net(id) ? net(id).name : id);
  // nombre de un tipo de bloque del catálogo ('eye.*' = cualquier ojo)
  const typeName = (v) => (v === 'eye.*' ? 'cualquier ojo' : (catalog.blocks.find((x) => x.type === v) || {}).name || String(v));
  const defaults = () => ({ parent: '', n: 6, games: 4, opponentId: '', soldiers: 'random', seed: '', mutation: E.defaultMutation(catalog.mutation) });

  async function loadAll() {
    const [n, j] = await Promise.all([api('/api/lab/nets'), api('/api/lab/jobs')]);
    if (n.ok) S.nets = n.body.nets;
    if (j.ok) S.jobs = j.body.jobs.filter((x) => x.kind === 'children').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!S.sel && S.jobs.length) S.sel = S.jobs[0].id;
    S.job = S.jobs.find((x) => x.id === S.sel) || null;
    if (root.querySelector('#evForm')) renderRight(); else render();
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadAll, 300); };

  async function showDiff(a, b) {
    const r = await api(`/api/lab/nets/${encodeURIComponent(a)}/diff/${encodeURIComponent(b)}`);
    if (!r.ok) { toast(reasonOf(r), 'error'); return; }
    S.diff = r.body; S.diffPair = [a, b];
    renderRight();
    const el = root.querySelector('#evDiff'); if (el) el.scrollIntoView({ block: 'start' });
  }

  // ---------- formulario de cría ----------
  function mutationHTML() {
    const lv = level();
    const m = S.form.mutation;
    const shown = catalog.mutation.filter((t) => M.atLevel(t.level, lv));
    const hidden = catalog.mutation.length - shown.length;
    return `${shown.map((t) => {
      const cur = m[t.key] || {};
      const params = t.params.filter((p) => p.key !== 'on');
      return `<fieldset class="${cur.on === false ? 'idle' : ''}"><legend><label><input type="checkbox" data-mut="${esc(t.key)}" data-p="on" ${cur.on !== false ? 'checked' : ''}> ${esc(t.name)}</label></legend>
        <p class="explain">${esc(t.explain || '')}${t.example ? `<span class="eg">${esc(t.example)}</span>` : ''}</p>
        ${params.map((p) => {
          if (p.type === 'set') return `<div class="ctl"><label>${esc(p.name || p.key)}</label><div class="ctl-in set">${(p.options || []).map((o) => { const v = typeof o === 'object' ? o.value : o; return `<label><input type="checkbox" data-mut="${esc(t.key)}" data-p="${esc(p.key)}" data-opt="${esc(v)}" ${(cur[p.key] || []).includes(v) ? 'checked' : ''}>${esc(typeName(v))}</label>`; }).join('')}</div></div>`;
          return `<div class="ctl"><label for="m-${esc(t.key)}-${esc(p.key)}">${esc(p.name || p.key)}</label><div class="ctl-in"><input id="m-${esc(t.key)}-${esc(p.key)}" class="numin mono" type="number" ${p.min !== undefined ? `min="${p.min}"` : ''} ${p.max !== undefined ? `max="${p.max}"` : ''} step="${p.type === 'int' ? 1 : 0.01}" value="${esc(cur[p.key])}" data-mut="${esc(t.key)}" data-p="${esc(p.key)}"></div>${p.explain ? `<p class="explain">${esc(p.explain)}</p>` : ''}</div>`;
        }).join('')}</fieldset>`;
    }).join('')}${hidden ? `<p class="hint">${hidden} tipos de mutación más en ${lv === 'aprendiz' ? 'Artesano o Científico' : 'Científico'} (siguen activos con sus valores por defecto).</p>` : ''}`;
  }
  function formHTML() {
    const f = S.form;
    const nets = S.nets.filter((n) => !n.training);
    return `<form class="tr-form" id="evForm" novalidate>
      <h2>Criar hijos</h2>
      <div class="ctl"><label for="ev-parent">Madre</label><div class="ctl-in"><select id="ev-parent" data-f="parent"><option value="">elige una red…</option>${nets.map((n) => `<option value="${esc(n.id)}" ${n.id === f.parent ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div>
        <p class="explain">Cada hijo es una copia de la madre con mutaciones al azar; se guardan todos y juegan un pre-torneo con las mismas semillas.</p></div>
      <div class="ctl"><label for="ev-n">Hijos</label><div class="ctl-in"><input id="ev-n" class="numin mono" type="number" min="1" max="16" step="1" value="${esc(f.n)}" data-f="n"></div></div>
      <fieldset><legend>Pre-torneo</legend>
        <div class="ctl"><label for="ev-g">Partidas</label><div class="ctl-in"><input id="ev-g" class="numin mono" type="number" min="0" max="20" step="1" value="${esc(f.games)}" data-f="games"></div><p class="explain">Cada hijo juega estas partidas, la mitad a cada lado. 0 = sin pre-torneo.</p></div>
        <div class="ctl"><label for="ev-op">Rival</label><div class="ctl-in"><select id="ev-op" data-f="opponentId"><option value="">la reina (o la madre si no hay reina)</option>${S.nets.map((n) => `<option value="${esc(n.id)}" ${n.id === f.opponentId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></div></div>
        <div class="ctl"><label for="ev-s">Soldados por bando</label><div class="ctl-in"><select id="ev-s" data-f="soldiers">${[['random', 'al azar, el mismo para todos'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']].map(([v, t]) => `<option value="${v}" ${String(f.soldiers) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        ${M.atLevel('cientifico', level()) ? `<div class="ctl"><label for="ev-seed">Semilla</label><div class="ctl-in"><input id="ev-seed" class="numin mono" type="number" min="0" step="1" value="${esc(f.seed)}" data-f="seed"></div><p class="explain">Misma semilla, mismos hijos. Vacía: una al azar.</p></div>` : ''}
      </fieldset>
      <h3>Qué puede cambiar</h3>
      ${mutationHTML()}
      <p class="bad" id="evErrors" role="alert"></p>
      <button type="submit" class="primary">Criar hijos</button>
    </form>`;
  }

  // ---------- trabajos, ranking y diferencias ----------
  function jobsHTML() {
    if (!S.jobs.length) return '<p class="empty">Aún no has criado hijos.</p>';
    return `<ul class="tr-list">${S.jobs.map((j) => `<li><button type="button" data-job="${esc(j.id)}" class="${j.id === S.sel ? 'on' : ''}"><b>${esc(nameOf(j.netId))}</b> <span class="mono dim">${esc(j.id)}</span><span class="st st-${esc(j.status)}">${esc(STATUS[j.status] || j.status)}</span><span class="mono dim">${j.progress ? `${j.progress.done} de ${j.progress.total}` : ''}</span></button></li>`).join('')}</ul>`;
  }
  function rankingHTML() {
    const j = S.job;
    if (!j) return '';
    if (j.status === 'error') return `<p class="bad">${esc(j.error)}</p>`;
    if (j.status !== 'done') return `<p class="dim">Jugando el pre-torneo: ${j.progress ? `${j.progress.done} de ${j.progress.total} partidas` : ''}.</p>`;
    const res = j.result || {};
    const rows = E.rankingRows(res.ranking);
    return `<p class="dim">Hijas de ${esc(nameOf(res.parentId))}${res.opponentId ? ` contra ${esc(nameOf(res.opponentId))}` : ''}${res.soldiers ? `, ${esc(res.soldiers)} por bando` : ''}${Number.isInteger(res.seed) ? `, semilla <span class="mono">${res.seed}</span>` : ''}.</p>
      <table class="nets-table rank"><thead><tr><th class="num">#</th><th>Hija</th><th class="num">Victorias</th><th class="num">Dif. bajas</th><th class="num">Bajas / muertes</th><th>Qué cambió</th><th><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.best ? 'best' : ''}"><td class="num">${r.pos}</td>
        <th scope="row"><span class="cell-net"><span class="em" aria-hidden="true">${net(r.id) ? emblemSVG(net(r.id).emblem, 26) : ''}</span><span><b>${esc(r.name)}</b><span class="mono dim">${esc(r.id)}</span></span></span></th>
        <td class="num">${r.wins}</td><td class="num">${r.killDiff > 0 ? '+' : ''}${r.killDiff}</td><td class="num">${r.kills} / ${r.deaths}</td>
        <td><ul class="ops">${r.opsText.length ? r.opsText.map((t) => `<li>${esc(t)}</li>`).join('') : '<li class="dim">solo pesos</li>'}</ul></td>
        <td class="acts"><button type="button" class="small" data-diff="${esc(r.id)}" data-parent="${esc(res.parentId)}">Diferencias</button> <a class="btn small" href="#editor/${esc(r.id)}">Retocar</a></td></tr>`).join('')}</tbody></table>`;
  }
  function diffHTML() {
    const d = S.diff;
    if (!d) return '';
    const [a, b] = S.diffPair;
    const s = E.diffSummary(d);
    const blocks = (d.blocks || []).map((x) => `<li class="blk st-${esc(x.status)}"><span class="bn">${esc(x.name)}</span><span class="bs">${esc(BSTATUS[x.status] || x.status)}</span><span class="mono br">${x.status === 'same' ? '' : pct(x.relChange)}</span>
      <span class="heat" role="img" aria-label="cambio por unidad de ${esc(x.name)}">${(x.heat || []).map((v) => `<i style="background:${E.heatColor(v)}" title="${esc((Math.round(v * 100) / 100).toFixed(2))}"></i>`).join('')}</span></li>`).join('');
    const wires = (list) => list.map((w) => `<span class="mono">${esc(w.from)} → ${esc(w.to)}</span>`).join(', ');
    return `<section class="diff" id="evDiff" aria-labelledby="hDiff"><h2 id="hDiff">${esc(nameOf(a))} frente a ${esc(nameOf(b))}</h2>
      <p class="facts-line"><span><b class="mono">${s.changed}</b> bloques cambiados</span><span><b class="mono">${s.added}</b> nuevos</span><span><b class="mono">${s.removed}</b> quitados</span><span><b class="mono">${s.same}</b> iguales</span><span><b class="mono">${s.wiresAdded}</b> cables nuevos</span><span><b class="mono">${s.wiresRemoved}</b> quitados</span>${s.imaginationChanged ? '<span>la Imaginación cambió</span>' : ''}</p>
      ${(d.text || []).length ? `<ul class="ops big">${d.text.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <p class="hint">Cada casilla es una neurona (o una entrada) del bloque: cuanto más clara, más cambiaron sus pesos. El % es el cambio total del bloque respecto a ${esc(nameOf(b))}.</p>
      <ul class="blocks-diff">${blocks}</ul>
      ${s.wiresAdded || s.wiresRemoved ? `<p>${s.wiresAdded ? `Cables nuevos: ${wires(d.wires.added)}. ` : ''}${s.wiresRemoved ? `Cables quitados: ${wires(d.wires.removed)}.` : ''}</p>` : ''}
      ${s.traits.length ? `<p>Rasgos: ${s.traits.map((t) => `${esc((catalog.traits.find((x) => x.key === t.key) || {}).name || t.key)} <span class="mono">${esc(t.before)}</span> → <span class="mono">${esc(t.after)}</span>`).join(' · ')}</p>` : ''}
    </section>`;
  }
  function compareHTML() {
    const opts = (v) => `<option value="">elige…</option>${S.nets.map((n) => `<option value="${esc(n.id)}" ${n.id === v ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}`;
    return `<form class="cmp" id="evCmp"><b>Comparar dos redes</b> <select data-cmp="a" aria-label="Red">${opts(S.cmp.a)}</select> frente a <select data-cmp="b" aria-label="Otra red">${opts(S.cmp.b)}</select> <button type="submit">Ver diferencias</button></form>`;
  }
  function render() {
    if (!S.form) S.form = defaults();
    root.innerHTML = `<div class="tr-left">${formHTML()}</div><section class="tr-right" aria-label="Hijos" id="evRight"></section>`;
    renderRight();
  }
  // la columna derecha se repinta sola (SSE, selección, diferencias): el formulario no pierde lo que estás escribiendo
  function renderRight() {
    const el = root.querySelector('#evRight');
    if (el) el.innerHTML = `<h2 class="sr">Hijos</h2>${jobsHTML()}${rankingHTML()}${compareHTML()}${diffHTML()}`;
  }

  // ---------- eventos ----------
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.cmp) { S.cmp[el.dataset.cmp] = el.value; return; }
    if (el.dataset.mut) {
      const t = catalog.mutation.find((x) => x.key === el.dataset.mut);
      const p = t && t.params.find((x) => x.key === el.dataset.p);
      if (!p) return;
      const cur = S.form.mutation[t.key];
      if (p.type === 'set') cur[p.key] = [...root.querySelectorAll(`[data-mut="${CSS.escape(t.key)}"][data-p="${CSS.escape(p.key)}"]`)].filter((x) => x.checked).map((x) => x.dataset.opt);
      else cur[p.key] = M.coerce(p, el.type === 'checkbox' ? el.checked : el.value, cur[p.key]);
      if (p.key === 'on') el.closest('fieldset').classList.toggle('idle', !el.checked);
      return;
    }
    if (el.dataset.f) { S.form[el.dataset.f] = el.value; if (el.dataset.f === 'parent') render(); }
  });
  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.target.id === 'evCmp') {
      if (!S.cmp.a || !S.cmp.b || S.cmp.a === S.cmp.b) { toast('Elige dos redes distintas.', 'error'); return; }
      showDiff(S.cmp.a, S.cmp.b);
      return;
    }
    if (ev.target.id !== 'evForm') return;
    const errs = root.querySelector('#evErrors');
    if (!S.form.parent) { errs.textContent = 'Elige la madre.'; return; }
    const { body, errors } = E.childrenBody(S.form);
    errs.textContent = errors.join(' ');
    if (!body) return;
    const r = await api(`/api/lab/nets/${encodeURIComponent(S.form.parent)}/children`, 'POST', body);
    if (!r.ok) { errs.textContent = reasonOf(r); return; }
    toast(`Criando ${body.n} hijos (trabajo ${r.body.jobId}).`);
    S.sel = r.body.jobId; S.diff = null;
    await loadAll();
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.job) { S.sel = b.dataset.job; S.job = S.jobs.find((x) => x.id === S.sel) || null; S.diff = null; renderRight(); return; }
    if (b.dataset.diff) showDiff(b.dataset.diff, b.dataset.parent);
  });

  return {
    async start() {
      await loadAll();
      if (es) return;
      es = [hub.on(LAB_EVENTS, 'job', (j) => {
        if (j.kind !== 'children') return;
        const i = S.jobs.findIndex((x) => x.id === j.id);
        if (i >= 0) S.jobs[i] = { ...S.jobs[i], ...j }; else S.jobs.unshift(j);
        if (j.id === S.sel) S.job = S.jobs.find((x) => x.id === S.sel);
        if (j.status !== 'running') refresh(); else renderRight();
      }), hub.on(LAB_EVENTS, 'children', refresh)];
    },
    stop() { if (es) { es.forEach((off) => off()); es = null; } clearTimeout(timer); },
  };
}
