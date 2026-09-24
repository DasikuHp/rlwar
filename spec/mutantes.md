# Mutantes supervivientes (justificados)

> `tools/mutants.mjs` mete un fallo por mutante y exige que algún test lo cace. Los supervivientes
> se anotan aquí con su motivo. Un superviviente **sin** motivo escrito es un test que falta.
> "Equivalente" = el programa mutado se comporta igual (no hay test posible que lo distinga).

## Herramientas (`tools/freeze.mjs` contra `test/tools.spec.mjs`, 2026-09-22) — cazados 41/54
| línea | cambio | por qué sobrevive |
|---|---|---|
| 1 | `/` → `*` en `#!/usr/bin/env node` | fallo del escáner: no saltaba la línea shebang. **Arreglado** (el shebang es comentario) y test añadido; ya no se genera. |
| 38 | `JSON.stringify(sorted, null, 2)` → `3`, `0`, `-2` | sangría del JSON: solo formato, el contenido es idéntico. |
| 64 | `process.argv[1]` → `[2]`, `[0]` | guarda de "¿me ejecutan como CLI?": solo comprueba que exista algo; equivalente. |
| 72 | `process.exit(r.ok ? 0 : 1)` (código de salida de `--check`) | no estaba cubierto → **test añadido** (`freeze --check` sale 1/0). |
| 76 | `process.exit(2)` (uso sin ficheros) | mensaje de uso; el código de salida no importa. |

## F1

### `shared/geometry.js` contra `test/geometry.spec.mjs` (los 123 mutantes) — cazados 109/123
Antes, con solo `test/motor.spec.mjs` (muestra de 25): 11/25. La prueba mostró que el spec era
corto → se escribió `geometry.spec.mjs` (150 escenas aleatorias contra fuerza bruta + bordes exactos).
| línea | cambio | por qué sobrevive |
|---|---|---|
| 15 | `k <= 10` → `k < 10` (muestreo del segmento) | la muestra `t = 1.0` es el propio destino, que ya comprueba la regla 3: equivalente. |
| 25, 42 | `>` → `>=` (radio exacto `R + 1e-9`) | igualdad en coma flotante prácticamente imposible: equivalente. |
| 37 | `slid = false` por defecto → `true` en `stay('invalid'/'stay')` | lo cubre `motor.spec` (asserta `slid:false` para `stay`/`null`); en este spec no se asertaba. |
| 38 | `\|\|` → `&&` en la comprobación `'stay' \|\| null \|\| undefined` | `null` y `undefined` los cubre `motor.spec`; aquí no se usan. |
| 48 | `360 → 361` · `/` → `*` en `na = round(360/5)` | `round(361/5)` = 72 igual; `360·5` = 1 800 ángulos: rejilla más fina, mismo resultado (más lenta). Equivalentes. |
| 49 | `i = 1` → `2`, `0`, `-1` (primer radio) | `2`: se pierde el radio 0.05 (dentro de la tolerancia 0.1 del test); `0`: añade el propio origen, que casi nunca es el más cercano a T; `-1`: radios negativos = ángulo + 180°, puntos ya cubiertos. Equivalentes a efectos del contrato. |
| 51 | `k < na` → `<=` | añade el ángulo 360° = 0° repetido: equivalente. |
| 56 | `<` → `<=` · `1e-12 → 0` (desempate) | empates exactos en coma flotante entre puntos distintos son rarísimos; el orden r↑ θ↑ ya lo garantiza el recorrido. |
| 59 | `slid: true` → `false` en `blocked` | **test añadido** (`blocked` ⇒ `slid:true`) en `geometry.spec`; cazado desde entonces. |

### `shared/rng.js` contra `test/rng.spec.mjs` (los 65) — cazados 59/65
| línea | cambio | por qué sobrevive |
|---|---|---|
| 5 | `Math.random() * 2 ** 31` → `/`, `2 → 0`, `31 → 0/-31` (`randomSeed`) | la semilla sorteada sigue siendo un entero válido en [0, 2³¹); solo cambia su distribución. No afecta a nada reproducible (una vez sorteada, se expone y se reutiliza). |
| 30 | `2 * Math.PI` → `3π`, `−2π` en Box-Muller | `cos(−2πv) = cos(2πv)`: equivalente; `cos(3πv)` da también media 0 y varianza 1 (el test estadístico no lo distingue y no hay contrato sobre la secuencia gaussiana exacta). |

### `agents/lib.js` contra `test/moves.spec.mjs` (los 353) — cazados 77/353
Con `motor.spec` (muestra de 25): 8/25; los 17 supervivientes eran **constantes de ajuste de los
heurísticos de disparo** (puntuación 1000, radio 3 u, 6 disparos directos, 40 plantillas, pesos
0.7/0.2/0.1, σ de pulso…): no son parte del contrato (los heurísticos son sparring, no lo crítico),
así que no se fijan por test. Las funciones de movimiento (`los`, `moveOptions`, `coverMove`,
`greedyMove`) sí son contrato y se cubren con `moves.spec.mjs` (120 escenas contra reglas
reimplementadas). Los 276 supervivientes están en las líneas 11–193 (heurísticos de disparo, sin
contrato) salvo estos de la zona de movimiento (201–243): `Math.max(1, …)` → 2 en el muestreo de la
línea de tiro (más muestras: equivalente); bordes inferiores `>=` del rect en `los` (solo se prueba el
borde superior); `d < distEnemy` → `<=` (empate exacto entre dos enemigos equidistantes); y la rama
`farther:false` de `coverMove`, que nadie usaba → **eliminada** (código muerto).

### `server/rooms.js` contra `test/rooms.spec.mjs` (los 486) — cazados 202/486
Con `motor.spec` (muestra de 25): 7/25. Los supervivientes eran lógica de sala sin test directo
(equipos llenos, nombres repetidos, recortes de nivel/temperatura, desempates de `gameOver`,
estancamiento, límites, `snapshot`) → se escribió `rooms.spec.mjs`. Los 284 supervivientes que quedan
son: tiempos de la sala viva (líneas 203–204, 259, 317–318, 354: retardos de animación, habla y
ventana, que solo existen con pantalla y se prueban en `motor.spec` por comportamiento, no por
constante); textos de los mensajes de chat (296–302, 337, 503); constantes de recorte de nombres y
tokens (91–92, 116); límites del chat (61, 120 → 121) y de la limpieza de salas (528–530); el
bucle de 300 intentos de `nextTurn` (187); y comparaciones de borde equivalentes (`>=`/`>` en
`angle 85`, 275). Nada de ello cambia una regla del juego.

## F2

### `shared/nn.js` contra `test/red.spec.mjs` (muestra de 150 de 666, semilla 11) — cazados 139/150
| línea | cambio | por qué sobrevive |
|---|---|---|
| 112, 128, 160, 303, 348 | `<` → `<=` en bucles sobre `Float64Array` | escribir/leer una posición más allá del final de un typed array no hace nada: equivalente. |
| 298 | `let s = 0` → `1` en la derivada de la atención | sumar una constante a todas las `da[r]` no cambia `a·(da − Σ a·da)`: equivalente (invariancia del softmax). |
| 285 | `dxh[j] = gy[j] * W.g[j]` → `/ W.g[j]` (norm) | **gap real**: `g` se inicializa a 1 y la comprobación del gradiente se hace con los pesos iniciales, donde `g = 1/g`. Se pide al usuario cambiar `red.spec` (pesos perturbados antes de comprobar). Comprobado a mano: con `g ≠ 1` el test lo caza. |
| 304 | `j = 0 → 1` en el gradiente de `q0` | `q0` tiene 4 números; el muestreo de 80 índices puede no tocar `q0[0]`. Se pide al usuario ampliar el muestreo (todos los parámetros si son ≤ 600). |
| 308 | `o += … → o -= …` (varias entradas de candidatos en Atención) | ningún test tiene Atención con **dos** cables de candidatos. Se pide añadir el caso a `red.spec`. |
| 386 | `subarray(0, 1)` → `(1, 1)` (gradiente de Moverse) | muestreo (3 pesos entre 135). Misma petición de ampliar el muestreo. |
Vistos a mano los tres `*` de la línea 285: `G.g` y `m2` se cazan (error 0.48 y 0.72); solo el
de `W.g` sobrevive por la inicialización a 1.

