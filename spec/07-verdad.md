# 07 — Verdad: eventos, atribución, confianza, emoción, memoria, neuronas, boletín, lección (F7)

> Contrato exacto de `evo/truth.js`. Fuente: plan2.md rondas 3, 4, 5, 7, 9; §4.8; §6.2 (1, 4).
> Regla ✅ **exacto y real**: toda frase mostrada lleva `refs` a eventos y cada número y nombre de la
> frase está en esos eventos. Un test lo comprueba (§2). Nada inventado.

## 1. Registro de eventos (`evo/games/<gameId>.json` = `{meta, events}`)
Evento: `{ id, t, game, turn, type, actor: {playerId, soldierId, netId?}, target?, data, refs? }`.
`id` = entero creciente por partida; `t` = ms; `turn` = nº de disparo de la partida (0 al inicio).
| `type` | `data` |
|---|---|
| `game.start` | `{seed, map:{name, biome}, soldiers, players:[{playerId, name, netId?, agentType, team}]}` |
| `map.renew` | `{map, remaps}` |
| `decision` | el registro de spec/03 §7 completo (sin `points` si `speed: turbo`) |
| `shot` | `{mode, expr, exprLocal?, family?, params?, angle, result:{type, soldierId, x, y}, minDist, pointsCount}` |
| `move` | `lastMove` (spec/01 §4) + `{coverBefore, coverAfter}` |
| `kill` / `friendlyFire` | `{victimSoldierId, victimPlayerId, victimName, shotEventId}` (actor = tirador) |
| `death` | `{killerSoldierId, killerName, shotEventId}` (actor = víctima) |
| `graze` | `{soldierId, dist, shotEventId}` |
| `win` / `lose` / `draw` | `{winner, killsLeft, killsRight, shots, byLimit}` (actor = cada jugador) |
| `reward` | `{decisionEventId, terms:{kill:1, …}, own, team, effective, normalized, tau}` |
| `update` | `{netId, games, loss, entropy, gradNorm, perBlock:{blockId:{name, relChange}}, top:{blockId, relChange}}` |
| `lesson` | frase (§2) + `{blockId, relChange, bulb}` |
| `slap` / `caress` | `{decisionEventId, amount, term}` (actor = usuario) |
| `emotion` | `{decisionEventId, hope, fear, joy, disappointment, surprise, V, advantage}` |
| `say` | frase (§2) + `{kind: say|think, confidence, level}` |
| `exam` | `{netId, seed, aim, cover, survival, adaptation, details}` |
| `milestone` | `{netId, kind: winrate|exam, value, snapshot}` |
| `challenge` / `reign.start` / `reign.end` / `dynasty` / `ghost` | (spec/06) |
| `neuron.name` | `{netId, blockId, index, name, corr, feature, m}` |
| `error` | `{message, fallback}` |
Retención: 200 partidas por red (se borran las más viejas que no sean de duelos de trono); 5 000
eventos por partida (tope duro: al superarlo, `error` y se deja de registrar `decision` completos).
Los eventos de trono/dinastías/entrenos van a `evo/log.jsonl` (una línea por evento, sin tope,
rotación a 50 MB).

## 2. Frases y verificador (`checkPhrase`)
```json
{ "text": "Dijiste #2 y fallaste por 0.4, Orca-2.", "refs": [ { "game": "g901", "id": 88 }, { "game": "g901", "id": 91 } ],
  "numbers": ["2", "0.4"], "names": ["Orca-2"], "kind": "say", "netId": "hydra-7", "t": 1758540000000 }
```
`checkPhrase(phrase, loadEvents) → {ok, missing:{numbers:[], names:[]}}`:
- **Números**: cada `-?\d+(?:[.,]\d+)?` del texto (también tras `#`) debe coincidir con algún valor
  numérico de los eventos referenciados (búsqueda profunda en `data`, `actor`, `turn`, `id`), comparado
  tras redondear ambos a los decimales del texto (0–2). `#k` debe ser un índice de candidato o de
  destino presente en una `decision` referenciada.
- **Nombres**: cada palabra con mayúscula inicial que no empiece frase, y cada token con guion
  (`Orca-2`), debe aparecer en algún campo de texto de los eventos referenciados (`name`, `netId`,
  `victimName`, `map.name`, `killerName`, `blockId`/`name` de bloque). Lista de palabras comunes
  exentas (`Sí`, `No`, `Mmm`, `Otra`, `Vale`, …) en `truth.js:STOPWORDS`.
