// Llamadas al laboratorio (spec/08): devuelven {status, ok, body} y nunca lanzan por un 4xx.
export async function api(path, method = 'GET', body = undefined) {
  let res;
  try {
    res = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    return { status: 0, ok: false, body: { error: `No hay conexión con el servidor (${e.message}).` } };
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, body: json };
}

// el motivo que da el servidor, tal cual (400 con errores de validate, 404, 409 con el porqué)
export const reasonOf = (r) => (r.body && (r.body.error || r.body.message)) || `Error ${r.status}`;
