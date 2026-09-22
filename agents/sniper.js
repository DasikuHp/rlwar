// Agente Sniper: puntería de tirador (línea directa) con pulso humano: a más nivel,
// más clava la mejor opción, pero a veces falla como la IA evolutiva del original.
import { MODES } from '../shared/constants.js';
import { search, contextFor, directShots, avoidRepeats, pickWeighted, addMissNoise, withVoice, coverMove } from './lib.js';

export const meta = {
  id: 'sniper', name: 'Sniper', icon: '🎯',
  description: 'Cero ruido: apunta con la pendiente exacta y afina con arcos suaves.',
  banter: {
    intro: ['Ni pestañeo.', 'Uno por uno.', 'Os tengo en la mira.', 'Que empiece la geometría.'],
    kill: ['Objetivo eliminado.', 'Te lo advertí, {victim}.', 'Ni te has movido.', 'Limpio.'],
  },
};

const SAY = ['Fijado.', 'Ni pestañees.', 'Calculado.', 'Un solo tiro.', 'Te tengo.', 'Viento en calma.'];

export function create({ level = 2, temperature = 0 } = {}) {
  const tmp = Math.max(0, Math.min(1, Number(temperature) || 0));
  const lvl = Math.max(1, Math.min(3, level | 0));
  const weights = lvl === 3 ? [0.8, 0.12, 0.08] : lvl === 2 ? [0.6, 0.25, 0.15] : [0.4, 0.35, 0.25];
  return {
    meta,
    chooseShot({ soldiers, obstacles, soldier, history = [], rng = Math.random }) {
      const ctx = contextFor(soldiers, obstacles, soldier);
      const cands = directShots(ctx, { jitter: tmp * 0.2, count: 1, rng });
      // arcos finos sobre las pendientes directas (para salvar obstáculos)
      for (const e of ctx.enemies) {
        const dx = e.x - soldier.x;
        if (Math.sign(dx) !== ctx.dir) continue;
        const slope = (e.y - soldier.y) / dx;
        for (const k of [40, 80, 140, 240, 400]) {
          for (const amp of [1, -1]) {
            cands.push({ mode: MODES.FUNCTION, expr: `${slope.toFixed(5)}*x+${(amp / k).toFixed(5)}*x^2` });
          }
        }
        // ajuste fino de pendiente ±3%
        for (let i = 1; i <= 10; i++) {
          cands.push({ mode: MODES.FUNCTION, expr: `${(slope * (1 + i * 0.003)).toFixed(5)}*x` });
          cands.push({ mode: MODES.FUNCTION, expr: `${(slope * (1 - i * 0.003)).toFixed(5)}*x` });
        }
      }
      const ranked = search(ctx, avoidRepeats(cands, history, rng), { topN: 4 });
      const sigma = [0, 0.05, 0.025, 0.012][lvl] + tmp * 0.03;
      const shot = addMissNoise(
        pickWeighted(ranked, weights, tmp, rng) || { mode: MODES.FUNCTION, expr: '0.1*x' },
        sigma,
        rng,
      );
      return withVoice(shot, ctx, SAY, 0.6, rng);
    },
    // esquiva: el destino menos visto; si ya está tan tapado como el mejor, se queda (spec/01 §5)
    chooseMove({ soldiers, soldier, moveOptions }) {
      if (!soldiers.some((s) => s.alive && s.team !== soldier.team)) return 'stay';
      return coverMove(moveOptions, { stayIfCovered: true, farther: true });
    },
  };
}
