import { useMemo, useState } from 'react';
import { MeetingsApi, DailyNotesApi, ProfilesApi, ActasApi, type DirectoryUser } from '../lib/services';
import { generateMeetingActaPdf } from '../lib/acta';
import { MEETING_STATE_META, type Compromiso, type DailyNote, type Meeting, type MeetingState, type Participant, type Project } from '../types/domain';
import { useAuth } from '../context/AuthContext';
import DirectorySearch from './DirectorySearch';

const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAY_LABELS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const ROLE_ORDER = ['Jefe de proyecto', 'Cliente', 'Persona asignada', 'Proveedor', 'Invitado'];
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
  // Además de canEdit (jefe/superadmin), la persona asignada también puede
  // dejar registrada una reunión que ella misma llevó -- para eso es este
  // formulario "manual" (sin agendar en Teams), separado de "+ Agendar
  // reunión" que sí crea el evento de Teams y es exclusivo de canEdit.
  canRegisterMeeting: boolean;
  onChanged: () => void;
}

export default function MeetingsCalendar({ project, meetings, dailyNotes, canEdit, canRegisterMeeting, onChanged }: Props) {
  const { profile } = useAuth();
  const myEmail = profile?.email?.toLowerCase();
  const [signingFor, setSigningFor] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState({ date: todayISO(), time: '10:00', title: '', agenda: '' });
  const [newParticipants, setNewParticipants] = useState<DirectoryUser[]>([]);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [actorEmails, setActorEmails] = useState<Record<string, string>>({});
  const [docDrafts, setDocDrafts] = useState<Record<string, Partial<Meeting>>>({});
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);
  const [creatingTeamsFor, setCreatingTeamsFor] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteForm, setNoteForm] = useState({ date: todayISO(), text: '' });
  const [savingNote, setSavingNote] = useState(false);
  const [generatingActaFor, setGeneratingActaFor] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualFormState, setManualFormState] = useState({ date: todayISO(), time: '10:00', title: '', modalidad: 'Microsoft Teams' });
  const [manualParticipants, setManualParticipants] = useState<DirectoryUser[]>([]);
  const [showManualAddParticipant, setShowManualAddParticipant] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

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

  // Identifica el rol de un participante comparando su nombre contra los
  // actores fijos del proyecto -- quien no coincide con ninguno es un
  // invitado externo agregado a mano o desde Entra ID.
  function roleForParticipant(label: string): string {
    if (project.jefes.some((j) => j.nombre === label)) return 'Jefe de proyecto';
    if (label === project.responsableNombre) return 'Persona asignada';
    if (label === project.proveedor) return 'Proveedor';
    if (project.clientes.some((c) => c.nombre === label)) return 'Cliente';
    return 'Invitado';
  }

  // Jefe, persona asignada, proveedor y cliente son participantes fijos de
  // la reunión -- se toman siempre del proyecto (así que si cambia quién es
  // la persona asignada o el cliente, la próxima reunión ya sale con el
  // actor correcto) y no se pueden quitar desde este formulario. El correo
  // de jefe/responsable/cliente se busca aparte porque el proyecto solo
  // trae su nombre; el proveedor no tiene cuenta, así que queda sin correo
  // (se puede compartir el enlace de firma a mano). El cliente SÍ necesita
  // su correo real: es quien firma desde su portal.
  const fixedParticipants = useMemo<DirectoryUser[]>(() => {
    const fixed: DirectoryUser[] = [];
    for (const jefe of project.jefes) {
      fixed.push({ id: jefe.id, name: jefe.nombre, email: actorEmails[jefe.id] ?? '' });
    }
    if (project.responsableId && project.responsableNombre) {
      fixed.push({ id: project.responsableId, name: project.responsableNombre, email: actorEmails[project.responsableId] ?? '' });
    }
    if (project.proveedorId && project.proveedor) {
      fixed.push({ id: project.proveedorId, name: project.proveedor, email: '' });
    }
    for (const cliente of project.clientes) {
      fixed.push({ id: cliente.id, name: cliente.nombre, email: actorEmails[cliente.id] ?? '' });
    }
    return fixed;
  }, [
    project.jefes, project.responsableId, project.responsableNombre,
    project.proveedorId, project.proveedor, project.clientes, actorEmails,
  ]);

  async function loadActorEmails() {
    const ids = [...project.jefes.map((j) => j.id), project.responsableId, ...project.clientes.map((c) => c.id)].filter((id): id is string => !!id);
    if (!ids.length) return;
    try {
      const profiles = await ProfilesApi.getMany(ids);
      setActorEmails(Object.fromEntries(profiles.map((p) => [p.id, p.email])));
    } catch {
      setActorEmails({});
    }
  }

  async function openMeetingForm() {
    await loadActorEmails();
    setNewParticipants([]);
    setShowAddParticipant(false);
    setShowForm(true);
  }

  async function openManualForm() {
    await loadActorEmails();
    setManualParticipants([]);
    setShowManualAddParticipant(false);
    setShowManualForm(true);
  }

  async function createMeeting() {
    if (!formState.date) { alert('Selecciona una fecha para la reunión.'); return; }
    const created = await MeetingsApi.create(project.id, {
      date: formState.date, time: formState.time, title: formState.title.trim(),
      participants: [...fixedParticipants, ...newParticipants].map((u) => ({ label: u.name, email: u.email })),
      modalidad: 'Microsoft Teams',
    });
    const agenda = formState.agenda.trim();
    setShowForm(false);
    setNewParticipants([]);
    setFormState({ date: todayISO(), time: '10:00', title: '', agenda: '' });
    onChanged();
    setCreatingTeamsFor(created.id);
    try {
      if (agenda) await MeetingsApi.updateDoc(created.id, { topics: agenda });
      await MeetingsApi.createTeamsMeeting(created.id);
    } catch (err) {
      alert(`La reunión quedó agendada, pero no se pudo crear el evento de Teams: ${(err as Error).message}`);
    } finally {
      setCreatingTeamsFor(null);
      onChanged();
    }
  }

  // Registra una reunión que ya se llevó a cabo por fuera de Teams (ej. la
  // sostuvo la persona asignada de forma presencial u otra plataforma): no
  // crea evento de Teams, y queda directo en "Realizada" -- por eso también
  // dispara el envío del enlace de firma a los participantes, igual que
  // cuando se cambia el estado manualmente.
  async function createManualMeeting() {
    if (!manualFormState.date) { alert('Selecciona una fecha para la reunión.'); return; }
    setSavingManual(true);
    try {
      const created = await MeetingsApi.create(project.id, {
        date: manualFormState.date, time: manualFormState.time, title: manualFormState.title.trim(),
        participants: [...fixedParticipants, ...manualParticipants].map((u) => ({ label: u.name, email: u.email })),
        modalidad: manualFormState.modalidad,
      });
      await MeetingsApi.updateState(created.id, 'realizada');
      setShowManualForm(false);
      setManualParticipants([]);
      setManualFormState({ date: todayISO(), time: '10:00', title: '', modalidad: 'Microsoft Teams' });
      onChanged();
      try {
        await MeetingsApi.notifySignatures(created.id);
      } catch {
        // No es crítico: el admin/encargado puede reenviar el enlace de
        // firma manualmente desde la fila de la reunión si esto falla.
      }
    } catch (err) {
      alert(`No se pudo registrar la reunión: ${(err as Error).message}`);
    } finally {
      setSavingManual(false);
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

  async function setAttendance(participantId: string, attended: boolean) {
    await MeetingsApi.setAttendance(participantId, attended);
    onChanged();
  }

  // Guarda el documento y manda el aviso de firma a los participantes (en
  // vez de solo generar un PDF local) -- así la persona asignada dispara la
  // notificación justo cuando el acta ya quedó redactada como quiere, sin
  // depender únicamente del envío automático al marcar la reunión como
  // "Realizada" (por si el contenido se editó después, o ese envío falló).
  async function saveDocAndNotify(mt: Meeting) {
    const draft = docDrafts[mt.id] ?? {};
    const saved = await MeetingsApi.updateDoc(mt.id, {
      topics: draft.topics ?? mt.topics,
      agreements: draft.agreements ?? mt.agreements,
      risks: draft.risks ?? mt.risks,
      compromisos: draft.compromisos ?? mt.compromisos,
    });
    onChanged();
    setNotifying(mt.id);
    try {
      const pdf = await generateMeetingActaPdf(project, saved);
      try {
        await ActasApi.upload(project.id, saved.id, pdf);
      } catch {
        // La notificación es lo importante -- si falla solo la copia en
        // Storage, no vale la pena tumbar el envío por eso.
      }
      const result = await MeetingsApi.notifySignatures(saved.id);
      if (result.failed.length) {
        alert(`Se enviaron ${result.sent} aviso(s) de firma. Fallaron: ${result.failed.join(', ')}.`);
      } else if (result.sent === 0) {
        alert('El acta se guardó, pero ningún participante tiene correo registrado para avisarle.');
      }
    } catch (err) {
      alert(`El acta se guardó, pero no se pudo enviar el aviso de firma: ${(err as Error).message}`);
    } finally {
      setNotifying(null);
    }
  }

  // Cada compromiso queda con su propio responsable y fecha límite (en vez
  // de una sola línea de texto libre) para que la tabla de "Compromisos" del
  // acta pueda mostrarlos de verdad, en vez de "—" en esas dos columnas.
  function addCompromiso(mt: Meeting) {
    const current = docDrafts[mt.id]?.compromisos ?? mt.compromisos;
    setDocDrafts((d) => ({
      ...d,
      [mt.id]: { ...d[mt.id], compromisos: [...current, { text: '', responsable: null, fechaLimite: null }] },
    }));
  }

  function updateCompromiso(mt: Meeting, index: number, next: Compromiso) {
    const current = docDrafts[mt.id]?.compromisos ?? mt.compromisos;
    const list = current.slice();
    list[index] = next;
    setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], compromisos: list } }));
  }

  function removeCompromiso(mt: Meeting, index: number) {
    const current = docDrafts[mt.id]?.compromisos ?? mt.compromisos;
    const list = current.filter((_, i) => i !== index);
    setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], compromisos: list } }));
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

  // Genera el acta con el formato institucional (FO-GT-018) directo desde los
  // datos actuales de la reunión, sin pasar por el panel de edición de
  // "Documento" -- para cuando quien elabora el acta no es la persona
  // asignada (que es quien normalmente abre y guarda ese panel).
  async function generateActa(mt: Meeting) {
    setGeneratingActaFor(mt.id);
    try {
      const pdf = await generateMeetingActaPdf(project, mt);
      try {
        await ActasApi.upload(project.id, mt.id, pdf);
      } catch {
        // El acta ya se descargó localmente -- si falla solo la copia en
        // Storage, no vale la pena tumbar la acción completa por eso.
      }
    } catch (err) {
      alert(`No se pudo generar el acta: ${(err as Error).message}`);
    } finally {
      setGeneratingActaFor(null);
    }
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

  // Firma desde la propia cuenta: jefe/persona asignada firman su propia
  // fila de participante entrando a la app (no reciben el enlace por
  // correo, solo el aviso -- ver send-signature-links). Mismo patrón que
  // "Firmar acta" en el portal de clientes.
  async function signMyself(p: Participant) {
    setSigningFor(p.id);
    try {
      const link = await MeetingsApi.getSignLink(p.id);
      window.open(link, '_blank', 'noopener');
    } catch (err) {
      alert(`No se pudo abrir el enlace de firma: ${(err as Error).message}`);
    } finally {
      setSigningFor(null);
    }
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
            <button className="btn small" onClick={() => (showForm ? setShowForm(false) : openMeetingForm())}>
              {showForm ? 'Cancelar' : '+ Agendar reunión'}
            </button>
          )}
          {canRegisterMeeting && (
            <button
              className="btn small ghost"
              title="Para cuando la reunión no se agendó en Teams (la llevó la persona asignada por otro medio)"
              onClick={() => (showManualForm ? setShowManualForm(false) : openManualForm())}
            >
              {showManualForm ? 'Cancelar' : '+ Registrar reunión manual'}
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
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">Microsoft Teams</div>
                <h2 className="modal-title">Agendar reunión</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowForm(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                La reunión se agenda en Microsoft Teams y queda registrada en el calendario del
                proyecto.
              </p>
              <div className="modal-fields">
                <div className="modal-field">
                  <label>Motivo / título</label>
                  <input
                    type="text"
                    value={formState.title}
                    onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                    placeholder="Ej. Revisión de avance"
                  />
                </div>
                <div className="modal-field-grid">
                  <div className="modal-field">
                    <label>Fecha</label>
                    <input
                      type="date"
                      value={formState.date}
                      onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                    />
                  </div>
                  <div className="modal-field">
                    <label>Hora</label>
                    <input
                      type="time"
                      value={formState.time}
                      onChange={(e) => setFormState({ ...formState, time: e.target.value })}
                    />
                  </div>
                </div>
                <div className="modal-field">
                  <label>Participantes</label>
                  <p className="modal-field-hint">Jefe del proyecto, persona asignada y proveedor.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {fixedParticipants.map((p) => (
                      <span className="participant-chip" key={p.id}>{p.name}</span>
                    ))}
                    {newParticipants.map((p) => (
                      <span className="participant-chip" key={p.id}>
                        {p.name}
                        <button
                          type="button"
                          onClick={() => setNewParticipants((arr) => arr.filter((x) => x.id !== p.id))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {showAddParticipant ? (
                    <DirectorySearch
                      placeholder="Buscar persona en Entra ID…"
                      roleLabel="Invitado"
                      onSelect={(u) => {
                        if (newParticipants.some((p) => p.id === u.id)) return;
                        setNewParticipants((arr) => [...arr, u]);
                      }}
                    />
                  ) : (
                    <button type="button" className="directory-manual-toggle" onClick={() => setShowAddParticipant(true)}>
                      + Agregar participante
                    </button>
                  )}
                </div>
                <div className="modal-field">
                  <label>Agenda</label>
                  <textarea
                    rows={3}
                    value={formState.agenda}
                    onChange={(e) => setFormState({ ...formState, agenda: e.target.value })}
                    placeholder="Puntos a tratar…"
                  />
                </div>
              </div>
              <div className="modal-info-block">
                <span className="modal-info-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                    <rect x="2" y="6" width="14" height="12" rx="2" />
                  </svg>
                </span>
                <div>
                  <div className="stat-label">Enlace de la reunión</div>
                  <div className="modal-info-value">Se genera en Teams al guardar</div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">La invitación se envía al guardar.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="btn" onClick={createMeeting}>Agendar en Teams</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showManualForm && (
        <div className="modal-overlay" onClick={() => setShowManualForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">Registro manual</div>
                <h2 className="modal-title">Registrar reunión</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowManualForm(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                Para una reunión que no se agendó con "+ Agendar reunión". Queda registrada
                directamente como "Realizada" y se les manda a los participantes el enlace de
                firma del acta.
              </p>
              <div className="modal-fields">
                <div className="modal-field">
                  <label>Motivo / título</label>
                  <input
                    type="text"
                    value={manualFormState.title}
                    onChange={(e) => setManualFormState({ ...manualFormState, title: e.target.value })}
                    placeholder="Ej. Revisión de avance"
                  />
                </div>
                <div className="modal-field-grid">
                  <div className="modal-field">
                    <label>Fecha</label>
                    <input
                      type="date"
                      value={manualFormState.date}
                      onChange={(e) => setManualFormState({ ...manualFormState, date: e.target.value })}
                    />
                  </div>
                  <div className="modal-field">
                    <label>Hora</label>
                    <input
                      type="time"
                      value={manualFormState.time}
                      onChange={(e) => setManualFormState({ ...manualFormState, time: e.target.value })}
                    />
                  </div>
                </div>
                <div className="modal-field">
                  <label>Modalidad</label>
                  <select
                    value={manualFormState.modalidad}
                    onChange={(e) => setManualFormState({ ...manualFormState, modalidad: e.target.value })}
                  >
                    <option value="Microsoft Teams">Microsoft Teams</option>
                    <option value="Presencial">Presencial</option>
                    <option value="Otra">Otra</option>
                  </select>
                </div>
                <div className="modal-field">
                  <label>Participantes</label>
                  <p className="modal-field-hint">Jefe del proyecto, persona asignada y proveedor.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {fixedParticipants.map((p) => (
                      <span className="participant-chip" key={p.id}>{p.name}</span>
                    ))}
                    {manualParticipants.map((p) => (
                      <span className="participant-chip" key={p.id}>
                        {p.name}
                        <button
                          type="button"
                          onClick={() => setManualParticipants((arr) => arr.filter((x) => x.id !== p.id))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {showManualAddParticipant ? (
                    <DirectorySearch
                      placeholder="Buscar persona en Entra ID…"
                      roleLabel="Invitado"
                      onSelect={(u) => {
                        if (manualParticipants.some((p) => p.id === u.id)) return;
                        setManualParticipants((arr) => [...arr, u]);
                      }}
                    />
                  ) : (
                    <button type="button" className="directory-manual-toggle" onClick={() => setShowManualAddParticipant(true)}>
                      + Agregar participante
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">No se agenda en Teams.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowManualForm(false)}>Cancelar</button>
                <button className="btn" onClick={createManualMeeting} disabled={savingManual}>
                  {savingManual ? 'Guardando…' : 'Registrar reunión'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNoteForm && (
        <div className="modal-overlay" onClick={() => setShowNoteForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">Seguimiento diario</div>
                <h2 className="modal-title">Nota de seguimiento</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowNoteForm(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                La nota queda fechada en el seguimiento del proyecto y se puede eliminar en
                cualquier momento.
              </p>
              <div className="modal-fields">
                <div className="modal-field">
                  <label>Fecha</label>
                  <input
                    type="date"
                    value={noteForm.date}
                    onChange={(e) => setNoteForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div className="modal-field">
                  <label>Nota de seguimiento</label>
                  <textarea
                    value={noteForm.text}
                    onChange={(e) => setNoteForm((f) => ({ ...f, text: e.target.value }))}
                    placeholder="Ej. Se resolvió el bloqueo de ambiente de pruebas con el proveedor"
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">Las notas se pueden eliminar en cualquier momento.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowNoteForm(false)}>Cancelar</button>
                <button className="btn" onClick={addDailyNote} disabled={savingNote}>
                  {savingNote ? 'Guardando…' : 'Agregar nota'}
                </button>
              </div>
            </div>
          </div>
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 5 }}>
                        <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                        <rect x="2" y="6" width="14" height="12" rx="2" />
                      </svg>
                      Unirse en Teams
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
                  <button
                    className="btn small ghost"
                    title="Generar el acta de esta reunión con los datos actuales, sin abrir el panel de Documento"
                    onClick={() => generateActa(mt)}
                    disabled={generatingActaFor === mt.id}
                  >
                    {generatingActaFor === mt.id ? 'Generando…' : '🖨️ Generar acta'}
                  </button>
                  {canEdit && (
                    <button className="del-btn" title="Eliminar reunión" onClick={() => deleteMeeting(mt)}>×</button>
                  )}
                </div>
                <div className="hu-section-head">
                  <span className="hu-tag">Par</span>
                  <h3>Participantes</h3>
                </div>
                <div className="meeting-participants">
                  {mt.participants.length ? (
                    ROLE_ORDER.map((role) => {
                      const inRole = mt.participants.filter((p) => roleForParticipant(p.label) === role);
                      if (!inRole.length) return null;
                      return (
                        <div className="participant-role-row" key={role}>
                          <span className="participant-role-label">{role}</span>
                          <span className="participant-role-chips">
                            {inRole.map((p) => (
                              <span className={`participant-chip ${p.signature ? 'signed' : ''}`} key={p.id}>
                                {p.signature ? '✓ ' : ''}{p.label}
                                {!p.signature && myEmail && p.email?.toLowerCase() === myEmail && (
                                  <button
                                    className="sign-self-btn"
                                    title="Firmar este documento con tu cuenta"
                                    onClick={() => signMyself(p)}
                                    disabled={signingFor === p.id}
                                  >
                                    {signingFor === p.id ? 'Abriendo…' : 'Firmar'}
                                  </button>
                                )}
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
                            ))}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <span className="participant-empty">Sin participantes agregados</span>
                  )}
                  {canEdit && (
                    <span className="participant-add">
                      <DirectorySearch
                        placeholder="Buscar persona en Entra ID…"
                        roleLabel="Invitado"
                        onSelect={(u) => addParticipant(mt, u)}
                      />
                    </span>
                  )}
                </div>
                {docOpen && (
                  <div className="meeting-doc">
                    <div className="hu-section-head">
                      <span className="hu-tag">Asi</span>
                      <h3>Asistencia</h3>
                    </div>
                    <div className="attendance-editor">
                      {mt.participants.length ? (
                        ROLE_ORDER.map((role) => {
                          const inRole = mt.participants.filter((p) => roleForParticipant(p.label) === role);
                          if (!inRole.length) return null;
                          return (
                            <div className="participant-role-row" key={role}>
                              <span className="participant-role-label">{role}</span>
                              <span className="participant-role-chips">
                                {inRole.map((p) => (
                                  <button
                                    type="button"
                                    key={p.id}
                                    className={`attendance-chip ${p.attended ? 'present' : 'absent'}`}
                                    title={p.attended ? 'Marcar como no asistió' : 'Marcar como asistió'}
                                    onClick={() => setAttendance(p.id, !p.attended)}
                                  >
                                    {p.attended ? '✓' : '×'} {p.label}
                                  </button>
                                ))}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <span className="participant-empty">Sin participantes agregados</span>
                      )}
                    </div>

                    <div className="hu-section-head">
                      <span className="hu-tag">Odd</span>
                      <h3>Orden del día</h3>
                    </div>
                    <textarea
                      className="hu-textarea"
                      rows={3}
                      value={draft.topics}
                      onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], topics: e.target.value } }))}
                      placeholder="Puntos a tratar (uno por línea)…"
                    />

                    <div className="hu-section-head">
                      <span className="hu-tag">Des</span>
                      <h3>Desarrollo de la reunión</h3>
                    </div>
                    <textarea
                      className="hu-textarea"
                      rows={3}
                      value={draft.agreements}
                      onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], agreements: e.target.value } }))}
                      placeholder="Qué se acordó y qué se decidió…"
                    />

                    <div className="hu-section-head">
                      <span className="hu-tag">Obs</span>
                      <h3>Observaciones</h3>
                    </div>
                    <textarea
                      className="hu-textarea"
                      rows={3}
                      value={draft.risks}
                      onChange={(e) => setDocDrafts((d) => ({ ...d, [mt.id]: { ...d[mt.id], risks: e.target.value } }))}
                      placeholder="Riesgos u observaciones…"
                    />

                    <div className="hu-section-head">
                      <span className="hu-tag">Com</span>
                      <h3>Compromisos</h3>
                    </div>
                    <div className="compromisos-editor">
                      <div className="compromiso-row compromiso-head">
                        <span>Compromiso</span>
                        <span>Responsable</span>
                        <span>Fecha límite</span>
                        <span />
                      </div>
                      {draft.compromisos.map((c, i) => (
                        <div className="compromiso-row" key={i}>
                          <input
                            type="text"
                            value={c.text}
                            placeholder="Compromiso…"
                            onChange={(e) => updateCompromiso(mt, i, { ...c, text: e.target.value })}
                          />
                          <select
                            value={c.responsable ?? ''}
                            onChange={(e) => updateCompromiso(mt, i, { ...c, responsable: e.target.value || null })}
                          >
                            <option value="">Responsable…</option>
                            {mt.participants.map((p) => (
                              <option key={p.id} value={p.label}>{p.label}</option>
                            ))}
                          </select>
                          <input
                            type="date"
                            value={c.fechaLimite ?? ''}
                            onChange={(e) => updateCompromiso(mt, i, { ...c, fechaLimite: e.target.value || null })}
                          />
                          <button type="button" title="Quitar compromiso" onClick={() => removeCompromiso(mt, i)}>×</button>
                        </div>
                      ))}
                      <button type="button" className="btn small ghost" onClick={() => addCompromiso(mt)}>
                        + Agregar compromiso
                      </button>
                    </div>

                    <div className="actions">
                      <button className="btn small" onClick={() => saveDocAndNotify(mt)} disabled={notifying === mt.id}>
                        {notifying === mt.id ? 'Enviando…' : 'Enviar notificación del acta'}
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
