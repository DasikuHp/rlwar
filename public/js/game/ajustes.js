// Ajustes del juego (P5): se guardan en este navegador. Cada opción dice qué cambia, con un ejemplo.
const KEY = 'graphwar.ajustes';
export const SETTINGS = [
  { key: 'quality', name: 'Calidad gráfica', options: [
    { v: 'alta', name: 'Alta', help: 'Fondo animado con todas sus partículas y la constelación latiendo. Para un ordenador normal.' },
    { v: 'media', name: 'Media', help: 'La mitad de partículas. Si notas el ventilador o tirones en la portada.' },
    { v: 'baja', name: 'Baja', help: 'Fondo quieto, solo la constelación. Para portátiles viejos o con batería.' },
  ] },
  { key: 'motion', name: 'Movimiento', options: [
    { v: 'sistema', name: 'Como el sistema', help: 'Si Windows tiene "reducir animaciones", el juego también las reduce.' },
    { v: 'reducir', name: 'Reducir siempre', help: 'Sin animaciones de entrada ni fondo en movimiento (los tiros se siguen dibujando).' },
    { v: 'completo', name: 'Completo siempre', help: 'Todas las animaciones, aunque el sistema pida reducirlas.' },
  ] },
  { key: 'speed', name: 'Velocidad por defecto', options: [
    { v: 'x10', name: 'x10', help: 'Las partidas se ven en directo, diez veces más rápido. Ejemplo: un duelo de 6 partidas en ~1 minuto.' },
    { v: 'x1', name: 'x1', help: 'A la velocidad del original: para mirar cada tiro con calma.' },
    { v: 'turbo', name: 'Turbo', help: 'Sin pantalla, en hilos: lo más rápido; solo ves el resultado y la moviola.' },
  ] },
];
const DEFAULTS = { quality: 'alta', motion: 'sistema', speed: 'x10' };

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  const out = { ...DEFAULTS };
  for (const def of SETTINGS) if (def.options.some((o) => o.v === s[def.key])) out[def.key] = s[def.key];
  return out;
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: solo esta vez */ } }
// ¿hay que reducir el movimiento? (el ajuste manda; "como el sistema" mira prefers-reduced-motion)
export function reduceMotion(s) {
  if (s.motion === 'reducir') return true;
  if (s.motion === 'completo') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
