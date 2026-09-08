import { useEffect, useRef, useState } from 'react';
import { ProfilesApi } from '../lib/services';
import { ACTOR_ROLE_LABEL, type ProfileLite, type UserRole } from '../types/domain';

interface Props {
  role: UserRole;
  value: ProfileLite | null;
  onChange: (p: ProfileLite | null) => void;
  placeholder?: string;
  invalid?: boolean;
}

// Calcado de DirectorySearch.tsx (debounce, cierre con delay de blur), pero
// para el directorio INTERNO de esta app (profiles reales), controlado, sin
// la opción de "agregar externo por email" -- estos actores deben ser cuentas
// reales con el rol correcto, no texto libre.
export default function ProfilePicker({ role, value, onChange, placeholder, invalid }: Props) {
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
        setResults(await ProfilesApi.searchByRole(role, q.trim(), 20));
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
  }, [q, role]);

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
        placeholder={placeholder ?? `Buscar ${ACTOR_ROLE_LABEL[role].toLowerCase()}…`}
      />
      {loading && <div className="directory-search-hint">Buscando…</div>}
      {open && !loading && results.length === 0 && (
        <div className="directory-search-hint">
          No hay cuentas con rol "{ACTOR_ROLE_LABEL[role]}" que coincidan.
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
                setResults([]);
                setOpen(false);
              }}
            >
              <span className="name">{p.fullName ?? p.email}</span>
              <span className="email">{p.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
