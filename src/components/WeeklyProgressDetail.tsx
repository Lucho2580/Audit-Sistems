import { useEffect, useState } from 'react';
import { WeeklyProgressApi } from '../lib/services';
import type { MilestoneReportStatus, WeeklyMilestoneLine, WeeklyProgressDetail as WeeklyProgressDetailData, WeeklyProgressWeek } from '../types/domain';

interface Props {
  projectId: string;
}

function indicatorTone(indicator: number): 'green' | 'gold' | 'rust' {
  if (indicator >= 70) return 'green';
  if (indicator >= 40) return 'gold';
  return 'rust';
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Nunca solo color: cada estado trae su propio ícono además del tono, para
// que alguien con daltonismo (rust/gold del resto de la app quedan a solo
// ΔE 6 entre sí -- ver hallazgo del validador) igual pueda distinguirlos.
const WEEK_META: Record<WeeklyProgressWeek['status'], { tone: string; icon: string; label: string }> = {
  reportado: { tone: 'green', icon: '✓', label: 'Reportada' },
  perdida: { tone: 'rust', icon: '✕', label: 'Perdida' },
  en_curso: { tone: 'blue', icon: '···', label: 'En curso' },
};

const LINE_META: Record<MilestoneReportStatus, { tone: string; label: string }> = {
  cumplido: { tone: 'green', label: 'Cumplido' },
  en_curso: { tone: 'gold', label: 'En curso' },
  sin_avance: { tone: 'rust', label: 'Sin avance' },
};

function qaLabel(line: WeeklyMilestoneLine): string | null {
  if (line.status !== 'cumplido') return null;
  if (line.qa === 'aprobado') return 'Aprobado por QA';
  if (line.qa === 'rechazado') return 'Rechazado por QA';
  return 'Pendiente de QA';
}

export default function WeeklyProgressDetail({ projectId }: Props) {
  const [detail, setDetail] = useState<WeeklyProgressDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setSelectedWeek(null);
    WeeklyProgressApi.getDetail(projectId)
      .then((d) => {
        setDetail(d);
        // Por defecto muestra la semana más reciente (la última de la lista),
        // así el reporte se ve de una sin tener que hacer clic primero.
        if (d.weeks.length) setSelectedWeek(d.weeks[d.weeks.length - 1].weekStart);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="empty-state">Cargando detalle…</div>;
  if (!detail) return <div className="empty-state">No se pudo cargar el detalle.</div>;

  const tone = indicatorTone(detail.indicator);
  // Semanas con hitos (planeados según su fecha) -- la gráfica muestra
  // cumplidos / planeados de cada una.
  const milestoneWeeks = detail.weeks.filter((w) => (w.milestonesTotal ?? 0) > 0);
  const selectedWeekData = detail.weeks.find((w) => w.weekStart === selectedWeek) ?? null;

  return (
    <div className="weekly-detail">
      <div className="weekly-detail-summary">
        <div className="weekly-detail-kpi">
          <div className="label">Índice de cumplimiento</div>
          <div className={`value tone-${tone}`}>{detail.indicator}%</div>
        </div>
        <p className="weekly-detail-explain">
          {detail.frozen ? (
            <>Indicador <b>congelado</b>: el proyecto ya se marcó "Cerrado", así que dejó de recalcularse.</>
          ) : (
            <>
              De las <b>{detail.weeksTracked}</b> semanas rastreadas desde que hay persona asignada,{' '}
              <b>{detail.weeksReported}</b> se reportaron a tiempo y <b>{detail.weeksMissed}</b> se perdieron.
              Cada semana perdida resta <b>{detail.penaltyPerWeek}</b> puntos (100 ÷ {detail.weeksRemainingYear}{' '}
              semanas que quedan del año) → 100 − {detail.weeksMissed}×{detail.penaltyPerWeek} ={' '}
              <b>{detail.indicator}%</b>.
            </>
          )}
        </p>
      </div>

      <div className="weekly-detail-grid">
        <div className="dash-card">
          <div className="dash-card-title">
            <span>Semana a semana</span>
            <span className="weekly-strip-legend">
              {(Object.keys(WEEK_META) as WeeklyProgressWeek['status'][]).map((s) => (
                <span key={s} className="weekly-strip-legend-item">
                  <span className={`weekly-cell sm tone-${WEEK_META[s].tone}`} />
                  {WEEK_META[s].label}
                </span>
              ))}
            </span>
          </div>
          {detail.weeks.length === 0 ? (
            <div className="empty-state">Todavía no hay semanas que rastrear.</div>
          ) : (
            <>
              <div className="weekly-strip">
                {detail.weeks.map((w) => {
                  const meta = WEEK_META[w.status];
                  const title = `${fmtDate(w.weekStart)} — ${meta.label}` + (w.percentAvanzado !== null ? ` (${w.percentAvanzado}%)` : '');
                  const isSelected = w.weekStart === selectedWeek;
                  return (
                    <button
                      key={w.weekStart}
                      type="button"
                      className={`weekly-cell tone-${meta.tone}${isSelected ? ' selected' : ''}`}
                      title={title}
                      aria-label={title}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedWeek(w.weekStart)}
                    >
                      {meta.icon}
                    </button>
                  );
                })}
              </div>

              {selectedWeekData && (
                <div className="weekly-week-detail">
                  <div className="weekly-week-detail-head">
                    <span className="weekly-week-detail-date">{fmtDateLong(selectedWeekData.weekStart)}</span>
                    <span className={`weekly-week-status tone-${WEEK_META[selectedWeekData.status].tone}`}>
                      {WEEK_META[selectedWeekData.status].label}
                      {selectedWeekData.percentAvanzado !== null && ` · ${selectedWeekData.percentAvanzado}%`}
                    </span>
                  </div>
                  {(selectedWeekData.milestonesTotal ?? 0) > 0 && (
                    <p className="weekly-week-detail-note">
                      Hitos: <b>{selectedWeekData.milestonesDone} de {selectedWeekData.milestonesTotal}</b> cumplidos ·{' '}
                      {selectedWeekData.milestonesApproved} aprobados por QA.
                    </p>
                  )}
                  {(selectedWeekData.items ?? []).length > 0 && (
                    <ul className="wd-lines">
                      {selectedWeekData.items.map((line) => (
                        <li key={line.code} className="wd-line">
                          <div className="wd-line-head">
                            <span className="wd-line-name">
                              <span className="section-progress-code">{line.code}</span>
                              {line.title}
                              <span className={`wr-due${line.late ? ' late' : ''}`}>
                                {line.late ? ` · venció ${fmtDate(line.dueDate)}` : ` · vence ${fmtDate(line.dueDate)}`}
                              </span>
                            </span>
                            <span className="wd-line-badges">
                              <span className={`pcard-badge tone-${LINE_META[line.status].tone}`}>
                                {LINE_META[line.status].label}
                              </span>
                              {qaLabel(line) && (
                                <span className={`pcard-badge ${line.qa === 'rechazado' ? 'tone-rust' : line.qa === 'aprobado' ? 'tone-green' : 'tone-slate'}`}>
                                  {qaLabel(line)}
                                </span>
                              )}
                            </span>
                          </div>
                          {line.note && <span className="wd-line-note">“{line.note}”</span>}
                          {line.qa === 'rechazado' && line.qaReason && (
                            <span className="wd-line-note rejected">Motivo del rechazo: {line.qaReason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="weekly-week-detail-note">
                    {selectedWeekData.note
                      ? selectedWeekData.note
                      : selectedWeekData.status === 'perdida'
                        ? 'La persona asignada no reportó nada esta semana (se pasó el plazo del sábado 12:00 pm).'
                        : selectedWeekData.status === 'reportado'
                          ? 'Sin comentario general.'
                          : 'Todavía no hay reporte para esta semana.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Hitos cumplidos por semana</div>
          {milestoneWeeks.length === 0 ? (
            <div className="empty-state">Todavía no hay hitos con fecha en las semanas rastreadas.</div>
          ) : (
            <div className="bar-chart">
              {milestoneWeeks.map((w) => (
                <div className="weekly-trend-row" key={w.weekStart}>
                  <span className="weekly-trend-label">{fmtDate(w.weekStart)}</span>
                  <span className="bar-track2">
                    <span className="bar-fill2" style={{ width: `${Math.max(3, (w.milestonesDone / w.milestonesTotal) * 100)}%` }} />
                  </span>
                  <span className="weekly-trend-value">{w.milestonesDone}/{w.milestonesTotal}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