**Segunda tirada** (tras el cambio autorizado de `red.spec`: pesos perturbados, muestreo completo,
Atención con dos entradas; muestra de 200, semilla 23) — cazados **171/200**. Los 29 supervivientes son
todos `<` → `<=` en bucles sobre typed arrays (equivalentes), `s = 0` → `1` en la atención
(invariancia del softmax), `||`/`&&` en guardas de nulos que las entradas válidas nunca activan, y
`1 → 2` en `subarray(1, 3)` de Moverse sin ajuste (rama no usada cuando `adjust:false`). Los cuatro
gaps reales de la primera tirada (285, 304, 308, 386) ya se cazan.

### `shared/genome.js` contra `test/red.spec.mjs` (muestra de 150 de 925) — cazados 63/150
- Líneas 25–58, 86–146: **defaults y catálogo** (recompensa, rasgos, aprendizaje, familias de la
  Imaginación, rangos de parámetros). Son decisiones del usuario → **`test/genoma.spec.mjs` los
  fija** todos (añadido tras la tirada).
- Líneas 162 (constantes del hash del emblema), 188 (`n` de `dims`, campo informativo), 335 (ídem):
  equivalentes o sin contrato.
- Líneas 358, 382, 390–391, 402, 414, 417, 427, 430, 460–461, 535: validaciones sin caso de test
  (no-objeto, familias/pesos de la Imaginación, `grazeRadius`, rangos de `learning` con genoma
  válido, exactamente 64 bloques / 256 cables, ids de bloque, parámetros `number`/`set`, avisos
  `unconnected` en ambos sentidos, `newGenome` sin nombre) → **cubiertas en `genoma.spec.mjs`**.
**Segunda tirada** con `red.spec + genoma.spec` (muestra de 200, semilla 23) — cazados **167/200**.
Supervivientes: mínimos/máximos de rangos del catálogo y de `LEARNING_RANGES` que `genoma.spec` no
fija uno a uno (p. ej. `min: 1` → 2 de `units` en memorias, `[0.5, 10]` de `grazeRadius`), constantes
del hash del emblema, y comparaciones equivalentes (`>` → `>=` en `n − used`). Ninguno cambia un
contrato escrito.

### `shared/templates.js` contra `test/red.spec.mjs` (los 55) — cazados 28/55
Los 27 supervivientes son las **constantes de las plantillas** (32 → 33 neuronas, semillas 101…104,
`survive` 0.3 → 1.3, `adjust` true/false): son elecciones de diseño de las plantillas, no contrato
(la spec/08 §7 fija la forma, y el test comprueba bloques clave, `survive` 0.5 de la Tortuga y que
validan y disparan). Se aceptan.

## F3

### `shared/policy.js` (muestra de 120 de 194) y `agents/net.js` (los 40) contra `test/politica.spec.mjs`
**Cazados 120/120 y 40/40: sin supervivientes.**

### `shared/percept.js` contra `test/percepcion.spec.mjs` (muestra de 200 de 1 272, semilla 31) — cazados 151/200
Los 49 supervivientes, agrupados:
- **Gaps reales** (no había test) → cubiertos en **`test/percepcion-extra.spec.mjs`** (añadido; no toca
  el spec congelado): conversión grados→radianes del ángulo en `simulateCandidate` (línea 213),
  `victimIsNearest` positivo (226), espejo del equipo derecho para obstáculos/radar/mapa/destinos (17),
  media x de compañeros con aliados asimétricos (347), escala `p1` del ajuste de senos/parábolas (161),
  resultado "otro fin" en el historial (266) y minDist al tope, rama `invalid` de la simulación (212),
  la recta exacta va la primera (143).
- **Equivalentes para cualquier entrada válida**: comparaciones de borde en flotantes (`<` → `<=`
  en 217, 308, 360), guardas de nulos que las entradas válidas no activan (177, 294, 324, 169, 388),
  `fine = false` por defecto (208; los tests pasan el valor), `maxSteps 20000 → 20001` (214).
- **Sin contrato exacto**: el barajado de Fisher–Yates (117: el contrato fija la rejilla y el cupo, no
  el orden), el objetivo virtual `+20` (99), el texto de `eyeLayout` (421), detalles de recorte de la
  polilínea (202–205).
- **Cupos**: `total = 0 → 1` y el desempate del reparto (106, 112) dan los mismos cupos para los
  pesos por defecto y para n = 10 (comprobado a mano); no cambian ningún caso de la spec.

### `evo/store.js` (los 20) contra `test/politica.spec.mjs`
Primera tirada (los 20) contra `politica.spec` — cazados **15/20**. Los 5 supervivientes eran huecos reales
(`mkdirSync` sin `recursive`, el texto del aviso de un fichero inválido, `deleteNet` con id inválido) →
cubiertos en **`test/aprendizaje-extra.spec.mjs`**. Segunda tirada con `politica + aprendizaje-extra`:
**20/20, sin supervivientes** ✔.

## F4

### `shared/reward.js` contra `test/aprendizaje.spec.mjs` (muestra de 40 de 131, semilla 41) — cazados 31/40
Los 9 supervivientes eran bordes sin caso: `α = 1/min(n, 500)` exacto, `τ` por defecto, trayectoria
ausente, `minAllyDist ≤ 1.5` (inclusive), ventana de 10 tiros de "repetir", ganancia de cobertura,
`own/team/effective` iniciales → cubiertos en `aprendizaje-extra.spec`. **Segunda tirada, los 131**
contra `aprendizaje + aprendizaje-extra`: **124/131**. Los 7 supervivientes son equivalentes:
- línea 4 (`mean`/`var` iniciales 0 → 1): el primer valor entra con α = 1 y los sobreescribe;
- línea 29 (`own/team/effective` iniciales): se recalculan siempre antes de devolver;
- línea 51 (`<` → `<=` entre id de decisión e id de muerte): nunca son iguales (ids distintos por evento);
- línea 69 (media de equipo con 0 entradas): no se usa cuando no hay entradas.

### `evo/train.js` contra `aprendizaje.spec` (muestra de 60, semilla 41) — 28/60 → 33/60 → 39/60
Tres rondas: cada una destapó huecos que se cubrieron en `aprendizaje-extra`, `entrenador-extra` y
`entrenador-extra-b` (recorte exacto de la norma, atribución por bloque, congelado que no es el primero,
momento de Adam con gradiente 0, fórmula exacta de la evolución antitética y sus valores por defecto,
`gameSummary`, duración por minutos y por meseta con ventana 2, referencia media exacta, entropía y
`valueLoss` exactos, `optim.mean` heredado, semilla aleatoria amplia, `speed` de las salas x10/x1, mezcla de
rivales sin normalizar, `reward.stats` guardado). Los 21 supervivientes de la tercera ronda (ficheros de
antes de F6; F6 cambia `pickRival` y se vuelve a tirar al cerrar F6), agrupados:
- **Valores por defecto de la configuración** (líneas 25 `bptt ≥ 1`, 245 `self 0.15`, 270 `mean` de un
  optim antiguo, 362 `window 50`/`minGain`): la spec/04 fija los defaults; los tests pasan valores explícitos.
  No cambian ningún caso con configuración completa.
- **Equivalentes**: 37 (`H` inicial: se sobreescribe en cada rama con salida), 46 (`<` → `<=` en un bucle
  cuyo índice extra cae fuera del `Float64Array`), 197 (`optim.mean` con `|| 1` solo si falta el objeto),
  201 (`>` → `>=` en flotantes), 238 (numeración de entrenos), 273 (`Pool(1)` para turbo con 1 hilo: mismos
  pesos, solo cambia el hilo), 283/287/290 (constantes de las semillas por partida: determinismo con
  cualquier constante; la spec no fija la fórmula), 284/285 (mezclas con claves ausentes: el entrenador
  siempre rellena las tres), 324 (`speed 0` → la sala lo lleva a 1), 350 (`mkdir recursive`: el padre existe).

### `evo/store.js` (los 20) contra `politica + aprendizaje-extra` — 20/20 ✔ (ver F3).

## F5

### `evo/mutate.js` contra `test/evolucion.spec.mjs` (muestra de 40 de 616, semilla 41) — en curso al cerrar la sesión
Registro en `scratchpad/mutants-f5.log` (mutate 40, labels 20, diff 20, children 20; cada mutante corre el
spec completo, ~1 min). Supervivientes vistos hasta ahora y su lectura:
- 57 (`n >= 0` → `> 0` en las letras de hermano): solo cambia con ≥ 26 hermanos; `n` está limitado a 16.
- 202/203 (`removeWire`: recuento de entradas/salidas y umbral `≥ 2`): equivalentes en los genomas del
  test; **hueco real** en general (permitiría quitar la única entrada de un bloque no-ojo) →
  pendiente `evolucion-extra.spec` (caso: origen con 2 salidas y destino con 1 entrada).
