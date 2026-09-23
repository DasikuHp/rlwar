# 08 — Interfaz: lo que la interfaz puede pedir y ver (REST + SSE del laboratorio)

> Contrato exacto de `evo/api.js` (montado en `server/server.js`), `agents/net.js` y las ampliaciones
> del `snapshot` de sala. Opus construye `public/evo.html` sobre esto y **solo** sobre esto.
> Errores: `400 {error, code, errors?}` (validación), `404`, `409` (conflicto: red entrenando, id
> repetido), nunca `500` por una entrada mala. Cuerpos JSON; `/api/lab/*` admite hasta 48 MB.

## 1. Catálogo (`GET /api/lab/catalog`) — todo explicado, tres niveles ✅
```json
{ "blocks": [ { "type": "dense", "name": "Instinto", "icon": "🧠", "group": "instinct", "level": "aprendiz",
                "explain": "Capa de neuronas: mezcla lo que entra y saca …", "example": "32 neuronas tanh …",
                "params": [ { "key": "units", "name": "Neuronas", "type": "int", "min": 1, "max": 512, "step": 1, "default": 32, "level": "aprendiz", "explain": "…", "example": "…" },
                            { "key": "activation", "name": "Activación", "type": "enum", "options": [ { "value": "tanh", "name": "tanh", "explain": "…" } ], "default": "tanh", "level": "artesano" } ],
                "streams": { "in": ["ctx", "cand", "move"], "out": "same" } } ],
  "eyes": [ { "type": "eye.features", "layout": [ { "index": 0, "name": "mi x" }, … ] } ],
  "families": [ { "id": "line", "name": "Recta", "explain": "…", "params": [ … ] } ],
  "traits": [ { "key": "temperature", "name": "Temperatura", "min": 0.05, "max": 3, "default": 1, "level": "aprendiz", "explain": "…", "example": "…" } ],
  "rewardTerms": [ { "key": "survive", "name": "Sobrevivir", "min": -5, "max": 5, "default": 0, "personality": "cobarde: se esconde…", "explain": "…" } ],
  "learning": [ { "key": "gradient.lr", "name": "Tasa de aprendizaje", … } ],
  "mutation": [ { "key": "addNeurons", "name": "Añadir neuronas", … } ],
  "limits": { …spec/00 §6… },
  "levels": [ "aprendiz", "artesano", "cientifico" ] }
```
Nada se bloquea por nivel ✅: la interfaz filtra por `level`; el servidor acepta todo.

## 2. Redes como agentes (`agents/net.js`, `agents/registry.js`)
- `GET /api/agents` lista los 4 heurísticos **y** las redes guardadas:
  `{id:"net:hydra-7", name:"Hydra-7", icon:"🧠", description:"…generación 3, 12 partidas…", net:true, netId:"hydra-7", emblem: 1234567}`.
  El selector de tropas (F0) las muestra solo (lo lista de `/api/agents`).
- `POST /api/rooms/:code/addagent {type:"net:hydra-7"}` o `{type:"net", netId, learn?:bool,
  temperature?}` → jugador con `agentType:"net"`, `netId`, `learn` (spec/04 §7).
- `chooseShot` devuelve `{mode, expr, angle, reason, say?, decision}`; `chooseMove` implementado.
  `reason` = frase verificada (spec/07 §2) o vacío. El agente **nunca lanza**: ante error de red →
  `0.1*x` + evento `error`.

## 3. Sala viva con redes (ampliaciones del `snapshot` y SSE)
- `snapshot()`: `players[].netId`, `players[].learn`, `lastDecision` (último registro de spec/03 §7,
  sin `activationsSummary`), `config.speed` (1|10), `config.seed`.
- SSE `decision` `{decision}` se emite **antes** de `shot` (la sala "piensa" y el overlay pinta
  todos los candidatos tenues y la elegida brillante ✅; en fase `move`, los 9 destinos y el elegido).
  Incluye `activationsSummary` para el cerebro en vivo (nervios que laten).
- Chat: `{t, text, playerId, soldierId, kind, refs?, confidence?, level?, emotion?}`.
- `POST /api/rooms {name, soldiers, seed?, speed?}` (`speed` 10 solo si todos son agentes).

