// Hijos y pre-torneo (spec/05 §4, §10.4): plan de partidas justo (mismas semillas y soldados para todos, lados
// alternos), ranking (victorias ↓, diferencia de kills ↓, kills ↓, nombre ↑) y versión asíncrona para la API.
import { makeRng } from '../shared/rng.js';
import { playGame } from '../server/headless.js';
import { gameSummary } from './train.js';

export function rankChildren(rows) {
  return rows.slice().sort((a, b) => (b.wins - a.wins) || (b.killDiff - a.killDiff) || (b.kills - a.kills) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function pretournamentPlan({ games = 4, seed = 0, soldiers = 'random' } = {}) {
  const n = Math.max(0, Math.min(20, Number(games) || 0));
  const sold = soldiers === 'random' ? 1 + makeRng(seed).int(4) : Math.max(1, Math.min(4, Number(soldiers) || 2));
  const seeds = Array.from({ length: n }, (_, j) => seed + 1000 + j);
  const sides = seeds.map((_, j) => (j % 2 === 0 ? 'left' : 'right'));
  return { seeds, sides, soldiers: sold };
}

const opsTextOf = (g) => ((g.lineage && Array.isArray(g.lineage.mutations)) ? g.lineage.mutations.map((o) => o.text).filter((t) => typeof t === 'string') : []);
const emptyRow = (c) => ({ id: c.id, name: c.name, wins: 0, killDiff: 0, kills: 0, deaths: 0, opsText: opsTextOf(c) });
const addResult = (row, r) => { row.wins += r.win ? 1 : 0; row.kills += r.kills || 0; row.deaths += r.deaths || 0; row.killDiff = row.kills - row.deaths; };

// partida real sin pantalla; devuelve {win, kills, deaths} del hijo
export function defaultPlay({ seed, child, opponent, childSide, soldiers }) {
  const me = { type: 'net', genome: child, name: child.name }, op = { type: 'net', genome: opponent, name: opponent.name };
  const r = playGame({ seed, left: childSide === 'left' ? me : op, right: childSide === 'left' ? op : me, soldiers });
  const p = r.room.players.find((x) => x.team === childSide);
  const s = gameSummary(r, p ? p.id : null);
  return { win: s.win, kills: s.kills, deaths: s.deaths };
}

export function runPretournament({ children, opponent, games = 4, seed = 0, soldiers = 'random', play = defaultPlay }) {
  const plan = pretournamentPlan({ games, seed, soldiers });
  const rows = children.map(emptyRow);
  children.forEach((child, i) => {
    plan.seeds.forEach((s, j) => addResult(rows[i], play({ seed: s, child, opponent, childSide: plan.sides[j], soldiers: plan.soldiers })));
  });
  return { ranking: rankChildren(rows), seeds: plan.seeds, soldiers: plan.soldiers };
}

// igual, cediendo el bucle de eventos entre partidas y avisando del progreso
export async function runPretournamentAsync({ children, opponent, games = 4, seed = 0, soldiers = 'random', play = defaultPlay, onGame = null, shouldStop = null }) {
  const plan = pretournamentPlan({ games, seed, soldiers });
  const rows = children.map(emptyRow);
  const total = children.length * plan.seeds.length;
  let done = 0;
  for (let i = 0; i < children.length; i++) {
    for (let j = 0; j < plan.seeds.length; j++) {
      if (shouldStop && shouldStop()) return { ranking: rankChildren(rows), seeds: plan.seeds, soldiers: plan.soldiers, done, total, stopped: true };
      await new Promise((r) => setImmediate(r));
      addResult(rows[i], await play({ seed: plan.seeds[j], child: children[i], opponent, childSide: plan.sides[j], soldiers: plan.soldiers }));
      done++;
      if (onGame) onGame(done, total);
    }
  }
  return { ranking: rankChildren(rows), seeds: plan.seeds, soldiers: plan.soldiers, done, total, stopped: false };
}