- 279 (`eyeParams` int: `rng.int(2) + 1` → siempre 1; `<` → `<=`): el test solo cubre el Radar (enum) →
  pendiente extra con `obstacles.slots`.
- 287 (rama `number` de `eyeParams`): ningún ojo tiene parámetros `number` → inalcanzable.
- 296 (`imagination.n ± rng.int(0..4)`): el test acota |Δn| ≤ 4 pero no exige que suba y baje →
  pendiente extra (en 60 semillas aparecen subidas, bajadas y |Δn| = 4).

Resultado final de la primera tirada de F5 (`scratchpad/mutants-f5.log`, semilla 41, ~1 min por mutante):
- `evo/mutate.js` (40 de 616): **28/40**. Los huecos reales (202/203 `removeWire`, 279 `eyeParams` entero, 296 `Δn`)
  ya están cubiertos en **`test/evolucion-extra.spec.mjs`** (congelado); 57 (≥ 26 hermanos), 287 (rama `number`
  inalcanzable), 329 (`σ` de `weights`: el test acota el ruido pero no su signo) y 350 (`emblem`: `rng.int(2^31)`
  con `2 → 0` da siempre 0: el test exige distintos en 30/40 → equivalente en la muestra) quedan justificados.
- `evo/labels.js` (los 20 de 59): **15/20**. Supervivientes 22/23 (guardas `||`/`!==` en `outLabels` de bloques de
  paso sin entradas), 40/41 (`add`/`mul` sin entradas), 47 (`pool` con una sola entrada): ramas que los genomas
  válidos del test no alcanzan.
- `evo/diff.js` (20 de 131): **7/20**. Supervivientes en `bucket` (11, 15, 16: solo se ejecuta con > 64 unidades y el
  test comprueba la longitud, no los valores promediados), `blockDelta` (34/35/46: la suma de cuadrados de las
  posiciones que faltan; el test mira `relChange` de un solo bloque con formas iguales) y `status`/`relChange` de
  bloques añadidos/quitados (68/70: fijos a 1). **Pendiente**: `evolucion-extra` con valores exactos del `heat`
  promediado y de `relChange` con una fila quitada.
- `evo/children.js` (20 de 98): en curso al cerrar.

## F6

### `evo/duel.js` (30 de 160), `evo/league.js` (30 de 145), `evo/throne.js` (30 de 180) contra `test/trono.spec.mjs`
Cazados **14/30**, **13/30** y **8/30**. Lectura de los supervivientes (fuente en `scratchpad/mutants-f6.log`):
- Equivalentes o inalcanzables: `duel.js` 16 (`% 4` con `−4`: mismo resto en JS para valores positivos), 31
  (`>` → `>=` con victorias distintas), 38/44/53/62–67 (nombres de sala, `learn: false`, salas vivas x1/x10 que el
  test unitario no abre), 90/92/114 (declaraciones); `league.js` 23 (`return base` en un `catch` que no salta), 35/49
  (orden del par: simétrico en el test), 47 (`0.5` sin datos, comprobado solo para pares ausentes), 61 (defaults
  de la mezcla: los tests pasan mezclas completas), 67/72/86/87 (bucle del sorteo: el test tolera ± 2 %), 82/83
  (`hard` por defecto y `1e-9`), 110 (`exists`); `throne.js` 27 (tablas en la liga: el test no las incluye), 34
  (numeración `hof-n`), 98/102 (mensajes de 400), 117/128/129/145/152/159/161/170 (parámetros de la generación:
  el test solo exige que termine y actualice `history`).
- **Huecos reales pendientes** (segunda ronda con `trono-extra.spec`): liga con partidas en tablas; `hof-2` al
  perder dos veces; una generación donde el hijo promocione (semilla que lo fuerce) y donde el entreno cruzado use
  de verdad a la campeona rival (`antagonistId` observable en `config`); `duelScore` con más victorias pero
  `killDiff` negativo (ya cubierto por la tabla 1: revisar por qué 31 sobrevive); salas vivas x1/x10 del duelo
  (solo cubiertas por `api-trono`, que el probador de mutantes no ejecuta).

## F7

### `evo/truth.js` (40) y `evo/exam.js` (20) contra `test/verdad.spec.mjs`
En curso al cerrar la sesión (`scratchpad/mutants-f7.log`). Se documenta en la siguiente sesión junto con la
segunda ronda de F5/F6.


## Arreglos de Opus (2026-09-23, `spec/revision-opus.md`)
Mutantes dirigidos a las líneas cambiadas, con `tools/mutants.mjs` (`generateMutants`/`applyMutant`), cada uno
contra el spec nuevo del arreglo.

### R1 — motor: `server/rooms.js` (líneas 391–396, 430–436, 468–478) contra `test/arreglos-motor.spec.mjs` — cazados 14/24
| línea | cambio | por qué sobrevive |
|---|---|---|
| 396 | `===` → `!==` en la rama `wall` | fuera del arreglo (texto del registro); lo cubre el resto de la batería por comportamiento |
| 434 | `&&` → `\|\|` (×2) en `mover && … && soldier.alive` | equivalentes: los 5 agentes tienen `chooseMove` y, tras el arreglo, el tirador está siempre vivo al llegar aquí |
| 469, 478 | `===`/`!==`, `true`/`false` en `decisionEventId` y en `requested.stay === true` | código anterior al arreglo; el spec del arreglo no usa decisiones. Lo cubren `politica.spec` y `motor.spec` |
| 474 | `slid`/`stayed` del **evento** `move` en la rama del caído | **hueco pequeño**: el test mira `lastMove`, no el evento. Riesgo bajo: el evento copia los mismos valores |
| 476 | `ok: true` → `false` en el retorno de la rama del caído | nadie consulta `ok` de `move()` en proceso; la API lo reenvía tal cual |

### R2 — aprendizaje: `evo/train.js`
- **C4** (identidad de partida; líneas 168–176, 184–188, 207, 392–395) contra `arreglos-partidas` + `aprendizaje` +
  `aprendizaje-extra` + `entrenador-extra`: los mutantes de las líneas nuevas se cazan. Sobreviven 11 de líneas
  anteriores al arreglo:
  - el comparador del `sort` por `eventId` (las entradas ya llegan ordenadas: equivalente);
  - `meanEffective` (salida que nadie usa);
  - `A ?? 0` (la ventaja siempre está definida);
  - la etiqueta `valueSource`;
  - ~~hueco previo real~~ **cerrado** por el caso (4) de `arreglos-metodo-extra` (ver abajo): la referencia `value`
    dentro de `learnFromGames` y las estadísticas de normalización del lote (hoy líneas 233–234 y 245).
- **C3** (`evolutionRound`, `evolve`, paso del entrenador) contra `arreglos-metodo`: **57/209**. El test con
  oráculo exacto fija el orden, las semillas inyectadas, los lados, las parejas antitéticas, los congelados y la
  actualización. Sobreviven sobre todo:
  - las **constantes de semilla** de la spec (`100003`, `7`, `gamesPerCandidate` del paso del entrenador y del
    duelo), porque los tests solo exigen que sea determinista;
  - la magnitud de `perBlock`/`top` del paso;
  - `j % 2` → `% -2` (equivalente con `j ≥ 0`).
- `evo/duel.js` (paso tras el duelo) contra `arreglos-metodo`: **8/14**. Quedaba un superviviente que importa: si la
  rival llevara `learn: true`, la fitness podría medirse sobre la rival. Lo vigila ahora `arreglos-metodo-extra`.
