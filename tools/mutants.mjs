#!/usr/bin/env node
// Prueba de mutantes sin dependencias (spec/00 §4): mete UN fallo a propósito por mutante
// (operador, constante, booleano, `return`) y exige que algún test lo cace (falla o revienta por
// tiempo). Nunca toca el original: trabaja sobre una copia del repo en el directorio temporal del
// sistema (gw-mutants-<pid>), que se borra al acabar salvo --keep.
//   node tools/mutants.mjs shared/geometry.js --tests test/motor.spec.mjs[,...] [--max N] [--seed S]
//        [--timeout ms] [--root dir] [--json salida.json] [--keep]
import { readFileSync, writeFileSync, rmSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.mutants', 'referencia', 'experimentos', 'evo']);

// ---------- escáner mínimo de JS: separa comentarios, cadenas, plantillas, regex, números, ids, signos ----------
const PUNCTS = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '?.'];
const REGEX_AFTER_ID = new Set(['return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await']);

function skipString(src, i) { // i en la comilla
  const q = src[i]; let j = i + 1;
  while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
  return Math.min(src.length, j + 1);
}
function skipTemplate(src, i) { // i en '`'
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '`') return j + 1;
    if (ch === '$' && src[j + 1] === '{') { j = skipBraces(src, j + 2); continue; }
    j++;
  }
  return src.length;
}
function skipBraces(src, j) { // tras '${'; devuelve el índice tras la '}' que cierra
  let depth = 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '`') { j = skipTemplate(src, j); continue; }
    if (ch === "'" || ch === '"') { j = skipString(src, j); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return j + 1; }
    j++;
  }
  return src.length;
}

export function scan(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  const push = (type, start, end) => { toks.push({ type, value: src.slice(start, end), start, end }); i = end; };
  const lastSig = () => { for (let k = toks.length - 1; k >= 0; k--) if (toks[k].type !== 'ws' && toks[k].type !== 'comment') return toks[k]; return null; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { let j = i; while (j < n && /[ \t\r\n]/.test(src[j])) j++; push('ws', i, j); continue; }
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; push('comment', i, j); continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('comment', i, j); continue; }
    if (c === '"' || c === "'") { push('string', i, skipString(src, i)); continue; }
    if (c === '`') { push('template', i, skipTemplate(src, i)); continue; }
    if (c === '/') {
      const p = lastSig();
      const regexOk = !p || (p.type === 'punct' && ![')', ']', '}'].includes(p.value)) || (p.type === 'id' && REGEX_AFTER_ID.has(p.value));
      if (regexOk) {
        let j = i + 1, inClass = false;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          else if (src[j] === '\n') break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        push('regex', i, j); continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d || ''))) {
      let j = i;
      if (c === '0' && /[xXbBoO]/.test(d || '')) { j = i + 2; while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++; }
      else {
        while (j < n && /[0-9_.]/.test(src[j])) j++;
        if (/[eE]/.test(src[j] || '')) { let k = j + 1; if (/[+-]/.test(src[k] || '')) k++; if (/[0-9]/.test(src[k] || '')) { j = k; while (j < n && /[0-9]/.test(src[j])) j++; } }
      }
      if (src[j] === 'n') j++;
      push('num', i, j); continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; push('id', i, j); continue; }
    const p = PUNCTS.find((q) => src.startsWith(q, i));
    push('punct', i, i + (p ? p.length : 1));
  }
  return toks;
}

// ---------- generación de mutantes ----------
const SWAP = { '+': '-', '-': '+', '*': '/', '/': '*', '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===', '==': '!=', '!=': '==', '&&': '||', '||': '&&', '+=': '-=', '-=': '+=' };

function lineCol(src, pos) {
  let line = 1, last = -1;
  for (let i = 0; i < pos; i++) if (src.charCodeAt(i) === 10) { line++; last = i; }
  return { line, col: pos - last };
}

