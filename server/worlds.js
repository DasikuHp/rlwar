// Mundos (spec/09, P2): 3 ranuras en <base>/worlds/<n>/, cada una un mundo entero; el mundo activo decide dónde lee y
// escribe el laboratorio (evo/store.js); rutas /api/worlds; migración de lo de antes (una vez, sin borrar nada).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, copyFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseDir, setActiveDir } from '../evo/store.js';
import { labBusyReason, resetLab, pushLabEvent } from '../evo/api.js';
import { rooms } from './rooms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VIDENTE_BASE = join(ROOT, 'evo', 'base', 'vidente-1.json');
export const ARCHIVE = 'archivo-2026-09-23';
const LEGACY = ['nets', 'games', 'records', 'snapshots', 'throne.json', 'log.jsonl', 'log.1.jsonl'];
const SLOTS = [1, 2, 3];
const PATHS = { cero: 'A', algo: 'B', rl: 'C' }; // camino del tutorial → nivel del editor con el que se empieza
const LEVELS = ['A', 'B', 'C'];
const ID_RE = /^[a-z0-9-]{3,32}$/;

const worldsDir = () => join(baseDir(), 'worlds');
export const worldDir = (n) => join(worldsDir(), String(n));
const metaFile = (n) => join(worldDir(n), 'meta.json');
const activeFile = () => join(worldsDir(), 'active.json');
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(value)); renameSync(tmp, file); };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const readMeta = (n) => (existsSync(metaFile(n)) ? readJson(metaFile(n)) : null);
const slotOf = (s) => (/^[123]$/.test(String(s)) ? Number(s) : null);
let active = null; // la ranura abierta, o null (<base>)

// ---------- lo que se valida (spec/09 §2) ----------
const nameError = (v) => (typeof v !== 'string' || !v.trim() || v.length > 40 || /[\r\n]/.test(v) ? 'El nombre tiene que tener de 1 a 40 caracteres, en una sola línea.' : null);
const levelError = (v) => (!LEVELS.includes(v) ? 'El nivel tiene que ser A (Aprendiz), B (Artesano) o C (Científico).' : null);
const tutorialError = (v) => (!v || typeof v !== 'object' || Array.isArray(v) ? 'El avance del tutorial tiene que ser un objeto.'
  : JSON.stringify(v).length > 65536 ? 'El avance del tutorial no puede pasar de 64 kB.' : null);

// ---------- vista de una ranura con datos reales de su carpeta ----------
function worldView(n) {
  const meta = readMeta(n);
  if (!meta) return { n, empty: true };
  const dir = worldDir(n);
  const files = (sub, test) => { try { return readdirSync(join(dir, sub)).filter(test); } catch { return []; } };
  const nets = files('nets', (f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5))).length;
  const games = files('games', (f) => f.endsWith('.meta.json')).length;
  const throne = readJson(join(dir, 'throne.json')) || {};
  const qg = throne.queen ? readJson(join(dir, 'nets', `${throne.queen}.json`)) : null;
  const queen = throne.queen ? { id: throne.queen, name: qg ? qg.name : throne.queen, emblem: qg && Number.isInteger(qg.emblem) ? qg.emblem : null } : null;
  const reigns = Array.isArray(throne.reigns) ? throne.reigns.length : 0;
  const { name, path, level, createdAt, lastPlayedAt, tutorial, practice } = meta;
  return { n, empty: false, name, path, level, createdAt, lastPlayedAt, tutorial, practice, nets, games, queen, reigns };
}

// algo en marcha en el mundo activo: entrenos, duelos y trabajos (evo/api.js), redes ocupadas y salas con una red jugando
function busyReason() {
  const lab = labBusyReason();
  if (lab) return lab;
  for (const r of rooms.values()) {
    if (r.phase === 'playing' && r.players.some((p) => p.agentType === 'net')) return `Hay una partida con una red en curso (sala ${r.code}): espera a que acabe antes de cambiar de mundo.`;
  }
  return null;
}

function openWorld(n) {
  setActiveDir(worldDir(n));
  active = n;
  resetLab();
}

// ---------- arranque: migración (solo en la carpeta real) y el último mundo abierto ----------
export function startWorlds() {
  if (!process.env.GW_EVO_DIR) migrateLegacy(baseDir());
  const a = readJson(activeFile());
  const n = a && slotOf(a.n);
  if (n && readMeta(n)) openWorld(n);
}

