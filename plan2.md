# plan2.md — Laboratorio de redes: diseño acordado (en curso)

> Continúa `plan.md` (stack, estado verificado, fases F0–F5). Aquí va **todo lo hablado** en la
> entrevista de diseño del 2026-09-22. Estado: **preguntas en curso** → luego diseño aprobado → código.
> Leyenda: ✅ decidido por el usuario · 🧭 elegido por Claude porque el usuario lo delegó ("elige tú") ·
> 💡 propuesta de Claude pendiente de aprobar.

## 0. Goal del usuario (literal, 2ª versión)
> Quiero poder elegir yo qué tipo de tropa pongo, pero la posición no. Quiero que se muevan después de
> disparar. Quiero que sea un juego de RL pudiendo de forma visual crear la red neuronal. Quiero algo
> divertido pero útil y real. Quiero realmente poder crear la base como yo quiera y ver como evoluciona.
> Es contra otra red, esa es la gracia de que sea evolutivo, no quiero que lo simplifiques. Lo mejor
> haría un híbrido de todo. Lo híbrido pero viendo los candidatos: genera N y la red emite pendiente y
> demás, pero vemos las opciones/razonamiento. Son 1 vs 1 de dos redes que he creado y la ganadora
> contra la siguiente que yo haga. Hijos mutados + retoques. Depende: tiene que ser adaptativo y saber
> que tiene X número de personajes. Todos lo dibujan en el overlay pero la definitiva se ve mucho más.
> Quiero algo creativo y único, pero por cables lo veo bien, o ambas; quiero algo que entienda
> cualquiera y pueda crear algo verosímil y único.

**Reglas de ejecución (usuario):** por fases F0→F5 · verificado en vivo antes de dar nada por hecho ·
sin dependencias nuevas · `npm test` siempre en verde · **preguntar antes de simplificar cualquier cosa**.
**Restricciones técnicas:** no romper el contrato `chooseShot` (solo extenderlo) · `rooms.js:fire()` es
el único punto de validación de disparos.

## 1. Criterios transversales (valen para TODO) ✅
1. **Máximas opciones en todos los ámbitos** — "cuantas más posibilidades y más completo, muchísimo
   mejor". Ante la duda, más opciones, nunca menos (y preguntar antes de recortar).
2. **Lo entiende cualquiera** — todo se explica en **lenguaje natural, muy preciso y con ejemplos**:
   cada bloque, cable, deslizador, modo de aprendizaje, mutación y resultado.
3. **Real, no teatro** — lo que se ve (confianza, razonamiento, evolución) sale de números reales del
   motor y de la red.
4. **Antagonismo** — "la gracia era hacer dos redes diferentes antagonistas": la red siempre pelea
   contra otra red tuya.

## 2. Estado de partida (verificado 2026-09-22)
- **Actualización (fin de sesión Opus, 2026-09-22):** **F0 hecho** (commit `93c4d44`): selector de
  tropas por bando (o Aleatorio) + 1–4 soldados; test congelado antes del código (11/11); mutantes
  9/10 (el superviviente es un recorte redundante); probado en vivo. Arreglado `client.spec`, que
  estaba en rojo y fuera de la batería (`af67185`). Suite **5/5**. **Sesión 1 de Fable (2026-09-22): experimento hecho, contratos `spec/00`–`08`
  aprobados; herramientas `tools/freeze.mjs` + `tools/mutants.mjs` (test propio, 7 tests congelados en
  `test/FROZEN.json`); F1 motor (movimiento, semilla, sin pantalla, ángulo y'') con `test/motor.spec.mjs`
  congelado antes del código. **F2 red** (genome.js, nn.js, templates.js) y **F3 percepción**
  (percept.js, policy.js, evo/store.js, agents/net.js, sala con shotLog/decision) hechos, más la API
  del laboratorio para redes/catálogo (evo/api.js). **F4 aprendizaje** hecho: reward.js (términos a la
  decisión exacta, normalización NERO, retornos), evo/train.js (REINFORCE+baseline+BPTT verificado
  contra derivada numérica, Adam/SGD, evolución antitética, learnFromGames, entrenador turbo con hilos
  y x1/x10 en salas vivas, hitos, meseta), evo/worker.js, eventos de sala, /api/lab/trainings + SSE.
  Tareas de resultado conocido en verde (tragaperras, recordar un bit, evolución, Corazonada).
  Batería 20 specs (19 congelados). Siguiente: F5 evolución (mutate.js).**
