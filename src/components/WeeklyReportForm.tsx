import { useEffect, useState } from 'react';
import { WeeklyProgressApi } from '../lib/services';
import type { MilestoneReportStatus, WeeklyReportForm as FormData, WeeklyReportFormItem } from '../types/domain';

interface Props {
  projectId: string;
  // modal = dentro de WeeklyProgressGate (una columna); page = página del proyecto.
  variant?: 'modal' | 'page';
  // Si ya se envió esta semana: la persona asignada no puede corregirlo
  // (igual que antes); admin/superadmin sí.
  allowEditAfterSubmit: boolean;
  onSubmitted?: () => void;
}

const STATUS_OPTIONS: { value: MilestoneReportStatus; label: string; tone: string }[] = [
  { value: 'cumplido', label: 'Cumplido', tone: 'green' },
  { value: 'en_curso', label: 'En curso', tone: 'gold' },
  { value: 'sin_avance', label: 'Sin avance', tone: 'rust' },
];

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return `${s.getDate()} al ${e.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;
}

type Draft = Record<string, { status: MilestoneReportStatus | null; note: string }>;

// Formulario del reporte semanal por hitos: por cada hito que vence esta
// semana (y cada atrasado) se marca cumplido / en curso / sin avance. El % de
// la semana lo calcula el servidor (cumplidos / hitos de la semana).
export default function WeeklyReportForm({ projectId, variant = 'page', allowEditAfterSubmit, onSubmitted }: Props) {
  const [form, setForm] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>({});
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await WeeklyProgressApi.getReportForm(projectId);
      setForm(data);
      const d: Draft = {};
      for (const it of [...data.weekItems, ...data.overdueItems]) {
        d[it.itemId] = { status: it.status, note: it.note ?? '' };
      }
      setDraft(d);
      setNote(data.note ?? '');
      setEditing(!data.submittedAt);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (loading) return <div className="empty-state">Cargando hitos de la semana…</div>;
  if (!form) return <div className="auth-error">{error ?? 'No se pudo cargar el reporte.'}</div>;

  const actionable = (it: WeeklyReportFormItem) => !it.approved && !it.pendingQa;
  const weekActionable = form.weekItems.filter(actionable);
  const allActionable = [...weekActionable, ...form.overdueItems];
  const total = form.weekItems.length;
  const done = form.weekItems.filter(
    (it) => it.approved || it.pendingQa || draft[it.itemId]?.status === 'cumplido',
  ).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const counts = {
    cumplido: done,
    en_curso: weekActionable.filter((it) => draft[it.itemId]?.status === 'en_curso').length,
    sin_avance: weekActionable.filter((it) => draft[it.itemId]?.status === 'sin_avance').length,
  };
  const readOnly = !form.isOpen || (!!form.submittedAt && !editing);

  function setStatus(itemId: string, status: MilestoneReportStatus) {
    setDraft((d) => ({ ...d, [itemId]: { status, note: d[itemId]?.note ?? '' } }));
  }

  function setItemNote(itemId: string, value: string) {
    setDraft((d) => ({ ...d, [itemId]: { status: d[itemId]?.status ?? null, note: value } }));
  }

  async function submit() {
    const missing = allActionable.filter((it) => !draft[it.itemId]?.status);
    if (missing.length) {
      setError(`Marca el estado de: ${missing.map((it) => it.code).join(', ')}.`);
      return;
    }
    const noNote = allActionable.filter(
      (it) => draft[it.itemId]?.status !== 'cumplido' && (draft[it.itemId]?.note ?? '').trim().length < 3,
    );
    if (noNote.length) {
      setError(`Escribe el comentario de: ${noNote.map((it) => it.code).join(', ')} (qué falta o por qué no hubo avance).`);
      return;
    }
    if (allActionable.length === 0 && !note.trim()) {
      setError('No hay hitos para reportar esta semana: describe en el comentario qué se hizo (o que no hubo avance).');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await WeeklyProgressApi.submitReport(
        projectId,
        note.trim(),
        allActionable.map((it) => ({
          itemId: it.itemId,
          status: draft[it.itemId]!.status!,
          note: (draft[it.itemId]?.note ?? '').trim(),
        })),
      );
      await load();
      onSubmitted?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function renderItem(it: WeeklyReportFormItem, late: boolean) {
    const d = draft[it.itemId];
    const locked = it.approved || it.pendingQa;
    return (
      <article className={`wr-item${late ? ' late' : ''}${d?.status === 'cumplido' ? ' done' : ''}`} key={it.itemId}>
        <div className="wr-item-head">
          <div className="wr-item-text">
            <span className="wr-item-meta">
              <span className="section-progress-code">{it.code}</span>
              <span className={`wr-due${late ? ' late' : ''}`}>
                {late ? `Venció ${fmtDay(it.dueDate)} · ${it.daysLate} día(s) de atraso` : `Vence ${fmtDay(it.dueDate)}`}
              </span>
            </span>
            <span className="wr-item-title">{it.title}</span>
          </div>
          {locked ? (
            <span className="pcard-badge tone-green">
              {it.approved ? 'Aprobado por QA' : 'Cumplido · pendiente de QA'}
            </span>
          ) : (
            <div className="wr-seg" role="group" aria-label={`Estado de ${it.code}`}>
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wr-seg-btn${d?.status === opt.value ? ` on tone-${opt.tone}` : ''}`}
                  aria-pressed={d?.status === opt.value}
                  disabled={readOnly}
                  onClick={() => setStatus(it.itemId, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!locked && d?.status === 'cumplido' && (
          <span className="wr-qa-hint">Al enviar, queda como seguimiento pendiente de aprobación de QA.</span>
        )}
        {!locked && d?.status && d.status !== 'cumplido' && (
          <label className="wr-note">
            <span>{d.status === 'en_curso' ? '¿Qué falta para cumplirlo? (obligatorio)' : '¿Por qué no hubo avance? (obligatorio)'}</span>
            <textarea
              value={d.note}
              disabled={readOnly}
              onChange={(e) => setItemNote(it.itemId, e.target.value)}
              placeholder={d.status === 'en_curso' ? 'Ej.: falta validar con el área usuaria…' : 'Ej.: bloqueado esperando información de…'}
            />
          </label>
        )}
      </article>
    );
  }

  return (
    <div className={`wr ${variant}`}>
      <div className="wr-week">
        <span>Semana del {fmtRange(form.weekStart, form.weekEnd)}</span>
        {form.isOpen ? (
          <span className="pcard-badge tone-gold">Vence el sábado a las 12:00 m</span>
        ) : (
          <span className="pcard-badge tone-slate">Plazo cerrado · se reporta de nuevo el lunes</span>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="wr-layout">
        <div className="wr-main">
          <section className="wr-section">
            <div className="wr-section-head">
              <h3>Hitos que vencen esta semana</h3>
              <span className="wr-count">{form.weekItems.length} {form.weekItems.length === 1 ? 'hito' : 'hitos'}</span>
            </div>
            {form.weekItems.length === 0 ? (
              <p className="wr-empty">
                No vence ningún hito esta semana.
                {form.undatedCount > 0 && ` Hay ${form.undatedCount} hito(s) sin fecha: pide al jefe de proyecto que les asigne una.`}
              </p>
            ) : (
              form.weekItems.map((it) => renderItem(it, false))
            )}
          </section>

          {form.overdueItems.length > 0 && (
            <section className="wr-section">
              <div className="wr-section-head late">
                <h3>Hitos atrasados de semanas anteriores</h3>
                <span className="wr-count">{form.overdueItems.length} {form.overdueItems.length === 1 ? 'hito' : 'hitos'}</span>
              </div>
              {form.overdueItems.map((it) => renderItem(it, true))}
            </section>
          )}

          <label className="wr-general">
            <span>
              Comentario general de la semana{allActionable.length === 0 ? ' (obligatorio)' : ' (opcional)'}
            </span>
            <textarea
              value={note}
              disabled={readOnly}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bloqueos, dependencias o algo que el jefe de proyecto deba saber…"
            />
          </label>
        </div>

        <aside className="wr-side">
          <div className="wr-summary">
            <span className="pcard-eyebrow">Avance de la semana</span>
            {total > 0 ? (
              <>
                <div className="wr-summary-figure">
                  <span className="pcard-pct">{pct}%</span>
                  <span className="pcard-pct-caption">{done} de {total} hitos cumplidos</span>
                </div>
                <span className="pcard-section-bar"><span style={{ width: `${pct}%` }} /></span>
                <div className="wr-summary-counts">
                  <span><b className="tone-green">{counts.cumplido}</b> Cumplidos</span>
                  <span><b className="tone-gold">{counts.en_curso}</b> En curso</span>
                  <span><b className="tone-rust">{counts.sin_avance}</b> Sin avance</span>
                </div>
              </>
            ) : (
              <span className="pcard-pct-caption">Sin hitos esta semana: no afecta el avance.</span>
            )}
            <span className="wr-summary-hint">Se calcula solo con los hitos que vencen esta semana.</span>
          </div>

          {form.nextItems.length > 0 && (
            <div className="wr-next">
              <span className="pcard-eyebrow">Próximos hitos</span>
              {form.nextItems.map((n) => (
                <span key={n.code} className="wr-next-row">
                  <span className="wr-due">{fmtDay(n.dueDate)}</span> {n.code} · {n.title}
                </span>
              ))}
            </div>
          )}

          {form.isOpen && (
            readOnly ? (
              <div className="wr-sent">
                <span className="pcard-badge tone-green">Reporte enviado</span>
                {allowEditAfterSubmit && (
                  <button type="button" className="pcard-btn" onClick={() => setEditing(true)}>Corregir reporte</button>
                )}
              </div>
            ) : (
              <button type="button" className="btn wr-submit" onClick={submit} disabled={saving}>
                {saving ? 'Enviando…' : form.submittedAt ? 'Actualizar reporte' : 'Enviar reporte semanal'}
              </button>
            )
          )}
        </aside>
      </div>
    </div>
  );
}
