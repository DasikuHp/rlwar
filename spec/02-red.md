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

## 5. `shared/nn.js` — API
```js
compile(genome) → net           // valida (lanza GenomeError con {code, blockId?, message, example})
net.forward(obs, state) → { outputs: {choose:{scores,probs}, adjust:{mu}, move:{scores,probs,mu}, value:V},
                             activations: {blockId: Float64Array|Float64Array[]}, attention: {...}, state' }
net.backward(tape, grads) → gradientes por bloque (mismas claves que weights); acumulables
net.params() / net.setParams(flat) / net.paramCount()
net.serialize() → weights (para el genoma); net.zeroState() → estado de memoria inicial
initWeights(block, rng) · countParams(genome)
```
- `forward` es puro salvo por `state` (inmutable: devuelve uno nuevo). Coste objetivo < 5 ms para un
  genoma de 100 k parámetros con N = 24.
- `tape`: lo que `forward` guarda para `backward` (entradas y pre-activaciones por bloque).
- Estabilidad: `softmax` con resta del máximo; `LayerNorm` con `eps`; ningún `NaN` sale de `forward`
  (si un peso es `NaN`, `validate` lo rechaza antes; si aparece en cálculo → `NetError`, y el agente
  cae al disparo de emergencia `0.1*x`, registrado como evento `error`).

## 6. Validación (`validate(genome) → {ok, errors:[{code, blockId?, wireId?, message, example}], warnings}`)
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
   caso mínimo; 2 000 genomas aleatorios generados por `mutate` (spec/05) siempre validan;
   `serialize → compile → serialize` idéntico bit a bit; `forward` determinista.
3. **Límites**: genoma con 65 bloques, 513 unidades, 2 000 001 parámetros, 49 MB de JSON → rechazo
   en < 50 ms cada uno (sin reservar memoria).
4. Estado de memoria: dos soldados del mismo jugador comparten `teamMemory` (media); un soldado solo
   lee la suya.
