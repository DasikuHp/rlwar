# 12 — Tutorial «Tu primera red» en modo taller, y enchufar y desenchufar cables

> Propuesta de la sesión 11 (2026-09-25). **Aún no está aprobada**: la sesión siguiente la enseña y pregunta lo del §6
> antes de programar. Sustituye a la guía de la sesión 10 (una tarjeta en la esquina del editor, `public/js/lab/coach.js`),
> pero aprovecha su lógica pura.

## 1. Por qué se rehace

Lo que dijo el usuario tras probar la guía de la sesión 10:
- "me gustaría un botón para **saltarlo todo**";
- "en vez de una ventana en un lado, que **te guíe mucho más** y se **enfoque solo en lo que tienes que hacer**, para que todo
  lo demás no te abrume: hoy entras, ves todo el pifostio de cosas y luego ya el tutorial";
- "tienes que poder hacer tu primera red";
- "no me disgusta cómo se explica, pero sigue siendo poco intuitivo. Cuando acabes el tutorial tienes que **entender cada una
  de las cosas que puedes y debes hacer**, para que el resto no te abrume. Yo, que soy el creador, **me he quedado atascado**
  en el tutorial y hay muchas cosas que no entiendo. No es borrar cosas: es que el tutorial se explique solo";
- "tienes que poder **desenchufar y enchufar bloques fácilmente**: hoy es imposible".

Lo que encontró la auditoría de la sesión 11 con un **ratón de verdad** (la sesión 10 solo había probado con `.click()` de
JavaScript):
- **La paleta se movía bajo el ratón.** Al pasar por un bloque, su explicación crecía encima de la lista y la empujaba: el
  clic caía en otro sitio y el bloque no se añadía. La guía no pasaba del paso 1. Muy probablemente, el atasco del usuario
  empezó aquí. Arreglado en b219bda: la explicación flota al lado.
- A 1280 × 800, el «👉 qué hacer» y el botón «Hazlo por mí» quedaban cortados al pie de la tarjeta. También arreglado
  en b219bda.
- **Enchufar y desenchufar** no fallan por un error de código: fallan porque los gestos que haría cualquiera no existen.
  - Arrastrar desde el punto de **entrada** para sacar un cable **mueve la tarjeta entera**.
  - El punto de salida mide **7,5 px** en Tortuga a 1280 (zoom 58 %). Si fallas por 5 px, arrastras la tarjeta.
  - Para quitar un cable hay que acertar a una línea fina, que eso la seleccione y buscar «Quitar cable» en el panel de
    abajo (o pulsar Supr). Nadie lo adivina.

## 2. Lo que dice la investigación (fuentes)

