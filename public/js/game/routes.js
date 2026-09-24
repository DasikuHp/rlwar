// Rutas del juego (P5): qué pantalla, etapa y pestaña dice el `#` de la dirección. Puro (sin DOM): lo usa main.js.
// Las 4 etapas de referencianoabsoluta.png: 1 Crear · 2 Entrenar y evolucionar · 3 Duelo en vivo · 4 Trono y análisis.
// Los enlaces viejos del laboratorio (#editor, #entreno, #trono…) siguen valiendo: llevan a su etapa y pestaña.
export const STAGES = [
  { key: 'crear', n: 1, title: 'Crear / diseñar tu red', short: 'Crear', sub: 'Construye una inteligencia a tu medida. Arrastra, conecta y explora.',
    tabs: [{ key: 'editor', name: 'Editor' }, { key: 'redes', name: 'Tus redes' }] },
  { key: 'entrenar', n: 2, title: 'Entrenar y evolucionar', short: 'Entrenar', sub: 'Observa cómo aprende, genera hijas y selecciona a las mejores.',
    tabs: [{ key: 'entrenamiento', name: 'Entrenamiento' }, { key: 'evolucion', name: 'Evolución' }] },
  { key: 'duelo', n: 3, title: 'Ver en acción / duelo', short: 'Duelo', sub: 'Mira pensar a las redes en tiempo real. Todo lo que ves sale de la partida.',
    tabs: [{ key: 'vivo', name: 'En vivo' }] },
  { key: 'trono', n: 4, title: 'Resultados, trono y análisis', short: 'Trono', sub: 'Sigue la historia. Solo la retadora gana el trono; los empates lo conservan.',
    tabs: [{ key: 'trono', name: 'Trono y duelos' }, { key: 'dinastias', name: 'Dinastías' }, { key: 'verdad', name: 'Verdad' }, { key: 'cirugia', name: 'Quirófano' }] },
];
const ID = '[a-z0-9-]{3,32}';
const CODE = '[A-Z0-9]{4}';
const LEGACY = {
  '#inicio': ['crear', 'redes'], '#entreno': ['entrenar', 'entrenamiento'], '#evolucion': ['entrenar', 'evolucion'],
  '#trono': ['trono', 'trono'], '#dinastias': ['trono', 'dinastias'], '#verdad': ['trono', 'verdad'], '#cirugia': ['trono', 'cirugia'],
};

// hash → {screen: 'portada'|'stage'|'room', stage, tab, id, code}
export function parseRoute(hash = '') {
  const h = String(hash || '');
  let m;
  if ((m = new RegExp(`^#room=(${CODE})$`, 'i').exec(h))) return { screen: 'room', stage: 'duelo', tab: 'vivo', id: null, code: m[1].toUpperCase() };
  if (h === '#crear/redes') return { screen: 'stage', stage: 'crear', tab: 'redes', id: null, code: null };
  if (h === '#crear/editor') return { screen: 'stage', stage: 'crear', tab: 'editor', id: null, code: null };
  if ((m = new RegExp(`^#(?:editor|crear)(?:/(${ID}))?$`).exec(h))) return { screen: 'stage', stage: 'crear', tab: 'editor', id: m[1] || null, code: null };
  if (LEGACY[h]) return { screen: 'stage', stage: LEGACY[h][0], tab: LEGACY[h][1], id: null, code: null };
  if ((m = new RegExp(`^#duelo(?:/(${CODE}))?$`, 'i').exec(h))) return { screen: 'stage', stage: 'duelo', tab: 'vivo', id: null, code: m[1] ? m[1].toUpperCase() : null };
  if ((m = /^#(entrenar|trono)\/([a-z]+)$/.exec(h))) {
    const st = STAGES.find((s) => s.key === m[1]);
    if (st.tabs.some((t) => t.key === m[2])) return { screen: 'stage', stage: st.key, tab: m[2], id: null, code: null };
  }
  if ((m = /^#(entrenar|trono)$/.exec(h))) { const st = STAGES.find((s) => s.key === m[1]); return { screen: 'stage', stage: st.key, tab: st.tabs[0].key, id: null, code: null }; }
  return { screen: 'portada', stage: null, tab: null, id: null, code: null };
}

// {stage, tab, id, code} → hash
export function hrefOf({ stage, tab = null, id = null, code = null }) {
  if (stage === 'crear' && (!tab || tab === 'editor')) return id ? `#crear/${id}` : '#crear';
  if (stage === 'duelo') return code ? `#duelo/${code}` : '#duelo';
  const st = STAGES.find((s) => s.key === stage);
  return st ? `#${st.key}/${tab || st.tabs[0].key}` : '#portada';
}
