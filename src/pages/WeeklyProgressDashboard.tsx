import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import PersonChip from '../components/PersonChip';
import WeeklyProgressDetail from '../components/WeeklyProgressDetail';
import { WeeklyProgressApi } from '../lib/services';
import { STATUS_META, type WeeklyProgressOverviewRow } from '../types/domain';
import { useAuth } from '../context/AuthContext';

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

type WeekState = 'cerrado' | 'reportado' | 'pendiente' | 'vencido';

// Estado de la semana en curso. "Vencido" = ya pasó el plazo (sábado 12:00 pm,
// el mismo que usa WeeklyProgressGate) y no hubo reporte.
function weekState(r: WeeklyProgressOverviewRow, now: number): WeekState {
  if (r.status === 'cerrado') return 'cerrado';
  if (r.currentWeekSubmitted) return 'reportado';
  return now > new Date(r.currentWeekDeadline).getTime() ? 'vencido' : 'pendiente';
}

const WEEK_META: Record<WeekState, { label: string; tone: string }> = {
  cerrado: { label: 'Proyecto cerrado', tone: 'slate' },
  reportado: { label: 'Reportado', tone: 'green' },
  pendiente: { label: 'Pendiente · vence sáb 12:00', tone: 'gold' },
  vencido: { label: 'Sin reportar', tone: 'rust' },
};

function WeekBadge({ state }: { state: WeekState }) {
  const meta = WEEK_META[state];
  return (
    <span className={`pcard-badge tone-${meta.tone}`}>
      {state === 'reportado' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : state === 'pendiente' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      ) : state === 'vencido' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      )}
      {meta.label}
    </span>
  );
}

export default function WeeklyProgressDashboard() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<WeeklyProgressOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setRows(await WeeklyProgressApi.listOverview());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (profile && profile.role !== 'admin' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }

  const now = Date.now();

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Jefe de proyecto · Superadmin</p>
          <h1>Informe semanal de avance</h1>
          <p className="sub">
            Cumplimiento de reportes semanales por proyecto. El indicador baja cuando la persona
            asignada no reporta antes del plazo (sábado 12:00 pm); se congela cuando el proyecto
            se marca "Cerrado". Abre el detalle de un proyecto para verlo semana a semana.
          </p>
        </div>
      </div>

      <div className="pcard-list">
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No hay proyectos visibles.</div>
        ) : (
          rows.map((r) => {
            const isOpen = r.projectId === selected;
            const tone = indicatorTone(r.indicator);
            const toggle = () => setSelected(isOpen ? null : r.projectId);
            return (
              <article className="pcard" key={r.projectId} onClick={toggle}>
                <div className="pcard-body weekly-card-body">
                  <div className="pcard-main">
                    <div className="pcard-tags">
                      <span className="pcard-code">{r.code}</span>
                      <span className={`pcard-status static ${r.status}`}>
                        <span className="pcard-status-dot" aria-hidden="true" />
                        <span className="pcard-status-label">{STATUS_META[r.status]}</span>
                      </span>
                    </div>
                    <h2 className="pcard-title">
                      <Link to={`/projects/${r.projectId}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                    </h2>
                    <div className="pcard-people">
                      <PersonChip role="Responsable del reporte" name={r.responsableNombre} />
                    </div>
                  </div>

                  <div className="pcard-progress" onClick={(e) => e.stopPropagation()}>
                    <div className="pcard-progress-head">
                      <span className="pcard-eyebrow">Cumplimiento de reportes</span>
                      <WeekBadge state={weekState(r, now)} />
                    </div>
                    <div className="pcard-progress-figures">
                      <span className="pcard-pct">{r.indicator}%</span>
                      <span className="pcard-pct-caption">de semanas reportadas a tiempo</span>
                    </div>
                    <div className="pcard-bar" aria-hidden="true">
                      <span className="pcard-bar-track" />
                      <span className={`pcard-bar-fill weekly-fill tone-${tone}`} style={{ width: `${Math.min(100, r.indicator)}%` }} />
                    </div>
                    <button
                      type="button"
                      className="pcard-toggle"
                      aria-expanded={isOpen}
                      onClick={toggle}
                    >
                      {isOpen ? 'Ocultar detalle semana a semana' : 'Ver detalle semana a semana'}
                      <svg className={`pcard-chevron${isOpen ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="pcard-breakdown" onClick={(e) => e.stopPropagation()}>
                    <div className="weekly-card-detail-head">
                      <span className="pcard-eyebrow">Detalle semana a semana</span>
                      <Link className="pcard-btn" to={`/projects/${r.projectId}`}>
                        Ver proyecto
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                      </Link>
                    </div>
                    <WeeklyProgressDetail projectId={r.projectId} />
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
