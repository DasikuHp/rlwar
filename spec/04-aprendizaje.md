# 04 — Aprendizaje: recompensa, gradiente, evolución, entrenos (F4)

> Contrato exacto de `shared/reward.js`, `evo/train.js`, `evo/worker.js` y de los cambios mínimos en
> `server/rooms.js` (velocidad x10). Fuente: plan2.md rondas 1, 2, 4, 7, 8, 9; §4.4; §6.2.

## 1. `genome.learning`
```json
{ "method": "gradient",                       // gradient | evolution | both
  "gradient":  { "lr": 0.003, "gamma": 0.95, "entropy": 0.01, "clipNorm": 5, "batchGames": 4,
                 "bpttSteps": 8, "baseline": "value", "optimizer": "adam", "adjustLearn": true },
  "evolution": { "population": 16, "sigma": 0.02, "lr": 0.01, "gamesPerCandidate": 2,
                 "antithetic": true, "rankNormalize": true },
  "both":      { "gradientGamesPerCycle": 16, "evolutionStepsPerCycle": 1 },
  "sleep":     { "lessonThreshold": 0.015 } }
```
Rangos: `lr` 1e-5..0.1 · `gamma` 0..1 · `entropy` 0..0.5 · `clipNorm` 0.1..100 · `batchGames` 1..64 ·
`bpttSteps` 1..64 · `baseline` ∈ {value, mean, none} (`value` cae a `mean` si no hay `hand.value`,
con aviso) · `population` 2..128 (par si `antithetic`) · `sigma` 1e-4..1 · `gamesPerCandidate` 1..16.
Cada clave lleva `explain` + ejemplo en el catálogo (nivel aprendiz: `method`; artesano: `lr`,
`entropy`, `population`, `sigma`; científico: el resto).

## 2. Recompensa (`genome.reward`, `shared/reward.js`)
```json
{ "kill": 1, "die": -1, "friendlyFire": -1.5, "graze": 0.1, "win": 2, "lose": 0, "survive": 0,
  "cover": 0, "repeatExpr": 0, "nearFriendly": 0, "slapCaress": 1,
  "normalize": true, "grazeRadius": 2.0, "milestones": true }
```
| término | cuándo (evento que lo genera, spec/07) | a qué decisión se asigna |
|---|---|---|
| `kill` | mi tiro mata a un enemigo | mi decisión `shoot` de ese turno |
| `die` | un tiro rival mata a mi soldado | la **última** decisión de ese soldado (normalmente su `move`) |
| `friendlyFire` | mi tiro mata a un aliado | mi `shoot` |
| `graze` | sin matar, `minDist` a un enemigo ≤ `grazeRadius` | mi `shoot` |
| `win` / `lose` | fin de partida | la última decisión de **cada** soldado de mi jugador |
| `survive` | fin de partida, soldado vivo | su última decisión |
| `cover` | tras mover, menos enemigos con LOS que antes | mi `move` (× enemigos que dejaron de verme) |
| `repeatExpr` (etiqueta) | `expr` igual a alguno de mis 10 últimos | mi `shoot` (negativo por convención) |
| `nearFriendly` (etiqueta) | sin fuego amigo, `minDist` a un aliado ≤ 1.5 u | mi `shoot` |
| `slapCaress` | el usuario pulsa bofetada (−) o caricia (+) sobre una decisión | esa decisión (`amount·slapCaress`) |
Rangos: −5..5 cada uno. Cada deslizador explica la personalidad que provoca (catálogo `rewardTerms`),
p. ej. `survive` alto → "cobarde: se esconde tras los muros y dispara poco".

- Por decisión: `r_own` = Σ términos propios; `r_team` = media de `r_own` de todas las decisiones de
  mi jugador en ese turno más `win/lose`; **efectiva** `r = (1−τ)·r_own + τ·r_team` con
  `τ = traits.teamSpirit`.
- `normalize` (NERO): cada término se divide por su desviación típica móvil (ventana 500, mínimo 0.1)
  antes de sumar; se guarda `reward.stats` en el genoma (`{term: {n, mean, m2}}`). Los eventos
  `reward` registran valor **crudo y normalizado**.
- Retorno: `G_t = Σ_k γ^(k−t) r_k` sobre la secuencia de decisiones **del soldado** (`shoot`, `move`,
  `shoot`, …). Ventaja `A_t = G_t − b_t`: `b = V` (`hand.value`) · media móvil EMA 0.05 · 0.
- `milestones` (hitos anti-olvido): cuando la tasa de victoria móvil (50 partidas) contra el
  antagonista o el examen del boletín (spec/07 §7) mejora el mejor valor, se guarda una copia
  `evo/nets/<id>/milestones/<n>.json` que entra en la sala de la fama **propia** (mezcla de rivales).

## 3. Gradiente (REINFORCE + baseline + BPTT)
- Pérdida por lote (`batchGames` partidas):
  `L = −Σ_t (logp_choose + logp_adjust + logp_move + logp_moveAdjust)·A_t − β·Σ_t H_t + ½·Σ_t (V_t − G_t)²`
  (`H` = entropía del softmax de la fase; el término de valor solo con `hand.value`).
  `logp_adjust = Σ_i log N(a_i; μ_i, pulse²)` (solo si `adjustLearn`).
- BPTT: la memoria se recompone **replicando** la secuencia del soldado desde el estado cero
  (`obs` guardadas), truncada cada `bpttSteps` pasos (2 por turno). Lectura de memoria de equipo:
  constante (spec/02 §4).
- Optimizador: Adam (β 0.9/0.999, ε 1e-8) o SGD; recorte de norma global `clipNorm`; bloques en
  `frozen` no cambian. Estado de Adam en `evo/nets/<id>/optim.json` (no en el genoma).