## 4. Redes (`/api/lab/nets`)
| método | ruta | cuerpo → respuesta |
|---|---|---|
| GET | `/api/lab/nets` | `{nets:[{id, name, emblem, traits, stats, generation, paramCount, blocks, updatedAt, isQueen, house, training}]}` |
| POST | `/api/lab/nets` | `{template:"sniper"|"turtle"|"seer"|"empty", name}` o `{genome}` → `201 {id, genome}` |
| | | `id` = nombre en minúsculas sin acentos ni símbolos (`[a-z0-9-]`, 3–32); si ya existe, sufijo `-2`, `-3`…; sin nombre, el de la plantilla. Con `{genome}` manda el `id` del genoma (409 si existe). |
| GET | `/api/lab/nets/:id` | `{genome, paramCount, warnings}` |
| PUT | `/api/lab/nets/:id` | genoma completo → `{ok, warnings}` / `400 {errors}` / `409` si entrena |
| DELETE | `/api/lab/nets/:id` | `{ok}` (409 si es reina o campeona de casa, salvo `?force=1`) |
| POST | `/api/lab/nets/:id/validate` | genoma → `{ok, errors, warnings, paramCount}` (no guarda) |
| GET | `/api/lab/nets/:id/export` | el genoma (descarga) |
| POST | `/api/lab/nets/import` | genoma → `201 {id}` / `400` / `409` (`?rename=1`) |
| POST | `/api/lab/nets/:id/children` | spec/05 §4 → `202 {jobId}` |
| GET | `/api/lab/nets/:id/diff/:otherId` | spec/05 §5 |
| POST | `/api/lab/nets/:id/transplant` | spec/05 §7 |
| PUT | `/api/lab/nets/:id/weights/:blockId` · `/frozen` | spec/05 §7 |
| POST | `/api/lab/nets/:id/slap` · `/caress` | `{game, decisionEventId, amount:1}` → `{ok, reward}` |
| GET | `/api/lab/nets/:id/diary` · `/memory` · `/neurons` · `/bulletin` · `/curves` | spec/07 |
| PUT | `/api/lab/nets/:id/neurons/:blockId/:index` | `{name}` |
| POST | `/api/lab/nets/:id/bulletin` | `202 {jobId}` (examen) |
| POST | `/api/lab/nets/:id/whatif` | `{genome?, scene:{soldiers, obstacles, soldierId, history?, shots?}, phase}` → `{decision}` ("¿qué pasaría si…?", sin efectos) |
| GET | `/api/lab/templates` | las 4 plantillas ✅ con `why` (por qué está montada así) |

## 5. Entrenos, duelos, trono, dinastías, partidas
| método | ruta | ver |
|---|---|---|
| POST/GET | `/api/lab/trainings` · `/:id` · `/:id/stop` · `/:id/pause` · `/:id/resume` | spec/04 §6 |
| POST/GET | `/api/lab/duels` · `/:id` · `/:id/stop` | spec/06 §1 |
| GET | `/api/lab/throne` · `/api/lab/hall-of-fame` · `/api/lab/genealogy` | spec/06 §2 |
| POST | `/api/lab/throne/challenge` | spec/06 §2 |
| GET/POST | `/api/lab/dynasties` · `/generation` · `/:house/challenge-throne` | spec/06 §3 |
| GET | `/api/lab/games?netId&duelId&trainingId&limit` · `/api/lab/games/:id` · `/:id/turns/:n/brain` | spec/07 §10 |
| GET | `/api/lab/chronicle` | spec/07 §10 |
| GET | `/api/lab/jobs/:id` | `{id, kind, status, progress, result?, error?}` (hijos, examen, generación) |

## 6. SSE global (`GET /api/lab/events`)
`hello {throne, trainings, jobs}` · `training {id, status, games, updates}` · `curve {trainingId, point}`
· `sleep {netId, trainingId, update}` · `lesson {netId, phrase}` · `children {jobId, ranking}` ·
`duel {id, game?, result?}` · `throne {queen, event}` · `dynasty {house, event}` · `exam {netId, scores}`
· `milestone` · `job {id, status, progress}` · `error {message}`. Ping cada 20 s.

## 7. Plantillas ✅ (`shared/templates.js`, las valida el test de F2)
| plantilla | montaje | por qué |
|---|---|---|
| 🎯 Francotirador `sniper` | Rasgos + Candidatos → Instinto 32 tanh → Elegir; Destinos → Moverse | "Solo geometría: aprende despacio pero sin muletas" |
| 🐢 Tortuga con memoria `turtle` | Rasgos + Radar + Reloj → GRU 16 → Instinto 24 → Elegir; Destinos + GRU → Moverse; `survive` 0.5, `cover` 0.3 | "Recuerda de dónde le dispararon y se esconde" |
| 🔮 Vidente `seer` | Rasgos + Candidatos + **Simulador** → Instinto 32 → Elegir + Ajustar; Corazonada; Destinos → Moverse | "Ve el futuro de cada tiro: aprende en cientos de decisiones" |
| ⬜ Vacía `empty` | Rasgos + Candidatos → Elegir | "Lo mínimo que puede disparar; construye tú el resto" |

## 8. Qué desbloquea cada fase para Opus (recordatorio)
F1 clic tras disparar + destino · F2 editor de cables (catálogo + validate + whatif sin red) · F3 overlay
de candidatos y cerebro en vivo (`decision`) · F4 curvas y panel de entreno · F5 hijos y diferencias ·
F6 árbol, trono, dinastías · F7 voz, diario, cronista, moviola, boletín, neuronas.

