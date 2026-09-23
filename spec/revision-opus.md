# Revisión de Opus del trabajo de Fable (F0–F7)

> Escrito por Opus 5.5 el 2026-09-23. Esta es la parte 1 del encargo de `spec/prompt-opus-ui.md`. No he tocado
> código crítico: solo he leído, ejecutado y medido. Donde digo "confirmado" es porque lo he reproducido con la
> salida que copio aquí.
>
> **Entorno.** Windows 11, Node 24.15.0, 24 núcleos. Batería con `node test/run-all.mjs`. Prueba en vivo contra
> un servidor aislado en **modo producción** (sin `GW_FAST`): `PORT=8795 GW_EVO_DIR=<carpeta temporal> node
> server/server.js`, con 204 peticiones curl y dos capturas SSE (`/api/lab/events` y el SSE de varias salas).
> Las reproducciones en Node usan los módulos del repo sin modificarlos.

## 0. Resumen para decidir

**Lo que está bien, y es mucho.** En las 204 peticiones de la prueba en vivo no salió ningún `500`. Todas las
entradas malas devuelven 400/404/409 con un mensaje en español, y `validate` añade un `example` útil. Import y
export dan el mismo genoma en la ida y en la vuelta. Los textos de mutación (`opsText`) llevan los números
exactos. El diff, la cirugía, los hijos con pre-torneo, el SSE global y la moviola funcionan. En turbo se juegan
~2,3 partidas por segundo con un hilo. Las pruebas matemáticas (gradiente numérico, BPTT, tareas de resultado
conocido) son serias.

**Lo que no está bien.** Encontré 6 fallos críticos y 6 altos. Los dos más graves (C2 y C3) invalidan en silencio
parte de lo que el laboratorio promete medir.

| # | Gravedad | Hallazgo (detalle y reproducción en §3) |
|---|---|---|
| C1 | crítico (proceso) | Un clon limpio de `origin/master` **no pasa `npm test`**: `motor.spec.mjs` se corrigió y se congeló, pero la corrección nunca se commiteó. |
| C2 | crítico (motor) | **Fuego amigo**: mueren el tirador **y** el aliado (la spec/01 §2.4 dice que el tirador sigue vivo), y el turno no se cierra nunca. Las salas vivas (entrenos y duelos x1/x10) **se cuelgan para siempre**. Las partidas sin pantalla **se paran en seco** y terminan "por límite". Con redes de plantilla y 4 soldados pasa en **24 de 40 partidas**, así que entrenos, pre-torneos, duelos, trono, dinastías y boletín están contaminados. |
| C3 | crítico (aprendizaje) | `learning.method` (`evolution` / `both`) **no se usa en ningún sitio**: toda red aprende por gradiente, elijas lo que elijas (✅ ronda 1). |
| C4 | crítico (verdad) | En las partidas de muestra de un entreno se cuelan **emociones de otras partidas del lote**: la decisión 6 tiene 3 eventos `emotion` con ventajas distintas. La moviola mostraría emociones falsas. |
| C5 | crítico (trono) | Se puede **borrar a la reina** (la spec/08 §4 exige 409). Después, cada reto "lo gana la reina" con un duelo en error de 0 partidas, que se cuenta como defensa. El trono queda bloqueado. |
| C6 | crítico (trono) | **Ids de duelo repetidos**: los duelos de una generación de dinastías reutilizan `d1`, `d2`, `d3`, que ya existen en `/api/lab/duels`. La historia de la casa y las partidas guardadas apuntan al duelo equivocado. |
| A1 | alto | La **bofetada/caricia nunca llega al aprendizaje** en los entrenos (el feedback pendiente no se consume nunca) y no cambia la memoria de la red. |
| A2 | alto | El interruptor **"aprender de esta partida"** (`learn:true` en una exhibición) no hace nada, y la partida tampoco cuenta en `stats.games` (✅ rondas 4 y 8). |
| A3 | alto | **No hay voz verificada en la sala**: no se emite `say`, `reason` siempre va vacío y nada pasa por `checkPhrase`. Las redes dicen frases de relleno sin refs ("Lo vi venir, {victim}.", "Previsto."), lo que choca con "exacto y real". |
| A4 | alto | **Boletín**: el "blanco" que dispara `y = 1000` dibuja una recta horizontal (en modo función la constante no cuenta) y **mata al examinado en 2 de 40** escenas de puntería. En "adaptación", el tamaño del equipo coincide siempre con el lado, y una red que pierde casi todo saca 0,667. |
| A5 | alto | **Rutas del contrato que no existen**: `POST /nets/:id/whatif` (✅ ronda 4, "¿qué pasaría si…?"), `GET /nets/:id/curves` y `GET /api/lab/games?…`. Además, `POST /api/rooms {speed}` se ignora y el catálogo devuelve `mutation: []`. |
| A6 | alto | Una red creada desde plantilla es un **clon exacto** de la plantilla: mismos pesos y **mismo emblema** (✅ ronda 3, "emblema único"). |

Los fallos medios y bajos están en §3.3. Las preguntas que necesito cerrar contigo antes de la parte 2 están en §7.

---

## 1. Recorrido de commits

### 1.1 Los 30 commits (`git log --stat`, resumido)
| commit | hora (09-22) | qué | ficheros / líneas |
|---|---|---|---|
| `0082bd5` | 15:09 | Base verificada + plan2 | 35 / +3305 |
| `af67185` | 16:50 | fix cliente (espectador) | 3 / +48 −2 |
| `98eb428` → `93c4d44` | 16:51 → 16:54 | F0: test rojo → selector de tropas | 1 / +188 · 4 / +83 −7 |
| `68b7ddc` | 16:55 | briefing de Fable | 3 / +141 |
| `93a3ab4` | 17:31 | spec 00–08 + ronda 12 | 10 / +1150 |
| `7b690e8` → `54510a1` | 17:33 → 17:39 | herramientas: test rojo → freeze + mutants | 1 / +193 · 5 / +334 |
| `73b5b54` | 17:44 | F1 test rojo | 3 / +449 |
| `18e4836` | 18:09 | F2 test rojo | 2 / +617 |
| `328d9e3` | 18:21 | **F1 código** (+ congela) | 25 / +743 −98 |
| `8e5fe9a` | 18:33 | **F2 código** (+ congela) | 10 / +1573 |
| `447c8e2` | 20:43 | red.spec cambiado con OK del usuario | 6 / +26 −12 |
| `63ead1b` → `587837a` | 20:54 → 21:07 | F3 test rojo → código | 3 / +855 · 16 / +860 |
| `234533d` → `c9916d5` | 21:10 → 21:14 | api-lab test rojo → código | 3 / +152 · 4 / +207 |
| `1818f0c` | 21:18 | F3 extra por mutantes | 6 / +149 |
| `ca7ba15` → `283b64d` | 21:25 → 21:38 | F4 test rojo → código | 3 / +571 · 14 / +609 |
| `6d3f227` → `b7be917` | 22:03 → 22:24 | F5 test rojo → código | 6 / +1114 · 14 / +944 |
| `4eab5c3` | 22:36 | F6 test rojo | 6 / +602 |
| `0d76dc9` | 22:50 | docs mutantes F4/F5 | 4 / +65 |
| `5d61b95` | 22:56 | **F6 código** (trono.spec cambiado con OK) | 10 / +679 |
| `fd9711f` | 22:57 | F5 extra por mutantes | 5 / +95 |
| `92fe410` → `29fb873` | 23:07 → 23:47 | F7 test rojo → código | 5 / +515 · 10 / +720 |
| `56063d8`, `6de0dff` | 23:49, 23:57 | docs de cierre + prompt para Opus | — |

`HEAD` = `origin/master` = `6de0dff`. El árbol de trabajo tiene un cambio sin commitear: `test/motor.spec.mjs` (ver C1).