- Resultado de cada actualización: evento `update` con `{loss, entropy, gradNorm, perBlock:
  {blockId: {relChange}}}` y la **lección** (spec/07 §8).

## 4. Evolución (estrategias evolutivas)
- Un paso: `population` copias `θ + σ·ε_j` (antitéticas por pares) juegan `gamesPerCandidate`
  partidas sin pantalla contra la mezcla de rivales (mismas semillas para todas: justo); fitness =
  media de `r` efectiva por partida (mismo `reward`); ranking centrado (`rankNormalize`) o crudo;
  `θ ← θ + lr/(population·σ)·Σ_j F_j·ε_j`. Bloques `frozen` no se perturban.
- `both`: ciclo = `gradientGamesPerCycle` partidas con gradiente + `evolutionStepsPerCycle` pasos
  de evolución; la estructura la cambia solo `mutate` (spec/05), nunca la ES.

## 5. Trayectorias y hilos
- `playGame` (spec/01 §6) devuelve `trajectories: {netId: {soldierId: [{turn, phase, obs, chosen,
  chosenMove, adjustSample, moveAdjustSample, logp, rewardEvents:[eventId]}]}}` y `events`.
  Los `obs` van como `Float64Array` (transferibles). Sin `tape`: el hilo principal **recalcula**
  `forward`/`backward` (así los hilos solo necesitan `forward`).
- Protocolo `evo/worker.js`: entrada `{type:'play', genomes:{id: genoma}, game:{seed, left, right,
  soldiers}, collect:[netId]}` → salida `{type:'done', result, trajectories, events, ms}` o
  `{type:'error', message}`. Un hilo por núcleo hasta `workers` (def `min(8, cores−1)`, 1..32).
- Determinismo: partida = f(semilla, genomas); actualización = f(lote ordenado por semilla).
  Test: mismo entreno con la misma semilla → mismos pesos bit a bit.

## 6. Entreno (`POST /api/lab/trainings`)
```json
{ "netId": "hydra-7",
  "opponents": { "antagonist": 0.6, "hallOfFame": 0.25, "self": 0.15, "antagonistId": "orca-2",
                 "hard": 2, "ghost": 0.1 },
  "speed": "turbo", "workers": 8,
  "duration": { "games": 200 } ,          // | { "minutes": 10 } | { "plateau": { "window": 50, "minGain": 0.02 } }
  "soldiers": "random",                   // | 1..4
  "seed": 12345 }
```
- Mezcla de rivales 🧭 60/25/15 (✅ deslizadores): `antagonist` = `antagonistId` o la reina; sala de la
  fama = ex-reinas + hitos propios muestreados con `f_hard = (1 − tasa de victoria contra él)^hard`
  (AlphaStar); `self` = copia congelada del inicio del lote; `ghost`: probabilidad de que la
  partida sea contra una ex-reina a la que se ha perdido en las últimas 20 (evento `ghost`).
  Nunca heurísticos (salvo exhibición con el interruptor, §7).
- Duración ✅ las 3; `plateau`: para si la media móvil de `r` por partida no sube `minGain` en
  `window` partidas. Siempre se puede parar (`/stop`) y **lo aprendido se guarda** (escritura atómica
  tras cada lote: `tmp` + `rename`).
- Velocidad ✅: `x1` = sala viva normal (bocadillos, atribución) · `x10` = sala viva con
  `speed:10` (retardos ÷10, `TURN_TIME` 6 s para bots; humanos no admitidos) · `turbo` = sin
  pantalla en hilos + partidas de muestra (1 de cada 20 se guarda para la moviola).
- Estado (`GET /api/lab/trainings/:id`): `{id, netId, status: queued|running|paused|stopped|done,
  games, updates, elapsedMs, curve:[{game, reward, win, kills, deaths, loss?, entropy?}],
  sampleGames:[gameId], lastLesson}`. SSE `training` y `curve` (spec/08 §6).
- Fase de **sueño** ✅ entre lotes: evento `sleep` `{netId, games, update}` → `lesson` (bombilla si
  `relChange > lessonThreshold`; por defecto 0.015 desde M13, 2026-09-23: un sueño típico cambia un 1–2 %).

## 7. Exhibición contra heurísticos ✅
Sala con una red y un heurístico: `learn:false` por defecto (no cuenta para trono ni entreno);
`addagent {type:'net', netId, learn:true}` activa el interruptor "aprender de esta partida".
Nunca entra en `stats.wins/kills` del trono; sí en `stats.games`.

## 8. Referencias independientes (tests de F4, `test/aprendizaje.spec.mjs`)
1. **Tragaperras**: 4 candidatos con recompensa Bernoulli (0.1, 0.2, 0.8, 0.3) como rasgos one-hot;
   2 000 actualizaciones → `p(mejor) > 0.9` en 3 semillas; con `entropy` 0.5 se queda < 0.6 (control).
2. **Recordar un bit**: el bit llega en `obs` en el paso 0 y la recompensa en el paso 5 si la elección
   coincide; con `gru` de 8 → > 95 % en 3 000 episodios; sin memoria ≤ 60 % (control); BPTT
   truncado a 2 pasos → falla (control del truncado).
3. **Evolución**: `dense(1)` maximizando `−(w−0.7)²` → `|w−0.7| < 0.05` en 100 pasos; con
   `frozen` no cambia.
4. **Corazonada**: recompensa constante 1 → `V → 1 ± 0.01`.
5. **Recompensa**: tabla §2 sobre eventos fijos (cada término a la decisión correcta; `τ` mezcla;
   normalización con estadísticas conocidas; hito se guarda solo al mejorar).
