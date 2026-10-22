import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ProjectsDashboard from '../components/ProjectsDashboard';
import ProfilePicker from '../components/ProfilePicker';
import MultiProfilePicker from '../components/MultiProfilePicker';
import ProjectImportModal from '../components/ProjectImportModal';
import PersonChip from '../components/PersonChip';
import { useSidebarStats, useDashboardToggle } from '../context/ShellChromeContext';
import { ProjectsApi, ProvidersApi } from '../lib/services';
import { exportProjectsCsv, downloadCsvTemplate } from '../lib/csv';
import {
  STATUS_META, DELAY_STATUS_META, taskDelayStatus, taskExpectedPct, computeSectionProgress,
  type Project, type ProjectStatus, type ProfileLite, type DelayStatus,
} from '../types/domain';
import { useAuth } from '../context/AuthContext';

const ACTIVE_STATES: ProjectStatus[] = ['levantamiento', 'desarrollo', 'validacion'];

// "A tiempo" va en verde (no azul como antes) para no confundirse con el
// azul del estado "En desarrollo" que está en la misma tarjeta.
const DELAY_TONE: Record<DelayStatus, string> = {
  completado: 'green', en_tiempo: 'green', atrasado: 'rust',
};

// Selector de proveedor: solo los registrados en Usuarios -> Proveedores.
// Si el proyecto trae un proveedor escrito a mano que no está registrado
// (proyectos viejos), se muestra como opción aparte para no perderlo al
// guardar, marcado "no registrado".
function ProviderSelect({ id, value, providers, onChange }: {
  id: string;
  value: string;
  providers: { id: string; name: string }[];
  onChange: (name: string) => void;
}) {
  const unregistered = value && !providers.some((p) => p.name === value) ? value : null;
  return (
    <select id={id} className="modal-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sin asignar</option>
      {providers.map((p) => (
        <option key={p.id} value={p.name}>{p.name}</option>
      ))}
      {unregistered && <option value={unregistered}>{unregistered} (no registrado)</option>}
    </select>
  );
}

function ScheduleBadge({ status }: { status: DelayStatus }) {
  return (
    <span className={`pcard-badge tone-${DELAY_TONE[status]}`}>
      {status === 'completado' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : status === 'en_tiempo' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      )}
      {DELAY_STATUS_META[status]}
    </span>
  );
}

// Avance esperado automático (ítem 3b, vuelta 2): en vez de depender de que
// cada tarea de fase tenga fechas asignadas (podían estar todas vacías en un
// proyecto recién creado), se calcula desde el rango propio del proyecto
// (startDate -> deadlineDate), igual que taskDelayStatus pero a nivel de
// proyecto completo.
function projectSchedule(p: Project): { actualPct: number; expectedPct: number; status: DelayStatus } | null {
  if (!p.deadlineDate) return null;
  const virtualTask = {
    percent: p.stats?.pct ?? 0,
    startDate: p.startDate ?? p.createdAt.slice(0, 10),
    plannedEndDate: p.deadlineDate,
  };
  const expectedPct = Math.round(taskExpectedPct(virtualTask) ?? virtualTask.percent);
  return { actualPct: virtualTask.percent, expectedPct, status: taskDelayStatus(virtualTask) };
}

interface ActorForm {
  name: string;
  jefes: ProfileLite[];
  responsable: ProfileLite | null;
  startDate: string;
  deadlineDate: string;
  proveedor: string; // nombre de un proveedor registrado; vacío = Sin asignar
}