- F0 **a medias**: `plan.md` escrito; **falta** el selector de tropas en la UI. *(superado: ver
  arriba)*
- F1–F5 sin empezar: no hay `move` en `rooms.js`, no existe `evo/`.
- Coste medido del motor: **~6 ms por decisión** con 42 candidatos (barrido grueso) → ~0.2 s por
  partida → **~5 partidas/s por núcleo**. Da para entrenar de verdad; con hilos, más.

## 3. Decisiones por ronda

### Ronda 1 — cerebro ✅
| Tema | Decisión |
|---|---|
| Cómo aprende | **Lo eliges por red**: gradiente (RL), evolución o ambos, con un bloque *Aprendizaje*. Todo explicado en lenguaje natural preciso con ejemplos. |
| ¿Ve la simulación? | **Bloque opcional 🔮 Simulador**: si lo conectas, cada candidato llega con su predicción (¿mata?, distancia al enemigo, choque, suicidio); si no, solo geometría. Permite red "vidente" vs "ciega". |
| Duelo | **3 mapas × 2 lados = 6 partidas**; gana quien sume más victorias; empate → diferencia de kills. |
| Soldados | **Varía 1–4 en cada partida** del duelo (igual en ambos bandos): obliga a la adaptabilidad real. |

### Ronda 2 — recompensa y descendencia ✅
| Tema | Decisión |
|---|---|
| Recompensa | **Bloque Recompensa editable**. Por defecto: matar +1 · morir −1 · dar a un aliado −1.5 · rozar a un enemigo +0.1 · ganar la partida +2. Cada deslizador explica qué personalidad provoca (p. ej. premiar sobrevivir → red cobarde que se esconde tras los muros). Sirve de señal al gradiente y de fitness a la evolución. |
| Mutación | **Pesos + estructura** (añadir/quitar neuronas, cables, capas; cambiar activación), cada tipo con interruptor e intensidad; cada hijo cuenta en lenguaje natural qué cambió. |
| Hijos | **N hijos (4 por defecto, configurable) + pre-torneo** rápido sin pantalla contra la reina → ordenados → eliges uno → lo retocas → reta a la reina en vivo. |
| Movimiento de la red | **Candidatos + ajuste** (como el disparo): ~9 destinos (8 direcciones a 2u + quedarse, ya deslizados a válidos) con rasgos (cobertura, distancia a enemigos, ¿a tiro en recta?); la red puntúa y ajusta. Overlay: destinos tenues, elegido brillante. |

### Ronda 3 — aspecto y explicación ✅
| Tema | Decisión |
|---|---|
| Editor | **Cables con cuerpo**: 👁 Ojos (entradas) · 🧠 Instinto (capas) · 🌀 Memoria (recurrente) · ✋ Manos / 🦶 Pies (salidas). Los nervios **laten con la señal real** (brillo = fuerza). Cada red tiene **emblema único generado de su genoma** y nombre (p. ej. "Hydra-7"). |
| Memoria | **Los 4 bloques**: Eco (RNN simple) · GRU · LSTM · **Memoria de equipo** (compartida, promedia la de los vivos → vale para 1–4). |
| Vistas de evolución | **Las 4**: árbol genealógico (corona en la reina, emblemas, récord) · curvas (reinados + aprendizaje) · diferencias padre→hijo (mapa de calor + frase) · cerebro en vivo junto a la partida. |
| Razonamiento | **Atribución real + frase**, y además **las redes van ganando confianza y hablando más** con el tiempo. La frase corta sale en el bocadillo. |

### Ronda 4 — rival, voz, entreno, arranque
| Tema | Decisión |
|---|---|
| Rival de entreno | ✅ Mezcla configurable con deslizadores explicados. 🧭 Reparto por defecto (el usuario delegó): **60% antagonista** (la red a la que se enfrenta: reina o retadora) · **25% sala de la fama** (ex-reinas, evita olvidar estilos antiguos: ciclo piedra-papel-tijera) · **15% contra sí misma** (estabilidad). Nunca heurísticos. |
| Voz / confianza | ✅ Las 4 fuentes: **certeza de la decisión** (margen real entre la elegida y la 2ª) · **experiencia e historial** (partidas, reinados, acierto reciente) · **carácter heredable** en el genoma (frío, chulo, dramático, desquiciado; se hereda y muta) · **réplica al rival** con hechos reales ("Dijiste #2 y fallaste por 0.4"). Además: **"lo más cercano a las asociaciones humanas y con cohesión"** (ver §4.8). |
| Entreno visible | ✅ **Toda partida es experiencia**: la red aprende de cualquier partida que juegue. La velocidad solo decide cuánto miras: **x1** (tiempo real, con bocadillos) · **x10** (modo entrenamiento visible) · **turbo** (sin pantalla, hilos paralelos, curvas en vivo + partidas de muestra). |
| Arranque | ✅ **Las 4 ayudas**: plantillas de ejemplo (Francotirador, Tortuga con memoria, Vidente, Vacía — cada una explica por qué está montada así) · tutorial guiado (primera red disparando en 2 min) · laboratorio "¿qué pasaría si…?" (escena congelada; mueves un deslizador/cable y ves cambiar la elección y la frase) · cables que se explican ("El Mapa es una imagen: pásalo por Instinto antes de las Manos"). **Y todo lo demás que sea útil de verdad.** |

