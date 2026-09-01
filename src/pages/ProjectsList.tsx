import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ProjectsApi } from '../lib/services';
import { STATUS_META, type Project, type ProjectStatus } from '../types/domain';
import { useAuth } from '../context/AuthContext';

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | ProjectStatus>('all');
  const [showIntake, setShowIntake] = useState(false);
  const [form, setForm] = useState({ name: '', proveedor: 'MyOffice' });
  const [proveedorChoice, setProveedorChoice] = useState<'MyOffice' | 'otro'>('MyOffice');
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'desarrollador';

  async function load() {
    setLoading(true);
    const data = await ProjectsApi.list();
    setProjects(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const visible = projects.filter((p) => filterStatus === 'all' || p.status === filterStatus);
  const totals = {
    total: projects.length,
    activos: projects.filter((p) => p.status !== 'cerrado').length,
    cerrados: projects.filter((p) => p.status === 'cerrado').length,
    avg: projects.length
      ? Math.round(projects.reduce((a, p) => a + (p.stats?.pct ?? 0), 0) / projects.length)
      : 0,
  };

  async function createProject() {
    if (!form.name.trim() || !form.proveedor.trim()) {
      alert('Ingresa al menos el nombre del proyecto y el proveedor.');
      return;
    }
    await ProjectsApi.create({ name: form.name, proveedor: form.proveedor });
    setForm({ name: '', proveedor: 'MyOffice' });
    setProveedorChoice('MyOffice');
    setShowIntake(false);
    load();
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
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Proyectos totales</div>
          <div className="value">{totals.total}</div>
        </div>
        <div className="kpi k-blue">
          <div className="label">Activos</div>
          <div className="value">{totals.activos}</div>
        </div>
        <div className="kpi k-green">
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
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
            <option value="all">Estado: todos</option>
            {Object.entries(STATUS_META).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {canManage && (
          <div className="btn-group">
            <button className="btn" onClick={() => setShowIntake((s) => !s)}>
              + Nuevo proyecto
            </button>
          </div>
        )}
      </div>

      {showIntake && (
        <div className="intake">
          <h3>Crear proyecto</h3>
          <div className="intake-grid">
            <div className="field">
              <label>Nombre del proyecto</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Portal de clientes"
              />
            </div>
            <div className="field">
              <label>Proveedor</label>
              <select
                value={proveedorChoice}
                onChange={(e) => {
                  const choice = e.target.value as 'MyOffice' | 'otro';
                  setProveedorChoice(choice);
                  setForm({ ...form, proveedor: choice === 'MyOffice' ? 'MyOffice' : '' });
                }}
              >
                <option value="MyOffice">MyOffice</option>
                <option value="otro">Otro…</option>
              </select>
              {proveedorChoice === 'otro' && (
                <input
                  type="text"
                  value={form.proveedor}
                  onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
                  placeholder="Ej. Acme S.A."
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          </div>
          <div className="intake-actions">
            <button className="btn ghost" onClick={() => setShowIntake(false)}>
              Cancelar
            </button>
            <button className="btn" onClick={createProject}>
              Crear proyecto
            </button>
          </div>
        </div>
      )}

      <div className="proj-table">
        <div className="proj-row head">
          <span>Código</span>
          <span>Proyecto</span>
          <span>Proveedor</span>
          <span>Estado</span>
          <span>Avance</span>
          <span></span>
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
              <span></span>
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