- Toda frase pasa por `checkPhrase` **antes** de mostrarse; si falla, no se emite y se registra
  `error` (`{message:'frase no verificable', text}`). Test: frases válidas pasan; un número o nombre
  inventado falla.
- Los **generadores** de frases (voz, lección, diario, cronista) son de Opus (no crítico) pero solo
  pueden componerlas con `truth.compose(template, slots)`: cada hueco toma valor de un evento y añade
  la referencia; `compose` rechaza huecos sin evento.

## 3. Atribución ("tapar y comparar") — en `policy.js`, spec/03 §7
Evento `decision.attribution`. Frase mínima de Opus: "Miraba sobre todo el Mapa (60 %): sin él, la
#4 baja de 0.82 a 0.40" → números `60`, `4`, `0.82`, `0.40` están en la `decision`.

## 4. Confianza (real) — por decisión
- `certainty = certaintyOf(candidates)` = p(favorita) − p(segunda) de la decisión ∈ [0, 1] (1 con un solo candidato,
  0 sin ninguno): lo decidida que estaba la red, sea cual sea el candidato que salió del sorteo (M1, 2026-09-23). El
  `margin` del registro (spec/03 §7) sigue siendo el del elegido: negativo si el muestreo no cogió a la favorita.
- `experience = (1 − e^(−games/50)) · (0.5 + 0.5·recentAccuracy)`, con `recentAccuracy` = kills /
  disparos en los últimos 20 disparos de la red (0.5 si no hay).
- `confidence = certainty × experience`; nivel: `< 0.15` novata (piensa en voz baja, duda) ·
  `0.15–0.5` · `> 0.5` veterana (anuncia, se burla, replica). Los tres números van en `say.data`.
- **Va ganando confianza y hablando más** ✅: probabilidad de `say` = `0.2 + 0.6·confidence`.

## 5. Emociones calculadas del RL — evento `emotion` tras la recompensa de cada decisión
`V` = `hand.value` (o baseline media; con `baseline:none` → `hope = fear = 0` y la interfaz lo dice).
`A` = ventaja. `hope = clamp(V, 0, 1)`, `fear = clamp(−V, 0, 1)`, `joy = A > 0 ? tanh(A) : 0`,
`disappointment = A < 0 ? tanh(−A) : 0`, `surprise = tanh(|A|)`. Sin teatro: todo sale de los números.

## 6. Memoria episódica emocional y de rivales (`genome.memory`, no se hereda)
```json
{ "episodes": [ { "ref": { "game": "g901", "id": 88 }, "rivalId": "orca-2", "biome": "fortaleza", "family": "parabola",
                  "outcome": "death", "emotion": "grudge", "intensity": 0.9, "gamesAgo": 0 } ],
  "rivals": { "orca-2": { "alias": null, "games": 12, "wins": 5, "killsBy": 9, "killsOf": 7, "pride": 7, "grudge": 9, "respect": 0.58 } } }
```
- Se añade un episodio en `kill` (orgullo), `death` (rencor), `graze` con dist < 1 (susto/miedo),
  `friendlyFire` (vergüenza), `reign.start` (orgullo), `reign.end` (rencor), `challenge` perdido.
  `intensity` = `|r efectiva|` normalizada (cap 1); `respect` = tasa de victoria del rival contra mí.
- Recuperación por **asociación**: `recall(memory, ctx) → top 3` con puntuación
  `intensity · 0.9^gamesAgo · (1 + [mismo rival] + 0.5·[mismo bioma] + 0.5·[misma familia] + 0.5·[mismo resultado])`.
  Lo reciente e intenso pesa más (como la memoria humana). Máximo 300 episodios (se borra el de menor
  puntuación). Los eventos recuperados se pasan a la voz como `refs`.
- Cohesión: `alias` estable por rival (lo fija la voz la primera vez); contradicciones: si dijo
  "fácil" (`say.data.claim = 'easy'`) y falló, la voz siguiente recibe `claimFailed:true`.

