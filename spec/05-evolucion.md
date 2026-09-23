# 05 — Evolución: mutación, hijos, rasgos, cirugía, import/export (F5)

> Contrato exacto de `evo/mutate.js`. Fuente: plan2.md rondas 2, 5, 7, 9; §4.5; §6.2 (5, 7).

## 1. Configuración de mutación (`mutation`, se pasa al pedir hijos; por defecto la del catálogo)
```json
{ "weights":       { "on": true, "sigma": 0.05, "fraction": 0.3 },
  "addNeurons":    { "on": true, "rate": 0.3, "max": 8 },
  "removeNeurons": { "on": true, "rate": 0.2, "max": 4 },
  "addWire":       { "on": true, "rate": 0.3 },
  "removeWire":    { "on": true, "rate": 0.2 },
  "addBlock":      { "on": true, "rate": 0.2, "types": ["dense", "norm", "skip", "attention", "pool", "echo", "gru", "lstm", "teamMemory", "eye.*"] },
  "removeBlock":   { "on": true, "rate": 0.1 },
  "activation":    { "on": true, "rate": 0.2 },
  "eyeParams":     { "on": true, "rate": 0.2 },
  "imagination":   { "on": true, "rate": 0.3, "sigma": 0.2 },
  "traits":        { "on": true, "sigma": 0.15 },
  "emblem":        { "on": true } }
```
Cada tipo: interruptor `on` e intensidad (`sigma`/`rate`/`max`) ✅. `rate` = probabilidad de que
ese tipo actúe en un hijo; `sigma` = tamaño del ruido; `max` = tope de unidades por operación.

## 2. `mutate(parent, config, rng) → { child, ops }` — siempre válido
Orden fijo de aplicación (estructura primero, pesos al final):
1. `removeBlock` → 2. `addBlock` → 3. `removeWire` → 4. `addWire` → 5. `removeNeurons` →
6. `addNeurons` → 7. `activation` → 8. `eyeParams` → 9. `imagination` → 10. `traits` →
11. `weights` → 12. `emblem`.
- Tras **cada** operación se ejecuta `validate`; si falla, la operación se deshace (se parte de la
  copia anterior) y se anota `ops[].undone = true` con el motivo. Así el hijo es válido **siempre**
  (propiedad testeada con 2 000 cadenas). Bloques `frozen` no se tocan (ni pesos ni estructura).
- Reglas por operación:
  | op | qué hace | pesos nuevos |
  |---|---|---|
  | `addBlock` | inserta un bloque de `types` (elección `rng`) **en un cable existente** (A→B pasa a A→nuevo→B) o como ojo nuevo cableado al primer `dense`/`concat` compatible | Xavier × 0.1 (el hijo se comporta casi como el padre) |
  | `removeBlock` | quita un bloque que no sea Mano/Pie ni el único ojo; sus entradas se reconectan a sus salidas | — |
  | `addWire` | cable nuevo válido entre dos bloques compatibles (sin ciclo, corrientes compatibles) | los pesos de entrada del destino crecen: columnas nuevas a 0 |
  | `removeWire` | quita un cable dejando cada bloque con ≥ 1 entrada y ≥ 1 salida (o lo deshace) | se recortan las columnas correspondientes |
  | `addNeurons` | `units += rng.int(1..max)` en un `dense`/memoria | filas nuevas Xavier × 0.1, columnas salientes 0 |
  | `removeNeurons` | quita las `rng.int(1..max)` unidades con **menor norma de pesos salientes** (mínimo 1 unidad) | — |
  | `activation` | cambia la activación de un `dense` | — |
  | `eyeParams` | cambia un parámetro de un ojo (p. ej. `cell` 2 → 2.5, `rays` 16 → 32) | el `dense` receptor se redimensiona (columnas nuevas a 0 / recorte) |
  | `imagination` | perturba `weight` de cada familia (`× e^(σ·N(0,1))`, recorte 0.1..20), `n ± rng.int(0..4)`, y con prob. 0.3 enciende/apaga una familia (nunca todas apagadas) | — |
  | `traits` | `temperature × e^(σ·N)`, `pulse × e^(σ·N)`, `teamSpirit + σ·N` (recortes de spec/02 §2); `character` cambia con prob. `σ` | — |
  | `weights` | a una fracción `fraction` de los pesos de cada bloque no congelado: `+ σ·N(0,1)·(1+|w|)` | — |
  | `emblem` | `emblem = rng.int(2³¹)` con prob. 0.5, o bit-flip de 4 bits | — |
