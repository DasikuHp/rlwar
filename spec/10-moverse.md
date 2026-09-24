# 10 — Moverse solo donde se puede (P1b, 2026-09-24)

Decisiones del usuario (plan2, fila "Moverse solo donde se puede"). Nace del mutante geometry 68: un soldado pegado al
borde que pedía salir se deslizaba 0,05 u. "Castigarle por no ser consciente; ya que es consciente del mapa, solo moverse
donde sea posible":
- Pedir un sitio **imposible** = **pierde el movimiento** (se queda donde está) **y** la red recibe un **castigo**.
- Imposible = incumplir **cualquiera de las 5 reglas** de spec/01 §3, también la distancia (más de 2 u).
- Se acaba el deslizamiento: ni rejilla polar ni recorte al círculo de 2 u.
- Castigo = término nuevo del bloque Recompensa, **−0,3 por defecto**, editable como los demás.
- La red **ve la marca "imposible"** en sus 9 destinos (la entrada que hoy dice "deslizado").
- Las 8 direcciones pasan de 2 u a **1,5 u** (redes, heurísticos y `moveOptions`): el ajuste fino de la red (hasta
  ±1,5 u) tiene margen antes de pasarse de 2 u.
- **Heurísticos que no se equivocan**: solo eligen destinos posibles. Los agentes de la API lo leen en AGENTS.md y en la
  respuesta (`reason: 'blocked'`).

Sustituye el algoritmo de spec/01 §3 (desde "Algoritmo (determinista)") y lo que §3–§5 dicen de "deslizado". Las 5
reglas de validez no cambian.

## 1. `slideMove` (`shared/geometry.js`): el nombre se queda, deslizar no
`slideMove({from, requested, soldiers, obstacles, bites, selfId, plane})` → `{to, stayed, reason, why}`. Pura, nunca lanza.
El campo `slid` desaparece.

| `requested` | resultado |
|---|---|
| `'stay'`, `null` o `undefined` | `{to: from, stayed: true, reason: 'stay', why: null}` |
| no es un punto (`NaN`, `Infinity`, cadena, número, objeto sin `x`/`y` numéricos) | `{to: from, stayed: true, reason: 'invalid', why: null}` |
| un punto `T` que cumple las 5 reglas | `{to: T, stayed: false, reason: 'ok', why: null}` (`T` tal cual, sin recortar) |
| un punto `T` que incumple alguna | `{to: from, stayed: true, reason: 'blocked', why}` |

`why` = la **primera** regla que falla, en este orden:
1. `'far'`: a más de 2 u (`dist(T, from) > MOVE_RADIUS + 1e-9`).
2. `'edge'`: fuera del mapa (a menos de `BODY` = 0,5 u del borde).
3. `'terrain'`: dentro de terreno (agrandado en `BODY`, sin contar lo que se llevan los bocados).
4. `'soldier'`: a menos de 1 u de otro soldado vivo.
5. `'wall'`: el camino `from → T` cruza terreno (muestreo t = 0,1 … 1,0, como hoy).

`to` es siempre una copia (`{x, y}`), nunca el mismo objeto que `from` o `requested`.

Ejemplos (soldado en (−10, 0), mapa vacío salvo lo que se diga):
- pide (−8, 0) → va a (−8, 0), `reason: 'ok'`.
- pide (−7, 0), a 3 u → **se queda** en (−10, 0), `reason: 'blocked'`, `why: 'far'` (antes iba a (−8, 0)).
- en (−24,5, 3), pegado al borde, pide (−26, 3): está a 1,5 u (cumple la 1) pero fuera del mapa → se queda,
  `why: 'edge'`. Es el caso del mutante 68: antes se deslizaba 0,05 u.
- un círculo de r 1 en (−8, 0); pide (−8, 0) → `why: 'terrain'`; pide (−6,5, 0) (detrás del círculo, a 3,5 u) →
  `why: 'far'` (la primera que falla); pide (−8,6, 1,4) (a 1,98 u, fuera del círculo agrandado, pero el camino pasa
  por dentro) → `why: 'wall'`.
- otro soldado vivo en (−8, 0,5); pide (−8, 0) → `why: 'soldier'`. Si está muerto, no cuenta.

## 2. La sala (`Room.move`)
- Aplica `slideMove`. `lastMove = {playerId, soldierId, from, to, requested, stayed, reason, why, ts}`: `requested` es
  `{x, y}` si pidió un punto numérico (también si fue `blocked`) y `null` si fue `stay`, `invalid`, vencimiento o caído.
  `reason` = el de `slideMove`, salvo `'timeout'` (se acabó el tiempo) y `'dead'` (soldado caído, spec/01 §9.2).
