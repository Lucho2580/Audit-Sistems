import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { ProvidersApi } from '../lib/services';
import type { Provider } from '../types/domain';
import { useAuth } from '../context/AuthContext';

export default function ToolsPage() {
  const { profile } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setProviders(await ProvidersApi.list());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (profile && profile.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  async function addProvider() {
    const name = newName.trim();
    if (!name) return;
    await ProvidersApi.create(name);
    setNewName('');
    load();
  }

  async function saveRename(p: Provider) {
    const name = (editing[p.id] ?? p.name).trim();
    if (!name || name === p.name) return;
    await ProvidersApi.rename(p.id, name);
    load();
  }

  async function removeProvider(p: Provider) {
    if (!confirm(`¿Eliminar el proveedor "${p.name}"?`)) return;
    await ProvidersApi.remove(p.id);
    load();
  }

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Solo administradores</p>
          <h1>Herramientas</h1>
          <p className="sub">Gestiona el catálogo de proveedores disponible al crear proyectos.</p>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="title-block">
            <span className="code-tag">PRV</span>
            <h2>Proveedores</h2>
          </div>
        </div>

        <div className="add-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProvider()}
            placeholder="Nombre del nuevo proveedor…"
          />
          <button className="btn small" onClick={addProvider}>Agregar</button>
        </div>

        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : providers.length === 0 ? (
          <div className="empty-state">No hay proveedores registrados todavía.</div>
        ) : (
          <ul className="items">
            {providers.map((p) => (
              <li className="item-block" key={p.id}>
                <div className="item">
                  <input
                    type="text"
                    value={editing[p.id] ?? p.name}
                    onChange={(e) => setEditing((s) => ({ ...s, [p.id]: e.target.value }))}
                    onBlur={() => saveRename(p)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--hairline)' }}
                  />
                  <button className="del-btn" title="Eliminar proveedor" onClick={() => removeProvider(p)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
