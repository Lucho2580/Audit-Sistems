import { useState } from 'react';
import { EvidenceApi, ProjectsApi } from '../lib/services';
import { bandOf, type Section, type ChecklistItem } from '../types/domain';

interface Props {
  projectId: string; // para guardar los documentos de evidencia en <proyecto>/<hito>/
  section: Section;
  filterStatus: 'all' | 'pendiente' | 'progreso' | 'completo';
  canEdit: boolean; // agregar/eliminar checkpoints, aprobar seguimientos, notas de sección
  canEditPercent: boolean; // agregar observaciones de seguimiento (el % lo calcula el sistema)
  canReview: boolean; // aprobar/rechazar reportes de seguimiento -- rol QA o cuenta autorizada (la base lo exige igual)
  minDate: string | null; // fecha de inicio del proyecto -- límite inferior de la fecha límite de un checkpoint
  maxDate: string | null; // fecha de entrega esperada del proyecto -- límite superior
  onChanged: () => void;
}

const todayISO = new Date().toISOString().slice(0, 10);

function computeStats(items: ChecklistItem[]) {
  const total = items.length;
  const pct = total ? Math.round(items.reduce((a, i) => a + i.percent, 0) / total) : 0;
  return { total, pct };
}

export default function ChecklistSectionCard({ projectId, section, filterStatus, canEdit, canEditPercent, canReview, minDate, maxDate, onChanged }: Props) {
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  // Documento de evidencia elegido para el próximo seguimiento de cada hito.
  const [noteFiles, setNoteFiles] = useState<Record<string, File | null>>({});
  const [noteBusy, setNoteBusy] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [notes, setNotes] = useState(section.notes);
  // Reporte que QA está rechazando ahora mismo (uno a la vez) y su motivo.
  const [rejectingLogId, setRejectingLogId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const stats = computeStats(section.items);
  const visibleItems = section.items.filter(
    (it) => filterStatus === 'all' || bandOf(it.percent) === filterStatus,
  );

  function toggleHistory(id: string) {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function setDueDate(item: ChecklistItem, dueDate: string) {
    await ProjectsApi.setItemDueDate(item.id, dueDate || null);
    onChanged();
  }

  async function approveLog(logId: string) {
    setReviewBusy(true);
    try {
      await ProjectsApi.approveItemLog(logId);
      onChanged();
    } catch (err) {
      alert(`No se pudo aprobar el reporte: ${(err as Error).message}`);
    } finally {
      setReviewBusy(false);
    }
  }

  function startReject(logId: string) {
    setRejectingLogId(logId);
    setRejectReason('');
  }

  async function confirmReject(logId: string) {
    const reason = rejectReason.trim();
    if (reason.length < 5) {
      alert('Escribe el motivo del rechazo (mínimo 5 caracteres).');
      return;
    }
    setReviewBusy(true);
    try {
      await ProjectsApi.rejectItemLog(logId, reason);
      setRejectingLogId(null);
      setRejectReason('');
      onChanged();
    } catch (err) {
      alert(`No se pudo rechazar el reporte: ${(err as Error).message}`);
    } finally {
      setReviewBusy(false);
    }
  }

  async function deleteItem(item: ChecklistItem) {
    if (!confirm('¿Eliminar este checkpoint?')) return;
    await ProjectsApi.deleteItem(item.id);
    onChanged();
  }

  async function deleteLog(logId: string) {
    if (!confirm('¿Eliminar esta observación de seguimiento?')) return;
    await ProjectsApi.deleteItemLog(logId);
    onChanged();
  }

  async function addNote(item: ChecklistItem) {
    const text = (noteDrafts[item.id] ?? '').trim();
    const file = noteFiles[item.id] ?? null;
    if (!text && !file) return;
    setNoteBusy(item.id);
    try {
      const document = file ? await EvidenceApi.upload(projectId, item.id, file) : null;
      await ProjectsApi.addItemLog(item.id, text || `Documento de evidencia: ${file!.name}`, document);
      setNoteDrafts((d) => ({ ...d, [item.id]: '' }));
      setNoteFiles((f) => ({ ...f, [item.id]: null }));
      setOpenHistory((prev) => new Set(prev).add(item.id));
      onChanged();
    } catch (err) {
      alert(`No se pudo guardar el seguimiento: ${(err as Error).message}`);
    } finally {
      setNoteBusy(null);
    }
  }

  async function openDocument(path: string) {
    try {
      await EvidenceApi.open(path);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function addItem() {
    const text = newItemText.trim();
    if (!text) return;
    await ProjectsApi.addItem(section.id, { text });
    setNewItemText('');
    onChanged();
  }

  async function saveNotes() {
    await ProjectsApi.updateSectionNotes(section.id, notes);
  }

  return (
    <div className="section">
      <div className={`stamp ${stats.pct === 100 ? 'show' : ''}`}>
        APROBADO
        <br />
        {section.code}
      </div>
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">{section.code}</span>
          <h2>{section.title}</h2>
        </div>
        <div className="section-progress">
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${stats.pct}%` }} />
          </span>
          <span className="pct">{stats.pct}%</span>
        </div>
      </div>

      <ul className="items">
        {visibleItems.length === 0 && (
          <li className="item-block">
            <div className="item">
              <span className="item-text" style={{ color: 'var(--slate)', gridColumn: '1 / -1' }}>
                Sin checkpoints con estos filtros
              </span>
            </div>
          </li>
        )}
        {visibleItems.map((it) => {
          const band = bandOf(it.percent);
          return (
            <li className="item-block" key={it.id}>
              <div className="item">
                <span className="item-code">
                  {section.code}-{String(it.n).padStart(2, '0')}
                </span>
                <span className={`item-text ${band === 'completo' ? 'done' : ''}`}>
                  {it.text}
                  {(it.evidence || it.requiresDocument) && (
                    <span className="item-evidence">
                      {it.evidence && <>Evidencia de cierre: {it.evidence}</>}
                      {it.requiresDocument && <span className="doc-required-tag">Requiere documento</span>}
                    </span>
                  )}
                </span>
                <span className="item-actions">
                  <span className="resp-tag">{it.assignedToNombre ?? 'Sin asignar'}</span>
                  {canEdit ? (
                    <input
                      type="date"
                      className="due-date-input"
                      value={it.dueDate ?? ''}
                      min={minDate ?? undefined}
                      max={maxDate ?? undefined}
                      onChange={(e) => setDueDate(it, e.target.value)}
                      title="Fecha límite del checkpoint"
                    />
                  ) : it.dueDate ? (
                    <span className={`due-date-tag${band !== 'completo' && it.dueDate < todayISO ? ' overdue' : ''}`}>
                      {it.dueDate}
                    </span>
                  ) : null}
                  <span
                    className={`percent-select ${band}`}
                    title="Automático: 0% sin seguimiento (o todo rechazado), 50% con seguimiento pendiente de QA, 100% con seguimiento aprobado"
                  >
                    {it.percent}%
                  </span>
                  <button
                    className={`hist-btn ${it.log.length ? 'has-log' : ''}`}
                    onClick={() => toggleHistory(it.id)}
                  >
                    🕓 {it.log.length}
                  </button>
                  {canEdit && (
                    <button className="del-btn" title="Eliminar checkpoint" onClick={() => deleteItem(it)}>
                      ×
                    </button>
                  )}
                </span>
              </div>

              {openHistory.has(it.id) && (
                <div className="item-log">
                  {it.log.length ? (
                    it.log.map((l) => (
                      <div className="log-entry" key={l.id}>
                        <div className="log-entry-text">
                          <span className="log-date">
                            {new Date(l.createdAt).toLocaleString('es-ES', {
                              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          <span className="log-text">{l.text}</span>
                          {l.documentPath && (
                            <button type="button" className="log-doc-link" onClick={() => openDocument(l.documentPath!)}>
                              Ver documento{l.documentName ? `: ${l.documentName}` : ''}
                            </button>
                          )}
                          {it.requiresDocument && !l.documentPath && !l.qaApproved && (
                            <span className="log-doc-missing">Sin documento: no se puede aprobar</span>
                          )}
                          {l.qaApproved ? (
                            <span className="status-pill tone-green small" title={l.qaApprovedByNombre ? `Aprobado por ${l.qaApprovedByNombre}` : undefined}>
                              Aprobado
                            </span>
                          ) : l.qaRejectedAt ? (
                            <span className="status-pill tone-rust small" title={l.qaRejectedByNombre ? `Rechazado por ${l.qaRejectedByNombre}` : undefined}>
                              Rechazado
                            </span>
                          ) : (
                            <span className="status-pill tone-gold small">Pendiente de aprobación QA</span>
                          )}
                          {l.qaRejectedAt && l.qaRejectionReason && (
                            <span className="log-reject-reason">
                              <strong>Motivo del rechazo{l.qaRejectedByNombre ? ` (${l.qaRejectedByNombre})` : ''}:</strong>{' '}
                              {l.qaRejectionReason}
                            </span>
                          )}
                          {rejectingLogId === l.id && (
                            <div className="log-reject-form">
                              <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="¿Por qué se rechaza este reporte? La persona asignada verá este motivo."
                                autoFocus
                              />
                              <div className="log-reject-form-actions">
                                <button className="btn small danger" onClick={() => confirmReject(l.id)} disabled={reviewBusy}>
                                  Confirmar rechazo
                                </button>
                                <button className="btn ghost small" onClick={() => setRejectingLogId(null)} disabled={reviewBusy}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="log-entry-actions">
                          {canReview && !l.qaApproved && rejectingLogId !== l.id && (
                            <button className="btn ghost small" onClick={() => approveLog(l.id)} disabled={reviewBusy}>
                              Aprobar
                            </button>
                          )}
                          {canReview && !l.qaRejectedAt && rejectingLogId !== l.id && (
                            <button className="btn danger small" onClick={() => startReject(l.id)} disabled={reviewBusy}>
                              Rechazar
                            </button>
                          )}
                          {canEdit && (
                            <button className="del-btn tiny" title="Eliminar" onClick={() => deleteLog(l.id)}>
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="log-empty">Sin observaciones registradas todavía.</div>
                  )}
                  {canEditPercent && (
                    <div className="note-form">
                      <textarea
                        value={noteDrafts[it.id] ?? ''}
                        onChange={(e) => setNoteDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                        placeholder="Agregar observación de seguimiento…"
                      />
                      <div className="note-form-side">
                        <label className="note-file">
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"
                            onChange={(e) => setNoteFiles((f) => ({ ...f, [it.id]: e.target.files?.[0] ?? null }))}
                          />
                          <span>{noteFiles[it.id]?.name ?? (it.requiresDocument ? 'Adjuntar documento (exigido)' : 'Adjuntar documento')}</span>
                        </label>
                        <button className="btn small" onClick={() => addNote(it)} disabled={noteBusy === it.id}>
                          {noteBusy === it.id ? 'Guardando…' : 'Agregar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="add-row">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder={`Nuevo checkpoint para ${section.title.toLowerCase()}…`}
          />
          <button className="btn small" onClick={addItem}>
            Agregar
          </button>
        </div>
      )}

      <div className="notes">
        <div className="label">Notas generales — {section.title}</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Observaciones generales de la sección…"
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}