6. **Determinismo** del entreno (§5) y **parada**: `stop` durante un lote deja el fichero válido.
7. Curva de aprendizaje real corta: red plantilla "Vidente" (spec/08 §7) contra copia congelada,
   40 partidas sin pantalla → la tasa de kill por disparo sube (media de 3 semillas, sin puerta de
   aprendizaje ✅: el test solo exige que el mecanismo funcione, no un nivel).

## 9. API exacta (fijado antes de los tests de F4)

### 9.1 Eventos de la sala (subconjunto de spec/07 §1; `room.events`, `playGame().events`)
`{id, t, game, turn, type, actor:{playerId, soldierId, netId}, data}`; `id` correlativo desde 1;
`game` = `room.gameId` = `"g-<seed>-<code>"`. Tipos y `data` en F4:
`game.start` `{seed, map, soldiers, players:[{playerId, name, netId, agentType, team}]}` ·
`decision` `{phase, chosen, chosenMove}` (la decisión completa vive en `room.decisions`; el evento
recibe el mismo `id`, que se escribe en `decision.eventId`) · `shot` `{mode, expr, family, params,
angle, result:{type, soldierId}, minDist, minAllyDist, decisionEventId}` · `move` `{from, to,
requested, slid, stayed, coverBefore, coverAfter, decisionEventId}` · `kill` / `friendlyFire`
`{victimSoldierId, victimPlayerId, victimName, shotEventId}` (actor = tirador) · `death`
`{killerSoldierId, killerPlayerId, killerName, shotEventId}` (actor = víctima) · `map.renew`
`{remaps}` · `win` / `lose` / `draw` `{winner, killsLeft, killsRight, shots, byLimit}` (uno por
jugador, actor = ese jugador). `minAllyDist` = distancia mínima de los puntos del tiro a un aliado
vivo (30 si no hay). `coverBefore/After` = enemigos vivos con línea de tiro al soldado antes y después.

### 9.2 Trayectorias (`agents/net.js`, `playGame().trajectories`)
`trajectories = {playerId: {netId, soldiers: {soldierId: [{turn, phase, obs, decision}]}}}` para
cada jugador `net`; `decision` es el registro de spec/03 §7 (con `eventId` puesto por la sala) y `obs`
la observación exacta con la que decidió (Float64Array, transferible a un hilo). Se registran también
las decisiones de fallback (`decision.error`) — se ignoran al aprender.

### 9.3 `shared/reward.js`
```js
assignRewards({ reward, teamSpirit, events, trajectory, playerId }) →
  { entries: [{ soldierId, turn, phase, decision, obs, terms, own, team, effective }], stats }
returns(values, gamma) → Float64Array          // G_t = Σ γ^(k−t) r_k
normalizeStats(stats, term, value) → valor/σ   // σ = max(0.1, sqrt(var EMA, α = 1/500)); actualiza stats
```
Reglas (§2): `kill/friendlyFire/graze/repeatExpr/nearFriendly` → la decisión `shoot` cuyo `shot` lleva
su `decisionEventId`; `graze` si el resultado no es kill/suicide y `minDist ≤ grazeRadius`;
`repeatExpr` si `expr` coincide con alguno de los 10 tiros anteriores del jugador; `nearFriendly` si
no es suicide y `minAllyDist ≤ 1.5`; `cover` → la decisión `move` × `max(0, coverBefore − coverAfter)`;
`die` → la última decisión (de cualquier fase) de la víctima anterior al `death`; `win/lose` → la
última decisión de **cada** soldado del jugador; `survive` → la última decisión de cada soldado vivo
al final. `own` = Σ términos (normalizados si `reward.normalize`); `team` = media de `own` de todas
las decisiones del jugador en la partida; `effective = (1−τ)·own + τ·team`.

### 9.4 `evo/train.js`
```js
policyGradient(net, genome, episodes, cfg) → { grads: Float64Array, stats: {loss, entropy, valueLoss, steps} }
  // episodes = [{ steps: [{ obs, phase, chosen, chosenMove, adjustSample, moveAdjustSample, advantage, ret }] }]
  // L = −Σ logp·A − β·H + ½·Σ (V − G)² ; memoria replicada desde cero; BPTT truncado cada cfg.bpttSteps pasos
  // (el gradiente que llega del futuro se descarta en las fronteras). adjustLearn:false ⇒ sin término de ajuste.
computeAdvantages(episodes, values, cfg) → episodes   // ret = returns(r, γ); A = ret − baseline (value | mean EMA 0.05 | 0)
adamInit(net) → optim ; applyUpdate(net, grads, optim, { lr, clipNorm, optimizer, frozen }) →
  { gradNorm, clipped, perBlock: {blockId: {name, relChange}}, top: {blockId, relChange} }
evolutionStep(net, fitnessFn, cfg, rng) → { fitness: number[], mean, best }   // ES antitética, rank-normalizada
learnFromGames({ net, genome, games: [{events, trajectory, playerId}], optim, cfg }) → { update, lesson, rewards }
  // asigna recompensas, retornos y ventajas; un paso de gradiente; lesson = {blockId, name, relChange, bulb}
createTrainer({ netId, genome?, opponents, speed, workers, duration, soldiers, seed, learnCfg? }) → trainer
  trainer: { id, status, games, updates, curve, start(), pause(), resume(), stop(), on(ev, fn) }
  // eventos: 'training' {status, games, updates} · 'curve' {game, reward, win, kills, deaths, loss?, entropy?}
  //          'sleep' {games, update} · 'lesson' {lesson} · 'done' {reason} · 'error' {message}
```
- Duración: `{games}` · `{minutes}` · `{plateau:{window, minGain}}` (media móvil de `reward` por partida).
- `speed:'turbo'` con `workers ≥ 1`: `workers = 1` juega en el hilo principal (síncrono, determinista);
  `workers ≥ 2` reparte partidas a `evo/worker.js` (cada hilo recibe los genomas y la semilla de la
  partida y devuelve `{result, events, trajectories}`); las actualizaciones se aplican en orden de
  semilla, así el resultado no depende del número de hilos.