### Ronda 5 — antagonismo, duelos, voz, extras ✅
| Tema | Decisión |
|---|---|
| Dinastías | **Trono + dos dinastías**: además del trono, fundas dos casas (p. ej. Casa Hydra vs Casa Orca) que coevolucionan una contra otra (cada generación entrena y pelea contra la mejor de la otra: carrera armamentística); la campeona de una casa puede retar al trono cuando quieras. |
| ¿Aprende en el duelo? | **Se elige por duelo, con las 3 opciones + un mix**: examen congelado + repaso después · aprende en caliente · **mix** (en caliente suave durante el duelo + repaso completo después). 🧭 Preseleccionado: mix. |
| Motor de voz | **Ahora: gramática asociativa propia** (hechos reales, sin LLM). **RWKV de VectorMind** (`E:\vectormind`) queda **para más adelante**: no entra en el alcance actual, ni como voz ni en el RL (corrección del usuario: "RWKV es solo para más adelante, no va ahora pa el RL"). Nunca un LLM local genérico (Ollama, etc.). |
| Extras | **Los 4**: boletín de habilidades (exámenes fijos con semilla → radar de puntería/cobertura/supervivencia/adaptación) · neuronas con nombre (detecta a qué reacciona cada neurona; renombrable) · moviola (repetición turno a turno con cerebro, candidatos y frase) · cirugía (congelar bloques; trasplantar un bloque de una red a otra). |
| Encargo | "**Investiga cómo hacerlo humano y divertido manteniendo la lógica de RL**" → §6. |

### Ronda 7 — ideas de la investigación y ojos extra ✅
| Tema | Decisión |
|---|---|
| Ideas de aprendizaje | **Las 4**: recompensa normalizada + etiqueta + hitos anti-olvido · liga estilo AlphaStar (sala de la fama sorteada según contra quién aún pierde, partidas fantasma, retadora explotadora) · bofetada/caricia · 🎲 Imaginación que evoluciona. Recordatorio del usuario: "**que cualquiera pueda hacerlo**". |
| Ideas de vida | **Las 4**: voz con reglas + memoria de rivales · emociones calculadas del RL · sueño + bombilla + lección · rasgos heredables (temperatura, espíritu de equipo). Recordatorio: "**lo más humano**". |
| Ojos extra | **Los 4**: Historial · Radar (bigotes) · Reloj · Compañeros. |
| Versiones | **git local** (sin remoto). Hecho: commit base `0082bd5` (suite en verde); `referencia/`, los PID, el token de sesión del CLI y `$null` quedan ignorados; `.gitattributes` fija LF para que las huellas SHA-256 de los tests congelados sean estables. |

### Ronda 8 — detalle, instinto, exhibiciones, duelos ✅
| Tema | Decisión |
|---|---|
| Capas de detalle | **3 niveles de vista**: **Aprendiz** (bloques con buenos valores por defecto, 2–3 deslizadores clave) · **Artesano** (más ajustes) · **Científico** (todo: tasa de aprendizaje, descuento, ruido de mutación…). Se cambia en cualquier momento; **nada se bloquea**, solo cambia cuánto ves. Cada ajuste lleva explicación con ejemplo. |
| 🧠 Instinto | Capa densa (activaciones: relu, tanh, sigmoide, leaky, gelu, seno, lineal) + **los 4**: Uniones (juntar/sumar/multiplicar) · Atajos (residual) · Normalización · **Atención** (se ve en quién se fijó; vale para cualquier número de candidatos, enemigos o aliados). |
| Exhibición contra heurísticos | **Interruptor "aprender de esta partida", apagado por defecto** (respeta "solo entrena contra tus redes"). El selector de tropas lista los heurísticos **y** tus redes. |
| Ver un duelo | **Eliges la velocidad** (x1 / x10 / turbo); en turbo, marcador al instante y cualquier partida se abre en la moviola. |

