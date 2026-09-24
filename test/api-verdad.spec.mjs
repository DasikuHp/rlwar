// API de la verdad, F7 (spec/07 §7–§12; spec/08 §4): partidas de muestra con recompensa y emoción, moviola con
// cerebro, boletín como trabajo, diario y cronista verificables, neuronas con nombre (GET/PUT), bofetada y caricia.
// Escrito ANTES del código y congelado. Uso: node test/api-verdad.spec.mjs http://localhost:8791
import { strict as assert } from 'node:assert';

const BASE = process.argv[2];
if (!BASE) { console.log('FAIL ✘: hace falta la URL del servidor'); process.exit(1); }
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const api = async (p, method = 'GET', body = undefined) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no json */ }
  return { status: res.status, body: json, text };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 120000, what = 'condición') => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; assert.ok(Date.now() - t0 < ms, `tiempo agotado: ${what}`); await sleep(150); } };
function listen() {
  const ctrl = new AbortController(); const events = [];
  const ready = fetch(BASE + '/api/lab/events', { signal: ctrl.signal }).then((res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk), data = /^data: (.*)$/m.exec(chunk);
            if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null });
          }
        }
      } catch { /* abortado */ }
    })();
  });
  return { events, ready, close: () => ctrl.abort() };
}
const T = await import('../evo/truth.js');
const NUM = /-?\d+(?:[.,]\d+)?/g;

const sse = listen(); await sse.ready;
let netId, rivalId, sampleGame, decisionEv, playerId;
await check('entreno de 20 partidas: 1 partida de muestra guardada con trajectorias, eventos reward y emotion; log con update y lesson', async () => {
  // cambio (P1, 2026-09-24; misma causa que la semilla 5, con el arreglo aprobado para ella): con el mapa de círculos, en
  // la partida de muestra de la semilla 11 el rival mata antes de que la red decida; se busca desde la 11 la primera semilla
  // cuya partida de muestra lleva decisiones de la red (redes nuevas en cada intento)
  let r = null, st = null, g = null;
  for (let seed = 11; seed < 31 && !g; seed++) {
    netId = (await api('/api/lab/nets', 'POST', { template: 'seer', name: 'Delta' })).body.id;
    rivalId = (await api('/api/lab/nets', 'POST', { template: 'sniper', name: 'Rival' })).body.id;
    r = await api('/api/lab/trainings', 'POST', { netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: rivalId }, speed: 'turbo', workers: 1, duration: { games: 20 }, soldiers: 1, seed });
    assert.equal(r.status, 202, r.text);
    st = await until(async () => { const x = (await api(`/api/lab/trainings/${r.body.id}`)).body; return x.status === 'done' ? x : null; }, 120000, 'entreno');
    assert.ok(Array.isArray(st.sampleGames) && st.sampleGames.length === 1, `sampleGames ${JSON.stringify(st.sampleGames)}`);
    const got = (await api(`/api/lab/games/${st.sampleGames[0]}`)).body;
    if (got.events.some((e) => e.type === 'decision' && e.actor.netId === netId)) g = got;
  }
  assert.ok(g, 'premisa: en alguna semilla de 11 a 30 la red decide en su partida de muestra');
  sampleGame = st.sampleGames[0];
  assert.equal(g.meta.kind, 'training'); assert.equal(g.meta.trainingId, r.body.id); assert.ok(g.meta.nets.includes(netId));
  assert.ok(g.trajectories && Object.keys(g.trajectories).length >= 1, 'trayectorias guardadas');
  const types = new Set(g.events.map((e) => e.type));
  assert.ok(types.has('reward') && types.has('emotion') && types.has('decision') && types.has('shot'), [...types].join(','));
  const ids = g.events.map((e) => e.id);
  assert.ok(ids.every((id, i) => id === i + 1), 'ids consecutivos');
  const rw = g.events.find((e) => e.type === 'reward');
  assert.ok(rw.data.decisionEventId && rw.data.terms && typeof rw.data.effective === 'number' && typeof rw.data.tau === 'number');
  const em = g.events.find((e) => e.type === 'emotion');
  assert.ok(typeof em.data.hope === 'number' && typeof em.data.surprise === 'number' && em.data.decisionEventId);
  decisionEv = g.events.find((e) => e.type === 'decision' && e.actor.netId === netId && !e.data.truncated);
  playerId = decisionEv.actor.playerId;
  assert.ok(decisionEv.data.candidates && decisionEv.data.confidence && typeof decisionEv.data.confidence.confidence === 'number' && !('points' in decisionEv.data.candidates[0]), 'decisión completa sin puntos (turbo)');
  const log = (await api('/api/lab/log?limit=50')).body;
  assert.ok(log.entries.some((e) => e.type === 'update' && e.netId === netId) && log.entries.some((e) => e.type === 'lesson' && e.netId === netId), 'update y lesson en el registro');
  assert.ok(log.entries.every((e) => Number.isInteger(e.id)));
});

