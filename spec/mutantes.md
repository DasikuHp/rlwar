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
(pendiente: la primera tirada no dejó resumen; se repite)
