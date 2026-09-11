import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { ProjectsApi, MeetingsApi, ActasApi } from '../lib/services';
import { useAuth } from '../context/AuthContext';
import type { Project, Meeting } from '../types/domain';

interface ProjectWithMeetings {
  project: Project;
  meetings: Meeting[];
}

// Portal de solo lectura para cuentas role='cliente': RLS ya limita
// ProjectsApi.list()/MeetingsApi.listByProject() a los proyectos donde son
// cliente_id, así que no hace falta ningún filtro extra aquí -- lo que
// llega es exactamente lo suyo.
export default function ClientPortal() {
  const { profile } = useAuth();
  const [data, setData] = useState<ProjectWithMeetings[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingFor, setSigningFor] = useState<string | null>(null);
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const [downloadingFor, setDownloadingFor] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const projects = await ProjectsApi.list();
      const withMeetings = await Promise.all(
        projects.map(async (project) => ({ project, meetings: await MeetingsApi.listByProject(project.id) })),
      );
      setData(withMeetings);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSign(meetingId: string) {
    setSigningFor(meetingId);
    try {
      const link = await MeetingsApi.getMySignLink(meetingId);
      window.open(link, '_blank', 'noopener');
    } catch (err) {
      alert(`No se pudo abrir el enlace de firma: ${(err as Error).message}`);
    } finally {
      setSigningFor(null);
    }
  }

  async function handleDownload(project: Project, meetingId: string) {
    setDownloadingFor(meetingId);
    try {
      const url = await ActasApi.getUrl(project.id, meetingId);
      if (!url) {
        alert('El acta en PDF de esta reunión todavía no ha sido generada.');
        return;
      }
      window.open(url, '_blank', 'noopener');
    } finally {
      setDownloadingFor(null);
    }
  }

  function toggleDoc(meetingId: string) {
    setOpenDocs((prev) => {
      const next = new Set(prev);
      next.has(meetingId) ? next.delete(meetingId) : next.add(meetingId);
      return next;
    });
  }

  const myEmail = profile?.email?.toLowerCase();

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Portal de cliente</p>
          <h1>Mis actas</h1>
          <p className="sub">
            Actas de tus proyectos con La Vianda: revisa el contenido y firma las que estén
            pendientes.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : data.length === 0 ? (
        <div className="empty-state">Todavía no tienes proyectos asignados.</div>
      ) : (
        data.map(({ project, meetings }) => (
          <div className="section" key={project.id}>
            <div className="section-head">
              <div className="title-block">
                <span className="code-tag">{project.code}</span>
                <h2>{project.name}</h2>
              </div>
            </div>

            {meetings.length === 0 ? (
              <div className="empty-state">Sin reuniones registradas todavía.</div>
            ) : (
              meetings.map((mt) => {
                const myParticipant = mt.participants.find(
                  (p) => p.email && myEmail && p.email.toLowerCase() === myEmail,
                );
                const docOpen = openDocs.has(mt.id);
                return (
                  <div className="meeting-row" key={mt.id}>
                    <div className="meeting-main">
                      <span className="meeting-date">{mt.date} · {mt.time}</span>
                      <span className="meeting-title">{mt.title || 'Reunión de seguimiento'}</span>
                      {myParticipant && (
                        <span className={`status-badge ${myParticipant.signature ? 'confirmed' : 'pending'}`}>
                          {myParticipant.signature ? 'Firmada' : 'Pendiente por firmar'}
                        </span>
                      )}
                      <button className="btn small ghost" onClick={() => toggleDoc(mt.id)}>
                        {docOpen ? 'Ocultar acta' : 'Ver acta'}
                      </button>
                      <button
                        className="btn small ghost"
                        onClick={() => handleDownload(project, mt.id)}
                        disabled={downloadingFor === mt.id}
                      >
                        {downloadingFor === mt.id ? 'Abriendo…' : 'Descargar PDF'}
                      </button>
                      {myParticipant && !myParticipant.signature && (
                        <button className="btn small" onClick={() => handleSign(mt.id)} disabled={signingFor === mt.id}>
                          {signingFor === mt.id ? 'Abriendo…' : 'Firmar acta'}
                        </button>
                      )}
                    </div>
                    {docOpen && (
                      <div className="sign-document" style={{ margin: '0 4px 16px' }}>
                        {[
                          ['Orden del día', mt.topics],
                          ['Desarrollo de la reunión', mt.agreements],
                          ['Observaciones', mt.risks],
                        ].map(([label, value]) => (
                          <div className="sign-document-field" key={label}>
                            <div className="sign-document-label">{label}</div>
                            <p>{value?.trim() || 'Sin registrar.'}</p>
                          </div>
                        ))}
                        <div className="sign-document-field">
                          <div className="sign-document-label">Compromisos</div>
                          {mt.compromisos.length ? (
                            <ul className="sign-document-compromisos">
                              {mt.compromisos.map((c, i) => (
                                <li key={i}>
                                  {c.text}
                                  <span className="sign-document-compromiso-meta">
                                    {c.responsable ? ` · Responsable: ${c.responsable}` : ''}
                                    {c.fechaLimite ? ` · Fecha límite: ${c.fechaLimite}` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>Sin registrar.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ))
      )}
    </AppShell>
  );
}