const EMPTY_FORM: ActorForm = { name: '', jefes: [], responsable: null, startDate: '', deadlineDate: '', proveedor: '' };

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  // Conjunto de estados activos en el filtro. Vacío = "todos".
  const [statusFilters, setStatusFilters] = useState<Set<ProjectStatus>>(new Set());
  const [nameSearch, setNameSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
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
  // Filas con el desglose de avance por fase abierto -- se puede ver sin
  // tener que entrar al detalle del proyecto.
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  // Menú "⋯" abierto (uno a la vez). Eliminar vive ahí y no al lado de
  // Editar, para que no se borre un proyecto por un clic de más.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpenId]);
  // Proveedores registrados en Usuarios -> Proveedores: son las únicas
  // opciones del selector al crear o editar un proyecto. MyOffice (el
  // interno) viene preseleccionado al crear, y lo sigue usando la importación.
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const myOfficeProviderId = providers.find((p) => p.name === 'MyOffice')?.id ?? providers[0]?.id ?? null;
  const navigate = useNavigate();
  const { profile } = useAuth();
  // El asignado (desarrollador) ya no puede cambiar el estado ni borrar
  // proyectos desde la lista -- solo entrar a ver el detalle de los suyos.
  const canManage = profile?.role === 'admin' || profile?.role === 'superadmin';
  const canCreate = profile?.role === 'admin' || profile?.role === 'superadmin';

  useEffect(() => {
    ProvidersApi.list()
      .then((list) => setProviders(list))
      .catch(() => setProviders([]));
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

  const normalizedSearch = nameSearch.trim().toLowerCase();
  const visible = projects.filter(
    (p) =>
      (statusFilters.size === 0 || statusFilters.has(p.status)) &&
      (!normalizedSearch || p.name.toLowerCase().includes(normalizedSearch)) &&
      (!providerFilter || p.proveedor === providerFilter),
  );
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
    const parts: string[] = [];
    if (statusFilters.size > 0) parts.push([...statusFilters].map((s) => STATUS_META[s]).join(', '));
    if (providerFilter) parts.push(`proveedor "${providerFilter}"`);
    return parts.length ? `Filtrando por: ${parts.join(' · ')}` : 'Mostrando todos los proyectos';
  }, [statusFilters, providerFilter]);

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
    if (form.startDate && form.deadlineDate && form.deadlineDate <= form.startDate) {
      errors.deadlineDate = 'La fecha de entrega esperada debe ser posterior a la fecha de inicio.';
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setCreating(true);
    try {
      const chosen = providers.find((pr) => pr.name === form.proveedor) ?? null;
      const { id } = await ProjectsApi.create({
        name: form.name.trim(), proveedor: chosen?.name ?? 'Sin asignar',
        startDate: form.startDate || null, deadlineDate: form.deadlineDate || null,
      });
      // proveedorId null = "Sin asignar" (set_project_actors no toca el proveedor).
      await ProjectsApi.setActors(id, {
        responsableId: form.responsable!.id,
        proveedorId: chosen?.id ?? null,
      });
      for (const jefe of form.jefes) {
        await ProjectsApi.addJefe(id, jefe.id);
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
      startDate: p.startDate ?? '',
      deadlineDate: p.deadlineDate ?? '',
      proveedor: p.proveedor && p.proveedor !== 'Sin asignar' ? p.proveedor : '',
    });
    setEditErrors({});
  }

  async function saveActors() {
    if (!editingProject) return;
    const errors: Record<string, string> = {};
    if (!editForm.jefes.length) errors.jefe = 'Elige al menos un jefe de proyecto.';
    if (!editForm.responsable) errors.responsable = 'Elige quién es la persona asignada.';
    if (editForm.startDate && editForm.deadlineDate && editForm.deadlineDate <= editForm.startDate) {
      errors.deadlineDate = 'La fecha de entrega esperada debe ser posterior a la fecha de inicio.';
    }
    setEditErrors(errors);
    if (Object.keys(errors).length) return;

    setSavingActors(true);
    try {
      // proveedorId null: set_project_actors deja el proveedor como está
      // (antes mandaba MyOffice por defecto y pisaba el proveedor real).
      await ProjectsApi.setActors(editingProject.id, {
        responsableId: editForm.responsable!.id,
        proveedorId: null,
      });
      const currentProvider = editingProject.proveedor && editingProject.proveedor !== 'Sin asignar' ? editingProject.proveedor : '';
      if (editForm.proveedor.trim() !== currentProvider) {
        await ProjectsApi.setProvider(editingProject.id, editForm.proveedor.trim());
      }
      if (editForm.startDate !== (editingProject.startDate ?? '')) {
        await ProjectsApi.updateStartDate(editingProject.id, editForm.startDate || null);
      }
      if (editForm.deadlineDate !== (editingProject.deadlineDate ?? '')) {
        await ProjectsApi.updateDeadline(editingProject.id, editForm.deadlineDate || null);
      }
      const beforeJefeIds = new Set(editingProject.jefes.map((j) => j.id));
      const afterJefeIds = new Set(editForm.jefes.map((j) => j.id));
      for (const jefe of editForm.jefes) {
        if (!beforeJefeIds.has(jefe.id)) await ProjectsApi.addJefe(editingProject.id, jefe.id);
      }
      for (const jefe of editingProject.jefes) {
        if (!afterJefeIds.has(jefe.id)) await ProjectsApi.removeJefe(editingProject.id, jefe.id);
      }
      setEditingProject(null);
      load();
    } catch (err) {
      alert(`No se pudo actualizar: ${(err as Error).message}`);
    } finally {
      setSavingActors(false);
    }
  }

  function togglePhasesRow(projectId: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return next;
    });
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
        <ProjectsDashboard
          projects={projects}
          onSliceClick={(status) => handleStatusToggle(status, false)}
          onProviderClick={(name) => setProviderFilter((prev) => (prev === name ? null : name))}
        />
      )}

      <div className="toolbar">
        <div className="filters">
          <input
            type="text"
            className="filter-search"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Buscar proyecto por nombre…"
          />
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
          {providerFilter && (
            <button className="btn ghost small" onClick={() => setProviderFilter(null)}>
              Quitar filtro de proveedor ×
            </button>
          )}
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
            <button
              className="btn"
              onClick={() => {
                // Proyecto nuevo: MyOffice (el proveedor interno) preseleccionado,
                // salvo que ya se haya elegido otro en este formulario.
                if (!showIntake && !form.proveedor && providers.some((pr) => pr.name === 'MyOffice')) {
                  setForm((f) => ({ ...f, proveedor: 'MyOffice' }));
                }
                setShowIntake((v) => !v);
              }}
            >
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
                El código se asigna automáticamente al guardar. El proveedor se elige entre los
                registrados en Usuarios → Proveedores.
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
                    extraRoles={['qa']}
                    value={form.responsable}
                    onChange={(p) => setForm({ ...form, responsable: p })}
                  />
                  {formErrors.responsable && <span className="field-error">{formErrors.responsable}</span>}
                </div>
                <div className="modal-field">
                  <label htmlFor="new-proveedor">Proveedor</label>
                  <ProviderSelect
                    id="new-proveedor"
                    value={form.proveedor}
                    providers={providers}
                    onChange={(name) => setForm({ ...form, proveedor: name })}
                  />
                </div>
                <div className="modal-field">
                  <label>Fecha de inicio</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </div>
                <div className={`modal-field${formErrors.deadlineDate ? ' has-error' : ''}`}>
                  <label>Fecha de entrega esperada</label>
                  <input
                    type="date"
                    value={form.deadlineDate}
                    onChange={(e) => setForm({ ...form, deadlineDate: e.target.value })}
                  />
                  {formErrors.deadlineDate && <span className="field-error">{formErrors.deadlineDate}</span>}
                  <span className="field-hint">Si no se definen, el plazo por defecto es de 3 meses desde hoy.</span>
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
                Reasigna quién es el jefe de proyecto, la persona asignada (desarrollador o QA) y el proveedor de "
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
                    extraRoles={['qa']}
                    value={editForm.responsable}
                    onChange={(p) => setEditForm({ ...editForm, responsable: p })}
                  />
                  {editErrors.responsable && <span className="field-error">{editErrors.responsable}</span>}
                </div>
                <div className="modal-field">
                  <label htmlFor="edit-proveedor">Proveedor</label>
                  <ProviderSelect
                    id="edit-proveedor"
                    value={editForm.proveedor}
                    providers={providers}
                    onChange={(name) => setEditForm({ ...editForm, proveedor: name })}
                  />
                </div>
                <div className="modal-field">
                  <label>Fecha de inicio</label>
                  <input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                  />
                </div>
                <div className={`modal-field${editErrors.deadlineDate ? ' has-error' : ''}`}>
                  <label>Plazo (fecha de entrega esperada)</label>
                  <input
                    type="date"
                    value={editForm.deadlineDate}
                    onChange={(e) => setEditForm({ ...editForm, deadlineDate: e.target.value })}
                  />
                  {editErrors.deadlineDate && <span className="field-error">{editErrors.deadlineDate}</span>}
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

      <div className="proj-table pcard-list">
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            {canCreate
              ? 'No hay proyectos con este filtro. Crea uno con “+ Nuevo proyecto”.'
              : 'No tienes proyectos asignados con este filtro.'}
          </div>
        ) : (
          visible.map((p) => {
            const schedule = projectSchedule(p);
            return (
            <article
              className="pcard"
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              title="Ver detalle del proyecto"
            >
              <div className="pcard-body">
                <div className="pcard-main">
                  <div className="pcard-tags" onClick={(e) => e.stopPropagation()}>
                    <span className="pcard-code">{p.code}</span>
                    <span className={`pcard-status ${p.status}`}>
                      <span className="pcard-status-dot" aria-hidden="true" />
                      <select
                        value={p.status}
                        disabled={!canManage}
                        aria-label={`Estado del proyecto ${p.code}`}
                        onChange={(e) => changeStatus(p.id, e.target.value as ProjectStatus)}
                      >
                        {Object.entries(STATUS_META).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </div>
                  <h2 className="pcard-title">
                    <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                  </h2>
                  <div className="pcard-people">
                    <PersonChip
                      role={p.jefes.length > 1 ? 'Jefes de proyecto' : 'Jefe de proyecto'}
                      name={p.jefes.length ? p.jefes.map((j) => j.nombre).join(', ') : null}
                    />
                    <PersonChip role="Asignado" name={p.responsableNombre} />
                    <PersonChip role="Proveedor" name={p.proveedor && p.proveedor !== 'Sin asignar' ? p.proveedor : null} />
                  </div>
                </div>

                <div className="pcard-progress" onClick={(e) => e.stopPropagation()}>
                  <div className="pcard-progress-head">
                    <span className="pcard-eyebrow">Avance del proyecto</span>
                    {schedule && <ScheduleBadge status={schedule.status} />}
                  </div>
                  <div className="pcard-progress-figures">
                    <span className="pcard-pct">{p.stats?.pct ?? 0}%</span>
                    <span className="pcard-pct-caption">
                      {schedule ? (
                        <>de avance real · <strong>{schedule.expectedPct}%</strong> esperado</>
                      ) : (
                        'de avance real · sin fecha de entrega'
                      )}
                    </span>
                  </div>
                  <div className="pcard-bar" aria-hidden="true">
                    <span className="pcard-bar-track" />
                    <span
                      className={`pcard-bar-fill${(p.stats?.pct ?? 0) >= 100 ? ' is-complete' : ''}`}
                      style={{ width: `${p.stats?.pct ?? 0}%` }}
                    />
                    {schedule && <span className="pcard-bar-marker" style={{ left: `${schedule.expectedPct}%` }} />}
                  </div>
                  <button
                    type="button"
                    className="pcard-toggle"
                    aria-expanded={expandedPhases.has(p.id)}
                    onClick={() => togglePhasesRow(p.id)}
                  >
                    {expandedPhases.has(p.id) ? 'Ocultar desglose por sección' : 'Ver desglose por sección'}
                    <svg className={`pcard-chevron${expandedPhases.has(p.id) ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>

                {canManage && (
                  <div className="pcard-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="pcard-btn" title="Editar jefe, persona asignada y proveedor" onClick={() => openEditActors(p)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      Editar
                    </button>
                    <div className="pcard-menu-wrap">
                      <button
                        type="button"
                        className="pcard-icon-btn"
                        aria-label={`Más acciones para ${p.code}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === p.id}
                        onClick={() => setMenuOpenId((cur) => (cur === p.id ? null : p.id))}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                      </button>
                      {menuOpenId === p.id && (
                        <div className="pcard-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="pcard-menu-item danger"
                            onClick={() => { setMenuOpenId(null); deleteProject(p); }}
                          >
                            Eliminar proyecto
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {expandedPhases.has(p.id) && (
                <div className="pcard-breakdown" onClick={(e) => e.stopPropagation()}>
                  <span className="pcard-eyebrow">Avance por sección · calculado de los checkpoints aprobados por QA</span>
                  {p.sections.length === 0 ? (
                    <span className="admin-hint" style={{ padding: 0 }}>Este proyecto no tiene secciones todavía.</span>
                  ) : (
                    <div className="pcard-sections">
                      {computeSectionProgress(p.sections).map((row) => (
                        <div className="pcard-section" key={row.id}>
                          <div className="pcard-section-head">
                            <span className="pcard-section-name">
                              <span className="section-progress-code">{row.code}</span>
                              <span className="pcard-section-title" title={row.title}>{row.title}</span>
                            </span>
                            <span className="pcard-section-pct">{row.pct}%</span>
                          </div>
                          <span className="pcard-section-bar"><span className={row.pct >= 100 ? 'is-complete' : undefined} style={{ width: `${row.pct}%` }} /></span>
                          <span className="pcard-section-count">{row.done} de {row.total} checkpoints completos</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