### Ronda 9 — humanos, extras, duración ✅
| Tema | Decisión |
|---|---|
| Humanos y movimiento | **Clic tras disparar**: aparece un círculo de 2u; clic en el destino (si no es válido, desliza) o "quedarme"; unos segundos de margen y, si no eliges, te quedas quieto. Los agentes externos por API envían `move` junto al disparo. |
| Más extras | **Los 4**: diario de la red · exportar/importar (validado: una red rota no rompe nada) · pesos a mano y congelar cables (nivel Científico) · cronista de temporadas (trono y dinastías). |
| **Exacto y real** | "Necesito que sea exacto y real" → **regla verificable**: cada frase (voz, lección, diario, cronista) lleva referencias a los eventos registrados de los que sale. Cada número y cada nombre que aparece en ella debe estar en esos eventos. Un test lo comprueba; nada se inventa. |
| Duración del entreno | **Las 3 formas**: por nº de partidas · por tiempo · "hasta que deje de mejorar" (se para si la curva no sube en X partidas). Siempre se puede parar a mano y se guarda lo aprendido. |

### Ronda 12 — sesión 1 de Fable (2026-09-22) ✅
| Tema | Decisión |
|---|---|
| Movimiento de agentes | **Las dos vías**: `move` dentro de `fire` (pre-decidido) **o** `POST /move` después de ver el resultado, dentro del margen; los agentes en proceso pueden implementar `chooseMove()` opcional (gana sobre `move` de `chooseShot`). |
| Experimento desechable | Presupuesto **~5 min de CPU** (usados 4,2). Resultados en `spec/03-percepcion.md` §8; código borrado. |
| Semilla | **Todo determinista**: la sala reparte un `rng` con semilla a mapgen y a cada agente (`rng` nuevo en `chooseShot`, por defecto `Math.random`); los 4 heurísticos lo usan. |
| Contratos | `spec/00`…`spec/08` **aprobados tal cual** por el usuario (incluidos los defaults: empate en reto → reina; memoria de equipo sin gradiente a compañeros; dos pasadas por turno; `BODY` 0.5 u, separación 1 u). |
| Claves de datos | **Inglés** en claves JSON/API nuevas; **español** en todo texto para personas. |
| Ángulo de artillería | Bug previo en `solver.js` (ángulo positivo baja para el equipo derecho): **se arregla en F1** (spec/01 §7b). |
| Tests viejos | `test/smoke.mjs` y `agent.mjs autopilot` reciben una línea (`stage==='move'` → `stay`), en commit propio con motivo. |

## 4. Diseño resultante (borrador, se cierra al acabar las preguntas)

### 4.1 Tropas (F0)
✅ Eliges el **tipo de tropa** por bando; la **posición es siempre aleatoria**. 💡 El selector lista los
heurísticos (Sniper, Greedy, Artillery, Chaos) **y tus redes guardadas**; las exhibiciones contra
heurísticos no cuentan para el trono ni para el entreno.

### 4.2 Movimiento (F1)
✅ Tras disparar, el soldado se mueve; destino elegido por el agente; **2u**; si es inválido **desliza**
al punto válido más cercano (sin entrar en obstáculos, salir del plano ni apilarse). `chooseShot`
devuelve `move` opcional (compatible hacia atrás); validación en el motor, junto a `fire()`.

### 4.3 La red (genoma) — bloques del editor
| Parte | Bloques |
|---|---|
| 👁 Ojos | ✅ 🗺 Mapa (instantánea de posiciones) · 📊 Rasgos (features compactas) · 🔮 Simulador (opcional, por candidato) · resumen de obstáculos · Historial (últimos disparos propios y del rival y su resultado) · Radar/bigotes (distancias en K direcciones) · Reloj (turno, disparos hasta el empate, renovación de mapa) · Compañeros (rasgos de aliados agregados). |
| 🧠 Instinto | 💡 Capa densa (neuronas + activación: relu, tanh, sigmoide, leaky, gelu…), uniones (juntar / sumar cables), atajos (cables que saltan capas). |
| 🌀 Memoria | ✅ Eco · GRU · LSTM · Memoria de equipo. |
| ✋ Manos | ✅ 🎯 Elegir (puntúa cada candidato de disparo) · ✏ Ajustar (pendiente / curva / ángulo). |
| 🦶 Pies | ✅ Moverse (puntúa y ajusta los ~9 destinos). |
| Recompensa | ✅ deslizadores (§3 R2). |
| Aprendizaje | ✅ gradiente / evolución / ambos, con sus parámetros explicados. |
| 💡 🎲 Imaginación | Generador de candidatos: cuántos (N) y de qué familias (rectas, parábolas, senos, EDO1, EDO2-artillería, salvajes). Es parte de "crear la base como yo quiera". |

