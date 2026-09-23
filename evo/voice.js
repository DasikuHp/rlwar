// Voz de las redes (spec/07 §13.2): cada frase se compone con compose() a partir de eventos reales de la partida
// (o recordados de otras), así checkPhrase puede comprobar cada número y cada nombre. El carácter decide el estilo;
// el nivel de confianza decide si piensa en voz baja (novata) o habla (media, veterana). Nada inventado: si no hay
// un hecho que contar, no dice nada.
import { compose } from './truth.js';

const FAMILY = { line: 'recta', parabola: 'parábola', sine: 'seno', ode1: 'ecuación', artillery: 'artillería', wild: 'salvaje' };
const refOf = (ev) => ({ game: ev.game, id: ev.id });
const S = (value, ev) => ({ value, ref: refOf(ev) });
const bare = (name) => String(name || '').replace(/^[^\p{L}\d]+/u, '').trim(); // "🎯 Sniper" → "Sniper"
const pct = (p) => Math.round(p * 100);

// hechos de una decisión de disparo: elegida, favorita, segunda, ojo que más pesó
function shotFacts(dec) {
  const d = dec && dec.data;
  if (!d || !Array.isArray(d.candidates) || !d.candidates.length || !Number.isInteger(d.chosen)) return null;
  const chosen = d.candidates.find((c) => c.i === d.chosen);
  if (!chosen || typeof chosen.p !== 'number') return null;
  const byP = [...d.candidates].filter((c) => typeof c.p === 'number').sort((a, b) => b.p - a.p);
  const best = byP[0], second = byP.find((c) => c.i !== chosen.i) || null;
  const eye = Array.isArray(d.attribution) ? [...d.attribution].filter((a) => a.share > 0).sort((a, b) => b.share - a.share)[0] || null : null;
  return { chosen, best, second, eye, predictedKill: !!(chosen.sim && chosen.sim.type === 'kill') };
}
const rivalOf = (ctx) => (ctx.events.start && ctx.rivalName ? S(bare(ctx.rivalName), ctx.events.start) : null);
const mapOf = (ctx) => { const st = ctx.events.start; return st && st.data && st.data.map ? S(bare(st.data.map.name), st) : null; };
// línea = [plantilla, huecos, kind]; se descarta si le falta algún hueco
const L = (tpl, slots, kind = 'say') => (Object.values(slots).every(Boolean) ? { tpl, slots, kind } : null);

function intro(ctx) {
  const rival = rivalOf(ctx), map = mapOf(ctx);
  const out = {
    frio: [L('{map}. Objetivo: {rival}.', { map, rival }), L('{rival}. Mapa: {map}. Empiezo.', { rival, map })],
    chulo: [L('{map}, mi terreno. Tú verás, {rival}.', { map, rival }), L('Hola, {rival}. Vengo a ganar.', { rival })],
    dramatico: [L('{map}… aquí se decide todo, {rival}.', { map, rival }), L('Que empiece, {rival}. En {map}.', { rival, map })],
    desquiciado: [L('{map}, {map}, {map}. Hola, {rival}.', { map, rival }), L('{rival}. {rival}. Ya te veo, {rival}.', { rival })],
  }[ctx.character] || [];
  // un recuerdo verificable del rival (de otra partida guardada)
  for (const ev of ctx.events.recall || []) {
    if (ev.type === 'death' && ev.data && ev.data.killerName) out.push(L('La última vez me eliminó {killer}. Me acuerdo.', { killer: S(bare(ev.data.killerName), ev) }));
    if (ev.type === 'kill' && ev.data && ev.data.victimName) out.push(L('Ya te eliminé una vez, {victim}.', { victim: S(bare(ev.data.victimName), ev) }));
  }
  return out;
}

