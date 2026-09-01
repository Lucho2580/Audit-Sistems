import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const result =
      mode === 'signin' ? await signIn(email, password) : await signUp(email, password, fullName);
    setBusy(false);
    if (result.error) {
      setError(result.error);
    } else if (mode === 'signup') {
      setInfo('Cuenta creada. Revisa tu correo para confirmar el registro y luego inicia sesión.');
      setMode('signin');
    }
  }

  return (
    <div className="wrap">
      <div className="appbar">
        <span>
          Sistema de auditoría <span className="dot">·</span> Desarrollo de software
        </span>
      </div>
      <div className="auth-shell">
        <h1>{mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
        <p className="sub">
          {mode === 'signin'
            ? 'Ingresa con tu correo y contraseña para acceder al panel de auditoría.'
            : 'Las cuentas nuevas se crean con rol "cliente"; un administrador puede darte más permisos luego.'}
        </p>
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="top-banner">{info}</div>}
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="auth-field">
              <label>Nombre completo</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="auth-field">
            <label>Correo</label>
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
            {busy ? 'Un momento…' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
        <div className="auth-switch">
          {mode === 'signin' ? (
            <>
              ¿No tienes cuenta?{' '}
              <button onClick={() => setMode('signup')} type="button">
                Regístrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{' '}
              <button onClick={() => setMode('signin')} type="button">
                Inicia sesión
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