// desde M2 la partida de muestra guarda la red tal como jugó: la moviola es exacta (approx:false); el caso approx:true
// (partida antigua sin copia) lo comprueba test/moviola-antigua.spec.mjs (cambio autorizado 2026-09-23)
await check('moviola: GET /games/:id/turns/:n/brain recalcula la decisión del turno (approx:false con la copia de la red, M2); 404 si no hay decisión', async () => {
  const r = await api(`/api/lab/games/${sampleGame}/turns/${decisionEv.turn}/brain?player=${playerId}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.approx, false);
  assert.equal(r.body.decision.eventId ?? r.body.decision.id, decisionEv.id);
  assert.ok(r.body.activations && Object.keys(r.body.activations).length >= 1 && 'attention' in r.body);
  assert.equal((await api(`/api/lab/games/${sampleGame}/turns/999/brain?player=${playerId}`)).status, 404);
  assert.equal((await api(`/api/lab/games/no-existe/turns/0/brain`)).status, 404);
});

await check('boletín: POST → 202 trabajo exam; GET devuelve el último; evento exam en SSE y en el diario; 409 si entrena', async () => {
  assert.equal((await api(`/api/lab/nets/${netId}/bulletin`)).status, 404, 'aún no hay boletín');
  const r = await api(`/api/lab/nets/${netId}/bulletin`, 'POST', {});
  assert.equal(r.status, 202, r.text);
  const job = await until(async () => { const x = (await api(`/api/lab/jobs/${r.body.jobId}`)).body; return ['done', 'error'].includes(x.status) ? x : null; }, 180000, 'examen');
  assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300)); assert.equal(job.kind, 'exam');
  for (const k of ['aim', 'cover', 'survival', 'adaptation']) assert.ok(typeof job.result[k] === 'number' && job.result[k] >= 0 && job.result[k] <= 1, k);
  const got = (await api(`/api/lab/nets/${netId}/bulletin`)).body;
  assert.deepEqual({ aim: got.aim, cover: got.cover, survival: got.survival, adaptation: got.adaptation }, { aim: job.result.aim, cover: job.result.cover, survival: job.result.survival, adaptation: job.result.adaptation });
  await sleep(100);
  assert.ok(sse.events.some((e) => e.event === 'exam' && e.data.netId === netId && typeof e.data.aim === 'number'), 'SSE exam');
  const t = await api('/api/lab/trainings', 'POST', { netId, opponents: { antagonist: 1, hallOfFame: 0, self: 0, antagonistId: rivalId }, speed: 'turbo', workers: 1, duration: { games: 40 }, soldiers: 1, seed: 12 });
  assert.equal((await api(`/api/lab/nets/${netId}/bulletin`, 'POST', {})).status, 409);
  await api(`/api/lab/trainings/${t.body.id}/stop`, 'POST');
  await until(async () => { const x = (await api(`/api/lab/trainings/${t.body.id}`)).body; return ['stopped', 'done'].includes(x.status) ? x : null; }, 60000, 'parar');
});

await check('diario y cronista: frases con refs al registro que pasan checkPhrase contra GET /api/lab/log', async () => {
  const d = (await api(`/api/lab/nets/${netId}/diary`)).body;
  assert.ok(Array.isArray(d.entries) && d.entries.length >= 2, `entradas ${d.entries && d.entries.length}`);
  const kinds = new Set(d.entries.map((e) => e.kind));
  assert.ok(kinds.has('lesson') && kinds.has('exam'), [...kinds].join(','));
  assert.ok(d.entries.every((e, i) => i === 0 || d.entries[i - 1].t >= e.t), 'más reciente primero');
  const load = async (ref) => (ref.log ? [(await api(`/api/lab/log/${ref.log}`)).body].filter((x) => x && x.id) : []);
  for (const e of d.entries.slice(0, 6)) {
    assert.ok(typeof e.text === 'string' && e.refs.length >= 1 && e.refs.every((r) => Number.isInteger(r.log)), JSON.stringify(e).slice(0, 200));
    const events = (await Promise.all(e.refs.map(load))).flat();
    const r = T.checkPhrase(e, () => events);
    assert.ok(r.ok, `${e.text} → ${JSON.stringify(r.missing)}`);
  }
  // cambio (sesión 5, 2026-09-24, OK del usuario): si ya hay reina (en la batería la deja api-trono), el reto lanza un duelo
  // que tiene ocupada a esta red; se espera a que acabe para que la bofetada de después la encuentre libre
  const ch = await api('/api/lab/throne/challenge', 'POST', { challenger: netId });
  if (ch.status === 202 && ch.body && ch.body.duelId) await until(async () => ['done', 'stopped', 'error'].includes((await api(`/api/lab/duels/${ch.body.duelId}`)).body.status), 120000, 'duelo del reto');
  const c = (await api('/api/lab/chronicle')).body;
  assert.ok(c.entries.some((e) => e.kind === 'reign.start' && /trono/.test(e.text) && e.refs.length), JSON.stringify(c.entries.slice(0, 2)));
});

await check('neuronas: GET calcula nombres desde las partidas guardadas; PUT renombra y se guarda en el genoma', async () => {
  const r = await api(`/api/lab/nets/${netId}/neurons`);
  assert.equal(r.status, 200, r.text);
  const blocks = r.body.blocks;
  assert.ok(blocks && blocks.cd && blocks.cd.length === 32 && blocks.dv && blocks.dv.length === 16, JSON.stringify(Object.keys(blocks || {})));
  for (const u of blocks.cd) assert.ok(Number.isInteger(u.index) && typeof u.name === 'string' && typeof u.corr === 'number' && typeof u.m === 'number');
  assert.equal(r.body.m, blocks.cd[0].m);
  const put = await api(`/api/lab/nets/${netId}/neurons/cd/3`, 'PUT', { name: 'la cazadora' });
  assert.equal(put.status, 200, put.text);
  const again = (await api(`/api/lab/nets/${netId}/neurons`)).body;
  assert.equal(again.blocks.cd[3].name, 'la cazadora'); assert.equal(again.blocks.cd[3].custom, true);
  const g = (await api(`/api/lab/nets/${netId}`)).body.genome;
  assert.equal(g.names.neurons.cd[3], 'la cazadora');
  assert.equal((await api(`/api/lab/nets/${netId}/neurons/nadie/0`, 'PUT', { name: 'x' })).status, 404);
  assert.equal((await api(`/api/lab/nets/${netId}/neurons/cd/99`, 'PUT', { name: 'x' })).status, 404);
  assert.equal((await api(`/api/lab/nets/${netId}/neurons/cd/3`, 'PUT', { name: '' })).status, 400);
});

await check('bofetada y caricia: evento en la partida y en el registro, recompensa devuelta con signo, feedback aplicado al momento; 404 partida/decisión', async () => {
  const slap = await api(`/api/lab/nets/${netId}/slap`, 'POST', { game: sampleGame, decisionEventId: decisionEv.id, amount: 1 });
  assert.equal(slap.status, 200, slap.text); assert.equal(slap.body.ok, true); assert.ok(slap.body.reward < 0);
  const caress = await api(`/api/lab/nets/${netId}/caress`, 'POST', { game: sampleGame, decisionEventId: decisionEv.id });
  assert.equal(caress.status, 200); assert.ok(caress.body.reward > 0 && caress.body.reward === -slap.body.reward);
  const g = (await api(`/api/lab/games/${sampleGame}`)).body;
  const evs = g.events.filter((e) => e.type === 'slap' || e.type === 'caress');
  assert.equal(evs.length, 2);
  assert.deepEqual(evs.map((e) => e.data.term), ['slapCaress', 'slapCaress']); assert.ok(evs.every((e) => e.data.decisionEventId === decisionEv.id && e.data.amount === 1 && e.actor.playerId === 'usuario'));
  const fb = (await api(`/api/lab/nets/${netId}/feedback`)).body;
  assert.ok(fb.pending.length === 0 && fb.applied.length === 2 && fb.applied.every((f) => f.game === sampleGame)); // efecto inmediato (spec/04 §10.4)
  assert.equal((await api(`/api/lab/nets/${netId}/slap`, 'POST', { game: 'no-existe', decisionEventId: 1 })).status, 404);
  assert.equal((await api(`/api/lab/nets/${netId}/slap`, 'POST', { game: sampleGame, decisionEventId: 999999 })).status, 404);
  const log = (await api('/api/lab/log?limit=20')).body;
  assert.ok(log.entries.some((e) => e.type === 'slap' && e.netId === netId));
});

sse.close();
if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\napi-verdad OK');
