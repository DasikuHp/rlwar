# 01 — Motor: movimiento, semilla, partidas sin pantalla (F1)

> Contrato exacto. Fuente: plan2.md §3 rondas 2 y 9, §4.2, §4.9; ronda 12 (esta sesión).

## 1. Constantes nuevas (`shared/constants.js`)
| Nombre | Valor | Significado |
|---|---|---|
| `MOVE_RADIUS` | 2 | radio máximo del movimiento tras disparar (u) ✅ |
| `BODY` | 0.5 | cuerpo del soldado: distancia mínima a obstáculos y bordes del plano 🧭 |
| `MIN_SEPARATION` | 1.0 | distancia mínima entre centros de dos soldados vivos ("sin apilarse") 🧭 |
| `MOVE_TIME` | 8000 (FAST: 400) ms | margen para que un humano (o agente por API) elija destino tras ver el tiro 🧭 |
| `SLIDE_R_STEP` | 0.05 | paso radial de la rejilla polar del deslizamiento |
| `SLIDE_DEG_STEP` | 5 | paso angular (grados) de la rejilla polar |
| `MOVE_DIRS` | 8 | direcciones de los destinos candidatos (0°, 45°, … 315°, 0° = +x) |

Por qué `BODY` 0.5 y no 1.5 como al nacer: esconderse **pegado** a un muro es la gracia del
movimiento ("red cobarde que se esconde tras los muros"). 0.5 > `OBSTACLE_MARGIN` (0.06) garantiza
que el primer paso de un disparo propio no choca con el muro en el que te apoyas.

## 2. Secuencia del turno (sala viva)
```
turn.stage = 'shoot'  ──fire()──▶  resultado del tiro  ──▶  movimiento  ──▶  nextTurn()
```
1. `fire(playerId, {mode, expr, angle, move?})`. Validación del tiro **igual que hoy**. Si el cuerpo
   trae `move`, se aplica **inmediatamente** tras resolver el tiro (vía `Room.move`, §4) y el turno
   sigue como hoy (`turn = null`, animación, `nextTurn`).
2. Si **no** trae `move`:
   - agente en proceso: si tiene `chooseMove` se llama **en el acto** (síncrono) con el resultado del
     tiro (§5) y se aplica; si no lo tiene, se usa `choice.move` devuelto por `chooseShot`; si tampoco,
     se queda quieto. Nunca hay ventana para agentes en proceso.
   - humano o agente externo: `turn = {playerId, soldierId, stage:'move', deadline, radius}` con
     `deadline = ahora + animMs + MOVE_TIME`. Se emite `state`. Puede llegar `POST /move` (§7). Si
     vence el plazo: se queda quieto y se registra (`lastMove.stayed = true`, `requested = null`).
3. Tras aplicar el movimiento (o quedarse): `broadcast('move', {move: lastMove})`, `turn = null`,
   y `nextTurn()` tras `max(0, fin de la animación − ahora) + NEXT_TURN_DELAY`.
4. Reglas: solo se mueve **el soldado que acaba de disparar**; si el tiro fue `suicide` (mató a un
   aliado) el tirador sigue vivo y se mueve igual. Un jugador cuyo soldado murió por un tiro rival no
   mueve nada (no era su turno).

## 3. Geometría del movimiento (`shared/geometry.js`, pura)
`slideMove({from, requested, soldiers, obstacles, selfId, plane})` → `{to, slid, stayed, reason}`.

Un punto `P` es **válido** para el soldado `S` (en `from`) si cumple TODO:
1. `dist(P, from) ≤ MOVE_RADIUS + 1e-9`.
2. `xMin + BODY ≤ P.x ≤ xMax − BODY` y `yMin + BODY ≤ P.y ≤ yMax − BODY`.
3. Para cada obstáculo `o` (rect `{x,y,w,h}`): `P` está **fuera** del rect ampliado en `BODY`:
   `P.x < o.x − BODY || P.x > o.x + o.w + BODY || P.y < o.y − BODY || P.y > o.y + o.h + BODY`.
4. Para cada otro soldado **vivo** `T ≠ S` (de cualquier equipo): `dist(P, T) ≥ MIN_SEPARATION`.
5. El segmento `from → P` no atraviesa ningún rect ampliado: se muestrea en `t = 0.1, 0.2 … 1.0`
   (fracción del segmento) y ningún punto cae dentro (no se puede "atravesar" un muro de un salto).

