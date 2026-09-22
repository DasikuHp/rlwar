// Liga y trono en disco (spec/06 §2, §4, §6.3): throne.json, pares de la liga, muestreo de rivales (AlphaStar),
// genealogía por estructura. Sin dependencias del entrenador (lo importa evo/train.js).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { evoDir, loadNet } from './store.js';

export function emptyThrone() {
  return { queen: null, since: null, reigns: [], challenges: [], hallOfFame: [], league: { pairs: {} }, dynasties: { A: null, B: null }, genealogy: {} };
}
const throneFile = () => join(evoDir(), 'throne.json');

export function readThroneFull() {
  const base = emptyThrone();
  try {
    if (!existsSync(throneFile())) return base;
    const t = JSON.parse(readFileSync(throneFile(), 'utf8'));
    const out = { ...base, ...t };
    out.league = { pairs: {}, ...(t.league || {}) };
    out.dynasties = { A: null, B: null, ...(t.dynasties || {}) };
    out.genealogy = t.genealogy || {};
    return out;
  } catch { return base; }
}

export function writeThrone(t) {
  if (!existsSync(evoDir())) mkdirSync(evoDir(), { recursive: true });
  const tmp = throneFile() + '.tmp';
  writeFileSync(tmp, JSON.stringify(t));
  renameSync(tmp, throneFile());
  return t;
}

// ---------- liga ----------
const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
export function updateLeague(t, x, y, xWon) {
  const key = pairKey(x, y);
  const p = t.league.pairs[key] || (t.league.pairs[key] = { wins: 0, losses: 0, last: [] });
  const firstWon = (x < y) ? xWon : !xWon; // desde la perspectiva del primero del par
  if (firstWon) p.wins++; else p.losses++;
  p.last.push(firstWon ? 1 : 0);
  if (p.last.length > 20) p.last.splice(0, p.last.length - 20);
  return p;
}
export function winrate(t, x, y) {
  const p = t.league.pairs[pairKey(x, y)];
  if (!p || p.wins + p.losses === 0) return 0.5;
  const first = p.wins / (p.wins + p.losses);
  return x < y ? first : 1 - first;
}
// ¿ha perdido `x` contra `y` en los últimos 20 resultados del par?
export function recentLoss(t, x, y) {
  const p = t.league.pairs[pairKey(x, y)];
  if (!p) return false;
  return p.last.some((r) => (x < y ? r === 0 : r === 1));
}

// ---------- muestreo de rivales (spec/06 §4, §6.3) ----------
export function pickOpponent(netId, mix, rng, { throne, hall = [] } = {}) {
  const t = throne || readThroneFull();
  const m = { antagonist: 0.6, hallOfFame: 0.25, self: 0.15, ghost: 0, hard: 2, antagonistId: null, ...(mix || {}) };
  const exQueens = hall.filter((h) => h.kind === 'hallOfFame' && h.netId !== netId);
  if (m.ghost > 0 && rng() < m.ghost) {
    const lost = exQueens.filter((h) => recentLoss(t, netId, h.netId));
    if (lost.length) { const h = lost[rng.int ? rng.int(lost.length) : Math.floor(rng() * lost.length)]; return { ...h, kind: 'ghost', source: h.kind }; }
  }
  const weights = [['antagonist', Math.max(0, m.antagonist || 0)], ['hallOfFame', Math.max(0, m.hallOfFame || 0)], ['self', Math.max(0, m.self || 0)]].filter(([, w]) => w > 0);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let kind = 'self';
  if (total > 0) {
    let r = rng() * total;
    for (const [k, w] of weights) { if (r < w) { kind = k; break; } r -= w; }
  }
  if (kind === 'antagonist') {
    const id = m.antagonistId || (t.queen && t.queen !== netId ? t.queen : null);
    if (!id) kind = 'self'; else return { kind: 'antagonist', netId: id };
  }
  if (kind === 'hallOfFame') {
    const cands = hall.filter((h) => h.netId !== netId);
    if (!cands.length) kind = 'self';
    else {
      const hard = m.hard ?? 2;
      const fw = cands.map((h) => Math.max(1e-9, (1 - winrate(t, netId, h.netId)) ** hard));
      const sum = fw.reduce((s, v) => s + v, 0);
      let r = rng() * sum;
      for (let i = 0; i < cands.length; i++) { if (r < fw[i]) return { ...cands[i], kind: 'hallOfFame', source: cands[i].kind }; r -= fw[i]; }
      return { ...cands[cands.length - 1], kind: 'hallOfFame', source: cands[cands.length - 1].kind };
    }
  }
  return { kind: 'self', netId };
}

// ---------- genealogía (spec/06 §2, §6.3) ----------
export function structureSha(genome) {
  return createHash('sha256').update(JSON.stringify({ blocks: genome.blocks, wires: genome.wires })).digest('hex');
}
export function registerBirth(genome, t = null) {
  const own = !t;
  const th = t || readThroneFull();
  const lin = genome.lineage || {};
  th.genealogy[genome.id] = { parents: Array.isArray(lin.parents) ? lin.parents.slice() : [], generation: lin.generation || 0, born: lin.born ? (typeof lin.born === 'number' ? lin.born : Date.parse(lin.born) || Date.now()) : Date.now(), sha: structureSha(genome) };
  if (own) writeThrone(th);
  return th.genealogy[genome.id];
}
export function genealogyView(t = null) {
  const th = t || readThroneFull();
  const nets = {};
  for (const [id, entry] of Object.entries(th.genealogy)) {
    const g = loadNet(id);
    nets[id] = { ...entry, exists: !!g, edited: g ? structureSha(g) !== entry.sha : false, orphan: entry.parents.some((p) => !(p in th.genealogy) && !loadNet(p)) };
  }
  return { nets };
}
