import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { useSidebarStats } from '../context/ShellChromeContext';
import { AuditApi } from '../lib/services';
import type { AuditLogEntry } from '../types/domain';

type TimelineEntry = AuditLogEntry & { projectId: string | null; projectName: string | null };

const MONTH_LABELS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAY_LABELS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const pad2 = (n: number) => String(n).padStart(2, '0');

const ACTION_LABEL: Record<AuditLogEntry['action'], string> = {
  create: 'Creación',
  update: 'Actualización',
  delete: 'Eliminación',
  status_change: 'Cambio de estado',
  sign: 'Firma',
};

function isoDate(dateStr: string) {
  return dateStr.slice(0, 10);
}

export default function TimelinePage() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    AuditApi.all()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const day = isoDate(e.createdAt);
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
    return map;
  }, [entries]);

  useSidebarStats(
    useMemo(() => {
      const todayStr = isoDate(new Date().toISOString());
      const projectsWithActivity = new Set(entries.map((e) => e.projectId).filter(Boolean)).size;
      const todayCount = entries.filter((e) => isoDate(e.createdAt) === todayStr).length;
      return {
        title: 'Actividad',
        items: [
          { label: 'Movimientos', value: String(entries.length), note: 'en el historial' },
          { label: 'Hoy', value: String(todayCount), note: 'movimientos' },
          { label: 'Proyectos', value: String(projectsWithActivity), note: 'con actividad' },
        ],
      };
    }, [entries]),
  );

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const totalDays = new Date(y, m + 1, 0).getDate();
  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const trailing = (7 - ((startOffset + totalDays) % 7)) % 7;

  const cells = useMemo(() => {
    const arr: { day: number | null; date: string | null }[] = [];
    for (let i = 0; i < startOffset; i++) arr.push({ day: null, date: null });
    for (let d = 1; d <= totalDays; d++) arr.push({ day: d, date: `${y}-${pad2(m + 1)}-${pad2(d)}` });
    for (let i = 0; i < trailing; i++) arr.push({ day: null, date: null });
    return arr;
  }, [y, m, totalDays, startOffset, trailing]);

  const visible = (selectedDay ? entries.filter((e) => isoDate(e.createdAt) === selectedDay) : entries)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell>
      <div className="masthead">
        <div>
          <p className="eyebrow">Actividad global</p>
          <h1>Línea de tiempo</h1>
        </div>
        <p className="intro">
          Calendario y línea de tiempo de la actividad registrada en todos los proyectos, a partir
          del historial de auditoría.
        </p>
      </div>

      <div className="toolbar">
        <div className="filters">
          <div className="view-tabs">
            <button className={`view-tab ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
              Calendario
            </button>
            <button className={`view-tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
              Línea de tiempo
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Cargando…</div>
      ) : (
        <>
          {view === 'calendar' && (
            <div className="section">
              <div className="cal-header">
                <div className="cal-nav">
                  <button className="cal-nav-btn" onClick={() => setCalMonth(new Date(y, m - 1, 1))}>‹</button>
                  <span className="cal-month-label">{MONTH_LABELS[m]} {y}</span>
                  <button className="cal-nav-btn" onClick={() => setCalMonth(new Date(y, m + 1, 1))}>›</button>
                </div>
              </div>
              <div className="cal-grid">
                {DAY_LABELS.map((l) => (
                  <div className="cal-daylabel" key={l}>{l}</div>
                ))}
                {cells.map((c, idx) => {
                  if (c.date === null) return <div className="cal-day empty" key={idx} />;
                  const dayEntries = entriesByDay.get(c.date) ?? [];
                  return (
                    <div
                      key={c.date}
                      className={`cal-day ${selectedDay === c.date ? 'selected' : ''}`}
                      onClick={() => setSelectedDay((prev) => (prev === c.date ? null : c.date))}
                    >
                      <span className="daynum">{c.day}</span>
                      {dayEntries.length > 0 && <span className="cal-count">{dayEntries.length}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="section">
            <div className="section-head">
              <div className="title-block">
                <span className="code-tag">LOG</span>
                <h2>{selectedDay ? `Actividad del ${selectedDay}` : 'Actividad reciente'}</h2>
              </div>
              {selectedDay && (
                <button className="btn ghost small" onClick={() => setSelectedDay(null)}>Ver todo</button>
              )}
            </div>
            {visible.length === 0 ? (
              <div className="empty-state">Sin movimientos registrados todavía.</div>
            ) : (
              <div className="audit-panel">
                {visible.map((e) => (
                  <div className="audit-row" key={e.id}>
                    <span className="audit-date">
                      {new Date(e.createdAt).toLocaleString('es-ES', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <span className="audit-action">{ACTION_LABEL[e.action]}</span>
                    <span className="audit-desc">{e.projectName ?? 'Proyecto eliminado'}</span>
                    <span className="audit-actor">{e.actorEmail ?? 'enlace público'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
