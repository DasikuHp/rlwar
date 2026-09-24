// Duelo "mix": cada partida se absorbe una sola vez por red (spec/06 §6.2; auditoría de la sesión 5, hecha en la sesión
// 6 del 2026-09-24, decisión del usuario "una vez, el repaso reutiliza"). Antes, el repaso final volvía a absorber las 6
// partidas: recuerdos repetidos en la memoria, el rival con 12 partidas en vez de 6 y cada término de la recompensa
// contado dos veces en la normalización. Oráculos independientes: las partidas guardadas del propio duelo (los recuerdos
// y las cuentas por término salen de mirar cada partida UNA vez) y el aprendiz inyectable de spec/06 (qué objetos recibe).
// Escrito ANTES del arreglo y congelado. En proceso, sin servidor. Uso: node test/duelo-mix.spec.mjs
process.env.GW_FAST = '1';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GW_EVO_DIR = mkdtempSync(join(tmpdir(), 'gw-evo-duelo-mix-'));

let fails = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const store = await import('../evo/store.js');
const { runDuel } = await import('../evo/duel.js');
const { assignRewards } = await import('../shared/reward.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { normalize } = await import('../shared/genome.js');

const mk = (id, t) => { const r = store.saveNet({ ...JSON.parse(JSON.stringify(TEMPLATES[t].genome)), id, name: id }); assert.ok(r.ok, JSON.stringify(r.errors)); return id; };

await check('aprendiz inyectable: en "mix" el repaso recibe las mismas 6 partidas (los mismos objetos, en orden) que aprendió tras cada una; en "frozen", 6 partidas; en "hot", ningún repaso', async () => {
  const a = mk('mix-iny-a', 'sniper'), b = mk('mix-iny-b', 'sniper');
  for (const learning of ['mix', 'frozen', 'hot']) {
    const seen = {};
    const learner = (netId) => {
      const s = (seen[netId] = { learned: [], reviewed: null });
      return { learn: (games) => { s.learned.push(...games); }, review: (games) => { s.reviewed = games; }, save: () => {} };
    };
    const rec = await runDuel({ a, b, learning, speed: 'turbo', soldiers: 1, seed: 3, saveGames: false, learner });
    assert.equal(rec.games.length, 6);
    for (const id of [a, b]) {
      const s = seen[id];
      if (learning === 'mix') {
        assert.equal(s.learned.length, 6); assert.equal(s.reviewed.length, 6);
        s.reviewed.forEach((g, i) => assert.ok(g === s.learned[i], `${learning}, ${id}: la partida ${i} del repaso no es la misma que aprendió`));
      } else if (learning === 'frozen') { assert.equal(s.learned.length, 0); assert.equal(s.reviewed.length, 6); }
      else { assert.equal(s.learned.length, 6); assert.equal(s.reviewed, null); }
    }
  }
});

await check('redes de verdad, duelo "mix" de 6 partidas: el rival sale 6 veces en la memoria (no 12), ningún recuerdo repetido y cada término de la recompensa contado una vez por decisión', async () => {
  const a = mk('mix-real-a', 'seer'), b = mk('mix-real-b', 'sniper');
  const rec = await runDuel({ a, b, learning: 'mix', speed: 'turbo', soldiers: 2, seed: 5 });
  assert.equal(rec.status, 'done');
  const games = rec.games.map((row) => store.loadGame(row.gameId));
  assert.ok(games.every(Boolean), 'premisa: las 6 partidas están guardadas');
  for (const [me, other] of [[a, b], [b, a]]) {
    const g = store.loadNet(me);
    assert.equal(g.memory.rivals[other].games, 6, `${me}: partidas contra ${other} en la memoria`);
    const refs = g.memory.episodes.map((e) => `${e.ref.game}|${e.ref.id}|${e.outcome}`);
    assert.equal(new Set(refs).size, refs.length, `${me}: recuerdos repetidos`);
    // oráculo: mirar cada partida guardada UNA vez con la recompensa de la red, desde estadísticas vacías
    const reward = normalize(JSON.parse(JSON.stringify(TEMPLATES[me === a ? 'seer' : 'sniper'].genome))).reward;
    const stats = {};
    for (const game of games) {
      const start = game.events.find((e) => e.type === 'game.start');
      const pid = start.data.players.find((p) => p.netId === me).playerId;
      assignRewards({ reward, teamSpirit: g.traits.teamSpirit, events: game.events, trajectory: game.trajectories[pid], playerId: pid, stats });
    }
    const n = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.n]).sort());
    assert.ok(Object.keys(stats).length > 0, 'premisa: hay términos');
    assert.deepEqual(n(g.reward.stats), n(stats), `${me}: cuentas por término`);
  }
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (duelo mix: cada partida se absorbe una vez)');
process.exit(fails ? 1 : 0);
