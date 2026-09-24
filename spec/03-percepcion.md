# 03 — Percepción: los 8 ojos, 🎲 Imaginación, destinos, decisión (F3)

> Contrato exacto de `shared/percept.js`, `shared/policy.js`, `agents/net.js`. Fuente: plan2.md
> rondas 1, 2, 7, 8; §4.3, §4.6. Los números de §8 salen del experimento desechable (2026-09-22).

## 1. Marco del soldado (todo se ve "hacia delante")
Todos los ojos se expresan en el **marco del soldado**: el eje x apunta hacia el enemigo. Para el
equipo derecho, `x' = −x` (y no cambia). Así la **misma red juega igual en los dos lados** (duelo
3 mapas × 2 lados) y los candidatos se generan siempre "hacia +x'".
- `toLocal(p, team)` / `toWorld(p, team)` en `percept.js`.
- Una expresión local se convierte a mundo para el derecho por sustitución textual:
  `function`: `x → (-x)` · `ode1`: `-(f((-x), y))` · `ode2`: `h((-x), y, -(y'))`; el `angle` **no**
  cambia (con el arreglo de spec/01 §7b el ángulo positivo sube en los dos lados).
  Test: la trayectoria de la expresión local en una escena espejada es el espejo exacto.
- `decision` guarda `exprLocal` (lo que "pensó" la red) y `expr` (lo que se disparó).

## 2. Layout exacto de cada ojo (índice → nombre en español en el catálogo, `eyes[].layout`)
> **Terreno de P1 (ronda 17, spec/01 §10.5):** los obstáculos son círculos (y rectángulos) con bocados. Todo lo que aquí
> dice "rect" u "obstáculo" se lee con `isSolid` (sólido = dentro de algún obstáculo y fuera de todos los bocados):
> LOS, 📡 Radar, 🗺 Mapa, destinos y "pegado a obstáculo". En 🧱 un círculo se ve por su caja. En 🔮 las dos primeras
> entradas son cuántos enemigos y cuántos aliados alcanza el tiro (0–4; con un solo impacto, 1) y fin, puntos y
> `minDist` llegan hasta el primer impacto. En ⏱ `remaps` vale siempre 0 y `shotsNoKill/STALL_SHOTS` se queda como
> mucho en 1. En 👥 "mató" y "fuego amigo" salen de las cuentas del último tiro (`kills`, `friendly`).

Normalizaciones: `dx/50`, `dy/30`, `dist/58` (diagonal del plano), `tanh` donde se indica. "LOS"
(línea de tiro) = segmento recto sin cruzar obstáculos (muestreo cada 0.25 u). "Presente" = 1 si
existe el elemento, 0 y ceros en el resto si no. Enemigos y aliados ordenados por distancia; **solo
vivos**; "aliados" excluye al propio soldado.

