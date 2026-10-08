import { PhasesApi } from '../lib/services';
import type { ProjectPhase } from '../types/domain';

interface Props {
  phases: ProjectPhase[];
  canEdit: boolean; // jefe/admin o qa: puede mover el % de cada fase
  onChanged: () => void;
}

const PERCENT_OPTIONS = [0, 10, 25, 40, 50, 60, 75, 90, 100];

// % de avance de cada fase (ítem 3): ya no se calcula solo de sus tareas
// (que no se pueden tocar desde que se quitó "Fases y tareas") -- cada fase
// tiene su propio % editable, y es lo que ahora alimenta el "avance real"
// general del proyecto (ver phaseProgressPct en normalizeProject).
export default function PhaseProgressChart({ phases, canEdit, onChanged }: Props) {
  const rows = phases.slice().sort((a, b) => a.orderIndex - b.orderIndex);

  async function setPercent(phase: ProjectPhase, percent: number) {
    await PhasesApi.setPercent(phase.id, percent);
    onChanged();
  }

  return (
    <div className="dash-card">
      <div className="dash-card-title">% de avance por fase</div>
      {rows.length === 0 ? (
        <div className="empty-state">Sin fases configuradas todavía.</div>
      ) : (
        <div className="bar-chart">
          {rows.map((phase) => (
            <div className={`bar-row${canEdit ? ' editable' : ''}`} key={phase.id}>
              <span className="bar-label" title={phase.label}>{phase.label}</span>
              <span className="bar-track2">
                <span className="bar-fill2" style={{ width: `${phase.percent}%` }} />
              </span>
              {canEdit ? (
                <select
                  className="phase-percent-select"
                  value={phase.percent}
                  onChange={(e) => setPercent(phase, Number(e.target.value))}
                >
                  {PERCENT_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </select>
              ) : (
                <span className="bar-value">{phase.percent}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
