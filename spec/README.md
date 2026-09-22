# spec/ — Briefing para la sesión de Fable

> Escrito por Opus el 2026-09-22 al cerrar la entrevista de diseño. Lo lee **Fable** al abrir su
> sesión. El usuario: **"No quiero fallos, este proyecto es importante para mí."** y **"hay que
> ahorrar tokens"**.

## 0. Prompt para pegar al abrir la sesión
```
Eres Fable y vas a construir la parte crítica del laboratorio de redes neuronales de E:\grafwar.
Lee entero E:\grafwar\spec\README.md y síguelo al pie de la letra; empieza por la Sesión 1.
Pregúntame con AskUserQuestion todo lo que no esté decidido y antes de simplificar cualquier cosa.
No uses subagentes. No quiero fallos: este proyecto es importante para mí.
```

## 1. Tu papel
- **Fable hace TODO lo crítico, de F1 a F7**:
  - la **spec técnica completa**, incluidos los **contratos compartidos** (formatos, API, eventos,
    lo que ve la interfaz), en esta carpeta, un fichero por área;
  - los **tests**;
  - el **código**.
- **Opus** (en otra sesión) hace solo lo no crítico (editor visual, vistas, redacción de frases,
  tutorial, plantillas, estilos), **en secuencia**: cada pieza de interfaz empieza cuando la pieza
  crítica que usa está terminada y congelada.
- **Sin subagentes** (ahorro de tokens), salvo que el usuario lo pida. Lee con cabeza: `grep` o
  `sed -n` antes que volcar ficheros enteros; lee entero solo lo que vayas a editar.

## 2. Qué leer primero (en este orden)
1. `plan2.md` **§0–§3**: goal literal y **todas las decisiones del usuario (rondas 1–11)**. Es la
   fuente de verdad. Leyenda: ✅ decidido por el usuario (**vinculante**) · 🧭 elegido por Opus
   porque el usuario lo delegó · 💡 propuesta de Opus (**no vinculante**: puedes proponer otra cosa,
   pero **preguntando al usuario**).
2. `plan2.md` **§7** (proceso), **§6** (investigación con fuentes: NERO, AlphaStar, Valve,
   Nemesis…) y §4 (borrador de diseño: son propuestas).
3. `plan.md` §4–§5: stack y flujo de turnos.
4. `AGENTS.md`: contrato público de la API y de `chooseShot`.
5. Código: `shared/` (parser, solver, constants), `server/rooms.js` (**entero**), `server/server.js`,
   `server/mapgen.js`, `agents/lib.js` + `registry.js`, `arena/selfplay.mjs`, `test/` (runner +
   5 specs).

## 3. Reglas innegociables
- **Sin dependencias nuevas** (Node ≥ 18 puro). **`npm test` siempre en verde.**
- **No romper el contrato `chooseShot`** (solo extenderlo). **`rooms.js:fire()` es el único punto de
  validación de disparos**, y también lo será del movimiento.
- **Preguntar antes de simplificar cualquier cosa** (AskUserQuestion, 2–4 opciones con la
  recomendada primero). Criterio del usuario: **máximas opciones en todos los ámbitos**, y **todo
  explicado en lenguaje natural preciso y con ejemplos**, para que "cualquiera pueda hacerlo".
- **Exacto y real**: cada frase que se muestre (voz, lección, diario, cronista) lleva referencias a
  los eventos registrados de los que sale; cada número y cada nombre de la frase debe estar en esos
  eventos. Nada inventado. Tiene que haber un test que lo compruebe.
