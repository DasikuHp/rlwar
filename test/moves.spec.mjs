// F1 — Destinos de movimiento y esquiva de los heurísticos (spec/01 §3 y §5): propiedades sobre
// escenas aleatorias contra una reimplementación independiente de las reglas. Sin servidor.
import { strict as assert } from 'node:assert';

let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const C = await import('../shared/constants.js');
const { makeRng } = await import('../shared/rng.js');
const { slideMove } = await import('../shared/geometry.js');
const lib = await import('../agents/lib.js');
const { createAgent } = await import('../agents/registry.js');

// referencia independiente de la línea de tiro (muestreo cada 0.25 u, rect sin ampliar, bordes incluidos)
const losRef = (a, b, obstacles) => {
  const len = dist(a, b), n = Math.max(1, Math.ceil(len / 0.25));
  for (let k = 1; k <= n; k++) {
    const t = k / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (obstacles.some((o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h)) return false;
  }
  return true;
};
const scene = (seed) => {
  const rng = makeRng(seed);
  const me = { id: 'me', team: 'left', x: -22 + rng() * 44, y: -13 + rng() * 26, alive: true };
  const soldiers = [me];
  for (let i = 0; i < rng.int(4); i++) soldiers.push({ id: 'e' + i, team: 'right', x: me.x - 8 + rng() * 16, y: me.y - 6 + rng() * 12, alive: rng() < 0.75 });
  for (let i = 0; i < rng.int(3); i++) soldiers.push({ id: 'a' + i, team: 'left', x: me.x - 5 + rng() * 10, y: me.y - 5 + rng() * 10, alive: rng() < 0.75 });
  const obstacles = Array.from({ length: rng.int(5) }, () => ({ x: me.x - 6 + rng() * 12, y: me.y - 6 + rng() * 12, w: 0.3 + rng() * 4, h: 0.3 + rng() * 4 }));
  return { me, soldiers, obstacles, rng };
};
const asPoint = (m, from) => (m === 'stay' || m == null ? { x: from.x, y: from.y } : { x: m.x, y: m.y });
const samePoint = (a, b) => near(a.x, b.x, 1e-9) && near(a.y, b.y, 1e-9);

check('los: muestreo cada 0.25 u con bordes incluidos; segmentos cortos usan solo el extremo', () => {
  const wall = [{ x: 1, y: -1, w: 1, h: 2 }];
  assert.equal(lib.los({ x: 0, y: 0 }, { x: 3, y: 0 }, wall), false);
  assert.equal(lib.los({ x: 0, y: 2 }, { x: 3, y: 2 }, wall), true);
  assert.equal(lib.los({ x: 0, y: 1 }, { x: 3, y: 1 }, wall), false, 'borde superior incluido');
  assert.equal(lib.los({ x: 0, y: 1.0001 }, { x: 3, y: 1.0001 }, wall), true);
  assert.equal(lib.los({ x: 0.9, y: 0 }, { x: 1.1, y: 0 }, wall), false, 'segmento corto: el extremo está dentro');
  assert.equal(lib.los({ x: 0.8, y: 0 }, { x: 0.95, y: 0 }, wall), true, 'segmento corto que no llega');
  assert.equal(lib.los({ x: 0, y: 0 }, { x: 0, y: 0 }, wall), true, 'punto = punto');
  for (let seed = 1; seed <= 100; seed++) {
    const { me, soldiers, obstacles } = scene(seed);
    for (const s of soldiers) assert.equal(lib.los(me, s, obstacles), losRef(me, s, obstacles), `seed ${seed}`);
  }
});

check('moveOptions (120 escenas): orden, deslizamiento (igual que slideMove), cover, distEnemy y los correctos', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const { me, soldiers, obstacles } = scene(seed);
    const ctx = lib.contextFor(soldiers, obstacles, me);
    const opts = lib.moveOptions(ctx);
    assert.equal(opts.length, 9);
    const enemies = soldiers.filter((s) => s.alive && s.team !== 'left');
    for (let i = 0; i < 9; i++) {
      const o = opts[i];
      assert.equal(o.i, i); assert.equal(o.stay, i === 0);
      const from = { x: me.x, y: me.y };
      if (i === 0) { assert.ok(samePoint(o.to, from)); assert.equal(o.slid, false); }
      else {
        const th = (i - 1) * Math.PI / 4;
        const ref = slideMove({ from, requested: { x: me.x + 2 * Math.cos(th), y: me.y + 2 * Math.sin(th) }, soldiers, obstacles, selfId: 'me' });
        assert.ok(samePoint(o.to, ref.to), `seed ${seed} dir ${i}`); assert.equal(o.slid, ref.slid);
      }
      const cover = enemies.filter((e) => losRef(o.to, e, obstacles)).length;
      assert.equal(o.cover, cover, `seed ${seed} cover ${i}`);
      if (!enemies.length) { assert.equal(o.distEnemy, null); assert.equal(o.los, false); }
      else {
        const nearest = enemies.slice().sort((p, q) => dist(o.to, p) - dist(o.to, q))[0];
        assert.ok(near(o.distEnemy, dist(o.to, nearest)), `seed ${seed} dist ${i}`);
        assert.equal(o.los, losRef(o.to, nearest, obstacles), `seed ${seed} los ${i}`);
      }
    }
  }
});

