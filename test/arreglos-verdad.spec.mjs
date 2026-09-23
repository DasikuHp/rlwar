// Parte 3, la verdad y el registro (spec/revision-opus.md §3.3 M1, M3, M4, M5, M6, M8): la certeza es lo decidida que
// estaba la red (favorita frente a segunda), la moviola de un turno es la de quien disparó, el diario incluye los retos,
// el registro guarda los nombres y el cronista habla en español (sin "ascenso" si no lo hubo), las neuronas de memoria
// se nombran con el estado real de cada partida y el duelo en curso dice su sala en vivo. Escrito ANTES del código y
// congelado. Uso: node test/arreglos-verdad.spec.mjs [http://localhost:8791]   (sin URL, solo las partes en proceso)
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-verdad-p3-'));

const BASE = process.argv[2] || null;
let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

const { TEMPLATES } = await import('../shared/templates.js');
const { compile } = await import('../shared/nn.js');
const { playGame } = await import('../server/headless.js');
const truth = await import('../evo/truth.js');
const store = await import('../evo/store.js');
const TH = await import('../evo/throne.js');
await import('../evo/train.js');

const logOf = () => { const f = join(process.env.GW_EVO_DIR, 'log.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const save = (key, id, name, patch = {}) => { const r = store.saveNet({ ...clone(TEMPLATES[key].genome), id, name, ...patch }); assert.ok(r.ok, JSON.stringify(r)); };

// ---------- M1: certeza = p(favorita) − p(segunda) (spec/07 §4) ----------
await check('M1: certaintyOf(candidatos) = p(favorita) − p(segunda); con uno, 1; sin ninguno, 0', () => {
  assert.equal(typeof truth.certaintyOf, 'function');
  assert.ok(near(truth.certaintyOf([{ p: 0.1 }, { p: 0.45 }, { p: 0.3 }, { p: 0.15 }]), 0.15));
  assert.equal(truth.certaintyOf([{ p: 0.7 }]), 1);
  assert.equal(truth.certaintyOf([]), 0);
  assert.equal(truth.certaintyOf(null), 0);
});

await check('M1: en cada disparo de una red, la confianza usa esa certeza aunque el muestreo no coja a la favorita; el margin del registro sigue siendo el del elegido (negativo si exploró)', () => {
  save('seer', 'm1-net', 'Exploradora', { traits: { ...TEMPLATES.seer.genome.traits, temperature: 3 }, stats: { games: 300, wins: 0, kills: 0, deaths: 0, reigns: 0 } });
  let explored = 0;
  for (const seed of [1, 2, 3, 4]) {
    const r = playGame({ seed, left: { type: 'net', netId: 'm1-net' }, right: { type: 'greedy', level: 1 }, soldiers: 2 });
    for (const e of r.events.filter((x) => x.type === 'decision' && x.data.phase === 'shoot' && x.actor.netId === 'm1-net' && !x.data.truncated)) {
      const ps = e.data.candidates.map((c) => c.p);
      const sorted = [...ps].sort((a, b) => b - a);
      const others = ps.filter((_, i) => i !== e.data.chosen);
      assert.ok(near(e.data.margin, ps[e.data.chosen] - Math.max(...others)), 'margin del elegido');
      assert.ok(near(e.data.confidence.certainty, sorted[0] - sorted[1]), `certeza ${e.data.confidence.certainty} ≠ ${sorted[0] - sorted[1]}`);
      const want = truth.confidenceOf({ margin: sorted[0] - sorted[1], games: 300, recentShots: [] });
      assert.equal(e.data.confidence.level, want.level);
      if (e.data.margin < 0) explored++;
    }
  }
  assert.ok(explored > 0, 'premisa: en alguna decisión el muestreo no cogió a la favorita');
});

// ---------- M5: nombres en el registro y cronista en español (spec/07 §9) ----------
const ph = (e) => truth.diaryPhrase({ id: 7, ts: 1, ...e });
const verifies = (e) => { const p = ph(e); return truth.checkPhrase(p, (ref) => (ref.log === 7 ? [{ id: 7, ts: 1, ...e }] : [])).ok; };
await check('M5: diaryPhrase usa los nombres guardados (y los ids si la entrada es antigua); los retos anulados no son defensas; frases de dinastía en español y verificables', () => {
  const rows = [
    [{ type: 'challenge', challenger: 'ana', queen: 'bea', challengerName: 'Ana Uno', queenName: 'Bea Dos', result: 'challenger' }, 'Reto de Ana Uno a Bea Dos: ganó la retadora'],
    [{ type: 'challenge', challenger: 'ana', queen: 'bea', challengerName: 'Ana Uno', queenName: 'Bea Dos', result: 'queen' }, 'Reto de Ana Uno a Bea Dos: la reina defendió el trono'],
    [{ type: 'challenge', challenger: 'ana', queen: 'bea', challengerName: 'Ana Uno', queenName: 'Bea Dos', result: 'void', error: 'el duelo no jugó ninguna partida' }, 'Reto de Ana Uno a Bea Dos: reto anulado'],
    [{ type: 'challenge', challenger: 'ana', queen: 'bea', result: 'tie' }, 'Reto de ana a bea: empate, la reina conserva el trono'],
    [{ type: 'reign.start', netId: 'bea', queen: 'bea', name: 'Bea Dos' }, 'Bea Dos se sienta en el trono'],
    [{ type: 'reign.end', netId: 'bea', name: 'Bea Dos' }, 'Bea Dos pierde el trono'],
    [{ type: 'reign.end', netId: 'bea', name: 'Bea Dos', reason: 'deleted' }, 'Bea Dos deja el trono: la borraron'],
    [{ type: 'reign.end', netId: 'bea', name: 'Bea Dos', reason: 'missing' }, 'Bea Dos deja el trono: ya no existe'],
    [{ type: 'dynasty', house: 'B', houseName: 'Casa Sur', event: 'promote', child: 'cri', childName: 'Cría Tres', mother: 'mad', motherName: 'Madre Cuatro', promoted: true }, 'Casa Sur: Cría Tres sucede a Madre Cuatro'],
    [{ type: 'dynasty', house: 'B', houseName: 'Casa Sur', event: 'promote', child: 'cri', childName: 'Cría Tres', mother: 'mad', motherName: 'Madre Cuatro', promoted: false }, 'Casa Sur: Madre Cuatro sigue de campeona, Cría Tres no la supera'],
    [{ type: 'dynasty', house: 'A', houseName: 'Casa Norte', event: 'train', netId: 'equ', name: 'Equis', against: 'yee', againstName: 'Ye Griega' }, 'Casa Norte: Equis entrena contra Ye Griega'],
    [{ type: 'dynasty', house: 'A', houseName: 'Casa Norte', event: 'children', parentId: 'equ', motherName: 'Equis' }, 'Casa Norte: Equis tiene hijos'],
    [{ type: 'dynasty', house: 'A', houseName: 'Casa Norte', event: 'duel', a: 'equ', b: 'yee', aName: 'Equis', bName: 'Ye Griega', winner: 'equ', winnerName: 'Equis', tie: false }, 'Duelo de campeonas: gana Equis'],
    [{ type: 'dynasty', house: 'A', houseName: 'Casa Norte', event: 'duel', a: 'equ', b: 'yee', aName: 'Equis', bName: 'Ye Griega', winner: null, tie: true }, 'Duelo de campeonas: empate'],
    [{ type: 'dynasty', house: 'A', houseName: 'Casa Norte', event: 'champion.deleted', netId: 'equ', name: 'Equis' }, 'Casa Norte: se borró a su campeona Equis'],
    [{ type: 'dynasty', house: 'A', event: 'rara' }, 'Casa A: rara'],
  ];
  for (const [e, text] of rows) {
    assert.equal(ph(e).text, text, JSON.stringify(e));
    assert.ok(verifies(e), `verifica: ${text}`);
  }
});

await check('M5: el trono guarda los nombres en el registro (reto, fin y comienzo de reinado, reina borrada)', async () => {
  TH.writeThrone(TH.emptyThrone());
  save('seer', 'm5-q', 'Reina Cinco'); save('sniper', 'm5-c', 'Retadora Cinco');
  const log0 = logOf().length;
  await TH.challenge({ challenger: 'm5-q' }, { now: () => 1000 });
  const fake = async (o) => ({ id: 'd-m5', a: o.a, b: o.b, status: 'done', games: [{ winner: o.a }], wins: { [o.a]: 4, [o.b]: 2 }, killDiff: 0, winner: o.a, tie: false, throne: true, ms: 1 });
  await TH.challenge({ challenger: 'm5-c' }, { runDuel: fake, now: () => 2000 });
  TH.vacateNet('m5-c', { name: 'Retadora Cinco' });
  const got = logOf().slice(log0).map((e) => [e.type, e.name ?? null, e.challengerName ?? null, e.queenName ?? null, e.reason ?? null]);
  assert.deepEqual(got, [
    ['reign.start', 'Reina Cinco', null, null, null],
    ['challenge', null, 'Retadora Cinco', 'Reina Cinco', null],
    ['reign.end', 'Reina Cinco', null, null, null],
    ['reign.start', 'Retadora Cinco', null, null, null],
    ['reign.end', 'Retadora Cinco', null, null, 'deleted'],
  ]);
});

// ---------- M6: neuronas de memoria con el estado real (spec/07 §10) ----------
await check('M6: activationsOf recorre cada episodio en orden llevando el estado (se reinicia al cambiar de episodio o si no lo hay) y devuelve las activaciones de las muestras que se usan', () => {
  assert.equal(typeof truth.activationsOf, 'function');
  save('turtle', 'm6-net', 'Tortuga Seis');
  const g = store.loadNet('m6-net'), net = compile(g);
  const r = playGame({ seed: 9, left: { type: 'net', netId: 'm6-net', learn: true }, right: { type: 'greedy', level: 1 }, soldiers: 2 });
  const tr = Object.values(r.trajectories)[0];
  const eps = Object.entries(tr.soldiers).filter(([, steps]) => steps.length >= 3);
  assert.ok(eps.length >= 1, 'premisa: un soldado con al menos 3 pasos');
  const samples = [];
  for (const [sid, steps] of eps) for (const s of steps) samples.push({ obs: s.obs, ep: sid, use: s.phase === 'shoot' });
  samples.push({ obs: eps[0][1][0].obs }); // sin episodio: estado cero
  const want = [], later = []; // later: muestras usadas que no son la primera de su episodio
  let st = null, cur = undefined;
  for (const s of samples) {
    const first = s.ep === undefined || s.ep !== cur;
    if (first) { st = net.zeroState(); cur = s.ep; }
    const o = net.forward(s.obs, st); st = o.state;
    if (s.use !== false) { if (!first) later.push({ k: want.length, obs: s.obs }); want.push(o.activations); }
  }
  const got = truth.activationsOf(net, samples);
  assert.equal(got.length, want.length);
  const flat = (a) => JSON.stringify(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => Array.from(x)) : Array.from(v)])));
  for (let i = 0; i < want.length; i++) assert.equal(flat(got[i]), flat(want[i]), `muestra ${i}`);
  assert.ok(later.length, 'premisa: una muestra usada con pasos antes en su episodio');
  const zero = net.forward(later[0].obs, net.zeroState()).activations.g;
  assert.notEqual(JSON.stringify(Array.from(zero)), JSON.stringify(Array.from(want[later[0].k].g)), 'premisa: la memoria cambia con el estado');
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

  await check('M3: sin ?player=, la moviola de un turno es la de quien disparó en él (su decisión de disparo), aunque otra red decidiera moverse en ese turno', async () => {
    const a = await mkNet('seer', 'Moviola A'), b = await mkNet('sniper', 'Moviola B');
    const room = (await api('/api/rooms', 'POST', { name: 'moviola', soldiers: 2, seed: 5 })).body;
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId: a, learn: true, team: 'left' });
    await api(`/api/rooms/${room.code}/addagent`, 'POST', { type: 'net', netId: b, learn: true, team: 'right' });
    await api(`/api/rooms/${room.code}/start`, 'POST', {});
    const st = await until(async () => { const x = (await api(`/api/rooms/${room.code}/state`)).body; return x.phase === 'over' ? x : null; }, 120000, 'fin de la exhibición');
    const gid = `g-${st.config.seed}-${room.code}`;
    const game = await until(async () => { const g = await api(`/api/lab/games/${gid}`); return g.status === 200 ? g.body : null; }, 20000, 'partida guardada');
    const decs = game.events.filter((e) => e.type === 'decision' && !e.data.truncated);
    const turns = [...new Set(decs.filter((e) => e.data.phase === 'shoot').map((e) => e.turn))].filter((t) => decs.some((e) => e.turn === t && e.data.phase === 'move'));
    assert.ok(turns.length, 'premisa: hay un turno con decisión de disparo y de moverse');
    for (const t of turns) {
      const r = await api(`/api/lab/games/${gid}/turns/${t}/brain`);
      assert.equal(r.status, 200, r.text);
      const shoot = decs.find((e) => e.turn === t && e.data.phase === 'shoot');
      assert.deepEqual([r.body.decision.phase, r.body.decision.eventId], ['shoot', shoot.id], `turno ${t}`);
    }
  });

  await check('M4 y M5: el diario de la retadora y el de la reina incluyen el reto con sus nombres', async () => {
    const q = (await api('/api/lab/throne')).body.queen || null;
    const c = await mkNet('seer', 'Retadora Diario');
    if (!q) await api('/api/lab/throne/challenge', 'POST', { challenger: await mkNet('sniper', 'Reina Diario') });
    const queen = (await api('/api/lab/throne')).body.queen;
    const qName = (await api(`/api/lab/nets/${queen}`)).body.genome.name;
    const r = await api('/api/lab/throne/challenge', 'POST', { challenger: c, speed: 'turbo', learning: 'frozen', seed: 3 });
    assert.ok([200, 202].includes(r.status), r.text);
    if (r.body.duelId) await duelDone(r.body.duelId); // el reto es asíncrono: se registra al acabar el duelo
    for (const id of [c, queen]) {
      const d = await until(async () => { const e = (await api(`/api/lab/nets/${id}/diary`)).body.entries; return e.some((x) => x.text.startsWith('Reto de Retadora Diario')) ? e : null; }, 20000, `reto en el diario de ${id}`).catch(async () => (await api(`/api/lab/nets/${id}/diary`)).body.entries);
      assert.ok(d.some((e) => e.text.startsWith(`Reto de Retadora Diario a ${qName}: `)), `diario de ${id}: ${d.map((e) => e.text).join(' | ')}`);
    }
  });

  await check('M5: tras una generación, el cronista cuenta la dinastía en español y con nombres (sin códigos como "promote")', async () => {
    const a = await mkNet('sniper', 'Norte Cronista'), b = await mkNet('turtle', 'Sur Cronista');
    assert.equal((await api('/api/lab/dynasties', 'POST', { A: { name: 'Casa Norte', netId: a }, B: { name: 'Casa Sur', netId: b } })).status, 200);
    const g = await api('/api/lab/dynasties/generation', 'POST', { training: { speed: 'turbo', duration: { games: 2 }, soldiers: 1 }, children: { n: 2, pretournament: { games: 1, soldiers: 1 } }, duel: { learning: 'frozen', speed: 'turbo', soldiers: 1 }, seed: 4 });
    assert.equal(g.status, 202, g.text);
    await until(async () => { const j = (await api(`/api/lab/jobs/${g.body.jobId}`)).body; return j && j.status !== 'running' ? j : null; }, 300000, 'generación');
    const texts = (await api('/api/lab/chronicle')).body.entries.map((e) => e.text);
    const mine = texts.filter((t) => /^Casa (Norte|Sur): /.test(t));
    assert.ok(mine.length >= 4, `frases de las casas: ${mine.join(' | ')}`);
    assert.ok(!texts.some((t) => /: (promote|train|children|duel|champion\.deleted)$/.test(t)), texts.join(' | '));
    assert.ok(mine.some((t) => / (sucede a|sigue de campeona)/.test(t)), 'dice si hubo relevo o no');
  });

  await check('M6: GET /neurons nombra con las partidas guardadas recorridas en orden por soldado (todas sus decisiones), usando las de disparo', async () => {
    const t = await mkNet('turtle', 'Tortuga Neuronas'), o = await mkNet('sniper', 'Rival Neuronas');
    for (const seed of [11, 12, 13]) { const d = await api('/api/lab/duels', 'POST', { a: t, b: o, learning: 'frozen', speed: 'turbo', soldiers: 4, seed }); assert.equal(d.status, 202, d.text); await duelDone(d.body.id); }
    const genome = (await api(`/api/lab/nets/${t}`)).body.genome;
    const metas = (await api(`/api/lab/games?netId=${t}&limit=500`)).body.games; // de la más reciente a la más antigua
    const samples = []; let used = 0;
    outer: for (const m of metas) {
      const g = (await api(`/api/lab/games/${m.gameId}`)).body;
      for (const [pid, tr] of Object.entries(g.trajectories || {})) {
        if (!tr || tr.netId !== t) continue;
        for (const [sid, steps] of Object.entries(tr.soldiers || {})) {
          const list = steps.filter((s) => s && s.obs);
          const n = list.filter((s) => s.phase === 'shoot').length;
          if (!n) continue;
          for (const s of list) samples.push({ obs: s.obs, decision: s.decision, ep: `${m.gameId}|${pid}|${sid}`, use: s.phase === 'shoot' });
          used += n;
          if (used >= 500) break outer;
        }
      }
    }
    assert.ok(used >= 50, `premisa: muestras suficientes (${used})`);
    const want = truth.nameNeurons(genome, samples);
    const got = (await api(`/api/lab/nets/${t}/neurons`)).body;
    assert.equal(got.m, used);
    assert.deepEqual(got.blocks, clone(want));
  });

  await check('M8: el duelo en curso dice su sala en vivo (liveRoom), que se puede espectar; al acabar, liveRoom es null y la sala está en roomCodes', async () => {
    const a = await mkNet('seer', 'Vivo A'), b = await mkNet('sniper', 'Vivo B');
    const d = await api('/api/lab/duels', 'POST', { a, b, learning: 'frozen', speed: 'x10', soldiers: 2, seed: 21 });
    assert.equal(d.status, 202, d.text);
    assert.ok('liveRoom' in d.body, 'la respuesta dice liveRoom');
    const live = await until(async () => { const r = (await api(`/api/lab/duels/${d.body.id}`)).body; return r && r.liveRoom ? r.liveRoom : null; }, 60000, 'sala en vivo');
    const st = (await api(`/api/rooms/${live}/state`)).body;
    assert.equal(st.phase, 'playing');
    assert.deepEqual(st.players.map((p) => p.netId).sort(), [a, b].sort());
    const done = await duelDone(d.body.id);
    assert.equal(done.liveRoom, null);
    assert.ok(done.roomCodes.includes(live));
  });
}

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (arreglos: verdad y registro)');
process.exitCode = fails ? 1 : 0;