- `ops[]`: `{op, blockId?, wireId?, before, after, text, undone?}`; `text` en español con **todos los
  números** ("Añadí 3 neuronas a Instinto b3 (32 → 35)", "Bajé la temperatura 1.00 → 0.83"). Test
  "exacto": cada número del `text` está en `before`/`after`.
- `child.lineage = {generation: padre+1, parents:[padre.id], born, mutations: ops}`;
  `child.stats` a cero; `child.memory` vacía (los recuerdos no se heredan; el carácter sí).
- Nombres 🧭: base del padre + generación + letra de hermano: `Hydra-7` → `Hydra-8a`, `Hydra-8b`…;
  `id` = nombre en minúsculas sin acentos. Colisión → sufijo numérico.

## 3. Rasgos heredables (`traits`) ✅
`temperature` (arriesga), `pulse` (ruido del ajuste), `teamSpirit` τ (egoísta ↔ equipo), `character`
(voz). Todos con `explain` y ejemplo en el catálogo. La `imagination` también se hereda y muta.

## 4. Hijos y pre-torneo (`POST /api/lab/nets/:id/children`)
```json
{ "n": 4, "mutation": { ...§1... }, "pretournament": { "games": 4, "opponentId": null, "soldiers": "random" }, "seed": 7 }
```
- Crea `n` hijos (1..16) con `mutate` y semillas `seed+k`; los guarda; pre-torneo **sin pantalla**:
  cada hijo juega `games` partidas contra `opponentId` (por defecto la reina; si no hay, el padre)
  con **las mismas semillas para todos** (justo); orden: victorias, luego diferencia de kills, luego
  kills. Devuelve `{jobId}`; al acabar, evento `children` con
  `[{id, name, wins, killDiff, kills, deaths, opsText:[...]}]` ordenados.
- El usuario elige uno, lo retoca en el editor (`PUT`) y reta (spec/06). Los demás quedan guardados
  (borrables).

## 5. Diferencias padre → hijo (`GET /api/lab/nets/:id/diff/:parentId`)
`{blocks: [{blockId, name, status: same|changed|added|removed, relChange, heat: [..≤64 valores..]}],
wires: {added:[..], removed:[..]}, traits: {before, after}, imagination: {before, after},
text: [ops.text]}`. `heat` = `|Δw|` por fila (o por unidad) reescalado 0..1 para el mapa de calor.

## 6. 🎲 Imaginación que evoluciona ✅
- Por mutación (§2) y por **uso** (Galactic Arms Race): `imagination.usage[f]` cuenta cuántas veces se
  eligió cada familia en las últimas 200 decisiones; con `adaptive:true`, en cada sueño
  `weight_f ← 0.9·weight_f + 0.1·(usage_f/Σusage)·Σweight` (recorte 0.1..20). Se hereda.

## 7. Cirugía ✅ (nivel Científico)
- `PUT /api/lab/nets/:id/frozen {blocks:[...]}` → congelar/descongelar (sin gradiente, sin
  mutación, sin ES).
- `PUT /api/lab/nets/:id/weights/:blockId {W:[...], b:[...], ...}` → pesos a mano; formas validadas
  (`weights-shape`), `NaN` rechazado; 409 si la red está entrenando.
- `POST /api/lab/nets/:id/transplant {fromNetId, blockId, replaceBlockId?}` → copia bloque + pesos;
  si las dimensiones de entrada no coinciden, se reinicializan y se avisa (`warnings`). Queda
  registrado en `lineage.mutations` como `{op:'transplant', from, text}`.