function decision(ctx) {
  const dec = ctx.events.decision, f = shotFacts(dec);
  if (!f) return [];
  const c = S(f.chosen.i, dec), s = f.second ? S(f.second.i, dec) : null, p = S(pct(f.chosen.p), dec);
  const fam = FAMILY[f.chosen.family] ? S(FAMILY[f.chosen.family], dec) : null;
  const rival = rivalOf(ctx), map = mapOf(ctx);
  const out = [];
  if (ctx.level === 'novata') {
    if (f.best && f.best.i !== f.chosen.i) out.push(L('Me gusta más #{b}, pero pruebo #{c}.', { b: S(f.best.i, dec), c }, 'think'));
    out.push(...({
      frio: [L('#{c}… o #{s}.', { c, s }, 'think'), L('Dudo entre #{c} y #{s}.', { c, s }, 'think')],
      chulo: [L('Mmm… #{c}. Por probar.', { c }, 'think'), L('#{c}, a ver qué pasa.', { c }, 'think')],
      dramatico: [L('¿#{c}? ¿#{s}? No lo sé…', { c, s }, 'think'), L('#{c}… que sea lo que tenga que ser.', { c }, 'think')],
      desquiciado: [L('#{c}, #{s}, #{c}… vale, #{c}.', { c, s }, 'think'), L('#{s} no. #{c} sí. Creo.', { c, s }, 'think')],
    }[ctx.character] || []));
    return out;
  }
  if (f.eye) out.push(L('Miro sobre todo {eye} ({share} %).', { eye: S(f.eye.name, dec), share: S(pct(f.eye.share), dec) }));
  if (ctx.level === 'veterana' && f.predictedKill) out.push(L('Mi simulación dice que #{c} da.', { c }));
  const byChar = ctx.level === 'veterana' ? {
    frio: [L('#{c}. {p} %. Fin.', { c, p }), L('#{c}, {fam}. Calculado al {p} %.', { c, fam, p })],
    chulo: [L('{rival}, #{c} va para ti.', { rival, c }), L('#{c} al {p} %. Ni lo pienso, {rival}.', { c, p, rival })],
    dramatico: [L('#{c}… {p} % y el destino en mis manos.', { c, p }), L('#{c}. Que tiemble {map}.', { c, map })],
    desquiciado: [L('#{c} #{c} #{c}. {p} %. Jajaja.', { c, p }), L('#{s} es aburrido. #{c}.', { s, c })],
  } : {
    frio: [L('#{c}, {fam}: {p} %.', { c, fam, p }), L('#{c}. {p} %.', { c, p })],
    chulo: [L('#{c} ({p} %). Mira y aprende, {rival}.', { c, p, rival }), L('Va #{c}, {fam}.', { c, fam })],
    dramatico: [L('#{c}: una {fam} al {p} %…', { c, fam, p }), L('#{c}: {p} % de esperanza.', { c, p })],
    desquiciado: [L('#{c}. {p} %. {p} %. Sí.', { c, p }), L('{fam}, {fam}… #{c}.', { fam, c })],
  };
  out.push(...(byChar[ctx.character] || []));
  return out;
}

function kill(ctx) {
  const k = ctx.events.kill;
  if (!k || !k.data || !k.data.victimName) return [];
  const victim = S(bare(k.data.victimName), k);
  const out = {
    frio: [L('{victim}: eliminado.', { victim }), L('Uno menos. {victim}.', { victim })],
    chulo: [L('Toma, {victim}.', { victim }), L('Adiós, {victim}. Siguiente.', { victim })],
    dramatico: [L('¡Adiós, {victim}!', { victim }), L('Cae {victim}… así es la guerra.', { victim })],
    desquiciado: [L('¡{victim}! Jajaja.', { victim }), L('{victim} fuera. Siguiente, siguiente.', { victim })],
  }[ctx.character] || [];
  const f = shotFacts(ctx.events.decision);
  if (f && f.predictedKill && ctx.level !== 'novata') out.push(L('Lo decía mi simulación: #{c}.', { c: S(f.chosen.i, ctx.events.decision) }));
  return out;
}

function graze(ctx) {
  const g = ctx.events.graze;
  if (!g || !g.data || typeof g.data.dist !== 'number') return [];
  const d = S(g.data.dist.toFixed(2), g), rival = rivalOf(ctx);
  return {
    frio: [L('Por {d} u.', { d }), L('Fallo por {d}.', { d })],
    chulo: [L('Por {d}… la próxima, {rival}.', { d, rival }), L('Eso era de aviso: {d}.', { d })],
    dramatico: [L('A {d} de la gloria…', { d }), L('{d}… tan cerca.', { d })],
    desquiciado: [L('{d}. {d}. Casi. Casi.', { d }), L('Casi, {rival}, casi. {d}.', { rival, d })],
  }[ctx.character] || [];
}