- Con `workers = 1` el entrenador cede el bucle de eventos entre partidas (`setImmediate`): el servidor
  sigue respondiendo. `stop()` pone `status = 'stopped'` en el acto; la partida en curso termina, se
  hace el sueño con lo que haya en el lote y se guarda; después llega el evento `done {reason:'stopped'}`.
- Semillas de partida: `seed + k` para la partida `k` (0, 1, 2…). Rival de cada partida: sorteo con
  `makeRng(seed + 1000003·k)`: `antagonist` (`antagonistId` o, si falta, copia congelada de la propia
  red) · `hallOfFame` (hitos guardados en `evo/nets/<id>/milestones/`; si no hay, cae a `self`) · `self`
  (copia congelada al inicio de cada lote). Lados: la red entrena en el lado `k % 2 ? 'right' : 'left'`.
- Guardado: tras cada lote, `saveNet` (atómico) y `evo/nets/<id>/optim.json`; `reward.stats` y
  `stats.games/wins/kills/deaths` se actualizan en el genoma.
- Hitos: `evo/nets/<id>/milestones/<n>.json` cuando la tasa de victoria móvil (últimas 20 partidas,
  mínimo 20) supera la mejor anterior; evento `milestone`.

### 9.5 Sala a velocidad x10 (`server/rooms.js`)
`new Room(name, {speed: 1 | 10})`: divide por `speed` `NEXT_TURN_DELAY`, la espera de habla y el
retardo de los bots; `TURN_TIME` no cambia. La animación de un disparo dura lo mismo que en x1 dividido **una vez**
entre `speed` (M7, 2026-09-23): `animMsOf(puntos, speed) = mín(9000, máx(700, puntos·NETWORK_STEP/SHOT_SPEED·1000)) /
speed`, exportada por `server/rooms.js`; en x10, de 70 a 900 ms (un tiro de 5 s en x1 dura 0,5 s). `snapshot().config.speed`.
`POST /api/rooms {speed}` (solo agentes; si hay humanos, 400).

### 9.6 API (`/api/lab/trainings`, SSE `/api/lab/events`)
| método | ruta | cuerpo → respuesta |
|---|---|---|
| POST | `/api/lab/trainings` | `{netId, opponents?, speed?, workers?, duration?, soldiers?, seed?}` → `202 {id, status}`; 404 si la red no existe; 409 si ya entrena |
| GET | `/api/lab/trainings` | `{trainings:[{id, netId, status, games, updates, startedAt}]}` |
| GET | `/api/lab/trainings/:id` | `{id, netId, status, games, updates, elapsedMs, curve (últimos 500), sampleGames, lastLesson, config}` |
| POST | `/api/lab/trainings/:id/stop` · `/pause` · `/resume` | `{ok, status}` |
SSE global: `hello {trainings}` · `training` · `curve` · `sleep` · `lesson` · `milestone` · `error`.
`GET /api/lab/nets` marca `training:true` en la red que entrena; `PUT`/`DELETE` sobre ella → 409.

### 9.7 Hilos y lote (M12, medido el 2026-09-23)
Con gradiente (y en la fase de gradiente de "ambos") las partidas de un lote se juegan con los mismos pesos antes del
sueño, así que corren a la vez como mucho `batchGames` (4 por defecto): más hilos no aceleran. Con evolución, las
copias de un paso juegan en paralelo y sí escala. Medido (plantilla Vidente contra plantilla Francotirador, 2 soldados, semilla 77, 32 partidas, turbo):
gradiente 1/2/4/8 hilos = 4,57 / 4,05 / 2,97 / 3,02 s; evolución = 5,35 / 3,57 / 2,21 / 1,55 s; gradiente con
`batchGames` 8 y 8 hilos = 2,18 s, pero con la mitad de sueños. **No se cambia cómo aprende la red** (decisión delegada,
plan2 ronda 16): el panel de entreno avisa, con el aprendizaje de la red, de cuántos hilos se usan de verdad y de cómo
usar más: subir "Partidas por lote" (Científico) o entrenar por evolución (`threadNote`, `test/ui-entreno-hilos`).
`createTrainer` no admite todavía un `learnCfg` propio del entreno (la firma de §9.4 lo cita, pero no está hecho).

**Corrección (auditoría P0, 2026-09-23; P0-M2 y P0-B3).** El tope de partidas a la vez en turbo depende de la parte:
- gradiente: el lote, `batchGames`;
- en "los dos", la parte de gradiente: `min(batchGames, both.gradientGamesPerCycle)`, porque dentro de un ciclo no se
  juegan más partidas de gradiente que las del ciclo (`evo/train.js`, `n = min(hilos, lo que falta del lote, lo que
  falta del ciclo)`);
- evolución (y la parte de evolución de "los dos"): las copias de un paso, `2·⌈population/2⌉ × gamesPerCandidate`
  (las copias van por parejas antitéticas).
`threadNote(learning, hilos, velocidad)` → `null` si no hay nada que avisar; si no, `{used, asked, text}` con `used` =
lo que se usa en la parte que más limita, y el texto dice cuántos hilos usa cada parte
(`todos` si esa parte los llena). Con evolución sola avisa si las copias no llenan los hilos. Los valores que faltan
en `learning` son los de `DEFAULT_LEARNING`.

### 9.8 Duración de un entreno (auditoría P0, 2026-09-23)
`elapsedMs` es el tiempo desde que empezó hasta que acabó (bien, parado o con error); mientras sigue en marcha, hasta
ahora. Un entreno terminado no cambia su `elapsedMs` aunque se pida más tarde (antes seguía contando para siempre).

