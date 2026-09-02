import { useMemo, useState } from 'react';
import { ProjectsApi } from '../lib/services';
import { daysBetween, type Project } from '../types/domain';

interface Props {
  project: Project;
  plannedEntregaDate: string | null;
  plannedFinalDate: string | null;
  canEdit: boolean;
  onChanged: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function DeliveryPanel({ project, plannedEntregaDate, plannedFinalDate, canEdit, onChanged }: Props) {
  const [draft, setDraft] = useState({
    deliveryDate: project.deliveryDate ?? '',
    finalDeliveryDate: project.finalDeliveryDate ?? '',
    finalObservation: project.finalObservation ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Días de atraso: se calculan solos contra la fecha final planificada del
  // roadmap. Si ya hubo entrega final real, se compara contra esa fecha; si
  // el proyecto sigue abierto, se compara contra hoy (atraso "corriendo").
  const computedDelay = useMemo(() => {
    if (!plannedFinalDate) return 0;
    const reference = draft.finalDeliveryDate || todayISO();
    return Math.max(0, daysBetween(plannedFinalDate, reference));
  }, [plannedFinalDate, draft.finalDeliveryDate]);

  async function save() {
    setSaving(true);
    try {
      await ProjectsApi.updateDelivery(project.id, {
        deliveryDate: draft.deliveryDate || null,
        finalDeliveryDate: draft.finalDeliveryDate || null,
        delayDays: computedDelay,
        finalObservation: draft.finalObservation || null,
      });
      onChanged();
    } catch (err) {
      alert(`No se pudo guardar la entrega: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // Estado visual del atraso: combina si ya hubo entrega final real y si hay
  // fecha planificada contra qué medir, para dar una sola lectura clara.
  const delayStatus = useMemo(() => {
    if (!plannedFinalDate) return { tone: 'slate' as const, label: 'Sin fecha planificada' };
    if (computedDelay > 0) {
      return {
        tone: 'rust' as const,
        label: draft.finalDeliveryDate
          ? `Entregado con ${computedDelay} ${computedDelay === 1 ? 'día' : 'días'} de atraso`
          : `${computedDelay} ${computedDelay === 1 ? 'día' : 'días'} de atraso (en curso)`,
      };
    }
    return {
      tone: 'green' as const,
      label: draft.finalDeliveryDate ? 'Entregado a tiempo' : 'En curso, a tiempo',
    };
  }, [plannedFinalDate, computedDelay, draft.finalDeliveryDate]);

  // Sin fecha de inicio en la fase "Entrega" del roadmap, todavía no hay
  // nada contra qué medir el atraso: se oculta el panel de seguimiento.
  if (!plannedEntregaDate) {
    return (
      <div className="section">
        <div className="section-head">
          <div className="title-block">
            <span className="code-tag">ENT</span>
            <h2>Entrega y atraso</h2>
          </div>
        </div>
        <div className="empty-state">
          Configura la fecha de inicio de la fase "Entrega" en el Roadmap para habilitar el
          seguimiento de entrega y atraso.
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">ENT</span>
          <h2>Entrega y atraso</h2>
        </div>
        <div className="delivery-head-actions">
          <span className={`delay-badge tone-${delayStatus.tone}`}>{delayStatus.label}</span>
          <button className="btn ghost small" onClick={save} disabled={saving || !canEdit} title="Guarda el atraso recalculado para reportes (CSV/PDF)">
            {saving ? 'Actualizando…' : 'Recalcular atraso'}
          </button>
        </div>
      </div>

      <div className="delivery-block">
        <div className="delivery-block-title">Planificado (según roadmap)</div>
        <div className="intake-grid">
          <div className="field readonly-field">
            <label>Entrega planificada</label>
            <div className="static-value">{plannedEntregaDate}</div>
          </div>
          <div className="field readonly-field">
            <label>Entrega final planificada</label>
            <div className="static-value">{plannedFinalDate ?? '—'}</div>
          </div>
          <div className="field readonly-field">
            <label>Días de atraso (automático)</label>
            <div className={`static-value ${computedDelay > 0 ? 'delay-value' : ''}`}>
              {computedDelay} {computedDelay === 1 ? 'día' : 'días'}
            </div>
          </div>
        </div>
      </div>

      <div className="notes">
        <div className="label">Observación final</div>
        <textarea
          value={draft.finalObservation}
          disabled={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, finalObservation: e.target.value }))}
          onBlur={save}
          placeholder="Observación de cierre / entrega del proyecto…"
        />
      </div>
    </div>
  );
}
