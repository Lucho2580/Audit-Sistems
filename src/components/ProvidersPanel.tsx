import { useEffect, useState } from 'react';
import { ProvidersApi } from '../lib/services';
import { initialsOf } from '../lib/initials';
import type { Provider } from '../types/domain';

// Proveedores: a diferencia de las cuentas (que vienen de Entra ID), esta
// lista sí se administra aquí -- son las opciones del selector "Proveedor"
// al crear o editar un proyecto.
export default function ProvidersPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  async function load() {
    setLoading(true);
    try {
      const [list, counts] = await Promise.all([ProvidersApi.list(), ProvidersApi.projectCounts()]);
      setProviders(list);
      setUsage(counts);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function usedBy(p: Provider): number {
    return usage[p.name.trim().toLowerCase()] ?? 0;
  }

  async function addProvider() {
    const name = newName.trim();
    if (!name) return;
    if (providers.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
      alert(`"${name}" ya está registrado.`);
      return;
    }
    setAdding(true);
    try {
      await ProvidersApi.create(name);
      setNewName('');
      load();
    } catch (err) {
      alert(`No se pudo agregar el proveedor: ${(err as Error).message}`);
    } finally {
      setAdding(false);
    }
  }

  async function removeProvider(p: Provider) {
    const n = usedBy(p);
    const warning = n
      ? `\n\n${n} proyecto(s) lo tienen asignado: conservan el nombre, pero dejará de aparecer en el selector.`
      : '';
    if (!confirm(`¿Eliminar el proveedor "${p.name}"?${warning}`)) return;
    setBusyId(p.id);
    try {
      await ProvidersApi.remove(p.id);
      load();
    } catch (err) {
      alert(`No se pudo eliminar: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <div className="title-block">
          <span className="code-tag">PRV</span>
          <h2>Proveedores</h2>
          {!loading && <span className="ucard-count">{providers.length}</span>}
        </div>
      </div>
      <p className="admin-hint">
        Son las opciones del selector "Proveedor" al crear o editar un proyecto. A diferencia de las
        cuentas, esta lista sí se administra aquí.
      </p>

      <div className="ucard-grid">
        <form
          className="ucard pending provider-add"
          onSubmit={(e) => {
            e.preventDefault();
            addProvider();
          }}
        >
          <label className="ucard-code" htmlFor="new-provider">Nuevo proveedor</label>
          <input
            id="new-provider"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del proveedor…"
            autoComplete="off"
          />
          <button type="submit" className="pcard-btn provider-add-btn" disabled={adding || !newName.trim()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            {adding ? 'Agregando…' : 'Agregar proveedor'}
          </button>
        </form>

        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : (
          providers.map((p, idx) => {
            const n = usedBy(p);
            return (
              <article className="ucard" key={p.id}>
                <div className="ucard-top">
                  <span className="pcard-avatar provider-avatar" aria-hidden="true">{initialsOf(p.name)}</span>
                  <div className="ucard-id">
                    <span className="ucard-code">PRV-{String(idx + 1).padStart(2, '0')}</span>
                    <span className="ucard-name static" title={p.name}>{p.name}</span>
                  </div>
                  <div className="pcard-menu-wrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="pcard-icon-btn"
                      aria-label={`Más acciones para ${p.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuId === p.id}
                      onClick={() => setMenuId((cur) => (cur === p.id ? null : p.id))}
                      disabled={busyId === p.id}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                    </button>
                    {menuId === p.id && (
                      <div className="pcard-menu" role="menu">
                        <button type="button" role="menuitem" className="pcard-menu-item danger" onClick={() => { setMenuId(null); removeProvider(p); }}>
                          Eliminar proveedor
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ucard-foot">
                  <span className={`pcard-badge ${n ? 'tone-green' : 'tone-slate'}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
                    {n === 0 ? 'Sin proyectos' : n === 1 ? '1 proyecto' : `${n} proyectos`}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