| # | Fuente (plataforma · autor · URL) | Qué dice | Qué hacemos con ello |
|---|---|---|---|
| 1 | Nielsen Norman Group · «Onboarding Tutorials vs. Contextual Help» (2023) · nngroup.com/articles/onboarding-tutorials/ | Los tutoriales que te sueltan información fuera de contexto (*push revelations*) interrumpen, se saltan y se olvidan: hay que memorizarlos. Funciona mejor la ayuda que sale cuando la necesitas (*pull*). El tutorial de ArcGIS fue de los buenos porque **te hacía hacer la tarea**, no mirarla. La ayuda se cierra fácil y se vuelve a abrir. | Cada cosa se enseña **cuando se usa y usándola**. Se puede saltar y se puede volver a abrir. |
| 2 | NN/g · «Instructional Overlays and Coach Marks» (2014) · nngroup.com/articles/mobile-instructional-overlay/ | Una capa que señala todo lo que hay en pantalla sobrecarga: no puedes leerla y usar la app a la vez. Mejor pistas cortas, de una en una, con dibujos. | **Una cosa cada vez**, señalada donde está, no un mapa de todo. |
| 3 | Valve · comentario de los desarrolladores de *Portal* · theportalwiki.com/wiki/Portal_developer_commentary | Las salas recargadas **distraían tanto que estorbaban el aprendizaje**: las dejaron limpias. Una sala que metía demasiadas ideas a la vez se partió en tres. Lo que no se entiende no se puede pasar tropezando. Cuando algo es importante, hacen una pausa y lo resaltan con partículas y sonido. | **Modo taller**: solo se ve lo que se usa. Un paso que atasca a la gente se parte en dos. Lo importante se resalta con un efecto. |
| 4 | Kim Swift y equipo · «Thinking With Portals» (Game Developer, 2008) · gamedeveloper.com/design/thinking-with-portals-creating-valve-s-new-ip | Probaron con jugadores desde la primera semana. Si más de uno se atascaba en un sitio, **partían el concepto en secciones**. | Sondeo automático con ratón real en cada cambio, y la prueba del usuario, paso a paso. |
| 5 | Google · *Blockly Games: Maze* · blockly.games; reseña de T. S. von Davier (CMU, Medium, 2019) · medium.com/@tvondavi/betacritic-blockly-maze-88369fa8f626 | Cada nivel da **solo unos pocos bloques**. Cada pocos niveles llega uno nuevo, y el nivel **obliga a usarlo**. Va de lo concreto a lo abstracto, y cada nivel es distinto. | La paleta del taller solo enseña los bloques del capítulo. Cada bloque nuevo hace falta para avanzar. |
| 6 | Luden.io · *while True: learn()* (juego de aprendizaje automático con nodos) · luden.io/wtl; reseñas en saveorquit.com (2019) y puzzlebyrinth.com | Cada tarea limita los nodos disponibles, y desbloquear uno lo explica. Lo que más se le critica: **"lo pasé sin entender cómo ni por qué"** y que el mismo montaje no dé siempre lo mismo. | Cada logro se explica **con lo que ha cambiado de verdad**. El banco usa semilla fija, así que el mismo montaje da siempre lo mismo. |
| 7 | Factorio · Friday Facts #241 (2018) · factorio.com/blog/post/fff-241 | Se tardaba de 30 a 45 min en llegar a lo que es el juego. Si limitas tanto al jugador, aprende a pasar el tutorial pero no las ideas. Las tareas sin un porqué ("consigue X porque sí") no enseñan. | La red juega **en ≈ 4 min**. Cada paso responde una pregunta de tu red ("¿cómo ve?"). Se limita lo que se **ve**, no lo que se puede hacer: «Ver todo» siempre está a mano. |
| 8 | Factorio · Friday Facts #342 (2020) · factorio.com/blog/post/fff-342 | Cada canal de información, con un solo uso. Aunque te saltes todos los bocadillos, **el objetivo solo tiene que bastar** para acabar. Buscaron a propósito los casos en que el jugador se atasca. Cada idea nueva gasta atención. | La línea «👉» basta sola. Si llevas un rato sin avanzar, se ofrece ayuda. Hay un sondeo que recorre el tutorial entero con ratón real. |
| 9 | Dan Cook · «The Chemistry of Game Design» (Lostgarden / Game Developer, 2007) · gamedeveloper.com/design/the-chemistry-of-game-design | Se aprende en bucles: haces algo, el mundo cambia, **lo ves** y ajustas tu idea de cómo funciona. Si la acción no se nota, frustra. | Cada acción tiene un efecto visible **en el sitio** (el banco, el cable, los números). |
| 10 | Kalyuga · efecto de inversión de la pericia (*Educational Psychology Review*, 2007) · link.springer.com/article/10.1007/s10648-007-9054-3 | La guía que ayuda a un novato **estorba** a quien ya sabe. | «Saltar tutorial» siempre visible y «Ya sé esto» en cada capítulo. |
| 11 | Roediger y Karpicke · «Test-Enhanced Learning» (*Psychological Science*, 2006) · doi.org/10.1111/j.1467-9280.2006.01693.x | Recordar algo por tu cuenta lo fija mejor que volver a leerlo. | Cada capítulo acaba con un **reto corto sin ayuda** (p. ej., "esta red no puede jugar: arréglala"). |
| 12 | Nintendo · *Zelda: Breath of the Wild*, la Meseta de los Albores (Wikipedia, con Polygon, IGN y ScreenRant) · en.wikipedia.org/wiki/Great_Plateau | Una zona pequeña y cerrada con pocas habilidades, que **ya es el juego**. Al salir se revela el mapa grande. | **Graduación**: al final se despliega el editor entero, y ya conoces cada parte. |
| 13 | Martin Jonasson y Petri Purho · «Juice it or lose it» (Nordic Game 2012) · youtube.com/watch?v=Fy0aCDmgnxg | El mismo juego se entiende y se disfruta muchísimo más cuando cada acción responde con efectos. | Partículas, cable que se dibuja y números que cuentan al acertar (con «reducir movimiento» respetado). |
| 14 | Blender · manual, «Editing Nodes» · docs.blender.org/manual/en/latest/interface/controls/nodes/editing.html | Para desenchufar: *"Drag the link away from its input socket and let it go"* (arrastra el cable fuera de su entrada y suéltalo). Ctrl + botón derecho, trazando una raya, corta cables. Si sueltas un nodo encima de un cable, se mete en medio. | Los mismos gestos (§5). |
| 15 | Unreal Engine · «Blueprint Editor Cheat Sheet» · docs.unrealengine.com/4.27/en-US/ProgrammingAndScripting/Blueprints/UserGuide/CheatSheet/ | Alt + clic en un punto quita todos sus cables. Ctrl + arrastrar mueve sus cables a otro sitio. | Alt + clic, igual (§5). |

