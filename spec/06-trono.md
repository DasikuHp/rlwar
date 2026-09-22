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