| ojo | índices | contenido |
|---|---|---|
| 📊 `eye.features` [26] | 0–4 | `x'/25`, `y/15`, `1` (bias), aliados vivos/3, enemigos vivos/4 |
| | 5–9 · 10–14 | enemigo 1 · enemigo 2: `dx/50`, `dy/30`, `dist/58`, LOS hacia él, presente |
| | 15–19 · 20–24 | aliado 1 · aliado 2: `dx/50`, `dy/30`, `dist/58`, "en mi línea" (a < `HIT_RADIUS`+0.5 del segmento hacia el enemigo 1), presente |
| | 25 | nº de obstáculos/8 |
| 🧱 `eye.obstacles` [5·slots+1] | por slot (rects ordenados por distancia al soldado) | `cx'/25`, `cy/15`, `w/10`, `h/15`, presente · último índice: nº/8 |
| 📜 `eye.history` [2·depth·14] | primero mis `depth` disparos (de cualquier soldado de mi jugador, el más reciente primero), luego los `depth` del rival | por disparo: familia one-hot(6: line, parabola, sine, ode1, artillery, wild), `p1n`, `p2n` (§5, en el marco del tirador), resultado one-hot(5: kill, suicide, obstacle, wall, other), `minDist/10` (cap 1) |
| 📡 `eye.radar` [2·rays] | rayo k con `θ = k·360/rays` desde el soldado (marco local) | distancia al primer obstáculo o borde `/58`, tipo (1 obstáculo, 0 borde). Marcha de 0.25 u |
| ⏱ `eye.clock` [8] | 0–7 | `shots/MAX_SHOTS`, `shotsNoKill/STALL_SHOTS`, `min(1, remaps/3)`, míos vivos/4, enemigos vivos/4, (mis kills − sus kills)/4, turnos de este soldado/20 (cap 1), **fase** (0 disparar, 1 mover) |
| 👥 `eye.mates` [12] | agregados sobre aliados vivos | nº/3, media `dx/50`, media `dy/30`, min `dist/58`, max `dist/58`, fracción con LOS a algún enemigo, fracción cuyo último tiro mató, fracción con fuego amigo, media `minDist/10` del último tiro, fracción que se quedó quieta, aliados muertos/3, presente |
| 🎯 `eye.candidates` [N×12] | por candidato | familia one-hot(6), `p1n`, `p2n`, `p3n`, error analítico en la x del enemigo 1 (`tanh(Δy/3)`, 0 si EDO), ídem enemigo 2, es-EDO |
| 🔮 `eye.simulator` [N×10] | por candidato (barrido grueso `ds 0.05`, o fino si `fine`) | enemigos alcanzados (0–4), aliados alcanzados (0–4), obstacle, wall, otro fin (estos tres solo si no alcanza a nadie), `minDist/10` (cap 1), `endX'/25`, `endY/15`, `puntos/200` (cap 1) —los cuatro hasta el primer impacto—, alcanza al enemigo 1 |
| 🦶 `eye.moves` [9×9] | por destino (§4) | `dx'/2`, `dy/2`, es-quedarse, imposible (P1b; antes "deslizado"), enemigos con LOS hacia él/4, Δ distancia al enemigo 1 (`/2`, + = más lejos), distancia al aliado más cercano/10 (cap 1), LOS al enemigo 1 desde ahí, pegado a obstáculo (a < 1 u de un rect ampliado) |
| 🗺 `eye.map` [C×H×W] | `W = 50/cell`, `H = 30/cell`; índice `c·H·W + fila·W + col`; fila 0 = `yMin`, col 0 = `x' = −25` | canal `obstacles`: fracción de celda cubierta (rejilla 4×4); `enemies`/`allies`/`self`: 1 en la celda del soldado vivo; `trails`: celdas cruzadas por los 2 últimos disparos de cada equipo (último 1, anterior 0.5) |

Error analítico: para `function`, `Δy = f(ex') − f(sx') + sy − ey` (la curva pasa por el soldado).

## 3. Observación (`observe(state, soldierId, genome, phase, cache) → obs`)
- `obs = {ctx: {blockId: Float64Array}, cand: {blockId: Float64Array[]}, move: {blockId: Float64Array[]}, candidates, destinations}`.
- `phase ∈ {'shoot','move'}`. En `'move'` el historial y los rasgos ya incluyen el disparo recién
  hecho; en `'shoot'` los destinos no se calculan (Pies inactivos: sus ojos van a **cero**) y en
  `'move'` los candidatos tampoco (Manos inactivas: `eye.candidates`/`eye.simulator` a cero). Así
  la red recibe siempre todas sus entradas y las cabezas inactivas se ignoran.
- Radar: se marcha `k = 1, 2, …` con `P_k = soldado + k·0.25·dir`; el primer `P_k` dentro de un
  obstáculo (rect sin ampliar, bordes incluidos) da `(k·0.25, 1)`; el primero fuera del plano da
  `(k·0.25, 0)`.
