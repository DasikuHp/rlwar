// Ajustes del juego (P5): se guardan en este navegador. Cada opción dice qué cambia, con un ejemplo.
const KEY = 'graphwar.ajustes';
export const SETTINGS = [
  { key: 'quality', name: 'Calidad gráfica', options: [
    { v: 'alta', name: 'Alta', help: 'Fondo animado con todas sus partículas y la constelación latiendo. Para un ordenador normal.' },
    { v: 'media', name: 'Media', help: 'La mitad de partículas. Si notas el ventilador o tirones en la portada.' },
    { v: 'baja', name: 'Baja', help: 'Fondo quieto, solo la constelación; en el duelo, sin brillos ni chispas. Para portátiles viejos o con batería.' },
  ] },
  { key: 'fluid', name: 'Tinta de la portada', options: [
    { v: 'suave', name: 'Suave', help: 'La tinta del fondo se ve poco y se apaga pronto: acompaña sin distraer.' },
    { v: 'intensa', name: 'Intensa', help: 'Remolinos grandes y de color vivo al mover el ratón, como un fluido de verdad a plena potencia.' },
    { v: 'apagada', name: 'Apagada', help: 'Sin tinta: detrás de las curvas, el fondo azul noche quieto.' },
  ] },
  { key: 'motion', name: 'Movimiento', options: [
    { v: 'sistema', name: 'Como el sistema', help: 'Si Windows tiene "reducir animaciones", el juego también las reduce.' },
    { v: 'reducir', name: 'Reducir siempre', help: 'Sin animaciones de entrada ni fondo en movimiento (los tiros se siguen dibujando).' },
    { v: 'completo', name: 'Completo siempre', help: 'Todas las animaciones, aunque el sistema pida reducirlas.' },
  ] },
  { key: 'speed', name: 'Velocidad de duelos y retos', options: [
    { v: 'x10', name: 'x10', help: 'Las partidas se ven en directo, diez veces más rápido. Ejemplo: un duelo de 6 partidas en ~1 minuto.' },
    { v: 'x1', name: 'x1', help: 'A la velocidad del original: para mirar cada tiro con calma.' },
    { v: 'turbo', name: 'Turbo', help: 'Sin pantalla, en hilos: lo más rápido; solo ves el resultado y la moviola.' },
  ], note: 'Es la que sale marcada al lanzar un duelo o un reto al trono (siempre puedes cambiarla ahí). El entreno empieza en turbo: son cientos de partidas.' },
];
const DEFAULTS = { quality: 'alta', motion: 'sistema', fluid: 'suave', speed: 'x10' };

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  const out = { ...DEFAULTS };
  for (const def of SETTINGS) if (def.options.some((o) => o.v === s[def.key])) out[def.key] = s[def.key];
  return out;
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: solo esta vez */ } }
// un ajuste cambiado se aplica al momento en todo el juego: todas las vistas comparten el mismo objeto y escuchan este aviso
export const SETTINGS_EVENT = 'gw:settings';
// ¿hay que reducir el movimiento? (el ajuste manda; "como el sistema" mira prefers-reduced-motion)
export function reduceMotion(s) {
  if (s.motion === 'reducir') return true;
  if (s.motion === 'completo') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
