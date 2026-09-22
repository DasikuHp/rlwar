// Arreglos C5 y C6 (spec/06 §7; spec/revision-opus.md): la reina no se borra por accidente, un reto fallido se anula,
// un id por duelo (también en dinastías y entre reinicios). Escrito ANTES del código y congelado.
// Uso: node test/arreglos-trono.spec.mjs [http://localhost:8791]
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-c5-'));

const BASE = process.argv[2] || null;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { TEMPLATES } = await import('../shared/templates.js');
const store = await import('../evo/store.js');
const throne = await import('../evo/throne.js');
const duel = await import('../evo/duel.js');
const save = (id) => { const r = store.saveNet({ ...clone(TEMPLATES.sniper.genome), id, name: id }); assert.ok(r.ok); return id; };
const fakeRec = (over) => ({ id: 'd-x', a: 'a', b: 'b', status: 'done', games: [], wins: {}, killDiff: 0, winner: null, tie: false, ms: 0, roomCodes: [], ...over });

await check('reina desaparecida (su fichero ya no está): el reto cierra su reinado (ended missing) y sienta a la retadora sin duelo', async () => {
  save('tq-1'); save('tc-1');
  const s = await throne.challenge({ challenger: 'tq-1' });
  assert.equal(s.result, 'seated');
  store.deleteNet('tq-1');
  let dueled = false;
  const r = await throne.challenge({ challenger: 'tc-1' }, { runDuel: async () => { dueled = true; return fakeRec({}); } });
  assert.equal(dueled, false, 'no hay duelo contra una red que no existe');
  assert.equal(r.result, 'seated'); assert.equal(r.queen, 'tc-1');
  const t = throne.readThroneFull();
  assert.equal(t.queen, 'tc-1');
  const old = t.reigns.find((x) => x.netId === 'tq-1');
  assert.ok(old && old.to && old.ended === 'missing', JSON.stringify(old));
});

await check('un duelo de reto que falla o no juega ninguna partida anula el reto: result void, la reina no suma defensa', async () => {
  save('tc-2');
  const before = clone(throne.readThroneFull().reigns.find((x) => x.netId === 'tc-1' && !x.to));
  for (const rec of [fakeRec({ status: 'error', error: 'boom' }), fakeRec({ status: 'stopped', games: [] })]) {
    const r = await throne.challenge({ challenger: 'tc-2' }, { runDuel: async () => rec });
    assert.equal(r.result, 'void');
    const t = throne.readThroneFull();
    assert.equal(t.queen, 'tc-1');
    assert.equal(t.challenges[t.challenges.length - 1].result, 'void');
    assert.deepEqual(t.reigns.find((x) => x.netId === 'tc-1' && !x.to), before, 'el reinado no cambia');
  }
});

await check('ids de duelo únicos entre procesos (reinicios) y en runDuel por defecto', async () => {
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', "import('./evo/duel.js').then((m) => console.log(m.newDuelId()))"], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const a = run(), b = run();
  assert.match(a, /^d[0-9a-z]+-\d+$/); assert.match(b, /^d[0-9a-z]+-\d+$/);
  assert.notEqual(a, b);
  const play = async (row) => ({ winner: row.left, kills: { [row.left]: 1, [row.right]: 0 }, events: [], trajectories: {}, playerIds: {}, gameId: null });
  const learner = () => ({ learn() {}, review() {}, save() {}, addStats() {} });
  const r1 = await duel.runDuel({ a: 'x1', b: 'x2', play, learner, seed: 1 });
  const r2 = await duel.runDuel({ a: 'x1', b: 'x2', play, learner, seed: 1 });
  assert.match(r1.id, /^d[0-9a-z]+-\d+$/); assert.notEqual(r1.id, r2.id);
});

