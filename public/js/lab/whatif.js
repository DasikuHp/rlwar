// Ayudas de arranque (plan2 ronda 4 ✅): "¿qué pasaría si…?" (una escena congelada; cambias un ajuste o un cable y ves
// si cambia lo que elegiría la red, spec/08 §9.1 whatif) y primeros pasos con su avance medido en datos reales. Sin DOM.

// escenas fijas: quien decide está a la izquierda; el plano va de −25 a 25 en x y de −15 a 15 en y
export const SCENES = [
  { key: 'abierto', name: 'A campo abierto', explain: 'Un enemigo enfrente y nada en medio: se ve si apunta directo o se complica.',
    scene: { soldiers: [{ id: 'yo', team: 'left', x: -15, y: 0 }, { id: 'rival', team: 'right', x: 15, y: 3 }], obstacles: [], soldierId: 'yo' } },
  { key: 'muro', name: 'Tras un muro', explain: 'Un muro alto entre los dos: hay que pasar por encima o rodearlo.',
    scene: { soldiers: [{ id: 'yo', team: 'left', x: -15, y: -2 }, { id: 'rival', team: 'right', x: 12, y: 1 }], obstacles: [{ x: -3, y: -6, w: 3, h: 12 }], soldierId: 'yo' } },
  { key: 'dos', name: 'Dos contra dos', explain: 'Dos enemigos a distinta altura y dos obstáculos: se ve a quién prefiere.',
    scene: { soldiers: [{ id: 'yo', team: 'left', x: -16, y: 4 }, { id: 'amiga', team: 'left', x: -12, y: -6 }, { id: 'rival-1', team: 'right', x: 14, y: 5 }, { id: 'rival-2', team: 'right', x: 17, y: -4 }], obstacles: [{ x: 0, y: -2, w: 2, h: 5 }, { x: 6, y: 6, w: 4, h: 2 }], soldierId: 'yo' } },
];

export function whatifBody(s, phase, seed, genome) {
  const body = { scene: s.scene, phase, seed };
  if (genome) body.genome = genome;
  return body;
}

function pick(d) {
  if (!d || !Array.isArray(d.candidates)) return null;
  const c = d.candidates.find((x) => x.i === d.chosen);
  if (!c) return null;
  const ps = d.candidates.map((x) => x.p).sort((a, b) => b - a);
  return { i: c.i, family: c.family, expr: c.expr, p: c.p, certainty: ps.length > 1 ? ps[0] - ps[1] : 1 };
}
// la red guardada (before) frente a la que se está editando (after)
export function compare(before, after) {
  const a = pick(before), b = pick(after);
  return { same: !!(a && b && a.i === b.i), before: a, after: b };
}

// primeros pasos: cada uno está hecho si los datos lo dicen, no porque se haya pulsado
export function tutorialSteps({ nets = [], trainings = [], throne = {} } = {}) {
  return [
    { title: 'Crea tu primera red', text: 'Desde una plantilla: la Vacía es lo mínimo que dispara; el Francotirador, la Tortuga y la Vidente vienen montadas.', href: '#editor', done: nets.length > 0 },
    { title: 'Ponla a jugar', text: 'En la sala de juego, elígela en el selector de tropas contra un agente o contra otra red.', href: '/', done: nets.some((n) => n.stats && n.stats.games > 0) },
    { title: 'Entrénala', text: 'Unas decenas de partidas en turbo y mira la curva: cada marca es un sueño en el que aprendió.', href: '#entreno', done: trainings.length > 0 },
    { title: 'Rétala al trono', text: 'Si no hay reina, se sienta sin duelo; si la hay, 3 mapas × 2 lados y los empates los gana la reina.', href: '#trono', done: !!(throne && throne.queen) },
  ];
}
