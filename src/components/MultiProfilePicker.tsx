import { useEffect, useRef, useState } from 'react';
import { ProfilesApi } from '../lib/services';
import { ACTOR_ROLE_LABEL, type ProfileLite, type UserRole } from '../types/domain';
import { initials } from './DirectorySearch';

interface Props {
  role: UserRole;
  value: ProfileLite[];
  onChange: (list: ProfileLite[]) => void;
  invalid?: boolean;
}

// Como ProfilePicker pero para varios actores del mismo rol a la vez -- un
// proyecto puede tener más de un jefe y más de un cliente (a diferencia de
// responsable/proveedor, que son un solo actor). Los ya elegidos quedan como
// chips removibles arriba del buscador, que se queda siempre visible (no se
// reemplaza por el valor, como en ProfilePicker de un solo valor).
export default function MultiProfilePicker({ role, value, onChange, invalid }: Props) {
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
  }, [q, role]);

  const selectedIds = new Set(value.map((v) => v.id));
  const visibleResults = results.filter((p) => !selectedIds.has(p.id));

  function add(p: ProfileLite) {
    onChange([...value, p]);
    setQ('');
    setOpen(false);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v.id !== id));
  }

  const roleLabel = ACTOR_ROLE_LABEL[role].toLowerCase();

  return (
    <div className="multi-picker">
      {value.length > 0 && (
        <div className="multi-picker-chips">
          {value.map((p) => (
            <span className="participant-chip" key={p.id}>
              {p.fullName ?? p.email}
              <button type="button" onClick={() => remove(p.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className={`directory-search people-picker${invalid ? ' has-error' : ''}`}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder={`Buscar ${roleLabel}…`}
        />
        {loading && <div className="directory-search-hint">Buscando…</div>}
        {open && !loading && visibleResults.length === 0 && (
          <div className="directory-search-hint">No hay más cuentas con rol "{ACTOR_ROLE_LABEL[role]}" que coincidan.</div>
        )}
        {open && visibleResults.length > 0 && (
          <div className="directory-search-results">
            {visibleResults.map((p) => (
              <button
                type="button"
                key={p.id}
                className="directory-search-result"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(p)}
              >
                <span className="ds-avatar">{initials(p.fullName ?? p.email)}</span>
                <span className="ds-result-info">
                  <span className="name">{p.fullName ?? p.email}</span>
                  <span className="email">{p.email}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
