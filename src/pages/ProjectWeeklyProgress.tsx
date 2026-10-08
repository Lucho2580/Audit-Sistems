import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import WeeklyProgressPanel from '../components/WeeklyProgressPanel';
import { ProjectsApi } from '../lib/services';
import type { Project } from '../types/domain';
import { useAuth } from '../context/AuthContext';

// Página aparte (no mezclada con el detalle general del proyecto): solo la
// parte de informes semanales, para que el enlace del masthead y el del
// modal bloqueante lleven a una vista enfocada nada más en eso.
export default function ProjectWeeklyProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    ProjectsApi.get(id)
      .then(setProject)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <AppShell>
        <div className="empty-state">Cargando…</div>
      </AppShell>
    );
  }

  if (!project) {
    return <Navigate to="/" replace />;
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'superadmin';
  const isResponsable = profile?.id != null && profile.id === project.responsableId;

  if (!canEdit && !isResponsable) {
    return <Navigate to={`/projects/${project.id}`} replace />;
  }

  return (
    <AppShell>
      <button className="back-btn" onClick={() => navigate(`/projects/${project.id}`)}>
        ← Volver al proyecto
      </button>

      <div className="masthead">
        <div>
          <p className="eyebrow">{project.code} · Informes semanales</p>
          <h1>{project.name}</h1>
        </div>
      </div>

      <WeeklyProgressPanel
        projectId={project.id}
        canFill={canEdit || isResponsable}
        isComplete={project.status === 'cerrado'}
      />
    </AppShell>
  );
}
