import { useEffect, useState } from 'react';
import { ProvidersApi } from '../lib/services';
import type { Provider } from '../types/domain';

export default function ProvidersPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setProviders(await ProvidersApi.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addProvider() {
    const name = newName.trim();
    if (!name) return;
    try {
      await ProvidersApi.create(name);
      setNewName('');
      load();
    } catch (err) {
      alert(`No se pudo agregar el proveedor: ${(err as Error).message}`);
    }
  }

  async function removeProvider(p: Provider) {
    if (!confirm(`¿Eliminar el proveedor "${p.name}"?`)) return;
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
        </div>
      </div>
      <p className="admin-hint">Nombres de proveedores externos que se pueden elegir al crear o editar un proyecto.</p>

      <div className="add-row">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addProvider()}
          placeholder="Nombre del proveedor…"
        />
        <button className="btn small" onClick={addProvider}>Agregar</button>
      </div>

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : providers.length === 0 ? (
        <div className="empty-state">No hay proveedores registrados todavía.</div>
      ) : (
        <div>
          {providers.map((p) => (
            <div className="account-row" key={p.id}>
              <div className="account-main">
                <div className="provider-name">{p.name}</div>
              </div>
              <div className="account-side">
                <button
                  className="del-btn"
                  title="Eliminar proveedor"
                  onClick={() => removeProvider(p)}
                  disabled={busyId === p.id}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
