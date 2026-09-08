import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DirectorySearch from '../components/DirectorySearch';
import { UsersAdminApi, type DirectoryUser } from '../lib/services';
import type { ProfileLite } from '../types/domain';
import { useAuth } from '../context/AuthContext';

type ManagedRole = 'desarrollador' | 'cliente';

const SECTION_META: Record<ManagedRole, { code: string; title: string; hint: string }> = {
  desarrollador: {
    code: 'RESP',
    title: 'Personas asignadas',
    hint: 'Cuentas que se pueden elegir como "Persona asignada" (responsable) al crear un proyecto.',
  },
  cliente: {
    code: 'PRV',
    title: 'Proveedores',
    hint: 'Cuentas que se pueden elegir como "Proveedor" al crear un proyecto.',
  },
};

function UserRoleSection({ role }: { role: ManagedRole }) {
  const meta = SECTION_META[role];
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
        if (role === 'desarrollador' && created.emailError) {
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
        if (role === 'desarrollador' && emailError) {
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
          {showForm ? 'Cancelar' : '+ Nueva cuenta'}
        </button>
      </div>
      <p className="admin-hint">{meta.hint}</p>

      {showForm && (
        <div className="intake compact">
          <div className="field full">
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
          <div className="intake-actions">
            <button className="btn" onClick={createUser} disabled={creating || !form.fullName || !form.email}>
              {creating ? 'Creando…' : 'Crear cuenta'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="empty-state">No hay cuentas registradas todavía.</div>
      ) : (
        <ul className="items">
          {users.map((u) => (
            <li className="item-block" key={u.id}>
              <div className="item">
                <input
                  type="text"
                  value={editing[u.id] ?? u.fullName ?? ''}
                  onChange={(e) => setEditing((s) => ({ ...s, [u.id]: e.target.value }))}
                  onBlur={() => saveRename(u)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="tool-rename-input"
                  disabled={busyId === u.id}
                />
                <span className="item-email">{u.email}</span>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ToolsPage() {
  const { profile } = useAuth();

  if (profile && profile.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Solo administradores</p>
          <h1>Usuarios</h1>
          <p className="sub">
            Crea y administra las cuentas que se pueden asignar como responsable o proveedor al
            crear un proyecto. Las cuentas de admin/jefe de proyecto se siguen creando desde el
            dashboard de Supabase.
          </p>
        </div>
      </div>

      <UserRoleSection role="desarrollador" />
      <UserRoleSection role="cliente" />
    </AppShell>
  );
}