Siguen valiendo las fuentes de la sesión 10 (plan2, fila «Sesión 10»): Bret Victor (enseñar los datos), Nicky Case
(empezar por una pregunta, apostar antes de ver, caja de arena al final), Andersen et al. CHI 2012 (el tutorial compensa
en juegos complejos y pegado a lo que enseña), Human Resource Machine, el 1-1 de Mario, el giro de Hayashida y la ayuda
que se retira (Renkl y Atkinson).

## 3. Reglas del tutorial (salen del §2; cada cambio se contrasta con ellas)

1. **Solo lo necesario a la vista.** El resto del editor no se atenúa: no está. Cada zona aparece la primera vez que se usa
   (Portal, Blockly, NN/g).
2. **Una cosa nueva cada vez, y hace falta para avanzar** (Blockly, Portal).
3. **Hacer → ver el efecto en el sitio → entender** (Cook, Victor). Primero el efecto y después el nombre técnico
   (de lo concreto a lo abstracto).
4. **Cada paso responde una pregunta de tu red** ("¿cómo ve?", "¿cómo escoge?"), nunca "haz X porque sí" (Factorio 241).
5. **La línea «👉» basta sola**; lo demás es extra y se puede plegar (Factorio 342).
6. **Nunca atascado.** Tras ~25 s sin avanzar, o dos intentos fallidos, sale la mano fantasma y luego «Hazlo por mí». Un
   sondeo con ratón real recorre el tutorial entero a 1280 y a 1920 (Factorio 342, Portal).
7. **Se puede saltar todo y cada parte, y se puede volver** (Kalyuga, NN/g).
8. **Cada capítulo acaba con un reto sin ayuda**, en una situación distinta (Roediger y Karpicke, Blockly).
9. **Al acabar, nada del editor queda sin presentar.** Cada zona y cada control tiene su capítulo (§4.3) y un test lo
   comprueba.
10. **Nunca promete lo que una red sin entrenar no sabe hacer** (regla del juego desde la ronda 17).

## 4. Diseño propuesto: el modo taller

### 4.1 Cómo se ve
- **Nueva partida → Desde cero** lleva directo al taller, no al editor entero. En pantalla solo hay:
  - el banco de pruebas, grande y en el centro (tu soldado blanco, un enemigo);
  - la red, en una tira debajo, con los bloques que lleves;
  - la paleta, solo con los bloques del capítulo;
  - un **bocadillo pegado a lo que se pide** (no una tarjeta en una esquina), con la pregunta, la línea «👉» y, al
    cumplirla, lo que ha cambiado, señalado con una flecha fina sobre la cosa (p. ej., sobre las curvas tenues:
    «estos son los 24 tiros que imagina»).
- Arriba siempre: la barra de capítulos (puntos), **«Saltar tutorial»** y **«Ya sé esto»** (salta el capítulo).
- Al saltar el tutorial entero, un aviso de una línea (qué te pierdes, dónde volver) y el editor completo. Se retoma desde
  el botón **Guía** o desde Academia.
- Cada zona nueva entra con un efecto y una etiqueta de una línea («Nuevo: el panel de la capa. Aquí ajustas el bloque
  elegido»).

