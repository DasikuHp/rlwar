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
  `lastMove = {playerId, soldierId, from, to, requested, slid, stayed, reason, ts}` (`from`/`to`/`requested`
  son `{x, y}`; `requested` es `null` si fue `stay`, vencimiento o entrada inválida); `log()` una
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
  | Sniper | destino con **menos enemigos con línea de tiro** sobre él (`cover`); empate → mayor distancia al enemigo más cercano; **si `quedarse` tiene la misma cobertura que el mejor destino, se queda** (no se mueve solo por alejarse). |
  | Greedy | entre los destinos con línea de tiro a **algún** enemigo, el más cercano al enemigo más cercano (empate → menor índice); si ninguno la tiene, el de menos enemigos con línea de tiro (empate → menor índice). |
  | Artillery | menos enemigos con línea de tiro; empate → **más** lejos del enemigo más cercano (empate → menor índice). |
  | Chaos | `options[Math.floor(rng() * 9)]`. |
  Sin enemigos vivos: todos se quedan. `rng` es la función `() → [0,1)` de `shared/rng.js`
  (`makeRng(seed)`, con `rng.int(n)`, `rng.pick(arr)`, `rng.gauss()`, `rng.seed`); por defecto
  `Math.random`. `moveOptions(ctx)` devuelve `[{i, to:{x,y}, stay, slid, cover, distEnemy, los}]`
  (`cover` = enemigos vivos con línea de tiro al destino; `distEnemy` = distancia desde el destino
  al enemigo vivo más cercano; `los` = línea de tiro desde el destino a ese enemigo).
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

## 9. Arreglos tras la revisión de Opus (2026-09-23, `spec/revision-opus.md` C2 y A5)
Aprobados por el usuario ("arréglalo tú"). Completan §2–§7 sin cambiar lo que ya decían.

### 9.1 Fuego amigo (`suicide`)
- El tiro que alcanza a un aliado mata **solo a ese aliado** (evento `friendlyFire` con actor = tirador y `death`
  con actor = aliado). **El tirador sigue vivo y se mueve igual** (§2.4), como en el original: en
  `referencia/graphwar/src/Graphwar/Function.java` el soldado que dispara nunca cuenta como alcanzado.
- Antes, el tirador moría también y `move()` devolvía error sin cerrar el turno: la sala viva se quedaba en
  `stage:'move'` para siempre y la partida sin pantalla se paraba hasta `maxTurns`.

### 9.2 El turno nunca se queda abierto
- Si al resolver la etapa `move` el soldado del turno ya no está vivo (por cualquier causa), `move()` **cierra el
  turno sin mover**: `lastMove = {…, to: from, stayed: true, slid: false, reason: 'dead'}`, evento `move` y
  `nextTurn` como siempre. Vale para agentes en proceso, humanos, agentes por API y vencimientos. Sin error.
- Invariante que prueban los tests: una partida sin pantalla solo termina "por límite" (`result.byLimit`) si ha
  llegado a `MAX_SHOTS` disparos.

### 9.3 `POST /api/rooms {speed}`
- `speed` ∈ {1, 10} (otro valor → 1). Con `speed: 10` la sala solo admite agentes: `join` responde
  `{error: 'Sala x10: solo agentes'}` (§9.5 de spec/04). `config.speed` lo expone.

## 10. Terreno de círculos que se rompe y tiro que atraviesa (ronda 17, 2026-09-23)
Decisión del usuario, fiel al Graphwar original (`referencia/graphwar/`: `GraphServer.generateCircles`,
`Obstacle.explodePoint`, `Function` que registra todos los soldados que toca): "círculos que se rompen, sin renovación
de mapa" y "como el original: atraviesa". Escala del original: el plano de 50 u mide 770 px (1 px ≈ 0,065 u).

### 10.1 Obstáculos y bocados
- Un obstáculo es un círculo `{kind: 'circle', x, y, r}` o, como hasta ahora, un rectángulo `{x, y, w, h}` (sin `kind`
  o con `kind: 'rect'`). Los rectángulos siguen valiendo en todas partes (escenas de tests, "¿qué pasaría si…?",
  agentes por la API); los mapas nuevos solo generan círculos.
- La sala guarda `bites: [{x, y, r}]`: los bocados que las explosiones le han arrancado al terreno en esta partida.
  Un punto es **sólido** si está dentro de algún obstáculo y fuera de todos los bocados.
