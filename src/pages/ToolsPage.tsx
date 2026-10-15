import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DirectorySearch from '../components/DirectorySearch';
import ProvidersPanel from '../components/ProvidersPanel';
import { useSidebarStats } from '../context/ShellChromeContext';
import { UsersAdminApi, type DirectoryUser } from '../lib/services';
import { ACTOR_ROLE_LABEL, type ProfileLite, type PendingInvite } from '../types/domain';
import { useAuth } from '../context/AuthContext';

type ManagedRole = 'desarrollador' | 'admin' | 'qa';

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
  qa: {
    code: 'QA',
    title: 'QA',
    hint: 'Cuentas que pueden aprobar fases de proyecto (dan el "OK" de QA antes de que una fase quede cerrada). Reciben un correo cuando una fase se manda a revisión.',
    kicker: 'QA',
    modalTitle: 'Crear cuenta de QA',
  },
};

function UserRoleSection({ role, onStats }: { role: ManagedRole; onStats?: (s: { count: number; confirmed: number }) => void }) {
  const meta = ROLE_META[role];
  const [users, setUsers] = useState<ProfileLite[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [confirmed, pending] = await Promise.all([
        UsersAdminApi.list(role),
        UsersAdminApi.listPendingInvites(),
      ]);
      setUsers(confirmed);
      setInvites(pending.filter((i) => i.role === role));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onStats?.({ count: users.length, confirmed: users.length });
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
      const invited = await UsersAdminApi.create({ fullName, email, role });
      if (invited.emailSent) {
        alert(`Se invitó a ${fullName}. Se le mandó un correo a ${invited.email} para que entre con su cuenta de Microsoft.`);
      } else {
        let msg = `Se invitó a ${fullName} (${invited.email}), pero no se pudo enviar el correo automático.`;
        if (invited.emailError) msg += `\n\n(${invited.emailError})`;
        msg += '\n\nAvísale por otro medio que ya puede entrar con su cuenta de Microsoft.';
        alert(msg);
      }
      setForm({ fullName: '', email: '' });
      setShowForm(false);
      load();
    } catch (err) {
      alert(`No se pudo invitar la cuenta: ${(err as Error).message}`);
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

  async function resendInvite(invite: PendingInvite) {
    setBusyEmail(invite.email);
    try {
      const { emailSent, emailError } = await UsersAdminApi.resendInvite(invite.email);
      if (emailSent) alert(`Se reenvió la invitación a ${invite.email}.`);
      else alert(`No se pudo reenviar el correo automático a ${invite.email}.${emailError ? `\n\n(${emailError})` : ''}`);
    } catch (err) {
      alert(`No se pudo reenviar la invitación: ${(err as Error).message}`);
    } finally {
      setBusyEmail(null);
    }
  }

  async function cancelInvite(invite: PendingInvite) {
    if (!confirm(`¿Cancelar la invitación de "${invite.fullName}" (${invite.email})?`)) return;
    setBusyEmail(invite.email);
    try {
      await UsersAdminApi.cancelInvite(invite.email);
      load();
    } catch (err) {
      alert(`No se pudo cancelar la invitación: ${(err as Error).message}`);
    } finally {
      setBusyEmail(null);
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
                    roleLabel={ACTOR_ROLE_LABEL[role]}
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
                  <div className="stat-value accent">Invitación pendiente</div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span className="modal-foot-hint">Se envía un correo para que entre con su cuenta de Microsoft.</span>
              <div className="modal-foot-actions">
                <button className="btn ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button className="btn" onClick={createUser} disabled={creating || !form.fullName || !form.email}>
                  {creating ? 'Invitando…' : 'Invitar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : users.length === 0 && invites.length === 0 ? (
        <div className="empty-state">No hay cuentas registradas todavía.</div>
      ) : (
        <div>
          {invites.map((invite) => (
            <div className="account-row" key={invite.email}>
              <div className="account-main">
                <div className="account-code">{meta.code}-INV</div>
                <div className="account-name-input" style={{ display: 'flex', alignItems: 'center' }}>{invite.fullName}</div>
                <div className="account-email">{invite.email}</div>
              </div>
              <div className="account-side">
                <span className="status-badge pending">Invitación pendiente</span>
                <button className="hist-btn" onClick={() => resendInvite(invite)} disabled={busyEmail === invite.email}>
                  Reenviar
                </button>
                <button
                  className="del-btn"
                  title="Cancelar invitación"
                  onClick={() => cancelInvite(invite)}
                  disabled={busyEmail === invite.email}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
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
                <span className="status-badge confirmed">Confirmado</span>
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

export default function ToolsPage() {
  const { profile } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';
  const [devStats, setDevStats] = useState({ count: 0, confirmed: 0 });
  const [adminStats, setAdminStats] = useState({ count: 0, confirmed: 0 });
  const [qaStats, setQaStats] = useState({ count: 0, confirmed: 0 });

  useSidebarStats(
    useMemo(
      () => ({
        title: 'Cuentas',
        items: [
          ...(isSuperadmin ? [{ label: 'Jefes de proyecto', value: String(adminStats.count), note: 'con acceso total' }] : []),
          { label: 'Personas asignadas', value: String(devStats.count), note: 'responsables' },
          ...(isSuperadmin ? [{ label: 'QA', value: String(qaStats.count), note: 'aprueban fases' }] : []),
          {
            label: 'Confirmadas',
            value: String(devStats.confirmed + (isSuperadmin ? adminStats.confirmed + qaStats.confirmed : 0)),
            note: 'con acceso',
          },
        ],
      }),
      [devStats, adminStats, qaStats, isSuperadmin],
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
          Crea y administra las cuentas que se pueden asignar como responsable al crear un proyecto.
          {isSuperadmin && ' Como superadmin, también puedes crear cuentas de jefe de proyecto.'}
        </p>
      </div>

      {isSuperadmin && <UserRoleSection role="admin" onStats={setAdminStats} />}
      <UserRoleSection role="desarrollador" onStats={setDevStats} />
      {isSuperadmin && <UserRoleSection role="qa" onStats={setQaStats} />}
      <ProvidersPanel />
    </AppShell>
  );
}