if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text };
  };
  const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(200); } throw new Error(`tiempo agotado: ${what}`); };
  const mk = async (template, name) => (await api('/api/lab/nets', 'POST', { template, name })).body.id;

  await check('API: borrar a la reina → 409; con ?force=1 se cierra su reinado (ended deleted) y la siguiente retadora se sienta', async () => {
    const th0 = (await api('/api/lab/throne')).body;
    if (th0.queen) assert.equal((await api(`/api/lab/nets/${th0.queen}?force=1`, 'DELETE')).status, 200);
    const q = await mk('sniper', 'Trono Reina'), c = await mk('sniper', 'Trono Aspirante');
    assert.equal((await api('/api/lab/throne/challenge', 'POST', { challenger: q })).body.result, 'seated');
    const no = await api(`/api/lab/nets/${q}`, 'DELETE');
    assert.equal(no.status, 409, no.text); assert.ok(/reina/i.test(no.body.error), no.body.error);
    assert.equal((await api(`/api/lab/nets/${q}`)).status, 200, 'sigue existiendo');
    assert.equal((await api(`/api/lab/nets/${q}?force=1`, 'DELETE')).status, 200);
    const th = (await api('/api/lab/throne')).body;
    assert.equal(th.queen, null);
    const reign = th.reigns.find((x) => x.netId === q);
    assert.ok(reign && reign.to && reign.ended === 'deleted', JSON.stringify(reign));
    const s = await api('/api/lab/throne/challenge', 'POST', { challenger: c });
    assert.equal(s.body.result, 'seated'); assert.equal(s.body.queen, c);
  });

  await check('API: borrar a una campeona → 409; con force la casa queda sin campeona y no puede criar ni retar (400)', async () => {
    const a = await mk('sniper', 'Casa Uno'), b = await mk('sniper', 'Casa Dos');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Uno', netId: a }, B: { name: 'Casa Dos', netId: b } })).status, 200);
    const no = await api(`/api/lab/nets/${a}`, 'DELETE');
    assert.equal(no.status, 409, no.text); assert.ok(/campeona/i.test(no.body.error), no.body.error);
    assert.equal((await api(`/api/lab/nets/${a}?force=1`, 'DELETE')).status, 200);
    assert.equal((await api('/api/lab/dynasties')).body.A.champion, null);
    const g = await api('/api/lab/dynasties/generation', 'POST', {});
    assert.equal(g.status, 400, g.text); assert.ok(/campeona/i.test(g.body.error));
    const c = await api('/api/lab/dynasties/A/challenge-throne', 'POST', {});
    assert.equal(c.status, 400, c.text);
  });

  await check('API: los duelos de una generación tienen ids propios, están en /api/lab/duels y son los de la historia', async () => {
    const x = await mk('sniper', 'Gen Equis'), y = await mk('sniper', 'Gen Ye'), z = await mk('sniper', 'Gen Zeta');
    const pre = await api('/api/lab/duels', 'POST', { a: x, b: z, speed: 'turbo', soldiers: 1, seed: 3 });
    assert.equal(pre.status, 202);
    await until(async () => (await api(`/api/lab/duels/${pre.body.id}`)).body.status === 'done', 60000, 'duelo previo');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Equis', netId: x }, B: { name: 'Casa Ye', netId: y } })).status, 200);
    const job = await api('/api/lab/dynasties/generation', 'POST', { seed: 5, training: { duration: { games: 2 }, soldiers: 1 }, children: { n: 1, pretournament: { games: 1, soldiers: 1 } }, duel: { speed: 'turbo', soldiers: 1 } });
    assert.equal(job.status, 202, job.text);
    const done = await until(async () => { const j = (await api(`/api/lab/jobs/${job.body.jobId}`)).body; return j.status === 'done' || j.status === 'error' ? j : null; }, 180000, 'generación');
    assert.equal(done.status, 'done', done.error);
    const log = (await api('/api/lab/log?limit=1000')).body.entries.filter((e) => e.type === 'dynasty' && e.event === 'promote' && (e.mother === x || e.mother === y));
    const ids = [...log.map((e) => e.duelId), done.result.duelId];
    assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3, `ids distintos: ${ids}`);
    assert.ok(!ids.includes(pre.body.id), 'no reutiliza el id de otro duelo');
    const listed = (await api('/api/lab/duels')).body.duels;
    for (const id of ids) assert.ok(listed.some((d) => d.id === id && d.status === 'done'), `${id} está en /api/lab/duels`);
    const between = listed.find((d) => d.id === done.result.duelId);
    assert.deepEqual(new Set([between.a, between.b]), new Set([done.result.A.champion, done.result.B.champion]));
    const dyn = (await api('/api/lab/dynasties')).body;
    assert.equal(dyn.A.history[dyn.A.history.length - 1].duelId, done.result.duelId);
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: trono y duelos)');
process.exitCode = fails ? 1 : 0;
