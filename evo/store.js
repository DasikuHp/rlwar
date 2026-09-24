// Almacén de redes en disco (spec/03 §9.4): evo/nets/<id>.json (o GW_EVO_DIR/nets). Escritura atómica.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate, normalize, countParams } from '../shared/genome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function netsDir() {
  const base = join(evoDir(), 'nets');
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

// Carpeta de datos de siempre (evo/ o GW_EVO_DIR) y la del laboratorio: la del mundo activo si hay uno (spec/09 §1)
export function baseDir() {
  return process.env.GW_EVO_DIR ? process.env.GW_EVO_DIR : join(ROOT, 'evo');
}
let activeDir = null;
export function setActiveDir(dir) { activeDir = dir; logSeq = null; }
export function evoDir() {
  return activeDir || baseDir();
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
// los vectores de observación son Float64Array: en JSON van como listas normales
const plain = (k, v) => (v && ArrayBuffer.isView(v) ? Array.from(v) : v);
// el fichero de una partida, sin escribir nada (lo puede hacer el hilo que la jugó, auditoría s3): la meta con la huella
// de cada genoma (`snaps`, M2) y el gzip del JSON {meta, events, trajectories?} (M15)
export function packGame(meta, events, trajectories = null, genomes = null) {
  const m = genomes ? { ...meta, snaps: Object.fromEntries(Object.entries(genomes).filter(([, g]) => g).map(([id, g]) => [id, snapshotSha(g)])) } : meta;
  return { meta: m, gz: gzipSync(JSON.stringify(trajectories ? { meta: m, events, trajectories } : { meta: m, events }, plain)) };
}
// `genomes` = {netId: genoma tal como jugó}: se guarda una copia por huella y la meta la cita en `snaps` (M2);
// `packed` = lo que devolvió packGame para esta misma partida (no se vuelve a empaquetar)
export function saveGame(meta, events, trajectories = null, { genomes = null, packed = null } = {}) {
  if (!meta || !GAME_ID_RE.test(String(meta.gameId))) return { ok: false, error: 'gameId inválido' };
  if (genomes) for (const g of Object.values(genomes)) if (g) saveSnapshot(g);
  const p = packed || packGame(meta, events, trajectories, genomes);
  const file = join(gamesDir(), `${p.meta.gameId}.json.gz`);
  const tmp = file + '.tmp';
  writeFileSync(tmp, p.gz);
  renameSync(tmp, file);
  // su meta al lado (spec/08 §9.1) y en el índice (M15)
  const mfile = join(gamesDir(), `${p.meta.gameId}.meta.json`), mtmp = mfile + '.tmp';
  writeFileSync(mtmp, JSON.stringify(p.meta)); renameSync(mtmp, mfile);
  indexAppend({ a: p.meta });
  return { ok: true, id: p.meta.gameId, file };
}
// guarda y aplica la retención de 200 partidas a cada red de la partida (spec/07 §12.1, spec/08 §9.2);
// la usan quienes guardan partidas nuevas: entrenos, duelos y exhibiciones
export function saveGameKept(meta, events, trajectories = null, opts = {}) {
  const r = saveGame(meta, events, trajectories, opts);
  if (r.ok) for (const netId of new Set(Array.isArray(meta.nets) ? meta.nets : [])) pruneGames(netId, 200);
  return r;
}
// lista de partidas guardadas (meta) ordenadas por ts ascendente; filtro opcional por red
// índice de metas (M15): games/index.jsonl, una línea {a: meta} al guardar y {d: gameId} al borrar; si falta, se
// reconstruye con las metas de al lado; se compacta cuando tiene más del doble de líneas que partidas vivas (+200)
const indexFile = () => join(gamesDir(), 'index.jsonl');
function indexAppend(line) { if (existsSync(indexFile())) appendFileSync(indexFile(), JSON.stringify(line) + '\n'); }
function indexWrite(metas) { const f = indexFile(), tmp = f + '.tmp'; writeFileSync(tmp, metas.map((m) => JSON.stringify({ a: m }) + '\n').join('')); renameSync(tmp, f); }
function indexRead() {
  if (!existsSync(indexFile())) return null;
  const live = new Map();
  let lines = 0;
  for (const l of readFileSync(indexFile(), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    lines++;
    try { const e = JSON.parse(l); if (e.a && e.a.gameId) live.set(e.a.gameId, e.a); else if (e.d) live.delete(e.d); } catch { /* línea rota */ }
  }
  if (lines > 2 * live.size + 200) indexWrite([...live.values()]);
  return [...live.values()];
}
export function listGames({ netId = null } = {}) {
  let all = indexRead();
  if (!all) { all = scanMetas(); indexWrite(all); }
  const out = netId ? all.filter((m) => Array.isArray(m.nets) && m.nets.includes(netId)) : all.slice();
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0) || String(a.gameId).localeCompare(String(b.gameId)));
}
const readGameFile = (file) => JSON.parse(file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8'));
// sin índice: las metas de al lado; si no hay (partidas antiguas), la del fichero entero (.json o .json.gz)
function scanMetas() {
  const out = [];
  const dir = gamesDir();
  const names = readdirSync(dir), metas = new Set(names.filter((f) => f.endsWith('.meta.json'))), seen = new Set();
  for (const fname of names) {
    const gz = fname.endsWith('.json.gz');
    if (!(gz || fname.endsWith('.json')) || fname.endsWith('.nets.json') || fname.endsWith('.meta.json')) continue;
    const id = fname.slice(0, gz ? -8 : -5);
    if (seen.has(id)) continue;
    try {
      const meta = metas.has(`${id}.meta.json`) ? JSON.parse(readFileSync(join(dir, `${id}.meta.json`), 'utf8')) : (readGameFile(join(dir, fname)) || {}).meta;
      if (!meta) continue;
      seen.add(id);
      out.push(meta);
    } catch { /* fichero roto */ }
  }
  return out;
}
// retención (spec/07 §1, §12.1): deja las `keep` más recientes de la red; los duelos de trono no se borran
export function pruneGames(netId, keep = 200) {
  const mine = listGames({ netId }).filter((m) => !m.throne);
  const removed = [];
  for (const m of mine.slice(0, Math.max(0, mine.length - keep))) {
    for (const side of [`${m.gameId}.json.gz`, `${m.gameId}.json`, `${m.gameId}.nets.json`, `${m.gameId}.meta.json`]) { const f = join(gamesDir(), side); if (existsSync(f)) { try { unlinkSync(f); } catch { /* ignorar */ } } }
    indexAppend({ d: m.gameId });
    removed.push(m.gameId);
  }
  if (removed.length) gcSnapshots();
  return removed;
}
export function loadGame(id) {
  if (!GAME_ID_RE.test(String(id))) return null;
  for (const file of [join(gamesDir(), `${id}.json.gz`), join(gamesDir(), `${id}.json`)]) {
    if (existsSync(file)) { try { return readGameFile(file); } catch { return null; } }
  }
  return null;
}
// copias de las redes tal como jugaron (M2): snapshots/<huella>.json.gz, una por genoma distinto
const snapshotsDir = () => { const d = join(evoDir(), 'snapshots'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; };
const SHA_RE = /^[0-9a-f]{20}$/;
const shaOf = (json) => createHash('sha256').update(json).digest('hex').slice(0, 20);
// la huella con la que saveSnapshot guarda un genoma, sin escribir nada
export const snapshotSha = (genome) => shaOf(JSON.stringify(genome, plain));
export function saveSnapshot(genome) {
  const json = JSON.stringify(genome, plain);
  const sha = shaOf(json);
  const file = join(snapshotsDir(), `${sha}.json.gz`);
  if (!existsSync(file)) { const tmp = file + '.tmp'; writeFileSync(tmp, gzipSync(json)); renameSync(tmp, file); }
  return sha;
}
export function loadSnapshot(sha) {
  if (!SHA_RE.test(String(sha))) return null;
  const file = join(snapshotsDir(), `${sha}.json.gz`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')); } catch { return null; }
}
// borra las copias que ya no cita ninguna partida guardada
function gcSnapshots() {
  const used = new Set();
  for (const m of listGames()) for (const sha of Object.values(m.snaps || {})) used.add(sha);
  for (const f of readdirSync(snapshotsDir())) {
    if (f.endsWith('.json.gz') && !used.has(f.slice(0, -8))) { try { unlinkSync(join(snapshotsDir(), f)); } catch { /* ignorar */ } }
  }
}
// versiones de una red (spec/04 §11.7): evo/nets/<id>/versions/<n>.json = {n, ts, reason, trainingId, genome}.
// Sesión 9: las de "antes del entreno" (con trainingId) no se borran nunca; el tope de 50 poda solo las demás (las del
// editor y las de "volver a esta"), para que 50 guardados seguidos no se lleven la de deshacer un entreno malo.
const VERSIONS_KEEP = 50;
const versionsDir = (netId) => join(netsDir(), netId, 'versions');
const versionFiles = (netId) => {
  const dir = versionsDir(netId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) => /^(\d+)\.json$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
};
export function saveVersion(genome, { reason = '', trainingId = null } = {}) {
  if (!genome || !ID_RE.test(String(genome.id))) return null;
  const dir = versionsDir(genome.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ns = versionFiles(genome.id);
  const n = (ns.length ? ns[ns.length - 1] : 0) + 1;
  const file = join(dir, `${n}.json`), tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ n, ts: Date.now(), reason, trainingId, genome }, plain)); renameSync(tmp, file);
  // solo se leen las de antes si puede sobrar alguna (hasta 50 no se mira nada)
  const prunable = ns.length + 1 <= VERSIONS_KEEP ? [] : [...ns, n].filter((k) => { const v = k === n ? { trainingId } : loadVersion(genome.id, k); return !(v && v.trainingId); });
  for (const old of prunable.slice(0, Math.max(0, prunable.length - VERSIONS_KEEP))) { try { unlinkSync(join(dir, `${old}.json`)); } catch { /* ya no está */ } }
  return n;
}
export function loadVersion(netId, n) {
  if (!ID_RE.test(String(netId)) || !Number.isInteger(Number(n))) return null;
  const file = join(versionsDir(netId), `${Number(n)}.json`);
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
}
export function listVersions(netId) {
  if (!ID_RE.test(String(netId))) return [];
  return versionFiles(netId).reverse().map((n) => loadVersion(netId, n)).filter(Boolean)
    .map((v) => ({ n: v.n, ts: v.ts, reason: v.reason, trainingId: v.trainingId ?? null, paramCount: (() => { try { return countParams(normalize(v.genome)); } catch { return null; } })() }));
}

// registros de duelos, entrenos y trabajos terminados (M9): records/<tipo>/<id>.json
const recordsDir = (kind) => { const d = join(evoDir(), 'records', kind); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; };
export function saveRecord(kind, rec) {
  if (!rec || !GAME_ID_RE.test(String(rec.id))) return false;
  const f = join(recordsDir(kind), `${rec.id}.json`), tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(rec)); renameSync(tmp, f);
  return true;
}
export function loadRecord(kind, id) {
  if (!GAME_ID_RE.test(String(id))) return null;
  const f = join(recordsDir(kind), `${id}.json`);
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; }
}
export function listRecords(kind) {
  const out = [];
  for (const f of readdirSync(recordsDir(kind))) { if (!f.endsWith('.json')) continue; try { out.push(JSON.parse(readFileSync(join(recordsDir(kind), f), 'utf8'))); } catch { /* roto */ } }
  return out;
}
// primer número libre para ids como t7 o j12, detrás de los registros guardados (tras reiniciar no se repiten)
export function nextRecordSeq(kind, prefix) {
  let max = 0;
  for (const f of readdirSync(recordsDir(kind))) { const m = new RegExp('^' + prefix + '(\\d+)\\.json$').exec(f); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
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

// curvas de entreno en disco (spec/08 §9.1): una línea por punto, las 5 000 últimas por red
const curvesFile = (netId) => join(netsDir(), netId, 'curves.jsonl');
export function appendCurve(netId, trainingId, points) {
  if (!points || !points.length) return;
  const dir = join(netsDir(), netId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const t = Date.now();
  writeFileSync(curvesFile(netId), points.map((p) => JSON.stringify({ trainingId, t, ...p })).join('\n') + '\n', { flag: 'a' });
  const lines = readFileSync(curvesFile(netId), 'utf8').split('\n').filter(Boolean);
  if (lines.length > 6000) { const tmp = curvesFile(netId) + '.tmp'; writeFileSync(tmp, lines.slice(-5000).join('\n') + '\n'); renameSync(tmp, curvesFile(netId)); }
}
export function readCurves(netId) {
  const f = curvesFile(netId);
  if (!existsSync(f)) return [];
  const byTraining = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let p; try { p = JSON.parse(line); } catch { continue; }
    const { trainingId, ...point } = p;
    (byTraining.get(trainingId) || byTraining.set(trainingId, []).get(trainingId)).push(point);
  }
  return [...byTraining].map(([trainingId, points]) => ({ trainingId, points }));
}
