# Graphwar Agents ⚔️

Remake web moderno y **modular** de [Graphwar](https://www.graphwar.com/) (original de Lucas Catabriga, GPL-3): artillería donde **disparas escribiendo funciones matemáticas**. Añade multijugador web, **agentes IA enchufables** (que pueden jugar solos, unos contra otros, o contra ti) y mejoras visuales (tema neón, trayectorias con glow, partículas, shake).

**Sin dependencias externas** — solo Node.js ≥ 18.

## Cómo jugar

```bash
npm start          # servidor en http://localhost:8787
```

Abre `http://localhost:8787`:

- **Crear sala** → añade **+ CPU** → **¡Empezar!**
- **👀** = espectar una sala por código · **🤖 Ver IA vs IA** = crea y mira una partida de agentes en vivo.
- En tu turno escribe la función y dispara:
  - `y = 0.5*x` → la curva se traslada para pasar por tu soldado
  - `y' = -y/3` → EDO de 1er orden (tu posición es la condición inicial)
  - `y'' = -0.05` → 2º orden: el **ángulo** también importa (parábolas)

**Sintaxis:** variables `x y y' y''`; constantes `e pi`; operadores `+ - * / ^` (multiplicación implícita: `2x`, `3(x+1)`); funciones `sqrt ln log abs sin cos tan exp atan`.

**Reglas (fieles al original):** plano x∈[-25,25], y∈[-15,15], 60 s por turno, 2 soldados por jugador, explosión al salir del plano / tocar obstáculo / valor inválido (`sqrt(x)` con x<0) / pendiente vertical / trayectoria demasiado larga; matar a un aliado = mueres tú. Anti-estancamiento: si nadie muere en 8 disparos se renueva el mapa, y a los 90 disparos se decide por bajas (empate técnico si no hay diferencia).

## Arquitectura modular

```
shared/    MÓDULO MOTOR (agnóstico del transporte)
           constants.js · parser.js (AST→f(x,y,y',y'')) · solver.js (RK4 + colisiones)
agents/    MÓDULO AGENTES (interfaz uniforme: create({level}).chooseShot(ctx))
           lib.js (simulación/puntuación compartida) · registry.js (plug-in)
           sniper.js · greedy.js · artillery.js · chaos.js
server/    TRANSPORTE + REGLAS: server.js (HTTP+SSE, API) · rooms.js (turnos/reglas) · mapgen.js
public/    CLIENTE Canvas: index.html · css/style.css · js/app.js · js/render.js
agent/     Agente REMOTO de ejemplo (CLI para LLMs): agent.mjs
arena/     Orquestación de self-play: selfplay.mjs · pairings.mjs
test/      parser.spec.mjs · smoke.mjs · agents.spec.mjs · run-all.mjs
tools/     room-debug.mjs (partida de agentes dentro del proceso, para depurar)
```

**Añadir un agente nuevo** = crear `agents/miagente.js` con `meta` y `create()` y añadirlo a `MODULES` en `registry.js`. Aparece automáticamente en `GET /api/agents`, en la arena y en las salas.

**Sobre el stack:** se mantiene Node puro + SSE a propósito, porque (a) el motor es lógica pura sin I/O y portable (podría embeberse en un servidor Rust/Go o en el navegador), (b) los agentes solo necesitan HTTP/JSON, y (c) cero dependencias = arranca en cualquier sitio. Si más adelante quieres tiempo real con más jugadores, el único módulo a cambiar es `server/` (p. ej. WebSocket/Colyseus o `ws`), sin tocar `shared/` ni `agents/`.

## Agentes IA

```bash
node agent/agent.mjs help                       # lista de comandos
node agent/agent.mjs create --name "Sala Cline"
node agent/agent.mjs join --room ABCD --name Cline --session cline-a.json
node agent/agent.mjs state                      # tablero: turno, enemigos, obstáculos, historial
node agent/agent.mjs fire --expr "0.5*x" --mode function
node agent/agent.mjs autopilot                  # juega solo (busca la mejor función con el motor)
```

Detalle de la API REST en **[AGENTS.md](AGENTS.md)**.

## Self-play: agentes jugando solos (o tú contra ti mismo)

```bash
npm run selfplay                    # humano/otro agente: usa el servidor de :8787
npm run selfplay:fast               # torneo de 6 partidas con 4 agentes, servidor propio en :8790
node arena/selfplay.mjs --agents sniper,greedy --games 4 --spawn-fast
node arena/selfplay.mjs --agents sniper,artillery --games 4 --spawn-fast --log arena/run.log
```

Imprime tabla de posiciones (victorias, kills, supervivientes) y muestra el enlace `http://localhost:8790/#room=CODE` para **ver las partidas en el navegador**.

**Dos instancias de tu propio agente peleando** (yo contra mí mismo):

```bash
node agent/agent.mjs create --name "Cline vs Cline" --session a.json
node agent/agent.mjs join --room ABCD --name Cline-A --team left  --session a.json
node agent/agent.mjs join --room ABCD --name Cline-B --team right --session b.json
curl -X POST localhost:8787/api/rooms/ABCD/start -d "{\"playerId\":\"p1\"}"
node agent/agent.mjs autopilot --session a.json &
node agent/agent.mjs autopilot --session b.json &
```

## Tests

```bash
npm test                           # batería completa (levanta su propio servidor rápido)
npm run test:parser                # parser + solver (regresión del bug de NaN)
npm run test:agents                # self-play de agentes contra un servidor en marcha
```

## Licencias y créditos

Mecánica inspirada en [catabriga/graphwar](https://github.com/catabriga/graphwar) (GPL-3). Reimplementación desde cero, sin código del original; se distribuye igualmente bajo **GPL-3.0-or-later**.