✅ **Política compartida por soldado**: la misma red decide por cada soldado (observación local +
contexto global) → funciona con 1, 2, 3 o 4 por bando.

### 4.4 Aprendizaje
- **Gradiente (RL real)** 💡: REINFORCE con baseline; retropropagación a través del tiempo por la
  memoria (BPTT); política estocástica (softmax sobre candidatos + ajuste gaussiano).
- **Evolución** 💡: estrategias evolutivas: copias perturbadas de la red juegan y se promedia hacia las
  que más recompensa sacan.
- **Ambos**: evolución para la forma y el rumbo general, gradiente para afinar.
- ✅ Aprende de **toda partida** que juega (x1, x10 o turbo).

### 4.5 Trono (king of the hill)
✅ Tus dos primeras redes pelean 1v1; la ganadora es **reina**; cada red nueva o hijo retocado la reta.
Ranking: **victoria + diferencia de kills**. Hijos: mutación de la reina → pre-torneo → eliges →
retocas → duelo 3×2 en vivo. Rivales de entreno: solo tus redes.

### 4.6 Transparencia en partida
✅ **Todos los candidatos tenues** en el overlay y **la elegida fuerte y brillante** (igual los
destinos de movimiento) + panel lateral con puntuaciones y razonamiento. 💡 Atribución por
"tapar y comparar": "si tapo el Mapa, la #3 baja de 0.82 a 0.40" → porcentaje por bloque → frase.

### 4.7 Evolución visible
✅ Árbol genealógico · curvas · diferencias padre→hijo · cerebro en vivo.

### 4.8 Voz, confianza y asociaciones humanas 💡
- **Confianza = certeza × experiencia** (números reales). Novata: piensa en voz baja y duda
  ("mmm… ¿#3? o #1…"). Veterana: anuncia su plan, se burla, replica.
- **Memoria episódica emocional**: cada suceso real (matar, morir, casi-acierto, fuego amigo, ganar o
  perder un reinado) se guarda con emoción (orgullo, rencor, miedo, respeto) e intensidad; se recuerda
  por **asociación** (mismo rival, mismo bioma, mismo tipo de disparo, mismo resultado), con más peso
  lo reciente y lo intenso, como la memoria humana. Ejemplo: "Otra vez tú, Hydra-7. En la Fortaleza
  me volaste por encima del muro; no pienso quedarme quieta."
- **Cohesión**: un carácter por red (heredado del genoma), apodos estables para sus rivales, sin
  contradicciones (si dijo "fácil" y falló, lo reconoce después).

### 4.9 Arquitectura técnica 💡
- `shared/nn.js`: librería de red pura (sin I/O, sin dependencias): hacia delante y hacia atrás para
  densa, activaciones, Eco, GRU, LSTM, memoria de equipo y puntuación de candidatos. La usan el
  servidor, los hilos de entreno y el navegador (cerebro en vivo, "¿qué pasaría si…?").
- Motor sin pantalla: la sala `Room` corre **en proceso y en modo síncrono** (sin temporizadores ni
  broadcast), así `fire()` sigue siendo el único punto de validación. Mapas con **semilla**
  (duelos reproducibles y repeticiones).
- Entreno en `node:worker_threads` (sin dependencias); progreso al navegador por SSE.
- Redes en `evo/nets/*.json` (grafo + pesos + carácter + memoria episódica + historial); trono y
  genealogía en `evo/throne.json`.
- UI del laboratorio: `public/evo.html`.

## 5. Preguntas abiertas (siguiente sesión)
- Qué ideas de §6.2 entran (voz Valve+Nemesis+emociones RL, recompensa z-score + etiqueta + hitos,
  liga estilo AlphaStar, fase de sueño y lección, temperatura y τ heredables, bofetada/caricia,
  Imaginación que evoluciona).
