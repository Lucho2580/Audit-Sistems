import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import laViandaBlanco from '../assets/lavianda-blanco.png';

export default function Login() {
  const { session, signIn, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  function openForgot() {
    setMode('forgot');
    setForgotEmail(email);
    setForgotError(null);
    setForgotSent(false);
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotBusy(true);
    const result = await requestPasswordReset(forgotEmail.trim());
    setForgotBusy(false);
    if (result.error) setForgotError(result.error);
    else setForgotSent(true);
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
        {mode === 'login' ? (
          <div className="login-form">
            <p className="eyebrow">Acceso restringido</p>
            <h2>Iniciar sesión</h2>
            <div className="login-form-rule" />
            <p className="sub">Ingresa con tu correo y contraseña para acceder al panel de auditoría.</p>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label>Correo corporativo</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="auth-field">
                <label>Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Un momento…' : 'Entrar al panel'}
              </button>
            </form>
            <div className="auth-switch">
              <button type="button" onClick={openForgot}>¿Olvidaste tu contraseña?</button>
            </div>
            <div className="auth-switch">¿Sin acceso? Solicítalo a la Dirección de Sistemas.</div>
          </div>
        ) : (
          <div className="login-form">
            <p className="eyebrow">Recuperar acceso</p>
            <h2>Restablecer contraseña</h2>
            <div className="login-form-rule" />
            {forgotSent ? (
              <>
                <p className="sub">
                  Si <strong>{forgotEmail.trim()}</strong> tiene una cuenta, te llegará un correo con un
                  enlace para definir una contraseña nueva.
                </p>
                <div className="auth-switch">
                  <button type="button" onClick={() => setMode('login')}>Volver a iniciar sesión</button>
                </div>
              </>
            ) : (
              <>
                <p className="sub">
                  Ingresa tu correo corporativo y te mandaremos un enlace para definir una contraseña
                  nueva.
                </p>
                {forgotError && <div className="auth-error">{forgotError}</div>}
                <form onSubmit={handleForgotSubmit}>
                  <div className="auth-field">
                    <label>Correo corporativo</label>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <button className="btn" type="submit" disabled={forgotBusy} style={{ width: '100%' }}>
                    {forgotBusy ? 'Enviando…' : 'Enviar enlace de recuperación'}
                  </button>
                </form>
                <div className="auth-switch">
                  <button type="button" onClick={() => setMode('login')}>Volver a iniciar sesión</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
