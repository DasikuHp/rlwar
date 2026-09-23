# 00 — Arquitectura del laboratorio

> Contrato compartido. Lo escribe Fable (sesión 1, 2026-09-22). Lo usan: Fable (tests y código
> crítico), Opus (interfaz) y cualquier agente externo. Estado: **borrador para revisión del usuario**.
> Leyenda: ✅ decidido por el usuario (plan2.md) · 🧭 elegido por Fable (delegado) · ❓ pregunta abierta.

## 0. Convenciones
- **Claves de datos en inglés** (`blocks`, `wires`, `weights`, `soldierId`…), igual que el código y la
  API actuales. **Textos para personas en español** (nombres de bloque, explicaciones, frases). 🧭
- Números: `Float64Array` en memoria, arrays JSON en disco con precisión completa (guardar y cargar da
  exactamente lo mismo).
- Sin dependencias: Node ≥ 18, `node:worker_threads`, `node:fs`, `node:crypto` (huellas SHA-256).
- Toda aleatoriedad del laboratorio y de las partidas pasa por `shared/rng.js` con semilla (✅ ronda 12:
  también los heurísticos). `Math.random` queda solo para códigos de sala y tokens.
- Cada módulo crítico tiene su spec (`spec/01…08`), sus tests (`test/*.spec.mjs`, congelados en
  `test/FROZEN.json`) y pasa `tools/mutants.mjs`.

## 1. Mapa de módulos

```
shared/            Lógica pura, sin I/O (servidor, hilos de entreno y navegador)
  rng.js           PRNG con semilla (mulberry32): makeRng(seed) → rng, función `() → [0,1)` con
                   rng.int(n), rng.pick(arr), rng.gauss(), rng.seed; compatible con Math.random
  constants.js     + MOVE_RADIUS, BODY, MIN_SEPARATION, MOVE_TIME, límites del laboratorio (LIMITS)
  geometry.js      validación y deslizamiento de movimiento (spec/01 §3): slideMove(...)
  genome.js        esquema del genoma, catálogo de bloques (BLOCKS), validate(), limits (spec/02)
  nn.js            compila un genoma → red ejecutable: forward, backward (BPTT), params (spec/02)
  percept.js       los 8 ojos, 🎲 Imaginación (candidatos), destinos de movimiento, rasgos (spec/03)
  policy.js        decide con una red: observación → red → disparo+ajuste+movimiento, log-probs,
                   atribución "tapar y comparar" (spec/03 §7, spec/07 §3)
  reward.js        recompensa editable + normalización + etiqueta + hitos (spec/04 §2)
server/
  rooms.js         Room: + move (spec/01), + modo síncrono sin pantalla (headless), + seed
  headless.js      playGame({seed, left, right, soldiers, learn?}) → resultado + trayectorias (spec/01 §6)
  server.js        + rutas /api/lab/* (spec/08) delegadas a evo/api.js
agents/
  lib.js           igual, pero todo `Math.random` → `rng` recibido (compatible: por defecto Math.random)
  net.js           agente tipo `net`: envuelve una red guardada (chooseShot + chooseMove)
  registry.js      lista además las redes guardadas como `net:<id>` (spec/08 §2)
evo/               Laboratorio (estado en disco, hilos, trono)
  store.js         evo/nets/<id>.json · evo/throne.json · evo/games/<gameId>.json (spec/07 §1)
  train.js         REINFORCE+baseline+BPTT, evolución (ES), ambos; x1/x10/turbo con worker_threads (04)
  worker.js        hilo: recibe genoma + config → juega partidas sin pantalla → devuelve trayectorias
  mutate.js        mutación de pesos y estructura, hijos, pre-torneo, cirugía, import/export (05)
  duel.js          duelo 3 mapas × 2 lados, 1–4 soldados sorteados, modo de aprendizaje (06)
  throne.js        trono, dinastías, liga (sala de la fama, fantasmas, retadora), genealogía (06)
  truth.js         registro de eventos, atribución, confianza, emociones, memoria de rivales,
                   neuronas con nombre, boletín, lección; verificador "exacto y real" (07)
  api.js           REST + SSE del laboratorio (08)
tools/
  mutants.mjs      prueba de mutantes sin dependencias (spec/00 §4)
  freeze.mjs       congela tests: escribe huellas SHA-256 en test/FROZEN.json
test/
  run-all.mjs      + comprueba FROZEN.json antes de correr nada
  FROZEN.json      {"<ruta del test>": "<sha256>", ...}
```

Regla de dependencia: `shared/*` no importa nada de `server/`, `evo/` ni `agents/`. `evo/*` importa
`shared/*` y `server/headless.js`. `agents/net.js` importa `shared/*` y `evo/store.js` (solo lectura).

## 2. Flujo de una decisión de red (resumen; detalle en 03)
1. `percept.observe(state, soldierId, genome)` → `obs` = {ctx: Float64Array, cands: [{feat, cand}],
   moves: [{feat, dest}]} según los ojos que tenga el genoma.
2. `nn.forward(net, obs, memoryState)` → salidas por bloque de Manos/Pies + nuevo estado de memoria.
3. `policy.decide(...)` → `{mode, expr, angle?, move?, decision}` donde `decision` es el registro completo
   (candidatos, puntuaciones, probabilidades, elegido, ajuste, destinos, atribución) que va al overlay y
   al registro de eventos.
4. La sala valida en `fire()` (único punto) y, tras el resultado, `chooseMove()` o el `move` ya enviado.

## 3. Flujo de aprendizaje (resumen; detalle en 04)
- **Toda partida es experiencia** ✅: la sala (viva o sin pantalla) devuelve por cada red las
  trayectorias `[{obs, decision, logp, reward, done}]` por soldado y por turno.
