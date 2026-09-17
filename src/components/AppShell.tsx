import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSidebarPanel } from '../context/ShellChromeContext';
import laViandaBlanco from '../assets/lavianda-blanco.png';

function ShellSidebar() {
  const { session, profile, signOut } = useAuth();
  const { panel, dashboardToggle } = useSidebarPanel();
  if (!session) return null;

  return (
    <aside className="shell-side">
      <div className="shell-brand">
        <img className="shell-logo" src={laViandaBlanco} alt="La Vianda" />
        <div className="shell-brand-title">
          Sistema de auditoría
          <span className="shell-brand-sub">Desarrollo de software</span>
        </div>
        <div className="shell-rule" />
      </div>

      <nav className="shell-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span>{profile?.role === 'cliente' ? 'Mis actas' : 'Proyectos'}</span>
          <span className="mark">·</span>
        </NavLink>
        {profile?.role !== 'cliente' && (
          <NavLink to="/timeline" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>Línea de tiempo</span>
            <span className="mark">·</span>
          </NavLink>
        )}
        {(profile?.role === 'admin' || profile?.role === 'superadmin') && (
          <NavLink to="/informe-semanal" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>Informe semanal</span>
            <span className="mark">·</span>
          </NavLink>
        )}
        {(profile?.role === 'admin' || profile?.role === 'superadmin') && (
          <NavLink to="/tools" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>Herramientas</span>
            <span className="mark">·</span>
          </NavLink>
        )}
      </nav>

      {panel && (
        <div className="shell-stats">
          <div className="shell-stats-title">{panel.title}</div>
          {panel.items.map((s) => (
            <div
              className={`shell-stat${s.onClick ? ' clickable' : ''}${s.active ? ' active' : ''}`}
              key={s.label}
              onClick={s.onClick}
              role={s.onClick ? 'button' : undefined}
            >
              <div className="shell-stat-text">
                <div className="shell-stat-label">{s.label}</div>
                <div className="shell-stat-note">{s.note}</div>
              </div>
              <div className="shell-stat-value">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="shell-bottom">
        {dashboardToggle && (
          <button className="shell-dashboard-toggle" onClick={dashboardToggle.onToggle}>
            {dashboardToggle.active ? 'Ocultar dashboard' : 'Mostrar dashboard'}
          </button>
        )}
        <div className="shell-foot">
          <div className="shell-user">
            {profile ? profile.email : session.user.email}
            <br />
            <span className="shell-role">{profile?.role ?? ''}</span>
            <span className="shell-sep"> · </span>
            <button className="linklike" onClick={signOut}>
              Salir
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <ShellSidebar />
      <div className="shell-main">
        <div className="wrap">
          {children}
          <footer>
            Los checkpoints completados solo se reabren con una observación. Los seguimientos y las
            reuniones se pueden eliminar en cualquier momento.
          </footer>
        </div>
      </div>
    </div>
  );
}
