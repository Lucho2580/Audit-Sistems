import { useEffect, useRef, useState } from 'react';
import { DirectoryApi, type DirectoryUser } from '../lib/services';

interface Props {
  onSelect: (user: DirectoryUser) => void;
  placeholder?: string;
  /** Rol que tendrá la persona al agregarla (ej. "Invitado", "Cliente"). Se muestra antes de seleccionar. */
  roleLabel?: string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export default function DirectorySearch({ onSelect, placeholder, roleLabel }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualEmail, setManualEmail] = useState('');

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const users = await DirectoryApi.search(q.trim());
        setResults(users);
        setOpen(true);
      } catch (err) {
        setError((err as Error).message || 'No se pudo buscar en el directorio de Entra ID.');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  function addManual() {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name || !email.includes('@')) return;
    onSelect({ id: crypto.randomUUID(), name, email });
    setManualName('');
    setManualEmail('');
    setManualMode(false);
  }

  if (manualMode) {
    return (
      <div className="directory-search directory-manual">
        <input
          type="text"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder="Nombre completo"
        />
        <input
          type="email"
          value={manualEmail}
          onChange={(e) => setManualEmail(e.target.value)}
          placeholder="Correo del proveedor"
        />
        <div className="directory-manual-actions">
          <button type="button" className="btn small" onClick={addManual}>Agregar</button>
          <button type="button" className="btn small ghost" onClick={() => setManualMode(false)}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="directory-search">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Buscar persona por nombre…'}
      />
      {loading && <div className="directory-search-hint">Buscando…</div>}
      {error && <div className="directory-search-hint error">{error}</div>}
      {open && results.length > 0 && (
        <div className="directory-search-results">
          {roleLabel && (
            <div className="directory-search-role-hint">
              Se agregará como <span className="directory-search-role-badge">{roleLabel}</span>
            </div>
          )}
          {results.map((u) => (
            <button
              type="button"
              key={u.id}
              className="directory-search-result"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(u);
                setQ('');
                setResults([]);
                setOpen(false);
              }}
            >
              <span className="ds-avatar">{initials(u.name)}</span>
              <span className="ds-result-info">
                <span className="name">{u.name}</span>
                <span className="email">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="directory-manual-toggle" onClick={() => setManualMode(true)}>
        ¿No aparece? Agregar externo por correo
      </button>
    </div>
  );
}
