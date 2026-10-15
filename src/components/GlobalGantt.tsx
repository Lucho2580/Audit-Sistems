import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DELAY_STATUS_META, taskDelayStatus, type DelayStatus, type Project } from '../types/domain';

interface Props {
  projects: Project[];
}

const STATUS_COLOR: Record<DelayStatus, string> = {
  completado: 'var(--green)', en_tiempo: 'var(--blue)', atrasado: 'var(--rust)',
};
const LABEL_COL = 260;
const DAY_MS = 86400000;
// Con 65 proyectos los rangos pueden cubrir 2+ años -- una escala más
// angosta que el Gantt de un solo proyecto para que se alcance a ver la
// mayoría sin desplazar tanto horizontalmente.
const DAY_W = 3;
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Gantt de portafolio (ítem "diagrama de Gantt general de todos los
// proyectos"): una fila por proyecto, barra desde su fecha de inicio hasta
// su fecha de entrega esperada, coloreada por el mismo cálculo de atraso que
// ya se usa en el detalle de cada proyecto y en el listado global -- aquí
// solo de solo lectura (sin arrastrar), clic en una fila navega al detalle.
export default function GlobalGantt({ projects }: Props) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const ranges = useMemo(
    () =>
      projects
        .map((p) => {
          const startDate = p.startDate ?? p.createdAt.slice(0, 10);
          if (!startDate || !p.deadlineDate) return null;
          const start = new Date(startDate + 'T00:00:00');
          const end = new Date(p.deadlineDate + 'T00:00:00');
          if (end <= start) return null;
          const status = taskDelayStatus({ percent: p.stats?.pct ?? 0, startDate, plannedEndDate: p.deadlineDate });
          return { project: p, start, end, status };
        })
        .filter((r): r is { project: Project; start: Date; end: Date; status: DelayStatus } => r !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [projects],
  );

  const allTimes = ranges.flatMap((r) => [r.start.getTime(), r.end.getTime()]);
  const minTime = allTimes.length ? Math.min(...allTimes) : null;
  const maxTime = allTimes.length ? Math.max(...allTimes) : null;
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
      if (first) arr.push({ time: t, label: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}` });
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

  // Con tantos proyectos el track puede ser mucho más ancho que la pantalla
  // -- arranca centrado en "hoy" en vez de en el extremo izquierdo (el
  // proyecto más antiguo), que es lo más probable que quiera ver primero.
  useEffect(() => {
    if (todayLeftPx === null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, todayLeftPx - scrollRef.current.clientWidth / 3);
  }, [todayLeftPx]);

  if (ranges.length === 0) {
    return (
      <div className="section">
        <div className="section-head">
          <div className="title-block">
            <span className="code-tag">Gantt</span>
            <h2>Gantt general de proyectos</h2>
          </div>
        </div>
        <div className="empty-state">
          Ningún proyecto tiene todavía fecha de inicio y fecha de entrega esperada configuradas.
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">Gantt</span>
          <h2>Gantt general de proyectos</h2>
        </div>
        <span className="gantt-hint">Clic en una fila para abrir el proyecto.</span>
      </div>
      <div className="gantt" ref={scrollRef}>
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
          {ranges.map((r) => {
            const leftPx = Math.round((r.start.getTime() - originTime!) / DAY_MS) * DAY_W;
            const widthPx = Math.max(DAY_W, Math.round((r.end.getTime() - r.start.getTime()) / DAY_MS) * DAY_W);
            const showLabelInside = widthPx >= 110;
            return (
              <div
                className="gantt-row"
                key={r.project.id}
                style={{ width: LABEL_COL + trackW, cursor: 'pointer' }}
                onClick={() => navigate(`/projects/${r.project.id}`)}
              >
                <span className="gantt-row-label wide" title={r.project.name}>
                  {r.project.name}
                </span>
                <div className="gantt-row-track" style={{ width: trackW }}>
                  <div
                    className="gantt-bar"
                    style={{ left: leftPx, width: widthPx, background: STATUS_COLOR[r.status] }}
                    title={`${r.project.name}: ${r.start.toISOString().slice(0, 10)} → ${r.end.toISOString().slice(0, 10)} (${DELAY_STATUS_META[r.status]})`}
                  >
                    {showLabelInside && <span className="gantt-bar-label">{DELAY_STATUS_META[r.status]}</span>}
                  </div>
                  {!showLabelInside && (
                    <span className="gantt-bar-label-outside" style={{ left: leftPx + widthPx + 8 }}>
                      {DELAY_STATUS_META[r.status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
