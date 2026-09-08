import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ProjectsList from './pages/ProjectsList';
import ProjectDetail from './pages/ProjectDetail';
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

export default function App() {
  return (
    <Routes>
      {/* Ruta pública: firma de actas vía enlace con token, sin necesidad de cuenta */}
      <Route path="/sign/:token" element={<SignPage />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <ProjectsList />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <PrivateRoute>
            <ProjectDetail />
          </PrivateRoute>
        }
      />
      <Route
        path="/timeline"
        element={
          <PrivateRoute>
            <TimelinePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/tools"
        element={
          <PrivateRoute>
            <ToolsPage />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