- **`arreglos-metodo-extra`** (2026-09-23, congelado) cierra los huecos de C3 y C4. Fija con oráculo exacto:
  - las semillas, el ruido y el lado de la partida de la red real en el paso del entrenador (leídos de la meta de la
    partida guardada);
  - `perBlock` y `top`, recalculados desde los pesos de antes y de después;
  - que tras un duelo la fitness se mide sobre la red y no sobre la rival;
  - `makeLearner.evolve` con `gamesPerCandidate = 1`, el mínimo que admite el genoma;
  - en `learnFromGames`, la referencia `value` y las estadísticas de normalización que comparten las partidas de un
    lote. Van catorce partidas porque `normalizeStats` no normaliza hasta `n > 20` y los términos son escasos
    (en ese lote `die` llega a 25 y `lose` a 24; con cuatro partidas ningún término pasaba de 7).

  Mutantes dirigidos (líneas de hoy de `evo/train.js`) contra `arreglos-metodo-extra`:
  - 245, `stats: g.reward.stats || (g.reward.stats = {})`: **2/2**. Con `&&`, cada partida estrenaba estadísticas y
    ninguna llegaba a normalizar.
  - `blockChanges` (192–203, 220–222): todo cazado salvo `>` → `>=` en 201 y 221. **Equivalentes**: solo difieren con
    un empate exacto en el máximo (nada cambió) o con un `relChange` exactamente igual al umbral de la lección.
  - 233–234, `||` → `&&` en `value === null || value === undefined`: **equivalentes**. Con cabeza de valor todas las
    decisiones llevan número; sin ella, el baseline pasa a `mean` y los valores no se usan.
  - 409, los valores por defecto `seed = 0` y `soldiers = 1` de `evolve`: **equivalentes**, todos los llamadores los
    pasan.
  - 411 y 639, `Math.max(1, gamesPerCandidate || 1)`: `max(1 → 2)` cazado; el resto, **equivalentes**, porque el
    genoma valida `gamesPerCandidate ∈ [1, 16]`.
  - Paso del entrenador (636–650) contra `arreglos-metodo-extra` + `arreglos-metodo`: **30/38**. Sobreviven 639 ×5
    (lo de arriba), 647 `% 2` → `% -2` ×2 (**equivalente**: en JS el signo del resto sigue al dividendo y `e ≥ 0`) y
    649 `sample: true` → `false` (**equivalente**: con `intoBatch: false` nadie lee ese campo; `saveSample` se llama
    aparte).
  - La constante de semilla 100003 y el `7·(e+1)` de 643: cazados. `evo/duel.js` 159 (la rival con `learn: false`):
    cazado.

### R3–R5 — trono, bofetada, exhibiciones, voz, boletín y rutas (2026-09-23)
Con `tools/mutants.mjs --lines … [--server]`, en las líneas de cada arreglo (sacadas con `git blame`). Dos pasos:
1. contra el spec de su arreglo (columna "spec del arreglo");
2. los supervivientes, contra el spec del arreglo + los dos specs nuevos que cierran sus huecos
   (`arreglos-ocupada-extra-b`, `arreglos-voz-extra`), sobre una copia exacta del estado sin la parte 3; se tiran
   **todos** los mutantes de las líneas con supervivientes (también los que la muestra no cogió).

Hubo una pasada intermedia contra "todas las suites que tocan el módulo" en un mismo servidor, y **se descartó**:
sin mutante, `api-trono` falla si corre después de `arreglos-trono`, y `api-evolucion` después de la serie de `store`,
así que sus "cazados" eran falsos. De ahí la línea base de `tools/mutants.mjs` (parte 3, spec/00 §4): ya no tira
nada si los tests fallan sin mutante. Los órdenes de los pasos 1 y 2 se comprobaron sin mutante antes de tirar.

| arreglo | fichero (líneas) | spec del arreglo | con los specs nuevos |
|---|---|---|---|
| C5/C6 trono (`bb8d39b`) | `evo/throne.js` 60–71, 79–87, 111–127, 159–161 | 21/36 | **34/36** |
| | `evo/api.js` 9–10, 85, 114, 119, 126, 513, 523, 618–627 | 23/45 | **39/45** |
| A1 bofetada (`0bab49e`) | `evo/train.js` 312–356, 545, 548, 642 (muestra de 40 de 61, semilla 23) | 23/40 | líneas con supervivientes: **38/45** |
| | `evo/api.js` 792, 821–823, 834–846 | 27/36 | **31/36** |
| A2 exhibiciones (`aea1299`) | `evo/api.js` 191–251 (13) | 6/13 | **12/13** |
| A3 voz (`226addd`) | `evo/voice.js` 1–175 | 30/115 | **114/115** |
| | `server/rooms.js` 617–682 | 14/129 | **116/129** |
| A4 boletín (`4aab4a1`) | `evo/exam.js` 7–16, 83–103 | 25/34 | **34/34** |
| A5 rutas (`acbe00a`) | `evo/api.js` 347–374, 383, 435–441, 759–790 (muestra de 40 de 179, semilla 23) | 22/40 | líneas con supervivientes: **103/106** |
| | `evo/store.js` 96–121, 132, 216–239 | 10/31 | **27/31** |

Qué cerró cada test nuevo (todos en `arreglos-ocupada-extra-b` salvo la voz):
- trono: reinado nuevo a cero con la reina borrada del disco; duelo parado con partidas que decide; motivo de un
  reto anulado; `vacateNet` de una campeona (y de una red que no es nada); `runGeneration` sin campeona (400 con la casa).
- bofetada: `feedbackTarget` sin trayectoria (5 formas); oráculo del paso en una decisión que no es la primera;
  red toda congelada; el recuerdo que deja (rival, bioma, familia, emoción, intensidad, hace 0 partidas); decisión
  recortada; `GET /feedback` 200; registro `applied` true/false; respuesta en cola `ok:true`.
- exhibiciones: oráculo de pesos del paso de evolución contra una persona, una red sentada y un agente (2 partidas por
  copia, para que la copia juegue también a la derecha); meta guardada (lados, ganador); sin red con netId no se guarda.
- boletín: oráculo de las 16 partidas de adaptación; avisos escena a escena; `adaptationScore({}) = 0`.
- rutas: catálogo de parámetros de mutación; `/games` con `limit` (1, −5, 50 por defecto) y filtros `kind`/`duelId`;
  `whatif`: sin escena, sin soldados, 32/33 soldados, 64/65 obstáculos, obstáculos finos o planos, dueño por equipo
  (con la tortuga, que cuenta los suyos), `turns` 0 y semilla 1 por defecto; examen como trabajo con progreso.
- almacén: `listGames` con la meta de al lado aunque la partida esté rota y sin ella (partidas antiguas); curvas
  recortadas a 5000 al pasar de 6000; sin curvas, `[]`.
- voz (`arreglos-voz-extra`): lista exacta de frases candidatas de cada momento según nivel y hechos; en la sala,
  `eventsFor`, `sayVerified`, el sorteo con `makeRng(hash32(semilla, clave))`, el presupuesto, la presentación con
  recuerdo y 36 disparos con probabilidad 0.5 para fijar las claves de réplica y muerte.

**Supervivientes que quedan: todos equivalentes** (salvo los dos marcados):
| fichero:línea | mutante | por qué es equivalente |
|---|---|---|
| `throne.js:64`, `:117` | `old && !old.to` → `\|\|` (y `reign`) | la reina siempre tiene su reinado abierto como último: con reina, `old`/`reign` existe y `to` es null |
| `api.js:114` ×4 | `progress` inicial `{done: 0, total: 96}` → otras constantes | **no se puede ver desde fuera de forma fiable**: el primer aviso llega a las 10 escenas (unos ms en `GW_FAST`); el sondeo ya ve 20/96. Anotado como hueco sin test |
| `api.js:119` | `done % 10` → `% -10` | en JS el signo del resto sigue al dividendo: igual |
| `api.js:625` | `ok && (…)` → `ok \|\| (…)` | `ok` siempre es true aquí (la red existía); `vacateNet` de una red que no es reina ni campeona no hace nada |
| `train.js:320` | `-1` → `-2` | sigue siendo `< 0` |
| `train.js:336` | `index + 1` → `+ 2` | el paso extra tiene ventaja 0, sin entropía ni valor: gradiente exactamente cero, y la BPTT es causal |
| `train.js:340` | `: 0` → `: 1` | `top` solo es null sin bloques con pesos; con todo congelado `top` existe (relChange 0) |
| `train.js:345`, `api.js:842` ×5 | el error de `feedbackFromGame` | la ruta ya validó con `feedbackTarget` (mismos datos, determinista) y la cola solo guarda lo validado |
| `train.js:349` ×2, `:353` | `start && start.data…` → `\|\|` | `game.start` siempre lleva `data.players` y `data.map` |
| `api.js:198`, `:524` | `&&` → `\|\|` | las redes sentadas llevan genoma y los agentes no; si la reina es la campeona, su ocupación ya la miró la primera comprobación |
| `api.js:214` | `room.result && …` → `\|\|` | `onExhibitionOver` solo se llama al acabar la partida, con `result` |
| `api.js:438` | `min(500, …)` → `501` | **hueco sin test**: haría falta tener más de 500 partidas guardadas |
| `api.js:779` ×2 | el primer `alive:` del objeto | lo pisa el `alive:` final del mismo objeto: código muerto |
| `store.js:114` ×2 | `\|\|` → `&&` en el filtro de ficheros | los `.nets.json` y `.meta.json` no tienen `meta` dentro: se saltan igual |
| `store.js:220`, `:222` | vacío/`recursive` | `appendCurve` solo se llama con puntos; la carpeta de la red ya existe |
| `voice.js:16` | `\|\|` → `&&` | la elegida se busca con `c.i === d.chosen` (índices enteros): una elegida no entera ya da null |
| `rooms.js:635` ×2, `:652` | `\|\|` → `&&` en las guardas | toda red lleva genoma y ningún agente; siempre llega un jugador |
| `rooms.js:636`, `:639`, `:643`, `:646` (×8) | lo que devuelve `voiceTry` | nadie usa su valor; `rng() >= p` → `>` solo difiere con probabilidad cero |
| `rooms.js:655` | `margin: 1` → `2` | la certeza se recorta a 1 |
| `rooms.js:677` | `!kill && !ff` → `\|\|` | la réplica ya calla ante un disparo que mata o se suicida |

