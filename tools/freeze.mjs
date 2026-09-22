#!/usr/bin/env node
// Congelado de tests (spec/00 §4): huella SHA-256 (con finales de línea LF) de cada test en
// test/FROZEN.json. `run-all.mjs` comprueba las huellas antes de correr nada.
//   node tools/freeze.mjs test/a.spec.mjs [test/b.spec.mjs ...]   → escribe/fusiona huellas
//   node tools/freeze.mjs --check                                   → sale 1 si alguna no coincide
//   opción --root <dir> (por defecto la raíz del repo)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN_FILE = 'test/FROZEN.json';

export const posix = (p) => String(p).split('\\').join('/');

export function hashText(text) {
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

export function hashFile(path) {
  return hashText(readFileSync(path, 'utf8'));
}

export function readFrozen(root = DEFAULT_ROOT) {
  const p = join(root, FROZEN_FILE);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

// Añade (o actualiza) las huellas de `files` conservando las demás; claves ordenadas.
export function freeze(root, files) {
  const frozen = readFrozen(root) || {};
  for (const f of files) {
    const rel = posix(f);
    frozen[rel] = hashFile(join(root, rel));
  }
  const sorted = Object.fromEntries(Object.keys(frozen).sort().map((k) => [k, frozen[k]]));
  writeFileSync(join(root, FROZEN_FILE), JSON.stringify(sorted, null, 2) + '\n');
  return sorted;
}

export function checkFrozen(root = DEFAULT_ROOT) {
  const frozen = readFrozen(root);
  if (!frozen) return { ok: true, frozen: 0, mismatches: [], missing: [], warning: `sin ${FROZEN_FILE}: nada congelado aún` };
  const mismatches = [], missing = [];
  for (const [file, expected] of Object.entries(frozen)) {
    const p = join(root, file);
    if (!existsSync(p)) { missing.push(file); continue; }
    const actual = hashFile(p);
    if (actual !== expected) mismatches.push({ file, expected, actual });
  }
  return { ok: mismatches.length === 0 && missing.length === 0, frozen: Object.keys(frozen).length, mismatches, missing };
}

export function describeCheck(r) {
  const lines = [];
  if (r.warning) lines.push(`⚠ ${r.warning}`);
  for (const m of r.mismatches) lines.push(`✘ huella distinta: ${m.file} (congelada ${m.expected.slice(0, 12)}…, actual ${m.actual.slice(0, 12)}…)`);
  for (const f of r.missing) lines.push(`✘ test congelado que falta: ${f}`);
  if (r.ok) lines.push(`🔒 ${r.frozen} test(s) congelado(s): huellas OK`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--root');
  const root = ri >= 0 ? args[ri + 1] : DEFAULT_ROOT;
  const files = args.filter((a, i) => !a.startsWith('--') && (ri < 0 || i !== ri + 1));
  if (args.includes('--check')) {
    const r = checkFrozen(root);
    console.log(describeCheck(r));
    process.exit(r.ok ? 0 : 1);
  }
  if (!files.length) {
    console.log('uso: node tools/freeze.mjs [--root dir] test/x.spec.mjs [...] | --check');
    process.exit(2);
  }
  const out = freeze(root, files);
  for (const f of files) console.log(`🔒 ${posix(f)} ${out[posix(f)]}`);
}
