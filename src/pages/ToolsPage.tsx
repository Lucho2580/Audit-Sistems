import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import ProvidersPanel from '../components/ProvidersPanel';
import { initialsOf } from '../lib/initials';
import { useSidebarStats } from '../context/ShellChromeContext';
import { UsersAdminApi } from '../lib/services';
import type { ProfileLite, PendingInvite } from '../types/domain';
import { useAuth } from '../context/AuthContext';

type ManagedRole = 'desarrollador' | 'admin' | 'qa';

// Valor del rol de aplicación en Entra ID que corresponde a cada sección
// (ver migración 2026101506_entra_app_roles.sql).
const ROLE_META: Record<ManagedRole, { code: string; title: string; hint: string; entraRole: string }> = {
  admin: {
    code: 'ADM',
    title: 'Jefes de proyecto',
    hint: 'Acceso completo a todos los proyectos (crear, editar, cerrar).',
    entraRole: 'JefeProyecto',
  },
  desarrollador: {
    code: 'RESP',
    title: 'Personas asignadas',
    hint: 'Se pueden elegir como "Persona asignada" (responsable) de un proyecto. Solo ven los proyectos asignados y escriben seguimientos en sus tareas.',
    entraRole: 'PersonaAsignada',
  },
  qa: {
    code: 'QA',
    title: 'QA',
    hint: 'Aprueban fases de proyecto y reportes de seguimiento. También pueden ser persona asignada (responsable) de proyectos; en esos proyectos sus hitos los revisa otra persona de QA.',
    entraRole: 'QA',
  },
};

// Solo lectura: el alta, la baja y el rol de cada cuenta se administran en
// Entra ID (roles de aplicación de "Sistema de Auditoría"); la app los toma
// en cada inicio de sesión. Aquí solo se ve quién tiene acceso y con qué rol.
function UserRoleSection({ role, onStats }: { role: ManagedRole; onStats?: (s: { count: number; confirmed: number }) => void }) {
  const meta = ROLE_META[role];
  const [users, setUsers] = useState<ProfileLite[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [confirmed, pending] = await Promise.all([
          UsersAdminApi.list(role),
          UsersAdminApi.listPendingInvites(),
        ]);
        if (!active) return;
        setUsers(confirmed);
        setInvites(pending.filter((i) => i.role === role));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [role]);

  useEffect(() => {
    onStats?.({ count: users.length, confirmed: users.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">{meta.code}</span>
          <h2>{meta.title}</h2>
          {!loading && <span className="ucard-count">{users.length}</span>}
        </div>
      </div>
      <p className="admin-hint">
        {meta.hint} Rol en Entra ID: <code className="ucard-role-code">{meta.entraRole}</code>
      </p>

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : users.length === 0 && invites.length === 0 ? (
        <div className="empty-state">Nadie tiene este rol todavía.</div>
      ) : (
        <div className="ucard-grid">
          {invites.map((invite) => (
            <article className="ucard pending" key={`inv:${invite.email}`}>
              <div className="ucard-top readonly">
                <span className="pcard-avatar missing" aria-hidden="true">{initialsOf(invite.fullName)}</span>
                <div className="ucard-id">
                  <span className="ucard-code">{meta.code}-INV</span>
                  <span className="ucard-name static" title={invite.fullName}>{invite.fullName}</span>
                  <span className="ucard-email" title={invite.email}>{invite.email}</span>
                </div>
              </div>
              <div className="ucard-foot">
                <span className="pcard-badge tone-gold">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  Aún no ha entrado
                </span>
              </div>
            </article>
          ))}
          {users.map((u, idx) => {
            const displayName = u.fullName ?? u.email;
            return (
              <article className="ucard" key={u.id}>
                <div className="ucard-top readonly">
                  <span className="pcard-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
                  <div className="ucard-id">
                    <span className="ucard-code">{meta.code}-{String(idx + 1).padStart(2, '0')}</span>
                    <span className="ucard-name static" title={displayName}>{displayName}</span>
                    <span className="ucard-email" title={u.email}>{u.email}</span>
                  </div>
                </div>
                <div className="ucard-foot">
                  <span className="pcard-badge tone-green">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                    Con acceso
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ToolsPage() {
  const { profile } = useAuth();
  const [devStats, setDevStats] = useState({ count: 0, confirmed: 0 });
  const [adminStats, setAdminStats] = useState({ count: 0, confirmed: 0 });
  const [qaStats, setQaStats] = useState({ count: 0, confirmed: 0 });

  useSidebarStats(
    useMemo(
      () => ({
        title: 'Cuentas',
        items: [
          { label: 'Jefes de proyecto', value: String(adminStats.count), note: 'con acceso total' },
          { label: 'Personas asignadas', value: String(devStats.count), note: 'responsables' },
          { label: 'QA', value: String(qaStats.count), note: 'aprueban fases' },
        ],
      }),
      [devStats, adminStats, qaStats],
    ),
  );

  if (profile && profile.role !== 'admin' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Solo administradores · consulta</p>
          <h1>Usuarios</h1>
        </div>
        <p className="intro">
          Quién tiene acceso al sistema y con qué rol. Las altas, bajas y cambios de rol se hacen en
          Entra ID: Aplicaciones empresariales → Sistema de Auditoría → Usuarios y grupos. Un cambio
          de rol se aplica la próxima vez que la persona inicia sesión.
        </p>
      </div>

      <UserRoleSection role="admin" onStats={setAdminStats} />
      <UserRoleSection role="desarrollador" onStats={setDevStats} />
      <UserRoleSection role="qa" onStats={setQaStats} />
      <ProvidersPanel />
    </AppShell>
  );
}
