// Redes ocupadas (spec/04 §10.5): en un duelo o aprendiendo de una exhibición. Los entrenos los lleva el API.
// Una red puede tenerla más de uno a la vez: sigue ocupada hasta que la suelta el último.
const held = new Map(); // netId → [{kind, id}]

const same = (a, b) => a.kind === b.kind && a.id === b.id;
export function holdNet(netId, holder) {
  const list = held.get(netId) || [];
  list.push({ kind: holder.kind, id: holder.id });
  held.set(netId, list);
}
export function releaseNet(netId, holder) {
  const list = held.get(netId);
  if (!list) return;
  const i = list.findIndex((h) => same(h, holder));
  if (i >= 0) list.splice(i, 1);
  if (!list.length) held.delete(netId);
}
// alguna red ocupada ({netId, kind, id}) o null (spec/09 §4: no se cambia de mundo)
export function anyHeld() {
  for (const [netId, list] of held) if (list.length) return { netId, ...list[0] };
  return null;
}
// quién la tiene ({kind: 'duel'|'exhibition', id}) o null si está libre
export function heldBy(netId) {
  const list = held.get(netId);
  return list && list.length ? { ...list[0] } : null;
}
