# Auditoría P0 (2026-09-23): lo hecho alrededor de la compactación

Revisión de 0e1b0ad (código de la parte 3), f9cb560 (interfaz), 987cb6b, ffc30c7, 18302a6 y 48f024e; de los
mutantes dados por equivalentes; de los tests congelados cambiados con OK (aa3dd31, 937a7da) y de los tests "extra".
Se buscaron fallos, no confirmaciones. Batería de partida en verde (67 grupos, 15 min 14 s).

## Hallazgos

| # | gravedad | dónde | qué pasa | cómo se reproduce | estado |
|---|---|---|---|---|---|
| P0-G1 | **grave** | `public/js/lab/{inicio,entreno,evolucion,trono,dinastias,verdad}.js` (`start()`) | Cada vista abre su propia conexión SSE a `/api/lab/events` y nunca la cierra. El navegador solo abre 6 conexiones por servidor: tras visitar 5 vistas con una sala espectada, las peticiones siguientes esperan para siempre y la vista sale **en blanco** (lo que se ve en el vídeo del 23/09 20:20 con Verdad y Cirugía). | Chrome sin ventana por CDP: abrir Inicio, Entreno, Evolución, Trono y Dinastías más una SSE → Cirugía 0 caracteres a los 5 s; con una sola SSE, 87 469. | ✅ `public/js/ui/sse.js` (una conexión por URL), `test/ui-sse.spec.mjs`; repetido el sondeo: Cirugía 87 469 y Verdad 2 047 |
| P0-M1 | medio | `evo/api.js:50-52` (`startChildrenJob`) | La cría se guardaba en disco **antes** de tener su resultado: tras reiniciar, `GET /api/lab/jobs/:id` daba `status: done` con `result: null` (el ranking de los hijos, perdido). | `test/auditoria-p0-api.spec.mjs`, caso 1 (rojo antes del arreglo). | ✅ spec/08 §10.7 |
| P0-M2 | medio | `public/js/lab/training.js:53-63` (`threadNote`) frente a `evo/train.js:685` | Con "los dos", el tope real de hilos es `min(hilos, lote que falta, gradientGamesPerCycle que falta)`; el aviso solo mira el lote. Con `batchGames` 4, `gradientGamesPerCycle` 2 y 8 hilos dice "como mucho 4 de los 8" y se usan 2; con 3 hilos no avisa y se usan 2. spec/04 §9.7 y plan2 ronda 16 dicen lo mismo de forma incompleta. | `threadNote({method:'both', gradient:{batchGames:4}, both:{gradientGamesPerCycle:2}}, 8, 'turbo')`. | ⏸ módulo puro congelado: pide tu OK |
| P0-M3 | medio | `test/arreglos-almacen.spec.mjs`, `-parte3-extra-api*` | Los tests de M9 (registros tras reiniciar) solo miraban un examen, cuyo resultado se pone antes de guardar: por eso P0-M1 pasó. | — | ✅ cubierto por `auditoria-p0-api` |
| P0-B1 | bajo | `evo/api.js:81` (`trainingView`), `evo/train.js` | El `elapsedMs` de un entreno terminado seguía creciendo para siempre (no se guardaba cuándo acabó). | `auditoria-p0-api`, caso 2. | ✅ spec/04 §9.8 (`endedAt`) |
| P0-B2 | bajo | `evo/api.js` (`readText`), `server/server.js` (`readBody`) | El tope se contaba en caracteres y cada trozo de la conexión se pasaba a texto por separado: una "Ñ" partida entre dos trozos llegaba como "��", y ~50 010 "ñ" (100 010 bytes) pasaban el tope de 100 000 bytes. | `auditoria-p0-api`, casos 3–5. | ✅ spec/08 §10.6 |
| P0-B3 | bajo | `training.js:61` | "En la de evolución, todos": solo es verdad si `population × gamesPerCandidate ≥ hilos` (`evo/train.js:650`). | `threadNote` con `evolution.population` 2 y 8 hilos. | ⏸ pide tu OK (mismo módulo que P0-M2) |
| P0-B4 | bajo | `public/js/lab/whatif.js:28-31` (`compare`) | Compara la elección por el índice del candidato: si la red editada cambia su Imaginación, el #i es otro tiro y "misma elección" puede mentir. | Cambiar las familias de la Imaginación en el editor y mirar "¿qué pasaría si…?". | ⏸ módulo puro congelado: pide tu OK |
| P0-B5 | bajo | `training.js:40` (`trainingBody`) | Con la dureza vacía el formulario manda 0; el servidor usa 2 por defecto (`evo/league.js:82`). | Vaciar "Dureza" (Científico) y entrenar. | ⏸ pide tu OK |
| P0-B6 | bajo | `.gitignore` | Faltaban `evo/snapshots/`, `evo/records/`, `evo/throne.json` y `evo/log.N.jsonl` (salían en `git status`). | `git status`. | ✅ (más `evo/worlds/` y `evo/archivo-*/` para P2) |
| P0-B7 | bajo | `public/js/lab/cirugia.js` + `surgery.divergingColor` | Un bloque con todos los pesos a 0 (los sesgos de una GRU nueva) se pinta del gris del panel: "no salen los cuadrados" (tu captura del 23/09 20:55). | Cirugía → Tortuga 1 → GRU. | ⏳ se arregla en el Quirófano de la ficha (P6), en la vista |
| P0-B8 | bajo | `evo/train.js:604` | `item.rivalId` no lo lee nadie (los recuerdos sacan el rival de los jugadores de la partida, línea 353). | — | anotado, sin tocar |

