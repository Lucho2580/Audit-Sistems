import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import laViandaBlanco from '../assets/lavianda-blanco.png';

export default function Login() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <div className="auth-switch">¿Sin acceso? Solicítalo a la Dirección de Sistemas.</div>
        </div>
      </div>
    </div>
  );
}
