import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ProjectsList from './pages/ProjectsList';
import ProjectDetail from './pages/ProjectDetail';
import ProjectWeeklyProgress from './pages/ProjectWeeklyProgress';
import ClientPortal from './pages/ClientPortal';
import SignPage from './pages/SignPage';
import TimelinePage from './pages/TimelinePage';
import ToolsPage from './pages/ToolsPage';
import WeeklyProgressDashboard from './pages/WeeklyProgressDashboard';
import ForceChangePassword from './pages/ForceChangePassword';
import WeeklyProgressGate from './components/WeeklyProgressGate';
import LinkMicrosoftAccountBanner from './components/LinkMicrosoftAccountBanner';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, signOut } = useAuth();
  if (loading) return <div className="wrap">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.mustChangePassword) return <ForceChangePassword />;
  // Hay sesión pero ninguna fila en profiles -- cuenta de Microsoft sin
  // invitación que de algún modo llegó a tener sesión (o perfil borrado
  // aparte). Antes esto dejaba pasar silenciosamente con profile=null, y
  // varias pantallas asumen profile.role sin chequear null.
  if (profile === null) {
    return (
      <div className="wrap">
        <div className="empty-state">
          <p>Tu cuenta no está autorizada en el Sistema de Auditoría.</p>
          <p>Pide que Dirección de Sistemas te invite primero.</p>
          <button className="btn ghost small" onClick={() => signOut()}>Cerrar sesión</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <LinkMicrosoftAccountBanner />
      {children}
    </>
  );
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
    // Envuelve TODAS las rutas una sola vez -- así el chequeo del reporte
    // semanal pendiente no se repite en cada navegación (PrivateRoute sí se
    // remonta por cada <Route>, este wrapper no).
    <WeeklyProgressGate>
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
        path="/projects/:id/informe-semanal"
        element={
          <PrivateRoute>
            <StaffOnlyRoute>
              <ProjectWeeklyProgress />
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
      <Route
        path="/informe-semanal"
        element={
          <PrivateRoute>
            <StaffOnlyRoute>
              <WeeklyProgressDashboard />
            </StaffOnlyRoute>
          </PrivateRoute>
        }
      />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </WeeklyProgressGate>
  );
}
