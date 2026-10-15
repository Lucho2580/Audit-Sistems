import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useSidebarStats } from '../context/ShellChromeContext';
import ChecklistSectionCard from '../components/ChecklistSectionCard';
import MeetingsCalendar from '../components/MeetingsCalendar';
import AuditHistoryPanel from '../components/AuditHistoryPanel';
import RoadmapPhases from '../components/RoadmapPhases';
import DeliveryPanel from '../components/DeliveryPanel';
import ParticipationChart from '../components/ParticipationChart';
import SectionProgressChart from '../components/SectionProgressChart';
import { ProjectsApi, MeetingsApi, PhasesApi, DailyNotesApi } from '../lib/services';
import { generateProjectReportPdf } from '../lib/pdf';
import {
  STATUS_META, DELAY_STATUS_META, phaseEndDate, taskDelayStatus, worstDelayStatus,
  type Project, type Meeting, type ProjectPhase, type PhaseTask, type ProjectStatus, type DailyNote,
} from '../types/domain';
import { useAuth } from '../context/AuthContext';

const DELAY_TONE: Record<string, string> = {
  completado: 'green', en_tiempo: 'blue', atrasado: 'rust',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  // canEdit: administración completa del proyecto (secciones, checkpoints,
  // reuniones, roadmap, entrega) -- solo jefe de proyecto/superadmin. El
  // asignado (desarrollador) ya no entra aquí: solo puede cambiar el % de
  // sus checkpoints y agregar observaciones (canEditPercent).
  const canEdit = profile?.role === 'admin' || profile?.role === 'superadmin';
  const canEditPercent = canEdit || profile?.role === 'desarrollador';
  const isQaReviewer = profile?.role === 'qa';
  // Aprobar/rechazar reportes de seguimiento: rol QA o cuenta autorizada
  // aparte (item_log_reviewers). Lo decide la base, no el rol en pantalla.
  const [canReviewLogs, setCanReviewLogs] = useState(false);
  useEffect(() => {
    let active = true;
    ProjectsApi.canReviewItemLogs()
      .then((ok) => { if (active) setCanReviewLogs(ok); })
      .catch(() => { if (active) setCanReviewLogs(false); });
    return () => { active = false; };
  }, [profile?.id]);

  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [phases, setPhases] = useState<ProjectPhase[]>([]);
  const [dailyNotes, setDailyNotes] = useState<DailyNote[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pendiente' | 'progreso' | 'completo'>('all');

  const load = useCallback(async () => {
    if (!id) return;
    const [p, mts, phs, notes] = await Promise.all([
      ProjectsApi.get(id),
      MeetingsApi.listByProject(id),
      PhasesApi.listByProject(id),
      DailyNotesApi.listByProject(id),
    ]);
    setProject(p);
    setMeetings(mts);
    setPhases(phs);
    setDailyNotes(notes);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Los 13 hitos estándar hacen de "tareas" de su fase (sección y fase
  // comparten clave: levantamiento / gestion / entrega) para el cronograma,
  // el calendario, la participación y el atraso del proyecto. Cada hito va
  // del inicio de su fase a su fecha límite; sin fecha límite no se dibuja.
  const tasks = useMemo<PhaseTask[]>(() => {
    if (!project) return [];
    const phaseByKey = new Map<string, ProjectPhase>(phases.map((ph) => [ph.key, ph]));
    return project.sections.flatMap((sec) =>
      sec.items.map((it) => {
        const ph = phaseByKey.get(sec.key);
        const start = it.dueDate && ph?.startDate && ph.startDate <= it.dueDate ? ph.startDate : it.dueDate;
        return {
          id: it.id,
          phaseId: ph?.id ?? sec.id,
          projectId: project.id,
          text: `${sec.code}-${it.n} · ${it.text}`,
          assignedTo: it.assignedTo,
          assignedToNombre: it.assignedToNombre,
          startDate: start,
          plannedEndDate: it.dueDate,
          percent: it.percent,
          observaciones: null,
        };
      }),
    );
  }, [project, phases]);

  const stats = project?.stats ?? { total: 0, done: 0, prog: 0, pend: 0, pct: 0 };
  useSidebarStats(
    useMemo(
      () => ({
        title: 'Hitos',
        items: [
          { label: 'Hitos totales', value: String(stats.total), note: 'en el proyecto' },
          { label: 'Completados', value: String(stats.done), note: 'con firma' },
          { label: 'En progreso', value: String(stats.prog), note: 'en revisión' },
          { label: 'Pendientes', value: String(stats.pend), note: 'sin iniciar' },
        ],
      }),
      [stats.total, stats.done, stats.prog, stats.pend],
    ),
  );

  if (!project) {
    return (
      <AppShell>
        <div className="empty-state">Cargando…</div>
      </AppShell>
    );
  }

  async function changeStatus(status: ProjectStatus) {
    await ProjectsApi.updateStatus(project!.id, status);
    load();
  }

  // Jefe/admin y la persona asignada de ESTE proyecto ven el enlace a
  // "Informes semanales" (página aparte, no mezclada con el detalle general).
  const isResponsable = profile?.id != null && profile.id === project.responsableId;

  const plannedEntregaDate = phaseEndDate(phases.find((p) => p.key === 'entrega'));
  // Ya no hay fase "Fin": la entrega final es el fin de la fase Entrega.
  const plannedFinalDate = plannedEntregaDate;

  // Atraso a nivel de proyecto: el peor estado entre todos los hitos con
  // fecha límite, mostrado como badge en el masthead.
  const projectDelay = worstDelayStatus(tasks.map((t) => taskDelayStatus(t)));

  return (
    <AppShell>
      <button className="back-btn" onClick={() => navigate('/')}>
        ← Volver al panel de proyectos
      </button>

      <div className="masthead">
        <div>
          <p className="eyebrow">{project.code}</p>
          <h1>{project.name}</h1>
          <p className="sub">
            Persona asignada: {project.responsableNombre ?? 'Sin asignar'}
            {' · '}Proveedor: {project.proveedor}
          </p>
          {tasks.length > 0 && (
            <span className={`delay-badge tone-${DELAY_TONE[projectDelay]}`} title="Peor estado de atraso entre todas las tareas del proyecto">
              {DELAY_STATUS_META[projectDelay]}
            </span>
          )}
        </div>
        <div className="status-select-wrap">
          <label>Estado del proyecto</label>
          <select
            className={`status-select solid ${project.status}`}
            value={project.status}
            disabled={!canEdit}
            onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
          >
            {Object.entries(STATUS_META).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="toolbar">
        <div className="filters">
          <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
            <option value="all">Estado: todos</option>
            <option value="pendiente">Pendiente (0%)</option>
            <option value="progreso">En progreso</option>
            <option value="completo">Completo (100%)</option>
          </select>
        </div>
        <div className="btn-group">
          {(canEdit || isResponsable) && (
            <button className="btn ghost" onClick={() => navigate(`/projects/${project.id}/informe-semanal`)}>
              Informes semanales →
            </button>
          )}
          <button className="btn ghost" onClick={() => generateProjectReportPdf(project, meetings)}>
            Exportar informe del proyecto (PDF) ↓
          </button>
        </div>
      </div>

      <div className="dashboard-grid">
        <ParticipationChart tasks={tasks} />
        <SectionProgressChart sections={project.sections} />
      </div>

      {project.sections
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((sec) => (
          <ChecklistSectionCard
            key={sec.id}
            projectId={project.id}
            section={sec}
            filterStatus={filterStatus}
            canEdit={canEdit || isQaReviewer}
            canEditPercent={canEditPercent || isQaReviewer}
            canReview={canReviewLogs}
            minDate={project.startDate}
            maxDate={project.deadlineDate}
            onChanged={load}
          />
        ))}


      <RoadmapPhases
        phases={phases}
        tasks={tasks}
        canEdit={canEdit}
        minDate={project.startDate}
        maxDate={project.deadlineDate}
        onChanged={load}
      />

      <DeliveryPanel
        project={project}
        plannedEntregaDate={plannedEntregaDate}
        plannedFinalDate={plannedFinalDate}
        canEdit={canEdit}
        onChanged={load}
      />

      <MeetingsCalendar
        project={project}
        meetings={meetings}
        dailyNotes={dailyNotes}
        phases={phases}
        tasks={tasks}
        canEdit={canEdit}
        canRegisterMeeting={canEditPercent}
        onChanged={load}
      />

      <AuditHistoryPanel projectId={project.id} />
    </AppShell>
  );
}
