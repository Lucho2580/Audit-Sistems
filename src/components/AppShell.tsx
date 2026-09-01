import type { ReactNode } from 'react';
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
      {children}
      <footer>
        Los checkpoints completados solo se reabren con una observación. Los seguimientos y las
        reuniones se pueden eliminar en cualquier momento.
      </footer>
    </div>
  );
}