- Evento `move`: `{from, to, requested, stayed, reason, why, coverBefore, coverAfter, decisionEventId}` (sin `slid`).
- Línea del registro: `🦶 <nombre> se mueve a (x, y)` · `🦶 <nombre> se queda quieto` (con ` (se acabó el tiempo)` si
  venció) · **nueva**: `🚫 <nombre> pidió un sitio imposible (<motivo>) y pierde el movimiento`, con el motivo en
  palabras: `far` → "a más de 2 u", `edge` → "fuera del mapa", `terrain` → "dentro de terreno", `soldier` → "pegado a
  otro soldado", `wall` → "al otro lado de un muro". Ejemplo: `🚫 Tortuga pidió un sitio imposible (dentro de terreno) y
  pierde el movimiento`.
- `fire` con `move` en el cuerpo y `POST /move` usan este mismo camino (como hoy).

## 3. Los 9 destinos (`moveOptions` en `agents/lib.js` y `moveDestinations` en `shared/percept.js`)
- En orden: `quedarse` y las 8 direcciones θ = 0°, 45° … 315° (marco local en la percepción, como hoy) a
  **`MOVE_OPTION_RADIUS` = 1,5 u** (constante nueva en `shared/constants.js`).
- Cada destino: `{i, to, stay, impossible, why, cover, distEnemy, los}` (y `feat` en la percepción). `to` = el punto
  pedido, también si es imposible (así se sabe hacia dónde era). `impossible` = `slideMove` da `blocked`; `why`, su motivo
  (o `null`). `quedarse` nunca es imposible.
- Lo demás (`cover`, `distEnemy`, `los` y, en la percepción, acercarse al enemigo, compañero más cercano, línea de tiro al
  enemigo 1 y pegado a terreno) se calcula **donde acabaría de verdad**: en el punto si es posible, en `from` si no.
  Ejemplo: la dirección "→" choca con un muro → `impossible: true`, `to` = el punto dentro del muro, `cover` = la de
  quedarse.
- Rasgos de la percepción (`eye.moves`, 9 por destino, mismo tamaño que hoy: las redes guardadas siguen valiendo):
  `dx/2`, `dy/2` (del punto pedido, en local), es-quedarse, **imposible** (antes "deslizado"), cobertura/4, Δ distancia
  al enemigo 1 /2, compañero más cercano (tope 10 u), línea de tiro al enemigo 1, pegado a terreno. En `eyeLayout` la
  entrada 4 se llama "imposible".

## 4. La red (`shared/policy.js`, `decideMove`)
- Elige el destino `k` como hoy. Sin ajuste fino: `quedarse` → `'stay'`; si no, pide `dests[k].to` **tal cual**, también
  si es imposible (la sala lo rechaza y la red recibe el castigo).
- Con ajuste fino: `objetivo = dests[k].to + 0,5·muestra` (en local, muestra recortada a ±3, como hoy) y se pide **tal
  cual**, sin deslizar. `decision.moveAdjust = {mu, sample, scales, target, to, reason, why}`: `to`, `reason` y `why`
  son lo que pasará según `slideMove` (lo que la interfaz enseña).
- `decision.moves[i]` lleva `impossible` y `why` en vez de `slid`.

## 5. Heurísticos (`agents/*`, reglas de spec/01 §5)
- Sniper, Greedy y Artillery aplican sus reglas **solo entre los destinos posibles** (quedarse siempre lo es).
- Chaos: `posibles[Math.floor(rng() * posibles.length)]` (una tirada, como hoy).
- Ninguno pide nunca un sitio imposible (test de 120 escenas).

## 6. Recompensa (spec/04)
- Término nuevo **`impossibleMove`** ("Movimiento imposible"): **−0,3** por defecto, rango −5..5 como los demás, en
  `DEFAULT_REWARD`, `REWARD_TERMS` y el catálogo `rewardTerms` (nombre, qué castiga y la personalidad que provoca:
  "cuidadosa: conoce su alcance y el mapa antes de moverse").
- Se asigna a la decisión de moverse cuyo evento `move` tiene `reason: 'blocked'` (una vez, `× 1`). Nunca por quedarse,
  vencer el tiempo, una entrada inválida o estar caído.
- Las redes que ya existen lo reciben con su valor por defecto al cargarse (`normalize`); `evo/base/vidente-1.json` no
  cambia en disco.

## 7. AGENTS.md
"Movimiento tras disparar": un destino que incumple las reglas **no se desliza**: el soldado pierde el movimiento
(`reason: 'blocked'` y `why`). Los 9 `moveOptions` están a 1,5 u y llevan `impossible`/`why`. El evento `move` y
`lastMove` ya no traen `slid`.

## 8. Tests
- Nuevo, congelado antes del código: `test/moverse.spec.mjs` (todo lo de §1–§7 con ejemplos como los de arriba; 120
  escenas al azar con semilla para los heurísticos y para "la red nunca ve un destino marcado posible que la sala
  rechace", y el castigo en `assignRewards`).
- Tests congelados que cambian (cada uno con OK y motivo; lista en el relevo cuando empiece la fase): `geometry`,
  `motor`, `moves`, `politica`, `rooms`, `terreno-extra`, `percepcion` y `arreglos-motor`, en lo que prueba el
  deslizamiento, el recorte a 2 u, `slid` y los destinos a 2 u.
- Mutantes de `geometry.js`, `percept.js` (destinos), `policy.js` (mover), `lib.js`, `rooms.js` (`move`), `reward.js`
  y los heurísticos. Cierra los huecos 55–56 de `geometry.js` (la rejilla, 68 y 74, desaparece).
