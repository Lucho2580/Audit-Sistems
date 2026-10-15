import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import laViandaBlanco from '../assets/lavianda-blanco.png';

// Logo oficial de Microsoft (cuatro cuadros) -- es la señal que la gente
// reconoce en un login corporativo, así que va en el botón aunque el resto
// de la pantalla use los colores de La Vianda.
function MicrosoftLogo() {
  return (
    <svg className="ms-logo" width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default function Login() {
  const { session, signInWithMicrosoft } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  // Si Microsoft/Supabase rechaza el inicio de sesión (p. ej. el trigger
  // "cuenta no autorizada" de pending_invites), vuelve acá con el error en
  // el hash o el query string en vez de completar la sesión -- sin esto,
  // la persona solo vería que "no pasó nada".
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash ? window.location.hash.slice(1) : window.location.search,
    );
    const desc = params.get('error_description') || params.get('error');
    if (desc) {
      const message = decodeURIComponent(desc.replace(/\+/g, ' '));
      // Supabase Auth no deja pasar el texto de la excepción del trigger
      // reject_unauthorized_signup: lo reemplaza por este genérico. En la
      // práctica la única causa es una cuenta sin rol en Entra ID ni invitación.
      setError(
        /database error saving new user/i.test(message)
          ? 'Esta cuenta no está autorizada en el Sistema de Auditoría. Pide a Dirección de Sistemas que te asigne un rol en Entra ID.'
          : message,
      );
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function handleMicrosoftLogin() {
    setError(null);
    setBusy(true);
    const result = await signInWithMicrosoft();
    if (result.error) {
      setError(result.error);
      setBusy(false);
    }
    // Si no hay error, el navegador ya está siendo redirigido a Microsoft --
    // no hace falta (ni conviene) limpiar busy, para que el botón se vea
    // deshabilitado mientras dura la redirección.
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <img className="login-logo" src={laViandaBlanco} alt="La Vianda" />
        <div className="login-brand-body">
          <h1 className="login-title">Sistema de<br />Auditoría</h1>
          <div className="login-divider" />
          <p className="login-tagline">
            Control de levantamientos técnicos, proveedores y entregables de desarrollo de
            software.
          </p>
        </div>
        <div className="login-footer-note">Dirección de Sistemas · Uso interno</div>
      </div>

      <div className="login-form-panel">
        <div className="login-card">
          <div className="login-card-body">
            <p className="eyebrow">Acceso restringido</p>
            <h2>Iniciar sesión</h2>
            <p className="login-lead">
              Entra con tu cuenta corporativa de Microsoft. No necesitas una contraseña aparte.
            </p>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="btn btn-sso" type="button" onClick={handleMicrosoftLogin} disabled={busy}>
              <MicrosoftLogo />
              <span>{busy ? 'Redirigiendo a Microsoft…' : 'Continuar con Microsoft'}</span>
            </button>
            <ol className="login-steps">
              <li>
                <span className="login-step-num">1</span>
                <span>Microsoft te pedirá elegir la cuenta: usa la de <strong>@lavianda.co</strong>.</span>
              </li>
              <li>
                <span className="login-step-num">2</span>
                <span>Al confirmar, vuelves directo al panel con tus proyectos.</span>
              </li>
            </ol>
          </div>
          <div className="login-card-foot">
            ¿No tienes acceso? Solicítalo a la Dirección de Sistemas.
          </div>
        </div>
      </div>
    </div>
  );
}
