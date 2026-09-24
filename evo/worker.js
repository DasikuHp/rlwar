// Hilo de partidas sin pantalla (spec/04 §5; evo/threads.js). Solo juega (forward); el hilo principal aprende. Los
// genomas viajan inline: el hilo no toca el almacén. Mensajes:
//  - {type:'play', seed, left, right, soldiers} → {type:'done', playerId, result, events, trajectories, kills, deaths, win}
//  - {type:'duel', row, left, right, save} → {type:'done', value}: una partida de duelo turbo y su resumen (evo/duel.js);
//    con `save`, también empaquetada para guardarla (el hilo principal solo escribe el fichero)
//  - {type:'pre', spec} → {type:'done', value: {win, kills, deaths}}: una partida del pre-torneo de hijas
//  - {type:'bulletin', subject} → {type:'progress', args} por escena y {type:'done', value}: el boletín entero
// Cualquier fallo → {type:'error', message}.
import { parentPort } from 'node:worker_threads';
import { playOne } from './train.js';
import { playTurboGame } from './duel.js';
import { defaultPlay } from './children.js';
import { runBulletin } from './exam.js';

parentPort.on('message', async (m) => {
  try {
    if (m && m.type === 'play') parentPort.postMessage({ type: 'done', ...playOne({ seed: m.seed, left: m.left, right: m.right, soldiers: m.soldiers }) });
    else if (m && m.type === 'duel') parentPort.postMessage({ type: 'done', value: playTurboGame(m.row, m.left, m.right, m.save) });
    else if (m && m.type === 'pre') parentPort.postMessage({ type: 'done', value: defaultPlay(m.spec) });
    else if (m && m.type === 'bulletin') {
      const value = await runBulletin(m.subject, { onScene: (...args) => parentPort.postMessage({ type: 'progress', args }) });
      parentPort.postMessage({ type: 'done', value });
    } else parentPort.postMessage({ type: 'error', message: `mensaje desconocido: ${m && m.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: e.message });
  }
});
