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
