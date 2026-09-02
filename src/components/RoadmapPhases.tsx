import { useEffect, useMemo, useState } from 'react';
import { PhasesApi } from '../lib/services';
import type { ProjectPhase } from '../types/domain';

interface Props {
  phases: ProjectPhase[];
  canEdit: boolean;
  onChanged: () => void;
}

const PHASE_COLORS = ['var(--gold)', 'var(--blue)', 'var(--rust)', 'var(--green)', 'var(--slate)', 'var(--ink)'];
const ROW_HEIGHT = 34;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function RoadmapPhases({ phases, canEdit, onChanged }: Props) {
  const [drafts, setDrafts] = useState<Record<string, { startDate: string; durationDays: number }>>({});

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        phases.map((p) => [p.id, { startDate: p.startDate ?? '', durationDays: p.durationDays }]),
      ),
    );
  }, [phases]);

  async function save(phase: ProjectPhase) {
    const draft = drafts[phase.id];
    if (!draft) return;
    try {
      await PhasesApi.update(phase.id, {
        startDate: draft.startDate || null,
        durationDays: Number(draft.durationDays) || phase.durationDays,
      });
      onChanged();
    } catch (err) {
      alert(`No se pudo guardar la fase "${phase.label}": ${(err as Error).message}`);
    }
  }

  // Rango de fechas de las fases que ya tienen inicio configurado, para
  // dibujar un único gráfico Gantt a escala.
  const ranges = useMemo(
    () =>
      phases
        .map((p) => {
          const d = drafts[p.id] ?? { startDate: p.startDate ?? '', durationDays: p.durationDays };
          if (!d.startDate) return null;
          const start = new Date(d.startDate + 'T00:00:00');
          const end = new Date(addDays(d.startDate, Number(d.durationDays) || 0) + 'T00:00:00');
          return { phase: p, start, end };
        })
        .filter((r): r is { phase: ProjectPhase; start: Date; end: Date } => r !== null),
    [phases, drafts],
  );

  const minTime = ranges.length ? Math.min(...ranges.map((r) => r.start.getTime())) : null;
  const maxTime = ranges.length ? Math.max(...ranges.map((r) => r.end.getTime())) : null;
  const totalMs = minTime !== null && maxTime !== null ? Math.max(1, maxTime - minTime) : 1;

  // Marcas de fecha (una por semana) que atraviesan todo el gráfico como
  // líneas de cuadrícula compartidas por todas las filas.
  const ticks = useMemo(() => {
    if (minTime === null || maxTime === null) return [];
    const oneWeek = 7 * 86400000;
    const arr: { time: number; label: string }[] = [];
    for (let t = minTime; t < maxTime; t += oneWeek) {
      arr.push({ time: t, label: new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) });
    }
    arr.push({ time: maxTime, label: new Date(maxTime).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) });
    return arr;
  }, [minTime, maxTime]);

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">ROAD</span>
          <h2>Roadmap del proyecto</h2>
        </div>
      </div>

      {ranges.length === 0 ? (
        <div className="empty-state">
          Configura al menos una fecha de inicio para ver el gráfico del roadmap.
        </div>
      ) : (
        <div className="gantt-chart gantt-chart-single">
          <div className="gantt-plot-wrap">
            <div className="gantt-ticks">
              {ticks.map((t) => (
                <span
                  key={t.time}
                  className="gantt-tick"
                  style={{ left: `${((t.time - minTime!) / totalMs) * 100}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
            <div className="gantt-plot" style={{ height: ROW_HEIGHT }}>
              {ticks.map((t) => (
                <div
                  key={t.time}
                  className="gantt-gridline"
                  style={{ left: `${((t.time - minTime!) / totalMs) * 100}%` }}
                />
              ))}
              {phases.map((phase, idx) => {
                const range = ranges.find((r) => r.phase.id === phase.id);
                if (!range) return null;
                return (
                  <div
                    key={phase.id}
                    className="gantt-bar"
                    style={{
                      left: `${((range.start.getTime() - minTime!) / totalMs) * 100}%`,
                      width: `${Math.max(2, ((range.end.getTime() - range.start.getTime()) / totalMs) * 100)}%`,
                      background: PHASE_COLORS[idx % PHASE_COLORS.length],
                    }}
                    title={`${phase.label}: ${range.start.toISOString().slice(0, 10)} → ${range.end.toISOString().slice(0, 10)}`}
                  />
                );
              })}
            </div>
          </div>
          <div className="gantt-legend">
            {phases.map((phase, idx) => (
              <span className="gantt-legend-item" key={phase.id}>
                <span
                  className="gantt-legend-swatch"
                  style={{ background: PHASE_COLORS[idx % PHASE_COLORS.length] }}
                />
                {phase.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {phases.length === 0 ? (
        <div className="empty-state">Sin fases configuradas todavía.</div>
      ) : (
        <div className="roadmap-list">
          {phases.map((phase) => {
            const draft = drafts[phase.id] ?? { startDate: phase.startDate ?? '', durationDays: phase.durationDays };
            const end = draft.startDate ? addDays(draft.startDate, Number(draft.durationDays) || 0) : null;
            return (
              <div className="roadmap-row" key={phase.id}>
                <span className="roadmap-label">{phase.label}</span>
                <span className="field">
                  <label>Inicio</label>
                  <input
                    type="date"
                    value={draft.startDate}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [phase.id]: { ...draft, startDate: e.target.value } }))
                    }
                    onBlur={() => save(phase)}
                  />
                </span>
                <span className="field">
                  <label>Duración (días)</label>
                  <input
                    type="number"
                    min={1}
                    value={draft.durationDays}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [phase.id]: { ...draft, durationDays: Number(e.target.value) } }))
                    }
                    onBlur={() => save(phase)}
                  />
                </span>
                <span className="roadmap-end">{end ? `Fin estimado: ${end}` : 'Sin fecha de inicio'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
