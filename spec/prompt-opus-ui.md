# Prompt para Opus — revisión completa + interfaz del laboratorio

> Copia desde la línea siguiente hasta el final en una sesión nueva de Opus abierta en `E:\grafwar`.

---

Eres Opus y trabajas en `E:\grafwar` (repo `https://github.com/DasikuHp/rlwar.git`, rama `master`). Fable ha
construido la parte crítica del laboratorio de redes neuronales de Graphwar (fases F0–F7, 29 commits). Tu trabajo
tiene dos partes, en este orden: **(1) revisar todo lo que hizo Fable** y **(2) construir la interfaz** completa
del laboratorio, profesional y divertida, sin nada de "IA slop", pensada desde el Graphwar original que está en
`referencia/graphwar/`. Este proyecto es importante para el usuario: no quiere fallos ni humo.

## 0. Reglas que mandan sobre todo lo demás

1. **Honestidad**: reporta fiel. Si algo falla, di qué y con qué salida. Nunca "hecho y verificado" sin verificar.
2. **Reparto**: la parte crítica es de Fable y **no la tocas**: `shared/`, `evo/`, `server/rooms.js`,
   `server/headless.js`, `agents/`, `tools/`, ni ningún test congelado (`test/FROZEN.json`). Si encuentras un
   bug crítico, lo documentas con reproducción exacta (comando + salida) en el informe de la parte 1 y se lo pasas
   al usuario; no lo arreglas tú. Sí puedes tocar `public/`, `server/server.js` solo para servir estáticos si hace
   falta, y crear tests nuevos `test/ui-*.spec.mjs`.
3. **Cero dependencias**: Node ≥ 18, JS y CSS a mano en `public/`. Nada de npm install, CDNs ni frameworks.
4. `npm test` (`node test/run-all.mjs`, ~3,5 min) tiene que seguir en verde antes de cada commit. Commits
   pequeños, mensajes en español, y `git push` a `origin master`.
5. **Pregunta con AskUserQuestion** todo lo que no esté decidido (2–4 opciones, la recomendada primero) y antes de
   simplificar cualquier cosa. Lo marcado ✅ en `plan2.md` es vinculante; 🧭 lo eligió Opus por delegación; 💡 es
   propuesta.
6. Todo texto visible en español, claro, con ejemplos. Claves JSON en inglés (así vienen de la API).

## 1. Lectura obligatoria, en este orden (lee entero, no por trozos)

1. `spec/README.md` — proceso, reparto, estado por fases (§6b), qué desbloquea cada fase para ti (§6).
2. `spec/08-interfaz.md` — **tu contrato**: catálogo con tres niveles de vista, redes como agentes, sala viva,
   rutas de `/api/lab/*` por fase (§4–§5), SSE global (§6), plantillas (§7).
3. `plan2.md` — todas las decisiones del usuario (rondas 1–12): niveles Aprendiz/Artesano/Científico, trono con
   dinastías, boletín, neuronas con nombre, voz por carácter, "exacto y real", etc.
4. `spec/00` a `spec/07`: cada una tiene al final un apartado de **precisiones** (`§9`/`§10`/`§6`/`§12`) con los
   contratos exactos que Fable fijó antes de programar. Ahí están las formas de todos los objetos que vas a pintar
   (registro de decisión, genoma, ops de mutación, diff con `heat`, duelo, trono, frase con `refs`, boletín).
5. `AGENTS.md`, `plan.md` §4 (mapa del código), `spec/mutantes.md` (qué está probado a fondo y qué no).
6. `referencia/graphwar/` (el original en Java, GPL-3, solo lectura): `readme.md` y `rsc/` (recursos gráficos y
   textos). Fíjate en su lenguaje visual: plano cartesiano, curvas que se dibujan, soldados, muros, marcador,
   sobriedad de juego de matemáticas con humor propio.
7. `public/index.html`, `public/js/app.js`, `public/js/render.js`, `public/css/style.css`: el cliente actual
   (sala, plano, chat, selector de tropas). La interfaz nueva se integra con él, no lo sustituye a ciegas.

## 2. Parte 1 — Revisión de todo lo que hizo Fable

Entrega un informe en `spec/revision-opus.md` (y resumen en el chat) con estas secciones, sin suavizar:

