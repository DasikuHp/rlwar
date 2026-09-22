// Agente tipo `net` (spec/03 §9.4): envuelve una red del laboratorio con el contrato de agentes
// (chooseShot + chooseMove). Guarda la memoria de cada soldado y la lectura de equipo. Nunca lanza.
import { compile } from '../shared/nn.js';
import { decideShot, decideMove } from '../shared/policy.js';
import { loadNet } from '../evo/store.js';

export const meta = {
  id: 'net', name: 'Red', icon: '🧠',
  description: 'Una red neuronal del laboratorio: ve el campo con sus ojos, imagina candidatos y elige.',
  banter: { intro: ['Calculando.', 'Observo.', 'Mis ojos están abiertos.'], kill: ['Previsto.', 'Lo vi venir, {victim}.', 'Un candidato menos que imaginar.'] },
};

const isMemoryType = (t) => ['echo', 'gru', 'lstm', 'teamMemory'].includes(t);

export function create({ netId = null, genome = null, learn = false, attribution = false } = {}) {
  let g = genome || (netId ? loadNet(netId) : null);
  let net = null, broken = false, error = null;
  try {
    if (!g) throw new Error(`red no encontrada: ${netId}`);
    net = compile(g);
    g = net.genome;
  } catch (e) { broken = true; error = e.message; }
  const memories = {};
  const memBlocks = net ? g.blocks.filter((b) => isMemoryType(b.type)) : [];
  const fallback = (phase, soldierId, why) => ({
    mode: 'function', expr: '0.1*x', angle: null, family: 'line', params: [0.1, 0, 0], exprLocal: '0.1*x', reason: '',
    decision: { phase, soldierId, netId: g ? g.id : netId, error: why, candidates: null, moves: null },
  });
  const agent = {
    meta: { ...meta, netId: (g && g.id) || netId, name: (g && g.name) || String(netId), emblem: (g && g.emblem) || null,
      description: !broken ? `Red neuronal "${g.name}": ${g.blocks.length} bloques, generación ${g.lineage.generation}.` : `Red rota: ${error}` },
    learn: !!learn, broken, error, genome: g, net, trajectories: {},
    memoryFor(soldierId) { return memories[soldierId] || (memories[soldierId] = net ? net.zeroState() : {}); },
    // media de las memorias de los otros soldados vivos del mismo jugador (última escritura)
    teamFor(soldier, soldiers) {
      if (!net || !memBlocks.length) return null;
      const others = soldiers.filter((s) => s.alive && s.id !== soldier.id && s.ownerId === soldier.ownerId && memories[s.id]);
      if (!others.length) return null;
      const team = {};
      for (const b of memBlocks) {
        const u = b.params.units; const acc = new Float64Array(u);
        for (const o of others) { const st = memories[o.id][b.id]; const h = b.type === 'lstm' ? st.h : st; for (let j = 0; j < u; j++) acc[j] += h[j] / others.length; }
        team[b.id] = acc;
      }
      return team;
    },
    chooseShot({ soldiers, soldier, rng = Math.random, state }) {
      if (broken) return fallback('shoot', soldier && soldier.id, error);
      try {
        const r = decideShot({ net, genome: g, state, soldierId: soldier.id, memory: this.memoryFor(soldier.id), team: this.teamFor(soldier, soldiers), rng, attribution });
        memories[soldier.id] = r.memory;
        (this.trajectories[soldier.id] ||= []).push({ turn: (state && state.stats && state.stats.shots) || 0, phase: 'shoot', obs: r.obs, decision: r.decision });
        return { ...r.choice, reason: '', decision: r.decision };
      } catch (e) { return fallback('shoot', soldier.id, e.message); }
    },
    chooseMove({ soldiers, soldier, shot = null, rng = Math.random, state }) {
      if (broken) return 'stay';
      try {
        const r = decideMove({ net, genome: g, state, soldierId: soldier.id, memory: this.memoryFor(soldier.id), team: this.teamFor(soldier, soldiers), rng, shot });
        memories[soldier.id] = r.memory;
        (this.trajectories[soldier.id] ||= []).push({ turn: (state && state.stats && state.stats.shots) || 0, phase: 'move', obs: r.obs, decision: r.decision });
        return r.move === 'stay' ? { x: soldier.x, y: soldier.y, stay: true, decision: r.decision } : { x: r.move.x, y: r.move.y, decision: r.decision };
      } catch { return 'stay'; }
    },
  };
  return agent;
}