- Una sola pregunta de colisión, `isSolid(p, terrain, margin)` en `shared/geometry.js` (`terrain = {obstacles,
  bites}`): con margen `m`, el obstáculo se agranda `m` y cada bocado se encoge `m` (círculo: `d ≤ r + m`; rectángulo:
  el de siempre agrandado `m`; bocado: `d < r − m`). La usan el trazado (con `OBSTACLE_MARGIN`), el movimiento y el
  deslizamiento (con `BODY`), la línea de visión (sin margen), la percepción y la colocación de soldados.
- Explosión: todo tiro acaba en un punto (el del choque, el del borde o el último válido) y ahí **arranca un bocado**
  de radio `BITE_RADIUS = 0,78 u` (12 px del original). No mata a nadie por estar cerca: las bajas son las del
  recorrido (§10.3). Solo se guarda el bocado si toca algún obstáculo. Los bocados son parte del estado: `snapshot`,
  moviola, partidas guardadas, "¿qué pasaría si…?" y percepción los ven.
- El evento `game.start` lleva los obstáculos del mapa (`map.obstacles`); con los `bite` de cada `shot`, cualquiera
  (la moviola, un agente externo) rehace el terreno de cualquier turno.

### 10.2 Mapas (`server/mapgen.js`)
- Número de círculos: `round(gauss(15, 7))` limitado a 8–22; radio: `gauss(2,6, 1,6)` u limitado a 1–4 u; centros
  al azar en todo el plano. Todo con el `rng` de la sala (misma semilla, mismo mapa).
- Los tres biomas siguen (la memoria de la red los recuerda) y cambian cómo se reparten los círculos: `ruinas` (35 %)
  = la regla del original; `fortaleza` (35 %) = 2 o 3 círculos grandes (r 3,5–4 u) apilados cerca del centro (x −4..4)
  más los de la regla hasta completar; `llanura` (30 %) = 8–10 círculos de r 1–2,5 u.
- Soldados: cada bando en su mitad (x −23..−6 y 6..23), fuera de todo círculo con 1 u de margen, a 3 u o más entre
  sí (como ahora). Si en 400 intentos no hay sitio, el hueco libre más cercano a (±20, 0).

### 10.3 El tiro atraviesa
- `simulateShot` registra **todos** los soldados vivos (menos el que dispara) a `HIT_RADIUS` o menos del recorrido,
  cada uno una vez y en orden, y **no se para**: acaba en obstáculo, borde, valor inválido, pendiente vertical o
  longitud máxima.
- Resultado: `{type, end, hits: [{soldierId, team, x, y}], soldierId, x, y, firstHit}`; `end` ∈ {obstacle, wall,
  invalid, steep, maxlen} es por qué se paró; `hits` en orden de recorrido; `soldierId` = el primer alcanzado (o null);
  `type` = `kill` si alcanzó a algún enemigo, si no `suicide` si alcanzó a algún aliado, si no `end` (así quien solo
  mira `type` sigue viendo lo mismo en los casos de un solo impacto); `firstHit` = `{x, y, points}`: el punto del
  recorrido donde alcanzó al primero y cuántos puntos llevaba contándolo (o null). Los `points` de antes de `firstHit`
  más ese punto son exactamente el recorrido que devolvía el solver cuando el tiro se paraba en el primer impacto.
- En la sala (`fire()`, único punto de validación): mueren todos los alcanzados. Por cada enemigo, un `kill` del
  tirador y un `death` de la víctima; por cada aliado, un `friendlyFire` y su `death`. El tirador nunca muere por su
  propio tiro. `shotLog` y el evento `shot` guardan `result: {type, soldierId, hits: [ids en orden], kills, friendly,
  end}` (`kills` = enemigos alcanzados, `friendly` = aliados) y el evento `shot` lleva además `bite` (el bocado que
  arrancó, o null): así la moviola rehace el terreno turno a turno. Los eventos `kill` y `friendlyFire` salen en el orden
  del recorrido. Roces: enemigos vivos no alcanzados a 1 u o menos del recorrido.
- Recompensa (spec/04 §2): `kill` suma su peso **por cada** enemigo alcanzado (`result.kills`) y `friendlyFire` por cada
  aliado (`result.friendly`), los dos en la decisión del tiro; sin esos campos (partidas antiguas), uno según `type`.

