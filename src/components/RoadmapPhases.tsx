import { useEffect, useMemo, useState } from 'react';
import { PhasesApi } from '../lib/services';
import type { ProjectPhase } from '../types/domain';

interface Props {
  phases: ProjectPhase[];
  canEdit: boolean;
  onChanged: () => void;
}

const PHASE_COLORS = [
  'var(--blue)', 'var(--gold)', 'var(--rust)', 'var(--green)',
  'var(--slate)', 'var(--ink-soft)', 'var(--blue)', 'var(--gold)',
];
const LABEL_COL = 160;
const DAY_MS = 86400000;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtShort(t: number) {
  return new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

// Ticks semanales para rangos cortos; mensuales o trimestrales para proyectos
// largos, para no terminar con decenas de etiquetas ilegibles superpuestas.
function buildTicks(minTime: number, maxTime: number): { time: number; label: string }[] {
  const totalDays = (maxTime - minTime) / DAY_MS;
  const arr: { time: number; label: string }[] = [];

  if (totalDays <= 56) {
    const oneWeek = 7 * DAY_MS;
    for (let t = minTime; t < maxTime; t += oneWeek) arr.push({ time: t, label: fmtShort(t) });
  } else {
    const stepMonths = totalDays <= 240 ? 1 : 3;
    const cursor = new Date(minTime);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < minTime) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor.getTime() <= maxTime) {
      arr.push({
        time: cursor.getTime(),
        label: cursor.toLocaleDateString('es-ES', { month: 'short', year: totalDays > 400 ? '2-digit' : undefined }),
      });
      cursor.setMonth(cursor.getMonth() + stepMonths);
    }
  }
  if (!arr.length || arr[arr.length - 1].time !== maxTime) arr.push({ time: maxTime, label: fmtShort(maxTime) });
  return arr;
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
  // dibujar el Gantt a escala (una fila por fase).
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

  const ticks = useMemo(
    () => (minTime !== null && maxTime !== null ? buildTicks(minTime, maxTime) : []),
    [minTime, maxTime],
  );

  const todayPct = useMemo(() => {
    if (minTime === null || maxTime === null) return null;
    const now = Date.now();
    if (now < minTime || now > maxTime) return null;
    return ((now - minTime) / totalMs) * 100;
  }, [minTime, maxTime, totalMs]);

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
        <div className="gantt">
          <div className="gantt-head">
            <div className="gantt-head-spacer" style={{ width: LABEL_COL }} />
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
          </div>
          <div className="gantt-body">
            <div className="gantt-gridlines" style={{ left: LABEL_COL }}>
              {ticks.map((t) => (
                <div
                  key={t.time}
                  className="gantt-gridline"
                  style={{ left: `${((t.time - minTime!) / totalMs) * 100}%` }}
                />
              ))}
              {todayPct !== null && (
                <div className="gantt-today" style={{ left: `${todayPct}%` }}>
                  <span className="gantt-today-label">HOY</span>
                </div>
              )}
            </div>
            {phases.map((phase, idx) => {
              const range = ranges.find((r) => r.phase.id === phase.id);
              const leftPct = range ? ((range.start.getTime() - minTime!) / totalMs) * 100 : 0;
              const widthPct = range
                ? Math.min(Math.max(2, ((range.end.getTime() - range.start.getTime()) / totalMs) * 100), 100 - leftPct)
                : 0;
              const showLabelInside = widthPct >= 12;
              const rightSpacePct = 100 - (leftPct + widthPct);
              const labelOnLeft = !showLabelInside && rightSpacePct < 8;
              return (
                <div className="gantt-row" key={phase.id}>
                  <span className="gantt-row-label" title={phase.label}>{phase.label}</span>
                  <div className="gantt-row-track">
                    {range ? (
                      <>
                        <button
                          type="button"
                          className="gantt-bar"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            background: PHASE_COLORS[idx % PHASE_COLORS.length],
                          }}
                          title={`${phase.label}: ${range.start.toISOString().slice(0, 10)} → ${range.end.toISOString().slice(0, 10)}`}
                          aria-label={`${phase.label}: ${range.start.toISOString().slice(0, 10)} a ${range.end.toISOString().slice(0, 10)}, ${phase.durationDays} días`}
                        >
                          {showLabelInside ? phase.label : null}
                        </button>
                        {!showLabelInside && (
                          <span
                            className="gantt-bar-label-outside"
                            style={
                              labelOnLeft
                                ? { right: `calc(${100 - leftPct}% + 8px)`, textAlign: 'right' }
                                : { left: `calc(${leftPct + widthPct}% + 8px)` }
                            }
                          >
                            {phase.label}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="gantt-row-empty">Sin fecha de inicio</span>
                    )}
                  </div>
                </div>
              );
            })}
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
