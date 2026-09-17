import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ProjectsDashboard from '../components/ProjectsDashboard';
import ProfilePicker from '../components/ProfilePicker';
import MultiProfilePicker from '../components/MultiProfilePicker';
import ProjectImportModal from '../components/ProjectImportModal';
import { useSidebarStats, useDashboardToggle } from '../context/ShellChromeContext';
import { ProjectsApi, ProvidersApi } from '../lib/services';
import { exportProjectsCsv, downloadCsvTemplate } from '../lib/csv';
import { STATUS_META, type Project, type ProjectStatus, type ProfileLite } from '../types/domain';
import { useAuth } from '../context/AuthContext';

const ACTIVE_STATES: ProjectStatus[] = ['levantamiento', 'desarrollo', 'validacion'];

interface ActorForm {
  name: string;
  jefes: ProfileLite[];
  responsable: ProfileLite | null;
  clientes: ProfileLite[];
}

const EMPTY_FORM: ActorForm = { name: '', jefes: [], responsable: null, clientes: [] };

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
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editForm, setEditForm] = useState<ActorForm>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [savingActors, setSavingActors] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // MyOffice es el único proveedor interno (sin cuenta, sin selector) -- se
  // resuelve una vez y se manda solo, en vez de pedirle al usuario que elija
  // entre proveedores que ya no existen como opción.
  const [myOfficeProviderId, setMyOfficeProviderId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { profile } = useAuth();
  // El asignado (desarrollador) ya no puede cambiar el estado ni borrar
  // proyectos desde la lista -- solo entrar a ver el detalle de los suyos.
  const canManage = profile?.role === 'admin' || profile?.role === 'superadmin';
  const canCreate = profile?.role === 'admin' || profile?.role === 'superadmin';

  useEffect(() => {
    ProvidersApi.list()
      .then((list) => setMyOfficeProviderId(list.find((p) => p.name === 'MyOffice')?.id ?? list[0]?.id ?? null))
      .catch(() => setMyOfficeProviderId(null));
  }, []);

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

  useDashboardToggle(
    useMemo(() => ({ active: showDashboard, onToggle: () => setShowDashboard((s) => !s) }), [showDashboard]),
  );

  const activosActive = ACTIVE_STATES.every((s) => statusFilters.has(s)) && statusFilters.size === ACTIVE_STATES.length;
  const cerradosActive = statusFilters.has('cerrado') && statusFilters.size === 1;
  useSidebarStats(
    useMemo(
      () => ({
        title: 'Resumen',
        items: [
          {
            label: 'Proyectos totales',
            value: String(totals.total),
            note: 'en el sistema',
            active: statusFilters.size === 0,
            onClick: () => setStatusFilters(new Set()),
          },
          {
            label: 'Activos',
            value: String(totals.activos),
            note: 'en auditoría',
            active: activosActive,
            onClick: (e: React.MouseEvent) => toggleActivos(e.ctrlKey || e.metaKey),
          },
          {
            label: 'Cerrados',
            value: String(totals.cerrados),
            note: 'con acta final',
            active: cerradosActive,
            onClick: (e: React.MouseEvent) => handleStatusToggle('cerrado', e.ctrlKey || e.metaKey),
          },
          { label: 'Avance promedio', value: `${totals.avg}%`, note: 'de checkpoints' },
        ],
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [totals.total, totals.activos, totals.cerrados, totals.avg, statusFilters, activosActive, cerradosActive],
    ),
  );

  async function createProject() {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Ingresa un nombre para el proyecto.';
    if (!form.jefes.length) errors.jefe = 'Elige al menos un jefe de proyecto.';
    if (!form.responsable) errors.responsable = 'Elige quién es la persona asignada.';
    if (!myOfficeProviderId) errors.proveedor = 'No se encontró el proveedor interno (MyOffice) -- revisa en Herramientas.';
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setCreating(true);
    try {
      const { id } = await ProjectsApi.create({ name: form.name.trim(), proveedor: 'MyOffice' });
      await ProjectsApi.setActors(id, {
        responsableId: form.responsable!.id,
        proveedorId: myOfficeProviderId!,
      });
      for (const jefe of form.jefes) {
        await ProjectsApi.addJefe(id, jefe.id);
      }
      for (const cliente of form.clientes) {
        await ProjectsApi.addClient(id, cliente.id);
      }
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

  // Los actores solo se pedían al crear el proyecto -- esto permite
  // reasignarlos después (ej. un proyecto creado sin jefe, o cambio de
  // responsable a mitad de camino). Reusa set_project_actors, que ya estaba
  // pensado para reasignar, no solo para el alta inicial.
  function openEditActors(p: Project) {
    setEditingProject(p);
    setEditForm({
      name: p.name,
      jefes: p.jefes.map((j) => ({ id: j.id, fullName: j.nombre, email: '', role: 'admin' as const })),
      responsable: p.responsableId ? { id: p.responsableId, fullName: p.responsableNombre, email: '', role: 'desarrollador' } : null,
      clientes: p.clientes.map((c) => ({ id: c.id, fullName: c.nombre, email: '', role: 'cliente' as const })),
    });
    setEditErrors({});
  }

  async function saveActors() {
    if (!editingProject) return;
    const errors: Record<string, string> = {};
    if (!editForm.jefes.length) errors.jefe = 'Elige al menos un jefe de proyecto.';
    if (!editForm.responsable) errors.responsable = 'Elige quién es la persona asignada.';
    if (!editingProject.proveedorId && !myOfficeProviderId) {
      errors.proveedor = 'No se encontró el proveedor interno (MyOffice) -- revisa en Herramientas.';
    }
    setEditErrors(errors);
    if (Object.keys(errors).length) return;

    setSavingActors(true);
    try {
      await ProjectsApi.setActors(editingProject.id, {
        responsableId: editForm.responsable!.id,
        proveedorId: editingProject.proveedorId ?? myOfficeProviderId!,
      });
      const beforeJefeIds = new Set(editingProject.jefes.map((j) => j.id));
      const afterJefeIds = new Set(editForm.jefes.map((j) => j.id));
      for (const jefe of editForm.jefes) {
        if (!beforeJefeIds.has(jefe.id)) await ProjectsApi.addJefe(editingProject.id, jefe.id);
      }
      for (const jefe of editingProject.jefes) {
        if (!afterJefeIds.has(jefe.id)) await ProjectsApi.removeJefe(editingProject.id, jefe.id);
      }
      const beforeIds = new Set(editingProject.clientes.map((c) => c.id));
      const afterIds = new Set(editForm.clientes.map((c) => c.id));
      for (const cliente of editForm.clientes) {
        if (!beforeIds.has(cliente.id)) await ProjectsApi.addClient(editingProject.id, cliente.id);
      }
      for (const cliente of editingProject.clientes) {
        if (!afterIds.has(cliente.id)) await ProjectsApi.removeClient(editingProject.id, cliente.id);
      }
      setEditingProject(null);
      load();
    } catch (err) {
      alert(`No se pudo actualizar: ${(err as Error).message}`);
    } finally {
      setSavingActors(false);
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
        </div>
        <p className="intro">
          Crea proyectos, controla su estado y entra al detalle de cada levantamiento técnico
          (ficha técnica, flujo de procesos, manual de usuario y calendario de reuniones).
        </p>
      </div>

      {showDashboard && !loading && (
        <ProjectsDashboard projects={projects} onSliceClick={(status) => handleStatusToggle(status, false)} />
      )}

      <div className="toolbar">
        <div className="filters">
          <select
            className="filter-select"
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
            <button className="btn ghost small" onClick={() => setShowImport(true)}>
              Importar desde Excel
            </button>
          )}
          {canCreate && (
            <button className="btn" onClick={() => setShowIntake((s) => !s)}>
              + Nuevo proyecto
            </button>
          )}
        </div>
      </div>

      {showImport && (
        <ProjectImportModal
          myOfficeProviderId={myOfficeProviderId}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {showIntake && (
        <div className="modal-overlay" onClick={() => setShowIntake(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">Nuevo registro</div>
                <h2 className="modal-title">Crear proyecto</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowIntake(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                El código se asigna automáticamente al guardar. El proveedor interno queda fijo
                (MyOffice); el jefe, la persona asignada y el cliente se eligen entre las cuentas
                creadas en Herramientas.
              </p>
              <div className="modal-fields">
                <div className={`modal-field${formErrors.name ? ' has-error' : ''}`}>
                  <label>Nombre del proyecto</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej. Portal de clientes"
                  />
                  {formErrors.name && <span className="field-error">{formErrors.name}</span>}
                </div>
                <div className={`modal-field${formErrors.jefe ? ' has-error' : ''}`}>
                  <label>Jefes de proyecto</label>
                  <MultiProfilePicker
                    role="admin"
                    value={form.jefes}
                    onChange={(list) => setForm({ ...form, jefes: list })}
                    invalid={!!formErrors.jefe}
                  />
                  {formErrors.jefe && <span className="field-error">{formErrors.jefe}</span>}
                </div>
                <div className={`modal-field${formErrors.responsable ? ' has-error' : ''}`}>
                  <label>Persona asignada</label>
                  <ProfilePicker
                    role="desarrollador"
                    value={form.responsable}
                    onChange={(p) => setForm({ ...form, responsable: p })}
                  />
                  {formErrors.responsable && <span className="field-error">{formErrors.responsable}</span>}
                </div>
                <div className={`modal-field${formErrors.cliente ? ' has-error' : ''}`}>
                  <label>Clientes</label>
                  <MultiProfilePicker
                    role="cliente"
                    value={form.clientes}
                    onChange={(list) => setForm({ ...form, clientes: list })}
                    invalid={!!formErrors.cliente}
                  />
                  {formErrors.cliente && <span className="field-error">{formErrors.cliente}</span>}
                  {formErrors.proveedor && <span className="field-error">{formErrors.proveedor}</span>}
                </div>
              </div>
              <div className="stat-grid modal-stat-grid">
                <div className="stat-item">
                  <div className="stat-label">Código</div>
                  <div className="stat-value">Automático</div>
                </div>
                <div className="stat-item">
                  <div className="stat-label">Estado inicial</div>
                  <div className="stat-value">Activo</div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">Los checkpoints se generan al crear el proyecto.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowIntake(false)}>
                  Cancelar
                </button>
                <button className="btn" onClick={createProject} disabled={creating}>
                  {creating ? 'Creando…' : 'Crear proyecto'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingProject && (
        <div className="modal-overlay" onClick={() => setEditingProject(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">{editingProject.code}</div>
                <h2 className="modal-title">Editar actores</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setEditingProject(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                Reasigna quién es el jefe de proyecto, la persona asignada y el proveedor de "
                {editingProject.name}".
              </p>
              <div className="modal-fields">
                <div className={`modal-field${editErrors.jefe ? ' has-error' : ''}`}>
                  <label>Jefes de proyecto</label>
                  <MultiProfilePicker
                    role="admin"
                    value={editForm.jefes}
                    onChange={(list) => setEditForm({ ...editForm, jefes: list })}
                    invalid={!!editErrors.jefe}
                  />
                  {editErrors.jefe && <span className="field-error">{editErrors.jefe}</span>}
                </div>
                <div className={`modal-field${editErrors.responsable ? ' has-error' : ''}`}>
                  <label>Persona asignada</label>
                  <ProfilePicker
                    role="desarrollador"
                    value={editForm.responsable}
                    onChange={(p) => setEditForm({ ...editForm, responsable: p })}
                  />
                  {editErrors.responsable && <span className="field-error">{editErrors.responsable}</span>}
                </div>
                <div className={`modal-field${editErrors.cliente ? ' has-error' : ''}`}>
                  <label>Clientes</label>
                  <MultiProfilePicker
                    role="cliente"
                    value={editForm.clientes}
                    onChange={(list) => setEditForm({ ...editForm, clientes: list })}
                    invalid={!!editErrors.cliente}
                  />
                  {editErrors.cliente && <span className="field-error">{editErrors.cliente}</span>}
                  {editErrors.proveedor && <span className="field-error">{editErrors.proveedor}</span>}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">El código y el nombre del proyecto no cambian aquí.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setEditingProject(null)}>
                  Cancelar
                </button>
                <button className="btn" onClick={saveActors} disabled={savingActors}>
                  {savingActors ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="proj-table">
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {canCreate
              ? 'No hay proyectos con este filtro. Crea uno con “+ Nuevo proyecto”.'
              : 'No tienes proyectos asignados con este filtro.'}
          </div>
        ) : (
          visible.map((p) => (
            <div className="proj-row" key={p.id} onClick={() => navigate(`/projects/${p.id}`)} title="Ver detalle del proyecto">
              <div className="proj-main">
                <div className="proj-code">{p.code}</div>
                <div className="proj-name">{p.name}</div>
                <div className="proj-meta">
                  <span className="proj-meta-item">
                    <span className="proj-meta-label">{p.jefes.length > 1 ? 'Jefes' : 'Jefe'}</span>
                    <span className="proj-meta-value">
                      {p.jefes.length ? p.jefes.map((j) => j.nombre).join(', ') : 'Sin asignar'}
                    </span>
                  </span>
                  <span className="proj-meta-item">
                    <span className="proj-meta-label">{p.clientes.length > 1 ? 'Clientes' : 'Cliente'}</span>
                    <span className="proj-meta-value">
                      {p.clientes.length ? p.clientes.map((c) => c.nombre).join(', ') : 'Sin asignar'}
                    </span>
                  </span>
                  <span className="proj-meta-item">
                    <span className="proj-meta-label">Asignado</span>
                    <span className="proj-meta-value">{p.responsableNombre ?? 'Sin asignar'}</span>
                  </span>
                  <span className="proj-meta-item">
                    <span className="proj-meta-label">Proveedor</span>
                    <span className="proj-meta-value">{p.proveedor}</span>
                  </span>
                </div>
              </div>
              <div className="proj-side" onClick={(e) => e.stopPropagation()}>
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
                <span className="proj-pct">{p.stats?.pct ?? 0}%</span>
                {canManage && (
                  <button className="btn small ghost" title="Editar jefe, persona asignada y proveedor" onClick={() => openEditActors(p)}>
                    Editar
                  </button>
                )}
                {canManage && (
                  <button className="del-btn" title="Eliminar proyecto" onClick={() => deleteProject(p)}>
                    ×
                  </button>
                )}
              </div>
              <div className="proj-bar-track">
                <div className="proj-bar-fill" style={{ width: `${p.stats?.pct ?? 0}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