1. **Recorrido de commits**: `git log --stat` de los 29 commits; para cada fase, qué se prometió (spec) y qué hay.
2. **Batería**: salida completa de `node test/run-all.mjs` y de `node tools/freeze.mjs --check`.
3. **Prueba en vivo con curl** de **cada ruta** de `spec/08 §4–§6` y `AGENTS.md` (arranca `PORT=8787 node
   server/server.js` o usa `GW_EVO_DIR` temporal): crea redes desde plantilla, entrena (turbo y x10 con salas
   espectables), pide hijos y su ranking, diff, cirugía, duelo turbo y x10, reto al trono, dinastías (una
   generación), boletín, diario, cronista, neuronas, bofetada/caricia, moviola con cerebro, SSE. Anota respuesta
   real y tiempos. Cualquier 500, cuelgue, incoherencia entre spec y respuesta, o número que no cuadre → hallazgo
   con reproducción.
4. **Contraste con `plan2.md`**: lista de decisiones ✅ que no ves cubiertas (o cubiertas a medias) en el código o
   la API. Sé concreto (ronda, decisión, dónde falta).
5. **Huecos que te afectan**: qué te falta de la API para pintar cada vista de la parte 2. Eso se le pide a Fable
   por medio del usuario, no lo parcheas tú en `evo/`.
6. **Mutantes**: lee `spec/mutantes.md` y opina si las justificaciones de los supervivientes te convencen; señala
   las que no.

No empieces la parte 2 hasta haber entregado este informe y resuelto con el usuario las dudas que abra.

## 3. Parte 2 — La interfaz

### 3.1 Qué hay que construir (una vista por bloque; el orden es el recomendado)

| Vista | Fuente de datos | Qué debe verse |
|---|---|---|
| **Laboratorio (inicio)** | `GET /api/lab/nets`, `/api/lab/throne`, SSE `hello` | tus redes con emblema, generación, casa, si es reina o entrena; la reina en su trono; accesos a todo |
| **Editor de redes** | `GET /api/lab/catalog` (bloques con `explain`/`example` y `level`), `/templates`, `PUT /nets/:id`, `POST /nets/:id/validate` | bloques por cables sobre un lienzo; tres niveles de vista (Aprendiz: pocos deslizadores con buenos valores; Artesano; Científico); errores de `validate` **en español con su `example`** junto al bloque culpable; importar/exportar |
| **Sala viva con redes** | `GET /api/rooms/:code/state` (`lastDecision`, `shotLog`, `players[].netId`), SSE de sala | los N candidatos imaginados como curvas tenues sobre el plano, la elegida en firme, `margin`, atribución ("miraba sobre todo…"), bocadillos con la confianza (novata/media/veterana) |
| **Entreno** | `POST/GET /api/lab/trainings`, SSE `training/curve/sleep/lesson/milestone` | curva de recompensa y victorias, sueños (una marca por `update`), la lección con su bombilla, mezcla de rivales, botones stop/pause, salas x1/x10 espectables |
| **Hijos y pre-torneo** | `POST /nets/:id/children` → `GET /jobs/:id`, SSE `job/children` | ranking con `opsText` (las frases exactas de cada mutación), elegir uno, retocar, retar |
| **Diferencias** | `GET /nets/:id/diff/:otherId` | mapa de calor por bloque (`heat` ≤ 64 valores, `relChange`), cables añadidos/quitados, rasgos e imaginación antes/después |
| **Cirugía** (Científico) | `PUT /frozen`, `PUT /weights/:blockId`, `POST /transplant` | congelar bloques, pesos a mano con validación, trasplante con avisos |
| **Duelos y trono** | `/api/lab/duels`, `/throne`, `/throne/challenge`, `/hall-of-fame`, `/genealogy`, SSE `duel/throne` | marcador 3×2 en vivo, reto al trono, reinados y defensas, sala de la fama con copias congeladas, árbol genealógico (`edited`/`orphan`) |
| **Dinastías** | `/api/lab/dynasties`, `/generation`, `/:house/challenge-throne`, SSE `dynasty` | dos casas, campeonas, una generación como carrera (entreno cruzado → cría → promoción → duelo), historia |
| **Verdad** | `/nets/:id/diary`, `/chronicle`, `/games/:id`, `/games/:id/turns/:n/brain`, `/nets/:id/bulletin`, `/neurons`, `/slap`, `/caress`, `/memory`, `/api/lab/log` | diario y cronista (frases con `refs`; al pulsar una frase, resaltar los eventos que la justifican), moviola turno a turno con el cerebro (activaciones, atención), radar del boletín, neuronas con nombre y renombrado, bofetada/caricia sobre una decisión, emociones (`hope/fear/joy/…`) y memoria (rivales, rencores) |

