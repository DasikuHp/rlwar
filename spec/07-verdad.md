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
- `certainty = margin` (spec/03 §7) ∈ [0, 1].
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

## 11. Tests de F7 (`test/verdad.spec.mjs`)
- `checkPhrase`: 10 frases válidas sobre una partida fija pasan; número inventado, nombre inventado,
  `#9` inexistente, ref a otra partida → fallan con el `missing` correcto.
- `compose` rechaza huecos sin evento.
- Confianza y emoción: fórmulas sobre valores fijos (tabla).
- Memoria: episodios de una partida fija; `recall` ordena por la fórmula; tope 300.
- Boletín: determinista (misma semilla → mismas puntuaciones); Sniper L3 ≥ red vacía en puntería.
- Neuronas: una unidad artificialmente igual a una entrada recibe su nombre; ruido → "sin nombre claro".
- Registro: tope de eventos; retención por red; `evo/log.jsonl` rota.
