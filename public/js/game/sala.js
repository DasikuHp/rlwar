// Escuchar una sala en directo (sesión 9): una sola pieza para el duelo (etapa 3) y "Probar ya" del editor, que antes
// repetían lo mismo y, con un duelo en directo a la vez, pintaban las dos salas en el mismo plano. El plano (render.js) es
// uno para todo el juego: la vista que llama a take() se queda con él y la que lo tenía deja de escuchar su sala (sin
// olvidarla: al volver a llamar a take() la retoma, con las últimas curvas que trae el estado de la sala).
// Aquí va todo lo que toca el plano (estado, curvas, lo que piensa la red, bocadillos); la vista recibe los avisos para
// su panel: {state, shot, decision, move, chat, landed, missing}.
import { initRender, startShot, R, resetRoom, say, expect } from '../render.js';
import { overlay } from '../live.js';
import { hub } from '../ui/sse.js';
import { api, reasonOf } from '../lab/api.js';

let owner = null;
const validState = (st) => !!st && !!st.phase && Array.isArray(st.players) && Array.isArray(st.soldiers);

export function roomWatch(canvasOf, h = {}) {
  let code = null, offs = [], fresh = false;
  const seen = new Set();
  const off = () => { for (const f of offs) f(); offs = []; };
  const call = (k, ...a) => { try { if (h[k]) h[k](...a); } catch (e) { console.error(e); } };
  function onState(st) {
    if (!validState(st)) return;
    R.state = st;
    // recién suscrita (sala nueva o vuelta de otra vista): las últimas curvas que trae el estado, para no ver el plano vacío
    if (fresh && !R.shots.length && !R.current && Array.isArray(st.shotLog)) {
      for (const e of st.shotLog) if (Array.isArray(e.points) && e.points.length) R.shots.push({ points: e.points, team: e.team, ts: Date.now() });
    }
    fresh = false;
    call('state', st);
  }
  function onDecision(d) {
    if (!d || !R.state) return;
    const sol = R.state.soldiers.find((s) => s.id === d.soldierId);
    const ov = overlay(d);
    R.think = ov ? { ...ov, team: sol ? sol.team : 'left', until: Date.now() + (ov.kind === 'move' ? 4000 : 15000) } : null;
    if (d.phase === 'shoot') expect(d.soldierId);
    call('decision', d);
  }
  // lo que dice cada red sale en bocadillo sobre su soldado, después de su función (ui/bubbles.js); sin repetir
  function bubbles(list) {
    for (const c of list || []) {
      if (c.kind !== 'say' || !c.soldierId) continue;
      const key = `${c.t}|${c.text}`;
      if (seen.has(key)) continue;
      seen.add(key); if (seen.size > 300) seen.clear();
      const cut = c.text.indexOf(': ');
      say({ soldierId: c.soldierId, text: cut >= 0 && cut < 40 ? c.text.slice(cut + 2) : c.text, level: c.level || null });
    }
  }
  function subscribe() {
    off(); resetRoom(); seen.clear(); fresh = true;
    const c = code, url = `/api/rooms/${c}/events`;
    offs = [
      hub.on(url, 'hello', onState), hub.on(url, 'state', onState),
      hub.on(url, 'shot', (d) => { if (!d || !d.shot) return; startShot(d.shot); call('shot', d.shot); }),
      hub.on(url, 'decision', (d) => onDecision(d && d.decision)),
      hub.on(url, 'move', (m) => { if (R.think && R.think.kind === 'move') R.think = null; call('move', m); }),
      hub.on(url, 'chat', (d) => {
        const list = (d && d.chat) || [];
        if (R.state) R.state.chat = list;
        // al suscribirse, lo que ya se dijo va al registro, pero no sale en bocadillo (ya pasó)
        if (fresh) for (const x of list) seen.add(`${x.t}|${x.text}`); else bubbles(list);
        call('chat', list);
      }),
    ];
    api(`/api/rooms/${c}/state`).then((r) => {
      if (code !== c || owner !== self) return;
      if (r.ok) { if (Array.isArray(r.body.chat)) for (const x of r.body.chat) seen.add(`${x.t}|${x.text}`); onState(r.body); return; }
      off(); code = null;
      call('missing', r.status === 404 ? `La sala ${c} no existe (o ya se cerró).` : reasonOf(r));
    });
  }
  const self = {
    // quedarse con el plano: pinta en el lienzo de esta vista y, si ya escuchaba una sala, la retoma
    take() {
      if (owner && owner !== self) owner.release();
      owner = self;
      initRender(canvasOf());
      R.onLanded = (shot) => call('landed', shot);
      if (code) subscribe(); else resetRoom();
    },
    // escuchar esta sala (si es la misma y ya se escucha, no hace nada)
    watch(c) {
      if (!c) return;
      if (owner === self && code === c && offs.length) return;
      code = c;
      if (owner !== self) self.take(); else subscribe();
    },
    // otra vista se queda el plano: deja de escuchar, pero recuerda qué sala era
    release() { off(); if (owner === self) owner = null; },
    // olvidar la sala
    stop() { off(); code = null; if (owner === self) { owner = null; resetRoom(); R.onLanded = null; } },
    get code() { return code; },
    get active() { return owner === self && !!offs.length; },
  };
  return self;
}
