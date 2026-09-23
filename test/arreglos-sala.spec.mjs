// Parte 3, sala y servidor (spec/revision-opus.md §3.3 M7, M10, B2, B4 y §9 R5): en x10 la animación de un disparo
// se divide UNA vez entre la velocidad; los eventos de la voz no cuentan para el tope de eventos; un cuerpo demasiado
// grande recibe 413 con el motivo; los soldados de un entreno (o del entreno de una generación) van de 1 a 4 o
// "random"; CORS permite PUT y DELETE. Escrito ANTES del código y congelado.
// Uso: node test/arreglos-sala.spec.mjs [http://localhost:8791]   (sin URL, solo las partes en proceso)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-sala-'));

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error(`tiempo agotado: ${what}`); };

const C = await import('../shared/constants.js');
const R = await import('../server/rooms.js');
const { Room } = R;

// ---------- M7: x10 dividido una sola vez (spec/04 §9.5) ----------
const x1 = (n) => Math.min(9000, Math.max(700, n * C.NETWORK_STEP / C.SHOT_SPEED * 1000));

await check('M7: animMsOf(puntos, velocidad) = mín(9000, máx(700, puntos·NETWORK_STEP/SHOT_SPEED·1000)) / velocidad; un tiro de 5 s en x1 dura 0,5 s en x10', () => {
  assert.equal(typeof R.animMsOf, 'function', 'server/rooms.js exporta animMsOf');
  for (const n of [1, 100, 1500, 5000, 20000, 100000]) {
    assert.equal(R.animMsOf(n, 1), x1(n), `x1, ${n} puntos`);
    assert.equal(R.animMsOf(n, 10), x1(n) / 10, `x10, ${n} puntos`);
  }
  const n5 = Math.round(5 * C.SHOT_SPEED / C.NETWORK_STEP);
  assert.ok(Math.abs(R.animMsOf(n5, 10) - 500) < 1, `5 s en x1 → ${R.animMsOf(n5, 10)} ms en x10`);
});

await check('M7: en una sala x10 viva, el fin de la animación de cada disparo es su momento + animMsOf(sus puntos, 10)', async () => {
  const room = new Room('x10', { soldiersPerPlayer: 3, seed: 11, speed: 10 });
  room.addAgent('greedy', { team: 'left' }); room.addAgent('greedy', { team: 'right' });
  const shots = [];
  room.listeners.add({ write: (s) => {
    const m = /^event: shot\ndata: (.*)$/m.exec(s);
    if (!m) return;
    const rec = { at: Date.now(), points: JSON.parse(m[1]).shot.points.length, animEnd: null };
    shots.push(rec);
    queueMicrotask(() => { rec.animEnd = room.animEnd; }); // animEnd se fija justo después de avisar
  } });
  room.start();
  await until(() => shots.length >= 2 && shots[1].animEnd !== null, 30000, 'dos disparos'); // 3 soldados por bando: la partida no acaba al primero
  room.gameOver(true);
  for (const s of shots.slice(0, 2)) {
    const want = R.animMsOf(s.points, 10);
    assert.ok(Math.abs(s.animEnd - s.at - want) <= 5, `animación de ${s.animEnd - s.at} ms, esperaba ${want}`);
  }
});

// ---------- R5: la voz fuera del tope (spec/07 §1) ----------
await check('R5: los eventos de la voz (say y "frase no verificable") no cuentan para el tope: con 300 de cada por medio, el tope llega con los mismos eventos de partida; y es por partida (la revancha empieza de cero)', () => {
  const capAt = (withVoice) => {
    const room = new Room('tope', { soldiersPerPlayer: 1, seed: 3 });
    room.addAgent('greedy', { team: 'left' }); room.addAgent('greedy', { team: 'right' });
    room.start();
    const [p] = room.players, s = room.soldiers.find((x) => x.ownerId === p.id);
    const st = room.events.find((e) => e.type === 'game.start');
    const good = { text: `${st.data.map.name.replace(/^[^\p{L}\d]+/u, '').trim()}.`, refs: [{ game: room.gameId, id: st.id }] };
    const bad = { text: 'Fallé por 9.99 exactos.', refs: [{ game: room.gameId, id: st.id }] };
    const actor = room.actorOf(s);
    let game = room.events.length, voice = 0;
    for (let i = 0; !room.eventsCapped; i++) {
      if (withVoice && i % 10 === 0 && voice < 600) { assert.equal(room.sayVerified(p, s, good, 'say', null), true); assert.equal(room.sayVerified(p, s, bad, 'say', null), false); voice += 2; }
      room.emit('graze', actor, { dist: 1 }); game++;
    }
    room.gameOver(true);
    const out = { game, voice, say: room.events.filter((e) => e.type === 'say').length };
    assert.equal(room.rematch().ok, true);
    out.afterRematch = room.eventsCapped; // la revancha es otra partida: su tope empieza de cero
    room.gameOver(true);
    return out;
  };
  const a = capAt(false), b = capAt(true);
  assert.deepEqual([b.voice, b.say], [600, 300], 'premisa: 300 frases dichas y 300 rechazadas');
  assert.equal(b.game, a.game, 'el tope llega con los mismos eventos de partida');
  assert.equal(a.game, C.LIMITS.eventsPerGame + 1, 'sin voz, salta al intentar el evento 5001');
  assert.deepEqual([a.afterRematch, b.afterRematch], [false, false], 'en la revancha las decisiones vuelven a ir completas');
});