Los huecos sin test que quedan (`api.js:114` ×4 y `:438` `500 → 501`) son de bajo riesgo y están explicados arriba.

## Revisión de Fable (2026-09-23): arreglo de R1, R2 y R4 (`e0d87f4`)
Mutantes solo en las líneas del arreglo, con `generateMutants`/`applyMutant` de `tools/mutants.mjs`. Para `evo/api.js`
se levanta el servidor **mutado** de la copia (de ahí sale `--server` en `tools/mutants.mjs`).

| fichero (líneas) | contra | cazados |
|---|---|---|
| `evo/busy.js` (todas) | `arreglos-ocupada` + `arreglos-ocupada-extra` | 12/12 |
| `evo/train.js` `playHeadless` (176–184) | `arreglos-ocupada` | 2/2 |
| `evo/train.js` `settleFeedback` (370–378) | `arreglos-ocupada-extra` | 1/1 (sin los valores de retorno que nadie leía) |
| `evo/duel.js` `runDuel` (100–114) | `arreglos-trono` + `arreglos-ocupada` + `arreglos-ocupada-extra` | 2/2 |
| `evo/api.js` (las 77 de `git diff -U0 0623c22 -- evo/api.js`) | `arreglos-ocupada` con servidor mutado | **33/77** |

Cuatro se cazan por tiempo (`return` → `return null` en las líneas 460, 480, 557 y 617): la ruta no responde y el
test se queda esperando. Cuentan como cazados porque un cliente también se quedaría colgado.

Supervivientes de `evo/api.js`:
| línea | mutantes | qué hace esa línea | veredicto |
|---|---|---|---|
| 67 | 2 × `\|\|` → `&&` | el nombre en el 409 (`who`, si no el nombre en disco, si no el id) | **test que falta**: que el 409 nombre a la red por su nombre (`Nova está en el duelo d…`), no por su id |
| 73 | `return` → `null` | la reina **entrenando** en un reto | **test que falta**: reto con la reina entrenando → 409 |
| 197 | `false` → `true` | `learn:false` de la rival `self` (R4) | **test que falta**: oráculo del paso de una exhibición contra una persona, como el del duelo en `arreglos-metodo-extra`. Con `learn:true`, en las partidas en que la copia juega a la derecha la fitness se mediría sobre la rival |
| 198 | 8 | la rival de la exhibición: una red sentada con `addagent` (su genoma, `learn:false`, id = su netId) o un agente (nivel 2 si no lo dice, su temperatura) | **test que falta**: exhibición contra una red sentada con `addagent` y contra un agente sin nivel (la rival de las copias y `rival` en la línea `update`) |
| 480 | `&&` → `\|\|` | la reina en un reto | **equivalente**: sin reina, `busyText(null)` da `null`; y si la retadora es la reina, su ocupación ya se miró antes en esta misma línea y su entreno, en la anterior |
| 515 | 4 | criar una generación con una campeona ocupada | **test que falta**: 409 si la campeona A o la B están en un duelo |
| 524 | 7 | reto de dinastía con la campeona o la reina ocupadas | **test que falta** |
| 666 | 4 | pedir hijos de una red ocupada | **test que falta** |
| 677, 691, 716 | 12 | operar (las tres rutas de cirugía) una red ocupada | **test que falta** |
| 752 | 4 | examinar una red ocupada | **test que falta** |

En resumen hay 1 equivalente y 43 huecos. El 409 de una red ocupada está probado al editar, borrar, entrenar, empezar
un duelo y retar con la reina en un duelo. Faltan tests para pedir hijos, operar, examinar, criar, el reto de
dinastía, la reina entrenando y el nombre en el mensaje. También falta la rival de las copias en una exhibición
contra una persona o contra una red bot.

**Cerrados con `arreglos-ocupada-extra-b` (2026-09-23)**, tirando todos los mutantes de esas líneas contra el spec
nuevo, sobre una copia exacta sin la parte 3: **41/48**.
| líneas | cazados | los que quedan |
|---|---|---|
| 67, 73 (nombre en el 409, reina entrenando) | 4/4 | — |
| 197 (rival `self` con `learn:false`) | 2/2 | — (hizo falta comparar también `meanFitness`/`bestFitness`: con dos copias y `rankNormalize` solo cuenta su orden, y el orden salía igual) |
| 198 (rival: red sentada o agente) | 4/10 | `&& → ||` y `level || 2` ×3: **equivalentes** (las redes sentadas llevan genoma y los agentes no; la sala recorta el nivel a 1–3, nunca llega 0). `temperature || 0` → `&&` y `|| 1`: **test que falta** — la temperatura sí cambia los tiros de `greedy`/`sniper`, pero con estas semillas no altera ninguna partida de las copias; haría falta una escena en la que la rival dispare antes con incertidumbre |
| 515, 524 (criar, reto de dinastía) | 11/12 | 524 `&& → ||`: **equivalente** (si la reina es la campeona, su ocupación ya la miró la primera comprobación) |
| 666, 677, 691, 716, 752 (pedir hijos, operar ×3, examinar) | 20/20 | — |

## Parte 3 (2026-09-23): hallazgos medios y bajos de la revisión
Con `tools/mutants.mjs --lines` (las líneas de `git diff -U0 HEAD` del código de la parte 3, que aún no estaba
commiteado) y, en cada fichero, **el spec nuevo que lo prueba**. Los ficheros con servidor usan `--server`
(servidor de la copia ya mutado). `evo/api.js` se partió por tramos según el spec que cubre cada línea.
Los "cazados por tiempo" son rutas que dejan de responder o bucles que no acaban: un cliente también se quedaría
colgado, así que cuentan.

**Primera pasada** (spec nuevo de cada fichero):
| fichero | líneas | contra | cazados |
|---|---|---|---|
| `agents/net.js` | 6, 53–54 | `arreglos-verdad` | 0/1 |
| `evo/duel.js` | 54, 67, 74, 118, 124, 133 | `arreglos-verdad`, `-almacen`, `-liga` | 2/8 |
| `evo/store.js` | 2–224 (las del diff) | `arreglos-almacen` | 35/76 |
| `evo/throne.js` | 40–226 (las del diff) | `arreglos-verdad`, `-almacen`, `-liga` | 7/33 |
| `evo/train.js` | 4, 12, 463–467, 514–518, 549, 604, 656, 682–688 | `arreglos-almacen` | 6/37 (1 por tiempo) |
| `evo/truth.js` | 106–110, 238–256, 273, 311–336 | `arreglos-verdad` | 49/58 |
| `server/rooms.js` | 31, 72, 113–115, 122, 216–217 | `arreglos-sala` | 24/27 |
| `server/server.js` | 25, 33–53, 74, 105 | `arreglos-sala` | 17/24 (4 por tiempo) |
| `shared/genome.js` | 53, 283–286, 457 | `arreglos-liga` + `genoma` | 6/6 (1 por tiempo) |
| `tools/mutants.mjs` | 225–238, 277–284 | `tools-base` | 34/37 |
| `evo/api.js` (sala) | 290–305, 543, 587 | `arreglos-sala` | 28/37 (2 por tiempo) |
| `evo/api.js` (verdad) | 91–117, 146–164, 184–185, 492, 657, 824, 830 | `arreglos-verdad` | 31/53 (2 por tiempo) |
| `evo/api.js` (almacén) | 6–137, 193–201, 235, 280, 477, 495, 572–595 | `arreglos-almacen` + `moviola-antigua` | 73/103 (6 por tiempo) |
| `evo/api.js` (pesos) | 732–738 | `arreglos-liga` | 6/11 (1 por tiempo) |
| `evo/api.js` (liga) | 97–98 | `arreglos-almacen`, `-liga` | 4/5 |

