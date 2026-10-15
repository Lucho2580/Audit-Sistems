import { useEffect, useState } from 'react';
import { WeeklyProgressApi } from '../lib/services';
import { useAuth } from '../context/AuthContext';
import WeeklyReportForm from './WeeklyReportForm';
import WeeklyProgressDetail from './WeeklyProgressDetail';

interface Props {
  projectId: string;
  canFill: boolean;
  isComplete: boolean;
}

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

// Página "Informes semanales" de un proyecto: el reporte por hitos de la
// semana en curso (para quien puede llenarlo) y el historial semana a semana.
export default function WeeklyProgressPanel({ projectId, canFill, isComplete }: Props) {
  const { profile } = useAuth();
  // Una vez enviado, la persona asignada YA NO puede corregirlo (el modal
  // bloqueante es su forma de llenarlo); admin/superadmin sí.
  const canEditOwnEntry = profile?.role !== 'desarrollador';
  const [indicator, setIndicator] = useState<number | null>(null);
  // Cambia al enviar, para que el historial se recargue con el reporte nuevo.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    WeeklyProgressApi.getIndicator(projectId).then(setIndicator).catch(() => setIndicator(null));
  }, [projectId, version]);

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
          El proyecto ya está cerrado — no se piden más reportes semanales.
        </div>
      ) : (
        canFill && (
          <WeeklyReportForm
            projectId={projectId}
            variant="page"
            allowEditAfterSubmit={canEditOwnEntry}
            onSubmitted={() => setVersion((v) => v + 1)}
          />
        )
      )}

      <div className="weekly-history">
        <p className="daily-notes-title">Historial semana a semana</p>
        <WeeklyProgressDetail key={version} projectId={projectId} />
      </div>
    </div>
  );
}
