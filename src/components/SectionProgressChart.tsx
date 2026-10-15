import { computeSectionProgress, type Section } from '../types/domain';

interface Props {
  sections: Section[];
}

// % de avance por fase del proyecto. Las "fases" son las secciones reales
// del proyecto (Ficha técnica, Flujo de procesos, Manual de usuario...), no
// las 6 fases fijas de project_phases, y su % ya no se elige a mano: sale de
// sus checkpoints (ver computeSectionProgress), así que se mueve solo cada
// vez que QA aprueba o rechaza un reporte de seguimiento.
export default function SectionProgressChart({ sections }: Props) {
  const rows = computeSectionProgress(sections);

  return (
    <div className="dash-card">
      <div className="dash-card-title">% de avance por fase</div>
      {rows.length === 0 ? (
        <div className="empty-state">Este proyecto no tiene secciones todavía.</div>
      ) : (
        <>
          <div className="bar-chart">
            {rows.map((row) => (
              <div className="bar-row" key={row.id}>
                <span className="bar-label" title={row.title}>
                  <span className="section-progress-code">{row.code}</span>
                  {row.title}
                </span>
                <span className="bar-track2">
                  <span className="bar-fill2" style={{ width: `${row.pct}%` }} />
                </span>
                <span className="bar-value" title={`${row.done} de ${row.total} checkpoints completos`}>
                  {row.pct}%
                </span>
              </div>
            ))}
          </div>
          <p className="section-progress-hint">
            Se calcula solo a partir de los checkpoints de cada sección y sus reportes aprobados por QA.
          </p>
        </>
      )}
    </div>
  );
}