## 10. Arreglos tras la revisión de Opus (2026-09-23, `spec/revision-opus.md` C3, C4, A1, A2)
Decisiones del usuario del 2026-09-23: "arréglalo tú"; evolución = concurso tras el duelo; a x1/x10 se ve la
red real en vivo; bofetada con efecto inmediato. Completan §1–§9 sin cambiar lo que ya decían.

### 10.1 Cada partida es un mundo aparte (C4)
- `learnFromGames` agrupa las decisiones por **(partida, soldado)**: dos partidas nunca se mezclan en un episodio,
  aunque sus ids de soldado o de evento coincidan (partidas de hilos distintos, partidas clonadas).
- Devuelve además `episodes: [{game, soldierId, steps}]` (índice de la partida en `games`, soldado, nº de pasos),
  y cada emoción lleva `game` (ese mismo índice).
- Cada partida de muestra recibe **solo sus emociones**: como mucho una por decisión de la red que aprende.
- Invariante de §9.4, ahora probada con 4 hilos y 2 soldados: los pesos finales son idénticos bit a bit a los de
  1 hilo.

### 10.2 Cómo aprende: gradiente, evolución o ambos (C3)
- `method: 'gradient'`: como hasta ahora.
- `method: 'evolution'` en un entreno. Cada **paso de evolución** `e = 0, 1, …`:
  1. rival del paso = el sorteo de la mezcla de rivales (§6) con `makeRng(seed + 1000003·e)`; soldados =
     `soldiersFor(e)`;
  2. `population` copias antitéticas `θ ± σ·ε` (los bloques congelados no se perturban), y cada copia juega
     `gamesPerCandidate` partidas sin pantalla con **las mismas semillas para todas**: `seed + 100003·(e+1) + j`;
     la partida `j` de cada copia se juega a la izquierda si `j` es par y a la derecha si es impar;
  3. fitness de una copia = media, sobre sus partidas, de la recompensa efectiva media por decisión (la misma
     magnitud que la curva). Las estadísticas de normalización se congelan durante el paso, así todas las copias
     se miden igual;
  4. `θ ← θ + lr/(population·σ)·Σ F·ε`, con ranking si `rankNormalize` (= `evolutionStep`, §4);
  5. **una partida de la red real** contra el mismo rival, semilla `seed + 100003·(e+1) + gamesPerCandidate`, a la
     izquierda en los pasos pares y a la derecha en los impares (turbo: sin pantalla; x1/x10: sala viva espectable,
     `rooms[]`). Cuenta en la curva (`point.kind = 'showcase'`), en `stats`, en la memoria, y se guarda como
     partida de muestra (con eventos `reward` y `emotion`).
  - `training.games` cuenta **todas** las partidas jugadas (copias + red real) y es lo que mide
    `duration.games`; la curva solo tiene las partidas de la red real. `training.steps` = pasos de evolución.
  - Evento `sleep` por paso con `update = {kind: 'evolution', step, population, sigma, games, meanFitness,
    bestFitness, perBlock, top}` y la lección como en el gradiente (bloque con mayor `relChange`). Línea `update`
    en el log con `kind: 'evolution'`.
  - Turbo con `workers ≥ 2`: las partidas de las copias se reparten entre hilos; el resultado es el mismo que con
    1 hilo.
- Función: `evolutionRound({net, genome, rival, soldiers, seeds, cfg, rng, play}) → Promise<{update, lesson, fitness}>`:
  `plan = planEvolution(net, cfg, rng)` (candidatos en orden `θ+ε₀, θ−ε₀, θ+ε₁, …`); para cada candidato, en ese orden,
  las partidas `j = 0 … seeds.length−1` con `play({seed: seeds[j], left, right, soldiers})` (la copia lleva `learn: true`
  y juega a la izquierda si `j` es par); `fitness[i]` = media sobre `j` de `Σ effective / nº de decisiones` de la copia
  (con `assignRewards` y una copia congelada de `reward.stats` en cada partida; 0 si no decidió nada); después
  `applyEvolution(net, plan, fitness, cfg)`. `soldiers` puede ser un número o una función `j → número`. `update` y
  `lesson` como arriba. `play` es inyectable (tests); por defecto juega sin pantalla cediendo el bucle entre partidas.
- Ruido de las copias: `rng = makeRng(seed + 7·(e+1))` en el paso `e` de un entreno, `makeRng(duelSeed + 7)` tras un
  duelo y `makeRng(roomSeed + 7)` tras una exhibición. Cada paso fuera de un entreno deja una línea `update` en el log
  con `kind: 'evolution'` y `duelId` o `roomCode`. Las actualizaciones por gradiente llevan `kind: 'gradient'`.
- `method: 'both'`: un ciclo son `both.gradientGamesPerCycle` partidas con gradiente (con sus sueños por lote)
  seguidas de `both.evolutionStepsPerCycle` pasos de evolución. El ciclo se repite.
- Duelos (spec/06 §6.2): una red `gradient` aprende como hasta ahora (frozen/hot/mix). Una red `evolution` no
  aprende partida a partida: **al acabar el duelo hace un paso de evolución contra la rival del duelo** (semillas
  `duelSeed + 100003 + j`; soldados: los del duelo si son fijos, y si son `'random'`, `1 + makeRng(duelSeed + 100003 + j).int(4)`),
  sea cual sea el modo del duelo. La rival es su genoma al acabar el duelo. Las partidas del duelo sí entran en su memoria. Una red `both` aprende por gradiente según el modo y
  además hace ese paso al final.
- Exhibiciones con `learn:true` (§10.3): la misma regla, con la rival de la sala, sus soldados y las semillas
  `roomSeed + 100003 + j`.

