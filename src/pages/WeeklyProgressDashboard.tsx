import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import WeeklyProgressDetail from '../components/WeeklyProgressDetail';
import { WeeklyProgressApi } from '../lib/services';
import { STATUS_META, type WeeklyProgressOverviewRow } from '../types/domain';
import { useAuth } from '../context/AuthContext';

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

export default function WeeklyProgressDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
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

  const selectedRow = rows.find((r) => r.projectId === selected) ?? null;

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Jefe de proyecto · Superadmin</p>
          <h1>Informe semanal de avance</h1>
          <p className="sub">
            Cumplimiento de reportes semanales por proyecto. El indicador baja cuando la persona
            asignada no reporta antes del plazo (sábado 12:00 pm); se congela cuando el proyecto
            se marca "Cerrado". Haz clic en un proyecto para ver el detalle semana a semana.
          </p>
        </div>
      </div>

      <div className="proj-table">
        <div className="weekly-overview-row head">
          <span>Código</span>
          <span>Proyecto</span>
          <span>Responsable</span>
          <span>Indicador</span>
          <span>Semana en curso</span>
        </div>
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No hay proyectos visibles.</div>
        ) : (
          rows.map((r) => {
            const isComplete = r.status === 'cerrado';
            const isSelected = r.projectId === selected;
            return (
              <div
                className={`weekly-overview-row${isSelected ? ' selected' : ''}`}
                key={r.projectId}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(isSelected ? null : r.projectId)}
              >
                <span className="proj-code">{r.code}</span>
                <span className="proj-name">{r.name}</span>
                <span className="proj-owner">{r.responsableNombre ?? '—'}</span>
                <span className={`weekly-indicator tone-${indicatorTone(r.indicator)}`}>{r.indicator}%</span>
                <span>
                  {isComplete ? (
                    <span className="weekly-week-status tone-green">{STATUS_META[r.status]}</span>
                  ) : r.currentWeekSubmitted ? (
                    <span className="weekly-week-status tone-green">Reportado</span>
                  ) : (
                    <span className="weekly-week-status tone-gold">Pendiente</span>
                  )}
                </span>
              </div>
            );
          })
        )}

        {selectedRow && (
          <>
            <div className="weekly-detail-head">
              <span>
                Detalle de <b>{selectedRow.code} · {selectedRow.name}</b>
              </span>
              <button className="btn ghost small" onClick={() => navigate(`/projects/${selectedRow.projectId}`)}>
                Ver proyecto →
              </button>
            </div>
            <WeeklyProgressDetail projectId={selectedRow.projectId} />
          </>
        )}
      </div>
    </AppShell>
  );
}
