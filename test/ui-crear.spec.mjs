// Etapa 1 · Crear (P6): lógica pura del editor nuevo — pistas (hints.js), banco de pruebas (bench.js) y deshacer
// (history.js). Sesión 8: "si algo no se puede, una pista de dónde podría ir o de qué le falta a tu red".
// Uso: node test/ui-crear.spec.mjs
import { strict as assert } from 'node:assert';
const { catalog } = await import('../evo/api.js');
const { TEMPLATES } = await import('../shared/templates.js');
const { newGenome, validate } = await import('../shared/genome.js');
const { makeRng } = await import('../shared/rng.js');
const { compile } = await import('../shared/nn.js');
const { decideShot } = await import('../shared/policy.js');
const M = await import('../public/js/lab/model.js');
const H = await import('../public/js/lab/hints.js');
const B = await import('../public/js/lab/bench.js');
const Hi = await import('../public/js/lab/history.js');

const CAT = catalog();
const tpl = (k) => JSON.parse(JSON.stringify(TEMPLATES[k].genome));
const blank = () => newGenome({ id: 'mi-red', name: 'Mi red', blocks: [], wires: [] }, makeRng(1));
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✘ ${name}: ${e.message}`); fails++; }
};

// ---------- pistas ----------
check('red en blanco: todo se puede añadir; Elegir avisa de que le faltan candidatos y dice cuáles', () => {
  const g = blank();
  for (const b of CAT.blocks) assert.ok(H.advice(g, CAT, b.type).can, b.type);
  const a = H.advice(g, CAT, 'hand.choose');
  assert.equal(a.missing, 'cand');
  assert.match(a.why, /Candidatos/);
  assert.match(H.advice(g, CAT, 'gru').why, /contexto/);
  assert.match(H.advice(g, CAT, 'foot.move').why, /Destinos/);
});

check('una mano repetida no se puede añadir y dice cuál ya tienes', () => {
  const a = H.advice(tpl('sniper'), CAT, 'hand.choose');
  assert.equal(a.can, false);
  assert.match(a.why, /Ya tienes Elegir \(ch\)/);
});

check('con candidatos, Elegir dice detrás de qué irá', () => {
  const a = H.advice(tpl('sniper'), CAT, 'hand.adjust');
  assert.ok(a.can);
  assert.match(a.why, /c\)|d\)/);
});

check('conectar: los cables que dice que valen, validate los acepta; los que no, dan el motivo del servidor', () => {
  for (const k of Object.keys(TEMPLATES)) {
    const g = tpl(k);
    for (const b of g.blocks) {
      const o = H.connectOptions(g, CAT, b.id);
      for (const x of o.from) {
        const r = M.connect(g, x.id, b.id);
        if (x.ok) { assert.ok(!r.error, `${k}: ${x.id}→${b.id}`); const v = validate({ ...r.genome, weights: {} }); assert.ok(!v.errors.some((e) => !e.code.startsWith('weights-')), `${k}: ${x.id}→${b.id} ${JSON.stringify(v.errors.map((e) => e.code))}`); }
        else assert.ok(x.why.length > 5, `${k}: ${x.id}→${b.id} sin motivo`);
      }
    }
  }
});

check('conectar: Candidatos → GRU no vale y lo explica (la memoria solo trabaja sobre contexto)', () => {
  const g = tpl('turtle');
  const o = H.connectOptions(g, CAT, 'g').from.find((x) => x.id === 'c');
  assert.equal(o.ok, false);
  assert.match(o.why, /contexto/);
});

check('¿puede jugar?: la red en blanco no, y dice qué añadir; el Francotirador sí, y le recomienda memoria', () => {
  const r0 = H.readiness(blank(), CAT);
  assert.ok(r0.filter((x) => x.required).every((x) => !x.ok));
  assert.deepEqual(r0.find((x) => x.key === 'shots').add, ['eye.candidates']);
  assert.deepEqual(r0.find((x) => x.key === 'choose').add, ['hand.choose']);
  const r1 = H.readiness(tpl('sniper'), CAT);
  assert.ok(r1.filter((x) => x.required).every((x) => x.ok), JSON.stringify(r1));
  assert.equal(r1.find((x) => x.key === 'memory').ok, false);
  assert.equal(H.readiness(tpl('turtle'), CAT).find((x) => x.key === 'memory').ok, true);
});

check('¿puede jugar?: con Elegir y un solo Candidatos sin unir, propone el cable exacto', () => {
  let g = blank();
  let r = M.addBlock(g, 'eye.candidates', CAT); g = r.genome; const c = r.id;
  r = M.addBlock(g, 'hand.choose', CAT); g = r.genome; const ch = r.id;
  const fed = H.readiness(g, CAT).find((x) => x.key === 'fed');
  assert.equal(fed.ok, false);
  assert.deepEqual(fed.wire, [c, ch]);
  const g2 = M.connect(g, c, ch).genome;
  assert.ok(validate(newGenome(g2, makeRng(2)), { forPlay: true }).ok, 'con ese cable ya puede jugar');
});

check('arreglar con un clic: cable repetido, cable a un ojo y Elegir sin candidatos (si hay uno solo)', () => {
  const g = tpl('sniper');
  const dup = { ...g, wires: [...g.wires, { from: 'f', to: 'd' }] };
  const f1 = H.fixes(dup, CAT);
  assert.ok(f1.some((x) => x.code === 'duplicate-wire'));
  assert.equal(f1.find((x) => x.code === 'duplicate-wire').apply(dup).wires.length, g.wires.length);
  const intoEye = { ...g, wires: [...g.wires, { from: 'd', to: 'f' }] };
  const f2 = H.fixes(intoEye, CAT);
  assert.ok(f2.some((x) => /los ojos no reciben/.test(x.label)));
  // Elegir alimentado solo por Rasgos (contexto): la solución única es unirle Candidatos
  const only = { ...tpl('empty'), wires: [{ from: 'f', to: 'ch' }] };
  const f3 = H.fixes(only, CAT);
  const fx = f3.find((x) => x.key === 'feed:ch');
  assert.ok(fx, JSON.stringify(f3.map((x) => x.key)));
  assert.ok(validate(newGenome(fx.apply(only), makeRng(3)), { forPlay: true }).ok);
});

check('arreglar con un clic: si hay dos formas de arreglarlo, no hay botón', () => {
  // Elegir sin candidatos y DOS bloques que los dan: ¿cuál? lo decide la persona
  let g = { ...tpl('seer'), wires: tpl('seer').wires.filter((w) => w.to !== 'cd') };
  g = { ...g, wires: [...g.wires, { from: 'f', to: 'cd' }] };
  assert.ok(!H.fixes(g, CAT).some((x) => x.key === 'feed:ch'));
});

check('pistas por error: dicen qué hacer, no solo qué pasa', () => {
  const g = tpl('turtle');
  assert.match(H.hintFor(g, CAT, { code: 'stream-mix', blockId: 'g' }), /Atención|Resumen/);
  assert.match(H.hintFor(g, CAT, { code: 'unconnected', blockId: 'r' }), /Une/);
  assert.match(H.hintFor(g, CAT, { code: 'missing-choose' }), /Elegir/);
});

check('una línea por bloque que dice qué hace, con sus números', () => {
  const g = tpl('turtle');
  assert.match(H.roleOf(CAT, g, g.blocks.find((b) => b.id === 'g'), null), /recuerda 16/);
  assert.match(H.roleOf(CAT, g, g.blocks.find((b) => b.id === 'ch'), null), /escoge 1 de los \d+ tiros/);
  assert.match(H.roleOf(CAT, g, g.blocks.find((b) => b.id === 'd'), null), /24 neuronas/);
});

// ---------- banco de pruebas ----------
check('banco: decide igual que el servidor (mismo código, misma semilla → misma elección)', () => {
  for (const k of ['sniper', 'seer', 'turtle']) {
    const g = tpl(k);
    for (const s of B.BENCH_SCENES) {
      const a = B.decide(g, s.scene, { seed: 7 });
      assert.ok(a.ok, `${k}/${s.key}: ${a.error}`);
      // el servidor (evo/api.js whatif) hace exactamente esto:
      const soldiers = s.scene.soldiers.map((x) => ({ ownerId: x.team === 'left' ? 'pL' : 'pR', alive: true, turns: 0, ...x }));
      const net = compile(g);
      const d = decideShot({ net, genome: g, state: { soldiers, obstacles: s.scene.obstacles, bites: [], shotLog: [], stats: { shots: 0, shotsNoKill: 0, remaps: 0 }, players: [] }, soldierId: 'yo', memory: net.zeroState(), team: null, rng: makeRng(7), attribution: true }).decision;
      assert.equal(a.decision.chosen, d.chosen, `${k}/${s.key}`);
      assert.deepEqual(a.decision.candidates.map((c) => c.p), d.candidates.map((c) => c.p));
    }
  }
});

check('banco: todas las escenas son válidas para el servidor (dentro del plano, con enemigo)', () => {
  for (const s of B.BENCH_SCENES) assert.equal(B.sceneError(s.scene), null, s.key);
});

check('banco: una red que no puede jugar no decide, y dice por qué', () => {
  const r = B.decide(blank(), B.BENCH_SCENES[0].scene);
  assert.equal(r.ok, false);
  assert.match(r.error, /Elegir/);
});

check('banco: fase de moverse con una red con Pies', () => {
  const r = B.decide(tpl('sniper'), B.BENCH_SCENES[1].scene, { phase: 'move' });
  assert.ok(r.ok, r.error);
  const p = B.pick(r.decision);
  assert.equal(p.kind, 'move');
  assert.ok(p.p > 0 && p.p <= 1);
});

check('tu escena: mover, añadir y quitar rocas y soldados, sin salirse del plano y sin quitar a quien decide', () => {
  let s = B.copyScene(B.BENCH_SCENES[0].scene);
  s = B.moveSoldier(s, 'yo', -40, 99);
  const yo = s.soldiers.find((x) => x.id === 'yo');
  assert.ok(yo.x >= -25 && yo.y <= 15);
  s = B.addRock(s, 0, 0, 99);
  assert.equal(s.obstacles.length, 1); assert.ok(s.obstacles[0].r <= 6);
  s = B.resizeRock(s, 0, 0.1); assert.ok(s.obstacles[0].r >= 0.8);
  s = B.addSoldier(s, 'right'); assert.equal(s.soldiers.length, 3);
  assert.equal(B.removeSoldier(s, 'yo').soldiers.length, 3, 'quien decide no se quita');
  s = B.removeRock(s, 0); assert.equal(s.obstacles.length, 0);
  assert.equal(B.sceneError(s), null);
  const lonely = { ...s, soldiers: s.soldiers.filter((x) => x.team === 'left') };
  assert.match(B.sceneError(lonely), /enemigo/);
});

check('banco: lo que ve cada ojo lleva nombre en cada número; la señal va de 0 a 1', () => {
  const g = tpl('seer');
  const r = B.decide(g, B.BENCH_SCENES[2].scene);
  const eyes = B.eyesView(g, r.obs);
  const f = eyes.find((e) => e.blockId === 'f');
  assert.equal(f.stream, 'ctx'); assert.equal(f.rows.length, 1); assert.equal(f.names.length, f.rows[0].length);
  const c = eyes.find((e) => e.blockId === 'c');
  assert.equal(c.stream, 'cand'); assert.equal(c.rows.length, g.imagination.n);
  const sig = B.signal(g, r.decision, r.obs);
  for (const b of g.blocks) assert.ok(sig[b.id] && sig[b.id].level >= 0 && sig[b.id].level <= 1, b.id);
  assert.ok(Object.values(sig).some((x) => x.level === 1));
});

check('banco: misma red, misma elección; otra temperatura puede cambiarla y se nota', () => {
  const g = tpl('sniper');
  const a = B.decide(g, B.BENCH_SCENES[0].scene).decision;
  assert.ok(B.sameChoice(a, B.decide(g, B.BENCH_SCENES[0].scene).decision));
});

// ---------- deshacer ----------
check('deshacer y rehacer, con la etiqueta de cada cambio', () => {
  const g0 = tpl('sniper');
  let h = Hi.createHistory(g0);
  const g1 = M.addBlock(g0, 'dense', CAT).genome;
  h = Hi.record(h, g1, Hi.describe(g0, g1, CAT), null, 0);
  assert.equal(Hi.undoLabel(h), 'Añadido Instinto (d2)');
  h = Hi.undo(h); assert.equal(h.present, g0); assert.equal(Hi.redoLabel(h), 'Añadido Instinto (d2)');
  h = Hi.redo(h); assert.equal(h.present, g1);
});

check('arrastrar un deslizador cuenta como un solo cambio; otro ajuste, como otro', () => {
  const g0 = tpl('sniper');
  let h = Hi.createHistory(g0);
  let g = g0;
  for (const u of [33, 34, 35, 36]) { const n = M.setParam(g, 'd', { key: 'units', type: 'int', min: 1, max: 512 }, u); h = Hi.record(h, n, Hi.describe(g, n, CAT), 'd.units', u * 10); g = n; }
  assert.equal(h.past.length, 1);
  const n2 = M.setParam(g, 'md', { key: 'units', type: 'int', min: 1, max: 512 }, 20);
  h = Hi.record(h, n2, Hi.describe(g, n2, CAT), 'md.units', 400);
  assert.equal(h.past.length, 2);
  assert.equal(Hi.jump(h, 2).present, g0);
  assert.match(Hi.describe(g0, g, CAT), /units de d: 32 → 36/);
});

console.log(fails ? `\nFAIL ✘ (${fails})` : '\nPASS ✔ (crear: pistas, banco y deshacer)');
process.exitCode = fails ? 1 : 0;