Muchos supervivientes eran **partes antiguas de líneas tocadas**: la parte 3 añadió un campo o un argumento a
una línea que ya existía, como `saveGameKept(…, {genomes})` o la línea de `rec` del duelo. Y había **huecos
reales**, cerrados con tres tests nuevos:
- `arreglos-parte3-extra` (en proceso, segundos):
  - almacén: orden con empates, compactación del índice en el límite exacto, reconstrucción con partidas
    antiguas en `.json` sin meta, siguiente id tras los guardados;
  - verdad: certeza con 2 candidatos, `m` de las neuronas solo con disparos que tienen observación, frases con
    el nombre al borrar;
  - un **fallo real de M5**: el fin de una generación salía "Casa B: generation" (arreglado:
    "<casa> gana la generación y ya lleva <n>" / "Generación sin ganadora: las casas empatan", spec/07 §12.8).
- `arreglos-parte3-extra-api` (servidor propio, unos 45 s):
  - M10: cuerpos de exactamente 100 000 / 100 001 bytes y corte a más de 4×;
  - B2: soldados 5 y `null`, y una generación sin objeto `training`;
  - M9: ids reales de los trabajos de cría de una generación, progreso final de cría y examen, 200/404
    exactos, ids que siguen tras reiniciar y el entreno guardado con su vista completa;
  - B1: pesos con un cuerpo que no es objeto y NaN en la posición 0;
  - M2: copias de la red con varios hilos;
  - M4: diario sin retos ajenos;
  - M6: tope de 500 disparos al nombrar neuronas (con oráculo del recorrido);
  - M5: nombres al borrar la reina o la campeona, y en la cría y el relevo.
  El test reintenta **una vez** un GET cortado con ECONNRESET: es una carrera del keep-alive tras una petición
  larga, sin ningún error en el servidor (se repitió 5 veces con su salida de error capturada).
- `arreglos-parte3-extra-b` (en proceso), de la segunda pasada:
  - compactación con 2 partidas vivas;
  - partidas sin `ts` frente a `ts` 1;
  - el tope de eventos no salta antes de tiempo, y la voz es solo `say` y el error "frase no verificable";
  - frases de reinado y de duelo de campeonas con el nombre.

**Segunda pasada**: todos los mutantes de las líneas que tenían supervivientes, contra spec + test extra; las
expresiones antiguas, contra la suite antigua que las cubre.
| qué se volvió a tirar | contra | cazados | lo que queda |
|---|---|---|---|
| `store.js`: todas las mutaciones de las líneas con supervivientes (48) | `arreglos-parte3-extra` (+ `-extra-b` en 130 y 137) | 32/48 | 16 equivalentes (tabla de abajo) |
| `truth.js`: 109, 244, 255–256, 320, 338 y el caso nuevo de `generation` (26) | `-extra` + `arreglos-verdad` (+ `-extra-b` en 320 y 338) | 23/26 | 3 equivalentes |
| `rooms.js` 72, 114 (7) | `verdad.spec` (+ `-extra-b` en 114: 6/6) | 6/7 | 72, equivalente |
| `duel.js` 54, 118 (7) | `trono.spec` | 0/7 | 7 equivalentes (`duelScore` recalcula; `makePlay` recibe todo) |
| **Pasada dirigida**: los supervivientes de api (sala, verdad, pesos), `train` 467/688, `throne` 127/199/208 y `server` 34–48 (42) | `arreglos-parte3-extra-api` | 27/42 | equivalentes; más `api.js` 34/185/495/595/657, que se cierran con `-extra-api-b` (5/8; los 3 restantes, equivalentes) |
| Pasada dirigida: los supervivientes de api (almacén) (24) | `arreglos-parte3-extra-api` | 20/24 | los de 34/495/595, arriba |

La segunda pasada "de líneas enteras" contra el test por la API tardaba unos 3,5 min por mutante: repetía también
los que ya se cazaron en la primera. Se paró y se cambió por la **pasada dirigida**, un arnés de un solo uso en el
scratchpad que usa `generateMutants`/`applyMutant` de `tools/mutants.mjs`. Tira solo los supervivientes de la
primera, por su id, que es estable porque los ficheros no cambiaron entre pasadas. Los huecos que quedan de la
parte 3 son los marcados abajo como **hueco sin test**.

**Huecos antiguos que destapó esta ronda (no son de la parte 3; F4 y F6 de Fable, sin tocar)**. Son partes de
líneas donde la parte 3 solo añadió algo. Tirados contra las suites antiguas en proceso (`aprendizaje`,
`entrenador-extra`, `entrenador-extra-b`, `arreglos-metodo-extra`, `trono`): 7/35.
| fichero:línea | qué no se prueba | fase |
|---|---|---|
| `train.js:604` | que se guarde de muestra 1 de cada 20 partidas (`k % 20`), la semilla `cfg.seed + k` de cada partida y `rivalId` | F4 (quizá lo cubra `api-trainings`, con servidor; no se tiró) |
| `train.js:656` | que la partida de exhibición del paso de evolución se guarde como muestra | F4/A2 |
| `throne.js:41` | `reignGames = defensas + perdidos` de la copia de la sala de la fama | F6 |
| `throne.js:204`, `215` | las semillas de los duelos de la generación (`seed + 2000·casa`, `seed + 3000`) | F6 |
Se anotan para una sesión de Fable o para cuando se toque ese código.

**Equivalentes que quedan** (justificados):
| fichero:línea | mutante | por qué |
|---|---|---|
| `store.js:147–148` | filtros `.nets.json`/`.meta.json` y el corte del id | solo eligen el camino rápido (meta al lado) o el lento (leer la partida); el resultado es el mismo y los ficheros que no son partidas no tienen `meta` |
| `store.js:179`, `205`, `208` | `recursive`, guardas y valores de retorno de `saveRecord` | la carpeta de datos ya existe; los ids siempre son válidos (`d…`, `t7`, `j12`); nadie lee el valor devuelto |
| `truth.js:244` | `samples \|\| []` → `&&` | quien llama siempre pasa una lista |
| `truth.js:320`, `338` | `e.tie \|\| !e.winner`; el segundo `\|\|` de `name \|\| queen \|\| netId` | empate ⇔ sin ganadora; en `reign.start`, `queen` es el propio `netId` |
| `rooms.js:72` | `voiceEvents = 0` → 1 en el constructor | `start()` lo pone a cero antes del primer evento |
| `duel.js:54` | valores por defecto de `makePlay` | quien la llama los pasa todos |
| `duel.js:118` | `wins`, `killDiff`, `ms`, `tie` iniciales | `duelScore` los recalcula tras cada partida; solo se verían antes de la primera |
| `throne.js:204`, `215` | `league: false` y semillas de los duelos de la generación | `runDuel` no lee `league` (la liga la apunta la propia generación); las semillas son de F6, anteriores a la parte 3 |
| `train.js:465` | orden de `genomesOf` cuando las dos redes comparten id | dentro de un lote, la copia "ella misma" es idéntica a la que aprende (se renueva en cada sueño) |
| `train.js:604`, `656`, `549` | `k % 20`, `sample: true`, `seed + k`, `left/right` de la meta | partes antiguas (F4/A2) de líneas donde la parte 3 solo añadió `genomes` |
| `api.js:34`, `102`, `110`, `122` (progreso inicial) | `{done: 0, total: …}` al crear el trabajo | no se ve de forma fiable desde fuera (el primer aviso llega en ms); el final sí se prueba |
| `api.js:292–297` | límites de `readText` (48 MB en `/api/lab`) | **hueco sin test**: probar 48 MB exactos o 192 MB para el corte pesa demasiado para la batería; la misma lógica en `server.js` (100 kB) sí está probada al byte |
| `api.js:98` | el `.catch` de un duelo que falla | **hueco sin test**: un duelo que lanza no se puede provocar desde fuera sin romper el motor |
| `api.js:235` | partes antiguas de la línea de la exhibición | A2, probadas por `arreglos-exhibicion` |
| `api.js:150`, `162` | `used = 0 → 1`, `>= → >` al nombrar neuronas | **hueco sin test**: el corte exacto en 500 (se prueba el recorrido y que corte, no el límite al byte) |
| `api.js:157`, `158` | `st && st.obs`, `phase === 'shoot'` en el recuento | con partidas reales cada paso lleva `obs` y cada disparo va seguido de su movimiento: contar uno u otro por soldado da el mismo corte |
| `api.js:657` | `ok && …` → `\|\|` | al borrar una red que existe, `ok` siempre es verdadero |
| `api.js:738` | `badIdx >= 0` → `> 0` | `validate` rechaza después el mismo valor con el mismo código, mensaje y ejemplo |
| `throne.js:208` | `nameOf(best.id) \|\| best.name \|\| null` | es el mismo nombre por los dos caminos |
| `server.js:40` | `done = true` → `false` | `finish()` puede correr dos veces: resolver una promesa ya resuelta no hace nada |
| `net.js:54` | `games: g.stats ? … : 0` → 1 | toda red guardada tiene `stats` (normalize) |
| `tools/mutants.mjs:232–233` | `r.error \|\| r.signal`, el recorte del mensaje | un tiempo agotado trae los dos; el recorte solo cambia cuánto texto se enseña |

