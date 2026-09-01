import { useEffect, useState } from 'react';
import { AuditApi } from '../lib/services';
import type { AuditLogEntry } from '../types/domain';

const ACTION_LABEL: Record<AuditLogEntry['action'], string> = {
  create: 'Creación',
  update: 'Actualización',
  delete: 'Eliminación',
  status_change: 'Cambio de estado',
  sign: 'Firma',
};

const ENTITY_LABEL: Record<string, string> = {
  project: 'Proyecto',
  section: 'Sección',
  checklist_item: 'Checkpoint',
  item_log: 'Observación',
  meeting: 'Reunión',
  participant: 'Participante',
};

function describe(entry: AuditLogEntry): string {
  const entity = ENTITY_LABEL[entry.entityType] ?? entry.entityType;
  if (entry.action === 'sign') return `${entity} firmó el acta`;
  if (entry.action === 'status_change') {
    const before = (entry.before as any)?.status ?? (entry.before as any)?.state;
    const after = (entry.after as any)?.status ?? (entry.after as any)?.state;
    return `${entity}: estado cambió de "${before}" a "${after}"`;
  }
  if (entry.action === 'create') return `${entity} creado`;
  if (entry.action === 'delete') return `${entity} eliminado`;
  if (entry.after && 'percent' in (entry.after as any)) {
    return `${entity}: avance actualizado a ${(entry.after as any).percent}%`;
  }
  return `${entity} actualizado`;
}

export default function AuditHistoryPanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) AuditApi.byProject(projectId).then(setEntries);
  }, [open, projectId]);

  return (
    <div className="section">
      <div className="section-head" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div className="title-block">
          <span className="code-tag">LOG</span>
          <h2>Historial de auditoría</h2>
        </div>
        <button className="btn ghost small">{open ? 'Ocultar' : 'Ver historial'}</button>
      </div>
      {open && (
        <div className="audit-panel">
          {entries.length === 0 ? (
            <div className="empty-state">Sin movimientos registrados todavía.</div>
          ) : (
            entries.map((e) => (
              <div className="audit-row" key={e.id}>
                <span className="audit-date">
                  {new Date(e.createdAt).toLocaleString('es-ES', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="audit-action">{ACTION_LABEL[e.action]}</span>
                <span className="audit-desc">{describe(e)}</span>
                <span className="audit-actor">{e.actorEmail ?? 'enlace público'}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
