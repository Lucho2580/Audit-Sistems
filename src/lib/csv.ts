import { STATUS_META, type Project } from '../types/domain';

const CSV_HEADERS = [
  'codigo',
  'nombre',
  'proveedor',
  'estado',
  'avance_pct',
  'fecha_creacion',
  'fecha_entrega',
  'fecha_entrega_final',
  'dias_atraso',
  'observacion_final',
];

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  // BOM para que Excel detecte UTF-8 correctamente (tildes, ñ, etc.)
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportProjectsCsv(projects: Project[], filename = 'proyectos.csv') {
  const rows: string[][] = [CSV_HEADERS];
  for (const p of projects) {
    rows.push([
      p.code,
      p.name,
      p.proveedor,
      STATUS_META[p.status],
      String(p.stats?.pct ?? 0),
      p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '',
      p.deliveryDate ?? '',
      p.finalDeliveryDate ?? '',
      String(p.delayDays ?? 0),
      p.finalObservation ?? '',
    ]);
  }
  downloadCsv(filename, rows);
}

export function downloadCsvTemplate(filename = 'plantilla_proyectos.csv') {
  const rows: string[][] = [
    CSV_HEADERS,
    [
      'PRJ-001',
      'Portal de clientes',
      'MyOffice',
      'Levantamiento',
      '0',
      '2026-01-15',
      '',
      '',
      '0',
      '',
    ],
  ];
  downloadCsv(filename, rows);
}
