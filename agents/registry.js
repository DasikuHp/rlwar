// Registro de agentes: para añadir un agente nuevo, crea `agents/miagente.js`
// exportando `meta` y `create(config)` y añádelo a MODULES. Nada más que tocar.
// Las redes del laboratorio (evo/nets) aparecen además como `net:<id>` (spec/03 §9.4).
import * as greedy from './greedy.js';
import * as sniper from './sniper.js';
import * as artillery from './artillery.js';
import * as chaos from './chaos.js';
import * as net from './net.js';
import { listNets } from '../evo/store.js';

const MODULES = [sniper, greedy, artillery, chaos];

export const AGENTS = Object.fromEntries(MODULES.map((m) => [m.meta.id, m]));
export const AGENT_TYPES = MODULES.map((m) => ({ ...m.meta }));
export const DEFAULT_AGENT = 'greedy';

export const BOT_NAMES = ['Deep Thought', 'HAL 9000', 'Skynet', 'Agent Smith', 'Multivac', 'Deep Blue', 'Wolfram', 'Alpha Zordon'];

const isNet = (type) => type === 'net' || String(type).startsWith('net:');
const netIdOf = (type, config = {}) => (String(type).startsWith('net:') ? String(type).slice(4) : config.netId || null);

export function agentMeta(type) {
  if (isNet(type)) return net.meta;
  return (AGENTS[type] || AGENTS[DEFAULT_AGENT]).meta;
}

export function listAgents() {
  const nets = listNets().filter((n) => n.playable).map((n) => ({
    id: `net:${n.id}`, name: n.name, icon: '🧠',
    description: `Red neuronal: ${n.blocks} bloques, ${n.paramCount} parámetros, generación ${n.generation}, ${n.stats.games} partidas.`,
    net: true, netId: n.id, emblem: n.emblem,
  }));
  return [...AGENT_TYPES, ...nets];
}

export function createAgent(type, config = {}) {
  if (isNet(type)) return net.create({ ...config, netId: netIdOf(type, config) });
  const mod = AGENTS[type] || AGENTS[DEFAULT_AGENT];
  return mod.create(config);
}