### 10.3 Exhibiciones (A2)
- Salas creadas con `POST /api/rooms`: al terminar la partida, cada red sentada que no esté entrenando:
  - suma `stats.games` (nunca `wins`/`kills`/`deaths`: es una exhibición, §7);
  - guarda la partida (`meta.kind = 'exhibition'`, con eventos y trayectorias) para la moviola y la bofetada;
  - absorbe la partida en su memoria (spec/07 §6);
  - si `learn: true`, aprende según su método (§10.2), guarda red y `optim.json`, y emite `sleep`/`lesson` por el
    SSE del laboratorio y las líneas `update`/`lesson` del log, como un sueño.
- Una red que está entrenando no se toca: el entreno la sobrescribiría al guardar. Queda una línea
  `exhibition.skipped` en el log.
- Las salas del entrenador y de los duelos no pasan por aquí: ya aprenden a su manera.

### 10.4 Bofetada y caricia con efecto inmediato (A1)
- `POST /api/lab/nets/:id/slap|caress {game, decisionEventId, amount = 1}`:
  - la decisión tiene que ser de esta red (`actor.netId === id`) y la partida tiene que guardar lo que vio en esa
    decisión (la trayectoria); si no, `400` con el motivo;
  - `reward = ∓amount·reward.slapCaress` (bofetada −, caricia +);
  - si la red **no** está entrenando, se aplica **ya**: un paso de gradiente solo sobre esa decisión (ventaja =
    `reward`, sin entropía ni valor; la memoria de la red se reproduce desde el principio de la trayectoria del
    soldado, como en la moviola), con la tasa de aprendizaje de la red; se guardan red y `optim.json`; y queda un
    recuerdo en su memoria (`slap` → `shame`, `caress` → `pride`, intensidad `min(1, |reward|)`, `ref` = el evento
    `slap|caress` de la partida). Respuesta `{ok, reward, kind, applied: true, update: {pBefore, pAfter,
    relChange, top}}`, donde `pBefore`/`pAfter` = probabilidad de lo que eligió en esa decisión antes y después;
  - si la red está entrenando, queda pendiente y **el siguiente sueño** del entreno la aplica con el mismo paso.
    Respuesta `{ok, reward, kind, applied: false, queued: true}`.
- `GET /api/lab/nets/:id/feedback → {pending, applied}` (`applied`: las 50 últimas, con `pBefore`/`pAfter`).

### 10.5 Precisiones tras la revisión de Fable (2026-09-23, `spec/revision-opus.md` §9: R1, R2, R4)
Decisiones del usuario del 2026-09-23: "red ocupada" (R2) y, contra una persona, "contra sí misma" (R4).
Completan §10.2–§10.4 sin cambiar lo que ya decían.
- **El paso de evolución cede el bucle de verdad (R1).** Con `play` por defecto, las partidas de un paso se juegan
  **una detrás de otra** y antes de cada una se cede el bucle de eventos (`setImmediate`): el servidor responde
  entre partida y partida. Antes se lanzaban todas a la vez con `Promise.all` y todas las cesiones caían en la
  misma vuelta del bucle, así que el servidor quedaba bloqueado todo el paso (16,4 s en la sonda de §9). Vale para
  toda partida sin pantalla que se juegue así en el proceso del servidor (pasos de evolución de entrenos sin hilos,
  de duelos y de exhibiciones, y la partida de la red real en turbo sin hilos). Con hilos, las partidas se
  reparten entre ellos como antes. Los resultados no cambian: cada partida depende solo de su semilla.
- **Red ocupada (R2).** Una red está ocupada mientras **entrena** (como hasta ahora), mientras **juega un duelo**
  (`runDuel`: duelos del API, de trono y de dinastías; desde que empieza hasta que guarda, incluido el paso de
  evolución del final) y mientras **aprende de una exhibición** (desde que acaba la partida hasta que guarda su
  paso de evolución). `heldBy(netId)` (`evo/busy.js`) → `{kind: 'duel'|'exhibition', id}` o `null`.
  - Todo lo que hoy responde 409 porque la red está entrenando responde también 409 si está ocupada, con el
    motivo: editar (`PUT`), borrar, pedir hijos, operar, examinar, entrenar, retar, criar una generación y
    empezar un duelo. Por ejemplo: `Nova está en el duelo d…: espera a que acabe para editarla o borrarla.`
    En un reto, la reina también cuenta: si está ocupada, el reto responde 409.
  - La bofetada o caricia a una red ocupada **queda en cola** (`{ok, reward, kind, applied: false, queued: true}`),
    igual que al entrenar. Cuando quien la tenía la suelta (fin del duelo, fin del paso de la exhibición), si
    nadie más la tiene, lo que haya en cola se aplica **ya**, con el mismo paso de §10.4: pesos, `optim.json`,
    recuerdo y una entrada en `applied`. Si la red está entrenando, lo sigue aplicando el siguiente sueño.
  - Una exhibición que acaba con una red ocupada no la toca: queda `exhibition.skipped` con el motivo.
  - Motivo del cambio: quien tenía la red la guardaba al final con los pesos que cargó al empezar. Lo que se le
    hubiera hecho mientras tanto (bofetadas "aplicadas", ediciones) se perdía sin aviso.
- **Exhibición contra una persona (R4).** Si en una exhibición con `learn:true` la rival es una persona o un
  agente externo (se sentó con `join`, no con `addagent`), su juego no se puede repetir. Por eso las copias del
  paso de evolución juegan **contra la propia red, tal como estaba al acabar la partida** (antes de aprender de
  ella), con `learn: false`. La línea `update` de una exhibición lleva `rival`: el id de la red rival, el tipo de
  agente, o `'self'` si juega contra sí misma.