// ---------- por la API ----------
if (BASE) {
  const api = async (p, method = 'GET', body = undefined) => {
    const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const raw = async (p, text) => { const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text }); const t = await res.text(); let json = null; try { json = JSON.parse(t); } catch { /* */ } return { status: res.status, body: json, text: t }; };
  const mkNet = async (template, name) => { const r = await api('/api/lab/nets', 'POST', { template, name }); assert.equal(r.status, 201, r.text); return r.body.id; };

  await check('M10: más de 48 MB en /api/lab → 413 con el motivo en JSON y el servidor sigue; más de 100 kB en una ruta de sala → 413', async () => {
    const big = await raw('/api/lab/nets/import', 'x'.repeat(C.LIMITS.genomeBytes + 1024 * 1024));
    assert.equal(big.status, 413, big.text.slice(0, 200)); assert.match(big.body.error, /supera/);
    assert.equal((await api('/api/health')).status, 200);
    const room = (await api('/api/rooms', 'POST', { name: 'grande' })).body;
    const chat = await raw(`/api/rooms/${room.code}/chat`, JSON.stringify({ playerId: 'p1', text: 'y'.repeat(200000) }));
    assert.equal(chat.status, 413, chat.text.slice(0, 200)); assert.match(chat.body.error, /supera/);
    const rooms = await raw('/api/rooms', JSON.stringify({ name: 'z'.repeat(150000) }));
    assert.equal(rooms.status, 413, rooms.text.slice(0, 200)); assert.match(rooms.body.error, /supera/);
    assert.equal((await api('/api/health')).status, 200);
  });

  await check('B2: soldiers de un entreno fuera de 1–4 (y no "random") → 400; 1, 4 y "random" valen; en el entreno de una generación, igual', async () => {
    const id = await mkNet('seer', 'Soldados B2');
    for (const soldiers of [9, 0, -1, 2.5, 'dos']) {
      const r = await api('/api/lab/trainings', 'POST', { netId: id, soldiers, duration: { games: 1 } });
      assert.equal(r.status, 400, `${JSON.stringify(soldiers)}: ${r.text}`); assert.match(r.body.error, /soldiers/);
    }
    for (const soldiers of [1, 4, 'random']) {
      const r = await api('/api/lab/trainings', 'POST', { netId: id, soldiers, speed: 'turbo', duration: { games: 1 } });
      assert.equal(r.status, 202, `${JSON.stringify(soldiers)}: ${r.text}`);
      await until(async () => { const t = (await api(`/api/lab/trainings/${r.body.id}`)).body; return t && !['queued', 'running', 'paused'].includes(t.status) ? t : null; }, 60000, 'entreno acabado');
    }
    const a = await mkNet('seer', 'Casa B2 A'), b = await mkNet('sniper', 'Casa B2 B');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Norte', netId: a }, B: { name: 'Sur', netId: b } })).status, 200);
    const g = await api('/api/lab/dynasties/generation', 'POST', { training: { soldiers: 9 } });
    assert.equal(g.status, 400, g.text); assert.match(g.body.error, /soldiers/);
  });

  await check('B4: CORS permite GET, POST, PUT, DELETE y OPTIONS', async () => {
    const r = await fetch(BASE + '/api/lab/nets', { method: 'OPTIONS' });
    const allow = (r.headers.get('access-control-allow-methods') || '').split(',').map((s) => s.trim());
    for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) assert.ok(allow.includes(m), `${m} en ${allow.join(',')}`);
    const g = await fetch(BASE + '/api/health');
    assert.ok((g.headers.get('access-control-allow-methods') || '').includes('DELETE'), 'también en las respuestas normales');
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: sala y servidor)');
process.exitCode = fails ? 1 : 0;
