# 06 — Trono, duelos, dinastías, liga, genealogía (F6)

> Contrato exacto de `evo/duel.js` y `evo/throne.js`. Fuente: plan2.md rondas 1, 5, 7, 8; §4.5; §6.2 (3).

## 1. Duelo (`POST /api/lab/duels`)
```json
{ "a": "hydra-7", "b": "orca-2", "learning": "mix", "speed": "turbo", "soldiers": "random",
  "seed": 4242, "throne": false, "dynasty": null }
```
- **3 mapas × 2 lados = 6 partidas** ✅. Semillas de partida: `s_k = hash32(seed, k)` para `k = 0..2`;
  partidas: `(a izq, b der, s_0)`, `(b izq, a der, s_0)`, `(a, b, s_1)`, `(b, a, s_1)`, `(a, b, s_2)`,
  `(b, a, s_2)`. Mismo mapa y **misma cantidad de soldados** en las dos partidas de cada mapa.
- Soldados por partida ✅: `"random"` → `1 + hash32(seed, 100+k) mod 4` (varía 1–4 por mapa, igual en
  ambos bandos); o fijo 1..4.
- `learning` ✅ (se elige por duelo): `frozen` = sin aprender durante; al acabar, **repaso** (un lote
  con las 6 partidas) · `hot` = aprende tras cada partida (lote de 1) · `mix` 🧭 preseleccionado =
  durante, `lr × 0.25` tras cada partida + repaso completo al final. Se aplica a **ambas** redes.
- `speed`: `turbo` (sin pantalla, marcador al instante) · `x10` / `x1` (salas vivas encadenadas;
  `roomCodes[]` en la respuesta para espectar; la siguiente empieza al acabar la anterior).
- Resultado (`GET /api/lab/duels/:id`):
  ```json
  { "id": "d17", "a": "hydra-7", "b": "orca-2", "status": "done", "learning": "mix",
    "games": [ { "k": 0, "seed": 111, "soldiers": 3, "left": "hydra-7", "right": "orca-2",
                 "winner": "hydra-7"|"orca-2"|null, "kills": { "hydra-7": 3, "orca-2": 1 }, "gameId": "g901", "roomCode": null } ],
    "wins": { "hydra-7": 4, "orca-2": 2 }, "killDiff": 5, "winner": "hydra-7", "tie": false, "ms": 1830 }
  ```
  Ranking ✅: más victorias; empate → diferencia de kills (a − b); empate total → `tie:true` y
  `winner = null` (en un reto al trono, la reina conserva el trono 🧭: "quien defiende gana los empates").
- Todas las partidas se guardan (moviola). Eventos SSE `duel` por partida y al final.

## 2. Trono (`evo/throne.json`)
```json
{ "queen": "hydra-7", "since": 1758540000000,
  "reigns": [ { "netId": "hydra-7", "from": 1758540000000, "to": null, "defenses": 3, "won": 3, "lost": 0 } ],
  "challenges": [ { "id": "c9", "challenger": "orca-2", "queen": "hydra-7", "duelId": "d17", "result": "queen"|"challenger"|"tie", "ts": 1758541111111 } ],
  "hallOfFame": [ { "netId": "hydra-5", "snapshot": "evo/nets/hydra-5/hof-1.json", "reignIdx": 0, "reignGames": 12 } ],
  "league": { "pairs": { "hydra-7|orca-2": { "wins": 4, "losses": 2, "last": [1,1,0,1,1,0] } } },
  "dynasties": { "A": null, "B": null },
  "genealogy": { "hydra-8a": { "parents": ["hydra-7"], "generation": 1, "born": 1758542222222, "sha": "…" } } }
```
- `POST /api/lab/throne/challenge {challenger, learning, speed}` ✅: sin reina → la retadora se sienta
  directamente (evento `reign.start`). Con reina → duelo §1 con `throne:true`; si gana la retadora:
  `reign.end` (la reina saliente entra en `hallOfFame` con una **copia congelada** de sus pesos al
  perder) + `reign.start`; si no, `defenses++`. Una red no puede retarse a sí misma.
- La reina y las retadoras **siguen aprendiendo** entre retos (los ficheros vivos); la sala de la
  fama guarda las copias de cada reinado (estilos antiguos: piedra-papel-tijera).
- `league.pairs` alimenta `f_hard` (spec/04 §6) y las partidas fantasma; `last` = últimos 20
  resultados (1 = ganó el primero del par).
- Genealogía: al guardar cualquier red se comprueba que sus `parents` existen en `genealogy` o en
  `evo/nets/` (si no, aviso `orphan`); `sha` = SHA-256 del genoma al nacer (integridad: el árbol
  detecta si una red fue editada después: `edited:true`).