## 7. Boletín de habilidades ✅ (`POST /api/lab/nets/:id/bulletin`, exámenes con semilla fija)
| examen | qué | semilla | puntuación 0..1 |
|---|---|---|---|
| puntería `aim` | 40 escenas de un disparo contra blancos quietos | 9001 | kills / 40 |
| cobertura `cover` | 30 escenas de movimiento | 9002 | fracción de destinos con menos enemigos con LOS que antes |
| supervivencia `survival` | 10 partidas sin pantalla contra Sniper L3 (2 soldados) | 9003 | soldados vivos al final / total |
| adaptación `adaptation` | 12 partidas vs Greedy L3 con 1, 2, 3, 4 soldados (3 de cada) | 9004 | 1 − (max − min) de la tasa de victoria por tamaño |
Evento `exam` con `details` (por escena). Radar de Opus. Los heurísticos de examen **no** entrenan la
red (`learn:false` siempre).

## 8. Lección del sueño ✅ (evento `lesson`)
Del `update`: bloque con mayor `relChange` (`‖ΔW‖/‖W‖`); `bulb = relChange > lessonThreshold`.
Frase (Opus, con `compose`): "Lo que más cambió fue Instinto b3 (+12.3 %)"; refs = `update`.

## 9. Neuronas con nombre ✅ (`GET/PUT /api/lab/nets/:id/neurons`)
Para cada unidad de cada `dense`/memoria: correlación de Pearson de su activación con cada entrada
nombrada (los layouts de spec/03 §2) y con `kill`/`suicide`, sobre las últimas `m = 500` decisiones
(mínimo 50). `name` = nombre de la entrada con mayor `|corr|` si `|corr| > 0.3`, si no "sin nombre
claro". Renombrable (`names.neurons[blockId][i]`, se guarda en el genoma; sobrevive a mutaciones que
no borren la unidad). Evento `neuron.name` con `corr`, `feature`, `m` (para la frase).

## 10. Diario, cronista, moviola (datos; la redacción es de Opus)
- Diario (`GET /api/lab/nets/:id/diary`): lista de frases (`lesson`, `milestone`, `reign.*`,
  `challenge`, `exam`) con `refs`, más reciente primero.
- Cronista (`GET /api/lab/chronicle`): frases de temporada (reinados, defensas, generaciones de
  dinastías) con `refs` a `evo/log.jsonl`.
- Moviola (`GET /api/lab/games/:id`): `{meta, events}` completos; `GET .../turns/:n/brain` →
  activaciones completas de la `decision` del turno `n` (recalculadas desde `obs` y el genoma de
  entonces: se guarda `netSha` en `game.start` y una copia del genoma en `evo/games/<id>.nets.json`
  solo para duelos de trono; para el resto, se recalcula con la red actual y se marca `approx:true`).
  **Desde M2 (2026-09-23)** toda partida guardada lleva en `meta.snaps = {netId: huella}` la red tal como jugó
  (duelos, exhibiciones y partidas de muestra de los entrenos), así que la moviola es exacta (`approx:false`) salvo en
  partidas antiguas sin copia.

## 11. Tests de F7 (`test/verdad.spec.mjs`)
- `checkPhrase`: 10 frases válidas sobre una partida fija pasan; número inventado, nombre inventado,
  `#9` inexistente, ref a otra partida → fallan con el `missing` correcto.
- `compose` rechaza huecos sin evento.
- Confianza y emoción: fórmulas sobre valores fijos (tabla).
- Memoria: episodios de una partida fija; `recall` ordena por la fórmula; tope 300.
- Boletín: determinista (misma semilla → mismas puntuaciones); Sniper L3 ≥ red vacía en puntería.
- Neuronas: una unidad artificialmente igual a una entrada recibe su nombre; ruido → "sin nombre claro".
- Registro: tope de eventos; retención por red; `evo/log.jsonl` rota.

## 12. Precisiones de F7 (fijadas al escribir los tests; completan §1–§11 sin cambiarlos)

### 12.1 Registro y ficheros
- Fichero de partida `evo/games/<gameId>.json.gz` (M15, 2026-09-23: gzip del JSON; las antiguas en `.json` se siguen
  leyendo) = `{meta, events, trajectories}`. `meta = {gameId, kind:
  duel|training|exam, duelId?, trainingId?, seed, soldiers, left, right, nets: [ids], winner, kills, throne?,
  netSha: {id: sha de estructura}, snaps?: {id: huella}, ts}`. `trajectories` = las de spec/04 §9.2 (con `obs`), para
  la moviola.
