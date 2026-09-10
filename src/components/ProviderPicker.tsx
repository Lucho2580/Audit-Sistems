import { useEffect, useState } from 'react';
import { ProvidersApi } from '../lib/services';
import type { Provider } from '../types/domain';

interface Props {
  value: Provider | null;
  onChange: (p: Provider | null) => void;
  placeholder?: string;
  invalid?: boolean;
}

// Los proveedores son solo un nombre en public.providers -- a diferencia de
// jefe/responsable (ProfilePicker), no son cuentas con acceso a la app, así
// que no hay búsqueda por rol contra profiles: se listan todos una vez y se
// filtran en el cliente.
export default function ProviderPicker({ value, onChange, placeholder, invalid }: Props) {
  const [q, setQ] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    ProvidersApi.list()
      .then(setProviders)
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  }, []);

  if (value) {
    return (
      <span className="participant-chip">
        {value.name}
        <button type="button" onClick={() => onChange(null)}>×</button>
      </span>
    );
  }

  const results = q.trim()
    ? providers.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : providers;

  return (
    <div className={`directory-search people-picker${invalid ? ' has-error' : ''}`}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Buscar proveedor…'}
      />
      {loading && <div className="directory-search-hint">Cargando…</div>}
      {open && !loading && results.length === 0 && (
        <div className="directory-search-hint">
          No hay proveedores registrados todavía. Créalo en Herramientas.
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
              <span className="name">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
