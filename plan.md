# plan.md — Graphwar Agents: MAD + movimiento + RL visual

## 1. Goal del usuario (literal)
1. Botón self-play con **selector de tropas por equipo** (elegir qué agentes pelean); **posiciones siempre aleatorias**, el usuario no las toca.
2. Los soldados **se mueven después de disparar**; destino lo elige el agente; **2u tácticas**; si el destino es inválido **desliza** al punto válido más cercano.
3. Juego de **RL real con red neuronal visual**: el usuario **crea la base como quiera** en un constructor por **cables creativo pero entendible por cualquiera**; red **recurrente real** (memoria entre turnos); ver cómo evoluciona.
4. **Red vs red 1v1 de redes creadas por el usuario; la ganadora se queda de reina** contra la siguiente que haga; de la reina salen **hijos mutados que se retocan a mano** antes de pelear.
5. Divertido pero útil y real. Todo verificado en vivo.

## 2. Decisiones del usuario (todas las rondas)
- Movimiento: lo elige el agente · 2u · desliza si inválido.
- RL: base totalmente definida por el usuario, evolución visible, nada de caja negra.
- Entradas **híbridas**: features compactas + snapshot de posiciones + resumen de obstáculos (bloques en el editor).
- Salidas **híbridas**: el motor genera N candidatos, la red los puntúa **y ajusta** pendiente/curva/ángulo/movimiento.
- Red **adaptativa a X soldados**: política compartida aplicada por soldado (observación local + contexto global); vale para 1, 2 o 4 por bando.
- Transparencia: **todos los candidatos tenues en overlay, la elegida fuerte y brillante** + panel lateral con scores y razonamiento.
- Combates: reina-vs-retadora (king of the hill); ranking por **victoria + diferencia de kills**.
- Rivales de entreno: solo sus propias redes entre sí (no contra heurísticos, no población anónima).

## 3. Fases
- **F0**: escribir este `plan.md` + selector de tropas en UI (2 desplegables izq/der + nº soldados; posiciones intactas).
- **F1**: movimiento post-disparo en el motor (`move` validado: 2u, desliza, sin entrar obstáculos/salir del plano/apilar); `chooseShot` admite `move` opcional (compatible hacia atrás); heurísticos con esquiva básica; bocadillo muestra destino.
- **F2**: `arena/evo.mjs` headless (reset/step sobre el mismo `shared/`, rapidísimo con `GW_FAST`); política compartida por soldado; observaciones híbridas; overlay de candidatos en canvas.
- **F3**: editor visual por cables (`public/evo.html`): bloques de entrada, capas densas, celda recurrente, salidas; guardar/cargar/duplicar redes en `evo/nets/*.json`.
- **F4**: trono reina-vs-retadora (tabla, historial), botón "proponer hijos mutados" + retoque manual, curva de victorias.
- **F5**: torneo final + sala en vivo red-vs-red con overlay completo + `Ctrl+F5`.

## 4. STACK — todo lo construido (estado actual verificado)
Cero dependencias, solo Node ≥ 18. Servidor prod en `:8787` (ver `.server.pid`); tests en `:8791` (`GW_FAST=1`); arena fast en `:8790`.