- **Índice (M15)**: `evo/games/index.jsonl`, una línea `{a: meta}` al guardar y `{d: gameId}` al borrar; `listGames`
  lee solo el índice (si falta, lo reconstruye con las metas `<id>.meta.json` de al lado) y lo compacta cuando pasa
  del doble de líneas que partidas vivas + 200.
- **Copias de las redes (M2)**: `saveGame(meta, events, trajectories, {genomes})` guarda cada genoma una sola vez en
  `evo/snapshots/<huella>.json.gz` (huella = sha-256 del JSON, 20 cifras) y lo cita en `meta.snaps`;
  `loadSnapshot(huella)` lo devuelve. Al podar partidas (retención) se borran las copias que ya no cita ninguna.
- `decision` en la sala: `data` = el registro completo de spec/03 §7 (`candidates`, `chosen`, `margin`, `adjust`,
  `moves`, `chosenMove`, `moveAdjust`, `value`, `attention`, `attribution`, `logp`, `confidence`) **sin** `points`
  si la sala es sin pantalla y **sin** `activationsSummary`. Tope: al llegar a 5 000 eventos de la partida (sin contar los de la voz, `say` y el `error` de frase no
  verificable, que solo existen con pantalla: así una sala con pantalla y su gemela sin pantalla llegan al tope en el
  mismo disparo; R5, 2026-09-23; el tope es por partida: una revancha en la misma sala empieza de cero) la sala emite un
  `error {message: 'tope de eventos', fallback: 'decisiones sin registro completo'}` (una vez) y desde ahí las
  `decision` llevan solo `{phase, chosen, chosenMove, truncated: true}`.
- `graze`: tras cada disparo, por cada enemigo vivo no alcanzado con `dist ≤ 1` u a la trayectoria:
  `{soldierId, dist, shotEventId}` (actor = tirador).
- `reward` y `emotion` los añade el aprendizaje (no la sala): `truth.rewardEvents(events, rewards, {playerId,
  netId, tau})` y `truth.emotionEvents(events, emotions, {playerId, netId})` continúan la numeración de `id`
  y se guardan con la partida de muestra (entreno: 1 de cada 20, `k % 20 === 0`) o de duelo.
- `update` y `lesson` van a `evo/log.jsonl` (`{id, ts, type, netId, ...}`; `id` secuencial por proceso, `refs`
  a las partidas del lote). `say` lo emite la sala cuando un agente habla: `{text, kind, confidence: {certainty,
  experience, confidence, level}, refs}`. Una frase que no pasa `checkPhrase` no se dice: `error {message:
  'frase no verificable', text, missing}`.
- Retención: `pruneGames(netId, keep = 200)` tras cada `saveGame` (borra las más antiguas de esa red que no
  sean duelos de trono). `appendLog` rota a `log.1.jsonl` cuando el fichero supera `maxBytes` (50 MB;
  parámetro para el test).

### 12.2 `checkPhrase` y `compose` (`evo/truth.js`)
- Números: `/-?\d+(?:[.,]\d+)?/g` sobre el texto (coma = punto). Decimales `d` = cifras tras el separador
  (0..2; más de 2 se recorta a 2). Un número casa si algún valor numérico de los eventos referenciados
  (recorrido profundo de todo el evento, excepto `t`) cumple `round(v, d) === round(n, d)`. Un `#k` casa
  solo si alguna `decision` referenciada tiene un candidato con `i === k` o un destino con índice `k`.
- Nombres: tokens con mayúscula inicial que no abren frase (posición 0 o tras `.`, `!`, `?`, `:`) y todo
  token con guion interior (`Orca-2`, `hydra-8a`). Casan si aparecen (sin distinguir mayúsculas) como
  palabra entera en algún valor de texto de los eventos referenciados. `STOPWORDS` exportada.
- `loadEvents(ref)` devuelve una lista de eventos para `{game, id}` (uno) o `{log, id}` (uno); vacío si no
  existe → todo falla (`ok: false`). Devuelve `{ok, missing: {numbers: [tokens], names: [tokens]}}`.
