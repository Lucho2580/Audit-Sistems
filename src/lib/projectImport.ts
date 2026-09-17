import * as XLSX from 'xlsx';

// Proveedor no va en la plantilla: MyOffice es el único proveedor interno y se
// resuelve solo (ver ProjectsList.tsx) -- no es algo que la persona que
// importa deba llenar.
const HEADERS = [
  'Nombre del proyecto',
  'Jefes (correos separados por coma)',
  'Persona asignada (correo)',
  'Clientes (correos separados por coma)',
] as const;

export interface ProjectImportRow {
  rowNumber: number; // fila real en el Excel (para que los errores señalen dónde mirar)
  name: string;
  jefeEmails: string[];
  responsableEmail: string;
  clienteEmails: string[];
}

// Genera y descarga la plantilla .xlsx que la importación masiva espera --
// mismo formato que después se sube y se lee. Vive en el código (no un
// archivo estático) para que nunca se desactualice si cambian las columnas.
export function downloadProjectImportTemplate(filename = 'plantilla_proyectos.xlsx') {
  const data = [
    [...HEADERS],
    ['Ej: Portal de clientes', 'jefe1@lavianda.co', 'dev1@lavianda.co', 'cliente1@empresa.com, cliente2@empresa.com'],
  ];
  const wsProjects = XLSX.utils.aoa_to_sheet(data);
  wsProjects['!cols'] = [{ wch: 32 }, { wch: 34 }, { wch: 30 }, { wch: 40 }];

  const wsInstrucciones = XLSX.utils.aoa_to_sheet([
    ['Instrucciones para importar proyectos'],
    [''],
    ['1. Usa la hoja "Proyectos". Borra la fila de ejemplo antes de importar (o déjala: se marcará como error y no se creará).'],
    ['2. Una fila = un proyecto nuevo.'],
    ['3. "Nombre del proyecto" es obligatorio.'],
    ['4. "Jefes" es obligatorio: al menos un correo. Si son varios, sepáralos con coma.'],
    ['5. "Persona asignada" es obligatorio: un solo correo.'],
    ['6. "Clientes" es opcional. Si son varios, sepáralos con coma. Déjalo vacío si el proyecto no tiene cliente todavía.'],
    ['7. Cada correo debe ser una cuenta que YA EXISTA en el sistema (Herramientas → Usuarios), con el rol correspondiente:'],
    ['   - Jefes: cuentas con rol "Jefe de proyecto" (admin).'],
    ['   - Persona asignada: cuenta con rol "Persona asignada" (desarrollador).'],
    ['   - Clientes: cuentas con rol "Cliente".'],
    ['8. El código del proyecto y las secciones del checklist se generan automáticamente, igual que al crear un proyecto desde el formulario.'],
    ['9. Si un correo no coincide con ninguna cuenta o con el rol esperado, esa fila se marca con error antes de importar y no se crea -- el resto de filas válidas sí se pueden importar.'],
  ]);
  wsInstrucciones['!cols'] = [{ wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsProjects, 'Proyectos');
  XLSX.utils.book_append_sheet(wb, wsInstrucciones, 'Instrucciones');
  XLSX.writeFile(wb, filename);
}

function splitEmails(cell: unknown): string[] {
  if (cell === null || cell === undefined) return [];
  return String(cell)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Lee el archivo subido y devuelve las filas ya separadas en campos -- sin
// validar todavía contra la base de datos (eso lo hace ProjectImportModal,
// que necesita resolver los correos contra profiles reales).
export async function parseProjectImportFile(file: File): Promise<ProjectImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets['Proyectos'] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  // Salta el encabezado (fila 1); XLSX numera desde 1, la fila 2 es la primera con datos.
  const rows: ProjectImportRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i] ?? [];
    const name = String(cells[0] ?? '').trim();
    const jefeEmails = splitEmails(cells[1]);
    const responsableEmail = String(cells[2] ?? '').trim();
    const clienteEmails = splitEmails(cells[3]);
    if (!name && !jefeEmails.length && !responsableEmail && !clienteEmails.length) continue; // fila vacía
    rows.push({ rowNumber: i + 1, name, jefeEmails, responsableEmail, clienteEmails });
  }
  return rows;
}
