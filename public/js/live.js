// Sala viva con redes (parte 4; spec/08 §3, spec/03 §7, spec/07 §2–§4): lógica pura, sin DOM. La usa game/espectar.js para el
// dibujo de lo que "piensa" una red antes de disparar o moverse y para el panel del cerebro.

// qué se pinta: en un disparo, los candidatos tenues (de menos a más probable: el más probable queda encima y más
// visible) y la elegida en firme; en la fase de mover, los 9 destinos con su probabilidad y el elegido
export function overlay(d) {
  if (!d || (d.phase !== 'shoot' && d.phase !== 'move')) return null;
  if (d.phase === 'move') {
    if (!Array.isArray(d.moves)) return null;
    return { kind: 'move', spots: d.moves.map((m) => ({ i: m.i, x: m.to.x, y: m.to.y, p: m.p, stay: !!m.stay })), chosen: d.chosenMove ?? null };
  }
  if (!Array.isArray(d.candidates)) return null;
  const withPts = d.candidates.filter((c) => Array.isArray(c.points) && c.points.length);
  const ch = withPts.find((c) => c.i === d.chosen);
  const rest = withPts.filter((c) => c.i !== d.chosen).map((c, k) => ({ c, k })).sort((a, b) => a.c.p - b.c.p || a.k - b.k).map((x) => x.c);
  const maxP = Math.max(1e-9, ...rest.map((c) => c.p || 0));
  return {
    kind: 'shoot',
    faint: rest.map((c) => ({ i: c.i, points: c.points, p: c.p, alpha: 0.08 + 0.4 * Math.max(0, c.p || 0) / maxP })),
    chosen: ch ? { i: ch.i, points: ch.points, p: ch.p } : null,
  };
}

// los n más probables; la elegida siempre sale (si el muestreo cogió una improbable, al final)
export function topCandidates(d, n = 5) {
  if (!d || !Array.isArray(d.candidates)) return [];
  const row = (c) => ({ i: c.i, family: c.family, expr: c.expr, p: c.p, chosen: c.i === d.chosen });
  const sorted = d.candidates.slice().sort((a, b) => b.p - a.p);
  const top = sorted.slice(0, n).map(row);
  if (!top.some((c) => c.chosen)) { const c = d.candidates.find((x) => x.i === d.chosen); if (c) top.push(row(c)); }
  return top;
}

export function attributionRows(d) {
  if (!d || !Array.isArray(d.attribution)) return [];
  return d.attribution.map((a) => ({ blockId: a.blockId, name: a.name, share: a.share, drop: a.drop })).sort((a, b) => b.share - a.share);
}

// "Miraba sobre todo X: sin ese ojo, la #k perdería d de probabilidad." (spec/07 §3). Devuelve la plantilla y los
// huecos para truth.compose; cada hueco cita la decisión (`ref`). drop = p[elegida] − p[elegida sin ese ojo].
export function attributionPhrase(d, ref) {
  const top = attributionRows(d)[0];
  if (!top || !(top.share > 0)) return null;
  const drop = (Math.round(top.drop * 100) / 100).toFixed(2);
  const slots = { name: { value: top.name, ref } };
  if (Number(drop) === 0) return { template: 'Miraba sobre todo {name}.', slots };
  return { template: 'Miraba sobre todo {name}: sin ese ojo, la #{i} perdería {drop} de probabilidad.', slots: { ...slots, i: { value: d.chosen, ref }, drop: { value: drop, ref } } };
}

const LEVEL = { novata: 'novata', media: 'media', veterana: 'veterana' };
export function confidenceView(c) {
  if (!c) return null;
  return { level: c.level, label: LEVEL[c.level] || String(c.level), certainty: c.certainty, experience: c.experience, confidence: c.confidence };
}
