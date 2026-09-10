import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Página a la que llega el enlace de recuperación que manda Supabase por
// correo (resetPasswordForEmail). El cliente de Supabase detecta el token de
// la URL solo y deja una sesión temporal de recuperación; aquí solo se pide
// la contraseña nueva y se aplica con updateUser().
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    // Si el enlace ya se procesó antes de montar este listener (o no había
    // token válido), esto evita quedarse esperando para siempre.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setLinkError('El enlace de recuperación no es válido o ya expiró.');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError((err as Error).message || 'No se pudo actualizar la contraseña.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="auth-shell">
        <h1>Restablecer contraseña</h1>
        <p className="sub">Define una contraseña nueva para tu cuenta.</p>
        {done ? (
          <div className="sign-success">
            <div className="check">✓</div>
            <p>Tu contraseña se actualizó correctamente. Entrando al panel…</p>
          </div>
        ) : linkError ? (
          <div className="auth-error">{linkError}</div>
        ) : !ready ? (
          <p className="sub">Verificando enlace…</p>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label>Nueva contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  autoFocus
                />
              </div>
              <div className="auth-field">
                <label>Confirmar contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Un momento…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          </>
        )}
        <div className="auth-switch">
          <button type="button" onClick={() => navigate('/login')}>Volver a iniciar sesión</button>
        </div>
      </div>
    </div>
  );
}