## 8. Exportar / importar ✅
- `GET /api/lab/nets/:id/export` → el genoma JSON tal cual (descarga).
- `POST /api/lab/nets/import` (cuerpo = genoma; hasta 48 MB) → `validate` (spec/02 §6) →
  `{ok:true, id}` o `400 {ok:false, errors:[...]}`. **Nunca 500**, nunca cuelga (límite de tamaño
  antes de parsear). Si el `id` ya existe → 409 salvo `?rename=1` (nuevo id con sufijo).

## 9. Tests de F5 (`test/evolucion.spec.mjs`)
- 2 000 cadenas `mutate` (5 pasos cada una, semillas 1..2000) → siempre `validate.ok`, paramCount
  dentro de límites, `frozen` intacto (pesos idénticos).
- Determinismo: misma semilla → mismo hijo (JSON idéntico).
- Cada op individual sobre un genoma fijo: efecto exacto (unidades 32 → 35, columnas a 0, etc.).
- "Exacto": cada número de `ops[].text` aparece en `before/after`.
- Pre-torneo: mismas semillas para todos los hijos; orden correcto con resultados fijos.
- Import: genoma roto (JSON inválido, 49 MB, ciclo, `NaN`) → 400 con código, servidor vivo después;
  export → import → export idéntico.
- Transplante con dimensiones incompatibles → aviso y pesos reiniciados; compatibles → copiados.

## 10. Precisiones de F5 (fijadas al escribir los tests; completan §2–§8 sin cambiarlos)

### 10.1 Cómo se recolocan los pesos cuando cambia una forma (regla única)
Cada posición de cada vector lleva una **etiqueta**: un ojo etiqueta sus posiciones `ojo:k` (por índice);
un bloque con unidades (`dense`, memorias, `attention`) etiqueta `bloque#u` con `u` la unidad *original*
(si se quitan unidades, las que quedan conservan su etiqueta); `concat`/`skip`/`norm`/`add`/`mul`/`pool`
dejan pasar las etiquetas de sus entradas (en el orden de `wires`; `add`/`mul` las de su primera entrada).
Al recalcular los pesos de un bloque tras cualquier op:
- entrada (fila) y unidad (columna) con la **misma etiqueta que antes → el peso se copia**;
- posición de entrada **nueva** (cable nuevo, bloque insertado, ojo con más números, unidades añadidas
  aguas arriba) → **0**;
- unidad **nueva del propio bloque** (`addNeurons`, bloque nuevo) → Xavier × 0.1 (sesgos 0; `bf` del
  LSTM 1; `g` de `norm` 1);
- lo que desaparece se recorta. Un cambio de parámetro de un ojo casa por índice (`radar:0..15` siguen
  siendo `radar:0..15` con 32 bigotes; los 16 nuevos van a 0).
