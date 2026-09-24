# 11 — Aprender en un hilo (sesiones 5 y 6, 2026-09-24)

> Decisión del usuario (sesión 5): "Aprender en un hilo", **ahora, antes de P3**. `hilos.spec` se queda como está.
> Sesión 6: premisas medidas (§0), alcance cerrado (§1, con las exhibiciones) y `hilos-c` en rojo y congelado (§3).

## 0. Por qué
Con "hilos para todo" (spec/04 §5.1) el servidor juega en su grupo de hilos, pero **aprende en su hilo principal**, y
mientras aprende no contesta a nada. Medido el 2026-09-24 (sesión 6, con el código de P1b y la máquina libre; "redes
lentas" = Vidente con Imaginación de 64 candidatos y Simulador fino; sondeo en el proceso, sin grupo de hilos):
- sueño de un entreno turbo de 3 soldados (de la última partida del lote al evento `sleep`): lote 4, **0,15–0,18 s**, y
  0,37–0,50 s el que lleva la partida de muestra; lote 8, 0,27–0,33 s y 0,56–0,63 s. (El relevo s5 decía 0,85 s por lote
  de 4: no se reproduce.) Crece con el lote (`batchGames` llega a 64) y con el tamaño de la red: con la capa de Instinto
  a 256 neuronas y lote 8, **1,07–1,73 s**;
- duelo `mix`: aprender tras cada partida 35–150 ms y el repaso final 0,3 s (256 neuronas: 0,13–0,43 s y **1,5 s**);
- empaquetar una partida de muestra (`packGame` = `JSON.stringify` + `gzip`, 1,3–2,3 MB comprimida): **0,14–0,34 s**;
- una decisión de la red lenta en una sala en vivo: 20 ms de media, 140 como mucho (eso sigue en el hilo principal).
En la interfaz son tirones: el SSE llega a golpes y un clic tarda. `hilos.spec` no lo veía porque solo cronometra
`/api/health` y el bloqueo suelto se lo come la petición de estado, que no mide (`hilos-b` ya cronometra todas, pero desde
la partida 1).

## 1. Qué cambia
Cuando hay grupo de hilos (el servidor lo crea al arrancar; un entreno con más de 1 hilo usa el suyo), el hilo principal
solo **coordina**: lo que cuesta CPU al aprender va a un hilo, **a cualquier velocidad** (turbo, x10, x1).
1. **Sueño del entreno** (`evo/train.js`, `sleep` del gradiente, también en "los dos"): `learnFromGames` (recompensas ya
   asignadas, ventajas, emociones, gradiente, Adam) y el **empaquetado de las partidas de muestra** del lote
   (`rewardEvents` + `emotionEvents` + `packGame`) se hacen en un hilo. El hilo principal aplica lo que vuelve (pesos,
   estado de Adam, Imaginación por uso) y escribe los ficheros. Grupo: el propio del entreno si tiene más de 1 hilo; si
   no, el del servidor.
2. **Duelos** (`evo/duel.js`, `learning` `hot` y `mix` partida a partida, y el repaso final de `mix`/`frozen`): el
   `learn`/`review` del aprendiz por defecto va a un hilo del grupo del servidor. Los aprendices inyectables
   (`opts.learner`) siguen valiendo: `runDuel` espera lo que devuelvan (un valor o una promesa).
3. **Exhibiciones** con `learn: true` (spec/04 §10.3; decisión del usuario en la sesión 6, "sí, también"): el aprendizaje
   por gradiente tras la partida va a un hilo, como el de los duelos. Mientras aprende, la red queda **ocupada**
   (`{kind:'exhibition', id: <código de la sala>}`, spec/04 §10.5: una bofetada que llegue espera en cola) hasta que
   guarda; si además es de evolución, el paso de evolución sigue después, igual que hoy, y la suelta al acabar.
4. **Partida de muestra del paso de evolución** (entreno `evolution` o "los dos"): se empaqueta en un hilo (mensaje
   `pack`); la cuenta del paso sigue en el hilo principal.
5. **Lo que no cambia de sitio** (barato y con estado del hilo principal): asignar recompensas y memoria de cada partida
   (`record`, `absorb`), bofetadas y caricias (un paso sobre una decisión), la cuenta del paso de evolución (sus partidas
   ya van en hilos), guardar red, Adam, curva y registro.
6. **Sin grupo** (tests, arena, llamadas en el proceso): todo como hoy, en el proceso. Es el mismo código.

## 2. Contrato
- Mensaje nuevo de `evo/worker.js`: `{type:'learn', genome, weights, optim:{m, v, t, mean}, games, cfg, samples}` →
  `{type:'done', weights, optim:{m, v, t, mean}, result, packed}`:
  - `genome`: la vista con la que aprende (`view(...)` del entreno, o el genoma del aprendiz del duelo); `weights`: los
    pesos actuales (`net.getFlat()`, `Float64Array`), que mandan sobre los del genoma; `games`: los del lote, con
    `rewards` ya asignadas y su `trajectory` (lo que lee `learnFromGames`);
  - `result`: lo mismo que devuelve hoy `learnFromGames` (`update`, `lesson`, `emotions`, `imagination`, `rewards`,
    `stats`, `episodes`);
  - `samples`: `[{index, meta, events, playerId, netId, tau, normalized, trajectory, genomes}]` de las partidas de muestra
    del lote → `packed`: `[{index, meta, gz}]` (lo que hoy hace `saveSample` antes de escribir, con las emociones de esa
    partida).
- Mensaje nuevo `{type:'pack', sample, game, emotions}` → `{type:'done', packed}` (la partida de muestra del paso de
  evolución, con las emociones que calculó el hilo principal).
- `learnInThread({pool, net, genome, games, optim, cfg, samples})` en `evo/train.js` → `{result, packed}`: con `pool`, el
  mensaje `learn`; sin `pool`, lo mismo en el proceso (el mismo código que usa el hilo). El entreno, el aprendiz por
  defecto de los duelos y las exhibiciones la usan (el aprendiz, con `learnAsync`, que absorbe en el hilo principal y
  aprende en el grupo del servidor; `learn`, síncrono, se queda como estaba para quien lo llame en el proceso).
- **Mismo resultado bit a bit** que aprendiendo en el proceso: pesos, `m`, `v`, `t`, `mean` de Adam, estadísticas de la
  recompensa, Imaginación por uso, emociones y el contenido de la partida de muestra guardada.
- **Mismo orden**: el lote siguiente no empieza hasta que el sueño vuelve y se aplica (como hoy). Parar o pausar durante
  un sueño en un hilo: el sueño acaba, se aplica y después se mira `stop` (como hoy, que el sueño es de una pieza). Un
  duelo no se da por acabado (ni suelta sus redes) hasta que vuelve el último repaso.
- Un hilo que revienta al aprender → el entreno acaba en `error` con el mensaje, y el duelo en `error` (como una partida
  que revienta); el hilo se sustituye.
- spec/04 §5.1 ("el hilo principal coordina y aprende") pasa a decir que coordina y aprende en un hilo (esta spec).

## 3. Tests (antes del código, congelados)
`test/hilos-c.spec.mjs`. Redes "lentas para aprender": Vidente con 64 candidatos, Simulador fino y la capa de Instinto a
256 neuronas. Con servidor propio y todas las peticiones cronometradas (estado y salud), desde el POST hasta el final:
1. Entreno turbo de 1 hilo, 3 soldados, 16 partidas en lotes de 8, semilla 17: el servidor contesta siempre en menos de
   500 ms. Premisa medida en el propio test: el mismo entreno en el proceso tarda más de 1 000 ms en algún sueño. Bit a
   bit contra el del proceso: pesos, `reward.stats`, Imaginación (`usage`, `families`), `optim.json` y las partidas de
   muestra (eventos `reward` y `emotion`).
2. Lo mismo con un entreno de 2 hilos (grupo propio): contesta siempre en menos de 500 ms.
3. Duelo turbo `mix`, 3 soldados, semilla 29: contesta siempre en menos de 500 ms; premisa: en el proceso, aprender tras
   una partida o el repaso tarda más de 1 000 ms; bit a bit, pesos y `optim.json` de las dos redes.
En el proceso, con un grupo de hilos propio y un espía que anota los mensajes (lo que no se puede cronometrar):
4. Entreno x10 (2 partidas, lote 1): un mensaje `learn` por sueño y los mismos pesos y Adam que sin grupo.
5. Paso de evolución (turbo, 1 soldado, semilla 14): un mensaje `pack` y la misma partida de muestra que sin grupo.
6. Exhibición con `learn: true`: un mensaje `learn`, la red ocupada mientras aprende y los pesos de aprender en el proceso.
7. Un mensaje `learn` que falla en el hilo: el entreno acaba en `error` con el mensaje; el duelo falla y suelta las redes.
Medido contra el código de hoy (sesión 6, con una prueba de mutantes corriendo a la vez): en rojo del 1 al 3 por la latencia (1 491, 1 690 y 2 018 ms; premisas 1 528 y
1 664 ms) y del 4 al 7 porque no llega ningún mensaje; los oráculos en verde y lo bit a bit en verde (hoy trivial).

## 4. Mutantes
`evo/train.js` (sueño, `learnInThread`, `learnAsync`, muestra de la evolución), `evo/duel.js` (aprendiz en hilo),
`evo/api.js` (exhibición) y `evo/worker.js` (`learn`, `pack`).
