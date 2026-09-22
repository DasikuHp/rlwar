// API de trono y duelos, F6 (spec/06 §1–§6; spec/08 §5–§6): duelos como trabajo con SSE (turbo y x10 con salas),
// trono (retar, sentar, sala de la fama), genealogía, dinastías (fundar, generación, reto al trono),
// entreno explotador. Escrito ANTES del código y congelado. Uso: node test/api-trono.spec.mjs http://localhost:8791
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
const mk = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };

const sse = listen(); await sse.ready;
let A, B;
await check('preparación: hello lleva throne (sin reina); redes desde plantilla', async () => {
  await sleep(150);
  const hello = sse.events.find((e) => e.event === 'hello');
  assert.ok(hello && hello.data.throne && hello.data.throne.queen === null, JSON.stringify(hello && hello.data.throne));
  A = await mk('sniper', 'Alfa'); B = await mk('turtle', 'Beta');
  assert.equal((await api('/api/lab/throne')).body.queen, null);
});

await check('POST /duels: validaciones (404, a === b, learning/speed/soldiers malos) y duelo turbo completo con 6 partidas, SSE duel y partidas guardadas', async () => {
  assert.equal((await api('/api/lab/duels', 'POST', { a: A, b: 'nadie' })).status, 404);
  assert.equal((await api('/api/lab/duels', 'POST', { a: A, b: A })).status, 400);
  assert.equal((await api('/api/lab/duels', 'POST', { a: A, b: B, learning: 'lento' })).status, 400);
  assert.equal((await api('/api/lab/duels', 'POST', { a: A, b: B, speed: 'x100' })).status, 400);
  assert.equal((await api('/api/lab/duels', 'POST', { a: A, b: B, soldiers: 7 })).status, 400);
  const r = await api('/api/lab/duels', 'POST', { a: A, b: B, learning: 'frozen', speed: 'turbo', soldiers: 1, seed: 4242 });
  assert.equal(r.status, 202, r.text); assert.ok(r.body.id && r.body.status);
  const d = await until(async () => { const x = (await api(`/api/lab/duels/${r.body.id}`)).body; return x.status === 'done' ? x : null; }, 120000, 'duelo turbo');
  assert.equal(d.a, A); assert.equal(d.b, B); assert.equal(d.learning, 'frozen'); assert.equal(d.games.length, 6);
  d.games.forEach((g, k) => {
    assert.equal(g.k, k); assert.equal(g.soldiers, 1); assert.ok(Number.isInteger(g.seed));
    assert.equal(g.left, k % 2 === 0 ? A : B); assert.equal(g.right, k % 2 === 0 ? B : A);
    assert.ok(g.winner === A || g.winner === B || g.winner === null); assert.ok(typeof g.kills[A] === 'number' && typeof g.kills[B] === 'number');
    assert.ok(typeof g.gameId === 'string' && g.roomCode === null);
  });
  assert.ok(d.games[0].seed === d.games[1].seed && d.games[2].seed === d.games[3].seed && d.games[4].seed === d.games[5].seed);
  assert.equal(d.wins[A] + d.wins[B], d.games.filter((g) => g.winner).length);
  assert.ok(d.winner === A || d.winner === B || (d.winner === null && d.tie === true));
  assert.ok(typeof d.ms === 'number' && d.tie !== undefined && d.throne === false);
  const list = (await api('/api/lab/duels')).body;
  assert.ok(list.duels.some((x) => x.id === r.body.id && x.status === 'done'));
  await sleep(100);
  const ev = sse.events.filter((e) => e.event === 'duel' && e.data.id === r.body.id);
  assert.ok(ev.filter((e) => e.data.game).length === 6 && ev.some((e) => e.data.result && e.data.result.status === 'done'), `eventos duel ${ev.length}`);
  const game = await api(`/api/lab/games/${d.games[0].gameId}`);
  assert.equal(game.status, 200, 'la partida se guardó (moviola)'); assert.ok(game.body.meta && game.body.meta.duelId === r.body.id && Array.isArray(game.body.events) && game.body.events[0].type === 'game.start');
  assert.equal((await api('/api/lab/duels/no-existe')).status, 404);
});

