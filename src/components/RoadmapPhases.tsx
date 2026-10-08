import { useEffect, useMemo, useState } from 'react';
import { PhasesApi } from '../lib/services';
import { QA_STATUS_META, taskDelayStatus, type PhaseTask, type ProjectPhase } from '../types/domain';

interface Props {
  phases: ProjectPhase[];
  tasks: PhaseTask[];
  canEdit: boolean;
  minDate: string | null; // fecha de inicio del proyecto
  maxDate: string | null; // fecha de entrega esperada del proyecto
  onChanged: () => void;
}

const PHASE_COLORS = [
  'var(--blue)', 'var(--gold)', 'var(--rust)', 'var(--green)',
  'var(--slate)', 'var(--ink-soft)', 'var(--blue)', 'var(--gold)',
];
const TASK_STATUS_COLOR: Record<string, string> = {
  completado: 'var(--green)', en_tiempo: 'var(--blue)', en_riesgo: 'var(--gold)', atrasado: 'var(--rust)',
};
const LABEL_COL = 160;
const DAY_MS = 86400000;
const DAY_W = 22;
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtShort(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

// El Gantt general del proyecto (ítem 10): una fila por fase (arrastrable,
// como antes) seguida de una sub-fila por cada una de sus tareas (más
// angosta, coloreada por estado de atraso), con una línea conectora simple
// entre el fin de una fase y el inicio de la siguiente (dependencia
// secuencial -- no un editor de dependencias libres).
export default function RoadmapPhases({ phases, tasks, canEdit, minDate, maxDate, onChanged }: Props) {
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

  // Arrastra la barra completa (mover fecha de inicio) o solo su borde derecho
  // (cambiar duración). Se actualiza en vivo por pixel, a razón de un día por
  // cada DAY_W de desplazamiento, y se persiste al soltar — mismo endpoint
  // que usan los campos manuales de abajo.
  function dragPhase(phase: ProjectPhase, mode: 'move' | 'resize') {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const base = drafts[phase.id] ?? { startDate: phase.startDate ?? '', durationDays: phase.durationDays };
      if (!base.startDate) return;
      const x0 = e.clientX;
      let finalDraft = base;

      const move = (ev: PointerEvent) => {
        const delta = Math.round((ev.clientX - x0) / DAY_W);
        finalDraft =
          mode === 'move'
            ? { startDate: addDays(base.startDate, delta), durationDays: base.durationDays }
            : { startDate: base.startDate, durationDays: Math.max(1, Number(base.durationDays) + delta) };
        setDrafts((d) => ({ ...d, [phase.id]: finalDraft }));
      };
      const up = async () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (finalDraft === base) return;
        try {
          await PhasesApi.update(phase.id, {
            startDate: finalDraft.startDate || null,
            durationDays: Number(finalDraft.durationDays) || phase.durationDays,
          });
          onChanged();
        } catch (err) {
          alert(`No se pudo guardar la fase "${phase.label}": ${(err as Error).message}`);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
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

  const taskRanges = useMemo(
    () =>
      tasks
        .map((t) => {
          if (!t.startDate || !t.plannedEndDate) return null;
          return { task: t, start: new Date(t.startDate + 'T00:00:00'), end: new Date(t.plannedEndDate + 'T00:00:00') };
        })
        .filter((r): r is { task: PhaseTask; start: Date; end: Date } => r !== null),
    [tasks],
  );

  const allTimes = [
    ...ranges.flatMap((r) => [r.start.getTime(), r.end.getTime()]),
    ...taskRanges.flatMap((r) => [r.start.getTime(), r.end.getTime()]),
  ];
  const minTime = allTimes.length ? Math.min(...allTimes) : null;
  const maxTime = allTimes.length ? Math.max(...allTimes) : null;
  // Origen con 2 días de aire a la izquierda, igual que el mockup, para que la
  // primera barra no quede pegada al borde.
  const originTime = minTime !== null ? minTime - 2 * DAY_MS : null;
  const totalDays =
    originTime !== null && maxTime !== null
      ? Math.max(14, Math.round((maxTime - originTime) / DAY_MS) + 4)
      : 0;
  const trackW = totalDays * DAY_W;

  const ticks = useMemo(() => {
    if (originTime === null) return [];
    const arr: { time: number; label: string }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const t = originTime + i * DAY_MS;
      const d = new Date(t);
      const first = d.getDate() === 1 || i === 0;
      arr.push({ time: t, label: first ? `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}` : String(d.getDate()) });
    }
    return arr;
  }, [originTime, totalDays]);

  const todayLeftPx = useMemo(() => {
    if (originTime === null) return null;
    const now = Date.now();
    const endTime = originTime + totalDays * DAY_MS;
    if (now < originTime || now > endTime) return null;
    return Math.round((now - originTime) / DAY_MS) * DAY_W;
  }, [originTime, totalDays]);

  const hasAnyRange = ranges.length > 0 || taskRanges.length > 0;

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">Gantt</span>
          <h2>Diagrama de Gantt</h2>
        </div>
        {hasAnyRange && (
          <span className="gantt-hint">
            {canEdit ? 'Arrastra una barra de fase para moverla; arrastra su borde derecho para cambiar la duración.' : ''}
          </span>
        )}
      </div>

      {!hasAnyRange ? (
        <div className="empty-state">
          Configura al menos una fecha de inicio (de fase o de tarea) para ver el gráfico del roadmap.
        </div>
      ) : (
        <div className="gantt">
          <div className="gantt-head" style={{ width: LABEL_COL + trackW }}>
            <div className="gantt-head-spacer" style={{ width: LABEL_COL }} />
            <div className="gantt-ticks" style={{ width: trackW }}>
              {ticks.map((t) => (
                <span key={t.time} className="gantt-tick" style={{ left: (t.time - originTime!) / DAY_MS * DAY_W }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt-body" style={{ width: LABEL_COL + trackW }}>
            <div className="gantt-gridlines" style={{ left: LABEL_COL, width: trackW }}>
              {ticks.map((t) => (
                <div key={t.time} className="gantt-gridline" style={{ left: (t.time - originTime!) / DAY_MS * DAY_W }} />
              ))}
              {todayLeftPx !== null && (
                <div className="gantt-today" style={{ left: todayLeftPx }}>
                  <span className="gantt-today-label">HOY</span>
                </div>
              )}
            </div>
            {phases.map((phase, idx) => {
              const range = ranges.find((r) => r.phase.id === phase.id);
              const prevRange = idx > 0 ? ranges.find((r) => r.phase.id === phases[idx - 1].id) : undefined;
              const leftPx = range ? Math.round((range.start.getTime() - originTime!) / DAY_MS) * DAY_W : 0;
              const widthPx = range
                ? Math.max(DAY_W, Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS) * DAY_W)
                : 0;
              const showLabelInside = widthPx >= 90;
              const rightSpacePx = trackW - (leftPx + widthPx);
              const labelOnLeft = !showLabelInside && rightSpacePx < 90;
              const phaseTasks = tasks.filter((t) => t.phaseId === phase.id);
              const prevEndPx = prevRange ? Math.round((prevRange.end.getTime() - originTime!) / DAY_MS) * DAY_W : null;

              return (
                <div key={phase.id}>
                  <div className="gantt-row" style={{ width: LABEL_COL + trackW }}>
                    <span className="gantt-row-label" title={phase.label}>
                      {phase.label}
                      <span className={`qa-status-dot qa-${phase.qaStatus}`} title={QA_STATUS_META[phase.qaStatus]} />
                    </span>
                    <div className="gantt-row-track" style={{ width: trackW }}>
                      {range && prevEndPx !== null && (
                        <span className="gantt-dependency" style={{ left: prevEndPx, width: Math.max(0, leftPx - prevEndPx) }} />
                      )}
                      {range ? (
                        <>
                          <div
                            className={`gantt-bar${canEdit ? ' draggable' : ''}`}
                            onPointerDown={canEdit ? dragPhase(phase, 'move') : undefined}
                            style={{
                              left: leftPx,
                              width: widthPx,
                              background: PHASE_COLORS[idx % PHASE_COLORS.length],
                            }}
                            title={`${phase.label}: ${range.start.toISOString().slice(0, 10)} → ${range.end.toISOString().slice(0, 10)}`}
                            aria-label={`${phase.label}: ${range.start.toISOString().slice(0, 10)} a ${range.end.toISOString().slice(0, 10)}, ${phase.durationDays} días`}
                          >
                            {showLabelInside && <span className="gantt-bar-label">{phase.durationDays} d</span>}
                            {canEdit && (
                              <span
                                className="gantt-bar-resize"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  dragPhase(phase, 'resize')(e);
                                }}
                              />
                            )}
                          </div>
                          {!showLabelInside && (
                            <span
                              className="gantt-bar-label-outside"
                              style={
                                labelOnLeft
                                  ? { right: trackW - leftPx + 8, textAlign: 'right' }
                                  : { left: leftPx + widthPx + 8 }
                              }
                            >
                              {phase.durationDays} d
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="gantt-row-empty">Sin fecha de inicio</span>
                      )}
                    </div>
                  </div>
                  {phaseTasks.map((task) => {
                    const tRange = taskRanges.find((r) => r.task.id === task.id);
                    const tLeftPx = tRange ? Math.round((tRange.start.getTime() - originTime!) / DAY_MS) * DAY_W : 0;
                    const tWidthPx = tRange
                      ? Math.max(DAY_W, Math.round((tRange.end.getTime() - tRange.start.getTime()) / DAY_MS) * DAY_W)
                      : 0;
                    const status = taskDelayStatus(task);
                    return (
                      <div className="gantt-row gantt-row-task" key={task.id} style={{ width: LABEL_COL + trackW }}>
                        <span className="gantt-row-label" title={task.text}>{task.text}</span>
                        <div className="gantt-row-track" style={{ width: trackW }}>
                          {tRange ? (
                            <div
                              className="gantt-bar gantt-bar-task"
                              style={{ left: tLeftPx, width: tWidthPx, background: TASK_STATUS_COLOR[status] }}
                              title={`${task.text}: ${task.percent}% (${status})`}
                            />
                          ) : (
                            <span className="gantt-row-empty">Sin fechas</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                    min={minDate ?? undefined}
                    max={maxDate ?? undefined}
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
                <span className="roadmap-end">
                  {end ? `Fin estimado: ${fmtShort(end)}` : 'Sin fecha de inicio'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
