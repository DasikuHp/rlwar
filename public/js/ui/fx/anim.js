// Capa de animación (P5): el ÚNICO sitio que toca las librerías de public/vendor (VENDOR.md). Las carga bajo demanda
// (una etiqueta <script> cada una, una sola vez) y, si falta alguna, no hay navegador o está "reducir movimiento", cada
// función no hace nada: el juego funciona igual, sin esa animación. Las vistas y los módulos puros no importan las
// librerías, solo este fichero.
//   GSAP → escenas: entrada de la portada, cambio de etapa.   Motion → microinteracciones: botones con muelle, la ficha.
//   tsParticles → partículas de la portada.                   Lenis → scroll suave en la ficha.
const V = '/vendor';
const SRC = {
  gsap: [`${V}/gsap@3.15.0/gsap.min.js`],
  gsapPlugins: ['SplitText', 'Flip', 'CustomEase', 'DrawSVGPlugin', 'MotionPathPlugin'].map((p) => `${V}/gsap@3.15.0/${p}.min.js`),
  motion: [`${V}/motion@13.4.2/motion.js`],
  particles: [`${V}/tsparticles-slim@4.4.0/tsparticles.slim.bundle.min.js`],
  lenis: [`${V}/lenis@1.3.26/lenis.min.js`],
};
const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
let userReduce = false;
export function setReduce(v) { userReduce = !!v; }
export const reduced = () => userReduce || (hasDOM && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const loading = new Map();
function script(src) {
  if (!loading.has(src)) loading.set(src, new Promise((ok) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => ok(true); s.onerror = () => ok(false);
    document.head.appendChild(s);
  }));
  return loading.get(src);
}
async function lib(name, global) {
  if (!hasDOM) return null;
  if (window[global]) return window[global];
  const ok = (await Promise.all(SRC[name].map(script))).every(Boolean);
  return ok ? window[global] || null : null;
}
let gsapReady = null;
function getGsap() {
  return (gsapReady ||= (async () => {
    const g = await lib('gsap', 'gsap');
    if (!g) return null;
    await Promise.all(SRC.gsapPlugins.map(script));
    const plugins = ['SplitText', 'Flip', 'CustomEase', 'DrawSVGPlugin', 'MotionPathPlugin'].map((k) => window[k]).filter(Boolean);
    g.registerPlugin(...plugins);
    return g;
  })());
}

// ---------- GSAP: escenas ----------
// portada: el título letra a letra, el subtítulo y los botones del menú en cascada. Devuelve true si lo animó GSAP (y
// entonces la animación CSS de respaldo se apaga con la clase `fx-on`).
export async function introPortada({ title, sub, items }) {
  if (reduced()) return false;
  const g = await getGsap();
  if (!g || !title) return false;
  document.body.classList.add('fx-on');
  const tl = g.timeline({ defaults: { ease: 'power3.out' } });
  const split = window.SplitText ? new window.SplitText(title, { type: 'chars' }) : null;
  if (split) tl.from(split.chars, { opacity: 0, y: 28, filter: 'blur(8px)', duration: 0.9, stagger: 0.045 });
  else tl.from(title, { opacity: 0, y: 20, duration: 0.9 });
  if (sub) tl.from(sub, { opacity: 0, y: 10, letterSpacing: '0.6em', duration: 0.8 }, '-=0.5');
  if (items && items.length) tl.from(items, { opacity: 0, x: -24, duration: 0.55, stagger: 0.07 }, '-=0.45');
  return true;
}
// cambio de etapa o de pestaña: la vista entra con un deslizamiento corto
export async function enter(el) {
  if (!el || reduced()) return;
  const g = await getGsap();
  if (g) g.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'opacity,transform' });
}

// ---------- Motion: microinteracciones ----------
// botones con muelle al pulsar (y al pasar por encima, un poco). `selector` se evalúa sobre todo el documento.
let pressed = new Set();
export async function springButtons(selector) {
  if (reduced() || pressed.has(selector)) return;
  const M = await lib('motion', 'Motion');
  if (!M || !M.press) return;
  pressed.add(selector);
  M.press(selector, (el) => {
    if (reduced() || el.disabled) return undefined;
    M.animate(el, { scale: 0.96 }, { type: 'spring', stiffness: 600, damping: 30 });
    return () => M.animate(el, { scale: 1 }, { type: 'spring', stiffness: 500, damping: 18 });
  });
}
// la ficha: entra y sale con un muelle. `open` = true (entra desde la derecha) o false (se retrae)
export async function slide(el, open) {
  if (!el) return;
  if (reduced()) { el.style.transform = open ? '' : 'translateX(100%)'; return; }
  const M = await lib('motion', 'Motion');
  if (!M) { el.style.transform = open ? '' : 'translateX(100%)'; return; }
  await M.animate(el, { x: open ? ['100%', '0%'] : ['0%', '100%'] }, open ? { type: 'spring', stiffness: 260, damping: 30 } : { duration: 0.22, ease: 'easeIn' }).finished;
}

// ---------- tsParticles: partículas de la portada ----------
// polvo de estrellas cian y violeta que se aparta del ratón. Devuelve stop().
export async function particles(el, { quality = 'alta' } = {}) {
  if (!el || reduced() || quality === 'baja') return () => {};
  const T = await lib('particles', 'tsParticles');
  if (!T || !window.loadSlim) return () => {};
  await window.loadSlim(T);
  const c = await T.load({
    element: el,
    options: {
      fullScreen: { enable: false }, background: { color: 'transparent' }, fpsLimit: 60, detectRetina: true,
      particles: {
        number: { value: quality === 'alta' ? 90 : 45, density: { enable: true } },
        color: { value: ['#3fd0ff', '#8b6cff', '#a0c8ff'] },
        opacity: { value: { min: 0.15, max: 0.6 } }, size: { value: { min: 0.4, max: 1.8 } },
        move: { enable: true, speed: 0.25, direction: 'none', outModes: 'out' },
        links: { enable: quality === 'alta', distance: 110, opacity: 0.08, color: '#3fd0ff', width: 1 },
      },
      interactivity: { detectsOn: 'window', events: { onHover: { enable: true, mode: 'repulse' } }, modes: { repulse: { distance: 110, duration: 0.6 } } },
    },
  });
  return () => { try { c && c.destroy(); } catch { /* ya no está */ } };
}

// ---------- Lenis: scroll suave ----------
// dentro de un contenedor con su propio scroll (la ficha). Devuelve destroy().
export async function smoothScroll(wrapper, content) {
  if (!wrapper || reduced()) return () => {};
  const L = await lib('lenis', 'Lenis');
  if (!L) return () => {};
  const lenis = new L({ wrapper, content: content || wrapper.firstElementChild || wrapper, autoRaf: true, smoothWheel: true, lerp: 0.12 });
  return () => lenis.destroy();
}
