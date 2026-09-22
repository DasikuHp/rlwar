// Agente Chaos: divertido e impredecible; dispara funciones salvajes.
// Útil para self-play (hace partidas entretenidas) y como sparring flojo.
import { MODES } from '../shared/constants.js';
import { best, contextFor, avoidRepeats, withVoice } from './lib.js';

export const meta = {
  id: 'chaos', name: 'Chaos', icon: '🌀',
  description: 'Funciones salvajes al azar: tan, sin de alta frecuencia, exp... impredecible.',
  banter: {
    intro: ['¡¡¡TAN TAN TAN!!!', 'No sé ni lo que voy a disparar.', 'Las matemáticas me hablan.', '¡SORPRESA!'],
    kill: ['¡¡NI YO SÉ CÓMO LO HE HECHO!!', '{victim}, la entropía te ha elegido.', '¡El caos provee!', '¿Eso era legal? ¡Da igual!'],
  },
};

const SAY = ['¡WEEE!', '¿Y si... esto?', 'Las mates me hablan.', '¡SORPRESA!', 'Sin miedo al ridículo.', '¡Aleatorio... o no!'];

const WILD = [
  (a, k) => `${a}*tan(x/${k})`,
  (a, k) => `${a}*sin(x*${k})`,
  (a, k) => `${a}*exp(-abs(x)/${k})`,
  (a, k) => `${a}*x^3/${k * k}`,
  (a, k) => `${a}*(x/${k})^2*sin(x/${k})`,
  (a, k) => `${a}*sqrt(abs(x))*sin(x/${k})`,
  (a, k) => `${a}*ln(abs(x)+1)*cos(x/${k})`,
];

export function create({ temperature = 0 } = {}) {
  const tmp = Math.max(0, Math.min(1, Number(temperature) || 0));
  return {
    meta,
    chooseShot({ soldiers, obstacles, soldier, history = [] }) {
      const ctx = contextFor(soldiers, obstacles, soldier);
      const cands = [];
      const n = Math.round(60 * (1 + tmp));
      for (let i = 0; i < n; i++) {
        const a = (Math.random() * 2 - 1) * 8;
        const k = 1 + Math.random() * 20;
        cands.push({ mode: MODES.FUNCTION, expr: WILD[Math.floor(Math.random() * WILD.length)](a.toFixed(3), k.toFixed(2)) });
      }
      for (let i = 0; i < 10; i++) {
        cands.push({ mode: MODES.ODE1, expr: `${((Math.random() * 2 - 1) * 3).toFixed(3)}*sin(x/${(1 + Math.random() * 12).toFixed(2)})+${((Math.random() * 2 - 1) * 2).toFixed(2)}` });
      }
      return withVoice(best(ctx, avoidRepeats(cands, history), { topN: 6 }), ctx, SAY, 0.8);
    },
  };
}