- Si la op obligara a cambiar la forma de un bloque **congelado**, se deshace (`reason`: "tocaría el
  bloque congelado …"). `attention` no cambia de `heads`/`keyDim` por mutación.

### 10.2 Detalles por op
- **Decisión de actuar**: `on && rng() < rate` (`weights`, `traits`, `emblem` actúan siempre si `on`).
  Cada op consume el `rng` en orden fijo aunque se deshaga (determinismo).
- `addBlock`: con prob. 0.5 inserta en un cable al azar (`types` sin `eye.*`), si no, ojo nuevo (tipo de
  `eye.*` al azar, parámetros por defecto) cableado al **primer** `dense`/`concat` (orden de `blocks`)
  que valide. `dense` insertado: `units = clamp(dim de salida del origen, 4, 64)`, `tanh`; memorias 16;
  `attention` 1 × 16; `pool` media. Id nuevo: último tramo del tipo + número libre (`dense1`, `radar2`).
  Se coloca en `blocks` justo después del bloque origen (o al final si es ojo).
- `removeBlock`: candidato = no Mano/Pie, no congelado, no ojo si es el único de su corriente. A→X→B pasa
  a A→B (todas las combinaciones); cables duplicados se quitan.
- `addWire`: par (origen, destino) al azar entre los no existentes con destino no-ojo y origen no-Mano/Pie;
  hasta 20 intentos hasta que valide; si ninguno, `undone`.
- `removeWire`: cable al azar cuyo origen conserve ≥ 1 salida y cuyo destino conserve ≥ 1 entrada; si no
  hay, `undone`.
- `removeNeurons`: bloque `dense`/memoria no congelado al azar; `k = min(rng.int(1..max), units − 1)`;
  norma saliente de la unidad `u` = √Σ (pesos de fila etiquetada `bloque#u` en todos los consumidores con
  pesos)²; empate → índice mayor primero. `before {units, norms}` `after {units, removed:[u…]}`.
- `addNeurons`: `k = rng.int(1..max)` (respetando `units ≤ 512`); `before {units}`, `after {units, added: k}`.
- `activation`: un `dense` no congelado al azar; nueva activación uniforme entre las otras 6.
- `eyeParams`: ojo con parámetros al azar (`map`, `obstacles`, `history`, `radar`, `simulator`); un
  parámetro al azar: enum → otra opción; int → ± rng.int(1..2) recortado (siempre distinto); bool →
  contrario; set (`channels`) → quita o pone un canal (nunca vacío).
- `imagination`: `n ← clamp(n ± rng.int(0..4), 4..64)`; cada `weight × e^(σ·N)` recortado 0.1..20; con
  prob. 0.3 invierte `on` de una familia al azar (si dejaría todas apagadas, no se invierte).
- `traits`: `temperature`, `pulse` × e^(σ·N) y `teamSpirit + σ·N`, recortados a `TRAIT_RANGES`;
  `character` cambia con prob. σ a otro distinto.
- `weights`: bloques no congelados en orden de `blocks`, claves en orden de `weightShapes`, cada peso con
  prob. `fraction`: `w += σ·N·(1+|w|)`. `before/after {changed, blocks}`.
- `emblem`: `rng() < 0.5` → `rng.int(2³¹)`; si no, XOR de 4 bits al azar (`rng.int(31)` × 4).
- `ops[]`: `{op, blockId?, wire?:"a→b", before, after, text, undone?, reason?}`. Números del `text`:
  enteros tal cual, decimales con 2 cifras; **todos** aparecen (con ese formato) en `before`/`after`.
- **Nombres que no se repiten (auditoría P0, 2026-09-23; decisión del usuario "que no se repita, cambiamos de
  letra")**: con `opts.existingNames` (los nombres de las redes del mundo más los de los hermanos ya creados), la
  letra empieza en la de `opts.sibling` y avanza hasta la primera que dé un nombre libre (sin distinguir mayúsculas).
  Ej.: si ya existen Lince Veloz-2a…2d, una cría nueva de 3 hijas da 2e, 2f y 2g. Quien cría (`POST
  /nets/:id/children`, las generaciones de las dinastías) pasa siempre esos nombres. Sin `existingNames`, como antes.
- Nombre/id del hijo: base = nombre del padre sin su cola `-<generación><letra>`; hijo `${base}-${gen}${letra}`
  (`letra` = `opts.sibling` 0 → a, 1 → b…); `id = slugify(nombre)`; si choca con `opts.existingIds`, sufijo
  `-2`, `-3`… Firma: `mutate(parent, config, rng, opts = {sibling, existingIds, now})`; `now` = fecha ISO de
  `born`. `config` incompleto se completa con §1 (`DEFAULT_MUTATION`). `memory` del hijo = `[]`;
  `names` (nombres de neuronas) se conservan para las unidades que sobreviven.

### 10.3 Diferencias (§5)
`relChange = ‖hijo − padre‖ / (‖padre‖ + 1e-9)` sobre todos los pesos del bloque casados por etiqueta
(posiciones nuevas o quitadas cuentan enteras). `heat`: un valor por unidad (columna) —o por posición de
entrada en Manos/Pies/`norm`— = √Σ Δ², reescalado al máximo (0..1); más de 64 → se promedian tramos
consecutivos hasta 64. `status`: `same` (mismo tipo, parámetros y pesos), `changed`, `added`, `removed`.
`name` = nombre del catálogo + id (`Instinto d`). `text` = textos de `lineage.mutations` del hijo si su
padre es `parentId`; si no, `[]`. Funciona en ambos sentidos (`diff/:parentId` con cualquier otra red).

### 10.4 Hijos, pre-torneo y trabajos (§4)
- `n` 1..16, `pretournament.games` 0..20 (0 = sin pre-torneo), `soldiers` `'random'` | 1..4, `seed` entero
  (por defecto aleatorio). Hijos con `mutate(padre, mutation, makeRng(seed + k), {sibling: k})`, guardados
  **antes** del pre-torneo (aunque falle una partida). Rival: `opponentId` → si no, la reina de
  `throne.json` → si no, el padre.
- Partidas: `games` semillas `seed + 1000 + j`; el hijo juega **izquierda** en `j` par y derecha en `j`
  impar; `soldiers: 'random'` → `1 + makeRng(seed).int(4)`, el mismo para todos. Orden: `wins` ↓, `killDiff` ↓,
  `kills` ↓, nombre ↑. Función pura `rankChildren(rows)` y `runPretournament({children, opponent, games,
  seed, soldiers, play})` (con `play` inyectable para el test).
- Trabajo: `202 {jobId}`; `GET /api/lab/jobs/:id → {id, kind:'children', status: running|done|error,
  progress:{done, total}, result?:{parentId, ranking}, error?}`; SSE `job {id, kind, status, progress}` en cada
  partida y `children {jobId, parentId, ranking}` al acabar. `hello` del SSE lleva `jobs`; `GET /api/lab/jobs` →
  `{jobs:[…]}`. `result` lleva también `opponentId`, `soldiers` y `seed`. Cirugía o hijos de una red que entrena → 409. Una partida por
  vuelta del bucle de eventos (el servidor sigue respondiendo).

### 10.5 Cirugía (§7)
- `PUT /frozen {blocks}` → ids existentes (400 si no) → `{ok, frozen}`.
- `PUT /weights/:blockId {W, b, …}` → solo las claves enviadas; forma exacta (`weights-shape`) y sin
  `NaN`/`Infinity` (`weights-nan`) → `{ok}` / `400 {errors}`; 404 si el bloque no existe; 409 si entrena.
- `POST /transplant {fromNetId, blockId, replaceBlockId?}` → con `replaceBlockId`: ese bloque pasa a tener
  el tipo, parámetros y pesos del donante (conserva id y cables); sin él: bloque nuevo con id `blockId` (o
  con sufijo si existe) **sin cables**. Si las formas de entrada no coinciden → pesos reinicializados con
  `initWeights` (semilla = `emblem` de la receptora) y `warnings: ["…"]`. `lineage.mutations` recibe
  `{op:'transplant', from, blockId, text}`. Respuesta `{ok, blockId, warnings}`.
- Importar: cuerpo > 48 MB → `413` (sin parsear); JSON roto/ciclo/`NaN` → `400 {errors:[{code…}]}`.

### 10.6 🎲 Imaginación por uso (§6)
`imagination.usage[f]` = familia elegida en las **últimas 200 decisiones de disparo** vistas en las
trayectorias que llegan a un sueño (todas las partidas del sueño, en orden; se recalcula en cada sueño).
Con `adaptive: true`, tras contar: `weight_f ← 0.9·weight_f + 0.1·(usage_f/Σusage)·Σweight` (recorte
0.1..20) si `Σusage > 0`. Función pura `adaptImagination(imagination, decisions) → {usage, weights, changed}`.