- Más extras propuestos: diario de la red (qué aprendió, en frases), exportar/importar redes…
- Validar las 💡 de §4 (bloques extra de Ojos/Instinto, 🎲 Imaginación, detalles de RL/ES,
  atribución, arquitectura).
- Replantear las fases F0–F5 con el alcance ampliado (trono + dinastías, voz RWKV, extras).

## 7. Proceso de construcción (decidido el 2026-09-22, ronda 6) ✅
- **Reparto:** **Fable hace todo lo crítico**, tanto los tests como el código, en dos fases separadas
  y con los tests congelados antes de programar. Lo hace **en otra sesión** que abre el usuario;
  **en esta conversación no se usan subagentes**. Dato: Fable 5.1 = 10 $ / 50 $ por millón de tokens
  (entrada / salida), frente a Opus 5 = 5 $ / 25 $ (documentación de Anthropic, caché del 2026-06-24).
- **Crítico** ✅: núcleo de la red · aprendizaje · genoma y mutación · reglas del motor.
  🧭 Añadido por Claude (el usuario lo delegó: "todo lo que consideres crítico tú"):
  - **Percepción**: vector de observación, generador de candidatos y rasgos, 🔮 Simulador. Un error
    aquí arruina el aprendizaje en silencio.
  - **Atribución y números de confianza y emoción**: tienen que ser verdad (criterio "real, no teatro").
  - **Trono y dinastías**: resultado del duelo 3×2, ranking, integridad de la genealogía.
  - **Validación de redes recibidas**: límites de tamaño y forma; una red mal formada no puede
    colgar ni romper el servidor.
  - **Regresión**: la suite actual sigue en verde.
- **No crítico** (Opus): editor visual, vistas de evolución, redacción de las frases (los números que
  las alimentan son críticos), tutorial, plantillas y estilos.
- **Tests: congelado + mutantes** ✅. Cada pieza sigue este orden:
  1. Spec.
  2. Tests que fallan (se ve el rojo).
  3. Congelado con huella (SHA-256 de los ficheros de test, registrada).
  4. Código hasta ponerlos en verde.
  5. **Prueba de mutantes**: un script sin dependencias altera operadores y constantes del código y
     exige que algún test falle.

  Un test solo se cambia con el OK del usuario y un motivo escrito.
- **Referencias independientes del código**: gradiente numérico frente a retropropagación · tareas de
  resultado conocido (tragaperras, recordar un bit N turnos, función sencilla para la evolución) ·
  propiedades (mutaciones aleatorias siempre válidas, guardar/cargar idéntico, misma semilla = misma
  partida) · escenas fijas del motor (2u, deslizar, obstáculos, `fire()` único validador).
- **Orden** ✅: cerrar el diseño → spec con contratos exactos → lista de tests → código por fases.
  Nada se programa sin estar decidido.
- **Ronda 10** ✅: **Fable escribe toda la spec**, también los contratos compartidos (formatos, API,
  eventos, lo que ve la interfaz), en la carpeta **`spec/` por áreas** (00-arquitectura, 01-motor,
  02-red, 03-percepcion, 04-aprendizaje, 05-evolucion, 06-trono, 07-verdad, 08-interfaz).
  **Interfaz secuencial**: Opus empieza cada pieza de interfaz cuando la pieza crítica que usa está
  terminada; nunca se construye sobre algo que aún puede cambiar. Orden: el usuario **no** quiere
  rebanada vertical ("por si queda cutre y luego construimos sobre eso").
- **Ronda 11** ✅:
  - **Orden: fases completas F1→F7 + experimento desechable**, "si los experimentos no son caros".
    Antes de fijar la spec de percepción y aprendizaje, Fable hace un experimento **barato**
    (scripts Node pequeños en `experimentos/`, con tiempo acotado) que mide cómo aprende una red en
    este juego. Su código se borra; solo quedan números y conclusiones en la spec. Si se encarece:
    parar y preguntar.
  - **Sin puerta de aprendizaje**: F4 se cierra con los tests matemáticos y de tareas conocidas en
    verde.
  - **Lo menos importante lo hace Opus ya** ("hazlo tú ya, todo lo que puedas"), empezando por F0,
    con tests primero.
  - **Briefing para Fable**: `spec/README.md` + prompt para pegar. El usuario abre una sesión nueva
    con Fable ("no quiero que envíes subagentes Fable, hay que ahorrar tokens"). A Fable se le manda
    **hacer todo lo crítico**. "**No quiero fallos, este proyecto es importante para mí.**"
