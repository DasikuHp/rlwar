# 09 — Mundos (3 ranuras) y migración (P2, ronda 17)

Decisiones del usuario (plan2 ronda 17 y sesión 3, 2026-09-24): el juego tiene **3 ranuras**, cada una **un mundo entero**
(redes, trono, dinastías, sala de la fama, partidas, registro y avance del tutorial). Cada mundo nuevo trae una copia de
**Vidente 1** como rival de práctica. Lo de antes se **archiva, no se borra**. Al arrancar, el servidor sigue en el
**último mundo abierto**. Borrar un mundo lo manda a una **papelera**.

## 1. Carpetas
- `<base>` = `GW_EVO_DIR` si está definida; si no, `evo/` del repo. Es la carpeta de datos de siempre.
- Mundo `n` (1, 2 o 3): `<base>/worlds/<n>/`, con la misma forma que `<base>`: `nets/`, `games/`, `records/`,
  `snapshots/`, `throne.json`, `log.jsonl`… y además `meta.json` (§2). Una ranura está **vacía** si no existe su
  `meta.json`.
- **Mundo activo**: toda la API del laboratorio (`/api/lab/*`) y lo que guarda el servidor (entrenos, duelos, partidas,
  trono, registro) va a la carpeta del mundo activo. Sin mundo activo, a `<base>`, como hasta ahora (AGENTS.md y los
  tests siguen igual). `evo/store.js` resuelve todas las rutas con `evoDir()` (también `netsDir()`, que hoy leía
  `GW_EVO_DIR` suelto).
- `<base>/worlds/active.json` = `{n}` del último mundo abierto. Al arrancar, si existe y ese mundo no está vacío, el
  servidor lo abre; si no, trabaja en `<base>`.
- Los hilos (spec/04 §5.1) no tocan el almacén: no cambia nada para ellos.

## 2. `meta.json`
```
{ format: 1, n, name, path, level, createdAt, lastPlayedAt, practice: ['vidente-1'], tutorial: {} }
```
- `name`: 1–40 caracteres (sin saltos de línea); por defecto `"Mundo n"`.
- `path`: el camino del tutorial con el que se creó: `cero` (Desde cero) · `algo` (Ya sé algo) · `rl` (Sé de RL).
- `level`: el nivel del editor que se ve: `A` (Aprendiz) · `B` (Artesano) · `C` (Científico). Al crear sale del camino
  (`cero` → A, `algo` → B, `rl` → C); después se cambia cuando se quiera (nada se bloquea, ronda 8).
- `createdAt`, `lastPlayedAt`: ms desde 1970. `lastPlayedAt` se pone al crear y al abrir.
- `practice`: ids de las redes de práctica del mundo (hoy, la copia de Vidente 1). Las fases siguientes las usan para que
  la de práctica no cuente para el trono (P9, P10); P2 solo las marca.
- `tutorial`: el avance del tutorial; objeto libre de como mucho 64 kB en JSON (lo define P10).

## 3. Vidente, la rival de práctica
- `evo/base/vidente-1.json` (en el repo): el genoma de Vidente 1 tal como estaba el 2026-09-24 (plantilla Vidente con 1
  partida jugada). Cada mundo nuevo la copia a `worlds/<n>/nets/vidente-1.json` sin tocarla (mismo id, nombre y pesos).
- Si falta el fichero base, crear el mundo responde **500** con el motivo (no se crea a medias).

## 4. API (`server/worlds.js`, montada en `server/server.js`)
Todas responden JSON. `:n` fuera de 1–3 → **404**.
- `GET /api/worlds` → `{active: n | null, worlds: [w1, w2, w3]}`. Ranura vacía: `{n, empty: true}`. Llena:
  `{n, empty: false, name, path, level, createdAt, lastPlayedAt, tutorial, practice, nets, games, queen, reigns}` con
  datos reales de su carpeta: `nets` = redes guardadas (incluida la de práctica), `games` = partidas guardadas, `queen` =
  `{id, name, emblem}` de la reina (o `null`), `reigns` = reinados del trono (`throne.reigns.length`).
- `POST /api/worlds/:n/new` `{path, name?}` → **201** `{world}` (la vista de la ranura). **409** si la ranura no está
  vacía; **400** si `path` no es `cero`/`algo`/`rl` o el nombre no vale. Crea la carpeta, `meta.json` y la copia de
  Vidente. No abre el mundo.
- `POST /api/worlds/:n/open` → **200** `{active: n, world}`. **404** si la ranura está vacía. **409** con el motivo si
  algo está en marcha en el mundo activo: un entreno en cola, corriendo o en pausa, un duelo o reto en curso, un trabajo
  (hijos, examen, generación) en curso, una exhibición en curso, o una red ocupada. Si no: el mundo pasa a ser el activo
  (también si ya lo era), se reinicia el estado en memoria de la API del laboratorio (entrenos, duelos, trabajos, redes
  ocupadas y los contadores de ids, que siguen detrás de lo guardado en el mundo nuevo), `lastPlayedAt = ahora`, se
  escribe `active.json` y se avisa por SSE (`/api/lab/events`, evento `world` `{active: n}`).
- `GET /api/worlds/:n/meta` → `meta.json` (404 si está vacía). `PUT /api/worlds/:n/meta` `{name?, level?, tutorial?}`
  → **200** `{meta}` con esos campos cambiados (los demás no se tocan); **400** con motivo si alguno no vale (§2).
- `DELETE /api/worlds/:n` `{confirm}` → **200** `{deleted: n, trash}`. `confirm` tiene que ser exactamente el nombre del
  mundo (**400** si no). **404** si está vacía. Si es el mundo activo: **409** si algo está en marcha (como `open`);
  si no, deja de haber mundo activo (`<base>`, `active.json` se borra). La carpeta se **mueve** a
  `<base>/archivo-borrados/<AAAA-MM-DD-hh-mm-ss>-mundo-<n>/` (no se borra nada); la ranura queda vacía.

## 5. Migración de lo de antes (una vez, al arrancar)
- Solo en la carpeta real (`evo/` del repo; **nunca** cuando `GW_EVO_DIR` está definida, que es lo que usan los tests).
- Si `<base>/archivo-2026-09-23/` no existe y en `<base>` hay datos sueltos (`nets/`, `games/`, `records/`,
  `snapshots/`, `throne.json`, `log.jsonl`, `log.1.jsonl`): se **mueven** tal cual a `<base>/archivo-2026-09-23/`
  (sin borrar ni cambiar nada). Si el archivo ya existe, no hace nada (idempotente).
- `migrateLegacy(base)` (en `server/worlds.js`) hace el trabajo y devuelve `{moved: [nombres]}`; el servidor la llama al
  arrancar con la carpeta real; los tests la llaman con una carpeta temporal.

## 6. Tests (`test/mundos.spec.mjs`, congelado antes del código)
Mundos aislados; ranuras vacías y llenas con datos reales; Vidente idéntica al fichero base en cada mundo nuevo; `new`
dos veces → 409; `open` con un entreno en marcha → 409 con motivo y, parado, abre; el estado en memoria no pasa de un
mundo a otro; `meta` (cambios y errores); borrar (confirmación, papelera, ranura libre, activo); al reiniciar el
servidor sigue en el último mundo abierto; migración que mueve sin borrar y que la segunda vez no hace nada.