- Coste objetivo: < 1 ms sin simulador; simulador: ≈ 0.11 ms por candidato (medido) → N=24 ≈ 2.6 ms.

## 4. Destinos de movimiento
Los 9 de spec/10 §3 (`quedarse`, luego 0°, 45° … 315° en el marco local, a 1,5 u, con la marca "imposible"; los
rasgos, donde acabaría de verdad). `foot.move`
puntúa los 9 (`softmax/temperature`) y, si `adjust`, la fila elegida da `μ[2]`: desplazamiento
`(0.5·a₁, 0.5·a₂)` u con `a ~ N(μ, pulse²)` recortado a [−3, 3]; el punto final se **pide tal cual** (spec/10 §4): si
es imposible, pierde el movimiento y cuenta el castigo `impossibleMove`.

## 5. 🎲 Imaginación (`genome.imagination`)
```json
{ "n": 24, "targets": "all",
  "families": {
    "line":      { "on": true, "weight": 6, "jitter": [0, 0.03, -0.03, 0.08, -0.08, 0.15, -0.15] },
    "parabola":  { "on": true, "weight": 6, "curvatures": [0.004, -0.004, 0.01, -0.01, 0.02, -0.02, 0.04, -0.04] },
    "sine":      { "on": true, "weight": 4, "amps": [2, -2, 4, -4, 6], "periods": [3, 5, 8, 12] },
    "ode1":      { "on": true, "weight": 2, "a": [-2, -1, 1, 2], "k": [3, 6, 12], "b": [-1, 0, 1] },
    "artillery": { "on": true, "weight": 4, "gravities": [0.02, 0.04, 0.07, 0.1, 0.15], "angles": [10, 20, 30, 40, 50, 60, 70] },
    "wild":      { "on": true, "weight": 2, "a": [-8, -4, -2, 2, 4, 8], "k": [1, 3, 6, 12, 20] }
  },
  "adaptive": false, "usage": { "line": 0, "parabola": 0, "sine": 0, "ode1": 0, "artillery": 0, "wild": 0 } }
```
| familia | expresión local | params `[p1, p2, p3]` | normalizados `p·n` |
|---|---|---|---|
| line | `s*x` con `s = s₀·(1+jitter)`, `s₀` = pendiente directa al objetivo | `[s, 0, 0]` | `tanh(s/2)` |
| parabola | `s₀*x + k*x^2` | `[s₀, k, 0]` | `tanh(s/2)`, `tanh(20k)` |
| sine | `s₀*x + A*sin(x/T)` | `[s₀, A, T]` | `tanh(s/2)`, `A/6`, `T/12` |
| ode1 | `a*sin(x/k)+b` (modo `ode1`) | `[a, k, b]` | `a/3`, `k/12`, `b/3` |
| artillery | `-g` (modo `ode2`, `angle`) | `[g, angle, 0]` | `g/0.15`, `angle/85` |
| wild | plantillas de Chaos (`a*tan(x/k)`, `a*sin(x*k)`, `a*exp(-abs(x)/k)`, `a*x^3/k^2`, `a*(x/k)^2*sin(x/k)`, `a*sqrt(abs(x))*sin(x/k)`, `a*ln(abs(x)+1)*cos(x/k)`) | `[a, k, idx]` | `a/8`, `k/20`, `idx/6` |