export function generateMutants(src) {
  const toks = scan(src);
  const sig = (k, dir) => { for (let j = k + dir; j >= 0 && j < toks.length; j += dir) if (toks[j].type !== 'ws' && toks[j].type !== 'comment') return toks[j]; return null; };
  const out = [];
  const add = (start, end, from, to, desc) => { if (from === to) return; const { line, col } = lineCol(src, start); out.push({ id: out.length + 1, line, col, start, end, from, to, desc }); };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'punct' && SWAP[t.value]) {
      const prev = sig(k, -1), next = sig(k, 1);
      if (t.value === '*' && ((prev && prev.type === 'id' && (prev.value === 'import' || prev.value === 'export')) || (next && next.type === 'id' && next.value === 'as'))) continue;
      add(t.start, t.end, t.value, SWAP[t.value], `operador ${t.value} → ${SWAP[t.value]}`);
    } else if (t.type === 'num' && !t.value.endsWith('n')) {
      const prev = sig(k, -1);
      if (prev && prev.type === 'punct' && prev.value === '.') continue;
      const v = Number(t.value.replace(/_/g, ''));
      if (!Number.isFinite(v)) continue;
      const signed = prev && prev.type === 'punct' && (prev.value === '-' || prev.value === '+');
      add(t.start, t.end, t.value, String(v + 1), `constante ${t.value} → ${v + 1}`);
      if (v !== 0) add(t.start, t.end, t.value, '0', `constante ${t.value} → 0`);
      if (v !== 0) add(t.start, t.end, t.value, signed ? `(-${t.value})` : `-${t.value}`, `constante ${t.value} → -${t.value}`);
    } else if (t.type === 'id' && (t.value === 'true' || t.value === 'false')) {
      const prev = sig(k, -1);
      if (prev && prev.type === 'punct' && prev.value === '.') continue;
      add(t.start, t.end, t.value, t.value === 'true' ? 'false' : 'true', `booleano ${t.value} → ${t.value === 'true' ? 'false' : 'true'}`);
    } else if (t.type === 'id' && t.value === 'return') {
      // `return <expr>;` en la misma línea → `return null;`
      let depth = 0, j = k + 1, body = 0, semi = null;
      for (; j < toks.length; j++) {
        const u = toks[j];
        if (u.type === 'ws' && u.value.includes('\n') && depth === 0) break;
        if (u.type === 'punct') {
          if ('([{'.includes(u.value)) depth++;
          else if (')]}'.includes(u.value)) { if (depth === 0) break; depth--; }
          else if (u.value === ';' && depth === 0) { semi = u; break; }
        }
        if (u.type !== 'ws' && u.type !== 'comment') body++;
      }
      if (semi && body > 0 && !(body === 1 && toks[j - 1] && toks[j - 1].value === 'null')) {
        add(t.start, semi.end, src.slice(t.start, semi.end), 'return null;', 'return → return null');
      }
    }
  }
  return out;
}

export function applyMutant(src, m) {
  return src.slice(0, m.start) + m.to + src.slice(m.end);
}

// ---------- ejecución ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function sampleMutants(all, max, seed = 1) {
  if (!max || all.length <= max) return all;
  const rng = mulberry32(seed);
  const arr = all.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, max).sort((a, b) => a.start - b.start);
}

function copyRepo(root, workDir) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  cpSync(root, workDir, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      if (SKIP_DIRS.has(name)) return false;
      if (name === '_battery.log' || name === '.server.pid' || name === '.graphwar-bat-pid') return false;
      return true;
    },
  });
}

export async function runMutants({ root = DEFAULT_ROOT, file, tests, max = 0, seed = 1, timeoutMs = 60000, quiet = false, keep = false, workDir = null } = {}) {
  if (!file || !tests || !tests.length) throw new Error('hace falta el fichero a mutar y al menos un test');
  const src = readFileSync(join(root, file), 'utf8');
  const all = generateMutants(src);
  const chosen = sampleMutants(all, max, seed);
  const work = workDir || join(tmpdir(), `gw-mutants-${process.pid}`);
  copyRepo(root, work);
  const target = join(work, file);
  const results = [];
  const say = (s) => { if (!quiet) console.log(s); };
  say(`🧬 ${file}: ${all.length} mutantes posibles, se prueban ${chosen.length} contra ${tests.join(', ')}`);
  say(`${'#'.padStart(4)}  ${'línea'.padStart(5)}  cambio${' '.repeat(38)}  resultado`);
  try {
    for (let i = 0; i < chosen.length; i++) {
      const m = chosen[i];
      writeFileSync(target, applyMutant(src, m));
      let killed = false, timeout = false, detail = '';
      for (const t of tests) {
        const r = spawnSync(process.execPath, [join(work, t)], { cwd: work, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, GW_FAST: '1' } });
        if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal)) { killed = true; timeout = true; detail = 'tiempo'; break; }
        if (r.signal) { killed = true; timeout = true; detail = 'tiempo'; break; }
        if (r.status !== 0) { killed = true; detail = `sale ${r.status} en ${t}`; break; }
      }
      const res = { ...m, killed, timeout, detail };
      results.push(res);
      const change = `${m.desc}`.slice(0, 44).padEnd(44);
      say(`${String(i + 1).padStart(4)}  ${String(m.line).padStart(5)}  ${change}  ${killed ? `cazado (${detail})` : 'SUPERVIVIENTE'}`);
    }
  } finally {
    writeFileSync(target, src);
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
  const killed = results.filter((r) => r.killed).length;
  const survivors = results.filter((r) => !r.killed);
  say(`\n🧬 cazados ${killed}/${results.length}${survivors.length ? ` · supervivientes: ${survivors.map((s) => `línea ${s.line} (${s.desc})`).join(' · ')}` : ' · sin supervivientes ✔'}`);
  return { file, total: results.length, possible: all.length, killed, survived: survivors.length, results, survivors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  const tests = String(opt('tests', '')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!file || !tests.length) {
    console.log('uso: node tools/mutants.mjs <fichero.js> --tests test/a.spec.mjs[,test/b.spec.mjs] [--max N] [--seed S] [--timeout ms] [--root dir] [--json out.json] [--keep]');
    process.exit(2);
  }
  const r = await runMutants({
    root: opt('root', DEFAULT_ROOT), file, tests, max: Number(opt('max', 0)) || 0, seed: Number(opt('seed', 1)) || 1,
    timeoutMs: Number(opt('timeout', 60000)) || 60000, keep: args.includes('--keep'),
  });
  const out = opt('json', null);
  if (out) writeFileSync(out, JSON.stringify(r, null, 2));
  process.exit(0);
}
