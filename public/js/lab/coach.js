// Guía «Tu primera red» (P6, sesión 10): lo que ve quien empieza Desde cero. El usuario (s9): el tutorial "sigue sin ser
// didáctico y explicativo; busca bien cómo se hace un buen tutorial". Lo que sale de la investigación (plan2, fila
// "Sesión 10", con fuentes):
//  - una pregunta antes de cada cosa (Nicky Case: "make them love your question");
//  - de lo concreto a lo general, una pieza nueva cada vez y explicada donde se usa (Bret Victor, "start constant, then
//    vary"; Human Resource Machine empieza con dos órdenes; Andersen et al., CHI 2012: tutoriales pegados a lo que enseñan);
//  - primero se hace, luego se ve el efecto con los números de verdad del banco y luego se explica (Victor: "show the data");
//  - apuesta antes de ver ("Place your bets", Case);
//  - un giro que cambia lo aprendido (kishōtenketsu de Super Mario 3D World, Hayashida / GMTK);
//  - ayuda que se retira: "Hazlo por mí" en los primeros pasos, solo una pista después (ejemplos resueltos que se
//    desvanecen, Renkl y Atkinson 2004);
//  - escenas de menos a más, como el plan de entreno de NERO (Stanley): una torreta, dos, luego muros;
//  - y al final, caja de arena ("Sandbox mode", Case).
// Lógica pura, sin DOM: la usa editor.js y la prueba test/ui-coach.spec.mjs. Un paso hecho se queda hecho aunque luego
// cambies la red (la guía no vuelve atrás por quitar un bloque).

const has = (g, t) => (g.blocks || []).some((b) => b.type === t);
const find = (g, t) => (g.blocks || []).find((b) => b.type === t) || null;
const ins = (g, id) => (g.wires || []).filter((w) => w.to === id).map((w) => w.from);
const outs = (g, id) => (g.wires || []).filter((w) => w.from === id).map((w) => w.to);
const MEMORY = ['echo', 'gru', 'lstm', 'teamMemory'];
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '—');
const ready = (x, key) => !!(x.readiness || []).find((r) => r.key === key && r.ok);

