// Almacén de redes en disco (spec/03 §9.4): evo/nets/<id>.json (o GW_EVO_DIR/nets). Escritura atómica.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, normalize, countParams } from '../shared/genome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function netsDir() {
  const base = process.env.GW_EVO_DIR ? join(process.env.GW_EVO_DIR, 'nets') : join(ROOT, 'evo', 'nets');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}
const fileOf = (id) => join(netsDir(), `${id}.json`);
const ID_RE = /^[a-z0-9-]{3,32}$/;

function readGenome(file) {
  const raw = readFileSync(file, 'utf8');
  const v = validate(raw);
  if (!v.ok) return { error: v.errors[0].message };
  return { genome: normalize(JSON.parse(raw)) };
}

export function entryOf(genome, updatedAt = Date.now()) {
  return {
    id: genome.id, name: genome.name, emblem: genome.emblem, traits: genome.traits, stats: genome.stats,
    generation: genome.lineage.generation, paramCount: countParams(genome), blocks: genome.blocks.length,
    playable: validate(genome, { forPlay: true }).ok, updatedAt,
  };
}

// Lista las redes guardadas; los ficheros ilegibles o inválidos se ignoran (con aviso si se pide)
export function listNets({ withWarnings = false } = {}) {
  const dir = netsDir();
  const nets = [], warnings = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const r = readGenome(join(dir, f));
      if (r.error) { warnings.push(`${f}: ${r.error}`); continue; }
      nets.push(entryOf(r.genome, statSync(join(dir, f)).mtimeMs));
    } catch (e) { warnings.push(`${f}: ${e.message}`); }
  }
  return withWarnings ? { nets, warnings } : nets;
}

export function loadNet(id) {
  if (!ID_RE.test(String(id))) return null;
  const file = fileOf(id);
  if (!existsSync(file)) return null;
  try { const r = readGenome(file); return r.error ? null : r.genome; } catch { return null; }
}

// Valida (forPlay: false: las piezas también se guardan) y escribe tmp + rename
export function saveNet(genome) {
  const v = validate(genome);
  if (!v.ok) return { ok: false, errors: v.errors };
  const g = normalize(genome);
  const file = fileOf(g.id), tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(g));
  renameSync(tmp, file);
  return { ok: true, id: g.id };
}

