import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Permite que cada página "reporte" sus estadísticas y su acción de mostrar/
// ocultar dashboard hacia AppShell, que las pinta en la barra lateral (igual
// que el mockup). Así cada página sigue dueña de su propia carga de datos —
// esto solo transporta números/handlers ya calculados hacia el sidebar.
export interface SidebarStatItem {
  label: string;
  value: string;
  note: string;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export interface SidebarPanel {
  title: string;
  items: SidebarStatItem[];
}

export interface DashboardToggleState {
  active: boolean;
  onToggle: () => void;
}

interface ShellChromeContextValue {
  panel: SidebarPanel | null;
  setPanel: (panel: SidebarPanel | null) => void;
  dashboardToggle: DashboardToggleState | null;
  setDashboardToggle: (state: DashboardToggleState | null) => void;
}

const ShellChromeContext = createContext<ShellChromeContextValue | undefined>(undefined);

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<SidebarPanel | null>(null);
  const [dashboardToggle, setDashboardToggle] = useState<DashboardToggleState | null>(null);
  const value = useMemo(
    () => ({ panel, setPanel, dashboardToggle, setDashboardToggle }),
    [panel, dashboardToggle],
  );
  return <ShellChromeContext.Provider value={value}>{children}</ShellChromeContext.Provider>;
}

function useShellChrome() {
  const ctx = useContext(ShellChromeContext);
  if (!ctx) throw new Error('useShellChrome debe usarse dentro de <ShellChromeProvider>');
  return ctx;
}

export function useSidebarPanel() {
  return useShellChrome();
}

// Hook de conveniencia: registra (y limpia al desmontar) el panel de
// estadísticas de la página actual en la barra lateral.
export function useSidebarStats(panel: SidebarPanel | null) {
  const { setPanel } = useShellChrome();
  useEffect(() => {
    setPanel(panel);
    return () => setPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
}

// Hook de conveniencia: registra (y limpia al desmontar) el botón de
// mostrar/ocultar dashboard en la barra lateral.
export function useDashboardToggle(state: DashboardToggleState | null) {
  const { setDashboardToggle } = useShellChrome();
  useEffect(() => {
    setDashboardToggle(state);
    return () => setDashboardToggle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}