## 3. Dinastías ✅ (`throne.dynasties.A|B`)
```json
{ "name": "Casa Hydra", "champion": "hydra-9", "generation": 3, "founder": "hydra-7",
  "history": [ { "generation": 1, "champion": "hydra-7", "trainingId": "t3", "duelId": "d20", "won": true } ] }
```
- `POST /api/lab/dynasties {A:{name, netId}, B:{name, netId}}` funda las dos casas (o sustituye
  una: `?house=A`).
- `POST /api/lab/dynasties/generation {training:{…spec/04 §6 sin netId ni antagonistId…},
  children:{n, mutation, pretournament}, duel:{learning, speed}}` = **una generación**:
  1. cada campeona entrena con `antagonistId` = la campeona de la **otra** casa (carrera armamentística);
  2. cada casa cría `n` hijos de su campeona y pre-torneo contra la campeona rival; el mejor hijo
     **sustituye** a la campeona si le gana un duelo 3×2 (si no, sigue la madre);
  3. duelo entre casas (`duelId`); la ganadora suma `generation`.
  Todo queda en `history`; eventos SSE `dynasty`.
- `POST /api/lab/dynasties/:house/challenge-throne {learning, speed}` → reto al trono con la campeona.

## 4. Liga (estilo AlphaStar) — reglas de muestreo, en `throne.js`
- `pickOpponent(netId, mix, rng)` → `{netId|snapshot, kind: antagonist|hallOfFame|self|ghost}`:
  primero `ghost` con prob. `mix.ghost` si existe una ex-reina a la que se perdió en las últimas 20
  partidas de `league.pairs`; si no, sorteo `antagonist / hallOfFame / self` por pesos; dentro de la
  sala de la fama, peso `f_hard = (1 − winrate)^hard` con `winrate` de `league.pairs` (0.5 si no hay datos).
- **Retadora explotadora** ✅: preset de entreno `opponents = {antagonist:1, hallOfFame:0, self:0}`
  contra la reina, marcado `exploiter:true` en el entreno; el cronista lo cuenta.

## 5. Tests de F6 (`test/trono.spec.mjs`)
- Programación del duelo: 6 partidas, lados alternos, mismas semillas y soldados por mapa;
  determinismo (misma `seed` → mismos `games[].seed/soldiers`).
- Ranking: tablas fijas de resultados → ganador, empate, diferencia de kills; reina gana empates.
- Trono: sin reina → sienta; reto ganado → `reign.end/start`, copia en `hallOfFame` con SHA;
  reto perdido → `defenses++`; auto-reto → 400.
- Liga: `pickOpponent` con `rng` fijo respeta los pesos (10 000 sorteos ± 2 %); `f_hard` reduce el
  peso de rivales ya ganados; fantasma solo si hay derrota reciente.
- Dinastías: una generación completa sin pantalla con redes de plantilla (semilla fija) termina,
  actualiza `history` y `generation`; genealogía sin huérfanos; `sha` detecta edición.
- Modos de aprendizaje: `frozen` no cambia pesos durante las 6 partidas y sí tras el repaso; `hot`
  cambia tras la 1ª; `mix` cambia menos que `hot` tras la 1ª (norma de Δ) y más tras el repaso.

## 6. Precisiones de F6 (fijadas al escribir los tests; completan §1–§5 sin cambiarlos)

### 6.1 Semillas y plan del duelo (`evo/duel.js`)
- `hash32(seed, k)` (en `shared/rng.js`) = primer valor de `makeRng((seed ^ Math.imul(k + 1, 0x9E3779B1)) & 0x7fffffff)` (quitar el bit alto deja la semilla en `[0, 2³¹)`, el rango que acepta `makeRng`, sin perder los bits bajos)
  convertido a entero: `Math.floor(r · 2³¹)`. Determinista, en `[0, 2³¹)`.
- `duelPlan({a, b, seed, soldiers}) → games[6]`: para `k = 0..5`, mapa `m = ⌊k/2⌋`, `seed = hash32(seed, m)`,
  `left = k par ? a : b`, `right` el otro, `soldiers = 'random' ? 1 + hash32(seed, 100 + m) mod 4 : soldiers`.
  Cada fila: `{k, seed, soldiers, left, right}` (ids).
- `duelScore(rows, a, b, {throne, queen}) → {wins:{[a],[b]}, killDiff (a − b), winner, tie}`: más victorias;
  empate → `killDiff` (positivo gana `a`, negativo `b`); empate total → `tie: true` y `winner: null`, salvo
  `throne: true`, donde `winner = queen` y `tie: true` se mantiene (quien defiende gana los empates).
- Resultado de cada partida: `winner` = id de la red que ganó (`null` en tablas), `kills = {[a]: n, [b]: n}`.