export function deleteNet(id) {
  if (!ID_RE.test(String(id))) return false;
  const file = fileOf(id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

// Carpeta del laboratorio (evo/ o GW_EVO_DIR) y lectura del trono (spec/06 §2; F5 solo lo lee para elegir rival)
export function evoDir() {
  return process.env.GW_EVO_DIR ? process.env.GW_EVO_DIR : join(ROOT, 'evo');
}
export function readThrone() {
  const file = join(evoDir(), 'throne.json');
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
}


// Partidas guardadas (moviola, spec/07 §1): evo/games/<gameId>.json = {meta, events}; registro evo/log.jsonl
export function gamesDir() {
  const base = join(evoDir(), 'games');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}
const GAME_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function saveGame(meta, events, trajectories = null) {
  if (!meta || !GAME_ID_RE.test(String(meta.gameId))) return { ok: false, error: 'gameId inválido' };
  const file = join(gamesDir(), `${meta.gameId}.json`);
  const tmp = file + '.tmp';
  // los vectores de observación son Float64Array: en JSON van como listas normales
  writeFileSync(tmp, JSON.stringify(trajectories ? { meta, events, trajectories } : { meta, events }, (k, v) => (v && ArrayBuffer.isView(v) ? Array.from(v) : v)));
  renameSync(tmp, file);
  return { ok: true, id: meta.gameId, file };
}
// lista de partidas guardadas (meta) ordenadas por ts ascendente; filtro opcional por red
export function listGames({ netId = null } = {}) {
  const out = [];
  for (const fname of readdirSync(gamesDir())) {
    if (!fname.endsWith('.json') || fname.endsWith('.nets.json')) continue;
    try {
      const g = JSON.parse(readFileSync(join(gamesDir(), fname), 'utf8'));
      if (!g || !g.meta) continue;
      if (netId && !(Array.isArray(g.meta.nets) && g.meta.nets.includes(netId))) continue;
      out.push(g.meta);
    } catch { /* fichero roto */ }
  }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.gameId).localeCompare(String(b.gameId)));
}
// retención (spec/07 §1, §12.1): deja las `keep` más recientes de la red; los duelos de trono no se borran
export function pruneGames(netId, keep = 200) {
  const mine = listGames({ netId }).filter((m) => !m.throne);
  const removed = [];
  for (const m of mine.slice(0, Math.max(0, mine.length - keep))) {
    try { unlinkSync(join(gamesDir(), `${m.gameId}.json`)); removed.push(m.gameId); } catch { /* ya no está */ }
    const nets = join(gamesDir(), `${m.gameId}.nets.json`);
    if (existsSync(nets)) { try { unlinkSync(nets); } catch { /* ignorar */ } }
  }
  return removed;
}
export function loadGame(id) {
  if (!GAME_ID_RE.test(String(id))) return null;
  const file = join(gamesDir(), `${id}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
// registro (spec/07 §1, §12.1, §12.8): una línea por evento con id secuencial; rota a log.1.jsonl al superar maxBytes
const logFile = () => join(evoDir(), 'log.jsonl');
let logSeq = null;
function lastLogId() {
  try {
    if (!existsSync(logFile())) return 0;
    const lines = readFileSync(logFile(), 'utf8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) { try { const e = JSON.parse(lines[i]); if (Number.isInteger(e.id)) return e.id; } catch { /* seguir */ } }
  } catch { /* sin registro */ }
  return 0;
}
export function appendLog(entry, { maxBytes = 50 * 1024 * 1024 } = {}) {
  if (!existsSync(evoDir())) mkdirSync(evoDir(), { recursive: true });
  if (logSeq === null) logSeq = lastLogId();
  try { if (existsSync(logFile()) && statSync(logFile()).size > maxBytes) renameSync(logFile(), join(evoDir(), 'log.1.jsonl')); } catch { /* ignorar */ }
  const id = ++logSeq;
  const { id: entryId, ...rest } = entry || {};
  writeFileSync(logFile(), JSON.stringify({ id, ts: Date.now(), ...rest, ...(entryId !== undefined ? { entryId } : {}) }) + '\n', { flag: 'a' });
  return id;
}
export function readLog({ limit = 0 } = {}) {
  if (!existsSync(logFile())) return [];
  const out = [];
  for (const line of readFileSync(logFile(), 'utf8').split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* línea rota */ } }
  return limit > 0 ? out.slice(-limit) : out;
}
export function loadLogEntry(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  for (const file of [logFile(), join(evoDir(), 'log.1.jsonl')]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line); if (e.id === n) return e; } catch { /* seguir */ } }
  }
  return null;
}
// bofetadas y caricias pendientes por red (spec/07 §12.8)
const feedbackFile = (netId) => join(netsDir(), netId, 'feedback.json');
export function readFeedback(netId) {
  try { return existsSync(feedbackFile(netId)) ? JSON.parse(readFileSync(feedbackFile(netId), 'utf8')) : []; } catch { return []; }
}
export function writeFeedback(netId, list) {
  const dir = join(netsDir(), netId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = feedbackFile(netId) + '.tmp';
  writeFileSync(tmp, JSON.stringify(list));
  renameSync(tmp, feedbackFile(netId));
}
// bofetadas y caricias ya aplicadas (spec/04 §10.4): las 50 últimas
const appliedFile = (netId) => join(netsDir(), netId, 'feedback-applied.json');
export function readApplied(netId) {
  try { const f = appliedFile(netId); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; } catch { return []; }
}
export function appendApplied(netId, entry) {
  const dir = join(netsDir(), netId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const list = [...readApplied(netId), entry].slice(-50);
  const f = appliedFile(netId), tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(list)); renameSync(tmp, f);
  return list;
}

// copia de los genomas de una partida (duelos de trono, spec/07 §10): evo/games/<gameId>.nets.json
export function saveGameNets(gameId, nets) {
  if (!GAME_ID_RE.test(String(gameId))) return { ok: false };
  const file = join(gamesDir(), gameId + '.nets.json'), tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(nets)); renameSync(tmp, file);
  return { ok: true, file };
}
export function loadGameNets(gameId) {
  if (!GAME_ID_RE.test(String(gameId))) return null;
  const file = join(gamesDir(), gameId + '.nets.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
