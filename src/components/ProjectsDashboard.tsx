import { useMemo } from 'react';
import { STATUS_META, type Project, type ProjectStatus } from '../types/domain';

interface Props {
  projects: Project[];
  onSliceClick?: (status: ProjectStatus) => void;
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  levantamiento: 'var(--gold)',
  desarrollo: 'var(--blue)',
  validacion: 'var(--rust)',
  cerrado: 'var(--green)',
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const p0 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rInner, startAngle);
  const p3 = polarToCartesian(cx, cy, rInner, endAngle);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p3.x} ${p3.y}`,
    'Z',
  ].join(' ');
}

export default function ProjectsDashboard({ projects, onSliceClick }: Props) {
  const byStatus = useMemo(() => {
    const counts: Record<ProjectStatus, number> = {
      levantamiento: 0, desarrollo: 0, validacion: 0, cerrado: 0,
    };
    for (const p of projects) counts[p.status]++;
    return counts;
  }, [projects]);

  const byProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) map.set(p.proveedor, (map.get(p.proveedor) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [projects]);

  const total = projects.length;
  const maxProvider = Math.max(1, ...byProvider.map(([, n]) => n));

  let angle = 0;
  const slices = (Object.entries(byStatus) as [ProjectStatus, number][])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => {
      const sliceAngle = total ? (count / total) * 360 : 0;
      const start = angle;
      const end = angle + sliceAngle;
      angle = end;
      return { status, count, start, end };
    });

  return (
    <div className="dashboard-grid">
      <div className="dash-card">
        <div className="dash-card-title">Proyectos por estado</div>
        {total === 0 ? (
          <div className="empty-state">Sin datos todavía.</div>
        ) : (
          <div className="donut-wrap">
            <svg viewBox="0 0 200 200" width="180" height="180">
              {slices.map((s) => (
                <path
                  key={s.status}
                  d={donutSlicePath(100, 100, 90, 55, s.start, s.end)}
                  fill={STATUS_COLORS[s.status]}
                  style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
                  onClick={() => onSliceClick?.(s.status)}
                >
                  <title>{`${STATUS_META[s.status]}: ${s.count}`}</title>
                </path>
              ))}
              <text x="100" y="96" textAnchor="middle" className="donut-total-num">{total}</text>
              <text x="100" y="114" textAnchor="middle" className="donut-total-label">total</text>
            </svg>
            <ul className="donut-legend">
              {(Object.keys(STATUS_META) as ProjectStatus[]).map((status) => (
                <li
                  key={status}
                  onClick={() => onSliceClick?.(status)}
                  style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
                >
                  <span className="dot" style={{ background: STATUS_COLORS[status] }} />
                  {STATUS_META[status]}
                  <strong>{byStatus[status]}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="dash-card">
        <div className="dash-card-title">Proyectos por proveedor</div>
        {byProvider.length === 0 ? (
          <div className="empty-state">Sin datos todavía.</div>
        ) : (
          <div className="bar-chart">
            {byProvider.map(([name, count]) => (
              <div className="bar-row" key={name}>
                <span className="bar-label" title={name}>{name}</span>
                <span className="bar-track2">
                  <span className="bar-fill2" style={{ width: `${(count / maxProvider) * 100}%` }} />
                </span>
                <span className="bar-value">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
