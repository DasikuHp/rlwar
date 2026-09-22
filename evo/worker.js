// Hilo de entreno (spec/04 §5): recibe {type:'play', seed, left, right, soldiers} y devuelve
// {type:'done', playerId, result, events, trajectories, kills, deaths, win}. Solo juega (forward);
// el hilo principal aprende. Los genomas viajan inline: el hilo no toca el almacén.
import { parentPort } from 'node:worker_threads';
import { playOne } from './train.js';

parentPort.on('message', (m) => {
  if (!m || m.type !== 'play') return;
  try {
    const r = playOne({ seed: m.seed, left: m.left, right: m.right, soldiers: m.soldiers });
    parentPort.postMessage({ type: 'done', ...r });
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: e.message });
  }
});
