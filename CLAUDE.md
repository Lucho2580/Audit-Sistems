<!-- atlas:inicio -->
## Atlas: cómo trabajar en este repositorio

> Bloque generado por Atlas (`atlas init` / `atlas construir`). No lo edite: se reemplaza al reinstalar.
> Sus reglas van fuera del bloque o en `atlas.config.json` → `reglasProyecto`.

### 1. El grafo es la puerta de entrada
- Lea `docs/atlas/INDEX.md`; después, la ficha del módulo (`docs/atlas/modulos/<slug>.md`) y **solo** los archivos listados ahí.
- `npx atlas buscar <texto>` antes de cualquier Grep. Grep solo acotado a las carpetas del módulo.
- Archivos grandes por rangos de líneas. No relea lo que acaba de editar.
- `npx atlas impacto <archivo|módulo>` dice qué más se afecta y qué pruebas correr.

### 2. Verificación tras cada cambio
- Al terminar una implementación, y después de que terminen todos los agentes, lance el agente `verificador`.
- Si sale ROJO: corrija y vuelva a lanzar el `verificador` hasta VERDE.
- Para cambios solo de texto o documentación basta `npx atlas verificar`.

### 3. Encargos a agentes
- Cada agente recibe la ficha del módulo y los archivos exactos, con la prohibición de explorar fuera de ellos (plantilla en `docs/atlas/AHORRO-TOKENS.md`).
- Un agente por módulo; nunca dos agentes editando el mismo archivo.
- Modelo según la tarea: `haiku` para búsqueda y cambios mecánicos; `sonnet` para implementar; el principal para diseño, seguridad y depuración difícil.
- Informe de 20 líneas como máximo, sin código ni logs.
- Pruebas: solo las que indica `npx atlas impacto`.

### 4. Agentes instalados (`.claude/agents/`)
- `verificador` (sonnet): verificación VERDE/ROJO tras cada cambio. No corrige.
- `seguridad` (principal): revisa hallazgos de seguridad y descarta falsos positivos con evidencia. No edita.
- `explorador` (haiku): responde "¿dónde está X?" con el grafo y lecturas por rango.
<!-- atlas:fin -->