### 10.4 Sin renovación de mapa
- Se quita la renovación por estancamiento: la partida acaba cuando un bando se queda sin soldados o al llegar a
  `MAX_SHOTS` (empate por límite, `byLimit`). `stats.remaps` y `result.remaps` se quedan a 0 (la forma de la API no
  cambia) y el ojo Reloj mantiene su tamaño: su entrada de renovaciones vale 0, y la de disparos seguidos sin bajas
  (`shotsNoKill / STALL_SHOTS`), que ya no vuelve a 0 con un mapa nuevo, se queda como mucho en 1.

### 10.5 Percepción (mismo tamaño de entrada; spec/03)
- 🧱 Obstáculos: por hueco, un círculo da `(cx/25, cy/15, 2r/10, 2r/15, 1)` (su caja), igual que un rectángulo; el
  orden sigue siendo por cercanía. 📡 Radar, 🗺 Mapa, destinos de movimiento y línea de visión usan `isSolid`, así ven
  los bocados. También los ven la cobertura de la sala (`coverBefore/After` de los eventos `move`, la recompensa
  "cubrirse" y el examen de cobertura), el ajuste fino del movimiento de una red y el dibujo de los candidatos de una
  red sin Simulador.
- 🔮 Simulador (decisión del usuario, 2026-09-24: "más RL, como decía el plan"; la IA del original, `ComputerPlayer`,
  puntúa ±2 000 000 por cada soldado alcanzado): las dos primeras entradas son **cuántos** enemigos y **cuántos**
  aliados alcanza el tiro (como mucho 4). Con un solo impacto valen 1, así que dice exactamente lo mismo que antes
  (Vidente y los tests de percepción siguen valiendo) y un tiro que alinea a dos enemigos llega con un 2: la
  recompensa, que suma `kill` por cada enemigo, es lineal en esas cuentas. `obstacle`/`wall`/"otro" solo si no alcanza
  a nadie (miran `end`); fin, puntos y distancia mínima al enemigo = hasta el **primer** impacto (`firstHit`: dónde
  golpea primero y lo cerca que pasó hasta ahí, lo que decía el solver cuando se paraba ahí); la última entrada = alcanza
  al enemigo más cercano. `eyeDim` = 10, sin ajustes nuevos.
- 👥 Compañeros: "que mataron" y "con fuego amigo" miran las cuentas del último tiro de cada compañero (`kills > 0`,
  `friendly > 0`): un tiro que mata a un enemigo y a un aliado cuenta en los dos; los tiros antiguos, sin cuentas, por
  su `type`.
- Las redes guardadas siguen siendo válidas (mismas entradas), pero vieron otro terreno: conviene reentrenarlas.

### 10.5b Rendimiento (auditoría de P1, 2026-09-24)
Con 8–22 círculos, cada deslizamiento probaba los 2 880 puntos de la rejilla polar (§3) contra todos los círculos y una
partida sin pantalla pasó de ~35 ms a ~1 s (el servidor se quedaba sin responder hasta 5,7 s durante un entreno turbo).
Dos atajos **exactos** (mismo resultado): la rejilla descarta un punto que no mejora la distancia antes de validarlo, y
un círculo descarta por su caja antes de calcular la distancia. Con ellos, una partida ≈ 0,2 s; sigue siendo más que
antes porque las partidas tienen ~14 tiros en vez de ~5 (el terreno tapa más), que es el juego nuevo.

### 10.6 Tests
- `test/terreno.spec.mjs`, congelado antes del código (y cambiado con OK del usuario el 2026-09-24: tres errores del
  test y el Simulador con cuentas): solidez de círculo y bocado (con y sin margen), un bocado abre un paso cerrado, mapas
  con semilla deterministas y dentro de los límites de §10.2, soldados fuera de los círculos, un tiro atraviesa a dos
  enemigos y a un aliado (tres muertes, el tirador vivo, eventos en orden), recompensa por cada baja, sin renovación
  tras muchos fallos, la moviola puede rehacer el terreno con los `bite` de los tiros, la percepción con el mismo tamaño
  y el Simulador con cuentas.
- `test/terreno-extra.spec.mjs` (auditoría de P1): cobertura, ajuste fino del movimiento y dibujo de candidatos con
  bocados; distancia mínima del Simulador hasta el primer impacto; Compañeros con cuentas; deslizar = la rejilla
  completa (guarda de los atajos de §10.5b) y un tope grueso de tiempo; la clave de la capa dibujada del terreno.
- `test/terreno-api.spec.mjs`: "¿qué pasaría si…?" por la API con círculos y bocados (escrito tras el código).
