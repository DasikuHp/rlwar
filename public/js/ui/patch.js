// Parche del DOM (P5): `patch(root, html)` deja dentro de `root` lo mismo que `root.innerHTML = html`, pero tocando solo
// lo que cambia. Los nodos que siguen ahí se conservan, y con ellos el foco, el cursor de un campo, el scroll, un
// <details> abierto, lo pintado en un <canvas> y las animaciones que estén corriendo: así nada parpadea cuando llega el
// SSE. Los hijos se emparejan por `data-key` si lo llevan; si no, por posición y etiqueta.
// Lo que escribe o elige el usuario (campos, casillas, desplegables) solo cambia si la vista cambia de idea, es decir,
// si cambia el atributo `value`, `checked` o `selected` respecto al parche anterior; abierto/cerrado de un <details> lo
// decide quien lo pulsa. Un elemento con `data-keep` no se toca por dentro (lo gestiona otro código).
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
const marked = (sel) => [...sel.querySelectorAll('option')].findIndex((o) => o.hasAttribute('selected'));

export function patch(root, html) {
  const tpl = root.ownerDocument.createElement('template');
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}

function patchChildren(from, to) {
  const keyed = new Map();
  for (const n of from.childNodes) { const k = keyOf(n); if (k !== null) keyed.set(k, n); }
  let cur = from.firstChild;
  for (const next of [...to.childNodes]) {
    const k = keyOf(next);
    let match = null;
    if (k !== null) { match = keyed.get(k) || null; keyed.delete(k); }
    else if (cur && keyOf(cur) === null && cur.nodeType === next.nodeType && cur.nodeName === next.nodeName) match = cur;
    if (match && match.nodeName !== next.nodeName) match = null;
    if (!match) { from.insertBefore(next, cur); continue; }
    if (match === cur) cur = cur.nextSibling;
    else from.insertBefore(match, cur);
    patchNode(match, next);
  }
  while (cur) { const n = cur.nextSibling; from.removeChild(cur); cur = n; }
}

function patchNode(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  const tag = a.nodeName;
  if (tag === 'INPUT' && a.type !== 'file') {
    if (a.getAttribute('value') !== b.getAttribute('value')) a.value = b.getAttribute('value') ?? '';
    if (a.hasAttribute('checked') !== b.hasAttribute('checked')) a.checked = b.hasAttribute('checked');
  }
  if (tag === 'TEXTAREA' && a.defaultValue !== b.textContent) { a.defaultValue = b.textContent; a.value = b.textContent; }
  const oldMark = tag === 'SELECT' ? marked(a) : -1;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(name === 'open' && tag === 'DETAILS')) a.removeAttribute(name);
  for (const { name, value } of b.attributes) if (!(name === 'open' && tag === 'DETAILS') && a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (tag === 'TEXTAREA' || a.hasAttribute('data-keep')) return;
  patchChildren(a, b);
  if (tag === 'SELECT') { const m = marked(a); if (m !== oldMark) a.selectedIndex = Math.max(0, m); }
}
