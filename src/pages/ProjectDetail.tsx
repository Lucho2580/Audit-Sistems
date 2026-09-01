import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ChecklistSectionCard from '../components/ChecklistSectionCard';
import MeetingsCalendar from '../components/MeetingsCalendar';
import AuditHistoryPanel from '../components/AuditHistoryPanel';
import { ProjectsApi, MeetingsApi } from '../lib/services';
import { generateProjectReportPdf } from '../lib/pdf';
import { STATUS_META, type Project, type Meeting, type ProjectStatus, type ItemResponsible } from '../types/domain';
import { useAuth } from '../context/AuthContext';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'desarrollador';
  const canEditPercent = canEdit || profile?.role === 'cliente';

  const [project, setProject] = useState<Project | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pendiente' | 'progreso' | 'completo'>('all');
  const [filterResp, setFilterResp] = useState<'all' | ItemResponsible>('all');

  const load = useCallback(async () => {
    if (!id) return;
    const [p, mts] = await Promise.all([ProjectsApi.get(id), MeetingsApi.listByProject(id)]);
    setProject(p);
    setMeetings(mts);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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

  const stats = project.stats ?? { total: 0, done: 0, prog: 0, pend: 0, pct: 0 };

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
            className={`status-select ${project.status}`}
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

      <div className="kpis">
        <div className="kpi"><div className="label">Checkpoints totales</div><div className="value">{stats.total}</div></div>
        <div className="kpi k-green"><div className="label">Completados</div><div className="value">{stats.done}</div></div>
        <div className="kpi k-gold"><div className="label">En progreso</div><div className="value">{stats.prog}</div></div>
        <div className="kpi k-rust"><div className="label">Pendientes</div><div className="value">{stats.pend}</div></div>
      </div>

      <div className="toolbar">
        <div className="filters">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
            <option value="all">Estado: todos</option>
            <option value="pendiente">Pendiente (0%)</option>
            <option value="progreso">En progreso</option>
            <option value="completo">Completo (100%)</option>
          </select>
          <select value={filterResp} onChange={(e) => setFilterResp(e.target.value as any)}>
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

      <MeetingsCalendar project={project} meetings={meetings} canEdit={canEdit} onChanged={load} />

      <AuditHistoryPanel projectId={project.id} />
    </AppShell>
  );
}