// cada paso: key · title · ask (la pregunta) · todo (lo que hay que hacer) · target (qué se ilumina) · help (lo que hace
// "Hazlo por mí", o null) · done(g, x) · after(x) (lo que ha cambiado, con números reales)
export const STEPS = [
  { key: 'ojos', title: 'Que imagine tiros',
    ask: 'Abajo a la derecha, en el banco de pruebas, tu soldado (el blanco) tiene un enemigo enfrente. ¿Cómo decide una red adónde disparar? Ahora mismo no ve nada: está vacía.',
    todo: 'Añade 🎯 Candidatos (a la izquierda, en Ojos).', target: '.pal [data-add="eye.candidates"]', help: { add: ['eye.candidates'] },
    done: (g) => has(g, 'eye.candidates') || has(g, 'eye.simulator'),
    after: (x) => `Cada turno, tu red se imagina ${x.cands ?? 'varios'} tiros posibles: rectas, senos, parábolas… Todavía no los usa nadie: falta quien escoja. De cada uno saca ${x.candDim ?? 'unos'} números (su familia, su forma, a qué distancia pasa de cada enemigo): eso es lo que «ve» una red, números.` },
  { key: 'manos', title: 'Que escoja uno',
    ask: 'Imaginar no es disparar. ¿Quién decide cuál de esos tiros sale?',
    todo: 'Añade 🎯 Elegir (a la izquierda, en Manos).', target: '.pal [data-add="hand.choose"]', help: { add: ['hand.choose'] },
    done: (g) => has(g, 'hand.choose'),
    after: () => 'Elegir da una nota a cada tiro imaginado y sortea cuál sale: el de más nota tiene más papeletas, pero no siempre gana. Aún no recibe nada: falta el cable.' },
  { key: 'cable', title: 'Únelos con un cable',
    ask: 'Los bloques no se hablan solos. ¿Por dónde le llegan a Elegir los tiros imaginados?',
    todo: 'Arrastra desde el círculo de la derecha de Candidatos hasta Elegir (se pone verde donde vale).', target: 'port', help: { wire: ['eye.candidates', 'hand.choose'] },
    done: (g, x) => ready(x, 'fed'),
    after: (x) => `¡Ya puede jugar! En el banco, las curvas tenues son los ${x.cands ?? ''} tiros que imagina y la blanca, el que escoge${x.pick ? ` (el #${x.pick.i}, con probabilidad ${f2(x.pick.p)})` : ''}. Los puntos de cada tarjeta son sus neuronas, encendidas con la señal de esa escena.` },
  { key: 'apuesta', title: '¿Ha escogido bien?', bet: true,
    ask: 'Mira el tiro blanco del banco. Antes de seguir, apuesta: ¿crees que tu red sabe apuntar?',
    todo: 'Elige una respuesta.', target: '.coach-bet', help: null,
    done: (g, x) => !!x.bet,
    after: (x) => `${x.bet === 'no' ? 'Bien visto.' : x.bet === 'si' ? 'Aún no.' : 'Normal no saberlo.'} Su certeza es ${f2(x.pick && x.pick.certainty)} (0 = duda total; 1 = segura del todo): sin entrenar, sus pesos son números al azar y escoge casi a ciegas. Cambia la «Semilla» del banco y verás que escoge otro. Aprender es ajustar esos pesos jugando: eso es la etapa 2.` },
  { key: 'pensar', title: 'Que piense antes de escoger',
    ask: 'Ahora Elegir puntúa cada tiro con una sola suma de lo que ve: como decidir mirando una sola cosa. ¿Y si pudiera combinar lo que ve antes de puntuar?',
    todo: 'Pulsa el cable Candidatos → Elegir y, en su ＋, añade 🧠 Instinto.', target: 'wire', help: { insert: 'dense' },
    done: (g, x) => ready(x, 'think'),
    after: (x) => `Cada tiro pasa ahora por ${x.think ?? 'unas'} neuronas antes de puntuarse: cada una mezcla lo que ve a su manera (una puede fijarse en «pasa cerca del enemigo», otra en «es un seno»). Más neuronas = más matices, y más lento de entrenar.` },
  { key: 'giro', title: 'Un giro: una roca en medio', scene: 'roca',
    ask: 'Hasta ahora el enemigo estaba a la vista. ¿Qué pasa si una roca tapa el tiro directo?',
    todo: 'En el banco, pulsa la escena «Tras una roca».', target: '[data-scene="roca"]', help: { scene: 'roca' },
    done: (g, x) => x.scene === 'roca',
    after: () => 'Los tiros que chocan se paran en la roca (y le arrancan un bocado). Candidatos le dice a tu red si cada tiro choca: entrenada, aprenderá a escoger los que pasan por encima o por debajo. Sin entrenar, le da igual.' },
  { key: 'pies', title: 'Que se mueva después de disparar',
    ask: 'Tras cada disparo, un soldado quieto es un blanco fácil. ¿Adónde debería ir?',
    todo: 'Añade 🦶 Destinos (en Ojos) y 🦶 Moverse (en Pies) y une Destinos con Moverse.', target: '.pal [data-add="eye.moves"]', help: { add: ['eye.moves', 'foot.move'], wire: ['eye.moves', 'foot.move'] },
    done: (g) => { const m = find(g, 'foot.move'), d = find(g, 'eye.moves'); return !!m && !!d && ins(g, m.id).length > 0; },
    after: () => 'Después de disparar escoge uno de 9 sitios: quedarse o 8 direcciones a 1,5 u. Pedir un sitio imposible (dentro de una roca, pegado a otro soldado…) le hace perder el movimiento. En el banco, «Moverse» enseña lo que escogería.' },
  { key: 'memoria', title: 'Que recuerde',
    ask: 'Cada turno tu red empieza de cero: no sabe si su último tiro se quedó corto o se pasó. ¿Cómo podría acordarse?',
    todo: 'Añade 📊 Rasgos (Ojos) y 🌀 Eco (Memoria), une Rasgos → Eco y Eco → tu Instinto.', target: '.pal [data-add="echo"]', help: { add: ['eye.features', 'echo'], wire: ['eye.features', 'echo'], wire2: ['echo', 'dense'] },
    done: (g) => (g.blocks || []).some((b) => MEMORY.includes(b.type) && outs(g, b.id).length > 0 && ins(g, b.id).length > 0),
    after: () => 'Eco guarda lo que saca de un turno para el siguiente: así puede aprender «el último se quedó corto, este más largo». Como es contexto (una vez por turno), se junta con cada tiro al entrar en tu Instinto.' },
  { key: 'guardar', title: 'Guárdala y mírala jugar',
    ask: 'Tu red ya ve, piensa, recuerda, dispara y se mueve. ¿Cómo juega de verdad?',
    todo: 'Guárdala (botón Guardar o Ctrl+S) y pulsa «Probar ya»: una partida contra Vidente, aquí mismo.', target: '[data-act="save"]', help: null,
    done: (g, x) => !!x.saved && !!x.probed,
    after: () => 'Así juega sin entrenar: casi al azar. Lo siguiente es entrenarla (etapa 2) para que aprenda de sus partidas. Aquí puedes seguir cambiando lo que quieras: pasa el ratón por cualquier bloque de la izquierda y te dice qué hace y dónde iría.' },
];

// la guía en un momento dado: {i, step, doneKeys, finished, justDone}. `marked` = claves ya hechas (se guardan)
export function coachState(genome, x = {}, marked = []) {
  const g = genome || { blocks: [], wires: [] };
  const doneKeys = new Set(marked);
  let justDone = null;
  for (const s of STEPS) {
    if (doneKeys.has(s.key)) continue;
    if (s.done(g, x)) { doneKeys.add(s.key); justDone = s.key; continue; }
    break;
  }
  const i = STEPS.findIndex((s) => !doneKeys.has(s.key));
  return { i: i < 0 ? STEPS.length : i, step: i < 0 ? null : STEPS[i], doneKeys: [...doneKeys], finished: i < 0, justDone };
}

// "Hazlo por mí" solo en los tres primeros pasos; después, la ayuda se retira a una pista (ejemplos que se desvanecen)
export const helpOffered = (i) => i < 3;