- `compose(template, slots)`: huecos `{clave}`; cada `slots[clave] = {value, ref}` con `ref` obligatoria →
  `{text, refs (únicas, en orden), numbers, names, slots}`; lanza `Error('hueco sin evento: clave')` si falta
  el hueco o su `ref`. `phrase(kind, netId, composed)` añade `kind`, `netId`, `t`.

### 12.3 Confianza (§4)
`confidenceOf({margin, games, recentShots})`: `certainty = clamp(margin, 0, 1)`; `recentAccuracy` = media de
`recentShots` (últimos 20, 1 = mató) o 0.5 si está vacío; `experience = (1 − e^(−games/50))·(0.5 +
0.5·recentAccuracy)`; `confidence = certainty·experience`; `level` = `novata` (< 0.15) · `media` · `veterana`
(> 0.5); `sayProbability = 0.2 + 0.6·confidence`. El agente-red lo mete en `decision.confidence`.

### 12.4 Emoción (§5)
`emotionOf({V, A})` → `{hope, fear, joy, disappointment, surprise, V, advantage, valueSource: 'value'|'mean'|
'none'}`; `V === null` → `hope = fear = 0`. `learnFromGames` devuelve `emotions: [{decisionEventId, …}]`
(uno por decisión con ventaja).

### 12.5 Memoria (§6)
- Forma: `{episodes: [], rivals: {}, recentShots: []}`. Memoria vacía puede ser `[]` (hijos de F5) o faltar:
  `memoryOf(genome)` la normaliza. No se hereda.
- `updateMemory(memory, {netId, playerId, events, rewards?, extra?})`: primero `gamesAgo++` en los episodios
  existentes; luego añade: `kill` → `pride`, `death` → `grudge`, `graze` con `dist < 1` → `fear`,
  `friendlyFire` (propio) → `shame`; `extra` (de trono): `reign.start` → `pride`, `reign.end` → `grudge`,
  `challenge` perdido → `grudge`. `intensity = min(1, |effective|)` de la recompensa de la decisión asociada
  (`rewards.entries`) y 0.5 si no hay. `rivalId` = `netId` del rival (o `agentType`), `biome` de `game.start`,
  `family` del tiro, `outcome` = tipo de evento. `recentShots` ← 1/0 por tiro propio (kill/no), últimos 20.
  `rivals[rivalId]`: `games`, `wins`, `killsBy` (me mató), `killsOf` (le maté), `pride`, `grudge`, `respect =
  (games − wins)/games` (0.5 sin partidas). Tope 300 episodios: se borra el de menor `intensity·0.9^gamesAgo`.
- `recall(memory, ctx = {rivalId, biome, family, outcome}, n = 3)`: puntuación de §6; empate → más reciente.

### 12.6 Boletín (§7): `runBulletin(subject, {onScene})`
`subject` = genoma o `{type, level}` heurístico. Escenas de puntería (40, semillas 9001+i): sala sin pantalla
1×1 con el examinado a la izquierda y un **jugador humano ficticio** a la derecha que dispara `y = 1000` (fuera
del plano) si le toca primero; puntúa 1 si el primer disparo del examinado mata. Cobertura (30, 9002+i): igual,
puntúa 1 si tras su primer movimiento `coverAfter < coverBefore`. Supervivencia (10, 9003+i): `playGame` vs
Sniper L3, 2 soldados, lados alternos; `vivos/total`. Adaptación (12, 9004+i): vs Greedy L3 con 1..4 soldados
(3 partidas por tamaño); `1 − (max − min)` de la tasa de victorias por tamaño. Devuelve `{aim, cover,
survival, adaptation, details: {aim: [...], cover: [...], survival: [...], adaptation: {1: r, …}}, seeds}`.
API: `POST /api/lab/nets/:id/bulletin` → `202 {jobId}` (`kind: 'exam'`), evento `exam` (SSE + log), se guarda
en `evo/nets/<id>/bulletin.json`; `GET /api/lab/nets/:id/bulletin` → el último o `404`.

