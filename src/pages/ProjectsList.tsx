import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ProjectsDashboard from '../components/ProjectsDashboard';
import ProfilePicker from '../components/ProfilePicker';
import { ProjectsApi } from '../lib/services';
import { exportProjectsCsv, downloadCsvTemplate } from '../lib/csv';
import { STATUS_META, type Project, type ProjectStatus, type ProfileLite } from '../types/domain';
import { useAuth } from '../context/AuthContext';

const ACTIVE_STATES: ProjectStatus[] = ['levantamiento', 'desarrollo', 'validacion'];

interface ActorForm {
  name: string;
  jefe: ProfileLite | null;
  responsable: ProfileLite | null;
  proveedor: ProfileLite | null;
}

const EMPTY_FORM: ActorForm = { name: '', jefe: null, responsable: null, proveedor: null };

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  // Conjunto de estados activos en el filtro. Vacío = "todos".
  const [statusFilters, setStatusFilters] = useState<Set<ProjectStatus>>(new Set());
  const [showIntake, setShowIntake] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [form, setForm] = useState<ActorForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'desarrollador';
  const canCreate = profile?.role === 'admin';

  async function load() {
    setLoading(true);
    setProjects(await ProjectsApi.list());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = projects.filter((p) => statusFilters.size === 0 || statusFilters.has(p.status));
  const totals = {
    total: projects.length,
    activos: projects.filter((p) => p.status !== 'cerrado').length,
    cerrados: projects.filter((p) => p.status === 'cerrado').length,
    avg: projects.length
      ? Math.round(projects.reduce((a, p) => a + (p.stats?.pct ?? 0), 0) / projects.length)
      : 0,
  };

  // Clic normal en un KPI/segmento = filtrar solo por ese estado.
  // Ctrl/Cmd+clic = añadir o quitar ese estado del filtro combinado.
  function handleStatusToggle(status: ProjectStatus, additive: boolean) {
    setStatusFilters((prev) => {
      if (!additive) {
        return prev.size === 1 && prev.has(status) ? new Set() : new Set([status]);
      }
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  }

  function toggleActivos(additive: boolean) {
    setStatusFilters((prev) => {
      if (!additive) {
        const isOnlyActivos = ACTIVE_STATES.every((s) => prev.has(s)) && prev.size === ACTIVE_STATES.length;
        return isOnlyActivos ? new Set() : new Set(ACTIVE_STATES);
      }
      const next = new Set(prev);
      ACTIVE_STATES.forEach((s) => (next.has(s) ? next.delete(s) : next.add(s)));
      return next;
    });
  }

  const filterSummary = useMemo(() => {
    if (statusFilters.size === 0) return 'Mostrando todos los proyectos';
    const labels = [...statusFilters].map((s) => STATUS_META[s]);
    return `Filtrando por: ${labels.join(', ')}`;
  }, [statusFilters]);

  async function createProject() {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Ingresa un nombre para el proyecto.';
    if (!form.jefe) errors.jefe = 'Elige quién es el jefe de proyecto.';
    if (!form.responsable) errors.responsable = 'Elige quién es la persona asignada.';
    if (!form.proveedor) errors.proveedor = 'Elige el proveedor.';
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setCreating(true);
    try {
      const { id } = await ProjectsApi.create({ name: form.name.trim() });
      await ProjectsApi.setActors(id, {
        jefeId: form.jefe!.id,
        responsableId: form.responsable!.id,
        proveedorId: form.proveedor!.id,
      });
      setForm(EMPTY_FORM);
      setFormErrors({});
      setShowIntake(false);
      load();
    } catch (err) {
      alert(`No se pudo crear el proyecto: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(id: string, status: ProjectStatus) {
    await ProjectsApi.updateStatus(id, status);
    load();
  }

  async function deleteProject(p: Project) {
    if (!confirm(`¿Eliminar el proyecto "${p.name}"? Esta acción no se puede deshacer.`)) return;
    await ProjectsApi.deleteProject(p.id);
    load();
  }

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Panel administrativo</p>
          <h1>Proyectos en auditoría</h1>
          <p className="sub">
            Crea proyectos, controla su estado y entra al detalle de cada levantamiento técnico
            (ficha técnica, flujo de procesos, manual de usuario y calendario de reuniones).
          </p>
        </div>
        <button className="btn ghost small" onClick={() => setShowDashboard((s) => !s)}>
          {showDashboard ? 'Ocultar dashboard' : 'Ver dashboard'}
        </button>
      </div>

      {showDashboard && !loading && (
        <ProjectsDashboard projects={projects} onSliceClick={(status) => handleStatusToggle(status, false)} />
      )}

      <div className="kpis">
        <div
          className={`kpi ${statusFilters.size === 0 ? 'kpi-active' : ''}`}
          onClick={() => setStatusFilters(new Set())}
          style={{ cursor: 'pointer' }}
          title="Ver todos los proyectos"
        >
          <div className="label">Proyectos totales</div>
          <div className="value">{totals.total}</div>
        </div>
        <div
          className={`kpi k-blue ${ACTIVE_STATES.every((s) => statusFilters.has(s)) && statusFilters.size === ACTIVE_STATES.length ? 'kpi-active' : ''}`}
          onClick={(e) => toggleActivos(e.ctrlKey || e.metaKey)}
          style={{ cursor: 'pointer' }}
          title="Clic: solo activos · Ctrl/Cmd+clic: combinar con otros filtros"
        >
          <div className="label">Activos</div>
          <div className="value">{totals.activos}</div>
        </div>
        <div
          className={`kpi k-green ${statusFilters.has('cerrado') && statusFilters.size === 1 ? 'kpi-active' : ''}`}
          onClick={(e) => handleStatusToggle('cerrado', e.ctrlKey || e.metaKey)}
          style={{ cursor: 'pointer' }}
          title="Clic: solo cerrados · Ctrl/Cmd+clic: combinar con otros filtros"
        >
          <div className="label">Cerrados</div>
          <div className="value">{totals.cerrados}</div>
        </div>
        <div className="kpi k-gold">
          <div className="label">Avance promedio</div>
          <div className="value">{totals.avg}%</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="filters">
          <select
            value={statusFilters.size === 1 ? [...statusFilters][0] : 'all'}
            onChange={(e) => {
              const v = e.target.value;
              setStatusFilters(v === 'all' ? new Set() : new Set([v as ProjectStatus]));
            }}
          >
            <option value="all">Estado: todos</option>
            {Object.entries(STATUS_META).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <span className="filter-note">{filterSummary}</span>
        </div>
        <div className="btn-group">
          <button className="btn ghost small" onClick={() => downloadCsvTemplate()}>
            Descargar plantilla CSV
          </button>
          <button className="btn ghost small" onClick={() => exportProjectsCsv(visible)}>
            Exportar CSV ↓
          </button>
          {canCreate && (
            <button className="btn" onClick={() => setShowIntake((s) => !s)}>
              + Nuevo proyecto
            </button>
          )}
        </div>
      </div>

      {showIntake && (
        <div className="intake">
          <h3>Crear proyecto</h3>
          <div className="intake-grid">
            <div className={`field${formErrors.name ? ' has-error' : ''}`}>
              <label>Nombre del proyecto</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Portal de clientes"
              />
              {formErrors.name && <span className="field-error">{formErrors.name}</span>}
            </div>
            <div className={`field${formErrors.jefe ? ' has-error' : ''}`}>
              <label>Jefe de proyecto</label>
              <ProfilePicker
                role="admin"
                value={form.jefe}
                onChange={(p) => setForm({ ...form, jefe: p })}
              />
              {formErrors.jefe && <span className="field-error">{formErrors.jefe}</span>}
            </div>
            <div className={`field${formErrors.responsable ? ' has-error' : ''}`}>
              <label>Persona asignada</label>
              <ProfilePicker
                role="desarrollador"
                value={form.responsable}
                onChange={(p) => setForm({ ...form, responsable: p })}
              />
              {formErrors.responsable && <span className="field-error">{formErrors.responsable}</span>}
            </div>
            <div className={`field${formErrors.proveedor ? ' has-error' : ''}`}>
              <label>Proveedor</label>
              <ProfilePicker
                role="cliente"
                value={form.proveedor}
                onChange={(p) => setForm({ ...form, proveedor: p })}
              />
              {formErrors.proveedor && <span className="field-error">{formErrors.proveedor}</span>}
            </div>
          </div>
          <div className="intake-actions">
            <button className="btn ghost" onClick={() => setShowIntake(false)}>
              Cancelar
            </button>
            <button className="btn" onClick={createProject} disabled={creating}>
              {creating ? 'Creando…' : 'Crear proyecto'}
            </button>
          </div>
        </div>
      )}

      <div className="proj-table">
        <div className="proj-row head">
          <span>Código</span>
          <span>Proyecto</span>
          <span>Proveedor</span>
          <span>Responsable</span>
          <span>Estado</span>
          <span>Avance</span>
          <span></span>
        </div>
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">No hay proyectos con este filtro. Crea uno con “+ Nuevo proyecto”.</div>
        ) : (
          visible.map((p) => (
            <div className="proj-row" key={p.id}>
              <span className="proj-code">{p.code}</span>
              <span className="proj-name">{p.name}</span>
              <span className="proj-client">{p.proveedor}</span>
              <span className="proj-owner">{p.responsableNombre ?? '—'}</span>
              <select
                className={`status-select ${p.status}`}
                value={p.status}
                disabled={!canManage}
                onChange={(e) => changeStatus(p.id, e.target.value as ProjectStatus)}
              >
                {Object.entries(STATUS_META).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="proj-progress">
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${p.stats?.pct ?? 0}%` }} />
                </span>
                <span className="pct">{p.stats?.pct ?? 0}%</span>
              </span>
              <span className="proj-actions">
                <button className="btn small" onClick={() => navigate(`/projects/${p.id}`)}>
                  Ver detalle →
                </button>
                {canManage && (
                  <button className="btn small danger" onClick={() => deleteProject(p)}>
                    Eliminar
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