- **Tests antes del código, congelados y con mutantes** ("para no hacer los tests para que el código
  pase"). Cada pieza sigue este orden:
  1. spec aprobada por el usuario;
  2. tests en rojo (se ve el fallo);
  3. **commit propio de los tests** + huella SHA-256 en `test/FROZEN.json`, que `run-all` comprueba;
  4. código hasta verde;
  5. **prueba de mutantes**: fallos metidos a propósito que algún test debe cazar; los
     supervivientes se justifican por escrito;
  6. **un test congelado solo cambia con el OK del usuario y un motivo escrito**.
- **Referencias independientes del código**:
  - gradiente numérico frente a retropropagación, para cada bloque y para grafos aleatorios;
  - tareas de resultado conocido: tragaperras para REINFORCE, recordar un bit N turnos para la
    memoria y BPTT, una función sencilla para la evolución;
  - propiedades: miles de mutaciones aleatorias siempre dan una red válida; guardar y cargar da lo
    mismo; misma semilla, misma partida;
  - escenas fijas del motor.
- **Verificado en vivo antes de dar nada por hecho.** Commit solo en verde. Si algo falla, dilo con
  su salida. La **prueba visual la hace el usuario**: entrega al final una lista "en qué fijarte"
  (3–6 puntos: dónde mirar, qué debería verse, qué sería un fallo). Pruebas mínimas sin navegador,
  sí.
- **Sin puerta de aprendizaje** (decisión del usuario): F4 se cierra con los tests matemáticos y de
  tareas conocidas en verde.
- Fuera de alcance por ahora: **RWKV / VectorMind** (ni como voz ni en el RL) y cualquier LLM.

## 4. Qué es crítico (todo tuyo)
Núcleo de la red · aprendizaje · genoma y mutación · reglas del motor · **percepción** (observación,
candidatos, 🔮 Simulador) · **atribución y números de confianza y emoción** · **trono, dinastías y
liga** · **validación de redes recibidas** (límites de tamaño y forma; nada puede colgar el
servidor) · regresión (la suite actual).

## 5. Plan de trabajo

### Sesión 1 — contratos, herramientas y experimento
1. **Contratos compartidos** en `spec/00-arquitectura.md` … `spec/08-interfaz.md`
   (00 arquitectura · 01 motor · 02 red · 03 percepción · 04 aprendizaje · 05 evolución · 06 trono ·
   07 verdad · 08 interfaz). Tienen que ser exactos:
   - formato JSON del genoma y catálogo de bloques con sus parámetros y formas;
   - disposición de la observación de cada ojo;
   - rasgos de cada candidato de disparo y de movimiento;
   - salidas de la red;
   - `move` en `fire` y en la API;
   - esquema del registro de eventos;
   - nuevos eventos SSE y endpoints REST del laboratorio (redes, entreno, duelos, trono, dinastías,
     boletín…);
   - estructura de `evo/`, límites y todo lo que la interfaz tiene que poder pedir y ver.
2. **Herramientas de proceso**, cada una con sus propios tests: congelado (`test/FROZEN.json` +
   comprobación en `run-all`) y mutantes (`tools/mutants.mjs`, sin dependencias).
3. **Experimento desechable y barato**, decidido por el usuario "si los experimentos no son caros":
   - en `experimentos/` (ya está en `.gitignore`), pocos scripts Node y tiempo acotado;
   - mide cómo aprende una red en este juego: qué necesita ver, escala de la recompensa, tasa de
     aprendizaje, varianza, velocidad en turbo;
   - los números y conclusiones van a `spec/03` y `spec/04` y **el código se borra**;
   - si se encarece, **para y pregunta**.
4. **Presenta los contratos al usuario** y resuelve sus dudas antes de escribir ningún test.

### Fases F1 → F7 (cada una: spec de la fase → OK del usuario → tests en rojo → congelar → código → verde → mutantes → verificación en vivo → commit)
| Fase | Contenido (decisiones en `plan2.md` §3) | Desbloquea para Opus |
|---|---|---|
| **F1 Motor** | Movimiento tras disparar: 2u, deslizar al punto válido más cercano, sin entrar en obstáculos, sin salir del plano, sin apilarse. `move` opcional en `chooseShot` y en `fire`. Humanos: clic tras disparar con margen de tiempo (el servidor valida). Heurísticos con esquiva básica. **Partidas sin pantalla** (la sala en proceso, sin temporizadores) y **mapas con semilla**, sin cambiar la experiencia en vivo. `AGENTS.md` actualizado. | Clic tras disparar y dibujo del destino |
| **F2 Red** | Genoma + validación + límites · catálogo completo: capa densa (relu, tanh, sigmoide, leaky, gelu, seno, lineal), uniones (juntar/sumar/multiplicar), atajos, normalización, atención, Eco, GRU, LSTM, memoria de equipo · cálculo hacia delante y hacia atrás sobre el grafo de cables, con BPTT. | Editor de cables (sobre el catálogo) |
| **F3 Percepción** | Los 8 ojos (Mapa, Rasgos, 🔮 Simulador, obstáculos, Historial, Radar, Reloj, Compañeros) · 🎲 Imaginación (familias de candidatos) · destinos de movimiento · política compartida por soldado (1–4) · salidas Elegir / Ajustar / Moverse · la red juega como agente en una sala. | Overlay de candidatos (tenues, y la elegida brillante), cerebro en vivo |
| **F4 Aprendizaje** | Gradiente (REINFORCE + baseline + BPTT) · evolución · ambos (lo eliges por red) · recompensa normalizada editable + etiqueta + hitos + bofetada/caricia · **toda partida es experiencia** (x1 / x10 / turbo con `worker_threads`) · duración por partidas, por tiempo o hasta que deje de mejorar · sueño entre partidas · exhibición contra heurísticos con interruptor (apagado por defecto). | Curvas, panel de entreno |
| **F5 Evolución** | Mutación de pesos y estructura (siempre válida) · N hijos + pre-torneo · rasgos heredables (carácter, temperatura, espíritu de equipo) · cirugía (congelar, trasplantar, pesos a mano) · Imaginación que evoluciona · exportar/importar validado. | Vista de hijos, diferencias padre→hijo |
| **F6 Trono** | Duelo 3 mapas × 2 lados, con 1–4 soldados sorteados por partida · aprendizaje en el duelo (congelado / en caliente / mix, se elige por duelo) · ranking por victoria + diferencia de kills · **dos dinastías** · liga: sala de la fama sorteada según contra quién aún pierde, partidas fantasma, retadora explotadora · genealogía. | Árbol genealógico, trono, dinastías |
| **F7 Verdad** | Registro de eventos · atribución por "tapar y comparar" · confianza (certeza × experiencia) · emociones calculadas del RL · memoria de rivales · neuronas con nombre · boletín de habilidades (exámenes con semilla) · lección del sueño · **trazabilidad "exacto y real"**. | Voz (frases), diario, cronista, moviola |

## 6. Estado del repo al entregar (2026-09-22)
- **git** local (sin remoto): `0082bd5` base · `af67185` arreglo del cliente (`client.spec` entra
  en la batería) · `98eb428` test F0 en rojo · `93c4d44` **F0 selector de tropas** (Opus). Suite
  **5/5 en verde**.
- **F0**: el selector lista lo que devuelva `/api/agents`. Si las redes se exponen ahí (define tú
  cómo), aparecerán solas en el selector.
- Motor medido: **~6 ms por decisión** (42 candidatos, barrido grueso) → unas 5 partidas por segundo
  y núcleo.
- `referencia/` (Graphwar original en Java, GPL-3) está ignorado en git: consúltalo, no lo toques.
- `.gitattributes` fija LF para que las huellas SHA-256 sean estables en Windows.

## 6b. Estado tras la sesión 1 de Fable (2026-09-22)
- Contratos `spec/00`–`08` aprobados; `spec/mutantes.md` con los supervivientes justificados.
- Hecho y commiteado: herramientas (freeze, mutants), **F1** motor, **F2** red, **F3** percepción y
  política, API del laboratorio para catálogo/plantillas/redes (`/api/lab`). Batería: 18 specs,
  17 congelados (`test/FROZEN.json`).
- Desbloqueado para Opus: clic tras disparar y destino (F1), editor de cables sobre el catálogo
  (`GET /api/lab/catalog`, `validate`, CRUD de redes, plantillas), overlay de candidatos y cerebro en
  vivo (evento SSE `decision`, `state.lastDecision`), selector de tropas con redes (`net:<id>`).
- **F4 aprendizaje** hecho (reward.js, evo/train.js, evo/worker.js, eventos de sala, /api/lab/trainings, SSE
  /api/lab/events, sala x10). Desbloqueado para Opus: curvas y panel de entreno (spec/04 §9.6).
- Siguiente: F5 evolución.

## 7. Cierre de cada sesión
1. Actualiza `plan2.md` (estado de la fase) y `plan.md` §4 si cambia el stack.
2. Commit en verde.
3. Resumen al usuario: qué quedó hecho y verificado, qué no, mutantes supervivientes justificados y
   la lista **"en qué fijarte"**.
4. Indica qué pieza de interfaz queda desbloqueada para Opus.