## Parte 4 (2026-09-23): interfaz, lógica pura de cada vista
Cada vista tiene su lógica sin DOM en un módulo con test `ui-*` escrito antes y congelado; los mutantes se tiran
contra ese test (y el `-extra` del editor).
| módulo | contra | cazados |
|---|---|---|
| `public/js/lab/model.js` (editor) | `ui-editor` + `ui-editor-extra` | 165/240 (antes del extra: 130/240) |
| `public/js/lab/emblem.js` | `ui-editor` | 13/141 |
| `public/js/lab/home.js` | `ui-inicio` | 70/93 |
| `public/js/live.js` (sala viva) | `ui-sala` | 50/65 |
| `public/js/lab/training.js` | `ui-entreno` | 119/181 |
| `public/js/lab/evolution.js` | `ui-evolucion` | 89/105 |
| `public/js/lab/duels.js` | `ui-trono` | 61/86 |
| `public/js/lab/dynasty.js` | `ui-dinastias` | 57/80 |
| `public/js/lab/truthview.js` | `ui-verdad` | 72/87 |
| `public/js/lab/surgery.js` | `ui-cirugia` | 81/99 |
| `public/js/lab/whatif.js` | `ui-arranque` | 40/120 |

Por qué sobreviven (por tipo, no uno a uno):
- **Tamaños y dibujo**: constantes de píxeles de la colocación (`COL_W`, `ROW_H`, `NODE`), el sello del emblema
  (ninguna spec fija su dibujo: los tests fijan que sea determinista, distinto por semilla y sin NaN), las marcas
  de los ejes (se prueban sus propiedades, no cada constante interna) y las coordenadas y textos de las escenas
  de "¿qué pasaría si…?" (se prueba que sean válidas para el servidor).
- **Orden cosmético**: el orden de filas dentro de una columna del editor (las plantillas ya listan los ojos por
  corriente) y los desempates de ordenaciones.
- **Límites de los formularios** (soldados 1–4, hilos 1–32, semilla < 2³¹, partidas 0–20): la validación que
  manda es la del servidor, probada en sus specs; la del formulario solo adelanta el mensaje en español.
- **Valores por defecto** que la API siempre rellena (`stats`, `generation`, `updatedAt`) y guardas defensivas.
Huecos menores anotados: `home.reignOf` con el reinado abierto en la posición 0, y que la opacidad de las curvas
imaginadas crezca estrictamente con la probabilidad (el test pide que no baje).

### M12 — `public/js/lab/training.js` `threadNote` (líneas 53–63) contra `ui-entreno-hilos` (+ `-b`) y `ui-entreno` — cazados 13/15
Primera pasada 11/15. Dos huecos reales se cerraron con `test/ui-entreno-hilos-b.spec.mjs` (escrito después del código,
como los demás tests "extra" que salen de los mutantes): el lote de 1 partida (`Math.max(1, …)` → `Math.max(2, …)`) y
el texto propio de "los dos" (`method === 'both'` → `!==`). Sobreviven `Math.max(1, …)` → `Math.max(0, …)` y
`Math.max(-1, …)`, que son **equivalentes**: solo cambiarían algo con un lote de 0 o negativo, y el genoma válido lo
limita a 1–64 (`shared/genome.js`); un 0 o un vacío ya cae en el 4 por defecto.

## Auditoría P0 (2026-09-23): revisión de los "equivalentes" y mutantes del código nuevo
Informe completo en `spec/auditoria-p0.md`. Los mutantes de la parte 4 se volvieron a tirar enteros y se revisaron uno
a uno. No eran equivalentes, y ahora los cazan tests nuevos:
| fichero:línea | contra | cazados |
|---|---|---|
| `model.js:95` (`setParam` perdía los demás ajustes) | `ui-editor` + `-extra` + `ui-huecos-p0` | 3/3 |
| `whatif.js:25–50` (certeza con 2, "Ponla a jugar", `compare` nuevo) | `ui-arranque` + `ui-huecos-p0` + `ui-arreglos-p0` | 28/29 (el de la línea 30, `d && …` → `\|\|`, es equivalente: `chosenKey` solo se llama con las dos decisiones válidas) |
| `training.js` entero (límites del formulario, `threadNote` nuevo) | `ui-entreno*` + `ui-huecos-p0` + `ui-arreglos-p0` | 173/221 |
| `training.js:57–85` (`threadNote` nuevo) | `ui-entreno-hilos*` + `ui-arreglos-p0` + `-b` | 34/39 → con el caso "justo en el tope de la evolución", 37/39 |
| `train.js:604` | `auditoria-p0` | 5/8 |

Equivalentes que quedan en `threadNote`: `Math.max(1, …)` → 0/−1 y `Math.max(2, …)` → 0/−2 (el genoma no admite lotes,
ciclos o poblaciones por debajo de esos mínimos; un valor vacío cae en el de `DEFAULT_LEARNING`). En `train.js:604`,
`% 20` → `% -20` (en JS el signo lo pone el dividendo), `rivalId || null` (no lo lee nadie, P0-B8) y
`genomes || null` (lo caza `arreglos-almacen`, M2).

