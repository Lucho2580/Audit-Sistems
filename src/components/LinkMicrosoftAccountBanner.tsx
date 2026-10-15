import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

// Temporal -- solo existe durante la Etapa A de la migración a SSO de
// Microsoft (ver plan). Se borra por completo en la Etapa B, cuando ya nadie
// entra con contraseña y por lo tanto nadie necesita vincular nada.
//
// A diferencia de ForceChangePassword/WeeklyProgressGate, esto NO bloquea --
// es una migración de comodidad, no un requisito del negocio, así que
// "Recordar más tarde" simplemente lo oculta por esta sesión (vuelve a
// aparecer la próxima vez que entre con contraseña, porque justo esa es la
// señal de que todavía no se vinculó).
export default function LinkMicrosoftAccountBanner() {
  const { session, hasMicrosoftIdentity, linkMicrosoftAccount } = useAuth();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!session) return;
    hasMicrosoftIdentity().then((linked) => {
      if (active) setShow(!linked);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  if (!show || dismissed) return null;

  async function handleLink() {
    setError(null);
    setBusy(true);
    const result = await linkMicrosoftAccount();
    if (result.error) {
      setError(result.error);
      setBusy(false);
    }
    // Sin error: el navegador ya está siendo redirigido a Microsoft.
  }

  return (
    <div className="top-banner">
      <span>
        Vincula tu cuenta de Microsoft para entrar sin contraseña la próxima vez.
        {error && <strong style={{ marginLeft: 8 }}>{error}</strong>}
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleLink}
          disabled={busy}
          style={{
            background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 'var(--radius)',
            padding: '7px 14px', fontSize: 12.5, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {busy ? 'Redirigiendo…' : 'Vincular mi cuenta Microsoft'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          disabled={busy}
          style={{
            background: 'none', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--radius)',
            padding: '7px 14px', fontSize: 12.5, cursor: busy ? 'default' : 'pointer', color: 'var(--ink-soft)', fontFamily: 'inherit',
          }}
        >
          Recordar más tarde
        </button>
      </div>
    </div>
  );
}