## 9. Arreglos tras la revisión de Opus (2026-09-23, `spec/revision-opus.md` A5, M14, M16)
Aprobados por el usuario ("arréglalo tú"; frases en el navegador "hazlo lo mejor que puedas, sin chapuzas").

### 9.1 Rutas que faltaban
- `GET /api/lab/catalog` → `mutation: [{key, name, level, explain, example, params: [{key, name, type, min, max,
  step, default}]}]`, una entrada por cada tipo de spec/05 §1 y en ese orden; los valores por defecto son
  `DEFAULT_MUTATION`.
- `POST /api/lab/nets/:id/whatif {genome?, scene, phase = 'shoot', seed = 1}` → `{decision}` ("¿qué pasaría
  si…?", sin efectos: no guarda nada). `scene = {soldiers: [{id, team, x, y, alive = true, ownerId?}], obstacles:
  [{x, y, w, h}], soldierId, shots?, stats?}`; `genome` (opcional) sustituye a la red guardada y se valida para
  jugar. La decisión es la de `decideShot` (o `decideMove` si `phase: 'move'`) con memoria a cero, `rng =
  makeRng(seed)` y atribución. Errores 400 con motivo: soldado inexistente o muerto, coordenadas fuera del plano,
  más de 32 soldados o 64 obstáculos, genoma inválido.
- `GET /api/lab/nets/:id/curves` → `{netId, trainings: [{trainingId, points: [{game, reward, win, kills, deaths,
  loss?, entropy?, kind?, rival?, t}]}], reigns: [...]}`: los puntos de cada entreno quedan en disco
  (`evo/nets/<id>/curves.jsonl`, los 5 000 últimos) y sobreviven a un reinicio; `reigns` son los reinados de esa red
  en `throne.json`.
- `GET /api/lab/games?netId&duelId&trainingId&kind&limit=50` → `{games: [meta…]}` de la más reciente a la más
  antigua. Cada partida guardada deja al lado su `meta` (`<gameId>.meta.json`) para listar sin abrir la partida.

### 9.2 Retención de partidas (M16)
- Quien guarda una partida nueva (entrenos, duelos, exhibiciones) usa `saveGameKept`, que guarda y aplica la
  retención de spec/07 §12.1 a cada red de `meta.nets`: como mucho 200 partidas por red; se borran las más
  antiguas que no sean duelos de trono. `saveGame` por sí solo no borra nada (así lo fija `verdad.spec`).

### 9.3 `shared/` y la verdad en el navegador (M14)
- `shared/*.js`, `evo/truth.js` y `evo/voice.js` no usan nada de Node: `constants.js` mira `process` solo si existe
  y `policy.js` usa el `performance` global. El servidor los sirve tal cual en `/shared/<fichero>.js`,
  `/evo/truth.js` y `/evo/voice.js` (solo esos; nada más de `evo/`), así la interfaz compone y verifica frases con
  el mismo código que el servidor.

## 10. Arreglos de la parte 3 (2026-09-23, `spec/revision-opus.md` §3.3 y §9)
### 10.1 Cuerpos demasiado grandes (M10)
- Si el cuerpo de una petición pasa del tope (48 MB en `/api/lab`, 100 kB en las rutas de sala), el servidor deja de
  guardarlo, lo lee hasta el final sin guardarlo y responde **413** `{error: "El cuerpo supera N bytes."}`; la
  conexión sigue sana. Si pasa de 4 veces el tope, corta la conexión sin responder (nadie legítimo manda tanto).
### 10.2 Soldados de un entreno (B2)
- `POST /api/lab/trainings` y el `training` de `POST /api/lab/dynasties/generation`: `soldiers` tiene que ser
  `"random"` o un entero de 1 a 4; si no, **400** `soldiers tiene que ser "random" o un entero entre 1 y 4` (como en
  los duelos). Sin `soldiers` (o `null`), `"random"`.
### 10.3 CORS (B4)
- `Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS` en todas las respuestas y en la de `OPTIONS`.
### 10.4 Registros que sobreviven a un reinicio (M9)
- Al terminar (bien, parados o con error), los duelos, entrenos y trabajos se guardan en `evo/records/<duels|trainings|jobs>/<id>.json`
  con la misma forma que devuelve la API (`duelView`, `trainingView(t, true)`, `jobView`). `GET /api/lab/duels/:id`,
  `/trainings/:id` y `/jobs/:id` miran la memoria y, si no, el disco; los listados suman los guardados que no están en
  memoria. Los ids de entrenos (`t7`) y trabajos (`j12`) siguen detrás de los guardados: tras reiniciar no se repiten.
### 10.5 Errores de pesos (B1)
- Cada error de `PUT /api/lab/nets/:id/weights/:bloque` lleva `example` con la forma que espera ese bloque, p. ej.
  `{"W": [512 números], "b": [16 números]}`.