### 12.7 Neuronas con nombre (§9)
`nameNeurons(genome, samples, {min = 50, threshold = 0.3})`, `samples = [{obs, decision?, ep?, use?}]` (las
más recientes primero; usa todas las que recibe y devuelve en `m` cuántas usó; la **API** recoge como mucho las 500 decisiones más recientes): para cada `dense`/memoria y cada unidad, correlación de
Pearson de su activación (recalculada con `net.forward`) con cada entrada nombrada por `eyeLayout`: para
bloques `ctx`, las entradas de contexto; para bloques `cand`/`move`, además las entradas por fila
(`candidates`/`moves`) y las columnas `kill` / `suicide` (`decision.candidates[i].sim.type`). Con menos de
`min` muestras → `{name: 'sin datos', corr: 0, m}`. Nombre = entrada con mayor `|corr|` si `> threshold`, si no
`'sin nombre claro'`. `genome.names.neurons[blockId][i]` (texto del usuario) manda. Muestras de la API: las
trayectorias de las partidas guardadas de la red (más recientes primero).
**Estado real (M6, 2026-09-23)**: las activaciones las calcula `activationsOf(net, samples)`, que recorre las muestras
en orden llevando el estado de la red y lo pone a cero al cambiar de `ep` (sin `ep`, cada muestra empieza de cero); solo
cuentan las muestras con `use !== false`. La API manda cada soldado entero y en orden (`ep = partida|jugador|soldado`,
todas sus decisiones, `use` solo en las de disparo) hasta pasar de 500 de disparo; `m` = cuántas de disparo usó.

### 12.8 Diario, cronista, moviola
- Cada línea de `log.jsonl` lleva `id` (secuencial) para poder referenciarla (`{log, id}`).
- `diary(netId)` = entradas `lesson | milestone | reign.start | reign.end | challenge | exam` de esa red, más
  recientes primero, cada una con `text` compuesto con `compose` y plantilla fija en español (verificable) y
  `refs: [{log, id}]`. `chronicle()` = `reign.* | challenge | dynasty` de todas las redes.
- **Nombres y español (M4, M5, 2026-09-23)**: el diario de una red incluye también los retos en que fue retadora o
  reina. Las entradas del registro guardan los nombres del momento (`name`, `challengerName`, `queenName`,
  `houseName`, `motherName`, `childName`, `againstName`, `aName`, `bName`, `winnerName`), y las frases los usan (las
  entradas antiguas, los ids). Retos: `ganó la retadora` · `la reina defendió el trono` · `empate, la reina conserva el
  trono` · `reto anulado`. Fin de reinado: `pierde el trono` · `deja el trono: la borraron` · `deja el trono: ya no
  existe`. Dinastía: `<casa>: <x> entrena contra <y>` · `<casa>: <madre> tiene hijos` · `<casa>: <hija> sucede a
  <madre>` (solo si hubo relevo) o `<casa>: <madre> sigue de campeona, <hija> no la supera` · `Duelo de campeonas: gana
  <x>` / `empate` · `<casa>: se borró a su campeona <x>`.
- `GET /api/lab/games/:id/turns/:n/brain?player=<playerId>` → `{decision, activations, attention, approx}`:
  la `decision` es la del evento `decision` con `turn === n` del jugador; sin `?player=`, la de disparo de ese turno (la
  de quien disparó; la de moverse del tirador anterior ya lleva el turno siguiente, M3), y si no hay, la primera; las activaciones se recalculan
  reproduciendo la trayectoria del soldado desde el principio con el genoma actual (`approx: true`) o con la
  copia `evo/games/<id>.nets.json` (duelos de trono, `approx: false`).
- `POST /api/lab/nets/:id/slap|caress {game, decisionEventId, amount = 1}` → evento `slap|caress {decisionEventId,
  amount, term: 'slapCaress'}` en la partida y en el log; queda en `evo/nets/<id>/feedback.json` y el siguiente
  sueño que contenga esa partida añade `∓amount·reward.slapCaress` a esa decisión (`assignRewards` admite
  `extraTerms`). Devuelve `{ok, reward}`.
- Registro por API: `GET /api/lab/log?limit=N` → `{entries}` (las últimas N, más reciente al final) y
  `GET /api/lab/log/:id` → la entrada (404 si no existe). `GET /api/lab/nets/:id/feedback` → `{pending}` (bofetadas y
  caricias aún no consumidas por un sueño). `GET /api/lab/nets/:id/neurons` → `{blocks: {blockId: [{index, name,
  corr, feature, m, custom}]}, m}`; `PUT …/neurons/:blockId/:index {name}` (400 vacío, 404 bloque/índice).
  `GET /api/lab/nets/:id/diary` → `{entries: [{kind, text, refs, t, netId}]}`; `GET /api/lab/chronicle` igual.

