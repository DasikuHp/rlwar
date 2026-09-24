// Deshacer y rehacer del editor (P6). Puro: guarda genomas enteros (son pequeños) con una etiqueta que dice qué cambió
// ("Neuronas de d: 24 → 32"). Los cambios seguidos del mismo ajuste (arrastrar un deslizador) cuentan como uno solo.
const LIMIT = 200, MERGE_MS = 1200;

export const createHistory = (genome) => ({ past: [], present: genome, future: [], lastKey: null, lastAt: 0 });

// next: el genoma nuevo; label: qué cambió; key: qué ajuste (para juntar los cambios seguidos); now: ms
export function record(H, next, label, key = null, now = 0) {
  if (next === H.present) return H;
  const merge = key !== null && key === H.lastKey && now - H.lastAt < MERGE_MS && H.past.length > 0;
  if (merge) {
    const past = H.past.slice();
    past[past.length - 1] = { ...past[past.length - 1], label };
    return { past, present: next, future: [], lastKey: key, lastAt: now };
  }
  const past = [...H.past, { genome: H.present, label }].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}
export const canUndo = (H) => H.past.length > 0;
export const canRedo = (H) => H.future.length > 0;
export function undo(H) {
  if (!canUndo(H)) return H;
  const last = H.past[H.past.length - 1];
  return { past: H.past.slice(0, -1), present: last.genome, future: [{ genome: H.present, label: last.label }, ...H.future], lastKey: null, lastAt: 0 };
}
export function redo(H) {
  if (!canRedo(H)) return H;
  const [first, ...rest] = H.future;
  return { past: [...H.past, { genome: H.present, label: first.label }], present: first.genome, future: rest, lastKey: null, lastAt: 0 };
}
// qué se desharía / rehería, para el título de los botones
export const undoLabel = (H) => (canUndo(H) ? H.past[H.past.length - 1].label : null);
export const redoLabel = (H) => (canRedo(H) ? H.future[0].label : null);
// la lista de esta sesión, de la más reciente a la más antigua: [{label, steps}] (steps = cuántos "deshacer" hasta ahí)
export const timeline = (H) => H.past.map((p, i) => ({ label: p.label, steps: H.past.length - i })).reverse();
export function jump(H, steps) { let h = H; for (let i = 0; i < steps; i++) h = undo(h); return h; }

// la etiqueta de un cambio: compara el genoma de antes y el de después (bloques, cables, ajustes y genes)
export function describe(before, after, catalog) {
  const nameOf = (t) => ((catalog && catalog.blocks.find((b) => b.type === t)) || { name: t }).name;
  if (!before) return 'Red abierta';
  const bIds = new Set(before.blocks.map((b) => b.id)), aIds = new Set(after.blocks.map((b) => b.id));
  const added = after.blocks.filter((b) => !bIds.has(b.id)), gone = before.blocks.filter((b) => !aIds.has(b.id));
  if (added.length === 1 && !gone.length) return `Añadido ${nameOf(added[0].type)} (${added[0].id})`;
  if (gone.length === 1 && !added.length) return `Quitado ${nameOf(gone[0].type)} (${gone[0].id})`;
  if (added.length || gone.length) return `${added.length} bloque(s) añadido(s), ${gone.length} quitado(s)`;
  const wk = (w) => `${w.from}→${w.to}`;
  const bw = new Set(before.wires.map(wk)), aw = new Set(after.wires.map(wk));
  const wAdd = after.wires.filter((w) => !bw.has(wk(w))), wGone = before.wires.filter((w) => !aw.has(wk(w)));
  if (wAdd.length === 1 && !wGone.length) return `Cable ${wAdd[0].from} → ${wAdd[0].to}`;
  if (wGone.length === 1 && !wAdd.length) return `Quitado el cable ${wGone[0].from} → ${wGone[0].to}`;
  if (wAdd.length || wGone.length) return 'Cables cambiados';
  for (const a of after.blocks) {
    const b = before.blocks.find((x) => x.id === a.id);
    for (const k of Object.keys({ ...(b.params || {}), ...(a.params || {}) })) {
      const x = JSON.stringify((b.params || {})[k]), y = JSON.stringify((a.params || {})[k]);
      if (x !== y) return `${k} de ${a.id}: ${x} → ${y}`;
    }
  }
  if (before.name !== after.name) return `Nombre: ${after.name}`;
  for (const top of ['traits', 'reward', 'learning', 'imagination']) {
    const x = JSON.stringify(before[top]), y = JSON.stringify(after[top]);
    if (x !== y) return `${{ traits: 'Carácter', reward: 'Recompensa', learning: 'Aprendizaje', imagination: 'Imaginación' }[top]} cambiado`;
  }
  return 'Cambio';
}
