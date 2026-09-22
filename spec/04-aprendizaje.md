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
  "sleep":     { "lessonThreshold": 0.05 } }
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
  `relChange > lessonThreshold`).

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
retardo de los bots, y multiplica `SHOT_SPEED`; `TURN_TIME` no cambia. `snapshot().config.speed`.
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
