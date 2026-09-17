import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { WeeklyProgressApi } from '../lib/services';
import type { WeeklyProgressOverviewRow } from '../types/domain';

const PERCENT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// Se monta UNA vez alrededor de todas las rutas (no dentro de cada
// PrivateRoute), para que el chequeo no se repita en cada navegación --  solo
// al cargar la sesión y justo después de enviar un reporte.
//
// Bloqueo real: mientras haya al menos un proyecto con el reporte de esta
// semana pendiente Y el plazo todavía abierto, no se renderiza nada más --
// sin botón de cerrar, sin clic-afuera-para-cerrar. Si el plazo YA CERRÓ
// (sábado 12:01pm a domingo), no hay nada que la persona pueda hacer hasta el
// lunes, así que en ese caso NO se bloquea -- bloquear ahí la dejaría sin
// poder usar la app durante ese hueco muerto.
export default function WeeklyProgressGate({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState<WeeklyProgressOverviewRow[]>([]);
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Esta puerta va ANTES que las rutas, pero el cambio de contraseña
    // obligatorio (ForceChangePassword, dentro de PrivateRoute) va DESPUÉS --
    // si esta puerta bloqueara aquí, una cuenta recién creada (que siempre
    // arranca con must_change_password=true) y con un reporte pendiente
    // quedaría atrapada para siempre sin poder llegar nunca a cambiar su
    // contraseña temporal. Se deja pasar sin chequear nada hasta que ya haya
    // cambiado la contraseña.
    if (!session || profile?.role !== 'desarrollador' || profile?.mustChangePassword) {
      setChecked(true);
      setPending([]);
      return;
    }
    try {
      const rows = await WeeklyProgressApi.listOverview();
      const now = Date.now();
      const pend = rows.filter(
        (r) => r.status !== 'cerrado' && !r.currentWeekSubmitted && now <= new Date(r.currentWeekDeadline).getTime(),
      );
      setPending(pend);
      setPercent(0);
      setNote('');
    } finally {
      setChecked(true);
    }
  }, [session, profile?.role, profile?.mustChangePassword]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!checked) return null;

  const current = pending[0] ?? null;
  if (!current) return <>{children}</>;

  async function submit() {
    if (!note.trim()) {
      setError('Describe qué se avanzó esta semana (o escribe que no hubo avance).');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await WeeklyProgressApi.submit(current!.projectId, percent, note.trim());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Reporte semanal pendiente</div>
            <h2 className="modal-title">{current.name}</h2>
          </div>
          {/* Sin botón de cerrar a propósito: no se puede omitir. */}
        </div>
        <div className="modal-body">
          <p className="modal-intro">
            Antes de continuar, reporta el avance de esta semana para <b>{current.code}</b>. Tienes hasta
            el sábado 12:00 pm (hora Colombia).
            {pending.length > 1 && ` Después de este te van a faltar ${pending.length - 1} proyecto(s) más.`}
          </p>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-fields">
            <div className="modal-field">
              <label>¿Cuánto avanzaste esta semana?</label>
              <select value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
                {PERCENT_STEPS.map((v) => (
                  <option key={v} value={v}>{v === 0 ? '0% — no avancé nada' : `${v}%`}</option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>¿Qué se hizo esta semana?</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Describe el avance (o por qué no hubo avance)…"
              />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="modal-foot-hint">Este reporte es obligatorio para seguir usando el sistema.</span>
          <div className="modal-foot-actions">
            <button className="btn" onClick={submit} disabled={saving}>
              {saving ? 'Guardando…' : 'Enviar reporte semanal'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
