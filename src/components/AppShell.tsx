import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AppShell({ children }: { children: ReactNode }) {
  const { session, profile, signOut } = useAuth();
  return (
    <div className="wrap">
      <div className="appbar">
        <span>
          Sistema de auditoría <span className="dot">·</span> Desarrollo de software
        </span>
        {session && (
          <span className="userchip">
            {profile ? `${profile.email} · ${profile.role}` : session.user.email}
            <button className="linklike" onClick={signOut}>
              Salir
            </button>
          </span>
        )}
      </div>
      {session && (
        <nav className="main-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Proyectos
          </NavLink>
          <NavLink to="/timeline" className={({ isActive }) => (isActive ? 'active' : '')}>
            Línea de tiempo
          </NavLink>
          {profile?.role === 'admin' && (
            <NavLink to="/tools" className={({ isActive }) => (isActive ? 'active' : '')}>
              Herramientas
            </NavLink>
          )}
        </nav>
      )}
      {children}
      <footer>
        Los checkpoints completados solo se reabren con una observación. Los seguimientos y las
        reuniones se pueden eliminar en cualquier momento.
      </footer>
    </div>
  );
}
