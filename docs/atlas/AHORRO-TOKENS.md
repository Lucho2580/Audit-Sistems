<!-- Generado por Atlas. No editar a mano. -->
# Ahorro de tokens con Atlas

## Estrategia

1. **Entrada única por el grafo.** `docs/atlas/INDEX.md` (≤ 1500 tokens) → ficha del módulo (≤ 1500 tokens) → solo los archivos listados. Leer un módulo entero "por si acaso" cuesta 10–50 veces más.
2. **Buscar antes de explorar.** `npx atlas buscar` responde con `archivo:línea` en una sola llamada; Grep sin acotar devuelve cientos de líneas irrelevantes.
3. **Leer por rangos.** En archivos de más de ~200 líneas, leer solo el rango que importa. No releer lo que se acaba de editar: la herramienta de edición ya confirma el cambio.
4. **Impacto en vez de suposición.** `npx atlas impacto` dice qué módulos y pruebas toca un cambio; no correr la suite completa salvo que lo indique.
5. **Agentes con contexto cerrado.** Un agente por módulo, con la ficha y la lista exacta de archivos. Informe corto. El agente principal no relee lo que el agente ya resumió.
6. **Modelo adecuado.** El modelo más barato que resuelva la tarea.

| Tarea | Modelo | Contexto que recibe |
|---|---|---|
| ¿Dónde está X? / cambios mecánicos | `haiku` (agente `explorador`) | resultado de `atlas buscar` + rangos |
| Implementar en un módulo | `sonnet` | ficha + archivos exactos |
| Verificar | `sonnet` (agente `verificador`) | salida de `atlas verificar` + diff |
| Diseño, seguridad, depuración difícil | principal | fichas de los módulos implicados |

## Plantilla de encargo para agentes

Copie y complete. Todo lo que esté entre `<>` sale de la ficha del módulo y de `npx atlas impacto`.

```text
Eres el agente de <implementación|búsqueda|pruebas> del módulo `<slug>`.

CONTEXTO (no explores fuera de esto)
- Ficha: docs/atlas/modulos/<slug>.md
- Archivos que puedes leer y editar:
  - <ruta/archivo-1>
  - <ruta/archivo-2>
- Solo lectura (si hace falta): <ruta/archivo-3> líneas <a>-<b>
- Antes de cambiar: <copiar de la ficha>
- Reglas del proyecto: ver CLAUDE.md

TAREA
<objetivo concreto y criterio de terminado>

RESTRICCIONES
- No leas ni edites archivos fuera de la lista. Si necesitas otro, detente y dilo en el informe.
- Usa `npx atlas buscar` en vez de Grep. Lee por rangos. No releas lo que acabas de editar.
- Pruebas: solo `<comandos de atlas impacto>`.
- Ningún otro agente edita estos archivos.

INFORME (máximo 20 líneas, sin código ni logs)
- Qué cambió (archivo:línea) y por qué.
- Pruebas corridas y resultado (totales).
- Dudas, bloqueos o archivos extra que necesitarías.
```