### 1.2 Cómo se siguió el proceso (tests → congelado → código)
- **El congelado de F1–F5 (y de las herramientas) está en el commit del código, no en el del test rojo.**
  Comprobado con `git show <rojo>:test/FROZEN.json`: en los commits rojos de tools, F1, F2, F3, api-lab y F4, el
  test **no** figura en `FROZEN.json`. Sí figura en los de F6 y F7. El README (§3) y la spec/00 §4 piden "commit
  propio de los tests + huella". En la práctica, la huella se registró después de escribir el código, y entre el
  rojo y el congelado se editaron 7 tests. Fable lo documentó en cada mensaje de commit ("correcciones antes de
  congelar"). Las he leído todas (`git diff <rojo> <verde> -- test/...`):
  | test | cambio antes de congelar | ¿justificado? |
  |---|---|---|
  | red.spec | `keyDim` 3 → 4 | sí: la spec pide `keyDim` ∈ 4..128 |
  | percepcion.spec | aliado alejado para que no esté a < 1 u de un destino | sí: fallo de la escena |
  | politica.spec | atribución de 3 → 4 ojos; `chooseMove` puede devolver `{stay:true}` | sí: es la spec/03 §9.4 |
  | api-lab.spec | catálogo de 24 → 26 bloques | sí: la spec/02 §4 tiene 26 |
  | tools.spec | selección del mutante por columna | sí |
  | aprendizaje.spec | **se quita el control "BPTT truncada → falla"**, el crédito del bit va solo a la respuesta, umbral > 90 % en 4 000 episodios | a medias: el motivo ("el control no era válido") es plausible, porque con pesos aleatorios la GRU guarda el bit sin BPTT. Pero **la spec/04 §8.2 sigue pidiendo** "> 95 % en 3 000" y "truncado a 2 → falla". La spec y el test no dicen lo mismo |
  | motor.spec | semilla 1 + `chaos` para que empiece el humano | sí, pero **no se commiteó** (C1) |
- **Ritmo.** De test rojo a código: F6 en 20 min y F7 en 40 min. Los fallos de §3 se concentran justo en F6 y F7.

### 1.3 Fase por fase: qué prometía la spec y qué hay
| fase | prometido | hay | falta o está mal |
|---|---|---|---|
| F1 motor | movimiento 2 u con deslizamiento, `move` en fire/API, semilla en todo, partidas sin pantalla, ángulo y'' | todo, con 5 specs | **C2** (el tirador muere en el fuego amigo y el turno no se cierra). La animación x10 se divide dos veces entre la velocidad (§3.3) |
| F2 red | genoma, 26 bloques, validación, forward/backward con BPTT, plantillas | todo; gradientes comprobados | `whatif` "sin red" (spec/08 §8), **A5**. Plantillas = clones (**A6**) |
| F3 percepción | 8 ojos, Imaginación, destinos, decisión, `net:<id>`, SSE `decision` | todo | `reason` siempre vacío; margen negativo (§3.3) |
| F4 aprendizaje | recompensa, REINFORCE+BPTT, **evolución**, **ambos**, x1/x10/turbo, sueño, exhibición con interruptor | gradiente, turbo, x1/x10, sueño, hitos | **C3** (evolución/ambos sin conectar), **A2** (interruptor sin efecto), x1/x10 se cuelgan por C2, `POST /rooms {speed}` ignorado, `curves` no existe |
| F5 evolución | mutación siempre válida, hijos + pre-torneo, diff, cirugía, import/export | todo | `mutation: []` en el catálogo; el 413 no llega al cliente (§3.3) |
| F6 trono | duelo 3×2, trono, sala de la fama, liga, dinastías, genealogía | todo | **C5**, **C6**; la sala del duelo en curso no se expone; duelos y entrenos solo en memoria (§3.3) |
| F7 verdad | registro, checkPhrase/compose, confianza, emoción, memoria, neuronas, boletín, lección, diario, cronista, moviola, bofetada | todo existe | **C4**, **A1**, **A3**, **A4**; el diario no incluye los retos; moviola aproximada (§3.3) |

---

## 2. Batería

### 2.1 Resultado
- **Árbol de trabajo actual** (con el `motor.spec.mjs` sin commitear): `node tools/freeze.mjs --check` →
  `🔒 29 test(s) congelado(s): huellas OK` (salida 0). `node test/run-all.mjs` → **TODO OK ✔**: 29 suites, 290
  comprobaciones `✓`, `real 3m24.313s`, salida 0. El log completo está en el **Apéndice A**.
- **Clon limpio de `HEAD` = `origin/master`** (`git worktree add --detach <tmp> HEAD`):
  ```
  $ node tools/freeze.mjs --check
  ✘ huella distinta: test/motor.spec.mjs (congelada 92901c90c308…, actual eef212c266c6…)
  $ node test/run-all.mjs
  ✘ huella distinta: test/motor.spec.mjs (congelada 92901c90c308…, actual eef212c266c6…)
  FAIL ✘ (tests congelados modificados: OK del usuario + motivo escrito + tools/freeze.mjs)   [salida 1]
  ```
  **C1.** Cualquiera que clone el repo tiene la batería en rojo. `FROZEN.json` guarda desde `328d9e3` la huella
  de la versión corregida del test, pero esa versión solo existe en este disco. Para arreglarlo basta con
  commitear el `motor.spec.mjs` que ya está en el árbol (es el que la huella espera y el que describe el mensaje
  de `328d9e3`). Como es un test congelado, **necesita tu OK** (§7).

---

## 3. Prueba en vivo

### 3.1 Cobertura (204 peticiones; tiempos máximos observados)
| ruta | estados vistos | tiempo máx. | veredicto |
|---|---|---|---|
| GET /api/health, /api/agents | 200 | 27 ms | ok; las redes salen como `net:<id>` con su descripción |
| GET /api/lab/catalog | 200 | 6 ms | 26 bloques con `level`, `explain` y `example`; 10 layouts de ojos; **`mutation: []`** |
| GET /api/lab/templates | 200 | 13 ms | 4 plantillas con `why` |
| POST /api/lab/nets (plantilla, nombre, repetido, desconocida) | 201, 400 | 43 ms | ids correctos (`hydra`, `hydra-2`, `nandu-elite`); **A6** |
| GET / PUT / DELETE /nets/:id | 200, 400, 404 | 16 ms | ok; **se puede borrar a la reina (C5)** |
| POST /nets/:id/validate (ciclo, mezcla, NaN, campo desconocido, units, cable roto, forma, JSON roto, sin pesos, sin Elegir) | 200, 400 | 22 ms | mensajes en español con `example`; "sin Elegir" da `ok:true` sin avisar de que no puede jugar; el ciclo cita bloques que no están en el ciclo |
| POST /nets/import (409, `?rename=1`, ciclo, 49 MB) | 201, 400, 409, — | 108 ms | export → import → export idéntico; **49 MB: se corta la conexión sin 413** |
| GET /nets/:id/export | 200 | 7 ms | con `Content-Disposition` |
| POST /nets/:id/whatif · GET /nets/:id/curves · GET /api/lab/games?netId | **404 "Ruta desconocida"** | — | **A5** |
| POST /api/rooms + addagent `net:<id>` + start + state + SSE | 200, 201 | 5 ms | `decision` llega antes de `shot`; `lastDecision`; `players[].netId`; **`speed:10` ignorado** |
| POST/GET /api/lab/trainings (turbo 1/4/8 hilos, x10, pause, resume, stop, 409, 404, 400) | 202, 200, 400, 404, 409 | 238 ms | turbo 24 partidas en 10,4 s; **x10 colgado por C2**; `stop` lo rescata; `soldiers: 9` aceptado sin error |
| SSE /api/lab/events | — | — | `hello, training, curve, sleep, lesson, milestone, job, children, duel, throne, dynasty, exam, error` vistos; `lesson` sin `logId` |
| GET /api/lab/games/:id · /turns/:n/brain | 200, 400, 404 | 72 ms | 2 MB por partida; brain `approx:true` (la red actual); sin `?player=` coge la decisión equivocada |
| POST /nets/:id/slap · /caress · GET /feedback · /memory | 200, 400, 404 | 51 ms | se aceptan sobre decisiones de otra red; **nunca se consumen (A1)** |
| POST /nets/:id/children → GET /jobs/:id + SSE job/children | 202, 200 | 21 ms | 4 hijos + 16 partidas en 2 s; `opsText` exacto |
| GET /nets/:id/diff/:otherId | 200, 404 | 12 ms | same/changed/added/removed, `heat` ≤ 64, cables; en ambos sentidos |
| PUT /frozen · PUT /weights/:blockId · POST /transplant | 200, 400, 404 | 22 ms | validación correcta; trasplantar sobre un bloque congelado se permite sin aviso |
| POST/GET /api/lab/duels (turbo, x10, validaciones) | 202, 200, 400, 404 | 21 ms | turbo 6 partidas en 1,16 s; x10 6 partidas en ~9 s; `roomCodes` vacío al empezar |
| GET /throne · POST /throne/challenge · /hall-of-fame · /genealogy | 200, 202, 400 | 27 ms | sentar, reto ganado con copia congelada, auto-reto 400; **C5** |
| POST/GET /dynasties · /generation · /:house/challenge-throne | 200, 202, 400, 404 | 8 ms | una generación en 7 s; **C6** |
| POST/GET /nets/:id/bulletin | 202, 200, 404 | 122 ms | 92 escenas en 1,3–2,4 s; **A4** |
| GET /nets/:id/diary · /api/lab/chronicle | 200 | 9 ms | frases con refs; faltan los retos; ids en vez de nombres |
| GET/PUT /nets/:id/neurons | 200, 400, 404 | **853 ms** | nombres con `corr` y `m`; renombrar funciona; lento (lee partidas de 2 MB) |
| GET /api/lab/log · /log/:id | 200, 404 | 5 ms | ok |
| Humano por REST (AGENTS.md): join, addbot, start, move antes de tiempo, fire ode2, fire en etapa move, move recortado, chat, rooms, rematch | 200, 404 | 22 ms | se comporta como está documentado |

### 3.2 Hallazgos críticos y altos, con reproducción exacta

#### C1 — `origin/master` no pasa su propia batería
```
git clone https://github.com/DasikuHp/rlwar.git && cd rlwar && node tools/freeze.mjs --check
✘ huella distinta: test/motor.spec.mjs (congelada 92901c90c308…, actual eef212c266c6…)
```
La corrección está en el árbol de trabajo de `E:\grafwar` (`git diff test/motor.spec.mjs`: 8 líneas, con la
semilla 1 y `chaos` en dos escenas).

#### C2 — Fuego amigo: el tirador muere y el turno no termina nunca
- Código: en `server/rooms.js:391-395` la rama `suicide` hace `soldier.alive = false` (el tirador; esto viene del
  commit base) y, desde F4, también mata al aliado. Después, `fire()` llama a `move()` del tirador muerto, que
  devuelve `{error:'Ese soldado ya está muerto'}` **sin llamar a `finishTurn()`**. El turno se queda en
  `stage:'move'`, y para bots no hay temporizador que lo cierre.
- Contrato: la spec/01 §2.4 dice "si el tiro fue suicide (mató a un aliado) el tirador sigue vivo y se mueve
  igual". Es también lo que hace el original (`referencia/graphwar/src/Graphwar/Function.java:255-280`: el que
  dispara se salta y solo mueren los alcanzados).
- **Sala viva** (confirmado): el entreno `t3` (x10) colgado. Sala `X34G` a las 22:17:21, dos minutos después del
  último disparo:
  ```
  GET /api/rooms/X34G/state → phase "playing", turn {stage:"move", deadline ya vencido},
  lastShot.result {type:"suicide"}, soldados s193 (aliado) y s194 (tirador) muertos
  ```
  Solo `POST /api/lab/trainings/t3/stop` lo desbloquea, y entonces la partida truncada cuenta como partida y se
  aprende de ella. Lo mismo pasaría en los duelos x1/x10 y en un reto al trono en vivo.
- **Sin pantalla** (confirmado): `step()` no hace nada mientras `stage === 'move'`, así que `play()` gasta sus
  400 vueltas y llama a `gameOver(true)`. La partida acaba en el disparo del fuego amigo.
  ```bash
  cd E:/grafwar && node --input-type=module -e "
  import { playGame } from './server/headless.js';
  import { TEMPLATES } from './shared/templates.js';
  const g = TEMPLATES.sniper.genome; let ff = 0, stalled = 0, ex = null;
  for (let seed = 1; seed <= 40; seed++) {
    const r = playGame({ seed, left: { type: 'net', genome: { ...g, id: 'a-net', name: 'A' } }, right: { type: 'net', genome: { ...g, id: 'b-net', name: 'B' } }, soldiers: 4 });
    const i = r.events.findIndex((e) => e.type === 'friendlyFire'); if (i < 0) continue; ff++;
    const after = r.events.slice(i + 1).filter((e) => e.type === 'shot').length;
    if (after === 0) { stalled++; ex ||= { seed, shooterAlive: r.room.soldiers.find((s) => s.id === r.events[i].actor.soldierId).alive, byLimit: r.result.byLimit, last: r.events.slice(-4).map((e) => e.type) }; }
  }
  console.log({ games: 40, withFriendlyFire: ff, stalledAfterFriendlyFire: stalled }, ex);"
  ```
  Salida: `{ games: 40, withFriendlyFire: 24, stalledAfterFriendlyFire: 24 }` y
  `{"seed":1,"shooterAlive":false,"byLimit":true,"last":["friendlyFire","death","lose","win"]}`.