await check('POST /duels x10: salas vivas encadenadas (roomCodes) con speed 10; stop deja el duelo parado', async () => {
  const r = await api('/api/lab/duels', 'POST', { a: A, b: B, learning: 'hot', speed: 'x10', soldiers: 1, seed: 7 });
  assert.equal(r.status, 202, r.text); assert.ok(Array.isArray(r.body.roomCodes));
  const first = await until(async () => { const x = (await api(`/api/lab/duels/${r.body.id}`)).body; return x.roomCodes.length >= 1 ? x : null; }, 30000, 'primera sala');
  const room = (await api(`/api/rooms/${first.roomCodes[0]}/state`)).body;
  assert.equal(room.config.speed, 10, 'sala x10');
  const s = await api(`/api/lab/duels/${r.body.id}/stop`, 'POST');
  assert.equal(s.status, 200);
  const d = await until(async () => { const x = (await api(`/api/lab/duels/${r.body.id}`)).body; return ['stopped', 'done'].includes(x.status) ? x : null; }, 60000, 'parar');
  assert.ok(d.status === 'stopped' || d.status === 'done'); assert.ok(d.roomCodes.length >= 1 && d.games.length <= 6);
});

await check('trono: sin reina el reto sienta (200, reign.start); reto con reina → 202 y duelo con throne:true; auto-reto 400; hall-of-fame y throne coherentes', async () => {
  assert.equal((await api('/api/lab/throne/challenge', 'POST', { challenger: 'nadie' })).status, 404);
  const seat = await api('/api/lab/throne/challenge', 'POST', { challenger: A });
  assert.equal(seat.status, 200, seat.text); assert.equal(seat.body.queen, A); assert.equal(seat.body.result, 'seated');
  const th = (await api('/api/lab/throne')).body;
  assert.equal(th.queen, A); assert.equal(th.queenName, 'Alfa'); assert.equal(th.reigns.length, 1);
  assert.equal((await api('/api/lab/throne/challenge', 'POST', { challenger: A })).status, 400);
  const nets = (await api('/api/lab/nets')).body.nets;
  assert.equal(nets.find((n) => n.id === A).isQueen, true); assert.equal(nets.find((n) => n.id === B).isQueen, false);
  const r = await api('/api/lab/throne/challenge', 'POST', { challenger: B, learning: 'frozen', speed: 'turbo', seed: 99 });
  assert.equal(r.status, 202, r.text); assert.ok(r.body.duelId); assert.equal(r.body.queen, A);
  const d = await until(async () => { const x = (await api(`/api/lab/duels/${r.body.duelId}`)).body; return x.status === 'done' ? x : null; }, 120000, 'duelo de trono');
  assert.equal(d.throne, true); assert.ok(d.winner === A || d.winner === B, 'con throne nunca queda sin ganador');
  const t2 = await until(async () => { const x = (await api('/api/lab/throne')).body; return x.challenges.length === 1 ? x : null; }, 10000, 'reto registrado');
  const ch = t2.challenges[0];
  assert.equal(ch.challenger, B); assert.equal(ch.queen, A); assert.equal(ch.duelId, r.body.duelId);
  if (d.winner === B) {
    assert.equal(ch.result, 'challenger'); assert.equal(t2.queen, B); assert.equal(t2.reigns.length, 2); assert.equal(t2.hallOfFame.length, 1); assert.equal(t2.hallOfFame[0].netId, A);
    const hof = (await api('/api/lab/hall-of-fame')).body;
    assert.equal(hof.hallOfFame.length, 1); assert.ok(hof.hallOfFame[0].sha && hof.hallOfFame[0].snapshot);
  } else {
    assert.ok(['queen', 'tie'].includes(ch.result)); assert.equal(t2.queen, A); assert.equal(t2.reigns[0].defenses, 1);
  }
  await sleep(100);
  const te = sse.events.filter((e) => e.event === 'throne');
  assert.ok(te.some((e) => e.data.event === 'reign.start' && e.data.queen === A) && te.some((e) => e.data.event === 'challenge'), `eventos throne: ${te.map((e) => e.data.event).join(', ')}`);
  assert.ok(t2.league.pairs[[A, B].sort().join('|')], 'la liga registra el par');
});