- x1/x10: la sala viva entrena en el mismo proceso al acabar cada partida (fase "sueño").
- turbo: `evo/train.js` reparte partidas a `worker.js` (N hilos); cada hilo devuelve trayectorias;
  el hilo principal calcula gradientes y actualiza; envía curvas por SSE.

## 4. Herramientas de proceso
### Congelado (`tools/freeze.mjs`, `test/FROZEN.json`)
- `node tools/freeze.mjs test/x.spec.mjs [...]` calcula SHA-256 del contenido (LF) y lo escribe en
  `test/FROZEN.json`. `run-all.mjs` recalcula todas las huellas antes de correr; si alguna no coincide,
  **falla la batería** con el nombre del fichero y no ejecuta nada.
- Cambiar un test congelado: OK del usuario + motivo escrito en el commit + `freeze` de nuevo.

### Mutantes (`tools/mutants.mjs`)
- `node tools/mutants.mjs <fichero.js> --tests test/a.spec.mjs[,test/b.spec.mjs] [--max N] [--seed S]`
- Genera mutantes cambiando **un** operador o constante por mutante (`+`↔`-`, `*`↔`/`, `<`↔`<=`,
  `>`↔`>=`, `===`↔`!==`, `&&`↔`||`, `true`↔`false`, número `k` → `k+1`, `0`, `-k`, `return x` →
  `return null`), escribe el fichero mutado en una copia temporal del repo (nunca toca el original: copia en el
  directorio temporal del sistema, `gw-mutants-<pid>`, sin `.git`, `node_modules`, `referencia`,
  `evo`), corre los tests indicados con tiempo máximo y cuenta **cazado** (algún test falla o revienta por tiempo) o **superviviente**.
- Salida: tabla `mutante · línea · cambio · cazado/superviviente` + resumen `cazados X/Y`. Los
  supervivientes se copian a `spec/mutantes.md` con justificación escrita.
- Tests propios: `test/tools.spec.mjs` (freeze detecta un byte cambiado; mutants caza un `+`→`-` en un
  módulo de juguete y reporta un superviviente en una línea no cubierta).
- `--lines a-b[,c…]` (2026-09-23): solo los mutantes de esas líneas; el filtro va antes de `--max`.
- `--server [--port N]` (2026-09-23), para los specs que necesitan servidor. En cada mutante levanta
  `server/server.js` **de la copia**, ya con el fichero mutado, con `GW_FAST=1`, `PORT=N` (por defecto 8850) y un
  `GW_EVO_DIR` nuevo y vacío. Espera a `/api/health` (20 s como mucho) y pasa `http://localhost:N` como primer
  argumento a cada test. Lo apaga y espera a que salga antes del mutante siguiente, así el puerto queda libre.
  Si el servidor mutado sale antes de responder, o no responde a tiempo, el mutante cuenta como **cazado** con el
  detalle `el servidor no arranca`. En proceso: `runMutants({…, lines, server: true, port})`.
  Tests: `test/tools-servidor.spec.mjs`.
- **Línea base** (2026-09-23): antes del primer mutante corre los tests sobre la copia **sin mutar** (con su
  servidor si hay `--server`). Si alguno falla, no hay tirada: `runMutants` lanza `los tests fallan sin mutante:
  <test> (sale N)` y la CLI sale 1. Sin esto, un test que falla por otra causa (p. ej. el orden de las suites en un
  mismo servidor: `api-trono` falla si corre después de `arreglos-trono`) contaría como cazador de todos los
  mutantes. Tests: `test/tools-base.spec.mjs`.

## 5. Fases y qué congela cada una (para Opus)
| Fase | Ficheros críticos | Congela para la interfaz |
|---|---|---|
| F1 | rng, geometry, constants, rooms (+move, +seed, +headless), headless, agents/lib, 4 heurísticos | `state.turn.stage`, `state.turn.move`, `lastMove`, evento SSE `move`, `POST /move`, `fire.move` |
| F2 | genome, nn | genoma JSON, catálogo (`GET /api/lab/catalog`), validación e importación |
| F3 | percept, policy, agents/net, registry | `decision` (overlay), `net:<id>` en `/api/agents`, evento SSE `decision` |
| F4 | reward, train, worker | entrenos (`/api/lab/trainings`), eventos `training`, `curve`, `sleep`, `lesson` |
| F5 | mutate | hijos, pre-torneo, diferencias, cirugía, export/import |
| F6 | duel, throne | duelos, trono, dinastías, liga, genealogía |
| F7 | truth | eventos, frases con refs, confianza, emoción, diario, boletín, moviola, neuronas |

## 6. Límites globales (`shared/constants.js:LIMITS`) 🧭
| Límite | Valor | Por qué |
|---|---|---|
| bloques por genoma | 64 | editor legible; forward < 5 ms |
| cables por genoma | 256 | idem |
| neuronas por bloque denso/memoria | 512 | 512×512 = 262k pesos por bloque |
| parámetros totales | 2 000 000 | JSON ≈ 40 MB máx.; carga < 1 s |
| candidatos de disparo (N) | 4–64 | overlay legible; 64 sims ≈ 8 ms |
| destinos de movimiento | 9 fijos (8 dir + quedarse) | ✅ ronda 2 |
| tamaño de un genoma JSON | 48 MB | `readBody` del servidor sube a ese tope solo en /api/lab; si se pasa, 413 (spec/08 §10.1) |
| redes guardadas | 500 | listado rápido |
| partidas guardadas (moviola) | 200 por red, borra las más viejas | disco acotado |
| eventos por partida | 5 000 | 90 disparos × (decisión + candidatos) sobra |

Todo lo que llega de fuera (import, editor) pasa por `genome.validate()`; nada puede colgar el
servidor: la validación es O(bloques + cables + pesos) y rechaza antes de reservar memoria.
