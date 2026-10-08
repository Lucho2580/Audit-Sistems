import { useMemo } from 'react';
import { STATUS_META, type Project, type ProjectStatus } from '../types/domain';
import { donutSlicePath } from '../lib/charts';

interface Props {
  projects: Project[];
  onSliceClick?: (status: ProjectStatus) => void;
  onProviderClick?: (name: string) => void;
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  levantamiento: 'var(--gold)',
  desarrollo: 'var(--blue)',
  validacion: 'var(--rust)',
  cerrado: 'var(--green)',
};

export default function ProjectsDashboard({ projects, onSliceClick, onProviderClick }: Props) {
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

  // Leyenda de mayor a menor, con el % que representa cada estado sobre el total.
  const statusLegend = (Object.keys(STATUS_META) as ProjectStatus[])
    .map((status) => ({
      status,
      count: byStatus[status],
      pct: total ? Math.round((byStatus[status] / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

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
              {statusLegend.map(({ status, count, pct }) => (
                <li
                  key={status}
                  onClick={() => onSliceClick?.(status)}
                  style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
                >
                  <span className="dot" style={{ background: STATUS_COLORS[status] }} />
                  {STATUS_META[status]}
                  <strong>{count}</strong>
                  <span className="donut-legend-pct">{pct}%</span>
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
              <div
                className="bar-row"
                key={name}
                onClick={() => onProviderClick?.(name)}
                style={{ cursor: onProviderClick ? 'pointer' : 'default' }}
                title={onProviderClick ? `Ver los ${count} proyecto(s) de ${name}` : undefined}
              >
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
