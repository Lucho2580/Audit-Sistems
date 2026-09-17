import { useRef, useState } from 'react';
import { ProjectsApi, ProfilesApi } from '../lib/services';
import { downloadProjectImportTemplate, parseProjectImportFile, type ProjectImportRow } from '../lib/projectImport';
import type { ProfileLite } from '../types/domain';

interface Props {
  myOfficeProviderId: string | null;
  onClose: () => void;
  onImported: () => void;
}

interface ValidatedRow extends ProjectImportRow {
  jefes: ProfileLite[];
  responsable: ProfileLite | null;
  clientes: ProfileLite[];
  errors: string[];
}

type RowResult = { status: 'pending' | 'ok' | 'error'; message?: string };

function byEmail(list: ProfileLite[]): Map<string, ProfileLite> {
  return new Map(list.map((p) => [p.email.toLowerCase(), p]));
}

export default function ProjectImportModal({ myOfficeProviderId, onClose, onImported }: Props) {
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setFileError(null);
    setRows(null);
    setResults({});
    setValidating(true);
    try {
      const parsed = await parseProjectImportFile(file);
      if (!parsed.length) {
        setFileError('El archivo no tiene filas para importar (¿está vacío, o falta la hoja "Proyectos"?).');
        return;
      }

      const allJefeEmails = [...new Set(parsed.flatMap((r) => r.jefeEmails))];
      const allRespEmails = [...new Set(parsed.map((r) => r.responsableEmail).filter(Boolean))];
      const allClienteEmails = [...new Set(parsed.flatMap((r) => r.clienteEmails))];

      const [jefes, responsables, clientes] = await Promise.all([
        ProfilesApi.findByEmail(allJefeEmails, 'admin'),
        ProfilesApi.findByEmail(allRespEmails, 'desarrollador'),
        allClienteEmails.length ? ProfilesApi.findByEmail(allClienteEmails, 'cliente') : Promise.resolve([]),
      ]);
      const jefeMap = byEmail(jefes);
      const respMap = byEmail(responsables);
      const clienteMap = byEmail(clientes);

      const validated: ValidatedRow[] = parsed.map((r) => {
        const errors: string[] = [];
        if (!r.name) errors.push('Falta el nombre del proyecto.');

        const resolvedJefes = r.jefeEmails.map((e) => jefeMap.get(e.toLowerCase())).filter((p): p is ProfileLite => !!p);
        if (!r.jefeEmails.length) errors.push('Falta al menos un jefe.');
        else if (resolvedJefes.length < r.jefeEmails.length) {
          const missing = r.jefeEmails.filter((e) => !jefeMap.has(e.toLowerCase()));
          errors.push(`Jefe(s) no encontrados con rol admin: ${missing.join(', ')}`);
        }

        const resolvedResp = r.responsableEmail ? (respMap.get(r.responsableEmail.toLowerCase()) ?? null) : null;
        if (!r.responsableEmail) errors.push('Falta la persona asignada.');
        else if (!resolvedResp) errors.push(`Persona asignada no encontrada con rol desarrollador: ${r.responsableEmail}`);

        const resolvedClientes = r.clienteEmails.map((e) => clienteMap.get(e.toLowerCase())).filter((p): p is ProfileLite => !!p);
        if (resolvedClientes.length < r.clienteEmails.length) {
          const missing = r.clienteEmails.filter((e) => !clienteMap.has(e.toLowerCase()));
          errors.push(`Cliente(s) no encontrados con rol cliente: ${missing.join(', ')}`);
        }

        return { ...r, jefes: resolvedJefes, responsable: resolvedResp, clientes: resolvedClientes, errors };
      });

      setRows(validated);
    } catch (err) {
      setFileError((err as Error).message || 'No se pudo leer el archivo.');
    } finally {
      setValidating(false);
    }
  }

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? [];

  async function runImport() {
    if (!rows || !myOfficeProviderId) return;
    setImporting(true);
    const nextResults: Record<number, RowResult> = {};
    for (const r of rows) {
      if (r.errors.length) continue;
      nextResults[r.rowNumber] = { status: 'pending' };
      setResults({ ...nextResults });
      let createdId: string | null = null;
      try {
        const { id } = await ProjectsApi.create({ name: r.name, proveedor: 'MyOffice' });
        createdId = id;
        await ProjectsApi.setActors(id, { responsableId: r.responsable!.id, proveedorId: myOfficeProviderId });
        for (const jefe of r.jefes) await ProjectsApi.addJefe(id, jefe.id);
        for (const cliente of r.clientes) await ProjectsApi.addClient(id, cliente.id);
        nextResults[r.rowNumber] = { status: 'ok' };
      } catch (err) {
        // El proyecto ya se creó (create() no falló) pero un paso posterior sí
        // -- se revierte para no dejar un proyecto a medio armar, sin
        // responsable/jefes, invisible para casi todos y que además haría
        // que reintentar el mismo archivo genere un duplicado en vez de
        // completar el que falló.
        if (createdId) {
          try {
            await ProjectsApi.deleteProject(createdId);
          } catch {
            // Si ni siquiera se pudo borrar, se avisa igual con el error original;
            // el proyecto huérfano queda para revisión manual en el peor caso.
          }
        }
        nextResults[r.rowNumber] = { status: 'error', message: (err as Error).message };
      }
      setResults({ ...nextResults });
    }
    setImporting(false);
    onImported();
  }

  const doneCount = Object.values(results).filter((r) => r.status === 'ok').length;
  const failedCount = Object.values(results).filter((r) => r.status === 'error').length;
  const finished = rows && validRows.length > 0 && doneCount + failedCount === validRows.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Carga masiva</div>
            <h2 className="modal-title">Importar proyectos desde Excel</h2>
          </div>
          <button className="modal-close" title="Cerrar" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-intro">
            Descarga la plantilla, llénala con un proyecto por fila y súbela aquí. Cada correo debe
            ser una cuenta que ya exista en Herramientas, con el rol correspondiente.
          </p>

          <div className="import-actions">
            <button className="btn ghost small" onClick={() => downloadProjectImportTemplate()}>
              Descargar plantilla (.xlsx)
            </button>
            <button className="btn small" onClick={() => fileInputRef.current?.click()} disabled={validating || importing}>
              {validating ? 'Leyendo…' : 'Elegir archivo…'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {fileError && <div className="auth-error">{fileError}</div>}
          {!myOfficeProviderId && (
            <div className="auth-error">
              No se encontró el proveedor interno (MyOffice) -- revisa en Herramientas antes de importar.
            </div>
          )}

          {rows && (
            <>
              <p className="admin-hint">
                {validRows.length} de {rows.length} fila(s) listas para importar
                {rows.length - validRows.length > 0 && ` — ${rows.length - validRows.length} con errores (no se crean)`}.
              </p>
              <div className="import-table">
                <div className="import-row head">
                  <span>Fila</span><span>Proyecto</span><span>Jefes</span><span>Asignado</span><span>Clientes</span><span>Estado</span>
                </div>
                {rows.map((r) => {
                  const result = results[r.rowNumber];
                  return (
                    <div className={`import-row${r.errors.length ? ' error' : ''}`} key={r.rowNumber}>
                      <span className="proj-code">#{r.rowNumber}</span>
                      <span>{r.name || '(sin nombre)'}</span>
                      <span>{r.jefes.map((j) => j.fullName ?? j.email).join(', ') || '—'}</span>
                      <span>{r.responsable ? (r.responsable.fullName ?? r.responsable.email) : '—'}</span>
                      <span>{r.clientes.map((c) => c.fullName ?? c.email).join(', ') || '—'}</span>
                      <span>
                        {result?.status === 'ok' && <span className="status-pill tone-green">Creado</span>}
                        {result?.status === 'pending' && <span className="status-pill tone-gold">Creando…</span>}
                        {result?.status === 'error' && (
                          <span className="status-pill tone-rust" title={result.message}>Falló</span>
                        )}
                        {!result && r.errors.length > 0 && (
                          <span className="status-pill tone-rust" title={r.errors.join(' · ')}>Con errores</span>
                        )}
                        {!result && r.errors.length === 0 && <span className="status-pill tone-gold">Listo</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              {rows.some((r) => r.errors.length > 0) && (
                <ul className="import-error-list">
                  {rows.filter((r) => r.errors.length).map((r) => (
                    <li key={r.rowNumber}>
                      <b>Fila #{r.rowNumber}</b> ({r.name || 'sin nombre'}): {r.errors.join(' · ')}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="modal-foot-hint">
            {finished ? `Listo: ${doneCount} creados, ${failedCount} fallidos.` : 'Nada se crea hasta que confirmes.'}
          </span>
          <div className="modal-foot-actions">
            <button className="btn ghost" onClick={onClose}>{finished ? 'Cerrar' : 'Cancelar'}</button>
            {rows && !finished && (
              <button className="btn" onClick={runImport} disabled={importing || !validRows.length || !myOfficeProviderId}>
                {importing ? 'Importando…' : `Importar ${validRows.length} proyecto(s)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
