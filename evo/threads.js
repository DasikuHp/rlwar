// Grupo de hilos para las partidas sin pantalla (spec/04 §5): cada hilo juega (forward) lo que le mandan y el hilo
// principal aprende. Los genomas viajan inline: el hilo no toca el almacén.
// El servidor crea su grupo al arrancar (`useThreads`, auditoría s3): así los duelos turbo, el boletín, el pre-torneo de
// hijas y los entrenos turbo de 1 hilo se juegan fuera de su hilo y sigue contestando. Sin él (tests, arena), todo se
// juega en el proceso. Es el mismo código: misma semilla, mismo resultado.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const WORKER_FILE = fileURLToPath(new URL('./worker.js', import.meta.url));
export class Pool {
  constructor(n) { this.workers = Array.from({ length: n }, () => new Worker(WORKER_FILE)); this.free = this.workers.slice(); this.queue = []; }
  // `onProgress` recibe los avisos {type: 'progress'} que mande el hilo antes de acabar
  run(msg, onProgress = null) {
    return new Promise((resolve, reject) => {
      const go = (w) => {
        const settle = (next) => { w.off('message', onMsg); w.off('error', onErr); this.free.push(next); this.pump(); };
        const onMsg = (m) => {
          if (m && m.type === 'progress') { if (onProgress) onProgress(m); return; }
          settle(w); if (m.type === 'error') reject(new Error(m.message)); else resolve(m);
        };
        // un hilo que revienta no vuelve al grupo: lo sustituye uno nuevo
        const onErr = (e) => { const fresh = new Worker(WORKER_FILE); this.workers[this.workers.indexOf(w)] = fresh; w.terminate(); settle(fresh); reject(e); };
        w.on('message', onMsg); w.on('error', onErr); w.postMessage(msg);
      };
      this.queue.push(go); this.pump();
    });
  }
  pump() { while (this.free.length && this.queue.length) this.queue.shift()(this.free.pop()); }
  close() { for (const w of this.workers) w.terminate(); }
}

let shared = null;
export function useThreads(n) { if (!shared) shared = new Pool(n); return shared; }
export const threads = () => shared;