await check('entreno explotador: exploiter:true fija la mezcla contra la reina y queda en config; genealogía por API', async () => {
  const C = await mk('seer', 'Gamma');
  const r = await api('/api/lab/trainings', 'POST', { netId: C, exploiter: true, speed: 'turbo', duration: { games: 2 }, soldiers: 1, seed: 3 });
  assert.equal(r.status, 202, r.text);
  const st = await until(async () => { const x = (await api(`/api/lab/trainings/${r.body.id}`)).body; return x.status === 'done' ? x : null; }, 60000, 'entreno explotador');
  assert.equal(st.config.exploiter, true);
  assert.deepEqual({ antagonist: st.config.opponents.antagonist, hallOfFame: st.config.opponents.hallOfFame, self: st.config.opponents.self }, { antagonist: 1, hallOfFame: 0, self: 0 });
  assert.equal(st.config.opponents.antagonistId, (await api('/api/lab/throne')).body.queen);
  const g = (await api('/api/lab/genealogy')).body;
  assert.ok(g.nets && g.nets[A] && g.nets[B] && g.nets[C] && g.nets[C].edited === false && g.nets[C].orphan === false, JSON.stringify(Object.keys(g.nets || {})));
});

await check('dinastías: fundar, una generación como trabajo (SSE dynasty, jobs), history y generation; reto al trono desde una casa', async () => {
  const a = await mk('sniper', 'Casa Sol'), b = await mk('turtle', 'Casa Luna');
  assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Sol', netId: a }, B: { name: 'Luna', netId: a } })).status, 400);
  const f = await api('/api/lab/dynasties', 'POST', { A: { name: 'Sol', netId: a }, B: { name: 'Luna', netId: b } });
  assert.equal(f.status, 200, f.text);
  assert.deepEqual(f.body.A, { name: 'Sol', champion: a, generation: 0, founder: a, history: [] });
  const got = (await api('/api/lab/dynasties')).body;
  assert.equal(got.B.champion, b);
  const r = await api('/api/lab/dynasties/generation', 'POST', { training: { speed: 'turbo', duration: { games: 2 }, soldiers: 1 }, children: { n: 2, pretournament: { games: 1, soldiers: 1 } }, duel: { learning: 'frozen', speed: 'turbo', soldiers: 1 }, seed: 5 });
  assert.equal(r.status, 202, r.text);
  const job = await until(async () => { const x = (await api(`/api/lab/jobs/${r.body.jobId}`)).body; return ['done', 'error'].includes(x.status) ? x : null; }, 180000, 'generación');
  assert.equal(job.status, 'done', JSON.stringify(job).slice(0, 300)); assert.equal(job.kind, 'generation');
  assert.ok(job.result.duelId && job.result.A && job.result.B);
  const dyn = (await api('/api/lab/dynasties')).body;
  assert.equal(dyn.A.history.length, 1); assert.equal(dyn.B.history.length, 1);
  assert.ok(dyn.A.generation + dyn.B.generation <= 1);
  await sleep(100);
  const de = sse.events.filter((e) => e.event === 'dynasty');
  assert.ok(de.some((e) => e.data.event === 'train') && de.some((e) => e.data.event === 'children') && de.some((e) => e.data.event === 'generation'), `eventos dynasty: ${[...new Set(de.map((e) => e.data.event))].join(', ')}`);
  const c = await api('/api/lab/dynasties/A/challenge-throne', 'POST', { learning: 'frozen', speed: 'turbo', seed: 8 });
  assert.ok(c.status === 202 || c.status === 200, c.text);
  if (c.status === 202) await until(async () => { const x = (await api(`/api/lab/duels/${c.body.duelId}`)).body; return x.status === 'done' ? x : null; }, 120000, 'reto de la casa');
  assert.equal((await api('/api/lab/dynasties/C/challenge-throne', 'POST', {})).status, 404);
});

sse.close();
if (fails) { console.log(`\n${fails} fallo(s)`); process.exit(1); }
console.log('\napi-trono OK');