// reglas de spec/01 §5, reimplementadas aquí
const rules = {
  sniper(opts, hasEnemies) {
    if (!hasEnemies) return 'stay';
    const best = opts.slice().sort((a, b) => a.cover - b.cover || b.distEnemy - a.distEnemy || a.i - b.i)[0];
    if (opts[0].cover === best.cover) return 'stay';
    return best.to;
  },
  greedy(opts, hasEnemies) {
    if (!hasEnemies) return 'stay';
    const withLos = opts.filter((o) => o.cover > 0).sort((a, b) => a.distEnemy - b.distEnemy || a.i - b.i);
    const pick = withLos.length ? withLos[0] : opts.slice().sort((a, b) => a.cover - b.cover || a.i - b.i)[0];
    return pick.stay ? 'stay' : pick.to;
  },
  artillery(opts, hasEnemies) {
    if (!hasEnemies) return 'stay';
    const best = opts.slice().sort((a, b) => a.cover - b.cover || b.distEnemy - a.distEnemy || a.i - b.i)[0];
    return best.stay ? 'stay' : best.to;
  },
  chaos(opts, hasEnemies, seed) {
    if (!hasEnemies) return 'stay';
    const rng = makeRng(seed);
    const o = opts[Math.floor(rng() * 9)];
    return o.stay ? 'stay' : o.to;
  },
};

check('chooseMove de los 4 heurísticos (120 escenas) coincide con las reglas de spec/01 §5', () => {
  const moved = { sniper: 0, greedy: 0, artillery: 0, chaos: 0 }, stayed = { sniper: 0, greedy: 0, artillery: 0, chaos: 0 };
  for (let seed = 1; seed <= 120; seed++) {
    const { me, soldiers, obstacles } = scene(seed);
    const ctx = lib.contextFor(soldiers, obstacles, me);
    const opts = lib.moveOptions(ctx);
    const hasEnemies = soldiers.some((s) => s.alive && s.team !== 'left');
    for (const type of ['sniper', 'greedy', 'artillery', 'chaos']) {
      const agent = createAgent(type, { level: 3 });
      const got = agent.chooseMove({ soldiers, obstacles, soldier: me, shot: null, moveOptions: opts, history: [], rng: makeRng(1000 + seed), state: null });
      const expected = rules[type](opts, hasEnemies, 1000 + seed);
      assert.ok(samePoint(asPoint(got, me), asPoint(expected, me)), `seed ${seed} ${type}: ${JSON.stringify(got)} vs ${JSON.stringify(expected)}`);
      if (samePoint(asPoint(got, me), me)) stayed[type]++; else moved[type]++;
    }
  }
  for (const t of ['sniper', 'greedy', 'artillery', 'chaos']) assert.ok(moved[t] >= 5 && stayed[t] >= 5, `${t}: ${moved[t]} movimientos, ${stayed[t]} quietos`);
});

check('coverMove/greedyMove: empates resueltos por índice; sin enemigos distEnemy es null y no rompe', () => {
  const from = { x: 0, y: 0 };
  const mk = (i, cover, distEnemy, stay = false) => ({ i, to: stay ? from : { x: i, y: 0 }, stay, slid: false, cover, distEnemy, los: cover > 0 });
  const opts = [mk(0, 1, 5, true), mk(1, 0, 5), mk(2, 0, 5), mk(3, 1, 9)];
  assert.deepEqual(lib.coverMove(opts, { stayIfCovered: true, farther: true }), { x: 1, y: 0 }, 'cover 0 empatado a la misma distancia → menor índice');
  assert.deepEqual(lib.coverMove(opts, { stayIfCovered: false, farther: true }), { x: 1, y: 0 });
  assert.equal(lib.coverMove([mk(0, 0, 5, true), mk(1, 0, 9)], { stayIfCovered: true, farther: true }), 'stay', 'quedarse igual de tapado → se queda');
  assert.deepEqual(lib.coverMove([mk(0, 0, 5, true), mk(1, 0, 9)], { stayIfCovered: false, farther: true }), { x: 1, y: 0 }, 'sin preferencia por quedarse → el más lejano');
  assert.deepEqual(lib.greedyMove([mk(0, 0, 5, true), mk(1, 1, 7), mk(2, 1, 6)]), { x: 2, y: 0 }, 'con línea de tiro, el más cercano');
  assert.deepEqual(lib.greedyMove([mk(0, 0, 5, true), mk(1, 0, 7), mk(2, 2, 6)]), { x: 2, y: 0 }, 'el único con línea de tiro gana aunque esté más lejos');
  assert.equal(lib.greedyMove([mk(0, 0, 5, true), mk(1, 0, 7)]), 'stay', 'sin línea de tiro en ninguno: menos cover y menor índice → quedarse');
  const none = [mk(0, 0, null, true), mk(1, 0, null)];
  assert.equal(lib.coverMove(none, { stayIfCovered: true, farther: true }), 'stay');
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (movimiento de heurísticos F1)');
process.exit(fails ? 1 : 0);
