// Parte 3, liga y validación (spec/revision-opus.md §3.3 M11, M13, B1): los duelos libres cuentan para la liga (una
// vez; los de trono y dinastía, también una sola vez), la bombilla se enciende con un cambio del 1,5 % por defecto y
// `validate` avisa de lo que falta, cita solo los bloques del bucle y los errores de pesos llevan ejemplo.
// Escrito ANTES del código y congelado. Uso: node test/arreglos-liga.spec.mjs [http://localhost:8791]
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-liga-'));

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const { TEMPLATES } = await import('../shared/templates.js');
const { validate, normalize } = await import('../shared/genome.js');
const lab = await import('../evo/api.js');

// ---------- M13: umbral de la bombilla ----------
await check('M13: el umbral de la bombilla por defecto es 0.015 (genoma y catálogo)', () => {
  const g = clone(TEMPLATES.seer.genome); delete g.learning.sleep;
  assert.equal(normalize(g).learning.sleep.lessonThreshold, 0.015);
  const flat = JSON.stringify(lab.catalog().learning);
  assert.ok(flat.includes('sleep.lessonThreshold'), 'el catálogo lo lista');
  const entry = (function find(x) { if (!x || typeof x !== 'object') return null; if (x.key === 'sleep.lessonThreshold') return x; for (const v of Object.values(x)) { const r = find(v); if (r) return r; } return null; })(lab.catalog().learning);
  assert.equal(entry.default, 0.015);
});

// ---------- B1: validate ----------
await check('B1: una red sin Elegir es válida para guardar, pero validate avisa de que no puede jugar (y para jugar es un error)', () => {
  const g = clone(TEMPLATES.seer.genome);
  const chooseId = g.blocks.find((b) => b.type === 'hand.choose').id;
  g.blocks = g.blocks.filter((b) => b.id !== chooseId);
  g.wires = g.wires.filter((w) => w.from !== chooseId && w.to !== chooseId);
  delete g.weights[chooseId];
  const v = validate(g);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.ok(v.warnings.some((w) => w.code === 'missing-choose' && /no puede jugar/.test(w.message)), JSON.stringify(v.warnings));
  assert.ok(validate(g, { forPlay: true }).errors.some((e) => e.code === 'missing-choose'));
  assert.ok(!validate(clone(TEMPLATES.seer.genome)).warnings.some((w) => w.code === 'missing-choose'), 'con Elegir no avisa');
});

await check('B1: el error de bucle cita solo los bloques del bucle (no los que cuelgan de él) y señala uno de ellos', () => {
  const g = clone(TEMPLATES.turtle.genome); // cat → g → d → cd → ch: el primer cable interior es cat → g; con g → cat, el bucle es {cat, g}
  const isEye = (id) => g.blocks.find((b) => b.id === id).type.startsWith('eye.');
  const w = g.wires.find((x) => !isEye(x.from) && !isEye(x.to) && g.wires.some((y) => y.from === x.to));
  assert.ok(w, 'premisa: un cable entre bloques interiores con algo detrás');
  g.wires.push({ from: w.to, to: w.from });
  // oráculo: componente fuertemente conexa que contiene a w.from
  const next = (id) => g.wires.filter((x) => x.from === id).map((x) => x.to), prev = (id) => g.wires.filter((x) => x.to === id).map((x) => x.from);
  const reach = (id, step) => { const seen = new Set([id]); const st = [id]; while (st.length) for (const n of step(st.pop())) if (!seen.has(n)) { seen.add(n); st.push(n); } return seen; };
  const fwd = reach(w.from, next), back = reach(w.from, prev);
  const cycle = g.blocks.map((b) => b.id).filter((id) => fwd.has(id) && back.has(id));
  const downstream = g.blocks.map((b) => b.id).filter((id) => fwd.has(id) && !back.has(id));
  assert.ok(downstream.length > 0, 'premisa: hay bloques que cuelgan del bucle');
  const e = validate(g).errors.find((x) => x.code === 'cycle');
  assert.ok(e, 'hay error de bucle');
  for (const id of cycle) assert.ok(e.message.includes(`${id}`), `cita ${id}: ${e.message}`);
  const listed = e.message.slice(e.message.indexOf('entre ') + 6, e.message.indexOf(':')).split(', ');
  assert.deepEqual(listed.sort(), [...cycle].sort(), e.message);
  assert.ok(cycle.includes(e.blockId), `blockId ${e.blockId} está en el bucle`);
});