- **Antes de tocar código**: leer enteros `rooms.js`, `app.js`, `render.js` y los tests actuales.

## 6. Investigación (en curso, 2026-09-22)
- **VectorMind / RWKV**: **aplazado** por decisión del usuario (más adelante; fuera del alcance actual).
  Investigación detenida sin resultados.
- **Humano y divertido sin romper el RL**: ✔ terminada (abajo).

### 6.1 Precedentes: qué hacen y qué robamos
> Datos del informe de un subagente con WebSearch/WebFetch; las fuentes están citadas, pero yo no las
> he vuelto a comprobar una a una. Son inspiración de diseño, no afirmaciones para publicar.

| Precedente | Mecanismo clave | Qué robamos | Fuente |
|---|---|---|---|
| **NERO** (rtNEAT, Stanley/Bryant/Miikkulainen) — el más parecido a lo nuestro | Deslizadores = pesos de cada componente de fitness (acercarse, acertar, recibir daño, seguir a aliados…), normalizados a z-score; pueden ser negativos. El jugador diseña el currículo (torretas, muros). Equipos guardados en fichero, plantillas mixtas para la batalla. Añadieron **hitos** para no olvidar lo aprendido. | Recompensa = Σ deslizador·z (sirve igual para gradiente y evolución) · hitos anti-olvido · plantilla mixta | UT Austin, IEEE TEC 2005 — https://nn.cs.utexas.edu/downloads/papers/stanley.ieeetec05.pdf |
| **Creatures** (Steve Grand) | Cerebro de 952 neuronas en lóbulos; impulsos (hambre, miedo, aburrimiento) como entradas; refuerzo por "química"; aprende al dormir; visor "Brain in a Vat". Apego enorme de los jugadores. | Impulsos reales como entradas (p. ej. frustración = tasa de fallos) · **fase de "sueño"** entre partidas donde se ve el aprendizaje como un "sueño" que repasa la partida · visor del cerebro en vivo | Alan Zucconi — https://www.alanzucconi.com/2020/07/27/the-ai-of-creatures/ · Creatures Wiki — https://creatures.wiki/Brain_in_a_Vat |
| **Black & White** (Richard Evans) | BDI + perceptrones + árboles ID3; bofetada/caricia castigan la *creencia*, no la acción; bombilla cuando aprende; mensajes tipo "tu criatura comerá más cuando tenga hambre". | **Frase de "lección"** sacada del mayor cambio de pesos · bofetada/caricia como término de recompensa humano registrado · bombilla cuando el cambio supera un umbral | Lucian Wischik — https://www.wischik.com/lu/senses/bwcreature.html |
| **Nemesis** (Shadow of Mordor/War) | Cada orco guarda lo que le hiciste y lo recuerda en sus frases; modelo "temporada deportiva". Lección: al que arrasa nunca le sale némesis, así que hacen falta perillas. | Diario de sucesos tipado (matado_por, suicidio, casi, humillado) · **libro de rivalidades** por pareja con "cicatrices" solo de hechos reales · el trono como temporada | Game Developer (Kris Graft / Bryant Francis) — https://www.gamedeveloper.com/design/designing-i-shadow-of-mordor-i-s-nemesis-system · GDC 2018 — https://www.gdcvault.com/play/1025150/ |
| **Diálogo dinámico de Valve** (Elan Ruskin, GDC 2012) | Consulta = concepto + hechos; reglas con criterios; gana la más específica; las frases escriben hechos de vuelta ("ya vi los barriles"); réplicas encadenadas; anti-repetición. | **Base de reglas sobre el estado RL real** (confianza, racha, último resultado, rival) · réplicas entre redes · hechos escritos de vuelta + enfriamientos. ~100 líneas de JS | Valve — https://cdn.akamai.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf |
| **GT Sophy** (Sony AI, Nature 2022) | Recompensa lineal hecha a mano con términos de **etiqueta**; entrenar solo contra IA pasiva la volvió agresiva; currículo de situaciones clave. Pasó de perder 86–70 a ganar 104–52 contra humanos. | Términos de etiqueta en Recompensa (repetir expresión, casi fuego amigo) · currículo de escenas clave · la dificultad = checkpoints antiguos, no ruido falso | Wurman et al., Nature 2022 — https://www.cs.utexas.edu/~pstone/Papers/bib2html-links/nature22.pdf |
| **Liga de AlphaStar** (DeepMind) | Agentes principales: 35% contra sí mismos, 50% PFSP contra toda la liga y 15% contra rivales olvidados. **f_hard=(1−x)^p** (no pierde el tiempo con rivales ya ganados). Explotadores que se reinician al superar el 70%. | Mapa: reina = agente principal, retadora = explotador, dinastías = dos principales, sala de la fama = liga congelada · muestrear la sala de la fama con f_hard · **partidas "fantasma"** contra ex-reinas que ya no gana ("vuelve la vieja némesis") | Vinyals et al. — https://storage.googleapis.com/deepmind-media/research/alphastar/AlphaStar_unformatted.pdf |
| **Bots creíbles** (BotPrize 2012, UT^2) | UT^2 evolucionado con NSGA-II; puntería que empeora con el movimiento y la distancia; 51.9% de "humanidad" frente al 40% de media de los humanos. The Sims: la autonomía "era demasiado buena" → elige al azar entre sus prioridades principales. GAMYGDALA: emociones OCC → PAD. | **Temperatura heredable** (muestrear la política real, no ruido de teatro) · emociones desde señales RL: esperanza/miedo = V, alegría/decepción = signo de la ventaja, sorpresa = abs(ventaja) · el error de puntería también se aplica al entrenar | UT Austin — https://news.utexas.edu/2012/09/26/artificially-intelligent-game-bots-pass-the-turing-test-on-turings-centenary/ · TU Delft — https://ii.tudelft.nl/~joostb/files/Popescu_Broekens_Someren_2013.pdf |
| **Explicar redes** (TF Playground, Greydanus, MarI/O) | Grosor del cable = abs(peso), color = signo; mapas de calor por neurona; saliencia por tapado: el 67.7% de los alumnos detectó qué miraba de verdad un agente sobreajustado. | Cables por peso + pulso por activación · "**estaba mirando…**" por tapado (N+1 pasadas) · neuronas autonombradas por su entrada más correlacionada | Smilkov et al. — https://arxiv.org/pdf/1708.03788 · Greydanus et al. — https://arxiv.org/abs/1711.00138 |
| **Otros** | Forza Drivatar (confianza por decisión + capa de retoque del diseñador) · OpenAI Five "espíritu de equipo" τ · Galactic Arms Race (las armas evolucionan según lo que se usa) · avisos: Hello Neighbor (prometió aprendizaje que no se veía), Evolution de Keiwan ("sandbox sin metas"). | **τ heredable** egoísta↔equipo · **🎲 Imaginación que evoluciona** (las plantillas de disparo evolucionan según lo que eligen las redes) · no prometer aprendizaje que no se vea · el trono y las dinastías dan la meta | aiandgames.com · https://arxiv.org/pdf/1912.06680 · https://dl.acm.org/doi/abs/10.1145/1810136.1810137 |

