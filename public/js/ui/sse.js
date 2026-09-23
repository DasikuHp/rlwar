// Una sola conexión SSE por URL para toda la página (spec/08 §11). El navegador abre como mucho 6 conexiones HTTP/1.1
// a la vez por servidor y cada SSE ocupa una mientras está abierta: si cada vista abriera la suya, las peticiones
// siguientes esperarían sin fin. Aquí se suscriben todas; `hello` se guarda para quien llega tarde.

const parse = (text) => { try { return JSON.parse(text); } catch { return text; } };

export function createHub({ EventSourceImpl = globalThis.EventSource } = {}) {
  const conns = new Map(); // url → {es, subs: Map<tipo, Set<fn>>, hello, n}
  const deliver = (fn, data) => { try { fn(data); } catch (e) { if (globalThis.console) console.error(e); } };

  function open(url) {
    const c = { es: new EventSourceImpl(url), subs: new Map(), hello: undefined, n: 0 };
    conns.set(url, c);
    listen(c, 'hello'); // siempre: así se guarda aunque nadie lo haya pedido aún
    return c;
  }
  function listen(c, type) {
    c.subs.set(type, new Set());
    c.es.addEventListener(type, (ev) => {
      const data = parse(ev.data);
      if (type === 'hello') c.hello = { data };
      for (const fn of [...(c.subs.get(type) || [])]) deliver(fn, data);
    });
  }

  function on(url, type, fn) {
    if (typeof EventSourceImpl !== 'function') return () => {};
    const c = conns.get(url) || open(url);
    if (!c.subs.has(type)) listen(c, type);
    // cada suscripción es única aunque la misma función se suscriba dos veces
    const entry = (data) => fn(data);
    c.subs.get(type).add(entry);
    c.n++;
    if (type === 'hello' && c.hello) deliver(entry, c.hello.data);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const set = c.subs.get(type);
      if (set) set.delete(entry);
      if (--c.n === 0) { c.es.close(); if (conns.get(url) === c) conns.delete(url); }
    };
  }

  return { on, connections: () => conns.size };
}

// la de la página
export const hub = createHub();
