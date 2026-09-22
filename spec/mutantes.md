# Mutantes supervivientes (justificados)

> `tools/mutants.mjs` mete un fallo por mutante y exige que algún test lo cace. Los supervivientes
> se anotan aquí con su motivo. Un superviviente **sin** motivo escrito es un test que falta.

## Herramientas (`tools/freeze.mjs` contra `test/tools.spec.mjs`, 2026-09-22) — cazados 41/54
| línea | cambio | por qué sobrevive |
|---|---|---|
| 1 | `/` → `*` en `#!/usr/bin/env node` | fallo del escáner: no saltaba la línea shebang. **Arreglado** (el shebang es comentario) y test añadido; ya no se genera. |
| 38 | `JSON.stringify(sorted, null, 2)` → `3`, `0`, `-2` | sangría del JSON: solo formato, el contenido es idéntico. |
| 64 | `process.argv[1]` → `[2]`, `[0]` | guarda de "¿me ejecutan como CLI?": solo comprueba que exista algo; equivalente. |
| 72 | `process.exit(r.ok ? 0 : 1)` (código de salida de `--check`) | no estaba cubierto → **test añadido** (`freeze --check` sale 1/0). |
| 76 | `process.exit(2)` (uso sin ficheros) | mensaje de uso; el código de salida no importa. |

## F1 (`shared/geometry.js`, `shared/rng.js`, `agents/lib.js`, `server/rooms.js` contra
`test/motor.spec.mjs`, muestra de 25 mutantes por fichero, semilla 7)
(pendiente: se rellena al terminar la tirada)
