import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DirectorySearch from '../components/DirectorySearch';
import { useSidebarStats } from '../context/ShellChromeContext';
import { UsersAdminApi, ProvidersApi, type DirectoryUser } from '../lib/services';
import { ACTOR_ROLE_LABEL, type ProfileLite, type Provider } from '../types/domain';
import { useAuth } from '../context/AuthContext';

type ManagedRole = 'desarrollador' | 'admin';

const ROLE_META: Record<ManagedRole, { code: string; title: string; hint: string; kicker: string; modalTitle: string }> = {
  desarrollador: {
    code: 'RESP',
    title: 'Personas asignadas',
    hint: 'Cuentas que se pueden elegir como "Persona asignada" (responsable) al crear un proyecto. Solo pueden ver los proyectos asignados y escribir seguimientos en sus tareas.',
    kicker: 'Personas asignadas',
    modalTitle: 'Crear cuenta de persona asignada',
  },
  admin: {
    code: 'ADM',
    title: 'Jefes de proyecto',
    hint: 'Cuentas con acceso completo a todos los proyectos (crear, editar, cerrar). No pueden crear otras cuentas de jefe de proyecto -- eso es exclusivo del superadmin.',
    kicker: 'Jefes de proyecto',
    modalTitle: 'Crear cuenta de jefe de proyecto',
  },
};