// lo de antes, suelto en <base>, pasa tal cual a <base>/archivo-2026-09-23/ (spec/09 §5); si el archivo ya existe, nada
export function migrateLegacy(base) {
  const archive = join(base, ARCHIVE);
  if (existsSync(archive)) return { moved: [] };
  const loose = LEGACY.filter((name) => existsSync(join(base, name)));
  if (!loose.length) return { moved: [] };
  mkdirSync(archive, { recursive: true });
  for (const name of loose) renameSync(join(base, name), join(archive, name));
  return { moved: loose };
}

// ---------- rutas /api/worlds (spec/09 §4): devuelve {status, body} ----------
export function worldsRoute(method, seg, body = {}) {
  const bad = (status, error) => ({ status, body: { error } });
  if (!seg.length) {
    if (method !== 'GET') return bad(405, 'Método no permitido');
    return { status: 200, body: { active, worlds: SLOTS.map(worldView) } };
  }
  const n = slotOf(seg[0]);
  if (!n) return bad(404, 'Las ranuras son 1, 2 y 3');
  const sub = seg[1] || null;
  const meta = readMeta(n);

  if (sub === 'new' && method === 'POST' && seg.length === 2) {
    if (meta) return bad(409, `La ranura ${n} ya tiene un mundo ("${meta.name}")`);
    if (!Object.hasOwn(PATHS, body.path)) return bad(400, 'El camino tiene que ser "cero" (Desde cero), "algo" (Ya sé algo) o "rl" (Sé de RL).');
    const name = body.name === undefined ? `Mundo ${n}` : body.name;
    const err = nameError(name);
    if (err) return bad(400, err);
    if (!existsSync(VIDENTE_BASE)) return bad(500, 'Falta evo/base/vidente-1.json: sin ella no hay rival de práctica.');
    // se monta aparte y se pone en su sitio de una vez: una ranura nunca queda a medias
    const tmp = join(worldsDir(), `.nuevo-${n}-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, 'nets'), { recursive: true });
    copyFileSync(VIDENTE_BASE, join(tmp, 'nets', 'vidente-1.json'));
    const now = Date.now();
    writeJson(join(tmp, 'meta.json'), { format: 1, n, name, path: body.path, level: PATHS[body.path], createdAt: now, lastPlayedAt: now, practice: ['vidente-1'], tutorial: {} });
    rmSync(worldDir(n), { recursive: true, force: true }); // restos sin meta.json de un intento anterior
    renameSync(tmp, worldDir(n));
    return { status: 201, body: { world: worldView(n) } };
  }

  if (!meta) return bad(404, `La ranura ${n} está vacía`);

  if (sub === 'open' && method === 'POST' && seg.length === 2) {
    const reason = busyReason();
    if (reason) return bad(409, reason);
    openWorld(n);
    writeJson(metaFile(n), { ...meta, lastPlayedAt: Date.now() });
    writeJson(activeFile(), { n });
    pushLabEvent('world', { active: n });
    return { status: 200, body: { active: n, world: worldView(n) } };
  }

  if (sub === 'meta' && seg.length === 2) {
    if (method === 'GET') return { status: 200, body: meta };
    if (method !== 'PUT') return bad(405, 'Método no permitido');
    const next = { ...meta };
    if (body.name !== undefined) { const e = nameError(body.name); if (e) return bad(400, e); next.name = body.name; }
    if (body.level !== undefined) { const e = levelError(body.level); if (e) return bad(400, e); next.level = body.level; }
    if (body.tutorial !== undefined) { const e = tutorialError(body.tutorial); if (e) return bad(400, e); next.tutorial = body.tutorial; }
    writeJson(metaFile(n), next);
    return { status: 200, body: { meta: next } };
  }

  if (!sub && method === 'DELETE') {
    if (body.confirm !== meta.name) return bad(400, `Para borrar el mundo escribe su nombre exacto ("${meta.name}")`);
    if (active === n) {
      const reason = busyReason();
      if (reason) return bad(409, reason);
    }
    const d = new Date(), p2 = (v) => String(v).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
    const trashDir = join(baseDir(), 'archivo-borrados');
    mkdirSync(trashDir, { recursive: true });
    let trash = join(trashDir, `${stamp}-mundo-${n}`);
    for (let k = 2; existsSync(trash); k++) trash = join(trashDir, `${stamp}-mundo-${n}-${k}`);
    if (active === n) { setActiveDir(null); active = null; resetLab(); try { unlinkSync(activeFile()); } catch { /* no estaba */ } }
    renameSync(worldDir(n), trash);
    return { status: 200, body: { deleted: n, trash } };
  }

  return bad(404, 'Ruta desconocida');
}