### 6.2 Cómo encaja en el diseño (✅ aprobadas todas en la ronda 7)
1. **Voz** (§4.8) = base de reglas estilo Valve sobre el estado real + diario de sucesos y libro de
   rivalidades estilo Nemesis + emociones calculadas de señales RL (V, ventaja, entropía). Todo real y
   con cohesión; sin LLM.
2. **Recompensa** = deslizadores normalizados a z-score (NERO), con nuevos términos opcionales:
   etiqueta (GT Sophy) e hitos anti-olvido (NERO).
3. **Rival de entreno**: refinar el 60/25/15 🧭 con la liga de AlphaStar (sala de la fama muestreada con
   f_hard + partidas fantasma contra ex-reinas + retadora "explotadora").
4. **Aprendizaje visible**: fase de "sueño" entre partidas, bombilla y frase de lección.
5. **Rasgos heredables nuevos**: temperatura (qué tan arriesgada elige) y espíritu de equipo τ.
6. **Bofetada/caricia**: premiar o castigar a mano la última decisión (término de recompensa humano,
   registrado).
7. **🎲 Imaginación que evoluciona** (Galactic Arms Race).

### 6.3 Riesgos aprendidos
- Prometer aprendizaje que no se ve mata la confianza (Hello Neighbor) → todo cambio debe verse.
- Un sandbox sin metas aburre (Evolution de Keiwan) → trono + dinastías + boletín dan la meta.
- La recompensa crea la personalidad, a veces mala (GT Sophy embestía) → deslizadores explicados con
  sus efectos.
- Al que arrasa no le pasa nada interesante (Nemesis) → partidas fantasma y retadoras explotadoras.
