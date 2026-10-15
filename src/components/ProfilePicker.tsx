import { useEffect, useRef, useState } from 'react';
import { ProfilesApi } from '../lib/services';
import { ACTOR_ROLE_LABEL, type ProfileLite, type UserRole } from '../types/domain';
import { initials } from './DirectorySearch';

interface Props {
  role: UserRole;
  // Roles adicionales que también se pueden elegir (ej. la persona asignada
  // puede ser desarrollador o QA). Los resultados se mezclan.
  extraRoles?: UserRole[];
  value: ProfileLite | null;
  onChange: (p: ProfileLite | null) => void;
  placeholder?: string;
  invalid?: boolean;
}

// Calcado de DirectorySearch.tsx (debounce, cierre con delay de blur), pero
// para el directorio INTERNO de esta app (profiles reales), controlado, sin
// la opción de "agregar externo por email" -- estos actores deben ser cuentas
// reales con el rol correcto, no texto libre.
export default function ProfilePicker({ role, extraRoles, value, onChange, placeholder, invalid }: Props) {
  const roles = [role, ...(extraRoles ?? [])];
  const rolesKey = roles.join(',');
  const roleLabels = roles.map((r) => ACTOR_ROLE_LABEL[r]).join(' o ');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const lists = await Promise.all(roles.map((r) => ProfilesApi.searchByRole(r, q.trim(), 20)));
        const seen = new Set<string>();
        const merged = lists.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
        merged.sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email, 'es'));
        setResults(merged);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // Precarga resultados al enfocar (q vacío) sin que el usuario tenga que escribir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, rolesKey]);

  if (value) {
    return (
      <span className="participant-chip">
        {value.fullName ?? value.email}
        <button type="button" onClick={() => onChange(null)}>×</button>
      </span>
    );
  }

  return (
    <div className={`directory-search people-picker${invalid ? ' has-error' : ''}`}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? `Buscar ${roleLabels.toLowerCase()}…`}
      />
      {loading && <div className="directory-search-hint">Buscando…</div>}
      {open && !loading && results.length === 0 && (
        <div className="directory-search-hint">
          No hay cuentas con rol {roleLabels} que coincidan.
        </div>
      )}
      {open && results.length > 0 && (
        <div className="directory-search-results">
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              className="directory-search-result"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(p);
                setQ('');
                setOpen(false);
              }}
            >
              <span className="ds-avatar">{initials(p.fullName ?? p.email)}</span>
              <span className="ds-result-info">
                <span className="name">
                  {p.fullName ?? p.email}
                  {roles.length > 1 && p.role !== role && <span className="ds-role-tag">{ACTOR_ROLE_LABEL[p.role]}</span>}
                </span>
                <span className="email">{p.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