## 11. Receta de entreno (ronda 17, 2026-09-23)
Lo que un entreno trae **solo para ese entreno**, sin cambiar la red guardada (la red es el cuerpo; la receta, cómo se
entrena esta vez). Decisión del usuario: `learnCfg` y además programas, currículo, recompensa de práctica, congelar
solo en este entreno, examen antes y después, versión antes del entreno y quedarse con la mejor. Referencias: Unity
ML-Agents (`learning_rate_schedule`, `beta_schedule`, `curriculum` con `completion_criteria`) y Huang et al. 2022,
"The 37 implementation details of PPO" (recocido lineal de la tasa).

Todos los campos son opcionales y van en el cuerpo de `POST /api/lab/trainings` (y en el `training` de `POST
/api/lab/dynasties/generation`). `createTrainer(opts)` los recibe con los mismos nombres; `learning` es el `learnCfg`
de §9.4 (sustituye al `learn` interno, que solo pisaba el gradiente).
```json
{ "learning": { "method": "both", "gradient": { "lr": 0.01, "batchGames": 8 }, "evolution": { "sigma": 0.05 } },
  "schedule": { "lr": { "shape": "linear", "to": 0.0003 }, "entropy": { "shape": "cosine", "to": 0 },
                "temperature": { "shape": "linear", "from": 1.5, "to": 0.8 }, "sigma": { "shape": "linear", "to": 0.005 } },
  "reward": { "graze": 0.5 },
  "frozen": ["d", "g"],
  "curriculum": [
    { "name": "Uno contra uno", "soldiers": 1, "opponents": { "antagonist": 0, "hallOfFame": 0, "self": 1 },
      "until": { "winRate": 0.6, "window": 20, "minGames": 40 } },
    { "name": "Contra la reina", "soldiers": 2, "opponents": { "antagonist": 1, "hallOfFame": 0, "self": 0 }, "until": { "games": 100 } },
    { "name": "Al azar", "soldiers": "random" } ],
  "exam": true,
  "keepBest": true }
```

### 11.1 Aprendizaje (`learning`, el learnCfg)
- Se mezcla por secciones sobre `genome.learning` (`method`, `gradient`, `evolution`, `both`, `sleep`): lo que trae la
  receta gana; lo demás es lo de la red. Mismos rangos y valores que el genoma (§1, `LEARNING_RANGES`); los enteros
  (`batchGames`, `bpttSteps`, `population`, `gamesPerCandidate`, `gradientGamesPerCycle`, `evolutionStepsPerCycle`)
  tienen que ser enteros; `baseline` ∈ {value, mean, none}; `optimizer` ∈ {adam, sgd}; `adjustLearn`, `antithetic`,
  `rankNormalize` son sí/no. Una clave desconocida es un error (una clave mal escrita no se ignora en silencio).
- Todo el entreno (gradiente, evolución, "los dos", umbral de la bombilla) usa el aprendizaje mezclado. La red en disco
  conserva el suyo. El estado de Adam es el de la red (cambiar `optimizer` a sgd solo este entreno no lo borra).

### 11.2 Programas (`schedule`)
- Cada entrada `{shape: constant | linear | cosine, to, from?}` para `lr` (gradiente), `entropy` (gradiente),
  `temperature` (la temperatura con la que juega y aprende) y `sigma` (ruido de la evolución). `from` por defecto:
  el valor del aprendizaje mezclado (`lr`, `entropy`, `sigma`) o `traits.temperature` de la red. Rangos de `from` y
  `to`: los del parámetro (`LEARNING_RANGES`; temperatura, `TRAIT_RANGES`).
- Valor con el avance `p ∈ [0, 1]`: `constant` = from · `linear` = from + (to − from)·p · `cosine` = to + (from −
  to)·(1 + cos(π·p))/2.
- Avance: con `duration.games = N`, `p = partidas jugadas / N` al **empezar** el lote (o el paso de evolución); con
  `duration.minutes`, el tiempo transcurrido entre el total. Con `plateau` no se sabe cuánto dura: un programa con
  meseta es un **400** ("los programas necesitan saber cuánto dura el entreno: usa partidas o minutos").
- Cuándo se aplica: la temperatura se fija al empezar cada lote de gradiente y vale para todas sus partidas y para su
  sueño (así cada lote aprende de las probabilidades con las que de verdad jugó); la copia de sí misma contra la que
  juega (`self`) también la usa, porque es ella misma en ese lote (como en el autojuego de AlphaZero); la reina, la
  sala de la fama y las demás rivales juegan con la suya. `lr` y `entropy`, en ese mismo
  sueño, con el mismo `p`. En evolución, `sigma` y la temperatura se fijan al empezar cada paso (copias y partida de
  la red real). El evento `sleep` y la línea `update` del registro llevan `applied: {lr, entropy, temperature}` (o
  `{sigma, temperature}` en evolución).

### 11.3 Recompensa de práctica (`reward`)
- Pesos de términos de `REWARD_TERMS` (−5..5) que, durante este entreno, sustituyen a los de la red. Otra clave → 400.
- Normalización (§2) aparte: los términos cuyo peso cambia empiezan con estadísticas vacías; los demás, con una copia
  de las de la red. Nada de eso se guarda en la red: al acabar, `genome.reward` (pesos y `stats`) es el de antes. La
  curva, las emociones y la fitness de la evolución de este entreno salen de la recompensa de práctica.
- Si hay lecciones con su propia recompensa, cada combinación distinta de pesos lleva sus estadísticas (con la misma
  regla) y las conserva si vuelve a usarse. Función pura `mergeReward(netReward, ...capas) → {reward, stats}` (las
  capas, de menos a más prioridad) en `evo/recipe.js`; un término que acaba con el mismo peso que el de la red cuenta
  como no cambiado.
- Si ningún peso cambia (sin `reward` ni lecciones con recompensa), el entreno usa las estadísticas de la red como
  siempre y las guarda.

