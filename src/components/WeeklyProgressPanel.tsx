import { useEffect, useState } from 'react';
import { WeeklyProgressApi } from '../lib/services';
import { currentWeekWindow, type WeeklyProgressEntry } from '../types/domain';
import { useAuth } from '../context/AuthContext';

interface Props {
  projectId: string;
  canFill: boolean;
  isComplete: boolean;
}

const PERCENT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function WeeklyProgressPanel({ projectId, canFill, isComplete }: Props) {
  const { profile } = useAuth();
  // Una vez enviado, la persona asignada YA NO puede editarlo (el reporte
  // semanal queda fijo) -- el modal bloqueante es su única forma de llenarlo,
  // y no se puede reabrir después de mandarlo. Solo admin/superadmin
  // conservan la opción de corregirlo si hace falta.
  const canEditOwnEntry = profile?.role !== 'desarrollador';
  const [entries, setEntries] = useState<WeeklyProgressEntry[]>([]);
  const [indicator, setIndicator] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El llenado inicial lo fuerza el modal bloqueante (WeeklyProgressGate) --
  // aquí solo se muestra el formulario abierto de entrada si todavía NO hay
  // nada reportado esta semana (caso: un admin llenándolo en nombre de
  // alguien, ya que a él el modal no lo bloquea). Si ya hay algo reportado,
  // queda colapsado detrás de un botón "Editar" para no duplicar el modal.
  const [editing, setEditing] = useState(false);

  const week = currentWeekWindow();

  async function load() {
    setLoading(true);
    try {
      const [list, ind] = await Promise.all([
        WeeklyProgressApi.listForProject(projectId),
        WeeklyProgressApi.getIndicator(projectId),
      ]);
      setEntries(list);
      setIndicator(ind);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Limpia el borrador al cambiar de proyecto -- ProjectDetail reusa el
    // mismo componente montado al navegar entre :id (React Router no lo
    // desmonta), así que sin esto un borrador sin guardar de un proyecto
    // podía quedar pegado y enviarse por error al proyecto equivocado si el
    // nuevo tampoco tenía nada reportado esta semana (el otro efecto, atado a
    // thisWeekEntry?.id, no dispara en ese caso porque ambos son undefined).
    setPercent(0);
    setNote('');
    setEditing(false);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const thisWeekEntry = entries.find((e) => e.weekStart === week.weekStart) ?? null;

  useEffect(() => {
    if (thisWeekEntry) {
      setPercent(thisWeekEntry.percentAvanzado);
      setNote(thisWeekEntry.note);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeekEntry?.id]);

  async function submit() {
    if (!note.trim()) {
      setError('Describe qué se avanzó esta semana (o escribe que no hubo avance).');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await WeeklyProgressApi.submit(projectId, percent, note.trim());
      await load();
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">SEM</span>
          <h2>Informe semanal de avance</h2>
        </div>
        {indicator !== null && (
          <span className={`weekly-indicator tone-${indicatorTone(indicator)}`} title="Indicador de cumplimiento de reportes semanales">
            {indicator}%
          </span>
        )}
      </div>

      {isComplete ? (
        <div className="empty-state">
          El proyecto ya está al 100% o entregado — no se piden más reportes semanales.
        </div>
      ) : (
        <>
          {canFill && (
            <div className="weekly-fill">
              {thisWeekEntry && !editing ? (
                <div className="weekly-fill-summary">
                  <span>
                    Ya reportaste esta semana ({fmtDate(week.weekStart)}):{' '}
                    <span className={`percent-select ${thisWeekEntry.percentAvanzado === 0 ? 'pendiente' : thisWeekEntry.percentAvanzado === 100 ? 'completo' : 'progreso'}`}>
                      {thisWeekEntry.percentAvanzado}%
                    </span>
                  </span>
                  {week.isOpen && canEditOwnEntry && (
                    <button className="btn ghost small" onClick={() => setEditing(true)}>
                      Editar
                    </button>
                  )}
                </div>
              ) : week.isOpen ? (
                <>
                  <p className="admin-hint" style={{ padding: 0, margin: '0 0 10px' }}>
                    Semana del {fmtDate(week.weekStart)} — tienes hasta el sábado 12:00 pm (hora Colombia) para reportar.
                  </p>
                  {error && <div className="auth-error">{error}</div>}
                  <div className="weekly-fill-row">
                    <label>¿Cuánto avanzaste esta semana?</label>
                    <select value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
                      {PERCENT_STEPS.map((v) => (
                        <option key={v} value={v}>{v === 0 ? '0% — no avancé nada' : `${v}%`}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Describe qué se hizo esta semana (o por qué no hubo avance)…"
                  />
                  <div className="weekly-fill-actions">
                    <button className="btn small" onClick={submit} disabled={saving}>
                      {saving ? 'Guardando…' : thisWeekEntry ? 'Actualizar reporte' : 'Enviar reporte semanal'}
                    </button>
                    {thisWeekEntry && (
                      <button className="btn ghost small" onClick={() => setEditing(false)} disabled={saving}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="admin-hint" style={{ padding: 0, margin: 0 }}>
                  Ya cerró el plazo de esta semana (sábado 12:00 pm hora Colombia). Podrás reportar de nuevo el lunes.
                </p>
              )}
            </div>
          )}

          <div className="weekly-history">
            <p className="daily-notes-title">Historial de reportes</p>
            {loading ? (
              <div className="empty-state">Cargando…</div>
            ) : entries.length === 0 ? (
              <div className="empty-state">Todavía no hay reportes semanales.</div>
            ) : (
              <ul className="items">
                {entries.map((e) => (
                  <li className="item-block" key={e.id}>
                    <div className="item">
                      <span className="item-code">{fmtDate(e.weekStart)}</span>
                      <span className="item-text">
                        {e.note}
                        <span className="admin-hint" style={{ padding: 0, display: 'block' }}>
                          Enviado el {fmtDateTime(e.submittedAt)}
                        </span>
                      </span>
                      <span className={`percent-select ${e.percentAvanzado === 0 ? 'pendiente' : e.percentAvanzado === 100 ? 'completo' : 'progreso'}`}>
                        {e.percentAvanzado}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