### 6.2 Aprendizaje durante el duelo
`runDuel({a, b, learning, speed, soldiers, seed, throne, play, learner, onGame, shouldStop})`:
- `play(row) → {winner, kills, events, trajectories, players, gameId, roomCode}` inyectable (por defecto:
  `turbo` → `playGame` sin pantalla; `x1`/`x10` → sala viva encadenada, `roomCode` en la fila).
- `learner(netId) → {learn(games, {lrScale}), review(games), save()}` inyectable (por defecto el de
  `evo/train.js`: `makeLearner(genome)` con Adam y `optim.json`, como el entrenador). Reglas exactas:
  | modo | tras cada partida | al acabar |
  |---|---|---|
  | `frozen` | nada | `review(las 6)` = un lote con las 6 partidas, `lrScale 1` |
  | `hot` | `learn([partida], {lrScale: 1})` | nada |
  | `mix` | `learn([partida], {lrScale: 0.25})` | `review(las 6)` con `lrScale 1` |
  Se aplica a las dos redes (cada una aprende de su propia trayectoria). Con `a === b` no se aprende.
- Las 6 partidas se guardan en `evo/games/<gameId>.json` (`{meta, events}`, meta con `duelId`, `seed`,
  `soldiers`, `left`, `right`, `winner`, `kills`, `ts`). `stop` → `status: 'stopped'`, se puntúa lo jugado.
- Registro del duelo: `{id, a, b, status: running|done|stopped, learning, speed, throne, games[], wins,
  killDiff, winner, tie, ms, roomCodes, startedAt}`. `games[k].roomCode` es `null` en turbo.

### 6.3 Trono (`evo/throne.js`)
- `throne.json` por defecto: `{queen: null, since: null, reigns: [], challenges: [], hallOfFame: [],
  league: {pairs: {}}, dynasties: {A: null, B: null}, genealogy: {}}`. Escritura atómica (`tmp` + `rename`).
- `challenge({challenger, learning = 'mix', speed = 'turbo', seed?}, {runDuel})`: la red debe existir y poder
  jugar (404 / 400); `challenger === queen` → 400. Sin reina → `queen = challenger`, `since = ahora`,
  `reigns.push({netId, from, to: null, defenses: 0, won: 0, lost: 0})`, evento `reign.start`. Con reina →
  duelo `{a: challenger, b: queen, throne: true}`; `challenges.push({id: 'c<n>', challenger, queen, duelId,
  result: queen|challenger|tie, ts})`; si gana la retadora: el reinado saliente recibe `to`, `lost++`; se
  guarda **copia congelada** de la reina en `evo/nets/<queen>/hof-<n>.json` y `hallOfFame.push({netId,
  snapshot, reignIdx, reignGames, sha})`; eventos `reign.end` y `reign.start`; si no: `defenses++`, `won++`
  (empate cuenta como defensa). Devuelve `{duelId?, result, queen}`.
- `league.pairs["x|y"]` con `x < y` (orden alfabético): `{wins, losses, last[≤20]}` desde la perspectiva de `x`
  (`last[i] = 1` si ganó `x`); se actualiza por **partida** (tablas no cuentan). `winrate(x, y)` =
  `wins/(wins+losses)` o `0.5` sin datos.
- Genealogía: `registerBirth(genome)` → `genealogy[id] = {parents, generation, born, sha}` con `sha` =
  SHA-256 de `JSON.stringify({blocks, wires})` (la **estructura**: aprender no cuenta como editar);
  `genealogyView()` → `{nets: {id: {…, edited, orphan}}}`: `edited = sha actual ≠ sha al nacer`,
  `orphan = algún parent no está ni en genealogy ni en evo/nets`. Los hijos de F5 y las importaciones
  llaman a `registerBirth`.
- `pickOpponent(netId, mix, rng, {throne, hall})`: `mix = {antagonist, hallOfFame, self, ghost, hard,
  antagonistId}`; `hall = [{netId, snapshot|genome, kind: 'hallOfFame'|'milestone'}]`. Orden: (1) si
  `rng() < ghost` y existe una ex-reina de `hallOfFame` contra la que `netId` perdió en sus últimos 20
  resultados de `league.pairs` → `{kind: 'ghost', ...esa}`; (2) sorteo entre `antagonist / hallOfFame /
  self` con pesos (normalizados; los 0 no entran); `antagonist` sin `antagonistId` → la reina si existe y no
  es `netId`, si no cae a `self`; `hallOfFame` vacía → `self`; (3) dentro de la sala de la fama, peso
  `f_hard = (1 − winrate(netId, rival))^hard` (0.5 sin datos), `hard = 2` por defecto.
