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
