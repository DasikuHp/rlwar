// Reproductor de la moviola (P6, sesión 14): pinta una partida rehecha (moviola.js) en el plano de siempre (render.js):
// ▶ y pausa (también a mitad de curva), tiro a tiro, volver atrás, ir a un tiro y velocidad. La vista pone los botones y
// lee `at` (tiros ya trazados), `n`, `playing` y `shown` (el tiro que se ve ahora) en `onChange`.
import { R, resetRoom, startShot, shotFinished, pauseShot, expect, say } from '../render.js';
import { stateAt } from '../../../shared/moviola.js';
import { PLANE } from '../../../shared/constants.js';

export function moviolaPlayer(canvas, rp, { onChange = () => {}, speed = 1 } = {}) {
  let at = 0, playing = false, timer = null, alive = true;
  const n = rp.frames.length;
  const players = rp.players.map((p) => ({ id: p.id, name: p.name, team: p.team }));
  const mine = () => alive && R.canvas === canvas;
  const animating = () => mine() && !!R.current;
  const changed = () => { try { onChange(); } catch (e) { console.error(e); } };

  // el plano después de k tiros, sin animar
  function show(k) {
    clearTimeout(timer);
    if (!mine()) return;
    resetRoom();
    const s = stateAt(rp, k);
    at = s.k;
    R.state = { phase: 'playing', config: { plane: PLANE, speed }, players, soldiers: s.soldiers, obstacles: rp.obstacles, bites: s.bites, turn: null };
    R.shots = s.trails.map((t) => ({ points: t.points, team: t.team, ts: Date.now() }));
    R.onLanded = landed;
    changed();
  }
  // traza el tiro `at`: primero lo que dijo (sale después de su función, como en directo) y luego la curva
  function fire() {
    const f = rp.frames[at];
    if (!f || !mine()) { playing = false; changed(); return; }
    R.state.turn = { soldierId: f.soldierId, playerId: f.playerId, stage: 'shoot' };
    expect(f.soldierId);
    for (const x of f.says) say(x);
    startShot({ soldierId: f.soldierId, playerId: f.playerId, mode: f.mode, expr: f.expr, angle: f.angle, result: f.result, points: f.points, shooterTeam: f.team });
    changed();
  }
  // la curva llegó: sus bajas, su bocado y adónde se movió el tirador; si se está reproduciendo, el siguiente
  function landed() {
    if (!mine()) return;
    const next = stateAt(rp, at + 1);
    R.state.soldiers = next.soldiers; R.state.bites = next.bites; R.state.turn = null;
    at = next.k;
    if (at === n) for (const x of rp.final.says) say(x);
    if (playing && at < n) timer = setTimeout(fire, 900 / speed);
    else playing = false;
    changed();
  }

  const self = {
    get at() { return at; },
    get n() { return n; },
    get playing() { return playing; },
    get speed() { return speed; },
    // el tiro que se ve: el que se está trazando o el último trazado (-1 al empezar)
    get shown() { return animating() ? at : at - 1; },
    play() {
      if (!mine()) return;
      if (at >= n && !animating()) show(0);
      playing = true;
      if (animating()) pauseShot(false); else fire();
      changed();
    },
    pause() { playing = false; clearTimeout(timer); pauseShot(true); changed(); },
    toggle() { if (playing) self.pause(); else self.play(); },
    // ⏭: acaba de golpe el tiro que se traza; si no hay ninguno, traza el siguiente y se para
    step() {
      if (!mine()) return;
      clearTimeout(timer); playing = false;
      if (animating()) { pauseShot(false); shotFinished(R.current); return; }
      if (at < n) fire();
    },
    // ⏮: quita el tiro que se traza o, si no hay ninguno, el último
    back() { playing = false; show(animating() ? at : at - 1); },
    go(k) { playing = false; show(k); },
    setSpeed(v) { speed = v; if (mine() && R.state) R.state.config.speed = v; changed(); },
    stop() { alive = false; clearTimeout(timer); if (R.onLanded === landed) R.onLanded = null; },
  };
  show(0);
  return self;
}