- El entrenador (spec/04 §6) usa `pickOpponent` con `throne.json` y sus hitos como `hall`; `exploiter: true`
  en `POST /trainings` fija `opponents = {antagonist: 1, hallOfFame: 0, self: 0, antagonistId: reina}` y
  queda en `config.exploiter` (400 si no hay reina).

### 6.4 Dinastías (§3) y trabajos
- `POST /api/lab/dynasties {A:{name, netId}, B:{name, netId}}` (o `?house=A` con solo esa casa) →
  `{name, champion, generation: 0, founder, history: []}`; 404 si la red no existe; 400 si las dos casas
  usan la misma red.
- `POST /api/lab/dynasties/generation` → `202 {jobId}` (`kind: 'generation'`); pasos exactos por casa:
  1. entreno de la campeona con `antagonistId` = campeona rival (`training` del cuerpo; por defecto
     `{speed:'turbo', duration:{games: 20}, soldiers: 'random'}`);
  2. `n` hijos (`children.n`, por defecto 4) con pre-torneo `children.pretournament` contra la campeona
     rival; el mejor hijo reta a su madre en un duelo normal; si gana (no empate) sustituye a la campeona;
  3. duelo entre casas (`duel.learning`, `duel.speed`); la ganadora `generation++` (empate: ninguna).
  `history.push({generation, champion, trainingId, childrenJobId, duelId, won})` en las dos casas.
  Progreso `{done, total: 6}` (2 entrenos, 2 crías, 2 duelos: madre-hija y entre casas cuentan como uno
  cada uno… total = 6). Eventos SSE `dynasty {house, event: train|children|promote|duel|generation}`.
- `POST /api/lab/dynasties/:house/challenge-throne {learning, speed}` → `challenge` con la campeona.

### 6.5 API y eventos
- `POST /api/lab/duels` → `202 {id, status, roomCodes}`; `GET /api/lab/duels` → `{duels: [...]}`;
  `GET /api/lab/duels/:id`; `POST /api/lab/duels/:id/stop`. 404 red inexistente; 400 `a === b`,
  `learning` o `speed` fuera de lista, `soldiers` fuera de `'random'|1..4`; 409 si una red está entrenando.
- `GET /api/lab/throne` → `throne.json` completo más `queenName`; `GET /api/lab/hall-of-fame` →
  `{hallOfFame}`; `GET /api/lab/genealogy` → `genealogyView()`; `POST /api/lab/throne/challenge` →
  `202 {duelId?, result?, queen}` (síncrono si no había reina: `200`).
- SSE: `duel {id, game?, result?}` por partida y al final; `throne {queen, event: reign.start|reign.end|
  challenge}`; `dynasty {house, event, …}`. `hello` lleva `throne: {queen, since}`.
- Todo evento de trono/dinastía/entreno se añade también a `evo/log.jsonl` (`{ts, type, ...}`), que F7 lee.

## 7. Arreglos tras la revisión de Opus (2026-09-23, `spec/revision-opus.md` C5 y C6)
Aprobados por el usuario ("arréglalo tú"). Completan §1–§6 sin cambiar lo que ya decían.

### 7.1 La reina y las campeonas no se borran por accidente (C5)
- `DELETE /api/lab/nets/:id` responde **409** si la red es la reina o la campeona de una casa (spec/08 §4), con el
  motivo en español. Con `?force=1` se borra y:
  - si era la reina: su reinado se cierra (`to = ahora`, `ended: 'deleted'`), `queen = null`, `since = null`, y se
    emite `throne {event: 'reign.end', reason: 'deleted'}` (y la línea en el log). La siguiente retadora se sienta
    directamente;
  - si era campeona de una casa: la casa queda **sin campeona** (`champion: null`). Una generación o un reto de esa
    casa responde 400 ("la casa no tiene campeona: vuelve a fundarla con `?house=`").
- Si la reina ya no existe (su fichero desapareció por otra vía), `challenge()` cierra su reinado con
  `ended: 'missing'` y sienta a la retadora (`result: 'seated'`).
- Un duelo de reto que termina en error o sin ninguna partida jugada **anula** el reto: se registra en
  `challenges` con `result: 'void'` (y `error`), nadie gana ni defiende (los reinados no cambian) y el evento
  `challenge` lleva `result: 'void'`.

### 7.2 Un id por duelo, también entre dinastías y reinicios (C6)
- Los ids de duelo son únicos entre procesos: `d<ms en base 36>-<n>` (`newDuelId()` en `evo/duel.js`). Los usan el
  API, el trono y las dinastías.
- Los duelos de una generación (madre contra hija en cada casa y duelo entre casas) pasan por el mismo registro que
  `POST /api/lab/duels`: aparecen en `GET /api/lab/duels`, emiten SSE `duel` y sus ids son los de `history` y de
  los eventos `dynasty`.
