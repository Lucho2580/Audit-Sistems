import { useEffect, useState } from 'react';
import { WeeklyProgressApi } from '../lib/services';
import type { WeeklyMilestoneLine, WeeklyProgressDetail as WeeklyProgressDetailData, WeeklyProgressWeek } from '../types/domain';

interface Props {
  projectId: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function parse(iso: string) {
  return new Date(iso + 'T00:00:00');
}

// "5–10 oct" (lunes a sábado), o "28 sep–3 oct" si cruza de mes.
function weekRange(weekStart: string) {
  const s = parse(weekStart);
  const e = new Date(s);
  e.setDate(e.getDate() + 5);
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]}`
    : `${s.getDate()} ${MONTHS[s.getMonth()]}–${e.getDate()} ${MONTHS[e.getMonth()]}`;
}

function fmtDay(iso: string) {
  return parse(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtSent(iso: string) {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Estado de cada hito de la semana, en una sola insignia (como en el diseño).
function lineBadge(line: WeeklyMilestoneLine, weekOpen: boolean): { label: string; tone: string } {
  if (!line.status) {
    if (line.approved) return { label: 'Aprobado por QA', tone: 'green' };
    return weekOpen ? { label: 'Por reportar', tone: 'slate' } : { label: 'No reportado', tone: 'rust' };
  }
  if (line.status === 'cumplido') {
    if (line.qa === 'aprobado') return { label: 'Aprobado por QA', tone: 'green' };
    if (line.qa === 'rechazado') return { label: 'Rechazado por QA', tone: 'rust' };
    return { label: 'Cumplido · pendiente QA', tone: 'green' };
  }
  if (line.status === 'en_curso') return { label: 'En curso', tone: 'gold' };
  return { label: 'Sin avance', tone: 'rust' };
}

const REPORT_META: Record<WeeklyProgressWeek['status'], { label: string; tone: string }> = {
  reportado: { label: 'A tiempo', tone: 'green' },
  perdida: { label: 'No reportó', tone: 'rust' },
  en_curso: { label: 'En curso', tone: 'slate' },
};

// Detalle de hitos y semanas de un proyecto: a la izquierda el reporte de la
// semana elegida hito por hito; a la derecha las semanas (cumplidos,
// aprobados por QA, si se reportó) para elegir cuál ver.
export default function WeeklyProgressDetail({ projectId }: Props) {
  const [detail, setDetail] = useState<WeeklyProgressDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    WeeklyProgressApi.getDetail(projectId)
      .then((d) => {
        if (!active) return;
        setDetail(d);
        setSelectedWeek(d.weeks.length ? d.weeks[d.weeks.length - 1].weekStart : null);
      })
      .catch(() => { if (active) setDetail(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <div className="empty-state">Cargando detalle…</div>;
  if (!detail) return <div className="empty-state">No se pudo cargar el detalle.</div>;
  if (detail.weeks.length === 0) {
    return <div className="empty-state">Todavía no hay semanas que rastrear (el proyecto no tiene persona asignada).</div>;
  }

  const weeksDesc = detail.weeks.slice().reverse();
  const visibleWeeks = showAll ? weeksDesc : weeksDesc.slice(0, 8);
  const week = detail.weeks.find((w) => w.weekStart === selectedWeek) ?? weeksDesc[0];
  const isCurrent = week.status === 'en_curso' || week.weekStart === weeksDesc[0].weekStart;
  const items = week.items ?? [];

  const heading =
    week.status === 'reportado'
      ? `${isCurrent ? 'Reporte de esta semana' : `Reporte del ${weekRange(week.weekStart)}`}${week.submittedAt ? ` · enviado ${fmtSent(week.submittedAt)}` : ''}`
      : week.status === 'perdida'
        ? `Semana del ${weekRange(week.weekStart)} · no se reportó`
        : `Semana del ${weekRange(week.weekStart)} · todavía sin reporte`;

  return (
    <div className="wmd">
      <div className="wmd-week">
        <span className="pcard-eyebrow">{heading}</span>
        {(week.milestonesTotal ?? 0) > 0 && (
          <span className="wmd-week-sum">
            {week.milestonesDone} de {week.milestonesTotal} hitos cumplidos · {week.milestonesApproved} aprobados por QA
          </span>
        )}
        {items.length > 0 ? (
          <ul className="wmd-lines">
            {items.map((line) => {
              const badge = lineBadge(line, week.status === 'en_curso' || (isCurrent && week.status === 'reportado'));
              return (
                <li className="wmd-line" key={line.code}>
                  <div className="wmd-line-head">
                    <span className="wmd-line-name">
                      <span className="section-progress-code">{line.code}</span>
                      <span className="wmd-line-title" title={line.title}>{line.title}</span>
                    </span>
                    <span className={`pcard-badge tone-${badge.tone}`}>{badge.label}</span>
                  </div>
                  <span className={`wr-due${line.late ? ' late' : ''}`}>
                    {line.late ? `Venció ${fmtDay(line.dueDate)} · reportado como atrasado` : `Vence ${fmtDay(line.dueDate)}`}
                  </span>
                  {line.note && <span className="wmd-line-note">“{line.note}”</span>}
                  {line.qa === 'rechazado' && line.qaReason && (
                    <span className="wmd-line-note rejected">Motivo del rechazo de QA: {line.qaReason}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="wmd-empty">
            <span>No vencía ningún hito esta semana.</span>
            {detail.undatedCount > 0 && (
              <span className="wmd-empty-warn">
                El proyecto tiene {detail.undatedCount} hito(s) sin fecha: hay que asignarles una en el detalle del proyecto para poder medirlos.
              </span>
            )}
            {isCurrent && (detail.nextItems ?? []).length > 0 && (
              <span>
                Próximos: {detail.nextItems.map((n) => `${n.code} (${fmtDay(n.dueDate)})`).join(', ')}.
              </span>
            )}
          </div>
        )}
        {week.status === 'perdida' && (
          <p className="wmd-general rejected">La persona asignada no reportó esta semana (se pasó el plazo del sábado 12:00 pm).</p>
        )}
        {week.note && (
          <p className="wmd-general"><b>Comentario general:</b> {week.note}</p>
        )}
      </div>

      <div className="wmd-history">
        <span className="pcard-eyebrow">Semanas</span>
        <div className="wmd-table" role="table" aria-label="Semanas del proyecto">
          <div className="wmd-row head" role="row">
            <span role="columnheader">Semana</span>
            <span role="columnheader">Cumplidos</span>
            <span role="columnheader">QA</span>
            <span role="columnheader">Reporte</span>
          </div>
          {visibleWeeks.map((w) => {
            const meta = REPORT_META[w.status];
            const hasMilestones = (w.milestonesTotal ?? 0) > 0;
            return (
              <button
                type="button"
                role="row"
                key={w.weekStart}
                className={`wmd-row${w.weekStart === week.weekStart ? ' selected' : ''}`}
                aria-pressed={w.weekStart === week.weekStart}
                onClick={() => setSelectedWeek(w.weekStart)}
              >
                <span role="cell">{weekRange(w.weekStart)}</span>
                <span role="cell"><b>{hasMilestones ? `${w.milestonesDone} de ${w.milestonesTotal}` : '—'}</b></span>
                <span role="cell">{hasMilestones ? w.milestonesApproved : '—'}</span>
                <span role="cell" className={`wmd-report tone-${meta.tone}`}>{meta.label}</span>
              </button>
            );
          })}
        </div>
        {weeksDesc.length > 8 && (
          <button type="button" className="ucard-link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ver solo las últimas 8 semanas' : `Ver las ${weeksDesc.length} semanas`}
          </button>
        )}
        <span className="wmd-foot">
          "QA" = hitos cumplidos que ya aprobó QA. Un hito rechazado por QA vuelve a quedar pendiente.
          {!detail.frozen && ` Reportes a tiempo: ${detail.weeksReported} de ${detail.weeksTracked} semanas; cada semana sin reporte resta ${detail.penaltyPerWeek} puntos.`}
          {detail.frozen && ' Indicador congelado: el proyecto ya se cerró.'}
        </span>
      </div>
    </div>
  );
}