## Auditoría de la sesión 3 (2026-09-24): huecos de la tanda A
Tanda A sobre 281c60b (relevo `spec/relevo-2026-09-24-s3.md`). Se repitió cada fichero **contra todos los tests que lo
usan** (la tanda A usaba menos, y varios "huecos" ya estaban cubiertos) y lo que seguía vivo se cerró con
test/huecos-s3.spec.mjs` (en proceso) y `test/huecos-s3-api.spec.mjs` (con servidor), escritos después del código y
congelados. Cada caso es la spec, no el código.

| fichero:líneas | contra | cazados | lo que queda |
|---|---|---|---|
| `shared/reward.js:46–47` (roce en el radio, aliado a 1,5 u) | `aprendizaje-extra` y los de siempre | 12/12 | nada: el hueco era de la tanda A (sin `aprendizaje-extra`); no hace falta test |
| `agents/lib.js:20–31` | `angulo`, `moves`, `percepcion*`, `politica`, `rooms` + `huecos-s3` | 9/9 | — (ode2 sin ángulo = 0°; `sim` con bocados) |
| `shared/geometry.js:16, 53–57, 83–92` | `geometry`, `moves`, `politica`, `terreno*` + `huecos-s3` | 43/48 | 16 `\|\|`→`&&` ×3: **equivalentes** (la caja es un atajo; con `&&` se llega al `hypot`, mismo resultado). 55–56 (`stay`/`invalid` de `slideMove`), 68 y 74 (la rejilla): **los cubre la fase "moverse solo donde se puede"**, que reescribe `slideMove` (decisión del usuario del 2026-09-24, plan2) |
| `shared/percept.js` (211–362, líneas del relevo) | `angulo`, `normalize`, `percepcion*`, `politica`, `terreno*` + `huecos-s3` | 218/226 | **equivalentes**: 221 `0→1` (el primer punto va repetido), 224 y 258 `<`→`<=` (empates), 259 (`los` de un destino sin enemigos: con la partida en curso siempre hay enemigos), 362 `30→31` (tope: `min(1, 3,1) = min(1, 3)`). 263 `slid ? 1 : 0` ×3: **fase de movimiento** (la entrada pasa a "imposible") |
| `server/mapgen.js` entero | `terreno*` + `huecos-s3` (rng trucado) | 206/209 | 11 ×3: **equivalentes** (`cos` es par: `2π·v` → `−2π·v`; el tope `1e-12` solo cuenta si el rng da exactamente 0) |
| `server/rooms.js:224, 324, 391–392, 403, 405, 436, 438` | `rooms`, `moves`, `angulo`, `terreno*`, `politica`, `normalize` + `huecos-s3` | 33/33 | — (`moveOptionsFor` no lo cazaba `moves.spec`: ahora sí) |
| `evo/api.js:465` (cuerpo cortado) | `cuerpos` + `huecos-s3-api` | `ok: false → true` cazado (la ruta de hijas arrancaría un trabajo con `{}`) | `return null` y los códigos: **equivalentes** (nadie lee la respuesta de una conexión cerrada) |
| `server/server.js:124–127` (rutas de sala) | `cuerpos` + `huecos-s3-api` | 6/6 | — (405 y cuerpo cortado en `join`) |

`huecos-s3` corre sin modo rápido (`GW_FAST=0`): con él la partida acaba a los 40 tiros y el tope de 40 del registro de
tiros no se puede pasar.

## P2 — mundos (2026-09-24)
Primera tanda solo con `test/mundos.spec.mjs` (congelado antes del código); lo que sobrevivió lo cubre
`test/mundos-b.spec.mjs` (escrito después, congelado) y se repitió cada línea con los dos.

| fichero:líneas | contra | cazados | lo que queda |
|---|---|---|---|
| `server/worlds.js` entero | `mundos` | 148/191 | — |
| `server/worlds.js` (las 21 líneas con supervivientes) | `mundos` + `mundos-b` | 79/80 (41 y 56, con dos casos más de `mundos-b`: 10/10) | 81 `recursive: true → false` al crear el archivo: **equivalente** (solo se crea si hay algo suelto en `<base>`, así que `<base>` existe y el archivo cuelga de él) |
| `evo/api.js:69–82` (`labBusyReason`, `resetLab`) | `mundos` → + `mundos-b` | 2/10 → 10/10 | — (duelo, trabajo, red ocupada por una exhibición y entreno parado que aún guarda) |
| `evo/busy.js:18–22` (`anyHeld`) | `mundos` → + `mundos-b` | 0/2 → 2/2 | — |
| `evo/store.js:12, 74–82` | `mundos` | 3/3 | — |
| `server/server.js:19, 80–86` | `mundos` → + `mundos-b` | 11/12 → 12/12 | — (cuerpo demasiado grande → 413) |

Lo que no genera mutantes (llamadas sin operadores) lo prueba `mundos-b` igual: el aviso `world` por SSE
(`pushLabEvent`), `lastPlayedAt` que pasa a ahora y lo que no pasa de un mundo a otro (entrenos, duelos). **Hueco
pequeño anotado**: `resetTrainerSeq` (en el mundo nuevo, los ids de entreno siguen detrás de los guardados en él) no
tiene test propio.

## Auditoría s3, tanda B: hilos (2026-09-24)
Líneas que tocó 281c60b ("hilos para todo"), contra `trono` + `hilos` (y `arreglos-almacen` para `store.js`), en serie y
con la máquina tranquila (los tiempos de `hilos` no se falsean).

| fichero:líneas | cazados | lo que queda |
|---|---|---|
| `evo/threads.js` entero | 5/6 | 33 `return → null` en `useThreads`: **equivalente** (nadie usa lo que devuelve) |
| `evo/worker.js` (cambiadas) | 7/8 | 20 `&&`→`\|\|` en el tipo `bulletin`: **equivalente** (el grupo solo manda `play`, `duel`, `pre` y `bulletin`) |
| `evo/duel.js` (cambiadas) | 1/2 | 85 `out.packed \|\| null` → `&&`: **equivalente** en resultado (se vuelve a empaquetar igual; solo cuesta tiempo) |
| `evo/children.js` (cambiadas) | 1/5 | 46, valores por defecto `games = 4`, `seed = 0`: **equivalentes** (los dos que llaman pasan siempre los dos) |
| `evo/exam.js` (cambiadas) | 1/1 | — |
| `evo/store.js` (`packGame`, `saveGame`) | 9/9 | — |
| `evo/train.js:499–501` | 1/8 | 500 (×5, grupo propio o compartido con varios hilos): **equivalentes** (mismo resultado bit a bit). **501 (×2): HUECO REAL** — si el entreno turbo de 1 hilo volviera al hilo principal, `hilos.spec` no lo nota (comprobado a mano): con la semilla 71 sus 4 partidas duran menos de 500 ms (una partida con las redes lentas va de 248 a 1 383 ms según la semilla). Pendiente: un test con partidas largas y la premisa medida en el propio test |
| `server/server.js:15–17` (tamaño del grupo) | 0/10 | **equivalentes** (el tamaño del grupo no cambia resultados; en esta máquina, 24 núcleos, siempre sale 4) |
| `evo/train.js` A1/H5 (repetición; solo contra `receta-extra` y `receta-extra-b`) | 20/36 | **equivalentes en la práctica** (10): desfases de 1 ms del reloj (549, 550, 699 `>=`/`60000→60001`), el intervalo de 50 ms de la pausa (756), el `if` de la pausa (754), el avance por defecto `?? 0` (551, siempre hay duración). **Por comprobar contra todos sus tests** (`receta`, `aprendizaje*`, `entrenador*`), que esta tanda no usó (6): estado inicial de Adam `t`/`mean` (103, 293) y "el examen de después solo se salta si se para" (575 `&&`→`\|\|`) |

## P1b — moverse solo donde se puede (2026-09-24)
Contra `moverse` (congelado antes del código) y los congelados que cambiaron con OK del usuario (`geometry`, `motor`,
`moves`, `percepcion`, `terreno-extra`, `huecos-s3`, `politica`, `arreglos-motor`, `aprendizaje-extra`, `genoma`); lo que
sobrevivió lo cubre `moverse-b` (escrito después, congelado).

| fichero:líneas | cazados | lo que queda |
|---|---|---|
| `shared/geometry.js:40–63` (`moveProblem`, `slideMove`) | 37/38 | 43 `>`→`>=` junto al tope de 2 u + 1e-9: **equivalente** (solo cambia en la igualdad exacta) |
| `agents/lib.js:205–242` (destinos y reglas) | 39/42 | 224 `<`→`<=` (empates de distancia: equivalente, como percept 258); 234 `stayIfCovered` por defecto (equivalente: Sniper y Artillery lo pasan); 236 `a.i − b.i` → `+` (**equivalente**: `sort` es estable y los destinos llegan en orden de índice) |
| `agents/chaos.js:45–49` | 3/4 | 47 `return 'stay'` → `null` sin enemigos: **equivalente** (la sala toma `null` como quedarse) |
| `shared/percept.js:248–265` | 76/78 | 258 (empates) y 259 (`los` sin enemigos): **equivalentes**, como en la tanda A |
| `shared/policy.js:128–142` | 30/32 | 134 recorte del ajuste a ±3 (×2): **hueco anterior a P1b** (hace falta un ajuste de más de 3σ); anotado |
| `server/rooms.js:17–18, 519–541` | 19/22 | 520 y 522 (rama del soldado caído: `stayed` del evento y `ok` devuelto): **huecos anteriores**, ya anotados en R1 (474); 537 `&&`→`\|\|`: equivalente (el último tiro del registro es siempre el del que se mueve) |
| `shared/reward.js:54–55` | 1/1 | — |
| `shared/genome.js:43, 46` | 10/10 | — |

## Sesión 5 (2026-09-24): el hueco `train.js:501` con `hilos-b`
`hilos-b` (congelado): el mismo entreno turbo de 1 hilo (redes lentas, 3 soldados, 8 partidas, semilla 17, lote de 1)
jugado en el hilo principal del propio test lo bloquea más de 1 000 ms (premisa medida: 2,2–2,6 s) y, por la API, el
servidor contesta todas las peticiones (estado y salud) en menos de 500 ms desde la partida 1 (medido: 72–107 ms).

| fichero:líneas | cazados | lo que queda |
|---|---|---|
| `evo/train.js:499–501` | 6/8 | **501 ×2 cazados** (el hueco queda cerrado). 500: `&&`→`\|\|`, `>`→`>=`, `1`→`0`, `1`→`−1` cazados por la premisa (con un grupo propio de 1 hilo el entreno de 1 hilo sin grupo del servidor deja de ir "aquí mismo", como dice la línea 499); `===`→`!==` y `1`→`2` **equivalentes** con 1 hilo (ya lo eran en la tanda B) |

Por qué `hilos.spec` no lo cazaba siempre: solo cronometra `/api/health`; la petición de estado, que no se mide, se come
los bloqueos sueltos. Con el código de P1b las partidas lentas duran más (0,4–3,7 s según la carga) y hoy sí lo cazaría,
pero sin premisa medida. Lo que la medida sin sesgo destapa (no es de la línea 501; pendiente de decisión del usuario): la
**actualización de pesos va en el hilo principal** ("coordina y aprende"): con redes lentas, 0,85 s por lote de 4; con
Vidente normal, 0,15–0,45 s; la primera de un entreno, 0,3–0,8 s (en frío y guardando entera la partida de muestra 0).
