import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ProjectsList from './pages/ProjectsList';
import ProjectDetail from './pages/ProjectDetail';
import ClientPortal from './pages/ClientPortal';
import SignPage from './pages/SignPage';
import TimelinePage from './pages/TimelinePage';
import ToolsPage from './pages/ToolsPage';
import ForceChangePassword from './pages/ForceChangePassword';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="wrap">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.mustChangePassword) return <ForceChangePassword />;
  return <>{children}</>;
}

// El cliente solo tiene su portal (lista de actas de sus proyectos) -- el
// resto de rutas privadas son de staff (jefe/persona asignada/admin) y no
// tienen sentido para su rol, aparte de que RLS ya le filtra los datos.
function StaffOnlyRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role === 'cliente') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRoute() {
  const { profile } = useAuth();
  return profile?.role === 'cliente' ? <ClientPortal /> : <ProjectsList />;
}

export default function App() {
  return (
    <Routes>
      {/* Ruta pública: firma de actas vía enlace con token, sin necesidad de cuenta */}
      <Route path="/sign/:token" element={<SignPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <HomeRoute />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <PrivateRoute>
            <StaffOnlyRoute>
              <ProjectDetail />
            </StaffOnlyRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/timeline"
        element={
          <PrivateRoute>
            <StaffOnlyRoute>
              <TimelinePage />
            </StaffOnlyRoute>
          </PrivateRoute>
        }
      />
      <Route
        path="/tools"
        element={
          <PrivateRoute>
            <StaffOnlyRoute>
              <ToolsPage />
            </StaffOnlyRoute>
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