### 4.2 Capítulos (propuesta; tiempos aproximados)
| Cap. | Pregunta | Lo que haces | Lo que aparece (y se presenta) | Reto sin ayuda |
|---|---|---|---|---|
| 1 · Que vea y escoja (≈4 min) | ¿Cómo decide una red adónde disparar? | 🎯 Candidatos → 🎯 Elegir → **enchufar** → apuesta «¿sabe apuntar?» | escena del banco, paleta (2 bloques), tarjeta y puntos de enchufe, cable, etiqueta «puede jugar», certeza | — |
| 2 · Enchufar y desenchufar (≈2 min) | ¿Qué pasa si le quitas lo que ve? | saca el cable (deja de poder jugar), vuelve a enchufarlo, **Ctrl+Z** | desenchufar, estado, deshacer y rehacer | «Esta red no puede jugar: arréglala» |
| 3 · Que piense (≈3 min) | ¿Y si combina lo que ve antes de puntuar? | ＋ en el cable → 🧠 Instinto; sube las neuronas a 64 y mira los pesos | ＋ del cable, puntos = neuronas, panel **Capa**, «¿Qué hace esta capa?», bloques y pesos de la barra | «Pon un Instinto entre Candidatos y Elegir en esta otra red» |
| 4 · El banco de pruebas (≈3 min) | ¿Escoge igual en otra situación? | escena «Tras una roca» (el giro), cambia la Semilla, lee «Se fijó en» | botones de escena, Semilla, certeza, «Se fijó en» | apuesta: «con la roca, ¿cambiará de tiro?» |
| Pausa | Tu red ya juega. ¿La pruebas? | **Probar ya** contra Vidente (y su moviola) o seguir | Probar ya | — |
| 5 · Que se mueva (≈2 min) | Tras disparar, ¿adónde va? | 🦶 Destinos → 🦶 Moverse | Disparar / Moverse del banco | «Haz que esta red se mueva» |
| 6 · Que recuerde (≈3 min) | ¿Cómo sabe si el último tiro se quedó corto? | 📊 Rasgos → 🌀 Eco → Instinto | tipos de cable (contexto, candidatos, destinos) y su leyenda | — |
| 7 · Su carácter (≈3 min) | ¿Qué le gusta y cómo aprende? | un cambio en cada gen (Carácter, Recompensa, Aprendizaje, Imaginación) | pestaña **Genes** | — |
| 8 · Tu taller (≈3 min) | ¿Y si algo sale mal? | guardar; romper algo a propósito → **Avisos** → arreglar con un clic; **Versiones**; **Qué ve tu red** | Guardar, Avisos, Versiones, Qué ve tu red, menú ⋯, Tus redes | «Vuelve a la versión de antes» |
| Graduación | — | el editor entero se despliega; cada zona se ilumina un momento con su nombre («ya la conoces») | plantillas, niveles (Aprendiz / Artesano / Científico: más bloques, nada se bloquea), Encajar, Ordenar, zoom, Guía | caja de arena |

- Unos 25 minutos en total. Cada capítulo se puede saltar y el avance se guarda en el mundo (`meta.tutorial`).
- **Caminos**: «Ya sé algo» empieza en el capítulo 3, con los anteriores dados por hechos. «Sé de RL» ofrece saltar y enseña
  «ver las matemáticas».
- El resto del bucle (Entrenar, Duelo, Trono) va en capítulos posteriores (P10). Este diseño cubre la etapa Crear.

### 4.3 Nada sin presentar (inventario → test)
Cada zona del editor lleva `data-tut="<clave>"`. El tutorial es una lista de datos: cada capítulo dice qué claves revela y
presenta. Un test comprueba que **toda clave del editor aparece en algún capítulo**, y que un control nuevo sin capítulo
hace fallar el test. Claves de hoy:
- Raíl: plantillas, paleta y grupos (Ojos, Instinto, Memoria, Manos, Pies), ficha flotante.
- Barra: niveles, datos (gen, bloques, pesos, partidas), estado, zoom, Encajar, Ordenar, Guía.
- Lienzo: columnas, tarjeta, puntos de enchufe, cable, ＋, ✕, puntos de neuronas.
- Panel: Capa, Genes, Qué ve tu red, Versiones, Avisos, leyenda, Plegar.
- Banco: escenas, Tu escena, Disparar/Moverse, Semilla, decisión, «Se fijó en», Probar ya.
- Cabecera: nombre, deshacer y rehacer, Guardar, menú ⋯. Pestañas Editor / Tus redes.

### 4.4 Efectos (todo pasa por `public/js/ui/fx/anim.js`; con «reducir movimiento», cortes sin animación)
- **Foco**: el taller no atenúa el editor, lo construye. Dentro del taller, lo que se pide lleva un halo que late
  (el `coach-target` de hoy, más visible).