Algoritmo (determinista):
- `requested === 'stay' | null | undefined` → `{to: from, slid:false, stayed:true}`.
- `T = requested`; si `dist(T, from) > MOVE_RADIUS`, `T` se recorta al círculo (misma dirección).
- Si `T` es válido → `{to: T, slid:false, stayed:false}`.
- Si no: se recorren los puntos `from + r·(cos θ, sin θ)` con `r = 0.05, 0.10 … 2.00` y
  `θ = 0°, 5° … 355°`; entre los válidos se elige el de **menor distancia a `T`**; empates → menor
  `r`; empates → menor `θ`. Resultado `{to, slid:true, stayed:false, reason:'slide'}`.
- Si ningún punto es válido → `{to: from, slid:true, stayed:true, reason:'blocked'}`.
- Entradas no numéricas (`NaN`, cadenas, `Infinity`) → se tratan como `'stay'` con
  `reason:'invalid'` (nunca lanza).

Coste: 40 × 72 = 2 880 puntos × (obstáculos + soldados) comprobaciones ≈ < 1 ms.

Destinos candidatos para agentes y redes (`moveOptions(ctx)` en `agents/lib.js`, sobre `slideMove`):
9 entradas, en este orden: `quedarse`, y luego las 8 direcciones `θ = 0°, 45°, 90° … 315°` a
`MOVE_RADIUS`, cada una **ya deslizada**. Cada destino lleva rasgos (spec/03 §4).

## 4. `Room.move(playerId, requested)` — único validador del movimiento
- Errores (`{error}`): partida no en curso · `turn` nulo o de otro jugador · `turn.stage !== 'move'`
  (para humanos/API) · soldado muerto.
- Llama a `slideMove` y aplica `to` al soldado; registra
  `lastMove = {playerId, soldierId, from, to, requested, slid, stayed, reason, ts}`; `log()` una
  línea: `🦶 <nombre> se mueve a (x, y)` / `🦶 <nombre> se queda quieto` / `↪️ … (deslizado)`.
- `fire()` con `move` en el cuerpo llama a este mismo método (con `stage` interno `'move'` durante la
  llamada). No hay otro camino para cambiar `soldier.x/y` durante la partida (salvo `reposition`).

## 5. Contrato de agentes (`agents/*`, `AGENTS.md`) — solo extendido
- `chooseShot(ctx)` recibe además `rng` (función `() → [0,1)` con semilla) y `moveOptions`
  (los 9 destinos de §3). Puede devolver `move: {x,y} | 'stay'` (opcional, como hasta ahora).
- Nuevo opcional `chooseMove({soldiers, obstacles, soldier, shot, moveOptions, history, rng, state})`
  → `{x,y} | 'stay' | null | {x, y, reason?}`. `shot` = `lastShot` con `points`. Si existe, **gana**
  sobre `move` de `chooseShot`.
- Heurísticos con esquiva básica 🧭 (todos con el `rng` recibido; determinista):
  | Agente | Regla de `chooseMove` |
  |---|---|
  | Sniper | destino con **menos enemigos con línea de tiro** sobre él (`cover`); empate → mayor distancia al enemigo más cercano; si `quedarse` empata con el mejor, se queda. |
  | Greedy | entre los destinos con línea de tiro a **algún** enemigo, el más cercano al enemigo más cercano; si ninguno la tiene, el de menos enemigos con línea de tiro. |
  | Artillery | menos enemigos con línea de tiro; empate → **más** lejos del enemigo más cercano. |
  | Chaos | `rng.pick` de los 9. |
  "Línea de tiro" = segmento recto entre dos puntos sin cruzar obstáculos (muestreo cada 0.25 u).

## 6. Semilla y partidas sin pantalla (`server/rooms.js`, `server/headless.js`)
- `new Room(name, {soldiersPerPlayer, seed, headless})`. `seed` entero 0..2³¹−1; si falta, se sortea y
  se expone (`snapshot().config.seed`). `this.rng = makeRng(seed)`.
- Usa `rng`: `genMap(n, rng)` (obstáculos, biomas, posiciones), inicio del orden de turnos, `banter`,
  `reposition`, y **cada agente** (`chooseShot`/`chooseMove` reciben `rng`). No usa `rng`: el código
  de sala, tokens, los retardos de animación/habla (son tiempo, no estado).
- `rematch()` deriva la nueva semilla del `rng` de la sala (`rng.int(2**31)`), así una serie de
  revanchas también es reproducible.
