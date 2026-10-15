import { initialsOf } from '../lib/initials';

// Persona en una tarjeta (proyectos, informe semanal): iniciales en círculo +
// rol + nombre. Sin nombre se ve punteada y en cursiva, para que salte a la
// vista que falta asignarla.
export default function PersonChip({ role, name }: { role: string; name: string | null | undefined }) {
  const missing = !name;
  return (
    <div className="pcard-person">
      <span className={`pcard-avatar${missing ? ' missing' : ''}`} aria-hidden="true">
        {missing ? '—' : initialsOf(name)}
      </span>
      <span className="pcard-person-text">
        <span className="pcard-person-role">{role}</span>
        <span className={`pcard-person-name${missing ? ' missing' : ''}`} title={name ?? undefined}>
          {missing ? 'Sin asignar' : name}
        </span>
      </span>
    </div>
  );
}
