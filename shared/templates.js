// Plantillas de ejemplo (spec/08 §7): redes válidas con pesos deterministas, cada una explica por qué está montada así.
import { newGenome } from './genome.js';
import { makeRng } from './rng.js';

const B = (id, type, params = {}) => ({ id, type, params });
const W = (from, to) => ({ from, to });

function make(id, name, blocks, wires, extra, seed) {
  return newGenome({ id, name, blocks, wires, ...extra }, makeRng(seed));
}

export const TEMPLATES = {
  sniper: {
    name: '🎯 Francotirador',
    why: 'Solo geometría: ve Rasgos y Candidatos, sin Simulador. Aprende despacio pero sin muletas: lo que sabe, lo sabe de verdad.',
    genome: make('plantilla-sniper', 'Francotirador', [
      B('f', 'eye.features'), B('c', 'eye.candidates'), B('d', 'dense', { units: 32, activation: 'tanh' }), B('ch', 'hand.choose'),
      B('m', 'eye.moves'), B('md', 'dense', { units: 16, activation: 'tanh' }), B('fm', 'foot.move', { adjust: false }),
    ], [W('f', 'd'), W('c', 'd'), W('d', 'ch'), W('m', 'md'), W('md', 'fm')], {}, 101),
  },
  turtle: {
    name: '🐢 Tortuga con memoria',
    why: 'Recuerda de dónde le dispararon (GRU sobre Rasgos, Radar y Reloj) y premia sobrevivir y cubrirse: se esconde tras los muros.',
    genome: make('plantilla-tortuga', 'Tortuga con memoria', [
      B('f', 'eye.features'), B('r', 'eye.radar', { rays: 16 }), B('k', 'eye.clock'), B('cat', 'concat'), B('g', 'gru', { units: 16 }),
      B('d', 'dense', { units: 24, activation: 'tanh' }), B('c', 'eye.candidates'), B('cd', 'dense', { units: 16, activation: 'tanh' }), B('ch', 'hand.choose'),
      B('m', 'eye.moves'), B('md', 'dense', { units: 16, activation: 'tanh' }), B('fm', 'foot.move', { adjust: true }),
    ], [W('f', 'cat'), W('r', 'cat'), W('k', 'cat'), W('cat', 'g'), W('g', 'd'), W('d', 'cd'), W('c', 'cd'), W('cd', 'ch'), W('m', 'md'), W('g', 'md'), W('md', 'fm')],
    { reward: { survive: 0.5, cover: 0.3 } }, 102),
  },
  seer: {
    name: '🔮 Vidente',
    why: 'Ve el futuro de cada tiro con el Simulador y lleva Corazonada: aprende en cientos de decisiones (en el experimento, ~330).',
    genome: make('plantilla-vidente', 'Vidente', [
      B('f', 'eye.features'), B('c', 'eye.candidates'), B('s', 'eye.simulator'), B('cd', 'dense', { units: 32, activation: 'tanh' }),
      B('ch', 'hand.choose'), B('aj', 'hand.adjust', { params: 3 }), B('dv', 'dense', { units: 16, activation: 'tanh' }), B('v', 'hand.value'),
      B('m', 'eye.moves'), B('md', 'dense', { units: 16, activation: 'tanh' }), B('fm', 'foot.move', { adjust: true }),
    ], [W('f', 'cd'), W('c', 'cd'), W('s', 'cd'), W('cd', 'ch'), W('cd', 'aj'), W('f', 'dv'), W('dv', 'v'), W('m', 'md'), W('f', 'md'), W('md', 'fm')], {}, 103),
  },
  empty: {
    name: '⬜ Vacía',
    why: 'Lo mínimo que puede disparar: Rasgos y Candidatos directos a Elegir, sin Instinto ni Pies. Construye tú el resto.',
    genome: make('plantilla-vacia', 'Vacía', [B('f', 'eye.features'), B('c', 'eye.candidates'), B('ch', 'hand.choose')], [W('f', 'ch'), W('c', 'ch')], {}, 104),
  },
};