### 3.2 La regla "exacto y real" en la interfaz

Toda frase que la interfaz **redacte** (voz de la red, lección, diario, cronista, tooltips con datos) se compone
con `truth.compose(plantilla, huecos)` y se verifica con `truth.checkPhrase` (`evo/truth.js`, spec/07 §2 y §12.2):
cada número y cada nombre salen de un evento y llevan `refs`. Si no verifica, no se muestra. Nunca inventes una
cifra, un nombre ni un adjetivo que no salga de los datos. La "diversión" nace de eso: las redes hablan de lo que
de verdad pasó, con el carácter de sus `traits.character` (frío, chulo, dramático, desquiciado) y su nivel de
confianza real. Los generadores de frases son tuyos: escríbelos en `public/js/` (o en un módulo no crítico) con
plantillas variadas por carácter y situación, y pruébalos.

### 3.3 Estética: profesional, divertida, cero slop

- Parte del **original**: el plano cartesiano es el protagonista; las funciones se dibujan trazándose; soldados y
  muros con la misma lógica visual; marcador y chat claros. El tema neón oscuro ya existe en
  `public/css/style.css`: extiéndelo con criterio, no lo sustituyas por un tema genérico.
- **Prohibido**: degradados morados/azules de plantilla, glassmorphism, tarjetas iguales con iconos gigantes,
  emojis como decoración (solo los que ya usa el proyecto en nombres de bloques y biomas), textos de relleno,
  "Bienvenido a…", gráficas vacías o con datos inventados, animaciones sin significado, tres columnas de features,
  botones enormes con sombras, tipografías al azar.
- **Obligado**: densidad de información con jerarquía clara; una tipografía de interfaz y una monoespaciada para
  expresiones y números; color con significado (equipo izquierda/derecha, familias de disparo, emociones); cada
  número visible viene de la API y se puede rastrear; estados vacíos honestos ("aún no hay partidas") y estados de
  carga reales; teclado y foco; funciona a 1280 px y a 1920 px; nada parpadea con el SSE (actualiza en sitio).
- **Diversión**: bocadillos con la voz de cada red, el ritual del trono (reinados, defensas, la sala de la fama
  como museo), la moviola como "ver el cerebro" turno a turno, las neuronas con nombre, la bofetada y la caricia
  con respuesta inmediata en la memoria de la red. Todo con datos reales, nunca con teatro.
- **Tres niveles de vista** (✅ plan2): Aprendiz (pocos controles, valores por defecto buenos, cada cosa
  explicada con `explain` y `example` del catálogo), Artesano, Científico (todo). El nivel se recuerda.

### 3.4 Cómo trabajar

1. Antes de cada vista: lee su spec, mira la respuesta real de la API con curl, dibuja en texto qué vas a hacer y
   pregunta si hay algo no decidido.
2. Construye la vista, pruébala en vivo contra el servidor (redes reales, entrenos reales), y escribe un test
   `test/ui-<vista>.spec.mjs` con el patrón de `test/client.spec.mjs` (DOM simulado) para la lógica de la vista.
   Añádelo a `test/run-all.mjs`. No toques los congelados.
3. Al acabar cada vista, commit + push y una lista **"en qué fijarte"** (3–6 puntos: dónde mirar, qué debería
   verse, qué sería fallo) para que el usuario la pruebe. El testing visual lo hace el usuario.
4. Al cerrar la sesión: `spec/README.md` §6b, `plan2.md` (estado) y `plan.md` §4 actualizados, todo commiteado y
   pusheado, resumen honesto de lo hecho, lo verificado y lo que falta.

Empieza por la parte 1. Ultrathink.