function miss(ctx) {
  const sh = ctx.events.shot;
  if (!sh || !sh.data || !sh.data.result || ['kill', 'suicide'].includes(sh.data.result.type) || typeof sh.data.minDist !== 'number' || sh.data.minDist >= 30) return [];
  const md = S(sh.data.minDist.toFixed(1), sh), rival = rivalOf(ctx);
  const wallish = sh.data.result.type === 'obstacle' ? [L('Obstáculo. A {md} de {rival}.', { md, rival })] : [];
  return [...wallish, ...({
    frio: [L('A {md} de {rival}. Corrijo.', { md, rival }), L('Fallo: {md}.', { md })],
    chulo: [L('Calentando. {md}.', { md }), L('Eso era de aviso, {rival}.', { rival })],
    dramatico: [L('No… {md} de distancia.', { md }), L('El destino me esquiva por {md}.', { md })],
    desquiciado: [L('{md}. {md}. Nada.', { md }), L('Otra vez. {md}.', { md })],
  }[ctx.character] || [])];
}

function friendlyFire(ctx) {
  const ff = ctx.events.friendlyFire;
  if (!ff) return [];
  const e = S('fuego amigo', ff); // hueco con ref: la frase apunta al evento que la justifica
  return {
    frio: [L('Error mío: {e}.', { e }), L('Anotado: {e}.', { e })],
    chulo: [L('Eso no cuenta… {e}.', { e }), L('Ups. {e}.', { e })],
    dramatico: [L('No, no, no… {e}. Perdón.', { e }), L('Perdón… {e}.', { e })],
    desquiciado: [L('Uno menos. Espera… {e}.', { e }), L('Perdón, perdón. {e}.', { e })],
  }[ctx.character] || [];
}

function death(ctx) {
  const d = ctx.events.death;
  if (!d || !d.data || !d.data.killerName) return [];
  const killer = S(bare(d.data.killerName), d);
  return {
    frio: [L('Me eliminó {killer}.', { killer }), L('Baja propia. Autor: {killer}.', { killer })],
    chulo: [L('Suerte, {killer}.', { killer }), L('Esta te la devuelvo, {killer}.', { killer })],
    dramatico: [L('{killer}… me las pagarás.', { killer }), L('Caigo… pero volveré, {killer}.', { killer })],
    desquiciado: [L('{killer}, {killer}, {killer}…', { killer }), L('Ay. {killer}. Anotado.', { killer })],
  }[ctx.character] || [];
}

function retort(ctx) {
  const sh = ctx.events.rivalShot;
  if (!sh || !sh.data || !sh.data.result || ['kill', 'suicide'].includes(sh.data.result.type) || typeof sh.data.minDist !== 'number' || sh.data.minDist >= 30) return [];
  if (ctx.level === 'novata') return [];
  const md = S(sh.data.minDist.toFixed(1), sh), rival = rivalOf(ctx);
  const rd = shotFacts(ctx.events.rivalDecision);
  if (rd) {
    const rc = S(rd.chosen.i, ctx.events.rivalDecision);
    return {
      frio: [L('#{rc} de {rival}: a {md} de nosotros.', { rc, rival, md })],
      chulo: [L('Elegiste #{rc} y fallaste por {md}.', { rc, md })],
      dramatico: [L('¡Ja! #{rc}… y a {md}.', { rc, md })],
      desquiciado: [L('#{rc}, jajaja, #{rc}. {md}.', { rc, md })],
    }[ctx.character] || [];
  }
  return {
    frio: [L('Fallaste por {md}, {rival}.', { md, rival })],
    chulo: [L('A {md}, {rival}. Sigue intentando.', { md, rival })],
    dramatico: [L('{md}… qué pena, {rival}.', { md, rival })],
    desquiciado: [L('{md}, {md}, jajaja.', { md })],
  }[ctx.character] || [];
}

const MOMENTS = { intro, decision, kill, graze, miss, friendlyFire, death, retort };
export function speak(moment, ctx, rng = Math.random) {
  const build = MOMENTS[moment];
  if (!build || !ctx || !ctx.events) return null;
  const lines = build(ctx).filter(Boolean);
  if (!lines.length) return null;
  const line = lines[Math.floor(rng() * lines.length) % lines.length];
  const c = compose(line.tpl, line.slots);
  return { text: c.text, refs: c.refs, kind: line.kind };
}
