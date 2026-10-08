import { useState } from 'react';
import { ProjectsApi } from '../lib/services';
import { bandOf, type Section, type ChecklistItem } from '../types/domain';

interface Props {
  section: Section;
  filterStatus: 'all' | 'pendiente' | 'progreso' | 'completo';
  canEdit: boolean; // agregar/eliminar checkpoints, aprobar seguimientos, notas de sección
  canEditPercent: boolean; // agregar observaciones de seguimiento (el % lo calcula el sistema)
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

export default function ChecklistSectionCard({ section, filterStatus, canEdit, canEditPercent, minDate, maxDate, onChanged }: Props) {
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [newItemText, setNewItemText] = useState('');
  const [notes, setNotes] = useState(section.notes);

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
    await ProjectsApi.approveItemLog(logId);
    onChanged();
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
    if (!text) return;
    await ProjectsApi.addItemLog(item.id, text);
    setNoteDrafts((d) => ({ ...d, [item.id]: '' }));
    setOpenHistory((prev) => new Set(prev).add(item.id));
    onChanged();
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
                <span className={`item-text ${band === 'completo' ? 'done' : ''}`}>{it.text}</span>
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
                    title="Automático: 0% sin seguimiento, 50% con seguimiento pendiente de QA, 100% con seguimiento aprobado"
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
                          {l.qaApproved ? (
                            <span className="status-pill tone-green small" title={l.qaApprovedByNombre ? `Aprobado por ${l.qaApprovedByNombre}` : undefined}>
                              Aprobado
                            </span>
                          ) : (
                            <span className="status-pill tone-gold small">Pendiente de aprobación QA</span>
                          )}
                        </div>
                        <div className="log-entry-actions">
                          {canEdit && !l.qaApproved && (
                            <button className="btn ghost small" onClick={() => approveLog(l.id)}>
                              Aprobar
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
                      <button className="btn small" onClick={() => addNote(it)}>
                        Agregar
                      </button>
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
