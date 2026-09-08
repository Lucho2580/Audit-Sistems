import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { AuthApi } from '../lib/services';

// Se muestra en vez de cualquier ruta privada mientras profile.mustChangePassword
// sea true (cuentas creadas por un admin con contraseña temporal, vía la
// pantalla de administración de usuarios en /tools).
export default function ForceChangePassword() {
  const { signOut, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      await AuthApi.clearMustChangePassword();
      await refreshProfile();
    } catch (err) {
      setError((err as Error).message || 'No se pudo actualizar la contraseña.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="auth-shell">
        <h1>Cambia tu contraseña</h1>
        <p className="sub">
          Tu cuenta se creó con una contraseña temporal. Define una nueva antes de continuar.
        </p>
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
            {busy ? 'Un momento…' : 'Guardar y continuar'}
          </button>
        </form>
        <div className="auth-switch">
          <button type="button" onClick={signOut}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
