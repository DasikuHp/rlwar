# 02 — La red: genoma, catálogo de bloques, cálculo (F2)

> Contrato exacto de `shared/genome.js` y `shared/nn.js`. Fuente: plan2.md rondas 1, 3, 8; §4.3.
> Todo bloque lleva `name`, `explain` (lenguaje natural con ejemplo) y `level` (aprendiz/artesano/
> científico) en el catálogo, para que Opus lo muestre tal cual.

## 1. Idea en una frase
La red es un **grafo de bloques unidos por cables**. Hay tres **corrientes** de datos que fluyen por
los cables: `ctx` (un vector: lo que ve el soldado), `cand` (un vector **por cada candidato de
disparo**, N a la vez) y `move` (un vector por cada uno de los 9 destinos). Los Ojos crean corrientes,
el Instinto y la Memoria las transforman, las Manos y los Pies las convierten en decisiones.

## 2. Genoma (JSON, `formato: 1`)
```json
{
  "format": 1,
  "id": "hydra-7",                      // [a-z0-9-]{3,32}, único en evo/nets/
  "name": "Hydra-7",                    // ≤ 32 caracteres, lo ve la gente
  "emblem": 1234567,                    // semilla del emblema (Opus lo dibuja); se hereda mutado
  "traits": {                           // rasgos heredables (spec/05 §3)
    "temperature": 1.0,                 // 0.05..3: cuánto arriesga al elegir (softmax /T)
    "pulse": 0.1,                       // 0..1: ruido σ del ajuste continuo (unidades normalizadas)
    "teamSpirit": 0.5,                  // 0..1: τ, cuánto pesa la recompensa del equipo frente a la propia
    "character": "frio"                 // frio | chulo | dramatico | desquiciado (voz, spec/07)
  },
  "blocks": [ { "id": "b1", "type": "eye.map", "params": { "cell": 2, "channels": ["obstacles","enemies","allies","self"] } }, ... ],
  "wires":  [ { "from": "b1", "to": "b3" }, ... ],
  "weights": { "b3": { "W": [...], "b": [...] }, ... },   // por bloque con parámetros; claves fijas por tipo (§4)
  "frozen": ["b3"],                     // bloques congelados (cirugía): sin gradiente ni mutación
  "imagination": { ... },               // spec/03 §5
  "reward": { ... },                    // spec/04 §2
  "learning": { ... },                  // spec/04 §1
  "lineage": { "generation": 0, "parents": [], "born": "2026-09-22T10:00:00Z", "mutations": [] },
  "stats": { "games": 0, "wins": 0, "kills": 0, "deaths": 0, "reigns": 0 }
}
```
- `id` inmutable; `name` editable. `emblem` entero.
- `weights` **solo** para bloques con parámetros; formas exactas en §4. Al crear un bloque nuevo o
  cambiar su forma, `nn.initWeights(block, rng)` (Xavier uniforme, semilla) rellena lo que falte.
- Todo lo demás que no esté aquí se **rechaza** (`unknown field`), para que un genoma importado no
  cuele basura.

## 3. Corrientes y reglas de cableado
| Corriente | Forma | Quién la crea |
|---|---|---|
| `ctx` | `[D]` | ojos de contexto (mapa, rasgos, obstáculos, historial, radar, reloj, compañeros), memoria, atención (salida) |
| `cand` | `[N, D]` | `eye.candidates` (obligatorio si hay Manos), `eye.simulator` |
| `move` | `[9, D]` | `eye.moves` (obligatorio si hay Pies) |

Reglas (las comprueba `validate`, con mensajes en español y con ejemplo):
1. Un cable une la salida de un bloque con la entrada de otro. Un bloque puede recibir varios cables:
   sus entradas se **concatenan** en el orden de `wires` (orden estable).
