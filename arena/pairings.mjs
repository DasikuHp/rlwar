// Emparejamientos round-robin con alternancia de lados (compartido arena/test).
export function pairings(types, games) {
  const pairs = [];
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) pairs.push([types[i], types[j]]);
  }
  if (!pairs.length) throw new Error('Se necesitan al menos 2 agentes distintos');
  const out = [];
  for (let g = 0; g < games; g++) {
    const [a, b] = pairs[g % pairs.length];
    out.push(g % 2 === 0 ? [a, b] : [b, a]);
  }
  return out;
}
