# 11 — Aprender en un hilo (sesión 5, 2026-09-24)

> Decisión del usuario (2026-09-24): "Aprender en un hilo", **ahora, antes de P3**. `hilos.spec` se queda como está.

## 0. Por qué
Con "hilos para todo" (spec/04 §5.1) el servidor juega en su grupo de hilos, pero **aprende en su hilo principal**, y
mientras aprende no contesta a nada. Medido el 2026-09-24 con el código de P1b (entreno turbo de 1 hilo, redes lentas =
Imaginación de 64 candidatos + Simulador fino):
- sueño de un lote de 4 partidas: **~0,85 s** sin contestar (con Vidente normal, 0,15–0,45 s);
- la primera actualización de cada entreno: 0,3–0,8 s (en frío, y guardando entera la partida de muestra 0:
  `packGame` = `JSON.stringify` + `gzip`);
- crece con el lote (`batchGames` llega a 64): varios segundos.
En la interfaz son tirones: el SSE llega a golpes y un clic tarda. `hilos.spec` no lo veía porque solo cronometra
`/api/health` y el bloqueo suelto se lo come la petición de estado, que no mide (`hilos-b` ya cronometra todas).

## 1. Qué cambia
Cuando hay grupo de hilos (el servidor lo crea al arrancar; un entreno con más de 1 hilo usa el suyo), el hilo principal
solo **coordina**: lo que cuesta CPU al aprender va a un hilo.
1. **Sueño del entreno** (`evo/train.js`, `sleep` del gradiente, también en "los dos"): `learnFromGames` (recompensas ya
   asignadas, ventajas, emociones, gradiente, Adam) y el **empaquetado de las partidas de muestra** del lote
   (`rewardEvents` + `emotionEvents` + `packGame`) se hacen en un hilo. El hilo principal aplica lo que vuelve (pesos,
   estado de Adam, Imaginación por uso) y escribe los ficheros.
2. **Duelos** (`evo/duel.js`, `learning` `hot` y `mix` partida a partida, y el repaso final de `mix`/`frozen`): el
   `learn`/`review` del aprendiz va a un hilo.
3. **Lo que no cambia de sitio** (barato y con estado del hilo principal): asignar recompensas y memoria de cada partida
   (`record`, `absorb`), bofetadas y caricias (un paso sobre una decisión), el paso de evolución (su cuenta es barata; sus
   partidas ya van en hilos), guardar red, Adam, curva y registro.
4. **Sin grupo** (tests, arena, llamadas en el proceso): todo como hoy, en el proceso. Es el mismo código.

## 2. Contrato
- Mensaje nuevo de `evo/worker.js`: `{type:'learn', genome, weights, optim:{m, v, t, mean}, games, cfg, samples}` →
  `{type:'done', weights, optim:{m, v, t, mean}, result, packed}`:
  - `genome`: la vista con la que aprende (`view(...)` del entreno, o el genoma del aprendiz del duelo), sin pesos;
    `weights`: los pesos actuales (`net.getFlat()`, `Float64Array`); `games`: los del lote, con `rewards` ya asignadas;
  - `result`: lo mismo que devuelve hoy `learnFromGames` (`update`, `lesson`, `emotions`, `imagination`, `rewards`,
    `stats`, `episodes`);
  - `samples`: `[{index, meta, playerId, netId, tau, normalized}]` de las partidas de muestra del lote → `packed`:
    `[{index, meta, gz}]` (lo que hoy hace `saveSample` antes de escribir).
- **Mismo resultado bit a bit** que aprendiendo en el proceso: pesos, `m`, `v`, `t`, `mean` de Adam, estadísticas de la
  recompensa, Imaginación por uso, emociones y el contenido de la partida de muestra guardada.
- **Mismo orden**: el lote siguiente no empieza hasta que el sueño vuelve y se aplica (como hoy). Parar o pausar durante
  un sueño en un hilo: el sueño acaba, se aplica y después se mira `stop` (como hoy, que el sueño es de una pieza).
- Un hilo que revienta al aprender → el entreno acaba en `error` con el mensaje (como una partida que revienta).

## 3. Tests (antes del código, congelados)
`test/hilos-c.spec.mjs`, con servidor propio y todas las peticiones cronometradas (estado y salud):
1. Entreno turbo de 1 hilo, redes lentas, lote de 4 (el de fábrica): el servidor contesta **siempre**, desde el POST
   hasta `done`, en menos de 500 ms. Premisa medida en el propio test: el mismo entreno en el proceso tarda más de
   1 000 ms en algún sueño (desde la última partida del lote hasta el evento `sleep`).
2. Lo mismo con un entreno de 2 hilos (grupo propio).
3. Duelo turbo `hot` entre redes lentas: el servidor contesta siempre en menos de 500 ms; premisa: en el proceso, algún
   `learn`/`review` del duelo tarda más de 1 000 ms.
4. Bit a bit: el entreno del punto 1 por la API y el mismo en el proceso dejan iguales pesos, Adam (`optim.json`),
   `reward.stats`, `imagination.usage` y la partida de muestra (eventos `reward` y `emotion` incluidos); el duelo del
   punto 3, iguales pesos y Adam de las dos redes.

## 4. Mutantes
`evo/train.js` (sueño y aplicación de lo que vuelve), `evo/duel.js` (aprendiz en hilo), `evo/worker.js` (`learn`).