## 13. Arreglos tras la revisión de Opus (2026-09-23, `spec/revision-opus.md` A3 y A4)
Aprobados por el usuario ("arréglalo tú"; adaptación "equilibrar y penalizar perder"). Completan §1–§12.

### 13.1 Boletín que mide lo que dice (A4)
- **Blanco inofensivo**: en las escenas de puntería y cobertura el agente ficticio dispara una expresión que explota
  en el primer punto (`sqrt(-1)`) y se queda quieto. Antes disparaba `y = 1000`, que en modo función es la
  horizontal que pasa por él (la constante no cuenta) y mataba al examinado en 2 de 40 escenas de puntería.
- **Adaptación equilibrada**: 16 partidas contra Greedy L3, 4 por tamaño (1, 2, 3 y 4 soldados), dos a la
  izquierda y dos a la derecha. Partida `i = 0…15`: `soldados = 1 + ⌊i/4⌋`, izquierda si `i` es par, semilla
  `9004 + i`. `details.adaptation = {1: tasa, 2: …, 3: …, 4: …}` y `details.adaptationGames = [{seed, soldiers, side,
  win}]`.
- **Puntuación**: `adaptación = tasa media × (1 − (máx − mín))` sobre las 4 tasas (`adaptationScore(rates)` en
  `evo/exam.js`). Perder todo da 0; ganar lo mismo con 1, 2, 3 y 4 soldados da esa tasa. Progreso total del trabajo:
  96 escenas (40 + 30 + 10 + 16).

### 13.2 Voz verificada en la sala (A3)
- Las redes hablan en las salas con pantalla (x1 y x10: exhibiciones, entrenos y duelos en vivo); sin pantalla no
  hablan. Las frases fijas de relleno de las redes (`banter` de `agents/net.js`) desaparecen.
- Cada frase la compone `evo/voice.js` con `compose` (cada hueco con `ref` a un evento de la partida, o del registro
  o de una partida guardada si recuerda algo) y la sala la verifica con `checkPhrase` antes de decirla. Si no
  verifica, no se dice: evento `error {message: 'frase no verificable', text, missing}`.
- Momentos: al empezar (presentación: mapa y rival; si recuerda al rival, un recuerdo verificable), antes de
  disparar (según su confianza: `novata` piensa en voz baja, `kind: 'think'`; `media` y `veterana` hablan,
  `kind: 'say'`), al matar, al rozar, al morir, al matar a un aliado, y la réplica cuando el rival falla.
- Probabilidad de hablar en cada momento = `sayProbability` de su confianza (§4); la presentación, siempre. El
  sorteo usa un `rng` propio, `makeRng(hash32(seed, eventId))`, nunca el de la partida: **hablar no cambia la
  partida**. Como mucho una frase por jugador y turno, además de la presentación y la réplica.
- Chat: `{t, text, playerId, soldierId, kind: 'say'|'think', refs, confidence, level}`. Evento `say {text, kind, refs,
  confidence: {certainty, experience, confidence, level}}`.
- El carácter (`traits.character`: frío, chulo, dramático, desquiciado) elige el estilo; los números y los nombres
  salen siempre de los eventos.
- API de `evo/voice.js`: `speak(moment, ctx, rng) → {text, refs, kind} | null`, compuesto siempre con `compose`.
  `moment` ∈ `intro | decision | kill | graze | miss | friendlyFire | death | retort`; `ctx = {character, level,
  confidence, rivalName, events: {start, decision?, shot?, kill?, graze?, death?, friendlyFire?, rivalDecision?,
  rivalShot?, recall?}}` (eventos completos del registro; `recall` = eventos recordados de otras partidas).
  `null` si no hay nada verdadero que decir. En la sala: `sayVerified(player, soldier, phrase, kind, confidence)`
  verifica con `checkPhrase` contra sus eventos (y partidas guardadas o el log para lo recordado) y devuelve
  `true`/`false`.
- Las frases de relleno desaparecen, pero el sorteo que las elegía se mantiene: así las partidas con redes siguen
  siendo las mismas con la misma semilla.
