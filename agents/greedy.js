// Agente Greedy: líneas directas + plantillas aleatorias. Nivel = cuántos candidatos prueba.
import { MODES } from '../shared/constants.js';
import { search, contextFor, directShots, randomTemplates, avoidRepeats, pickWeighted, addMissNoise, withVoice } from './lib.js';

export const meta = {
  id: 'greedy', name: 'Greedy', icon: '🧠',
  description: 'Prueba líneas directas y muchas plantillas aleatorias; elige la mejor.',
  banter: {
    intro: ['Voy a farmearos.', 'Treinta funciones y una lleva tu nombre.', 'Hoy estoy eficiente.', 'A por el kill.'],
    kill: ['¡Kill conseguida!', '{victim}, has sido outfarmeado.', 'Eficiencia máxima.', 'Otra muesca.'],
  },
};

const SAY = ['Mía.', 'Farmeando.', 'Esta es buena.', 'Optimizado.', 'Te leo como una función.', 'GG.'];

export function create({ level = 2, temperature = 0 } = {}) {
  const tmp = Math.max(0, Math.min(1, Number(temperature) || 0));
  const lvl = Math.max(1, Math.min(3, level | 0));
  const weights = lvl === 3 ? [0.7, 0.2, 0.1] : lvl === 2 ? [0.55, 0.3, 0.15] : [0.4, 0.35, 0.25];
  return {
    meta,
    chooseShot({ soldiers, obstacles, soldier, history = [] }) {
      const ctx = contextFor(soldiers, obstacles, soldier);
      const cands = avoidRepeats(
        [...directShots(ctx, { jitter: 0.05 + tmp * 0.15, count: 6 }), ...randomTemplates(12 + lvl * 12)],
        history,
      );
      const ranked = search(ctx, cands, { topN: 4 });
      const sigma = [0, 0.03, 0.015, 0.008][lvl] + tmp * 0.02;
      const shot = addMissNoise(
        pickWeighted(ranked, weights, tmp) || { mode: MODES.FUNCTION, expr: '0.1*x' },
        sigma,
      );
      return withVoice(shot, ctx, SAY);
    },
  };
}
