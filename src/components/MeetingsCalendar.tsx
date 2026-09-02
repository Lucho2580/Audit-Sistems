import { useMemo, useState } from 'react';
import { MeetingsApi, DailyNotesApi, type DirectoryUser } from '../lib/services';
import { generateMeetingMinutesPdf } from '../lib/pdf';
import { MEETING_STATE_META, type DailyNote, type Meeting, type MeetingState, type Project } from '../types/domain';
import DirectorySearch from './DirectorySearch';

const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAY_LABELS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

interface Props {
  project: Project;
  meetings: Meeting[];
  dailyNotes: DailyNote[];
  canEdit: boolean;
  onChanged: () => void;
}

export default function MeetingsCalendar({ project, meetings, dailyNotes, canEdit, onChanged }: Props) {
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState({ date: todayISO(), time: '10:00', title: '' });
  const [newParticipants, setNewParticipants] = useState<DirectoryUser[]>([]);
  const [docDrafts, setDocDrafts] = useState<Record<string, Partial<Meeting>>>({});
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);
  const [creatingTeamsFor, setCreatingTeamsFor] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteForm, setNoteForm] = useState({ date: todayISO(), text: '' });
  const [savingNote, setSavingNote] = useState(false);

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const totalDays = new Date(y, m + 1, 0).getDate();
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const trailing = (7 - ((startOffset + totalDays) % 7)) % 7;

  const cells = useMemo(() => {
    const arr: { day: number | null; date: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) arr.push({ day: null, date: null });
    for (let d = 1; d <= totalDays; d++) {
      arr.push({ day: d, date: `${y}-${pad2(m + 1)}-${pad2(d)}` });
    }
    for (let i = 0; i < trailing; i++) arr.push({ day: null, date: null });
    return arr;
  }, [y, m, totalDays, startOffset, trailing]);

  const visibleMeetings = (selectedDay ? meetings.filter((mt) => mt.date === selectedDay) : meetings)
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const visibleNotes = (selectedDay ? dailyNotes.filter((n) => n.date === selectedDay) : dailyNotes)
    .slice()
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  function meetingDoc(mt: Meeting) {
    return { ...mt, ...docDrafts[mt.id] };
  }

  async function createMeeting() {
    if (!formState.date) { alert('Selecciona una fecha para la reunión.'); return; }
    const created = await MeetingsApi.create(project.id, {
      date: formState.date, time: formState.time, title: formState.title.trim(),
      participants: newParticipants.map((u) => ({ label: u.name, email: u.email })),
    });
    setShowForm(false);
    setNewParticipants([]);
    setFormState({ date: todayISO(), time: '10:00', title: '' });
    onChanged();
    setCreatingTeamsFor(created.id);
    try {
      await MeetingsApi.createTeamsMeeting(created.id);
    } catch (err) {
      alert(`La reunión quedó agendada, pero no se pudo crear el evento de Teams: ${(err as Error).message}`);
    } finally {
      setCreatingTeamsFor(null);
      onChanged();
    }
  }

  async function addParticipant(mt: Meeting, user: DirectoryUser) {
    await MeetingsApi.addParticipant(mt.id, user.name, user.email);
    onChanged();
  }

  async function removeParticipant(participantId: string) {
    await MeetingsApi.removeParticipant(participantId);
    onChanged();
  }

  async function setMeetingState(mt: Meeting, state: MeetingState) {
    await MeetingsApi.updateState(mt.id, state);
    onChanged();
    if (state === 'realizada') {
      setNotifying(mt.id);
      try {
        const result = await MeetingsApi.notifySignatures(mt.id);
        if (result.failed.length) {
          alert(
            `Se enviaron ${result.sent} correo(s) de firma. Fallaron: ${result.failed.join(', ')}.`,
          );
        } else if (result.sent === 0) {
          alert('La reunión quedó como "Realizada", pero ningún participante tiene correo registrado para enviarle el enlace de firma.');
        }
      } catch (err) {
        alert(`La reunión quedó como "Realizada", pero no se pudo enviar el correo de firma: ${(err as Error).message}`);
      } finally {
        setNotifying(null);
      }
    }
  }

  async function deleteMeeting(mt: Meeting) {
    if (!confirm('¿Eliminar esta reunión y su documento asociado?')) return;
    await MeetingsApi.deleteMeeting(mt.id);
    onChanged();
  }

  async function saveDocAndGeneratePdf(mt: Meeting) {
    const draft = docDrafts[mt.id] ?? {};
    const saved = await MeetingsApi.updateDoc(mt.id, {
      topics: draft.topics ?? mt.topics,
      agreements: draft.agreements ?? mt.agreements,
      risks: draft.risks ?? mt.risks,
      nextSteps: draft.nextSteps ?? mt.nextSteps,
    });
    generateMeetingMinutesPdf(project, saved);
    onChanged();
  }

  async function addDailyNote() {
    if (!noteForm.date) { alert('Selecciona una fecha para la nota de seguimiento.'); return; }
    if (!noteForm.text.trim()) { alert('Escribe una nota de seguimiento antes de guardarla.'); return; }
    setSavingNote(true);
    try {
      await DailyNotesApi.create(project.id, noteForm.date, noteForm.text.trim());
      setShowNoteForm(false);
      setNoteForm({ date: todayISO(), text: '' });
      onChanged();
    } catch (err) {
      alert(`No se pudo guardar la nota de seguimiento: ${(err as Error).message}`);
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteDailyNote(note: DailyNote) {
    if (!confirm('¿Eliminar esta nota de seguimiento?')) return;
    await DailyNotesApi.remove(note.id);
    onChanged();
  }

  async function copySignLink(participantId: string) {
    let link: string;
    try {
      link = await MeetingsApi.getSignLink(participantId);
    } catch (err) {
      alert(`No se pudo obtener el enlace de firma: ${(err as Error).message}`);
      return;
    }
    navigator.clipboard?.writeText(link).then(
      () => { setCopiedFor(participantId); setTimeout(() => setCopiedFor(null), 1400); },
      () => prompt('Copia este enlace de firma:', link),
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">CAL</span>
          <h2>Calendario de reuniones y seguimiento</h2>
        </div>
      </div>
      <div className="cal-header">
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={() => setCalMonth(new Date(y, m - 1, 1))}>‹</button>
          <span className="cal-month-label">{MONTH_LABELS[m]} {y}</span>
          <button className="cal-nav-btn" onClick={() => setCalMonth(new Date(y, m + 1, 1))}>›</button>
        </div>
        <div className="cal-legend">
          <span><span className="dot" style={{ background: 'var(--blue)' }} />Programada</span>
          <span><span className="dot" style={{ background: 'var(--gold)' }} />Reprogramada</span>
          <span><span className="dot" style={{ background: 'var(--green)' }} />Realizada</span>
          <span><span className="dot" style={{ background: 'var(--rust)' }} />No realizada</span>
          <span><span className="dot dot-square" style={{ background: 'var(--ink)' }} />Seguimiento diario</span>
        </div>
      </div>
      <div className="cal-grid">
        {DAY_LABELS.map((l) => (
          <div className="cal-daylabel" key={l}>{l}</div>
        ))}
        {cells.map((c, idx) => {
          if (c.date === null) return <div className="cal-day empty" key={idx} />;
          const dayMeetings = meetings.filter((mt) => mt.date === c.date);
          const dayNotes = dailyNotes.filter((n) => n.date === c.date);
          return (
            <div
              key={c.date}
              className={`cal-day ${selectedDay === c.date ? 'selected' : ''}`}
              onClick={() => setSelectedDay((prev) => (prev === c.date ? null : c.date))}
            >
              <span className="daynum">{c.day}</span>
              <div className="cal-dots">
                {dayMeetings.map((mt) => (
                  <span className={`cal-dot ${mt.state}`} key={mt.id} />
                ))}
                {dayNotes.length > 0 && <span className="cal-dot dot-square note-dot" title="Seguimiento diario" />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="meeting-toolbar">
        <span className="filter-note">
          {selectedDay ? (
            <>
              Mostrando el {selectedDay} ·{' '}
              <button onClick={() => setSelectedDay(null)}>ver todo</button>
            </>
          ) : (
            'Mostrando todo el proyecto'
          )}
        </span>
        <span className="toolbar-actions">
          {canEdit && (
            <button className="btn small" onClick={() => setShowForm((s) => !s)}>
              {showForm ? 'Cancelar' : '+ Agendar reunión'}
            </button>
          )}
          {canEdit && (
            <button className="btn small ghost" onClick={() => setShowNoteForm((s) => !s)}>
              {showNoteForm ? 'Cancelar' : '+ Nota de seguimiento'}
            </button>
          )}
        </span>
      </div>

      {showForm && (
        <div className="meeting-form">
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              value={formState.date}
              onChange={(e) => setFormState({ ...formState, date: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Hora</label>
            <input
              type="time"
              value={formState.time}
              onChange={(e) => setFormState({ ...formState, time: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Motivo / título</label>
            <input
              type="text"
              value={formState.title}
              onChange={(e) => setFormState({ ...formState, title: e.target.value })}
              placeholder="Ej. Revisión de avance"
            />
          </div>
          <div className="field">
            <label>Participantes</label>
            <DirectorySearch
              placeholder="Buscar persona en Entra ID…"
              onSelect={(u) => {
                if (newParticipants.some((p) => p.id === u.id)) return;
                setNewParticipants((arr) => [...arr, u]);
              }}
            />
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {newParticipants.length ? (
                newParticipants.map((p) => (
                  <span className="participant-chip" key={p.id}>
                    {p.name}
                    <button
                      type="button"
                      onClick={() => setNewParticipants((arr) => arr.filter((x) => x.id !== p.id))}
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="participant-empty">Sin participantes aún</span>
              )}
            </div>
          </div>
          <button className="btn small" onClick={createMeeting}>Agendar</button>
        </div>
      )}

      {showNoteForm && (
        <div className="meeting-form">
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              value={noteForm.date}
              onChange={(e) => setNoteForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className="field full">
            <label>Nota de seguimiento</label>
            <textarea
              value={noteForm.text}
              onChange={(e) => setNoteForm((f) => ({ ...f, text: e.target.value }))}
              placeholder="Ej. Se resolvió el bloqueo de ambiente de pruebas con el proveedor"
            />
          </div>
          <button className="btn small" onClick={addDailyNote} disabled={savingNote}>
            {savingNote ? 'Guardando…' : 'Agregar nota'}
          </button>
        </div>
      )}

      <div className="meetings-list">
        {visibleMeetings.length === 0 ? (
          <div className="empty-state">No hay reuniones agendadas.</div>
        ) : (
          visibleMeetings.map((mt) => {
            const draft = meetingDoc(mt);
            const docOpen = openDocs.has(mt.id);
            return (
              <div className="meeting-row" key={mt.id}>
                <div className="meeting-main">
                  <span className="meeting-date">{mt.date} · {mt.time}</span>
                  <span className="meeting-title">{mt.title || 'Reunión de seguimiento'}</span>
                  <select
                    className={`status-select ${mt.state}`}
                    value={mt.state}
                    disabled={!canEdit || notifying === mt.id}
                    onChange={(e) => setMeetingState(mt, e.target.value as MeetingState)}
                  >
                    {Object.entries(MEETING_STATE_META).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  {notifying === mt.id && <span className="meeting-notifying">Enviando enlaces de firma…</span>}
                  {creatingTeamsFor === mt.id && <span className="meeting-notifying">Creando reunión de Teams…</span>}
                  {mt.teamsJoinUrl && (
                    <a className="btn small ghost" href={mt.teamsJoinUrl} target="_blank" rel="noreferrer">
                      🎥 Unirse en Teams
                    </a>
                  )}
                  <button
                    className="btn small ghost"
                    onClick={() =>
                      setOpenDocs((prev) => {
                        const next = new Set(prev);
                        next.has(mt.id) ? next.delete(mt.id) : next.add(mt.id);
                        return next;
                      })
                    }
                  >
                    📄 Documento
                  </button>
                  {canEdit && (
                    <button className="del-btn" title="Eliminar reunión" onClick={() => deleteMeeting(mt)}>×</button>
                  )}
                </div>
                <div className="meeting-participants">
                  <span className="plabel">Participantes:</span>
                  {mt.participants.length ? (
                    mt.participants.map((p) => (
                      <span className={`participant-chip ${p.signature ? 'signed' : ''}`} key={p.id}>
                        {p.signature ? '✓ ' : ''}{p.label}
                        {canEdit && (
                          <button
                            className="link-btn"
                            title="Copiar enlace de firma para este participante"
                            onClick={() => copySignLink(p.id)}
                          >
                            {copiedFor === p.id ? '✓' : '🔗'}
                          </button>
                        )}
                        {canEdit && (
                          <button title="Quitar participante" onClick={() => removeParticipant(p.id)}>×</button>
                        )}
                      </span>
                    ))
                  ) : (
                    <span className="participant-empty">Sin participantes agregados</span>
                  )}
                  {canEdit && (
                    <span className="participant-add">
                      <DirectorySearch
                        placeholder="Buscar persona en Entra ID…"
                        onSelect={(u) => addParticipant(mt, u)}
                      />
                    </span>
                  )}
                </div>
                {docOpen && (
                  <div className="meeting-doc">
                    <div className="meeting-doc-grid">
                      <div className="field full">
                        <label>Temas tratados</label>
                        <textarea
                          value={draft.topics}
                          onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], topics: e.target.value } }))}
                        />
                      </div>
                      <div className="field full">
                        <label>Acuerdos y compromisos</label>
                        <textarea
                          value={draft.agreements}
                          onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], agreements: e.target.value } }))}
                        />
                      </div>
                      <div className="field">
                        <label>Riesgos u observaciones</label>
                        <textarea
                          value={draft.risks}
                          onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], risks: e.target.value } }))}
                        />
                      </div>
                      <div className="field">
                        <label>Próximos pasos</label>
                        <textarea
                          value={draft.nextSteps}
                          onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], nextSteps: e.target.value } }))}
                        />
                      </div>
                    </div>
                    <div className="actions">
                      <button className="btn small" onClick={() => saveDocAndGeneratePdf(mt)}>
                        Generar documento (PDF) ↓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="daily-notes-section">
        <div className="daily-notes-title">Seguimiento diario</div>
        {visibleNotes.length === 0 ? (
          <div className="empty-state">Sin notas de seguimiento todavía.</div>
        ) : (
          <div className="daily-notes-list">
            {visibleNotes.map((n) => (
              <div className="log-entry" key={n.id}>
                <div className="log-entry-text">
                  <span className="log-date">
                    {new Date(n.date + 'T00:00:00').toLocaleDateString('es-ES', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                    })}
                    {n.authorEmail ? ` · ${n.authorEmail}` : ''}
                  </span>
                  <span className="log-text">{n.note}</span>
                </div>
                {canEdit && (
                  <button className="del-btn tiny" title="Eliminar" onClick={() => deleteDailyNote(n)}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