- `headless: true` ✅ ("partidas sin pantalla"): sin `setTimeout`, sin `sayTimer`, sin plazos, sin
  ventanas de movimiento; `addPlayer` → `{error:'Sala sin pantalla: solo agentes'}`; `broadcast` no
  hace nada. `start()` deja el primer `turn` preparado. `step()` ejecuta **un turno completo
  síncrono** (elegir → `fire` → mover → estancamiento/límites → `nextTurn`) y devuelve el `lastShot`.
  `play({maxTurns = 400})` repite hasta `phase === 'over'` (o hasta `maxTurns` → `gameOver(true)`).
- `server/headless.js: playGame({seed, left, right, soldiers, hooks?})` crea la sala, sienta
  `left`/`right` (`{type, level?, temperature?, netId?}`), la juega y devuelve
  `{seed, result, events, trajectories, chat}` (spec/04 §5 y spec/07 §1). `hooks.onTurn(room)` opcional.
- La **experiencia en vivo no cambia** ✅: sin `seed` ni `headless`, la sala se comporta como hoy
  (salvo la etapa `move` del turno, que es la novedad de F1).

## 7. API REST y SSE (extensiones)
| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/api/rooms` | `{name, soldiers, seed?}` | `{code, name, soldiers, seed}` |
| POST | `/api/rooms/:code/fire` | `{playerId, mode, expr, angle, move?}` con `move` = `{x,y}` o `"stay"` | `{ok, result, move?}` (`move` = `lastMove` si venía en el cuerpo) |
| POST | `/api/rooms/:code/move` | `{playerId, x, y}` o `{playerId, stay:true}` | `{ok, move}` o `{error}` |

`snapshot()` añade: `turn.stage` (`'shoot'|'move'`), `turn.radius` (solo en `'move'`), `lastMove`,
`config.seed`, `config.moveRadius`, `config.moveTime`, `config.body`, `config.minSeparation`.
SSE nuevo: `move` → `{move: lastMove}` (después de `shot`).

Compatibilidad: un cliente antiguo que llame a `fire` durante `stage:'move'` recibe
`{error:'Ya disparaste: elige destino o espera'}`; nada se rompe. ✅ (ronda 12) `test/smoke.mjs` y
`agent/agent.mjs autopilot` (no congelados) reciben una línea: `stage === 'move'` →
`POST /move {stay:true}`; documentado en `AGENTS.md`; el cambio al test va en su propio commit.

## 7b. Arreglo del ángulo de artillería en el lado derecho ✅ (ronda 12)
Hoy en `shared/solver.js` (modo `ode2`) `dy = dir·u·tan(angle)`: con `dir = −1` un ángulo positivo
**baja**. Contrato nuevo: **el ángulo positivo sube en los dos lados** (como el original, que espeja
al jugador derecho). Implementación: `v = dir · tan(angle)` al inicializar (solo cambia el signo de
la pendiente inicial para el equipo derecho; `y'` dentro de la EDO sigue siendo `dy/dx` real, así
`f(x, y, y')` no cambia de significado). Test: soldado derecho con `angle 30`, `y'' = 0` → la
trayectoria sube (`y` crece) igual que el soldado izquierdo espejado. Los heurísticos no cambian
(buscan el ángulo por simulación). Conversión de spec/03 §1 para `ode2`: con este arreglo,
`angle` **no** se invierte al pasar de local a mundo.

## 8. Tests de F1 (`test/motor.spec.mjs`, escenas fijas)
- `slideMove`: dentro del radio y válido → sin deslizar · fuera del radio → recortado al círculo ·
  dentro de un obstáculo ampliado → punto válido más cercano (distancia comprobada contra búsqueda
  exhaustiva fina) · pegado al borde del plano → `BODY` · a 0.9 u de otro soldado → ≥ 1.0 ·
  a través de un muro fino → no atraviesa · `NaN` → quieto · determinismo (misma entrada, misma
  salida).
- `Room`: `fire` con `move` aplica y registra · sin `move` → `stage:'move'` con `deadline` ·
  `POST /move` de otro jugador → error · vencimiento → quieto (`FAST`) · `move` no cambia `x/y` por
  ningún otro camino (comprobación de que `soldier.x/y` solo cambian en `move`/`reposition`).
- Semilla: dos salas sin pantalla con la misma semilla y los mismos agentes → misma secuencia de
  `lastShot.result`, posiciones y ganador; semillas distintas → difieren en algo.
- Sin pantalla: `play()` termina; sin temporizadores vivos (`process._getActiveHandles` no crece);
  1–4 soldados por bando.
- Heurísticos: cada regla de §5 sobre una escena fija (p. ej. Sniper a la vista de 2 enemigos con un
  muro a 1.5 u → se mueve tras el muro).
- Regresión: la suite actual sigue en verde.
