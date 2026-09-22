// Registro de agentes: para añadir un agente nuevo, crea `agents/miagente.js`
// exportando `meta` y `create(config)` y añádelo a MODULES. Nada más que tocar.
import * as greedy from './greedy.js';
import * as sniper from './sniper.js';
import * as artillery from './artillery.js';
import * as chaos from './chaos.js';

const MODULES = [sniper, greedy, artillery, chaos];

export const AGENTS = Object.fromEntries(MODULES.map((m) => [m.meta.id, m]));
export const AGENT_TYPES = MODULES.map((m) => ({ ...m.meta }));
export const DEFAULT_AGENT = 'greedy';

export const BOT_NAMES = ['Deep Thought', 'HAL 9000', 'Skynet', 'Agent Smith', 'Multivac', 'Deep Blue', 'Wolfram', 'Alpha Zordon'];

export function agentMeta(type) {
  return (AGENTS[type] || AGENTS[DEFAULT_AGENT]).meta;
}

export function listAgents() {
  return AGENT_TYPES;
}

export function createAgent(type, config = {}) {
  const mod = AGENTS[type] || AGENTS[DEFAULT_AGENT];
  return mod.create(config);
}