Generación (determinista con `rng`): cupo por familia = reparto de `n` proporcional a `weight`
(restos mayores; familias `on:false` no cuentan); cada familia saca **combinaciones distintas** de su
rejilla (barajadas con `rng`), alternando objetivos (`targets: "all"` recorre los enemigos por
distancia; `"nearest"` solo el primero). Si la rejilla se agota, se repite con `jitter` extra
`±rng·0.05`. Orden final: por familia en el orden de la tabla; `i` es el índice en el overlay.
`n` ∈ 4..64. Sin enemigos vivos delante (dx' ≤ 0 para todos) → líneas hacia el enemigo más cercano
igualmente (la pendiente se calcula; el tiro saldrá hacia +x'). `adaptive` (spec/05 §6).

## 6. ✏ Ajustar (delta acotado; experimento §8)
La fila elegida de `hand.adjust` da `μ[params]`; `a_i ~ N(μ_i, pulse²)` recortado a [−3, 3];
`p_i' = p_i + scale_i·a_i` y se **reconstruye** la expresión con la plantilla de la familia:
| familia | escalas `[Δp1, Δp2, Δp3]` |
|---|---|
| line | `[0.03·(1+|s|), –, –]` |
| parabola | `[0.03·(1+|s|), 0.003, –]` |
| sine | `[0.03·(1+|s|), 0.3, 0.5]` |
| ode1 | `[0.2, 0.5, 0.2]` |
| artillery | `[0.005, 3, –]` (grados) · resultado recortado a `g ∈ [0.005, 0.3]`, `angle ∈ [−85, 85]` |
| wild | `[0.3, 1, –]` |
Con `pulse` 0.1 y `μ ≈ 0` el ajuste es casi nulo al nacer (el experimento muestra que el ruido
continuo grande arruina la puntería: §8). `learning.gradient.adjustLearn=false` congela `μ`.

## 7. Decisión (`policy.decide(net, state, soldierId, opts) → {mode, expr, angle?, move?, decision}`)
Dos pasadas por turno (la memoria avanza dos pasos): `'shoot'` → Manos; tras el resultado, `'move'`
→ Pies (`agents/net.js: chooseMove`). `temperature` = `traits.temperature` (0.05..3).
`decision` (va al evento `decision` y al registro, spec/07):
```json
{ "soldierId": "s3", "turn": 12, "phase": "shoot", "netId": "hydra-7", "ms": 3.1,
  "candidates": [ { "i": 0, "family": "line", "params": [0.31, 0, 0], "mode": "function",
                    "exprLocal": "0.31*x", "expr": "-0.31*x", "angle": null,
                    "score": 1.2, "p": 0.31, "sim": { "type": "kill", "minDist": 0.2 } , "points": [[x,y],...] } ],
  "chosen": 4, "margin": 0.18,
  "adjust": { "mu": [0.1, 0, 0], "sample": [0.14, 0, 0], "scales": [0.04, 0, 0],
              "paramsBefore": [0.31, 0, 0], "paramsAfter": [0.316, 0, 0], "exprLocal": "0.316*x", "expr": "-0.316*x" },
  "moves": null, "chosenMove": null, "moveAdjust": null,
  "value": 0.42, "attention": { "b7": [0.02, 0.8, ...] },
  "attribution": [ { "blockId": "b1", "name": "Mapa", "drop": 0.42, "share": 0.6 } ],
  "logp": { "choose": -1.17, "adjust": -0.4, "move": null },
  "activationsSummary": { "b3": { "mean": 0.31, "sample": [ ... ≤ 32 valores ... ] } } }
```
- `points`: polilínea gruesa (cada 0.5 u, ≤ 100 puntos) de **todos** los candidatos, siempre (el
  overlay los pinta tenues aunque la red sea ciega: lo que la red ve es solo lo de sus ojos).
- `margin = p[elegido] − max p[otros]` (certeza, spec/07 §4). `sim` solo si hay `eye.simulator`
  (real, no teatro); `value` solo con `hand.value`; `attention` solo con bloques de atención.
- `attribution` ("tapar y comparar"): por cada ojo `E`, pasada extra con la salida de `E` a cero;
  `drop = p[elegido] − p'[elegido]`; `share = max(0,drop)/Σmax(0,drop)`. Solo si `opts.attribution`
  (x1 siempre; x10 opcional; turbo nunca). Coste ≤ nº de ojos × una pasada.
- `logp`: log-probabilidades reales usadas por el gradiente (spec/04).
- Muestreo con `rng` de la sala (determinismo).

## 8. Resultados del experimento desechable (2026-09-22, 4,2 min de CPU; código borrado)
Tarea: un disparo por episodio, mapa real nuevo cada vez, 1–2 enemigos, 0–1 aliado, 16 candidatos
(rectas, parábolas, senos, artillería), MLP de 32 tanh compartido por candidato, softmax, REINFORCE
+ baseline (EMA 0.05), Adam lr 0.003, 3 000 episodios, 3 semillas. "Oráculo" = algún candidato mata.
| ojos | kills al final (media ± sd) | oráculo | llega al 90 % del oráculo |
|---|---|---|---|
| T1 geometría cruda (rasgos + params) | 0.49 ± 0.02 | 0.76 | no en 3 000 |
| T2 + error analítico por candidato | 0.49 ± 0.04 | 0.76 | no en 3 000 |
| T3 + 🔮 Simulador | **0.76 ± 0.03** | 0.76 | **≈ 330 episodios** |
| T4 T1 + 🗺 Mapa 2 u (1 125 entradas) | 0.45 ± 0.01 | 0.76 | no en 3 000 |
- Al nacer (500 primeros): ciega 0.40, vidente 0.68. Suicidios: ≤ 1 %.
- Conclusión para el diseño: la **vidente** aprende en cientos de decisiones; la **ciega** necesita
  miles y una red mayor (aprende a preferir la recta directa, 0.53, y poco más en 3 000). Ambas se
  ofrecen (✅), y la spec/08 lo explica en el bloque 🔮 ("sin él, cuenta con horas de turbo").
- Ajustar: emitir la pendiente **absoluta** con ruido gaussiano no aprende nada (0.00 tras 3 000);
  como **delta acotado** sobre un candidato (curvatura ±0.03·tanh) pasa de 0.15 a 0.31 pero sigue
  por debajo de la recta sin ruido (0.55) porque el ruido de exploración (σ ≥ 0.2) estropea la
  puntería → escalas pequeñas de §6 y `pulse` 0.1 por defecto.
- Velocidad: simulación 0.11 ms/candidato (grueso); decisión de 16 candidatos ≈ 2–3 ms; red T1–T3
  0.07–0.27 ms; con Mapa 2.3 ms (se abarata en la red real: el contexto se calcula una vez, no por
  candidato). `worker_threads`: 1 hilo 314 decisiones/s → 2 hilos ×1.9, 4 hilos ×3.0, 8 hilos ×6.6
  (24 núcleos).

## 9. API exacta y ampliaciones de la sala (fijado antes de los tests de F3)

### 9.1 `shared/percept.js`
```js
toLocal({x, y}, team) / toWorld({x, y}, team)      // x' = -x para el equipo derecho
localToWorldExpr(exprLocal, mode, team)              // sustitución textual de §1 (identidad para el izquierdo)
worldToLocalSlope(a, team)                           // pendiente de `a*x`: -a para el derecho
FAMILY_ORDER = ['line', 'parabola', 'sine', 'ode1', 'artillery', 'wild']
familyOf(shot) → {family, params}                    // clasifica un disparo ajeno (§9.3)
generateCandidates(state, soldier, imagination, rng) → cands   // §5; cands[i].i === i
applyAdjust(cand, sample) → cand'                    // §6 (recorte de artillería incluido)
candidateFeatures(cand, ctx) → Float64Array(12)      // eye.candidates
simulateCandidate(cand, ctx, fine) → {type, end, minDist, endX, endY, points, victimId, hitIds, enemiesHit, alliesHit, polyline}
simulatorFeatures(sim, ctx) → Float64Array(10)
moveDestinations(state, soldier) → [{i, to, stay, impossible, why, cover, distEnemy, los, feat: Float64Array(9)}]
observe(state, soldierId, genome, { phase, cands, moves, sims }) → obs (spec/02 §5) + {names}
eyeLayout(block) → [{index, name}]                   // nombres en español de cada índice (catálogo)
```
- `state` es el `snapshot()` de la sala **ampliado** (§9.3). `ctx` = `contextFor` de `agents/lib.js`
  más `team`. Todo vector se calcula en el marco local del soldado.
- Cupo de la Imaginación: `count_f = floor(n·w_f/Σw)` y los restos por mayor parte fraccionaria
  (empate → orden de `FAMILY_ORDER`). Rejilla por familia = producto cartesiano de sus listas
  (× objetivos en `line`, `parabola`, `sine`; `wild` × sus 7 plantillas). Se baraja con Fisher–Yates
  (`j = floor(rng()·(i+1))`, de atrás adelante) y se toman los `count_f` primeros (en `line`, la recta
  exacta al objetivo más cercano, jitter 0, va siempre la primera); si la rejilla es
  menor que el cupo, se repite desde el principio con `p1 += (rng()·2−1)·0.05`. Objetivos: enemigos
  vivos ordenados por distancia (`nearest`: solo el primero); si no hay enemigos vivos, objetivo
  virtual en `(sx'+20, sy)`.
- Plantillas exactas de `expr` local: `line` `${s.toFixed(5)}*x` · `parabola`
  `${s.toFixed(5)}*x+${k.toFixed(5)}*x^2` · `sine` `${s.toFixed(5)}*x+${A.toFixed(3)}*sin(x/${T.toFixed(3)})` ·
  `ode1` `${a.toFixed(3)}*sin(x/${k.toFixed(3)})+${b.toFixed(3)}` · `artillery` `expr = -g.toFixed(4)`,
  `angle` entero · `wild` plantillas de Chaos con `a.toFixed(3)` y `k.toFixed(2)`, `params = [a, k, idx]`.
- `applyAdjust(cand, sample)`: `p_i' = p_i + scale_i·clip(sample_i, −3, 3)` con las escalas de §6;
  se reconstruye `exprLocal`, `expr` y `angle` (artillería: `g ∈ [0.005, 0.3]`, `angle ∈ [−85, 85]`,
  redondeado a entero).
- Errores analíticos (`eye.candidates`): `tanh(Δy/3)`; si la fórmula da un valor no finito → 0.
- `eye.mates`: los aliados sin disparo previo cuentan 0 en las fracciones de kill/fuego amigo/quieto y
  1 en `minDist/10`.
- `eye.moves` "pegado a obstáculo": el destino está dentro de algún rect ampliado en `BODY + 1`.
- `eye.map` obstáculos: fracción de una rejilla 4×4 de puntos (centros de subceldas) dentro de algún
  rect; estelas: los `points` de los 2 últimos disparos de cada equipo del `shotLog` (§9.3), último 1,
  anterior 0.5, se toma el máximo.

### 9.2 `shared/policy.js`
```js
softmaxT(scores, temperature) → probs
sampleIndex(probs, rng) → i              // r = rng(); acumula; el último si sobra
decideShot({ net, genome, state, soldierId, memory, team, rng, attribution, sims }) →
  { choice: {mode, expr, angle, family, params, exprLocal}, decision, memory }
decideMove({ net, genome, state, soldierId, memory, team, rng, shot }) →
  { move: {x, y} | 'stay', decision, memory }
attribute(net, obs, memory, chosen, phase) → [{blockId, name, drop, share}]
```
- `memory` = estado de las memorias de este soldado (spec/02 `zeroState()`); `team` =
  `{blockId: Float64Array}` (media de los `h` de los compañeros vivos, o `null`).
- Elección: `p = softmaxT(scores, traits.temperature)`; `chosen = sampleIndex(p, rng)`;
  `margin = p[chosen] − max_{i≠chosen} p[i]`; `logp.choose = ln p[chosen]`.
- Ajuste: `a_i = clip(μ_i + pulse·gauss(rng), −3, 3)` (se consume **un** `rng.gauss()` por
  parámetro, en orden); `logp.adjust = Σ_i ln N(a_i; μ_i, pulse²)` con la densidad sin recortar.
  Sin `hand.adjust`: `adjust = null`, `logp.adjust = null`.
- Movimiento: igual sobre 9 destinos; con ajuste, desplazamiento `(0.5·a₁, 0.5·a₂)` pedido tal cual; el registro guarda
  `moveAdjust` con lo que pasará según `slideMove` (`to`, `reason`, `why`; spec/10 §4). Sin `foot.move`: `move = 'stay'`.
- Sin `hand.value`: `value = null`. Atribución solo si `attribution:true`.
- Orden de consumo del `rng` en `decideShot`: 1) `sampleIndex` 2) los `gauss` del ajuste.
  La Imaginación usa su propio `rng` derivado del estado (`shots` y la posición del soldado en
  `state.soldiers`), así dos salas con la misma semilla imaginan lo mismo aunque los ids difieran.