- **Revelar una zona**: GSAP (Flip desde donde se habló de ella, o subir y aparecer) y una etiqueta de una línea.
- **Mano fantasma**: un cursor SVG que hace el gesto (arrastrar del punto de salida al bloque) con MotionPathPlugin, en
  bucle suave hasta que lo hagas. Sale en cada gesto nuevo, o cuando llevas un rato atascado.
- **Cable**: al enchufar se dibuja con DrawSVGPlugin; luego late con la señal real (los nervios de hoy).
- **Acierto**: una ráfaga corta de partículas (tsParticles) en el sitio, los números que cuentan hasta su valor
  (24 tiros, 12 números) y el punto del capítulo que se llena.
- **La pregunta** entra línea a línea (SplitText).
- **Graduación**: Flip del taller al editor entero, y cada zona se ilumina un instante con su nombre.

## 5. Enchufar y desenchufar (va antes que el tutorial, porque el tutorial lo enseña)
- **Zona de agarre**: cada punto de enchufe atrapa el ratón en un círculo de **28 px en pantalla**, sea cual sea el zoom.
  El punto visible crece al pasar por encima.
- **Enchufar**: arrastra desde la salida (derecha) o, al revés, desde una entrada vacía (izquierda). Suelta encima de la
  tarjeta, o **cerca** (imán de 40 px). Como hoy, se pone en verde donde vale y en gris donde no, y al soltar en gris te
  dice por qué.
- **Desenchufar**: arrastra desde una entrada **que ya tiene cable** y coges la punta de ese cable (Blender). Si lo sueltas
  en el vacío, se quita, con un aviso que ofrece deshacer. Si lo sueltas en otra tarjeta que vale, se cambia de sitio. Si la
  entrada tiene varios cables, coges el último que se enchufó.
- **Pasar el ratón por un cable**: se ilumina y en su mitad salen **✕ Desenchufar** y **＋ Añadir capa**. El cable se
  atrapa con 16 px en pantalla.
- **Alt + clic** en un punto quita todos sus cables (Unreal). Supr sigue quitando el cable elegido.
- **Soltar una tarjeta encima de un cable** la mete en medio, si cabe (Blender). *Opcional: se pregunta (§6).*
- **Lógica pura con test**: una función (en `public/js/lab/hints.js` o un módulo nuevo) que, dado el genoma, dónde
  empieza el arrastre y dónde se suelta, dice qué pasa (`connect`, `move`, `remove`, `insert` o `nada`) y por qué. Además,
  un sondeo con ratón real en Tortuga a 1280 (zoom 58 %) y a 1920.

## 6. Preguntas para el usuario (al empezar la sesión siguiente, con estas opciones)
1. **Dónde vive el tutorial**: (a) *modo taller dentro del editor*: el editor se construye pieza a pieza y al acabar es el
   de siempre (recomendado); (b) una pantalla aparte, más sencilla, que al final se convierte en el editor.
2. **Cuánto dura**: (a) completo, 8 capítulos y la graduación (≈25 min), cada uno saltable, con la pausa para probar tras
   el 4 (recomendado); (b) capítulos 1–4 y el resto como lecciones cortas que saltan la primera vez que abres cada zona
   (ayuda *pull*, NN/g); (c) solo capítulos 1–4.
3. **Quién habla**: (a) *Vidente*, la rival de práctica, como mentora (con su emblema y su voz); (b) la voz neutra del juego.
4. **Mano fantasma**: (a) en cada gesto nuevo (recomendado); (b) solo si llevas un rato atascado o la pides.
5. **Retos de fin de capítulo**: (a) sí, con «Hazlo por mí» tras dos intentos (recomendado); (b) no.
6. **Soltar una tarjeta encima de un cable la mete en medio** (como Blender): sí / no.

## 7. Qué se aprovecha
- `public/js/lab/coach.js`: los pasos, las preguntas y los textos de «lo que ha cambiado» con números reales pasan a
  ser datos de los capítulos 1, 3, 4, 5 y 6.
- `M.insertOnWire` y `Hn.insertOptions` (el ＋), `Hn.connectOptions` (verde o gris y por qué), el banco (`bench.js`,
  `whatif`), los nervios, `anim.js` y las cuatro librerías de `public/vendor/`.
- `meta.tutorial` del mundo (P2), que ya guarda el avance.
- `tools/sondeo.mjs` y los ayudantes de ratón real de la sesión 11 (`clickAt`, `drag` y `cover`, que dice si algo tapa el
  punto): hay que pasarlos a `tools/` para que el sondeo del tutorial sea permanente.
