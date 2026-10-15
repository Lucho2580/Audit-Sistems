import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import PersonChip from '../components/PersonChip';
import WeeklyProgressDetail from '../components/WeeklyProgressDetail';
import { ProvidersApi, WeeklyProgressApi } from '../lib/services';
import { STATUS_META, type WeeklyProgressOverviewRow } from '../types/domain';
import { useAuth } from '../context/AuthContext';

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

function fmtShortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

type WeekState = 'cerrado' | 'reportado' | 'pendiente' | 'vencido';

// Estado de la semana en curso. "Vencido" = ya pasó el plazo (sábado 12:00 pm,
// el mismo que usa WeeklyProgressGate) y no hubo reporte.
function weekState(r: WeeklyProgressOverviewRow, now: number): WeekState {
  if (r.status === 'cerrado') return 'cerrado';
  if (r.currentWeekSubmitted) return 'reportado';
  return now > new Date(r.currentWeekDeadline).getTime() ? 'vencido' : 'pendiente';
}

const WEEK_META: Record<WeekState, { label: string; tone: string }> = {
  cerrado: { label: 'Proyecto cerrado', tone: 'slate' },
  reportado: { label: 'Reportado', tone: 'green' },
  pendiente: { label: 'Pendiente · vence sáb 12:00', tone: 'gold' },
  vencido: { label: 'Sin reportar', tone: 'rust' },
};

function WeekBadge({ state }: { state: WeekState }) {
  const meta = WEEK_META[state];
  return (
    <span className={`pcard-badge tone-${meta.tone}`}>
      {state === 'reportado' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      ) : state === 'pendiente' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      ) : state === 'vencido' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      )}
      {meta.label}
    </span>
  );
}

