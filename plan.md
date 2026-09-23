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
│   ├── constants.js PLANO -25..25/-15..15, TURN_TIME 60s (15s FAST), STALL 8 / MAX 90,
│   │                SOLDIERS_PER_PLAYER 2, MAX_PLAYERS 8, TEAMS, MODES; F1: MOVE_RADIUS 2,
│   │                BODY 0.5, MIN_SEPARATION 1, MOVE_TIME 8s (0.4s FAST), rejilla polar
│   ├── rng.js       F1: makeRng(seed) (mulberry32) → rng() con .int/.pick/.gauss/.seed
│   └── geometry.js  F1: slideMove() — validez del destino (5 reglas) y deslizamiento al
│                    punto válido más cercano (spec/01 §3)
├── server/
│   ├── server.js    HTTP estático + REST + SSE, sin librerías. POST /api/rooms
│   │                acepta {name, soldiers} (1..4 por jugador, como el original)
│   ├── rooms.js     Room: lobby→playing→over; turnos intercalados L/R con
│   │                **inicio aleatorio**; memoria history anti-repetición;
│   │                anti-estancamiento (renueva mapa a los 8 sin bajas, empate a 90);
│   │                chat con {t, text, playerId?, soldierId?, kind: say|think};
│   │                say() → bocadillo; banter intro al empezar + burla al matar;
│   │                **habla-antes-de-disparar** (sayTimer 1300ms/400ms FAST);
│   │                snapshot() completo para agentes y cliente. F1: etapa `move` del
│   │                turno (fire.move | POST /move | chooseMove | vencimiento), Room.move()
│   │                único validador, seed + rng en todo, headless (step()/play())
│   ├── headless.js  F1: playGame({seed,left,right,soldiers}) sin pantalla → result, chat…
│   └── mapgen.js    3 biomas con nombre: 🏰 Fortaleza (muro central alto: mata
│                    rectas, premia parábolas), 🌵 Llanura (abierta, de Sniper),
│                    🏚️ Ruinas (dispersa). placeSide() aguanta N soldados. genMap(n, rng)
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
├── shared/ (lab)    F2: genome.js (genoma JSON, catálogo BLOCKS, validate/normalize/repair,
│                    pesos Xavier con semilla) · nn.js (compile → forward/backward con BPTT) ·
│                    templates.js (4 plantillas). F3: percept.js (ojos, Imaginación, destinos) ·
│                    policy.js (decideShot/decideMove con registro de decisión). F4: reward.js
├── evo/             F3: store.js (evo/nets/<id>.json o GW_EVO_DIR, escritura atómica, throne.json)
│   ├── api.js       /api/lab: catálogo, plantillas, redes CRUD/validar/exportar/importar, entrenos,
│   │                trabajos (jobs), hijos + pre-torneo, diff, cirugía (frozen/weights/transplant), SSE
│   ├── train.js     F4: gradiente de política (REINFORCE + Corazonada + BPTT), Adam/SGD, evolución
│   │                antitética, learnFromGames, createTrainer (turbo con hilos / x1 / x10 en salas)
│   ├── worker.js    F4: hilo que juega partidas sin pantalla
│   ├── labels.js    F5: etiquetas de posiciones ("ojo:k", "bloque#u") para recolocar y comparar pesos
│   ├── mutate.js    F5: mutate() con 12 ops siempre válidas (deshace y anota), nombres 🧭,
│   │                adaptImagination (🎲 por uso)
│   ├── diff.js      F5: diffGenomes (same/changed/added/removed, relChange, heat ≤ 64)
│   ├── children.js  F5: pre-torneo justo (mismas semillas/soldados, lados alternos) y ranking
│   ├── league.js    F6: throne.json, liga (pares, winrate), pickOpponent (AlphaStar, f_hard, fantasma), genealogía
│   ├── duel.js      F6: 3 mapas × 2 lados con hash32, ranking, modos frozen/hot/mix, partidas guardadas
│   ├── throne.js    F6: reto al trono, sala de la fama (copia congelada), dinastías y generaciones
│   ├── truth.js     F7: checkPhrase/compose (nada inventado), confianza, emoción, memoria, neuronas con nombre, diario
│   ├── voice.js     Arreglos (Opus): voz de las redes por carácter y confianza; cada frase compuesta con compose y
│   │                verificada por la sala (sayVerified) antes de decirse (spec/07 §13.2)
│   └── exam.js      F7: boletín de habilidades determinista (puntería, cobertura, supervivencia, adaptación)
├── agents/net.js    F3: agente-red (net:<id>), memoria por soldado, trayectorias para aprender
├── test/            run-all.mjs (comprueba FROZEN.json y levanta servidor 8791 → TODO OK ✔)
│                    parser.spec / smoke / agents.spec / client.spec / troops.spec (F0) /
│                    tools.spec (freeze+mutants) / motor.spec, geometry, rng, moves, rooms (F1) /
│                    red, genoma, api-lab (F2) / percepcion(+extra), politica (F3) / aprendizaje(+extra),
│                    entrenador-extra(-b), api-trainings (F4) / evolucion, api-evolucion (F5) / trono, api-trono (F6) / verdad, api-verdad (F7).
│                    FROZEN.json = huellas SHA-256
├── tools/           freeze.mjs (congela tests) · mutants.mjs (prueba de mutantes) ·
│                    launch-selfplay.mjs · room-debug.mjs
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
