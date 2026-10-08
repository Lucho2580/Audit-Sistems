import { useMemo, useState } from 'react';
import { phaseEndDate, type PhaseTask, type ProjectPhase } from '../types/domain';

interface Props {
  phases: ProjectPhase[];
  tasks: PhaseTask[];
}

const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAY_LABELS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const pad2 = (n: number) => String(n).padStart(2, '0');

interface DayItem {
  kind: 'hito' | 'tarea';
  label: string;
}

// Calendario con hitos (fin de fase) y tareas (fecha fin planeada) -- ítem
// 10. Mismo armado de grilla (cells/startOffset/trailing) que ya usa
// MeetingsCalendar.tsx para el calendario de reuniones.
export default function ProjectCalendar({ phases, tasks }: Props) {
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const totalDays = new Date(y, m + 1, 0).getDate();
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const trailing = (7 - ((startOffset + totalDays) % 7)) % 7;

  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const push = (date: string | null, item: DayItem) => {
      if (!date) return;
      const list = map.get(date) ?? [];
      list.push(item);
      map.set(date, list);
    };
    for (const phase of phases) {
      push(phaseEndDate(phase), { kind: 'hito', label: `Fin de fase: ${phase.label}` });
    }
    for (const task of tasks) {
      push(task.plannedEndDate, { kind: 'tarea', label: task.text });
    }
    return map;
  }, [phases, tasks]);

  const cells = useMemo(() => {
    const arr: { day: number | null; date: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) arr.push({ day: null, date: null });
    for (let d = 1; d <= totalDays; d++) arr.push({ day: d, date: `${y}-${pad2(m + 1)}-${pad2(d)}` });
    for (let i = 0; i < trailing; i++) arr.push({ day: null, date: null });
    return arr;
  }, [y, m, totalDays, startOffset, trailing]);

  const selectedItems = selectedDay ? itemsByDay.get(selectedDay) ?? [] : [];

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">Cal</span>
          <h2>Calendario de tareas e hitos</h2>
        </div>
        <div className="cal-nav">
          <button className="btn ghost small" onClick={() => setCalMonth(new Date(y, m - 1, 1))}>←</button>
          <span className="cal-month-label">{MONTH_LABELS[m]} {y}</span>
          <button className="btn ghost small" onClick={() => setCalMonth(new Date(y, m + 1, 1))}>→</button>
        </div>
      </div>

      <div className="cal-grid-head">
        {DAY_LABELS.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((c, i) => {
          const items = c.date ? itemsByDay.get(c.date) ?? [] : [];
          return (
            <div
              key={i}
              className={`cal-cell ${c.date ? '' : 'empty'} ${c.date && selectedDay === c.date ? 'selected' : ''}`}
              onClick={() => c.date && setSelectedDay(selectedDay === c.date ? null : c.date)}
            >
              {c.day && <span className="cal-day-num">{c.day}</span>}
              {items.length > 0 && (
                <span className="cal-dots">
                  {items.slice(0, 4).map((it, idx) => (
                    <span key={idx} className={`cal-dot ${it.kind === 'hito' ? 'hito' : 'tarea'}`} title={it.label} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="cal-day-detail">
          <strong>{selectedDay}</strong>
          {selectedItems.length === 0 ? (
            <span className="admin-hint" style={{ padding: 0 }}>Sin hitos ni tareas ese día.</span>
          ) : (
            <ul>
              {selectedItems.map((it, i) => (
                <li key={i}><span className={`cal-dot ${it.kind === 'hito' ? 'hito' : 'tarea'}`} /> {it.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
