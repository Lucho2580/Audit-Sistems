import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { useSidebarStats } from '../context/ShellChromeContext';
import ChecklistSectionCard from '../components/ChecklistSectionCard';
import MeetingsCalendar from '../components/MeetingsCalendar';
import AuditHistoryPanel from '../components/AuditHistoryPanel';
import RoadmapPhases from '../components/RoadmapPhases';
import DeliveryPanel from '../components/DeliveryPanel';
import { ProjectsApi, MeetingsApi, PhasesApi, DailyNotesApi } from '../lib/services';
import { generateProjectReportPdf } from '../lib/pdf';
import {
  STATUS_META, phaseEndDate,
  type Project, type Meeting, type ProjectPhase, type ProjectStatus, type ItemResponsible, type DailyNote,
} from '../types/domain';
import { useAuth } from '../context/AuthContext';

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

  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [phases, setPhases] = useState<ProjectPhase[]>([]);
  const [dailyNotes, setDailyNotes] = useState<DailyNote[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pendiente' | 'progreso' | 'completo'>('all');
  const [filterResp, setFilterResp] = useState<'all' | ItemResponsible>('all');

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

  const stats = project?.stats ?? { total: 0, done: 0, prog: 0, pend: 0, pct: 0 };
  useSidebarStats(
    useMemo(
      () => ({
        title: 'Checkpoints',
        items: [
          { label: 'Checkpoints totales', value: String(stats.total), note: 'en el proyecto' },
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

  const plannedEntregaDate = phaseEndDate(phases.find((p) => p.key === 'entrega'));
  const plannedFinalDate = phaseEndDate(phases.find((p) => p.key === 'fin'));

  return (
    <AppShell>
      <button className="back-btn" onClick={() => navigate('/')}>
        ← Volver al panel de proyectos
      </button>

      <div className="masthead">
        <div>
          <p className="eyebrow">{project.code}</p>
          <h1>{project.name}</h1>
          <p className="sub">Proveedor: {project.proveedor}</p>
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
          <select className="filter-select" value={filterResp} onChange={(e) => setFilterResp(e.target.value as any)}>
            <option value="all">Responsable: todos</option>
            <option value="cliente">Cliente</option>
            <option value="desarrollador">Desarrollador</option>
          </select>
        </div>
        <button className="btn ghost" onClick={() => generateProjectReportPdf(project, meetings)}>
          Exportar informe del proyecto (PDF) ↓
        </button>
      </div>

      {project.sections
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((sec) => (
          <ChecklistSectionCard
            key={sec.id}
            section={sec}
            filterStatus={filterStatus}
            filterResp={filterResp}
            canEdit={canEdit}
            canEditPercent={canEditPercent}
            onChanged={load}
          />
        ))}

      <RoadmapPhases phases={phases} canEdit={canEdit} onChanged={load} />

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
        canEdit={canEdit}
        onChanged={load}
      />

      <AuditHistoryPanel projectId={project.id} />
    </AppShell>
  );
}
