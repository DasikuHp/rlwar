# Guía para agentes IA 🤖

Cualquier agente (Cline, un LLM con shell, un bot propio) puede jugar Graphwar. Dos opciones:

## Opción A — CLI incluida (lo más rápido)

```bash
cd E:\grafwar
node agent/agent.mjs create --name "Sala Cline"        # crea sala y guarda sesión
curl -X POST localhost:8787/api/rooms/ABCD/addbot -d "{\"level\":2}"   # añade CPU (la sala la ves en `rooms`)
node agent/agent.mjs join --room ABCD --name Cline --team left
curl -X POST localhost:8787/api/rooms/ABCD/start -d "{\"playerId\":\"p1\"}"
node agent/agent.mjs state                              # muestra turno, soldados, enemigos, obstáculos
node agent/agent.mjs fire --expr "sin(x/5)*3" --mode function
node agent/agent.mjs fire --expr "-0.05" --mode ode2 --angle 35
node agent/agent.mjs autopilot                          # juega solo turnos completos
```

## Opción B — API REST (desde cualquier lenguaje)

Base: `http://localhost:8787`

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| GET | `/api/agents` | — | agentes disponibles (id, nombre, icono, descripción) |
| GET | `/api/rooms` | — | lista de salas |
| POST | `/api/rooms` | `{name}` | `{code}` |
| POST | `/api/rooms/:code/join` | `{name, team}` | `{player:{id,...}, token}` |
| POST | `/api/rooms/:code/addagent` | `{type, level, team}` | sienta un agente IA (self-play) |
| POST | `/api/rooms/:code/addbot` | `{level, type}` | alias de addagent (compatibilidad) |
| POST | `/api/rooms/:code/start` | `{playerId}` (opcional en salas solo-IA) | inicia la partida |
| GET | `/api/rooms/:code/state` | — | snapshot completo (incluye `history`) |
| POST | `/api/rooms/:code/fire` | `{playerId, mode, expr, angle}` | `{ok, result}` |
| POST | `/api/rooms/:code/chat` | `{playerId, text}` | chat |
| GET | `/api/rooms/:code/events` | — | SSE: `hello`,`state`,`shot`,`chat`,`gameover` |

| POST | `/api/rooms/:code/move` | `{playerId, x, y}` o `{playerId, stay:true}` | `{ok, move}` — destino tras disparar (F1) |

`mode` ∈ `function` (`y=`), `ode1` (`y'=`), `ode2` (`y''=`, con `angle` en grados -85..85; el ángulo positivo **sube** en los dos lados).

### Movimiento tras disparar (F1, `spec/01-motor.md`)
Después de cada disparo, el soldado que disparó puede moverse hasta **2 u** (círculo). Dos vías:
- **con el disparo**: `fire` admite `move: {x, y}` o `move: "stay"` (se aplica al instante);
- **después de ver el tiro**: si `fire` no lleva `move`, el turno pasa a `state.turn.stage === "move"`
  (con `deadline` y `radius`); envía `POST /move` antes del plazo o te quedas quieto.
Un destino inválido (dentro de un obstáculo, fuera del plano, a menos de 1 u de otro soldado, o al otro
lado de un muro) **se desliza** al punto válido más cercano. `state.lastMove` y el evento SSE `move`
(`{move:{from,to,requested,slid,stayed}}`) cuentan qué pasó. `POST /api/rooms` admite `seed` (partida
reproducible; `state.config.seed` la expone siempre) y `speed` (`1` | `10`; una sala x10 solo admite agentes).
Fuego amigo: si tu tiro mata a un aliado, muere **solo el aliado**; tu soldado sigue vivo y se mueve igual.
El `state` incluye `players[]` (con `agentType`, `kills`, `deaths`, `alive`), `soldiers[]`, `obstacles[]`,
`history[]` (últimas expresiones disparadas, para no repetir), `turn` con `deadline` y `result` al terminar.

También puedes **espectar** cualquier sala en el navegador con `http://localhost:8787/#room=CODE`.

### API para implementar agentes en proceso (server-side)

```js
// agents/miagente.js
import { best, contextFor, directShots, randomTemplates, avoidRepeats } from './lib.js';
export const meta = { id: 'miagente', name: 'MiAgente', icon: '🚀', description: '...' };
export function create({ level = 2 } = {}) {
  return {
    meta,
    chooseShot({ soldiers, obstacles, soldier, history, rng, moveOptions }) {
      const ctx = contextFor(soldiers, obstacles, soldier);
      const cands = avoidRepeats([...directShots(ctx, { rng }), ...randomTemplates(30, rng)], history, rng);
      return best(ctx, cands);           // {mode, expr, angle?, move?}  (move opcional: {x,y} | 'stay')
    },
    // opcional (F1): se llama tras ver el resultado del tiro; gana sobre `move` de chooseShot
    chooseMove({ soldiers, obstacles, soldier, shot, moveOptions, history, rng }) {
      return moveOptions[1].to;          // moveOptions: 9 destinos ya deslizados {i,to,stay,slid,cover,distEnemy,los}
    },
  };
}
```
`rng` es una función `() → [0,1)` con semilla (usa `rng()` en vez de `Math.random()` para que
"misma semilla = misma partida" se cumpla también con tu agente).
Añádelo a `MODULES` en `agents/registry.js` y ya aparece en `GET /api/agents`, en la arena (`arena/selfplay.mjs --agents ...`) y en las salas.

### Cómo jugar bien (estrategia)

1. Lee `state`: tus soldados (`ownerId === tu playerId`), enemigos vivos, obstáculos (rects `{x,y,w,h}`) y `turn.soldierId` (quién dispara).
2. **Simula antes de disparar**: importa `shared/solver.js` y `shared/parser.js` (o copia la lógica de `agent/search.mjs`). El servidor usa exactamente el mismo código, así que tu predicción es exacta.
3. El disparo en modo `function` se **traslada** para pasar por tu soldado: la constante que añadas es irrelevante; lo que importa es la **forma** (pendiente `a` en `a*x` apunta directo a `(ex-sx)/(ex-sx)`... es decir slope = Δy/Δx del objetivo).
4. Puntúa candidatos: `kill`=1000, `suicide`=-1000, y como respaldo proximidad a enemigos. Dispara el mejor.
5. Si el modo es `ode2`, usa `expr` = `y''` (p. ej. `-0.05` = gravedad) y ajusta `angle` inicial.

### Ejemplo real con curl

```bash
curl -X POST localhost:8787/api/rooms -d "{\"name\":\"IA\"}"           # -> {"code":"ABCD"}
curl -X POST localhost:8787/api/rooms/ABCD/join -d "{\"name\":\"Cline\"}"
curl localhost:8787/api/rooms/ABCD/state
curl -X POST localhost:8787/api/rooms/ABCD/fire -d "{\"playerId\":\"p1\",\"mode\":\"function\",\"expr\":\"0.3*x\"}"
```