2. Mezclar `ctx` con `cand` en un bloque → el bloque trabaja en `cand`: el vector `ctx` se **copia** a
   cada candidato (difusión). Igual `ctx` + `move` → `move`. `cand` + `move` → **error**
   ("no se pueden juntar candidatos de disparo con destinos de movimiento: usa Atención para resumir
   uno de los dos en contexto").
3. `cand`/`move` → `ctx` solo mediante **Atención** (`attention`) o **Resumen** (`pool`).
4. Memoria (`echo`, `gru`, `lstm`, `teamMemory`) solo en `ctx`.
5. El grafo dentro de un turno es **acíclico**; los únicos "bucles" son el estado de la memoria entre
   turnos. Un ciclo → error con la lista de bloques del ciclo.
6. `hand.choose` recibe `cand`; `hand.adjust` recibe `cand`; `foot.move` recibe `move`; `hand.value`
   recibe `ctx`. Cada Mano/Pie **como máximo una vez** por genoma.
7. Todo bloque debe estar conectado a algún camino ojo → mano/pie; los sueltos se avisan (no error).
8. Dimensiones: cada bloque declara `outDim(params, inDim)`; se propagan en orden topológico.
   Un bloque de entrada que exija dimensión (`dense.units`) la fija; los demás heredan.

## 4. Catálogo de bloques (`BLOCKS` en `shared/genome.js`)
Columnas: tipo · parámetros (con rango y valor por defecto) · pesos (forma) · corriente in → out.

### 👁 Ojos (sin pesos; producen corrientes; detalle de cada vector en spec/03)
| tipo | parámetros | out |
|---|---|---|
| `eye.map` 🗺 | `cell` ∈ {1, 2, 2.5, 5} (u, def 2) · `channels` ⊆ {obstacles, enemies, allies, self, trails} (def los 4 primeros) | `ctx[C·(50/cell)·(30/cell)]` |
| `eye.features` 📊 | — | `ctx[26]` |
| `eye.obstacles` 🧱 | `slots` ∈ 1..8 (def 6) | `ctx[5·slots + 1]` |
| `eye.history` 📜 | `depth` ∈ 1..8 (def 4) | `ctx[2·depth·14]` |
| `eye.radar` 📡 | `rays` ∈ {8, 16, 32} (def 16) | `ctx[2·rays]` |
| `eye.clock` ⏱ | — | `ctx[8]` |
| `eye.mates` 👥 | — | `ctx[12]` |
| `eye.candidates` 🎯 | — (usa `imagination`) | `cand[N, 12]` |
| `eye.simulator` 🔮 | `fine` (bool, def false: barrido grueso) | `cand[N, 10]` |
| `eye.moves` 🦶 | — | `move[9, 9]` |

### 🧠 Instinto
| tipo | parámetros | pesos | in → out |
|---|---|---|---|
| `dense` | `units` ∈ 1..512 (def 32) · `activation` ∈ {relu, tanh, sigmoid, leaky, gelu, sine, linear} (def tanh) | `W[in·units]`, `b[units]` | cualquiera → misma corriente `[units]` |
| `concat` (juntar) | — | — | varias entradas → concatenación (regla 2) |
| `add` (sumar) | — | — | entradas de igual dimensión → suma; distinta → error |
| `mul` (multiplicar) | — | — | igual dimensión → producto elemento a elemento (puertas) |
| `skip` (atajo) | — | — | identidad; existe para dibujar atajos explícitos: `[dense → dense] + skip → add` |
| `norm` | `eps` (def 1e-5) | `g[D]`, `b[D]` | LayerNorm sobre el vector |
| `attention` | `heads` ∈ 1..8 (def 1) · `keyDim` ∈ 4..128 (def 16) | `Wq[Dctx·heads·keyDim]`, `Wk[Dcand·heads·keyDim]`, `Wv[Dcand·heads·keyDim]` | (`ctx` consulta, `cand`/`move` claves) → `ctx[heads·keyDim]` + pesos de atención visibles (`decision.attention`) |
| `pool` (resumen) | `op` ∈ {mean, max} | — | `cand`/`move` → `ctx[D]` |

Disposición de pesos (todas las matrices): `W[i·out + j]` = peso de la entrada `i` a la unidad `j`
(`y_j = b_j + Σ_i x_i·W[i·out + j]`); en memoria las entradas van concatenadas `[x…, h…]`.
Inicialización Xavier uniforme `U(−√(6/(in+out)), +√(6/(in+out)))` con el `rng` recibido; sesgos a 0
(`bf` del LSTM a 1; `g` de `norm` a 1); `q0` de atención Xavier.

Activaciones: `relu(x)=max(0,x)` · `leaky = x>0 ? x : 0.01x` · `gelu = 0.5x(1+tanh(√(2/π)(x+0.044715x³)))`
· `sine = sin(x)` · `sigmoid = 1/(1+e^-x)`. Derivadas exactas de esas fórmulas (el test numérico manda).

Atención: `q = ctx·Wq` (`[heads, keyDim]`), `k_i = cand_i·Wk`, `v_i = cand_i·Wv`,
`a_i = softmax_i(q·k_i / √keyDim)` por cabeza, salida = `Σ a_i v_i` concatenando cabezas. Si no hay
cable `ctx` de entrada, `q` es un vector de pesos aprendido `q0[heads·keyDim]`.

### 🌀 Memoria (solo `ctx`; estado por soldado y por partida; se pone a cero al empezar)
| tipo | parámetros | pesos | estado |
|---|---|---|---|
| `echo` (RNN simple) | `units` (def 16) | `Wx[in·units]`, `Wh[units·units]`, `b[units]` | `h[units]`; `h' = tanh(Wx x + Wh h + b)` |
| `gru` | `units` | `Wz, Wr, Wh` (cada `[(in+units)·units]`), `bz, br, bh` | `h`; fórmula estándar (Cho 2014) |
| `lstm` | `units` | `Wi, Wf, Wo, Wg` (`[(in+units)·units]`), `bi, bf, bo, bg` | `h, c`; `bf` se inicializa a 1 |
| `teamMemory` | `units` | como `echo` | `h` propio; **lee** la media de los `h` de los soldados vivos del mismo jugador (escrito en su último turno); si es el único, lee su propio `h` |

BPTT: el gradiente fluye por el estado propio a lo largo de los turnos del soldado en la partida
(`learning.bpttSteps`, def 8: se corta cada 8 turnos). La **lectura de la memoria de equipo se trata
como constante** (sin gradiente hacia los compañeros) 🧭: estable y suficiente; el escrito sí aprende.

### ✋ Manos y 🦶 Pies (cabezas de decisión)
| tipo | parámetros | pesos | in → out |
|---|---|---|---|
| `hand.choose` 🎯 Elegir | — | `W[in]`, `b[1]` | `cand[N,in]` → puntuación `s[N]`; `p = softmax(s / temperature)` |
| `hand.adjust` ✏ Ajustar | `params` ∈ 1..3 (def 3) | `W[in·params]`, `b[params]` | `cand[N,in]` → `μ[N, params]`; se usa la fila del elegido (spec/03 §6) |
| `foot.move` 🦶 Moverse | `adjust` (bool, def true) | `W[in]`, `b[1]`, y si `adjust`: `Wa[in·2]`, `ba[2]` | `move[9,in]` → `s[9]` (+ `μ[9,2]`) |
| `hand.value` 💓 Corazonada | — | `W[in]`, `b[1]` | `ctx` → `V` (cuánto cree que va a ganar desde aquí; baseline del gradiente y fuente de esperanza/miedo, spec/07) |

Sin `hand.choose` la red **no puede disparar**: `validate` lo marca como error si `learning`/uso lo
exige (una red "solo pies" es válida como pieza para trasplantar, pero no puede jugar).

## 5. `shared/nn.js` y `shared/genome.js` — API exacta
```js
// genome.js
BLOCKS                                  // catálogo (§4) con name/icon/group/level/explain/example/params/streams
LIMITS                                  // spec/00 §6 (también en constants.js)
validate(genomeOrText) → {ok, errors:[{code, blockId?, wire?, message, example}], warnings:[...]}
normalize(genome) → genome              // copia con las secciones opcionales rellenas con sus defaults
repair(genome, rng) → {genome, fixes}   // rellena pesos que falten (Xavier con semilla), quita cables sueltos
outDims(genome) → {blockId: {stream, dim}}   // dimensión de salida de cada bloque (exige grafo válido)
countParams(genome) → n
newGenome({id, name, blocks, wires, ...}, rng) → genome válido con pesos
// nn.js
compile(genome) → net                   // lanza GenomeError {code, blockId?, message, example} si no valida
net.genome                              // el genoma normalizado
net.zeroState() → state                 // {blockId: Float64Array (echo/gru/teamMemory: h) | {h, c} (lstm)}
net.forward(obs, state) → out
net.backward(tape, gradOut, stateGradNext) → {grads: {blockId: {W: Float64Array, ...}}, stateGrad}
net.paramList() → [{blockId, key, array}] · net.getFlat() → Float64Array · net.setFlat(flat)
net.flattenGrads(grads) → Float64Array   // mismo orden que getFlat (para optimizadores y tests)
net.paramCount() · net.serialize() → weights (arrays JSON con precisión completa)
initWeights(block, inDim, rng) → weights del bloque
```
- **`obs`** = `{ctx: {blockId: Float64Array}, cand: {blockId: Float64Array[]}, move: {blockId:
  Float64Array[]}, team: {blockId: Float64Array}}`: una entrada **por cada bloque ojo** del genoma,
  indexada por su `id`, con la dimensión de `outDims` (las corrientes `cand`/`move` son arrays de
  vectores, uno por candidato/destino). `team[blockId]` = lectura de la memoria de equipo (media de
  los `h` de los compañeros vivos; si falta, se usa el `h` propio). Esto desacopla la red de
  `percept.js`: un test puede alimentar cualquier vector.
- **`out`** = `{outputs: {choose: {scores: Float64Array(N)} | null, adjust: {mu: Float64Array[N]
  (params)} | null, move: {scores: Float64Array(9), mu: Float64Array[9](2) | null} | null,
  value: number | null}, activations: {blockId: Float64Array | Float64Array[]}, attention:
  {blockId: Float64Array[heads] (N)}, state, tape}`. Puntuaciones **crudas**: la temperatura, el
  softmax y el muestreo son de `policy.js` (spec/03 §7).
- **`gradOut`** = `{choose: Float64Array(N) | null, adjust: Float64Array[N] | null, move: {scores,
  mu} | null, value: number | null}` = ∂L/∂salida. `stateGradNext` = `{blockId: ∂L/∂(estado de
  salida)}` que llega del paso siguiente (BPTT hacia atrás en el tiempo); `backward` devuelve
  `stateGrad` = ∂L/∂(estado de entrada) para encadenar con el paso anterior. Los gradientes de
  pesos de varias llamadas se **suman** fuera (`grads` es nuevo en cada llamada).
- `forward` es puro salvo por `state` (inmutable: devuelve uno nuevo). Coste objetivo < 5 ms para un
  genoma de 100 k parámetros con N = 24.
- `tape`: lo que `forward` guarda para `backward` (entradas y pre-activaciones por bloque).
- Regla de difusión (§3.2) en la práctica: un bloque cuyas entradas mezclan `ctx` y `cand`
  concatena, para cada candidato `i`, `[ctx…, cand_i…]` en el orden de `wires`; el gradiente hacia
  `ctx` es la suma sobre los candidatos.
- `validate` con texto: si `text.length > LIMITS.genomeBytes` → `limit` **antes** de `JSON.parse`;
  JSON inválido → `format`. Con objeto: campos → bloques → cables → dimensiones → pesos (se para en
  la primera fase con errores). Secciones opcionales ausentes (`traits`, `imagination`, `reward`,
  `learning`, `frozen`, `lineage`, `stats`, `emblem`) se aceptan (defaults); `weights` que falten
  para un bloque con parámetros → `weights-shape` (usa `repair`).
- Estabilidad: `softmax` con resta del máximo; `LayerNorm` con `eps`; ningún `NaN` sale de `forward`
  (si un peso es `NaN`, `validate` lo rechaza antes; si aparece en cálculo → `NetError`, y el agente
  cae al disparo de emergencia `0.1*x`, registrado como evento `error`).

## 6. Validación (`validate(genome, {forPlay} = {}) → {ok, errors:[{code, blockId?, wire?, message, example}], warnings}`)
`forPlay: true` exige `hand.choose` (`missing-choose`); sin él, una red "solo pies" o una pieza para
trasplantar valida. Avisos (`warnings[].code`): `unconnected` (bloque sin camino ojo → mano/pie).
Códigos (todos con mensaje en español y ejemplo de cómo arreglarlo):
`format` · `id` · `name` · `unknown-field` · `block-type` · `block-param` (rango) · `wire-ref`
(id inexistente) · `stream-mix` · `cycle` · `dim` · `missing-choose` · `duplicate-hand` ·
`weights-shape` · `weights-nan` · `limit` (bloques/cables/unidades/parámetros/JSON, spec/00 §6) ·
`traits` (rango) · `imagination` · `reward` · `learning`.
- Orden: tamaño del texto → JSON → campos → bloques → cables → dimensiones → pesos. Se para en la
  primera fase con errores (los pesos no se miran si el grafo está mal), así una red rota de 40 MB se
  rechaza en milisegundos.
- `repair(genome, rng)` 🧭: para el editor y la mutación: rellena pesos que falten, quita cables
  sueltos y devuelve `{genome, fixes:[...]}`. Nunca cambia lo que ya es válido.

## 7. Referencias independientes (tests de F2, `test/red.spec.mjs`)
1. **Gradiente numérico vs retropropagación** por bloque (cada tipo, cada activación, atención,
   norm, echo/gru/lstm con 3 pasos de BPTT, teamMemory) y para 20 grafos aleatorios válidos:
   error relativo < 1e-6 en doble precisión.
2. **Propiedades**: `validate` acepta los 4 genomas de plantilla; rechaza cada código de error con un
   caso mínimo; 20 grafos aleatorios válidos (generador propio del test) compilan y pasan el
   gradiente numérico (los 2 000 genomas de `mutate` se prueban en F5, spec/05 §9);
   `serialize → compile → serialize` idéntico bit a bit; `forward` determinista. Fórmulas exactas
   contra referencias escritas en el test (densa, echo, GRU, LSTM, atención, norm, pool, add/mul).
3. **Límites**: genoma con 65 bloques, 513 unidades, 2 000 001 parámetros, 49 MB de JSON → rechazo
   en < 50 ms cada uno (sin reservar memoria).
4. Estado de memoria: dos soldados del mismo jugador comparten `teamMemory` (media); un soldado solo
   lee la suya.
