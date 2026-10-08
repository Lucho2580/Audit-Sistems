import { useMemo } from 'react';
import { donutSlicePath, colorForIndex } from '../lib/charts';
import type { PhaseTask } from '../types/domain';

interface Props {
  tasks: PhaseTask[];
}

// % de participación por persona asignada a cada tarea (ítem 1) -- ordenado
// de mayor a menor en el gráfico y en la leyenda, confirmado con el usuario.
export default function ParticipationChart({ tasks }: Props) {
  const slices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      const key = t.assignedToNombre ?? 'Sin asignar';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = tasks.length;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    let angle = 0;
    return sorted.map(([name, count], i) => {
      const sliceAngle = total ? (count / total) * 360 : 0;
      const start = angle;
      const end = angle + sliceAngle;
      angle = end;
      return { name, count, start, end, pct: total ? Math.round((count / total) * 100) : 0, color: colorForIndex(i) };
    });
  }, [tasks]);

  const total = tasks.length;

  return (
    <div className="dash-card">
      <div className="dash-card-title">Participación por persona asignada</div>
      {total === 0 ? (
        <div className="empty-state">Sin tareas registradas todavía.</div>
      ) : (
        <div className="donut-wrap">
          <svg viewBox="0 0 200 200" width="180" height="180">
            {slices.map((s) => (
              <path key={s.name} d={donutSlicePath(100, 100, 90, 55, s.start, s.end)} fill={s.color}>
                <title>{`${s.name}: ${s.count} (${s.pct}%)`}</title>
              </path>
            ))}
            <text x="100" y="96" textAnchor="middle" className="donut-total-num">{total}</text>
            <text x="100" y="114" textAnchor="middle" className="donut-total-label">tareas</text>
          </svg>
          <ul className="donut-legend">
            {slices.map((s) => (
              <li key={s.name}>
                <span className="dot" style={{ background: s.color }} />
                {s.name}
                <strong>{s.pct}%</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