- Efecto visible en un duelo real (`d1`, hydra contra vidente, turbo): `k2 hydra|vidente → gana hydra con kills
  {hydra:0, vidente:1}` y `k3 → gana vidente con 0-0`. El marcador lo decide el fallo, no el juego.
- Por qué no lo cazó la batería: ningún test juega partidas con fuego amigo y 2–4 soldados hasta el final, ni
  comprueba la regla del tirador vivo.

#### C3 — "Cómo aprende" (evolución / ambos) no está conectado
`grep -rn "\.method" evo/ shared/ agents/ server/` solo encuentra el catálogo. `createTrainer`, `runDuel` y
`makeLearner` usan siempre `learnFromGames`, que es el gradiente. `evolutionStep` solo lo usan los tests
unitarios (`aprendizaje.spec.mjs:275`, `entrenador-extra.spec.mjs:56`). Una red con `learning.method =
"evolution"` entrena exactamente igual que con `"gradient"`. Esto va contra la ✅ ronda 1 ("lo eliges por red") y
la spec/04 §4.

#### C4 — Emociones de otras partidas en las partidas de muestra
- Código: `evo/train.js:389-393` filtra `r.emotions` (todas las del lote) por `decisionEventId`, pero los ids de
  evento empiezan en 1 en cada partida, así que se cuelan emociones de otras partidas con el mismo número.
- Reproducción: crear una red desde la plantilla `seer`, entrenarla en turbo (`{"netId":"hydra","speed":"turbo",
  "workers":1,"duration":{"games":24},"seed":5}`) y abrir la primera partida de muestra:
  ```bash
  curl -s localhost:8795/api/lab/games/g-5-PU5U | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const by={}; for (const e of j.events.filter(e=>e.type==='emotion')) (by[e.data.decisionEventId] ||= []).push(e.data.advantage.toFixed(3));
  console.log(Object.entries(by).filter(([,v])=>v.length>1).slice(0,3))"
  ```
  Salida: `[["6",["2.851","3.446","0.675"]],["8",["2.822","0.687"]],["18",["2.364","0.468","1.743"]]]`. Hay 45
  emociones para 30 decisiones, y 12 decisiones tienen varias. Las recompensas sí salen bien (30 para 30), porque
  se calculan por partida.

#### C5 — Borrar a la reina bloquea el trono
```
DELETE /api/lab/nets/vidente                    → 200 {"ok":true}        (spec/08 §4: 409 salvo ?force=1)
GET  /api/lab/throne                            → queen "vidente", queenName null
POST /api/lab/throne/challenge {"challenger":"hydra","speed":"turbo","seed":2} → 202 {"duelId":"d5"}
GET  /api/lab/duels/d5                          → status "error", games []
SSE error                                       → "duelo d5: Cannot read properties of null (reading 'name')"
GET  /api/lab/throne                            → challenges[c3] result "queen"; reigns vidente defenses 3 (una de ellas es este duelo vacío)
```
Hay dos fallos: se puede borrar a la reina, y un duelo con error se cuenta como defensa
(`throne.js:69`: `result = rec.tie ? 'tie' : rec.winner === challenger ? 'challenger' : 'queen'`). Con la reina
borrada, nadie puede destronarla. Solo reimportando una red con el mismo id vuelve a funcionar.

#### C6 — Ids de duelo repetidos entre `/api/lab/duels` y las dinastías
`runGeneration` llama a `runDuel` directamente (`throne.js:159`, `:170`). Ese `runDuel` tiene su propio contador
(`duel.js:91`), distinto del de `evo/api.js:68`, así que los duelos de la generación se llamaron `d1`, `d2` y `d3`.
Salida real:
```
GET /api/lab/dynasties → history[0].duelId "d3"      (duelo entre casas hydra contra nandu-elite)
GET /api/lab/duels/d3  → {"a":"vidente","b":"hydra","throne":true}   (es otro duelo: el reto al trono c1)
evo/games/*.json con meta.duelId "d3": 6 partidas del reto al trono + 6 del duelo entre casas
```
Además, esos duelos no emiten SSE `duel` (no pasan por `startDuel`), así que la vista de la generación no puede
seguirlos en vivo. Y como los contadores y los mapas de duelos y entrenos viven en memoria, después de reiniciar
el servidor los ids vuelven a empezar y chocan con los guardados en `evo/games` y `evo/log.jsonl`.

#### A1 — La bofetada y la caricia no enseñan nada en los entrenos
El feedback solo se consume en `record()` o `learn()` de una partida que **se está jugando en ese momento**
(`train.js:435`, `:264`, `takeFeedback` por `gameId`). Pero solo se puede abofetear una partida ya guardada, y los
ids de partida no se repiten (`g-<semilla>-<código>`). Reproducción: 3 feedbacks pendientes en `g-5-PU5U`,
entrenar `hydra` otra vez con la misma semilla (`t14`, 8 partidas) y `GET /nets/hydra/feedback` → siguen los
mismos 3. El único caso en que llegaría es un duelo `frozen` en vivo abofeteado entre partidas. Tampoco hay
"respuesta inmediata en la memoria": `slap` no toca `genome.memory`. Además, la API acepta abofetear con
`/nets/tortuga/slap` una decisión de una partida donde `tortuga` no jugó.

#### A2 — La exhibición con `learn:true` no aprende ni cuenta
Sala `4BUX`: la red `vacia` con `{"type":"net","netId":"vacia","learn":true}` contra Greedy, partida terminada.
Antes y después: `stats {"games":6,…}` y los mismos pesos. La sala guarda `learn` y nadie lo lee. La spec/04 §7
dice que cuenta en `stats.games` y que el interruptor activa el aprendizaje.

#### A3 — No hay voz verificada
`agents/net.js:55` devuelve `reason: ''` siempre. `rooms.js` no emite `say` ni llama a `checkPhrase`, y el chat
no lleva `refs`, `confidence`, `level` ni `emotion` (spec/08 §3, spec/07 §12.1). `sayProbability` se calcula y no
se usa. Lo que sí sale en los bocadillos es el `banter` fijo de `agents/net.js:11`: "Calculando.", "Previsto.",
"Lo vi venir, {victim}.", "Un candidato menos que imaginar.", sin refs y dicho por redes novatas con confianza 0.
"Lo vi venir" afirma algo que los datos no respaldan.

#### A4 — El boletín mide mal
- Puntería: el DUMMY dispara `expr: '1000'` en modo `function` (`exam.js:7`). En Graphwar la constante no cuenta
  ("y = 2x + 3 y y = 2x dan la misma gráfica", `referencia/graphwar/readme.md`), así que es una recta horizontal a
  la altura del blanco:
  ```
  escenas 40, elBlancoDisparaPrimero 18, elBlancoMataAlExaminado 2 (semillas 9011 y 9024)
  ```
  El tope real de "puntería" es 38/40 para cualquier red. En "cobertura", 2 de 30 escenas terminan sin movimiento
  por la misma causa (`coverNoMove: 2`).
- Adaptación: `n = 1 + (i % 4)` y el lado `i % 2` hacen que 1 y 3 soldados se jueguen siempre a la izquierda y 2 y
  4 siempre a la derecha. Tamaño y lado van juntos. Además, 3 partidas por tamaño dan una métrica que solo toma los
  valores 0, ⅓, ⅔ y 1. Una red que pierde todo saca adaptación 1,0, y en la prueba `vacia`, `vidente` y `hydra-2`
  (casi todo derrotas: `byN {1: 0.33, 2: 0, 3: 0, 4: 0}`) sacan **0,667**. El radar premiaría perder por igual.

#### A5 — Rutas y campos del contrato que faltan
`POST /api/lab/nets/:id/whatif`, `GET /api/lab/nets/:id/curves` y `GET /api/lab/games?netId&duelId&trainingId&limit`
dan 404. `POST /api/rooms {speed:10}` crea una sala con `config.speed 1` (`server.js:54` no pasa `speed`). El
catálogo devuelve `mutation: []` (spec/08 §1 pide la lista con nombre y explicación de cada operación).