### 11.4 Congelar solo en este entreno (`frozen`)
- Lista de ids de bloques con pesos. Durante el entreno, congelados = los de la red **más** estos (una receta nunca
  descongela lo que la red protege: eso se hace en el Quirófano). Lo respetan el gradiente, la evolución y las
  bofetadas y caricias que se apliquen durante el entreno. `genome.frozen` en disco no cambia.
- Errores 400: un id que no existe o sin pesos; todos los bloques con pesos congelados ("no queda nada que aprender").

### 11.5 Currículo por lecciones (`curriculum`)
- De 1 a 16 lecciones `{name (1–40 caracteres), soldiers?, opponents?, reward?, until?}`. Mientras dura una lección,
  sus `soldiers` y `opponents` sustituyen a los del entreno, y su `reward` se pone encima de la de práctica (lección,
  luego receta, luego red). Con `exploiter`, ninguna lección puede traer `opponents` (400).
- Regla de paso `until` (medida sobre las partidas **de esa lección**): `{games: n ≥ 1}` · `{winRate: 0..1, window:
  5..100 (20), minGames ≥ window (window)}` · `{reward: x, window, minGames}` (recompensa media por partida). Se mira
  al registrar cada partida; si se cumple, la siguiente partida ya es de la lección siguiente. La última lección no
  tiene regla (si la trae, no pasa nada al cumplirla) y dura hasta que acabe el entreno, que siempre manda su
  `duration`. En evolución, la medida son las partidas de la red real de cada paso.
- Evento SSE `curriculum {id, trainingId, netId, lesson, name, reason: start | met, games}` y línea `curriculum` en el
  registro. La vista lleva `curriculum: [{name, from, to, met, measure}]` y la lección en curso.

### 11.6 Examen antes y después (`exam: true`)
- Boletín (spec/07 §7, semillas fijas) de la red **tal como es** (con su temperatura, no la del entreno) antes de la
  primera partida y al final, después del último sueño y de "quedarse con la mejor". La vista lleva `exam: {before,
  after}` (`{aim, cover, survival, adaptation}`); eventos `exam {netId, trainingId, when: before | after, …}`, líneas
  `exam` en el registro con `trainingId`, y el de después pasa a ser el boletín de la red. Mientras examina, `phase`
  es `exam-before` o `exam-after` (entrenando, `training`; al acabar, `done`, `stopped` o `error`). Si se para el
  entreno, no hay examen de después (`exam.after` falta): parar es parar.

### 11.7 Versión antes del entreno (siempre)
- Antes de la primera partida se guarda una **versión** de la red tal como estaba: `evo/nets/<id>/versions/<n>.json`
  (`{n, ts, reason, trainingId?, genome}`, `n` creciente; se quedan las 50 últimas). La vista del entreno lleva
  `versionBefore: n`. En `evo/store.js`: `saveVersion(genome, {reason, trainingId}) → n`, `listVersions(netId)` (la más
  nueva primero, sin el genoma) y `loadVersion(netId, n)` (o null).
- API: `GET /api/lab/nets/:id/versions` → `{versions: [{n, ts, reason, trainingId, paramCount}]}` (la más nueva
  primero) · `GET …/versions/:n` → `{n, ts, reason, trainingId, genome}` · `GET …/versions/:n/diff` → la diferencia
  de esa versión a la red de ahora (misma forma que spec/05 §5) · `POST …/versions/:n/restore` → la red vuelve a esa
  versión: pesos, bloques, cables, aprendizaje, recompensa, rasgos, congelados, Imaginación y los nombres de sus
  neuronas (van con su cuerpo); conserva su id, su nombre, sus estadísticas, su memoria y su linaje (lo vivido no se
  borra). El estado de Adam no se versiona: si la estructura cambió, se reinicia solo al cargarse. Antes de volver, la red de ahora se guarda
  como otra versión (se puede deshacer). 404 si no existe; 409 si la red está ocupada (entrena, duelo, exhibición).

### 11.8 Quedarse con la mejor (`keepBest: true`)
- Tras cada partida, con 20 o más jugadas en este entreno, `tasa20` = victorias de las 20 últimas / 20. Cuando supera
  la mejor hasta ahora, se guarda una copia de los pesos de ese momento. Al acabar (tras el último sueño), si la
  `tasa20` final es menor que la mejor, la red vuelve a esos pesos. Vuelven los pesos: sus estadísticas, su memoria y
  el estado de Adam se quedan con todo lo jugado.
- La vista lleva `keptBest: {best, final, atGame, restored}` o `{restored: false, reason: "menos de 20 partidas"}`;
  línea `keepBest` en el registro. Aviso que la interfaz enseña: la mejor tasa se midió contra la mezcla de rivales de
  aquel momento.

### 11.9 Vista, errores y determinismo
- `GET /api/lab/trainings/:id` añade `recipe` (lo que se pidió), `phase`, `lesson` (`{index, name}` o null),
  `applied` (lo último aplicado), `exam`, `versionBefore` y `keptBest`.
- Toda la receta se valida al crear el entreno: cualquier error es un **400** con su motivo en español y un ejemplo,
  y no se crea nada. La validación es una función pura, `validateRecipe(body, genome) → {ok, errors, recipe}`, en
  `evo/recipe.js`, junto con el valor de un programa (`scheduleValue({shape, from, to}, p)`), el avance
  (`progressOf(duration, {games, elapsedMs})`, null con meseta), la recompensa (`mergeReward`), el currículo
  (`createCurriculum(lecciones)` → `{index(), lesson(), record({game, win, reward}) → null | {from, to, measure,
  games}, summary()}`) y la mejor versión (`createBestTracker(20)` → `{record(win, game) → mejoró, result() → null |
  {best, final, atGame}}`).
- Misma receta y misma semilla → mismo entreno (con `duration.minutes`, el avance de los programas depende del reloj).
