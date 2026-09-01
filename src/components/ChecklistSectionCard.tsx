import { useState } from 'react';
import { ProjectsApi } from '../lib/services';
import {
  PERCENT_OPTIONS, RESP_LABEL, bandOf,
  type Section, type ChecklistItem, type ItemResponsible,
} from '../types/domain';

interface Props {
  section: Section;
  filterStatus: 'all' | 'pendiente' | 'progreso' | 'completo';
  filterResp: 'all' | ItemResponsible;
  canEdit: boolean; // agregar/eliminar checkpoints, alternar responsable
  canEditPercent: boolean; // actualizar avance, notas y observaciones
  onChanged: () => void;
}

function computeStats(items: ChecklistItem[]) {
  const total = items.length;
  const pct = total ? Math.round(items.reduce((a, i) => a + i.percent, 0) / total) : 0;
  return { total, pct };
}

export default function ChecklistSectionCard({ section, filterStatus, filterResp, canEdit, canEditPercent, onChanged }: Props) {
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [pendingObs, setPendingObs] = useState<{ id: string; newPercent: number } | null>(null);
  const [obsText, setObsText] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [newItemText, setNewItemText] = useState('');
  const [newItemResp, setNewItemResp] = useState<ItemResponsible>('cliente');
  const [notes, setNotes] = useState(section.notes);

  const stats = computeStats(section.items);
  const visibleItems = section.items.filter(
    (it) =>
      (filterStatus === 'all' || bandOf(it.percent) === filterStatus) &&
      (filterResp === 'all' || it.resp === filterResp),
  );

  function toggleHistory(id: string) {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handlePercentChange(item: ChecklistItem, newPercent: number) {
    if (item.percent === 100 && newPercent !== 100) {
      setPendingObs({ id: item.id, newPercent });
      setObsText('');
      return;
    }
    await ProjectsApi.updateItemPercent(item.id, newPercent);
    onChanged();
  }

  async function saveObs(item: ChecklistItem) {
    if (!pendingObs) return;
    if (!obsText.trim()) {
      alert('Escribe una observación antes de guardar el cambio.');
      return;
    }
    await ProjectsApi.updateItemPercent(item.id, pendingObs.newPercent, obsText.trim());
    setPendingObs(null);
    setOpenHistory((prev) => new Set(prev).add(item.id));
    onChanged();
  }

  async function toggleResp(item: ChecklistItem) {
    await ProjectsApi.toggleResp(item.id, item.resp);
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
    onChanged();
  }

  async function addItem() {
    const text = newItemText.trim();
    if (!text) return;
    await ProjectsApi.addItem(section.id, { text, resp: newItemResp });
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
              <span className="item-text" style={{ color: 'var(--slate)' }}>
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
                <span
                  className={`resp-tag ${it.resp}`}
                  onClick={() => canEdit && toggleResp(it)}
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                >
                  {RESP_LABEL[it.resp]}
                </span>
                <select
                  className={`percent-select ${band}`}
                  value={it.percent}
                  disabled={!canEditPercent}
                  onChange={(e) => handlePercentChange(it, Number(e.target.value))}
                >
                  {PERCENT_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
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
              </div>

              {pendingObs?.id === it.id && (
                <div className="force-obs">
                  <div className="msg">
                    Este checkpoint está completo (100%). Registra una observación de seguimiento
                    para cambiarlo a {pendingObs.newPercent}%.
                  </div>
                  <textarea
                    value={obsText}
                    onChange={(e) => setObsText(e.target.value)}
                    placeholder="Describe qué motivó este cambio…"
                  />
                  <div className="actions">
                    <button className="btn ghost small" onClick={() => setPendingObs(null)}>
                      Cancelar
                    </button>
                    <button className="btn small" onClick={() => saveObs(it)}>
                      Guardar y aplicar cambio
                    </button>
                  </div>
                </div>
              )}

              {!pendingObs && openHistory.has(it.id) && (
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
                        </div>
                        {canEdit && (
                          <button className="del-btn tiny" title="Eliminar" onClick={() => deleteLog(l.id)}>
                            ×
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="log-empty">Sin observaciones registradas todavía.</div>
                  )}
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
          <select value={newItemResp} onChange={(e) => setNewItemResp(e.target.value as ItemResponsible)}>
            <option value="cliente">Cliente</option>
            <option value="desarrollador">Desarrollador</option>
          </select>
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
          disabled={!canEditPercent}
        />
      </div>
    </div>
  );
}