// ---------- por la API ----------
if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text };
  };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };
  const mkNet = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };
  const duelDone = (id) => until(async () => { const r = (await api(`/api/lab/duels/${id}`)).body; return r && r.status !== 'running' ? r : null; }, 180000, 'fin del duelo');
  const pair = async (x, y) => { const p = (await api('/api/lab/throne')).body.league.pairs[x < y ? `${x}|${y}` : `${y}|${x}`]; return p ? p.wins + p.losses : 0; };
  const decided = (rec) => rec.games.filter((g) => g.winner === rec.a || g.winner === rec.b).length;

  await check('M11: un duelo libre cuenta para la liga (sus partidas con ganador, una vez); un reto al trono, también una sola vez', async () => {
    const a = await mkNet('seer', 'Liga A'), b = await mkNet('sniper', 'Liga B');
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 31 });
    assert.equal(d.status, 202, d.text);
    const rec = await duelDone(d.body.id);
    assert.ok(decided(rec) > 0, 'premisa: alguna partida con ganador');
    assert.equal(await until(async () => (await pair(a, b)) || null, 10000, 'liga'), decided(rec));
    const c = await mkNet('turtle', 'Liga Retadora');
    if (!(await api('/api/lab/throne')).body.queen) await api('/api/lab/throne/challenge', 'POST', { challenger: await mkNet('seer', 'Liga Reina') });
    const queen = (await api('/api/lab/throne')).body.queen;
    const before = await pair(c, queen);
    const ch = await api('/api/lab/throne/challenge', 'POST', { challenger: c, speed: 'turbo', learning: 'frozen', seed: 32 });
    assert.ok([200, 202].includes(ch.status), ch.text);
    const drec = await duelDone(ch.body.duelId);
    await sleep(300);
    assert.equal(await pair(c, queen), before + decided(drec), 'el reto cuenta una vez');
  });

  await check('M11: en una generación, cada duelo de la dinastía cuenta una sola vez', async () => {
    const a = await mkNet('sniper', 'Liga Norte'), b = await mkNet('turtle', 'Liga Sur');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Norte', netId: a }, B: { name: 'Casa Sur', netId: b } })).status, 200);
    const g = await api('/api/lab/dynasties/generation', 'POST', { training: { speed: 'turbo', duration: { games: 2 }, soldiers: 1 }, children: { n: 2, pretournament: { games: 1, soldiers: 1 } }, duel: { learning: 'frozen', speed: 'turbo', soldiers: 1 }, seed: 6 });
    assert.equal(g.status, 202, g.text);
    const job = await until(async () => { const j = (await api(`/api/lab/jobs/${g.body.jobId}`)).body; return j && j.status !== 'running' ? j : null; }, 300000, 'generación');
    assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300));
    const rec = (await api(`/api/lab/duels/${job.result.duelId}`)).body;
    assert.equal(await pair(rec.a, rec.b), decided(rec), 'el duelo entre casas cuenta una vez');
  });

  await check('B1: los errores de PUT /nets/:id/weights/:bloque llevan un ejemplo con la forma esperada', async () => {
    const id = await mkNet('seer', 'Pesos B1');
    const g = (await api(`/api/lab/nets/${id}`)).body.genome;
    const dense = g.blocks.find((b) => b.type === 'dense');
    const keys = Object.keys(g.weights[dense.id]);
    const n = g.weights[dense.id][keys[0]].length;
    for (const body of [[1, 2], { nope: [1] }, { [keys[0]]: [1, 2] }, { [keys[0]]: Array.from({ length: n }, (_, i) => (i === 3 ? 'x' : 0)) }]) {
      const r = await api(`/api/lab/nets/${id}/weights/${dense.id}`, 'PUT', body);
      assert.equal(r.status, 400, r.text);
      for (const e of r.body.errors) assert.ok(typeof e.example === 'string' && e.example.includes(`"${keys[0]}"`) && e.example.includes(String(n)), JSON.stringify(e));
    }
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: liga y validación)');
process.exitCode = fails ? 1 : 0;