export default function WeeklyProgressDashboard() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<WeeklyProgressOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [providerOf, setProviderOf] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [overview, providers] = await Promise.all([
          WeeklyProgressApi.listOverview(),
          ProvidersApi.byProject().catch(() => ({} as Record<string, string>)),
        ]);
        // Solo proyectos abiertos: los cerrados ya no reportan (su indicador
        // queda congelado), así que no tiene sentido seguirlos aquí.
        setRows(overview.filter((r) => r.status !== 'cerrado'));
        setProviderOf(providers);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Opciones del filtro: los mismos proveedores de "Proyectos por proveedor",
  // contados solo sobre los proyectos que aparecen aquí, de más a menos.
  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const name = providerOf[r.projectId] ?? 'Sin asignar';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  }, [rows, providerOf]);

  const normalize = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize(search.trim());
  const visible = rows.filter((r) => {
    if (providerFilter && (providerOf[r.projectId] ?? 'Sin asignar') !== providerFilter) return false;
    if (!query) return true;
    return normalize(`${r.code} ${r.name} ${r.responsableNombre ?? ''} ${providerOf[r.projectId] ?? ''}`).includes(query);
  });

  if (profile && profile.role !== 'admin' && profile.role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }

  const now = Date.now();

  const weekLabel = rows[0]
    ? (() => {
        const s = new Date(rows[0].currentWeekStart + 'T00:00:00');
        const e = new Date(s);
        e.setDate(e.getDate() + 5);
        return `Semana del ${s.getDate()} al ${e.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}.`;
      })()
    : '';

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Jefe de proyecto · Superadmin</p>
          <h1>Informe semanal de avance</h1>
          <p className="sub">
            Cada semana se mide contra los hitos que vencen en ella: la persona asignada reporta cuáles
            cumplió y QA los aprueba. {weekLabel}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="filters weekly-filters">
          <input
            type="search"
            className="filter-search weekly-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar proyecto, código o responsable…"
            aria-label="Buscar proyectos"
          />
          <select
            className="filter-select"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            aria-label="Filtrar por proveedor"
          >
            <option value="">Proveedor: todos</option>
            {providerOptions.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
          {!loading && (
            <span className="filter-note">
              {visible.length === rows.length ? `${rows.length} proyectos abiertos` : `${visible.length} de ${rows.length} proyectos abiertos`}
            </span>
          )}
          {(search || providerFilter) && (
            <button className="btn ghost small" onClick={() => { setSearch(''); setProviderFilter(''); }}>
              Limpiar filtros ×
            </button>
          )}
        </div>
      </div>

      <div className="pcard-list">
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No hay proyectos abiertos.</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">Ningún proyecto coincide con la búsqueda o el filtro.</div>
        ) : (
          visible.map((r) => {
            const isOpen = r.projectId === selected;
            const tone = indicatorTone(r.indicator);
            const toggle = () => setSelected(isOpen ? null : r.projectId);
            const overdueProject = !r.inWindow && !!r.deadlineDate;
            return (
              <article className="pcard wcard" key={r.projectId}>
                <div className="wcard-body">
                  <div className="wcard-main">
                    <div className="pcard-tags">
                      <span className="pcard-code">{r.code}</span>
                      <span className={`pcard-status static ${r.status}`}>
                        <span className="pcard-status-dot" aria-hidden="true" />
                        <span className="pcard-status-label">{STATUS_META[r.status]}</span>
                      </span>
                      {overdueProject && (
                        <span className="pcard-badge tone-rust">Plazo vencido el {fmtShortDate(r.deadlineDate!)}</span>
                      )}
                    </div>
                    <h2 className="pcard-title">
                      <Link to={`/projects/${r.projectId}`}>{r.name}</Link>
                    </h2>
                    <PersonChip role="Responsable del reporte" name={r.responsableNombre} />
                    <button type="button" className="pcard-toggle" aria-expanded={isOpen} onClick={toggle}>
                      {isOpen ? 'Ocultar detalle de hitos' : 'Ver detalle de hitos'}
                      <svg className={`pcard-chevron${isOpen ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                  </div>

                  <div className="wcard-metrics">
                    <div className="wcard-metric">
                      <span className="pcard-eyebrow">Hitos de la semana</span>
                      {r.weekMilestonesTotal > 0 ? (
                        <>
                          <span className="wcard-figure">
                            <span className="pcard-pct">{r.weekMilestonesDone}/{r.weekMilestonesTotal}</span>
                            <span className="pcard-pct-caption">cumplidos</span>
                          </span>
                          <span className="pcard-section-bar"><span style={{ width: `${Math.round((r.weekMilestonesDone / r.weekMilestonesTotal) * 100)}%` }} /></span>
                        </>
                      ) : r.nextDueDate ? (
                        <span className="weekly-metric-text">
                          No vence ningún hito esta semana. Próximo: {r.nextDueCode}, {fmtShortDate(r.nextDueDate)}.
                        </span>
                      ) : r.undatedCount > 0 ? (
                        <>
                          <span className="pcard-badge tone-gold">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 10h18" /><path d="M8 2v4" /><path d="M16 2v4" /></svg>
                            {r.undatedCount} hitos sin fecha
                          </span>
                          <span className="weekly-metric-text">Sin fechas no hay contra qué medir la semana.</span>
                          <Link className="weekly-metric-link" to={`/projects/${r.projectId}`}>Asignar fechas a los hitos →</Link>
                        </>
                      ) : (
                        <span className="weekly-metric-text">No hay hitos pendientes.</span>
                      )}
                      {r.overdueCount > 0 && (
                        <span className="weekly-metric-late">
                          {r.overdueCount === 1 ? '1 hito atrasado' : `${r.overdueCount} hitos atrasados`} de semanas anteriores
                        </span>
                      )}
                    </div>
                    <div className="wcard-metric">
                      <span className="pcard-eyebrow">Reportes a tiempo</span>
                      <span className="wcard-figure"><span className="pcard-pct">{r.indicator}%</span></span>
                      <span className="pcard-bar" aria-hidden="true">
                        <span className="pcard-bar-track" />
                        <span className={`pcard-bar-fill weekly-fill tone-${tone}`} style={{ width: `${Math.min(100, r.indicator)}%` }} />
                      </span>
                      <WeekBadge state={weekState(r, now)} />
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="pcard-breakdown">
                    <WeeklyProgressDetail projectId={r.projectId} />
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