#### A6 — Las plantillas producen clones
`POST /nets {template:"sniper"}` cinco veces → cinco redes con `emblem 770875181`, y
`JSON.stringify(orca-and.weights) === JSON.stringify(TEMPLATES.sniper.genome.weights)` → `true`. Dos "Videntes"
recién creadas juegan igual y se dibujan igual. Esto choca con la ✅ ronda 3 ("emblema único generado de su
genoma") y con el espíritu antagonista.

### 3.3 Hallazgos medios y bajos
| # | hallazgo | dato |
|---|---|---|
| M1 | **Margen negativo**: `margin = p[elegido] − max p[otros]` es negativo cuando el muestreo no coge al favorito, así que la certeza queda en 0 y la red sale "novata" por mucha experiencia que tenga. La spec/07 §4 dice "∈ [0,1]" | sala `KEPT`: `margin -0.0248` y `-0.0238`, `certainty 0` |
| M2 | Moviola aproximada: en partidas que no son de trono se recalcula con la red **actual** (`approx:true`); los valores reales ya no cuadran | turno 1 de `g-5-PU5U`: `decision.value -0.709`, `outputs.value 0.200` |
| M3 | Moviola: sin `?player=` coge la primera decisión del turno. La decisión `move` del tirador anterior lleva el número de turno siguiente (el contador sube antes de mover) | `/turns/1/brain` → 404; con `?player=p7` → 200 |
| M4 | El diario no incluye los retos: la entrada `challenge` del log no lleva `netId` | el diario de `vidente` no tiene "Reto de vidente a hydra: ganó la retadora" |
| M5 | El cronista usa ids y palabras en inglés: "Casa B: promote" (aunque no hubo promoción), "Casa A: duel", "nandu-elite" en vez de "Ñandú Élite". El log no guarda nombres, así que ninguna frase verificable puede usar el nombre humano | `GET /api/lab/chronicle` |
| M6 | Las neuronas de memoria se nombran con una pasada desde el estado cero, no con el estado real de la partida | `truth.js:243` |
| M7 | La animación x10 se divide dos veces entre la velocidad (`rooms.js:417`): un disparo cada ~0,4 s y animaciones de 70–900 ms. El cliente actual no conoce `speed` | SSE de la sala `LVXY` |
| M8 | La sala en vivo del duelo en curso no se expone: `POST /duels` devuelve `roomCodes: []` y el código solo aparece al acabar cada partida | `d2`: a los 3 s `roomCodes` tenía solo las ya terminadas |
| M9 | Duelos, entrenos y trabajos solo existen en memoria; al reiniciar, `GET /duels/:id` de un reto histórico da 404 | `evo/api.js:24-27, 67` |
| M10 | El pedido de 49 MB corta la conexión (curl sale con 56) en vez de responder 413. La batería solo prueba 2 MB | `readText` hace `req.destroy()` antes de responder |
| M11 | La liga solo cuenta los duelos de trono y de dinastía; los de `POST /duels` no alimentan `f_hard` ni las partidas fantasma | tras `d1` y `d3`, `league.pairs` tiene 6 resultados |
| M12 | Con hilos apenas se gana: el paralelismo se limita a `batchGames` (4). En turbo, 16 partidas: 1 hilo 1,57 s, 4 hilos 1,45 s, 8 hilos 1,44 s | `t5`, `t6`, `t7` |
| M13 | La bombilla casi nunca se enciende con los valores por defecto: `relChange` de 1–2 % frente al umbral de 5 % | 40 sueños, 0 bombillas |
| M14 | `shared/` no se puede cargar en el navegador: `constants.js:3` usa `process.env` y `policy.js:3` importa `node:perf_hooks`. La spec/00 §1 y el plan2 §4.9 dicen que sí | afecta a `compose`/`checkPhrase` en la interfaz (§5) |
| M15 | Cada partida guardada pesa ~2 MB (con las `obs`); con 200 por red, hasta ~400 MB por red. `listGames` las parsea enteras solo para leer `meta` | `GET /neurons` 0,85 s con pocas partidas |
| B1 | `validate` no avisa de que una red sin Elegir no puede jugar; el error `cycle` cita bloques que no están en el ciclo; los errores de `/weights` no llevan `example` | §3.1 |
| B2 | `soldiers: 9` en un entreno se acepta y se juega con 4 | `t2` |
| B3 | `hallOfFame[].snapshot` guarda una ruta absoluta de Windows; si mueves la carpeta, la copia se ignora en silencio al entrenar | `/hall-of-fame` |
| B4 | CORS solo permite `GET,POST,OPTIONS` (sin `PUT` ni `DELETE`); no afecta a la interfaz del mismo origen | `server.js:21` |
| B5 | Una vez, en el primer entreno con 4 hilos (`t4`), 16 partidas tardaron **100,9 s**; repetido dos veces después, 2,5 s. **No lo he reproducido**; lo anoto por honestidad | `t4` |

---

## 4. Decisiones ✅ de `plan2.md` sin cubrir o cubiertas a medias
| ronda | decisión ✅ | estado |
|---|---|---|
| 1 | "Cómo aprende: lo eliges por red (gradiente, evolución o ambos)" | ✗ **C3** |
| 1 | "Duelo 3×2, soldados 1–4 variables" | ✓, pero los resultados están contaminados por **C2** |
| 2 | "Mutación: cada tipo con interruptor e intensidad; cada hijo cuenta qué cambió" | ✓ en la API; el catálogo no explica las operaciones (`mutation: []`) |
| 2 | "Eliges un hijo, lo retocas y reta a la reina en vivo" | ✓ existe; en vivo se cuelga con **C2** |
| 3 | "Emblema único generado de su genoma" | ✗ **A6** |
| 3 | "Curvas (reinados + aprendizaje)" | a medias: solo la curva del entreno en memoria; no hay `/curves` ni historia de reinados en series |
| 3 | "Las redes van ganando confianza y hablando más con el tiempo" | ✗ **A3** (y **M1**) |
| 4 | "Réplica al rival con hechos reales" | ✗ **A3** |
| 4 | "Entreno visible x1/x10/turbo" | ✓ turbo; x1/x10 se cuelgan (**C2**); `POST /rooms {speed}` ignorado |
| 4 | "Laboratorio ¿qué pasaría si…?" | ✗ **A5** (`whatif`) |
| 5 | "Dos dinastías que coevolucionan" | ✓, con **C6** |
| 5 | "Boletín de habilidades" | ✓ existe; **A4** |
| 5 | "Moviola con cerebro" | ✓ exacta en trono, aproximada en el resto (**M2**) |
| 7 | "Hitos anti-olvido (tasa de victoria o examen)" | a medias: solo por tasa de victoria; el examen no crea hitos |
| 7 | "Bofetada/caricia" | ✗ **A1** |
| 7 | "Emociones calculadas del RL" | ✓ fórmula; registro contaminado (**C4**) |
| 7 | "Sueño + bombilla + lección" | ✓, bombilla casi nunca (**M13**) |
| 8 | "Interruptor 'aprender de esta partida'" | ✗ **A2** |
| 8 | "Ver un duelo eligiendo la velocidad; en turbo cualquier partida se abre en la moviola" | ✓ turbo; x1/x10 sin la sala en curso (**M8**) y colgables (**C2**) |
| 9 | "Diario y cronista" | ✓, con **M4** y **M5** |
| 9 | "Pesos a mano y congelar cables" | a medias: se congela por bloque, no por cable (la spec eligió bloques) |
| 9 | "Exacto y real: cada frase con refs" | a medias: diario y cronista sí; el banter de las redes no (**A3**) |
| 4 (🧭) | "Rival de entreno: nunca heurísticos" | `opponents.antagonistId: "sniper"` se acepta y entrena contra un heurístico (`train.js:358`). Es más opción; lo anoto |

---

## 5. Huecos de la API que afectan a cada vista de la parte 2 (para pedírselos a Fable)
| vista | qué me falta | petición concreta |
|---|---|---|
| todas | cargar `truth.compose`/`checkPhrase` en el navegador (el prompt exige usarlos) | que `shared/constants.js` y `shared/policy.js` puedan cargarse en el navegador (**M14**), o una ruta que componga y verifique en el servidor (ver §7) |
| Laboratorio | emblemas distintos | emblema (y pesos) nuevos al crear desde plantilla (**A6**) |
| Editor | "¿qué pasaría si…?" | `POST /nets/:id/whatif` (spec/08 §4) |
| Editor | marcar el bloque culpable | que `cycle` cite solo los bloques del ciclo; `example` en los errores de `/weights`; `forPlay` o `playable` en `/validate` |
| Sala viva | bocadillos con voz y confianza | que la sala emita `say` con `refs` (spec/07 §12.1) y un gancho para frases de la interfaz; o decidir que las compone la interfaz con los eventos de la sala (necesita los ids de evento: hoy la sala no los expone por SSE salvo `decision.eventId`) |
| Sala viva / x10 | animación coherente | arreglar la doble división (**M7**) y confirmar la velocidad de animación que debe usar el cliente |
| Entreno | curvas que sobreviven a reiniciar | `GET /nets/:id/curves` (spec/08 §4) |
| Entreno | lección verificable | `logId` en los SSE `lesson` y `sleep` (para `compose` con `ref`) |
| Hijos | controles de mutación explicados | `catalog.mutation` con `name`, `explain`, `example`, `level` y rangos |
| Duelos | espectar el duelo en curso | código de sala de la partida en marcha (SSE `duel {id, roomCode}` al empezar cada partida) |
| Duelos / trono / moviola | encontrar partidas | `GET /api/lab/games?netId&duelId&trainingId&limit` (spec/08 §5); duelos persistidos o reconstruibles desde `evo/games` (**M9**) |
| Dinastías | ver la carrera en vivo | que los duelos de la generación pasen por `startDuel` (ids únicos y SSE) (**C6**) |
| Verdad | frases con nombres humanos | nombres (`challengerName`, `queenName`, `houseName`) en las entradas del log (**M5**); `netId` del retador en `challenge` (**M4**) |
| Verdad | moviola exacta | guardar el genoma de la época en las partidas de muestra, o avisarlo siempre (**M2**) |
| Verdad | bofetada con efecto | que la bofetada entre en el aprendizaje de verdad (**A1**) y deje huella en la memoria |

---

## 6. Mutantes (`spec/mutantes.md`)
- **F1–F2: me convencen.** Los supervivientes de geometry, rng y nn son equivalentes bien argumentados (`<=` en
  typed arrays, invariancia del softmax), y los huecos reales se cubrieron con specs extra. Una excepción: en
  `rooms.js` (202/486) la justificación dice "nada de ello cambia una regla del juego", y **C2** demuestra que la
  regla del tirador vivo en el fuego amigo no tiene ningún test. La frase es demasiado amplia.
- **`agents/lib.js` (77/353): a medias.** "Los heurísticos son sparring, sin contrato" deja de ser verdad desde
  F7: el boletín usa Sniper L3 y Greedy L3 como vara de medir. Cambiar una constante de un heurístico cambia el
  boletín de todas las redes.
- **F3–F4: razonables, pero con muestras.** `policy.js` 120/120 es una muestra de 120 de 194; `percept.js` 151/200
  de 1 272. En `train.js` quedan 21 supervivientes de 60 con la nota "se vuelve a tirar al cerrar F6", y **no consta
  que se volviera a tirar**. Tampoco cazaría **C3**: ningún test comprueba que `method` cambie el aprendizaje.
- **F5–F7: no están cerradas.** `mutate` 28/40 (muestra del 6,5 %), `diff` 7/20, `children` "en curso", `duel`
  14/30, `league` 13/30, `throne` 8/30, `truth`/`exam` sin documentar. Varias "justificaciones" son en realidad
  huecos ("el test solo exige que termine y actualice history", "el test no abre salas x1/x10"). Los fallos
  **C4**, **C5**, **C6** y **A4** están justo en esos ficheros. Que `throne.js` saque 8/30 y yo encontrara ahí
  dos fallos de integridad no es casualidad.

---

## 7. Preguntas para el usuario antes de la parte 2
1. **C1**: ¿commiteo el `test/motor.spec.mjs` que ya está en el árbol de trabajo (es el que `FROZEN.json` espera)?
   Es un test congelado, así que no lo toco sin tu OK.
2. **Orden de la parte 2**: la ✅ ronda 10 dice que la interfaz no se construye sobre piezas que aún pueden cambiar.
   C2–C6 y A1–A6 obligan a Fable a tocar el motor, el entrenador, el trono, las dinastías y la verdad. ¿Empiezo
   solo por lo que no depende de eso?
3. **Frases en el navegador**: `truth.compose`/`checkPhrase` no se pueden cargar en el navegador tal como están
   (**M14**). ¿Cómo lo resolvemos?
4. **Emblemas y plantillas** (**A6**): ¿se lo pide a Fable o lo compenso en la interfaz?

---

## 8. Estado tras los arreglos (misma sesión, 2026-09-23)
Decisiones del usuario: "arréglalo tú" (los fallos críticos y altos), dejar las plantillas como están (A6), bofetada
inmediata, adaptación equilibrada que penaliza perder, evolución = concurso tras el duelo y la red real en vivo a
x1/x10, frases verificadas en el navegador sin chapuzas. Proceso de cada arreglo: spec → test en rojo congelado en su
propio commit → código → batería completa en verde → commit. Hay 8 specs nuevos `test/arreglos-*.spec.mjs` en la
batería, que ahora tiene 38 suites y está en verde.

| hallazgo | estado | commit |
|---|---|---|
| C1 motor.spec sin commitear | arreglado | `9dd90d4` |
| C2 fuego amigo / turno abierto | arreglado (spec/01 §9) | `fc03781` |
| C3 método de aprendizaje | arreglado: evolución y ambos en entrenos, duelos y exhibiciones (spec/04 §10.2) | `5cbf8f7` |
| C4 emociones cruzadas + **C4b nuevo**: ids de soldado repetidos entre hilos que fundían episodios (4 hilos ≠ 1 hilo) | arreglado (spec/04 §10.1) | `f98e800` |
| C5 borrar la reina / reto fallido | arreglado (spec/06 §7.1) | `bb8d39b` |
| C6 ids de duelo | arreglado (spec/06 §7.2) | `bb8d39b` |
| A1 bofetada/caricia | arreglado: efecto inmediato + recuerdo; cola si entrena (spec/04 §10.4) | `0bab49e` |
| A2 exhibiciones | arreglado (spec/04 §10.3) | `aea1299` |
| A3 voz verificada | arreglado: `evo/voice.js` + `sayVerified` (spec/07 §13.2) | `226addd` |
| A4 boletín | arreglado (spec/07 §13.1) | `ed4342a` |
| A5 rutas que faltaban | arreglado: whatif, curves, lista de partidas, catálogo de mutaciones, `POST /rooms {speed}` (spec/08 §9.1) | `acbe00a`, `fc03781` |
| A6 plantillas clonadas | **se queda así** (decisión del usuario) | — |
| M14 `shared/` en el navegador | arreglado (spec/08 §9.3) | `acbe00a` |
| **M16 nuevo**: `pruneGames` nunca se llamaba (disco sin límite) | arreglado con `saveGameKept` (spec/08 §9.2) | `acbe00a` |
| **nuevo**: a un bot no se le pedía `chooseMove` si el disparo no venía de su turno automático | arreglado (spec/01 §2.2) | `fc03781` |
| M1–M13, M15, B1–B5 | **pendientes**: no se pidieron en esta ronda | — |

Tests congelados que cambiaron, todos con OK del usuario y el motivo en su commit: `motor.spec` (commit de la
versión ya congelada), `api-verdad.spec` (bofetada inmediata), y dos míos (`arreglos-motor`: salida con
`process.exitCode` por un aborto de Node 24 en Windows; `arreglos-api`: comparación por contenido y retención en
`saveGameKept`).

**Aún falta**: la parte 2 (interfaz) no está empezada; los mutantes de A1, A2, A3, C5 y C6 están sin pasar (§6 de
`mutantes.md`); y hay que escribir `arreglos-metodo-extra` para los huecos de mutantes de C3 (semillas exactas,
`perBlock` del paso de evolución, rival con `learn:false`).

## 9. Revisión de Fable (Opus 5.5, 2026-09-23)
Revisión de §8 con el contrato de `spec/README.md` §3. Decisiones del usuario: R2 = "red ocupada", R4 = "contra sí
misma", A6 no se toca. Arreglo en `e0d87f4` (tests congelados antes: `13a74ad`, `838e56c`, `5d5c000`).

| # | gravedad | qué pasaba | sonda (salida literal) | estado |
|---|---|---|---|---|
| R1 | alto | El paso de evolución bloqueaba el servidor: `evolutionRound` lanzaba todas las partidas con `Promise.all` y todas las cesiones (`setImmediate`) caían en la misma vuelta del bucle | exhibición `learn:true`, población 32 × 8 partidas, 3 soldados, `GW_FAST`, `/api/health` cada 50 ms: "las 3 más lentas (ms): 16410 (a los 9920 ms), 25, 7" | arreglado: una partida detrás de otra, cediendo antes de cada una (spec/04 §10.5) |
| R2 | alto | Lo que se hacía a una red en un duelo se perdía. La bofetada respondía `applied:true` (pBefore 0.0356 → pAfter 0.0338), pero el `save()` del duelo escribía los pesos cargados al empezar (`save()` solo conserva name/names/frozen) | red de evolución (lr 1e-5, σ 1e-4) en un duelo turbo contra otra red, bofetada a los 300 ms: "\|tras bofetada − antes\| = 0.00e+0 \| \|final − tras bofetada\| = 1.70e-5 \| \|final − antes\| = 1.70e-5" y "feedback applied: 1": la bofetada (3e-3) desapareció | arreglado: red ocupada (409 con el motivo; cola que se aplica al soltarla si nadie más la tiene) |
| R3 | doc | `newDuelId` añade el pid (`d<ms36><pid36>-<n>`) y la spec no lo decía | — | spec/06 §7.2 corregida |
| R4 | bajo | En una exhibición contra una persona, el paso de evolución jugaba contra el agente por defecto (el *fallback* de `createAgent`) | — | arreglado: contra la propia red tal como acabó la partida (`rival: 'self'`) |
| R5 | bajo | Los eventos de voz cuentan para `eventsPerGame` (5000) solo en salas con pantalla; una partida solo divergiría de su gemela turbo cerca del tope | — | **sin arreglar**, anotado (parte 3) |

Verificado y correcto: los 5 cambios de tests congelados de Opus llevan motivo y OK del usuario; la batería inicial
pasó 38/38; `whatif` con un genoma parcial responde 200.
Mutantes del arreglo (detalle en `spec/mutantes.md`): `busy.js` 12/12, `settleFeedback` 1/1, `playHeadless` 2/2,
`runDuel` 2/2; `api.js` 33/77 (1 equivalente y 43 huecos: rutas con 409 sin test).

**Olores (two-hats), sin tocar**. Van en commits propios si se tocan esas zonas:
- `server/rooms.js` L625–681: Large Class / Divergent Change (la voz vive dentro de `Room`: `sayVerified`,
  `voiceTry`, `voiceIntro`, `voiceAfterShot`, `spokeTurn`, `lastConfidence`; 732 líneas) -> Extract Class. Queda
  una `RoomVoice` que recibe la sala y cambia solo por motivos de voz.
- `server/rooms.js` L634: Long Parameter List (`voiceTry`, 7 parámetros) -> Introduce Parameter Object. Queda
  `voiceTry(player, soldier, {moment, events, confidence, rngKey, always, budget})`.
- `evo/train.js` L396–397 y L591–595: Duplicated Code (`makeLearner.absorb` repite lo de `record()`:
  `assignRewards` con los mismos campos, `takeFeedback` y `absorbGame`) -> Extract Function. Queda una función
  común que puntúa una partida y la guarda en la memoria.
- `evo/api.js` L207–250: Long Function (`onExhibitionOver`: agrupa, salta, aprende y evoluciona) -> Extract Function.
  Queda un bucle que llama a un paso por red.
- `evo/train.js` L487–703: Long Function (`createTrainer.run`, 217 líneas) -> Split Phase + Extract Function. Queda
  preparar / bucle de ciclos / cierre, cada fase con su función.
- `evo/voice.js` L36, 59, 75, 88, 103, 116, 128, 140, 156, 163: Repeated Switches (`{frio, …}[ctx.character] || []`
  en cada momento) -> Replace Conditional with Polymorphism. Queda anotado sin hacer: cada tabla es texto junto a
  sus datos, y separarla por carácter alejaría la frase de su momento.
- `evo/api.js` L217, `evo/store.js` L236, `evo/truth.js` L261: Duplicated Code
  (`(m.get(k) || m.set(k, []).get(k)).push(v)`) -> Extract Function. Queda un `pushTo(map, key, value)`.
- `evo/api.js` L460, 480, 515, 524, 557, 617, 666, 677, 691, 716, 752: Duplicated Code (11 bloques
  `{ const hb = heldText(…); if (hb) return bad(409, hb); }`; 677, 691 y 716 son idénticos) -> Extract Function.
  Queda un `refuseIfHeld(id, what, who)`.

**5 hallazgos (2 altos, 2 bajos, 1 de documentación) y 8 olores. El peor: R2.** Respondía `applied:true` y la
bofetada se perdía sin aviso, así que la API mentía sobre lo que había hecho.


## Apéndice A — Salida completa de `node test/run-all.mjs` (árbol de trabajo, 2026-09-23)
```
🔒 29 test(s) congelado(s): huellas OK

=== servidor de test en http://localhost:8791 ===

✓ 2*x con x=3 → 6
✓ -0.03704*x con x=-15 → 0.5556
✓ sin(x/5)*3 con x=0 → 0
✓ x^2/50 con x=10 → 2
✓ sqrt(abs(x)) con x=-9 → 3
✓ 2x con x=4 → 8
✓ 3(x+1) con x=2 → 9
✓ -x^2 con x=3 → -9
✓ y+y' con x=0 → 7
✓ e^x con x=1 → 2.718281828459045
✓ pi con x=0 → 3.141592653589793
✓ expresión vacía → error
✓ paréntesis sin cerrar → error
✓ identificador desconocido → error
✓ y''' inválido → error
✓ disparo recto → kill
✓ obstáculo → obstacle
✓ ode2 parabólica avanza
✓ ode1 avanza
✓ sqrt(x) en x<0 → invalid
PASS ✔ (parser + solver)
✓ servidor vivo
✓ sala 49N7 creada
✓ partida iniciada (ClineAgent vs CPU nivel 3)
✓ partida terminada. Ganador: left. Disparos=11 kills=3 suicidios=0
PASS ✔
✓ agentes registrados: sniper, greedy, artillery, chaos
✓ sniper vs greedy: ganó left · 9 disparos · 17.2s
✓ chaos vs sniper: ganó right · 8 disparos · 11.6s
✓ greedy vs chaos: ganó left · 9 disparos · 16.2s
PASS ✔ (self-play de agentes)
✓ init() arranca sin sesión
✓ espectar sala #room=ABCD
✓ espectando se conecta por SSE
✓ lobby en espectador oculta controles
✓ ¡Empezar! sin sesión NO lanza TypeError
✓ ¡Empezar! sin sesión no llama a la API
✓ + CPU sin sesión NO lanza TypeError
✓ Disparar sin sesión NO lanza
✓ en espectador el input de disparo queda deshabilitado
✓ sesión corrupta se descarta
PASS ✔ (cliente: sin errores de sesión nula)
✓ index.html tiene spLeft, spRight y spSoldiers (1..4)
✓ los selectores listan "Aleatorio" + los agentes de /api/agents
✓ elección explícita: sniper (izq) vs chaos (der), 2 soldados
✓ las posiciones nunca se envían (las sortea el servidor)
✓ 1 soldado por bando se respeta
✓ ambos aleatorios: agentes válidos y distintos (30 sorteos)
✓ uno fijo y otro aleatorio: el aleatorio es distinto del fijo (20 sorteos)
✓ la elección se recuerda en localStorage (gw-troops)
✓ al recargar se restaura la elección guardada
✓ una elección guardada que ya no existe vuelve a "Aleatorio"
✓ si /api/agents falla, se usan los 4 agentes de serie y no rompe
PASS ✔ (selector de tropas)
✓ hashText: mismo hash con LF y con CRLF (huellas estables en Windows)
✓ freeze CLI escribe FROZEN.json con rutas relativas POSIX y hashes
✓ checkFrozen: detecta un byte cambiado y un fichero que falta
✓ checkFrozen sin FROZEN.json → ok con aviso (nada congelado aún)
✓ run-all --check-only: sale 1 si una huella no coincide y 0 si coinciden
✓ freeze --check: sale 1 si una huella no coincide y 0 si coinciden
✓ generateMutants: opera sobre operadores, números y booleanos; no toca comentarios, cadenas ni regex
✓ generateMutants: === ↔ !==, && ↔ ||, > ↔ >=, * ↔ /
✓ applyMutant: cambia solo ese sitio y el resultado sigue siendo distinto del original
✓ generateMutants: la línea shebang (#!/usr/bin/env node) no se muta
✓ generateMutants es determinista y no genera mutantes en un fichero vacío
✓ runMutants: caza el + → - de add y reporta superviviente en neg (sin test)
✓ runMutants: un test que revienta por tiempo cuenta como cazado
✓ mutants CLI: imprime tabla y resumen "cazados X/Y" y sale 0

PASS ✔ (herramientas de proceso)
✓ constantes nuevas de F1
✓ makeRng: determinista, [0,1), int/pick/gauss/seed, y compatible con Math.random
✓ slideMove: destino válido dentro del radio → sin deslizar
✓ slideMove: fuera del radio → recortado al círculo en la misma dirección
✓ slideMove: "stay", null y undefined → quieto sin deslizar
✓ slideMove: NaN, cadena o Infinity → quieto con reason "invalid" (nunca lanza)
✓ slideMove: dentro de un obstáculo ampliado → punto válido más cercano (contrastado con fuerza bruta)
✓ slideMove: borde del plano → se respeta BODY
✓ slideMove: otro soldado vivo a 0.9 u del destino → acaba a ≥ 1.0; muerto no bloquea
✓ slideMove: no atraviesa un muro fino de un salto
✓ slideMove: rodeado → se queda (reason "blocked") y determinista
✓ lib: randomTemplates/directShots/pickWeighted/addMissNoise/avoidRepeats aceptan rng y son deterministas
✓ lib.moveOptions: 9 destinos en orden (quedarse, 0°, 45° … 315°), deslizados, con cover/distEnemy/los
✓ Sniper: expuesto a dos enemigos, se mueve al destino tapado más lejano (135°)
✓ Sniper: ya tapado, se queda aunque alejarse sea posible
✓ Greedy: campo abierto → el destino con línea de tiro más cercano al enemigo (0°)
✓ Artillery: campo abierto → el destino más lejano del enemigo (180°)
✓ Chaos: uno de los 9 destinos, determinista por semilla y variable entre semillas
✓ sin enemigos vivos, los cuatro heurísticos se quedan
✓ chooseShot con rng: misma escena y semilla → mismo disparo (4 heurísticos)
✓ ode2: el ángulo positivo sube en los dos lados y la trayectoria es simétrica
✓ Room sin pantalla: rechaza humanos, no crea temporizadores y la partida termina con step()/play()
✓ misma semilla → misma partida (resultados, expresiones, movimientos, posiciones, ganador); distinta → difiere
✓ 1..4 soldados por bando terminan; los soldados solo cambian de sitio por move o por mapa renovado
✓ fire con move en el cuerpo: aplica el movimiento (validado) y registra lastMove; el turno avanza
✓ snapshot: config.seed, moveRadius, moveTime, body, minSeparation; lastMove
✓ rematch deriva una semilla nueva del rng y sigue siendo reproducible
✓ headless.playGame: devuelve seed, result, events[], trajectories, chat; determinista
✓ Room viva: fire sin move → stage "move" con deadline y radius; move de otro → error; move válido; vencimiento → quieto
✓ Room viva: los bots se mueven solos tras disparar (chooseMove) sin ventana
✓ API: POST /rooms acepta seed y la devuelve; fire.move; POST /move; state.turn.stage/radius; lastMove

PASS ✔ (motor F1)
✓ escenas aleatorias (150): válido o quieto, sin deslizar cuando no hace falta, casi óptimo al deslizar, "blocked" solo si nada vale
✓ bordes exactos: en la línea del rect ampliado es inválido; a MIN_SEPARATION justa es válido; en el margen del plano es válido
✓ segmento: muestreo t = 0.1 … 1.0 (ni antes del origen ni después del destino)
✓ deslizamiento: escoge la menor distancia a T; empates → menor radio, luego menor ángulo
✓ rejilla polar: encuentra el único hueco angular (300°) entre soldados

PASS ✔ (geometría F1)
✓ secuencia fijada: makeRng(42) y makeRng(1) dan siempre los mismos primeros valores (mulberry32)
✓ semilla inválida o ausente → se sortea una válida (entero en [0, 2^31))
✓ distribución: float uniforme en [0,1), int en [0,n) sin sesgo grosero, gauss ~ N(0,1)

PASS ✔ (rng F1)
✓ los: muestreo cada 0.25 u con bordes incluidos; segmentos cortos usan solo el extremo
✓ moveOptions (120 escenas): orden, deslizamiento (igual que slideMove), cover, distEnemy y los correctos
✓ chooseMove de los 4 heurísticos (120 escenas) coincide con las reglas de spec/01 §5
✓ coverMove/greedyMove: empates resueltos por índice; sin enemigos distEnemy es null y no rompe

PASS ✔ (movimiento de heurísticos F1)
✓ constantes FAST: STALL 4, MAX 40, MOVE_TIME 400
✓ addPlayer/addAgent: reparto automático de equipos, equipo lleno, sala llena, nombres repetidos, recortes
✓ start: exige dos equipos, jugador de la sala, una sola vez; banter de presentación en bocadillo
✓ fire: validaciones (turno, modo, expresión, ángulo, etapa) y registro del disparo
✓ estancamiento y límite: 4 fallos → mapa renovado (muertos quietos, historial vacío); 40 disparos → empate técnico
✓ gameOver: desempates (bajas, luego supervivientes, luego empate) y victoria por aniquilación
✓ un kill real: contadores, bocadillo de burla, soldado muerto no vuelve a disparar
✓ move: quieto/válido/deslizado registran requested; fire con move inválido (NaN) deja quieto
✓ snapshot: chat 40, history 12, config, jugadores; addChat; rematch reinicia
✓ banter: sin lista o sin soldado no habla; variables sustituidas

PASS ✔ (sala F1)
✓ BLOCKS: los 24 tipos del catálogo con nombre, explicación, ejemplo, nivel y parámetros con rango
✓ LIMITS: bloques 64, cables 256, unidades 512, parámetros 2M, candidatos 4..64, genoma 48 MB
✓ outDims: ojos según spec/03 §2 y propagación por el grafo (difusión ctx→cand)
✓ eye.map: cell 1/2/2.5/5 y canales; imagination.n fija N
✓ dense: y = act(Wx + b) con la disposición W[i*out+j], para las 7 activaciones
✓ hand.choose / hand.adjust / foot.move: cabezas lineales por candidato y por destino
✓ concat con difusión ctx→cand, add, mul, skip: exactos
✓ norm (LayerNorm), pool mean/max, attention (pesos softmax que suman 1): exactos
✓ echo, gru, lstm, teamMemory: un paso exacto contra la referencia; estado inmutable
✓ gradiente: dense con cada activación (ctx→value y cand→choose)
✓ gradiente: concat con difusión, add, mul, skip, norm, pool, atención (con y sin consulta)
✓ gradiente con BPTT (3 pasos): echo, gru, lstm, teamMemory, y truncado a 1 paso difiere
✓ 20 grafos aleatorios válidos: compilan, validan y pasan el gradiente numérico con 2 pasos
✓ validate: cada código de error con un caso mínimo, mensaje en español y ejemplo
✓ validate: límites (65 bloques, 2 000 001 parámetros, 49 MB) se rechazan en < 50 ms cada uno, sin reservar memoria
✓ normalize/repair/initWeights/newGenome: defaults, pesos que faltan, cables sueltos, determinismo
✓ serialize → compile → serialize idéntico; forward determinista; getFlat/setFlat/paramCount coherentes
✓ compile lanza GenomeError con código y bloque; forward nunca devuelve NaN con entradas finitas
✓ plantillas: sniper, turtle, seer, empty validan (forPlay), compilan y disparan con salidas finitas
✓ rendimiento: red de ~100 k parámetros con N = 24 → forward medio < 20 ms (objetivo 5 ms)

PASS ✔ (red F2)
✓ defaults decididos (ronda 2, 7, spec/02 §2, spec/03 §5, spec/04 §1–2) fijados
✓ catálogo: defaults y rangos de los parámetros clave (spec/02 §4)
✓ validate: casos sin cubrir — no objeto, familias, grazeRadius, número/conjunto, 64 bloques justos, ids, nombre vacío
✓ avisos unconnected: alcanzado pero sin salida a mano/pie, y con salida pero sin ojo detrás
✓ normalize/newGenome: nombre por defecto = id, emblema derivado del id, secciones intactas si ya existen

PASS ✔ (genoma F2: defaults y validación)
✓ toLocal/toWorld: identidad para el izquierdo, espejo en x para el derecho; ida y vuelta
✓ localToWorldExpr: sustitución textual y trayectoria espejada exacta (function, ode1, ode2)
✓ familyOf: clasifica disparos ajenos en el marco del tirador
✓ Imaginación: cupos por familia (restos mayores), orden, índices y determinismo
✓ Imaginación: cada candidato sale de la rejilla de su familia y de un objetivo real; sin repetir dentro de la familia
✓ Imaginación: rejilla agotada → repite con jitter; sin enemigos → objetivo virtual; equipo derecho → expresión mundo espejada
✓ applyAdjust: escalas por familia, recorte del sample a [−3,3], reconstrucción de la expresión y límites de artillería
✓ candidateFeatures: one-hot, normalizaciones y error analítico en la x de los dos enemigos
✓ simulateCandidate/simulatorFeatures: igual que el solver en el mundo; kill, wall y víctima más cercana
✓ moveDestinations: 9 rasgos exactos en campo abierto, espejo para el derecho, y pegado a obstáculo
✓ observe: dimensiones de todos los ojos, candidatos/destinos en la fase que toca (ceros en la otra)
✓ eye.features exacto (26) y espejo para el equipo derecho
✓ eye.obstacles, eye.history, eye.radar, eye.clock, eye.mates, eye.map exactos
✓ eye.map con estelas (trails) y rejilla 2u; eyeLayout con nombres para cada índice

PASS ✔ (percepción F3)
✓ simulateCandidate: artillería usa el ángulo en grados (radianes en el solver) y coincide con simulateShot
✓ simulatorFeatures: la víctima es el enemigo más cercano → 1; invalid → "otro fin" y minDist 30
✓ espejo del equipo derecho: obstáculos, radar, mapa y destinos dan los mismos vectores que el izquierdo
✓ eye.mates: media x asimétrica y aliado más lejano; historial con resultado "otro fin" y minDist al tope
✓ applyAdjust: escala p1 de senos y parábolas (0.03·(1+|s|)); Fisher–Yates: la primera de line es la exacta

PASS ✔ (percepción F3, extra)
✓ softmaxT y sampleIndex: probabilidades con temperatura y muestreo acumulado con el rng
✓ decideShot (Vidente): elección, margen, ajuste, valor, logp y determinismo; el rng se consume en el orden fijado
✓ decideShot (Francotirador, ciega): sin sim, sin ajuste, sin valor; puntos de todos los candidatos; sin atribución si no se pide
✓ decideShot: la temperatura del genoma cambia las probabilidades; equipo derecho dispara con la expresión mundo
✓ decideMove (Tortuga con ajuste): 9 destinos con probabilidades, ajuste de 0.5 u y re-deslizado; sin Pies → stay
✓ memoria y equipo: el estado avanza y se reutiliza; la lectura de equipo cambia la decisión; atribución por ojo
✓ store: guardar (validado, atómico), listar, cargar, borrar; ficheros rotos se ignoran con aviso
✓ registry: las redes guardadas aparecen como net:<id>; createAgent por id o con genoma
✓ agents/net.js: chooseShot y chooseMove con el contrato de agentes; memoria por soldado; fallo → 0.1*x con decision.error
✓ sala sin pantalla: la red juega contra Sniper hasta el final; shotLog con familia y params; decisiones guardadas; determinista
✓ sala: addAgent("net:<id>"), 1..4 soldados con memoria por soldado, learn, y playGame con una red
✓ sala viva (FAST): evento SSE decision antes de shot y antes de move; players[].netId en el snapshot

PASS ✔ (política F3)
✓ GET /api/lab/catalog: bloques, ojos con layout, familias, rasgos, recompensa, aprendizaje, límites, niveles
✓ GET /api/lab/templates: las 4 con nombre, por qué y genoma válido
✓ POST /api/lab/nets desde plantilla: 201, id derivado del nombre, único; genoma propio; inválido → 400
✓ GET /api/lab/nets y /:id: listado con campos, detalle con paramCount y avisos; 404
✓ PUT /api/lab/nets/:id: guarda un genoma completo válido; inválido → 400; id distinto → 400
✓ POST /api/lab/nets/:id/validate: no guarda, devuelve errores/avisos/paramCount
✓ export / import: descarga, 409 si existe, ?rename=1, inválido → 400 (nunca 500), cuerpo enorme → 400
✓ /api/agents lista las redes guardadas como net:<id>; DELETE y 404 después

PASS ✔ (API del laboratorio)
✓ assignRewards: cada término va a la decisión que dice la tabla (kill, die, fuego amigo, roce, repetir, casi fuego amigo, cubrirse, ganar, sobrevivir)
✓ assignRewards: perder, radio de roce, sin roce si mata, sin cubrirse si empeora; decisiones de fallback ignoradas
✓ normalizeStats: sin normalizar los 20 primeros; luego valor/σ con σ ≥ 0.1; returns con γ
✓ policyGradient = derivada numérica de L (elegir + ajustar + mover + valor + entropía) con BPTT por la GRU
✓ computeAdvantages: retorno con γ y referencia value / mean / none
✓ applyUpdate: Adam mueve los pesos, recorta la norma, respeta frozen, informa por bloque; SGD también
✓ tragaperras: 4 brazos (0.1, 0.2, 0.8, 0.3) → p(mejor) > 0.9 tras 2 000 actualizaciones en 3 semillas; con curiosidad 0.5 se queda < 0.6
✓ recordar un bit 3 turnos: con GRU (BPTT 8) > 90 % en las últimas 500 en dos semillas; sin memoria ≤ 65 %
✓ evolutionStep: dense(1) maximiza −(w−0.7)² en 100 pasos; congelado no cambia; determinista
✓ Corazonada: con recompensa constante 1, V → 1 ± 0.01
✓ playGame con una red: eventos (§9.1) y trayectorias (§9.2) exactos y enlazados
✓ learnFromGames: asigna recompensas, un paso de gradiente, lección y estadísticas; determinista
✓ createTrainer turbo (1 hilo): 4 partidas → 1 sueño, curva, lección, red guardada con stats y optim; determinista
✓ createTrainer con 2 hilos: mismos pesos que con 1 (actualizaciones en orden de semilla)
✓ stop a mitad deja la red válida y guardada; plateau para solo; self y hallOfFame sin hitos caen a sí misma
✓ sala x10: config.speed, sin humanos; x1 por defecto

PASS ✔ (aprendizaje F4)
✓ normalizeStats: media y varianza móviles exactas (α = 1/n) y tope α = 1/500
✓ normalizeStats: el valor nº 20 sale crudo y el nº 21 ya normalizado; sin stats usa reward.stats o uno nuevo
✓ assignRewards: roce justo en el radio (inclusive); cubrirse con ganancia 1
✓ assignRewards: τ por defecto = 0.5; sin trayectoria (null o sin soldados) no hay entradas
✓ assignRewards: casi fuego amigo exactamente a 1.5 u (inclusive), no a 1.6; nunca si fue suicidio
✓ assignRewards: "repetir" mira exactamente los 10 tiros anteriores del jugador
✓ assignRewards: cubrirse solo con ganancia; cobertura 0 → 0 o ausente no da nada
✓ store: crea la carpeta anidada; el aviso lleva el mensaje real de validación; borrar con id inválido → false
✓ applyUpdate: el recorte escala todos los gradientes (‖Δθ‖ = lr·clipNorm); perBlock atribuye a su bloque exacto; congelado que no es el primero
✓ evolutionStep: perturbaciones acotadas (≤ 5.5σ) y, con fitness = Σθ, la suma de pesos sube en 10 semillas (parejas antitéticas)
✓ gameSummary: victoria 1/0 y recuentos de kills y muertes del jugador
✓ createTrainer: minutes largo no para antes que games; plateau con ventana 2 para exactamente en la 4ª partida

aprendizaje-extra OK
✓ applyUpdate: congelar un bloque intermedio deja exactamente ese bloque quieto y mueve todos los demás −lr·g; clipNorm por defecto 5
✓ applyUpdate (Adam): un parámetro con gradiente 0 sigue moviéndose por su momento anterior
✓ evolutionStep: actualización exacta lr/(pop·σ)·Σ (F⁺−F⁻)·ε con parejas antitéticas (sin ranking); valores por defecto σ 0.02, lr 0.01
✓ learnFromGames con Corazonada: valueLoss finito y > 0 (los valores de la decisión entran en la referencia)

entrenador-extra OK
✓ computeAdvantages (media): el estado lleva n exacto y media móvil 0.05; la ventaja usa la media anterior
✓ policyGradient: con puntuaciones iguales la entropía es ln N por paso, valueLoss = ½(V−G)² y loss = −ln p·A − βH + valueLoss
✓ learnFromGames: si optim viene sin mean (fichero antiguo), lo crea y lo actualiza
✓ createTrainer: sin semilla, dos entrenadores reciben semillas distintas (rango amplio) y enteras
✓ createTrainer x10 / x1: las salas vivas llevan speed 10 / 1
✓ createTrainer: mezcla de rivales sin normalizar (2/0/2) reparte entre antagonista y sí misma; estadísticas de normalización guardadas

entrenador-extra-b OK
✓ preparación: dos redes desde plantilla
✓ POST /api/lab/trainings: 202 con id; 404 red inexistente; 400 cuerpo malo; la red aparece como training:true
✓ SSE /api/lab/events: hello y eventos training/curve/sleep/lesson durante un entreno; PUT bloqueado (409) mientras entrena; stop

PASS ✔ (API de entrenos)
✓ DEFAULT_MUTATION es exactamente la tabla de spec/05 §1
✓ mutate: 2 000 cadenas de 5 pasos (semillas 1..2000) → siempre válido, dentro de límites, linaje correcto
✓ mutate: determinismo — misma semilla → mismo hijo (JSON idéntico); semilla distinta → distinto
✓ op addNeurons: unidades +k (1..max), pesos viejos en su sitio, columnas nuevas Xavier×0.1, sesgos 0, filas nuevas del consumidor a 0
✓ op removeNeurons: quita las k de menor norma saliente (empate → índice mayor), mínimo 1 unidad; recorta filas y columnas
✓ op activation: cambia la activación de un Instinto a otra distinta; pesos intactos
✓ op eyeParams: cambia un parámetro del Radar (16 → 8 o 32); el Instinto receptor casa por índice (nuevas a 0 / recorte)
✓ op addWire: cable nuevo válido; el destino conserva sus filas y pone a 0 las nuevas
✓ op removeWire: quita un cable dejando entradas y salidas, o se deshace; filas recortadas
✓ op addBlock: inserta en un cable (A→X→B) o añade un ojo cableado; id nuevo tipo+número; pesos nuevos pequeños; válido
✓ op removeBlock: quita un bloque (ni Mano/Pie ni ojo único de su corriente) reconectando entradas a salidas
✓ op imagination: n ± 0..4 recortado, pesos × e^(σN) recortados 0.1..20, a lo sumo una familia cambia de on y nunca todas apagadas
✓ op traits: temperatura y pulso × e^(σN), teamSpirit + σN, recortes; carácter cambia con prob. σ a otro
✓ op weights: una fracción de los pesos (≈ fraction) recibe + σ·N·(1+|w|); el resto idéntico; congelados intactos
✓ op emblem: entero en [0, 2³¹); nueva semilla o 4 bits volteados
✓ "exacto": cada número de ops[].text está en before/after (300 cadenas completas)
✓ nombres 🧭: Hydra-7 → Hydra-8a / Hydra-8b; Hydra (gen 0) → Hydra-1a; id = nombre en minúsculas; colisión → sufijo
✓ congelados: en 300 cadenas el bloque frozen conserva pesos y parámetros; las ops que lo tocarían se deshacen con motivo
✓ diffGenomes: same / changed / added / removed, relChange, heat (≤ 64, máx 1), cables, rasgos, imaginación, textos
✓ rankChildren: victorias ↓, diferencia de kills ↓, kills ↓, nombre ↑
✓ runPretournament: mismas semillas y soldados para todos, lados alternos, filas con opsText, orden
✓ adaptImagination: usage = familias de las últimas 200 decisiones de disparo; adaptive → 0.9·w + 0.1·(u/Σu)·Σw recortado

evolucion OK
✓ removeWire: con f→d (única entrada de d) y f→ch (ch tiene d y f), solo se puede quitar f→ch; nunca deja a d sin entrada
✓ removeWire: un destino con exactamente 2 entradas es elegible (ambos cables redundantes se quitan alguna vez)
✓ eyeParams (entero): Obstáculos con 4 huecos cambia en ±1 y ±2, y en los dos sentidos; nunca fuera de 1..8
✓ imagination: en 60 semillas n sube y baja, |Δn| llega a 4 y a veces no cambia (rng.int(0..4))

evolucion-extra OK
✓ POST /children: validaciones (404, n fuera de 1..16, games fuera de 0..20, soldiers)
✓ POST /children: 202 {jobId}; el trabajo avanza (SSE job), termina (SSE children) y el ranking está ordenado; hijos guardados con linaje
✓ POST /children: misma semilla → mismos hijos (pesos idénticos, ids con sufijo); games 0 → sin partidas; hello del SSE lleva jobs
✓ POST /children con opponentId explícito y sin él (sin reina → el padre): ambos terminan
✓ GET /diff/:otherId: bloques con estado, relChange, heat; cables; rasgos; textos de las mutaciones; 404 si falta
✓ cirugía: PUT /frozen congela y descongela; 400 si el bloque no existe
✓ cirugía: PUT /weights/:blockId cambia solo las claves enviadas; forma exacta; NaN/Infinity → 400 weights-nan; 404 bloque
✓ cirugía: POST /transplant compatible copia pesos; incompatible reinicializa con aviso; sin replaceBlockId añade suelto; queda en el linaje
✓ cirugía durante un entreno → 409 (frozen, weights, transplant, children)
✓ importar: ciclo → 400 cycle; NaN → 400 weights-nan; JSON roto → 400; el servidor sigue vivo; exportar → importar → exportar idéntico

api-evolucion OK
✓ hash32: fórmula exacta (mulberry32 de seed ^ imul(k+1, 0x9E3779B1)), entero en [0, 2³¹), determinista
✓ duelPlan: 6 partidas = 3 mapas × 2 lados; misma semilla y soldados en las dos partidas de cada mapa; lados alternos; determinista
✓ duelScore: más victorias; empate → diferencia de kills; empate total → tie y winner null; con throne gana la reina
✓ runDuel (inyectado): sigue el plan, puntúa, guarda filas con gameId; frozen = solo repaso de 6; hot = 6 lotes de 1; mix = 6 × lr/4 + repaso
✓ modos de aprendizaje con redes reales (turbo): frozen no cambia hasta el repaso; hot cambia tras la 1ª; mix cambia menos que hot tras la 1ª y más tras el repaso
✓ makeLearner: aprende de partidas propias con lrScale y guarda red + optim.json
✓ trono: sin reina sienta a la retadora; reto ganado → reign.end/start y copia en la sala de la fama con sha; perdido/empate → defenses++; auto-reto → 400; inexistente → 404
✓ liga: pares ordenados, last ≤ 20, winrate 0.5 sin datos; pickOpponent respeta los pesos (10 000 sorteos ± 2 %), f_hard, fantasma solo con derrota reciente
✓ genealogía: registerBirth guarda sha de la estructura; aprender no edita; cambiar la estructura sí; padres desconocidos → orphan
✓ dinastías: fundar (400 misma red, 404 inexistente) y una generación completa sin pantalla (semilla fija) termina, actualiza history y generation, sin huérfanos

trono OK
✓ preparación: hello lleva throne (sin reina); redes desde plantilla
✓ POST /duels: validaciones (404, a === b, learning/speed/soldiers malos) y duelo turbo completo con 6 partidas, SSE duel y partidas guardadas
✓ POST /duels x10: salas vivas encadenadas (roomCodes) con speed 10; stop deja el duelo parado
✓ trono: sin reina el reto sienta (200, reign.start); reto con reina → 202 y duelo con throne:true; auto-reto 400; hall-of-fame y throne coherentes
✓ entreno explotador: exploiter:true fija la mezcla contra la reina y queda en config; genealogía por API
✓ dinastías: fundar, una generación como trabajo (SSE dynasty, jobs), history y generation; reto al trono desde una casa

api-trono OK
✓ checkPhrase: 10 frases válidas pasan; número inventado, nombre inventado, #9 inexistente y ref a otra partida fallan con el missing correcto
✓ compose: rellena huecos con valor y ref, junta refs únicas y extrae números y nombres; rechaza huecos sin evento
✓ confianza: certainty = margin, experience = (1 − e^(−games/50))·(0.5 + 0.5·acierto), niveles y probabilidad de hablar
✓ emoción: hope = clamp(V), fear = clamp(−V), joy = tanh(A⁺), disappointment = tanh(A⁻), surprise = tanh(|A|); sin valor → 0
✓ memoria: episodios de la partida fija (orgullo, rencor, susto, vergüenza), rivales, tiros recientes, gamesAgo, recall por la fórmula, tope 300
✓ eventos de recompensa y emoción: continúan los ids y llevan los campos de spec/07 §1
✓ diario: la lección, el hito, el reto y el examen se componen con plantilla fija y pasan checkPhrase contra el registro
✓ neuronas con nombre: una unidad igual a "mi x" recibe ese nombre; una suma de 58 entradas → "sin nombre claro"; pocas muestras → "sin datos"; el nombre del usuario manda
✓ boletín: determinista (misma semilla → mismas puntuaciones) y Sniper L3 ≥ red vacía en puntería; formas y detalles
✓ sala: tope de 5 000 eventos → error una vez y decisiones truncadas; graze en la sala real
✓ retención: pruneGames deja 200 partidas por red (los duelos de trono no se borran); appendLog devuelve id y rota

verdad OK
✓ entreno de 20 partidas: 1 partida de muestra guardada con trajectorias, eventos reward y emotion; log con update y lesson
✓ moviola: GET /games/:id/turns/:n/brain recalcula la decisión del turno (approx:true); 404 si no hay decisión
✓ boletín: POST → 202 trabajo exam; GET devuelve el último; evento exam en SSE y en el diario; 409 si entrena
✓ diario y cronista: frases con refs al registro que pasan checkPhrase contra GET /api/lab/log
✓ neuronas: GET calcula nombres desde las partidas guardadas; PUT renombra y se guarda en el genoma
✓ bofetada y caricia: evento en la partida y en el registro, recompensa devuelta con signo, feedback pendiente; 404 partida/decisión

api-verdad OK

=== resumen ===
 ✔ parser + solver
 ✔ partida agente vs CPU
 ✔ self-play de agentes
 ✔ cliente (DOM simulado)
 ✔ selector de tropas (F0)
 ✔ herramientas: congelado y mutantes
 ✔ motor (F1): movimiento, semilla, sin pantalla
 ✔ geometría (F1): propiedades del deslizamiento
 ✔ rng (F1): secuencia fijada y distribución
 ✔ movimiento de heurísticos (F1)
 ✔ sala sin pantalla (F1)
 ✔ red (F2): genoma, validación, cálculo y BPTT
 ✔ genoma (F2): defaults fijados y validación
 ✔ percepción (F3): ojos, Imaginación, ajuste, destinos
 ✔ percepción (F3): casos extra
 ✔ política (F3): decisión, agente-red, almacén, sala
 ✔ API del laboratorio: catálogo, plantillas, redes
 ✔ aprendizaje (F4): recompensa, gradiente, tareas, entrenador
 ✔ aprendizaje (F4): casos extra
 ✔ entrenador (F4): casos extra 2
 ✔ entrenador (F4): casos extra 3
 ✔ API de entrenos (F4)
 ✔ evolución (F5): mutación, diferencias, pre-torneo, Imaginación por uso
 ✔ evolución (F5): casos extra
 ✔ API de evolución (F5): hijos, diff, cirugía, importar
 ✔ trono (F6): duelos, reto, liga, genealogía, dinastías
 ✔ API de trono (F6): duelos, trono, dinastías, explotadora
 ✔ verdad (F7): frases, confianza, emoción, memoria, boletín, neuronas, registro
 ✔ API de la verdad (F7): moviola, boletín, diario, neuronas, bofetada

TODO OK ✔

real	3m24.313s
user	0m0.000s
sys	0m0.030s
EXIT=0
```
