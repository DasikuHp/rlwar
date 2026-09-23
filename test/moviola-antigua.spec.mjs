// Moviola de una partida antigua (spec/07 §12.8): una partida guardada antes de M2 no lleva copia de la red
// (`meta.snaps`), así que la moviola recalcula el turno con la red ACTUAL y lo marca `approx: true`. Lo comprobaba
// api-verdad.spec antes de M2; desde M2 las partidas nuevas son exactas y este caso pasa aquí (cambio autorizado
// 2026-09-23). Levanta su propio servidor con una carpeta de datos nueva.
// Uso: node test/moviola-antigua.spec.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { compile } from '../shared/nn.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

const dir = mkdtempSync(join(tmpdir(), 'gw-evo-moviola-antigua-'));
const port = 30000 + (process.pid % 20000);
const base = `http://localhost:${port}`;
const srv = spawn(process.execPath, [join(ROOT, 'server', 'server.js')], { env: { ...process.env, GW_FAST: '1', PORT: String(port), GW_EVO_DIR: dir }, stdio: 'ignore' });
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, body: json, text };
};
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error(`tiempo agotado: ${what}`); };

try {
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 20000, 'el servidor no arranca');

  await check('partida sin copia de la red (anterior a M2, en .json): la moviola recalcula con la red actual y dice approx:true', async () => {
    const id = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Moviola Antigua' })).body.id;
    const tr = await api('/api/lab/trainings', 'POST', { netId: id, opponents: { antagonist: 0, hallOfFame: 0, self: 1 }, speed: 'turbo', duration: { games: 2 }, soldiers: 1, seed: 10 });
    assert.equal(tr.status, 202, tr.text);
    await until(async () => { const r = (await api(`/api/lab/trainings/${tr.body.id}`)).body; return r && !['queued', 'running', 'paused'].includes(r.status) ? r : null; }, 120000, 'entreno');
    const sample = (await api(`/api/lab/games?trainingId=${tr.body.id}&limit=5`)).body.games[0];
    assert.ok(sample, 'premisa: el entreno guarda una partida de muestra');
    const gz = join(dir, 'games', `${sample.gameId}.json.gz`);
    const game = JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'));
    assert.ok(game.meta.snaps && game.meta.snaps[id], 'premisa: la partida nueva lleva la copia de la red (M2)');
    const dec = game.events.find((e) => e.type === 'decision' && e.actor.netId === id && e.data.phase === 'shoot' && typeof e.data.value === 'number' && game.trajectories[e.actor.playerId]);
    assert.ok(dec, 'premisa: una decisión de disparo de la red con valor y trayectoria');
    const exact = await api(`/api/lab/games/${sample.gameId}/turns/${dec.turn}/brain?player=${dec.actor.playerId}`);
    assert.equal(exact.status, 200, exact.text);
    assert.deepEqual([exact.body.approx, exact.body.outputs.value], [false, dec.data.value], 'premisa: con la copia, exacta');

    // la partida pasa a ser "antigua": sin meta.snaps y en .json sin comprimir, como se guardaban antes de M2 y M15
    const { snaps, ...oldMeta } = game.meta;
    writeFileSync(join(dir, 'games', `${sample.gameId}.json`), JSON.stringify({ ...game, meta: oldMeta }));
    unlinkSync(gz);
    assert.ok(!existsSync(gz));
    // y la red cambia después de jugarla: todos sus pesos × 1.5
    const cur = (await api(`/api/lab/nets/${id}`)).body.genome;
    for (const w of Object.values(cur.weights)) for (const k of Object.keys(w)) w[k] = w[k].map((v) => v * 1.5);
    const put = await api(`/api/lab/nets/${id}`, 'PUT', cur);
    assert.equal(put.status, 200, put.text);

    const r = await api(`/api/lab/games/${sample.gameId}/turns/${dec.turn}/brain?player=${dec.actor.playerId}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.approx, true, 'sin copia de la red: aproximada');
    assert.equal(r.body.decision.eventId, dec.id);
    assert.equal(r.body.netId, id);
    // oráculo: la trayectoria del soldado hasta esa decisión, recorrida con la red actual desde el estado cero
    const steps = game.trajectories[dec.actor.playerId].soldiers[dec.actor.soldierId];
    const idx = steps.findIndex((s) => s.decision && s.decision.eventId === dec.id);
    const net = compile((await api(`/api/lab/nets/${id}`)).body.genome);
    let st = net.zeroState(), out = null;
    for (let i = 0; i <= idx; i++) { out = net.forward(steps[i].obs, st); st = out.state; }
    assert.equal(r.body.outputs.value, out.outputs.value, 'el valor es el de la red actual');
    assert.notEqual(r.body.outputs.value, dec.data.value, 'y no el que tuvo en la partida (la red cambió)');
    assert.deepEqual(r.body.outputs.choose, Array.from(out.outputs.choose.scores));
  });
} finally {
  srv.kill();
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (moviola de una partida antigua)');
process.exitCode = fails ? 1 : 0;