function UserRoleSection({ role, onStats }: { role: ManagedRole; onStats?: (s: { count: number; confirmed: number }) => void }) {
  const meta = ROLE_META[role];
  const [users, setUsers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setUsers(await UsersAdminApi.list(role));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStats?.({ count: users.length, confirmed: users.filter((u) => !u.mustChangePassword).length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  async function createUser() {
    const fullName = form.fullName.trim();
    const email = form.email.trim();
    if (!fullName || !email) {
      alert('Completa el nombre y el correo.');
      return;
    }
    setCreating(true);
    try {
      const created = await UsersAdminApi.create({ fullName, email, role });
      if (created.emailSent) {
        alert(`Cuenta creada para ${fullName}. Se le mandó un correo a ${created.email} con la contraseña temporal.`);
      } else {
        let msg =
          `Cuenta creada para ${fullName}.\n\n` +
          `Correo: ${created.email}\nContraseña temporal: ${created.tempPassword}\n\n` +
          'Cópiala y pásasela por un canal seguro — no se puede volver a ver. ' +
          'Se le pedirá cambiarla al iniciar sesión por primera vez.';
        if (created.emailError) {
          msg += `\n\n(No se pudo enviar el correo automático: ${created.emailError})`;
        }
        alert(msg);
      }
      setForm({ fullName: '', email: '' });
      setShowForm(false);
      load();
    } catch (err) {
      alert(`No se pudo crear la cuenta: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(p: ProfileLite) {
    const fullName = (editing[p.id] ?? p.fullName ?? '').trim();
    if (!fullName || fullName === p.fullName) return;
    setBusyId(p.id);
    try {
      await UsersAdminApi.update(p.id, { fullName });
      load();
    } catch (err) {
      alert(`No se pudo renombrar: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(p: ProfileLite) {
    if (!confirm(`¿Generar una contraseña temporal nueva para ${p.fullName ?? p.email}?`)) return;
    setBusyId(p.id);
    try {
      const { tempPassword, emailSent, emailError } = await UsersAdminApi.resetPassword(p.id);
      if (emailSent) {
        alert(`Se generó una contraseña temporal nueva y se le mandó un correo a ${p.email}.`);
      } else {
        let msg = `Nueva contraseña temporal para ${p.email}:\n\n${tempPassword}\n\nSe le pedirá cambiarla al iniciar sesión.`;
        if (emailError) {
          msg += `\n\n(No se pudo enviar el correo automático: ${emailError})`;
        }
        alert(msg);
      }
      load();
    } catch (err) {
      alert(`No se pudo restablecer la contraseña: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(p: ProfileLite) {
    if (!confirm(`¿Eliminar la cuenta de "${p.fullName ?? p.email}"? Esta acción no se puede deshacer.`)) return;
    setBusyId(p.id);
    try {
      await UsersAdminApi.remove(p.id);
      load();
    } catch (err) {
      alert(`No se pudo eliminar la cuenta: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">{meta.code}</span>
          <h2>{meta.title}</h2>
        </div>
        <button className="btn small" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancelar' : role === 'admin' ? '+ Nuevo jefe de proyecto' : '+ Nueva persona'}
        </button>
      </div>
      <p className="admin-hint">{meta.hint}</p>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">{meta.kicker}</div>
                <h2 className="modal-title">{meta.modalTitle}</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowForm(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">{meta.hint}</p>
              <div className="modal-fields">
                <div className="modal-field">
                  <label>Persona</label>
                  <DirectorySearch
                    placeholder="Buscar persona en Entra ID…"
                    onSelect={(u: DirectoryUser) => setForm({ fullName: u.name, email: u.email })}
                  />
                </div>
                {(form.fullName || form.email) && (
                  <div className="selected-person-chip">
                    <strong>{form.fullName || '—'}</strong>
                    <span>{form.email || '—'}</span>
                    <button type="button" onClick={() => setForm({ fullName: '', email: '' })}>Quitar</button>
                  </div>
                )}
              </div>
              <div className="stat-grid modal-stat-grid">
                <div className="stat-item">
                  <div className="stat-label">Rol</div>
                  <div className="stat-value">{ACTOR_ROLE_LABEL[role]}</div>
                </div>
                <div className="stat-item">
                  <div className="stat-label">Estado inicial</div>
                  <div className="stat-value accent">Por confirmar</div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">Se envía un correo para definir la contraseña.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="btn" onClick={createUser} disabled={creating || !form.fullName || !form.email}>
                  {creating ? 'Creando…' : 'Crear cuenta'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="empty-state">No hay cuentas registradas todavía.</div>
      ) : (
        <div>
          {users.map((u, idx) => (
            <div className="account-row" key={u.id}>
              <div className="account-main">
                <div className="account-code">{meta.code}-{String(idx + 1).padStart(2, '0')}</div>
                <input
                  type="text"
                  value={editing[u.id] ?? u.fullName ?? ''}
                  onChange={(e) => setEditing((s) => ({ ...s, [u.id]: e.target.value }))}
                  onBlur={() => saveRename(u)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="account-name-input"
                  disabled={busyId === u.id}
                />
                <div className="account-email">{u.email}</div>
              </div>
              <div className="account-side">
                <span className={`status-badge ${u.mustChangePassword ? 'pending' : 'confirmed'}`}>
                  {u.mustChangePassword ? 'Pendiente por confirmar' : 'Confirmado'}
                </span>
                <button className="hist-btn" onClick={() => resetPassword(u)} disabled={busyId === u.id}>
                  Restablecer contraseña
                </button>
                <button
                  className="del-btn"
                  title="Eliminar cuenta"
                  onClick={() => removeUser(u)}
                  disabled={busyId === u.id}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Los proveedores son solo un registro de nombre (public.providers) -- a
// diferencia de las personas asignadas, no tienen cuenta ni acceso de login
// a la app; solo se agregan a la lista para poder elegirlos al crear un
// proyecto.
function ProviderSection({ onStats }: { onStats?: (count: number) => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setProviders(await ProvidersApi.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStats?.(providers.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  async function createProvider() {
    const name = newName.trim();
    if (!name) {
      alert('Escribe el nombre del proveedor.');
      return;
    }
    setCreating(true);
    try {
      await ProvidersApi.create(name);
      setNewName('');
      setShowForm(false);
      load();
    } catch (err) {
      alert(`No se pudo crear el proveedor: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }

  async function saveRename(p: Provider) {
    const name = (editing[p.id] ?? p.name).trim();
    if (!name || name === p.name) return;
    setBusyId(p.id);
    try {
      await ProvidersApi.rename(p.id, name);
      load();
    } catch (err) {
      alert(`No se pudo renombrar: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function removeProvider(p: Provider) {
    if (!confirm(`¿Eliminar el proveedor "${p.name}"? Esta acción no se puede deshacer.`)) return;
    setBusyId(p.id);
    try {
      await ProvidersApi.remove(p.id);
      load();
    } catch (err) {
      alert(`No se pudo eliminar el proveedor: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">PRV</span>
          <h2>Proveedores</h2>
        </div>
        <button className="btn small" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancelar' : '+ Nuevo proveedor'}
        </button>
      </div>
      <p className="admin-hint">
        Proveedores que se pueden elegir al crear un proyecto. Solo quedan registrados por nombre —
        no tienen cuenta ni acceso a esta aplicación.
      </p>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-kicker">Proveedores</div>
                <h2 className="modal-title">Crear proveedor</h2>
              </div>
              <button className="modal-close" title="Cerrar" onClick={() => setShowForm(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-intro">
                El proveedor queda disponible al crear un proyecto. No tiene cuenta ni acceso a la
                aplicación.
              </p>
              <div className="modal-fields">
                <div className="modal-field">
                  <label>Nombre del proveedor</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createProvider()}
                    placeholder="Ej. Nexura S.A.S."
                    autoFocus
                  />
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">Sin acceso a la aplicación.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="btn" onClick={createProvider} disabled={creating || !newName.trim()}>
                  {creating ? 'Creando…' : 'Crear proveedor'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : providers.length === 0 ? (
        <div className="empty-state">No hay proveedores registrados todavía.</div>
      ) : (
        <div>
          {providers.map((p, idx) => (
            <div className="account-row" key={p.id}>
              <div className="account-main">
                <div className="account-code">PRV-{String(idx + 1).padStart(2, '0')}</div>
                <input
                  type="text"
                  value={editing[p.id] ?? p.name}
                  onChange={(e) => setEditing((s) => ({ ...s, [p.id]: e.target.value }))}
                  onBlur={() => saveRename(p)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="account-name-input"
                  disabled={busyId === p.id}
                />
              </div>
              <div className="account-side">
                <button
                  className="del-btn"
                  title="Eliminar proveedor"
                  onClick={() => removeProvider(p)}
                  disabled={busyId === p.id}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ToolsPage() {
  const { profile } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';
  const [devStats, setDevStats] = useState({ count: 0, confirmed: 0 });
  const [adminStats, setAdminStats] = useState({ count: 0, confirmed: 0 });
  const [providerCount, setProviderCount] = useState(0);

  useSidebarStats(
    useMemo(
      () => ({
        title: 'Cuentas',
        items: [
          ...(isSuperadmin ? [{ label: 'Jefes de proyecto', value: String(adminStats.count), note: 'con acceso total' }] : []),
          { label: 'Personas asignadas', value: String(devStats.count), note: 'responsables' },
          { label: 'Proveedores', value: String(providerCount), note: 'registrados' },
          { label: 'Confirmadas', value: String(devStats.confirmed + (isSuperadmin ? adminStats.confirmed : 0)), note: 'con acceso' },
        ],
      }),
      [devStats, adminStats, providerCount, isSuperadmin],
    ),
  );

  if (profile && profile.role !== 'admin' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Solo administradores</p>
          <h1>Usuarios</h1>
        </div>
        <p className="intro">
          Crea y administra las cuentas que se pueden asignar como responsable al crear un proyecto,
          y los proveedores disponibles para elegir (solo por nombre, sin acceso a la aplicación).
          {isSuperadmin && ' Como superadmin, también puedes crear cuentas de jefe de proyecto.'}
        </p>
      </div>

      {isSuperadmin && <UserRoleSection role="admin" onStats={setAdminStats} />}
      <UserRoleSection role="desarrollador" onStats={setDevStats} />
      <ProviderSection onStats={setProviderCount} />
    </AppShell>
  );
}
