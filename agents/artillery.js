// Agente Artillery: usa ecuaciones de 2º orden (y'' = -g) con búsqueda de ángulo,
// perfecto para disparar parábolas por encima de los obstáculos.
import { MODES } from '../shared/constants.js';
import { best, contextFor, search, withVoice, coverMove } from './lib.js';

export const meta = {
  id: 'artillery', name: 'Artillery', icon: '🎆',
  description: "Lanza parábolas con y'' = -g buscando ángulo y gravedad (salta obstáculos).",
  banter: {
    intro: ['¡QUE LLUEVA FUEGO!', 'El cielo va a caer.', 'Cargando parábolas...', 'Temblad, mortales.'],
    kill: ['¡BOOM!', 'La gravedad no perdona, {victim}.', '¿Alguien ha visto mis ángulos?', 'Eso ha dolido hasta en el eje Y.'],
  },
};

const SAY = ['¡FUEGO!', 'El cielo cae.', 'Parábola divina.', 'Ajustando el ángulo...', '¡Que llueva!', 'Boom incoming.'];

const GRAVITIES = [0.02, 0.04, 0.07, 0.12, 0.2, 0.35];

export function create({ temperature = 0 } = {}) {
  const tmp = Math.max(0, Math.min(1, Number(temperature) || 0));
  const finish = (shot, ctx, rng) => {
    if (tmp > 0) shot.angle = Math.max(-85, Math.min(85, shot.angle + (rng() * 2 - 1) * tmp * 8));
    return withVoice(shot, ctx, SAY, 0.6, rng);
  };
  return {
    meta,
    chooseShot({ soldiers, obstacles, bites = [], soldier, rng = Math.random }) {
      const ctx = contextFor(soldiers, obstacles, soldier, bites);
      // fase 1: rejilla gruesa de (ángulo, gravedad)
      let cands = [];
      for (const g of GRAVITIES) {
        for (let a = -70; a <= 70; a += 7) {
          cands.push({ mode: MODES.ODE2, expr: `-${g}`, angle: a });
        }
      }
      let ranked = search(ctx, cands, { topN: 4, earlyKill: true });
      // fase 2: escalada local alrededor de la mejor solución
      for (let round = 0; round < 2 && ranked.length; round++) {
        const top = ranked[0].cand;
        const g0 = Math.abs(Number(top.expr));
        const a0 = top.angle;
        cands = [];
        for (const dg of [-0.5, -0.2, 0.2, 0.5]) {
          for (const da of [-4, -2, -1, 1, 2, 4]) {
            const g = Math.max(0.005, g0 * (1 + dg));
            cands.push({ mode: MODES.ODE2, expr: `-${g.toFixed(4)}`, angle: Math.max(-85, Math.min(85, a0 + da)) });
          }
        }
        const next = search(ctx, cands, { topN: 4, earlyKill: true });
        if (next.length && next[0].score > ranked[0].score) ranked = next;
        if (ranked[0].score >= 1000) break;
      }
      if (ranked.length) return finish({ ...ranked[0].cand }, ctx, rng);
      return finish(best(ctx, [{ mode: MODES.ODE2, expr: '-0.05', angle: 25 }]), ctx, rng);
    },
    // esquiva: lo más tapado y, a igualdad, lo más lejos (dispara por encima) (spec/01 §5)
    chooseMove({ soldiers, soldier, moveOptions }) {
      if (!soldiers.some((s) => s.alive && s.team !== soldier.team)) return 'stay';
      return coverMove(moveOptions, { stayIfCovered: false });
    },
  };
}