### 9.3 Ampliaciones de `server/rooms.js` (F3)
- `room.shotLog` (máx. 40) y `snapshot().shotLog` (últimos 16; `points` solo en los últimos 4):
  `{turn, playerId, soldierId, team, mode, expr, angle, family, params, result:{type, soldierId},
  minDist, stayed, points}`; `family/params` del `choice` si los trae (redes) o de `familyOf`
  (heurísticos y humanos: `a*x` → `line` `[a', 0, 0]` con `a'` en el marco del tirador; `ode1` →
  `ode1` `[0,0,0]`; `ode2` → `artillery` `[g, angle, 0]`; otro `function` → `wild` `[0,0,0]`).
  `minDist` = mínima distancia de los puntos del tiro a un enemigo vivo (antes de la baja).
  `stayed` se rellena al resolver el movimiento de ese turno.
- `soldiers[].turns` (veces que ha tenido el turno) y `snapshot().stats = {shots, shotsNoKill, remaps}`.
- `players[].netId`, `players[].learn`; `addAgent('net', {netId, learn, team})` o `addAgent('net:<id>')`.
- Evento SSE `decision` `{decision}` antes de `shot` (fase `shoot`) y antes de `move` (fase `move`);
  `snapshot().lastDecision`. En sala sin pantalla no se emite, pero `room.decisions` (últimas 50) los guarda.