## Mutantes dados por equivalentes que no lo eran
| fichero:línea | qué se daba por equivalente | por qué no | test que lo cierra |
|---|---|---|---|
| `train.js:604` | `k % 20`, `seed + k` | spec/04 §4 y §9.4 los fijan | `auditoria-p0` (5/8; los 3 restantes: `% -20` es igual en JS, `rivalId` no se lee, `genomes` lo caza `arreglos-almacen`) |
| `throne.js:41` | `reignGames` | se define en spec/06 §8.1 (retos del reinado) | `auditoria-p0` |
| `model.js:95` | `(b.params \|\| {})` | mutado a `&&`, `setParam` borra los demás ajustes del bloque | `ui-huecos-p0` |
| `training.js:11–37` | "los límites del formulario los manda el servidor" | el formulario rechazaría valores válidos (1 hilo, semilla 0, 1 partida, mezcla de un solo tipo) | `ui-huecos-p0` |
| `whatif.js:25`, `:37` | certeza con 2 candidatos; "Ponla a jugar" | contrato de la función | `ui-huecos-p0` |
| `store.js:205` | `recursive` de `records/<tipo>` ("la carpeta ya existe") | `records/` no existe en una carpeta de datos nueva | la batería por la API (entreno en carpeta nueva) |

Siguen siendo equivalentes (revisados uno a uno): el dibujo del emblema (ninguna spec lo fija; el test pide determinista,
distinto por semilla y sin NaN), las coordenadas de las escenas de "¿qué pasaría si…?", las constantes de colocación
del editor y las guardas de caminos imposibles de `model.js` (tipos de bloque que no existen, columnas vacías), las
marcas de los ejes (`niceTicks`, probadas por propiedades) y las semillas internas de una generación (spec/06 §8.2).

## Revisado sin hallazgos
- **aa3dd31 y 937a7da**: solo cambió lo autorizado (trono, verdad, api-verdad y arreglos-almacen; ui-inicio caso 3);
  las huellas nuevas de `FROZEN.json` son exactamente esas 5 más `moviola-antigua` (nuevo).
- **Tests "extra"** (`arreglos-parte3-extra*`, `ui-entreno-hilos-b`): prueban reglas de la spec (spec/07 §12 índice y
  compactación, spec/08 §10 ids y registros), no el código.
- **Reintento tras ECONNRESET**: sin reintento, 6 vueltas (3 de cada test) con la salida de error del servidor capturada:
  0 cortes y el servidor sin errores. No tapa ningún fallo del servidor; sigue siendo una carrera del cliente
  (keep-alive) que solo se vio con la batería cargando la máquina.
- **0e1b0ad frente a revision-opus**: M1–M13, M15, B1–B4 y R5 hechos como se aprobaron, salvo P0-M1 de esta tabla.