```
E:\grafwar
├── shared/          Lógica pura, sin I/O (la usan servidor, agentes y tests)
│   ├── parser.js    Expresiones estilo Graphwar: x,y,y',y'', *,/,^,(), 2x implícito,
│   │                sin cos tan sqrt ln log abs exp atan → tryCompile() devuelve f
│   ├── solver.js    Trazado RK4 en 3 modos (function traslada +c por el soldado;
│   │                ode1 condición inicial; ode2 + ángulo -85..85) + colisiones
│   │                (HIT_RADIUS 0.7, obstáculos con margen, bordes, verticalidad)
│   └── constants.js PLANO -25..25/-15..15, TURN_TIME 60s (15s FAST), STALL 8 / MAX 90,
│                    SOLDIERS_PER_PLAYER 2, MAX_PLAYERS 8, TEAMS, MODES
├── server/
│   ├── server.js    HTTP estático + REST + SSE, sin librerías. POST /api/rooms
│   │                acepta {name, soldiers} (1..4 por jugador, como el original)
│   ├── rooms.js     Room: lobby→playing→over; turnos intercalados L/R con
│   │                **inicio aleatorio**; memoria history anti-repetición;
│   │                anti-estancamiento (renueva mapa a los 8 sin bajas, empate a 90);
│   │                chat con {t, text, playerId?, soldierId?, kind: say|think};
│   │                say() → bocadillo; banter intro al empezar + burla al matar;
│   │                **habla-antes-de-disparar** (sayTimer 1300ms/400ms FAST);
│   │                snapshot() completo para agentes y cliente
│   └── mapgen.js    3 biomas con nombre: 🏰 Fortaleza (muro central alto: mata
│                    rectas, premia parábolas), 🌵 Llanura (abierta, de Sniper),
│                    🏚️ Ruinas (dispersa). placeSide() aguanta N soldados
├── agents/          Interfaz: create({level,temperature}).chooseShot(
│   │                {soldiers,obstacles,soldier,history,chat,temperature,state})
│   │                → {mode, expr, angle?, reason?, say?} (say/reason opcionales)
│   ├── lib.js       contextFor/sim/scoreShot/search/best/directShots/
│   │                randomTemplates/avoidRepeats/describeShot (razón táctica ES)/
│   │                withVoice (say ~60%, chaos 80%)/
│   │                pickWeighted (top3 ponderado por nivel: L3 80/12/8)/
│   │                gauss/addMissNoise (error de ejecución σ por nivel)/
│   │                searchShot (para CLI/autopilot)
│   ├── sniper.js    Rectas exactas + arcos finos, voz fría, temp 0.1
│   ├── greedy.js    Rectas + plantillas mixtas, voz chula, temp 0.4
│   ├── artillery.js Solo parábolas y''=-g con doble búsqueda ángulo/gravedad,
│   │                voz dramática, temp 0.6
│   ├── chaos.js     Funciones salvajes, voz desquiciada, temp 0.9
│   └── registry.js  MODULES + agentMeta/listAgents/createAgent (añadir agente =
│                    1 fichero + 1 línea; banter lives in meta.banter)
├── agent/
│   ├── agent.mjs    CLI personal: create/join/state/fire/chat/autopilot
│   └── remote.mjs   Jugador remoto genérico: --brain heuristic | http
│                    (--brain-url). Contrato HTTP: POST {you,soldier,soldiers,
│                    enemies,obstacles,history,chat,temperature} → {mode,expr,
│                    angle?,say?}; publica say ANTES de disparar; fallback
│                    heurístico si el cerebro falla. Aquí se enchufa un RWKV
│                    local o se juega por API.
├── arena/
│   ├── selfplay.mjs Round-robin --agents --games --soldiers --spawn-fast
│   │                --log + tabla (último 4v4: 2-2-1-1, kills 10-10-10-9)
│   └── pairings.mjs
├── public/
│   ├── index.html   Panel join (nombre, Crear+soldiersPick 2/3/4, código,
│   │                👀, 🤖 self-play) + vista game (header/HUD, aside equipos y
│   │                funciones, canvas+toast, aside registro+chat, footer modos)
│   ├── js/app.js    REST+SSE (hello/state/shot/chat/gameover), lobby,
│   │                spectate, self-play con **parejas rotatorias** y temps,
│   │                renderChat/setBubbles (kind say → bocadillo 5s sobre el
│   │                soldado vía soldierId), requireSession (anti-null-code)
│   ├── js/render.js Canvas auto-reparado (fit tras display:none + re-encaje si
│   │                cambia layout), w2s, rejilla+ejes, obstáculos, soldados con
│   │                anillo de turno, nombres, **bocadillos**, estelas glow,
│   │                partículas, shake, estrellas
│   └── css/style.css Tema neón oscuro
├── tools/
│   ├── launch-selfplay.mjs Crea sala 4v4 con pareja aleatoria, start y abre el
│   │                        navegador (lo que ejecuta Graphwar.bat)
│   └── room-debug.mjs
├── test/            run-all.mjs (servidor propio 8791 + 3 specs → TODO OK ✔)
│                    parser.spec / smoke (agente vs CPU) / agents.spec (self-play)
├── Graphwar.bat     Doble clic: servidor si hace falta + partida IA vs IA +
│                    navegador. Cero terminal.
├── package.json     start / selfplay(:fast) / test(:parser,:agents) / spectate
├── AGENTS.md        Guía para IAs que quieran jugar (API + estrategia)
└── referencia/graphwar/ Original Java (catabriga/graphwar, GPL-3, solo lectura):
                     plano 50×30, f(x)+c trasladada, EDO con RK4, IA evolutiva
                     falible (50 funciones + mutaciones, nivel=generaciones),
                     máx 10 jugadores / 4 soldados por jugador, radio ~0.5u
```

## 5. Cómo funciona la app (para seguir con Claude)
- **Flujo turno**: `nextTurn()` elige jugador/soldado → broadcast `state` → si es bot, `agentTurn()` calcula `choice` → si hay `say`, `say()` (broadcast `chat` → bocadillo) y `fire()` 1300ms después → `simulateShot` → `log()` resultado (+burla si kill) → broadcast `shot` {points, shooterTeam} → tras animación, `nextTurn()`. Timeout de turno → salta.
- **Cliente**: `onState` pinta HUD/equipos/funciones/registro; `render.js:frame()` dibuja mundo + bocadillos + animación del `shot` (retrasada 1200ms si hubo `say` fresca); `startShot` viene por SSE.
- **Añadir agente**: `agents/X.js` con `meta{id,name,icon,description,banter{intro[],kill[]}}` + `create().chooseShot()`; 1 línea en `registry.js MODULES`.
- **Balance actual**: Sniper/Greedy falibles (pickWeighted + missNoise σ por nivel), radio 0.7, biomas, inicio aleatorio. Torneo 4v4 medido: sin dominador.
- **Puntos de enganche RL**: `chooseShot` ya recibe todo y admite campos extra; `sim()`/`search()` reutilizables para generar los N candidatos; `rooms.js:fire()` punto único de validación (aquí se validará `move`); `snapshot()`/`chat` alimentan la observación; `arena/` es la base de `evo.mjs`.
- **Comandos**: `npm start` (prod 8787) · `Graphwar.bat` (doble clic) · `npm test` · `node agent/remote.mjs --room X --name Y --brain http --brain-url URL` (cerebro externo) · `node arena/selfplay.mjs --agents a,b --games N --soldiers 4 --spawn-fast`.