- `players[].agentType === 'net'` en el snapshot; `name` = nombre de la red.

### 9.4 `agents/net.js`, `agents/registry.js`, `evo/store.js`
- `evo/store.js`: `netsDir()` (`evo/nets/`, o `GW_EVO_DIR`), `listNets() → [{id, name, emblem,
  traits, stats, generation, paramCount, blocks, updatedAt}]`, `loadNet(id) → genome|null`,
  `saveNet(genome) → {ok, id}` (valida `forPlay:false`; escritura atómica `tmp` + `rename`),
  `deleteNet(id)`. Ids de fichero = `id` del genoma. Ficheros ilegibles se ignoran con aviso.
- `registry.listAgents()` = 4 heurísticos + `{id:'net:<id>', name, icon:'🧠', description, net:true,
  netId, emblem}`. `createAgent('net:<id>')` y `createAgent('net', {netId, genome?, learn})`.
- `agents/net.js: create({netId, genome, learn = false})` → `{meta, chooseShot, chooseMove,
  memoryFor(soldierId), trajectories}`; guarda `memory` por soldado y calcula `team` como media de
  los `h` de los otros soldados vivos del mismo jugador (última escritura). `chooseShot` devuelve
  `{mode, expr, angle, family, params, exprLocal, reason: '', decision}`; `chooseMove` devuelve
  `{x, y, stay?, decision}` (`stay:true` = quedarse; la sala lo trata como `'stay'`). Ante cualquier excepción devuelve `0.1*x` y `decision.error`.
