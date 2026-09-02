export type UserRole = 'admin' | 'desarrollador' | 'cliente';
export type ProjectStatus = 'levantamiento' | 'desarrollo' | 'validacion' | 'cerrado';
export type ItemResponsible = 'cliente' | 'desarrollador';
export type MeetingState = 'programada' | 'reprogramada' | 'realizada' | 'no_realizada';

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
}

export interface ItemLog {
  id: string;
  text: string;
  authorEmail?: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  n: number;
  text: string;
  resp: ItemResponsible;
  percent: number;
  log: ItemLog[];
}

export interface Section {
  id: string;
  key: string;
  code: string;
  title: string;
  notes: string;
  orderIndex: number;
  items: ChecklistItem[];
}

export interface Stats {
  total: number;
  done: number;
  prog: number;
  pend: number;
  pct: number;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  proveedor: string;
  status: ProjectStatus;
  sections: Section[];
  stats?: Stats;
  createdAt: string;
  deliveryDate?: string | null;
  finalDeliveryDate?: string | null;
  delayDays?: number;
  finalObservation?: string | null;
}

export interface DailyNote {
  id: string;
  date: string;
  note: string;
  authorEmail?: string;
  createdAt: string;
  projectId: string;
}

export interface Provider {
  id: string;
  name: string;
}

export type PhaseKey =
  | 'levantamiento'
  | 'diseno'
  | 'implementacion'
  | 'testing'
  | 'entrega'
  | 'fin';

export interface ProjectPhase {
  id: string;
  projectId: string;
  key: PhaseKey;
  label: string;
  orderIndex: number;
  startDate: string | null;
  durationDays: number;
}

export interface Participant {
  id: string;
  label: string;
  email: string | null;
  signature: string | null;
  signedAt: string | null;
  signToken: string;
}

export interface Meeting {
  id: string;
  date: string;
  time: string;
  title: string;
  state: MeetingState;
  topics: string;
  agreements: string;
  risks: string;
  nextSteps: string;
  participants: Participant[];
  projectId: string;
  teamsJoinUrl: string | null;
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'status_change' | 'sign';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorEmail?: string;
  createdAt: string;
}

export const STATUS_META: Record<ProjectStatus, string> = {
  levantamiento: 'Levantamiento',
  desarrollo: 'En desarrollo',
  validacion: 'Validación',
  cerrado: 'Cerrado',
};

export const MEETING_STATE_META: Record<MeetingState, string> = {
  programada: 'Programada',
  reprogramada: 'Reprogramada',
  realizada: 'Realizada',
  no_realizada: 'No realizada',
};

export const RESP_LABEL: Record<ItemResponsible, string> = {
  cliente: 'Cliente',
  desarrollador: 'Desarrollador',
};

export const PERCENT_OPTIONS = [0, 10, 25, 40, 50, 60, 75, 90, 100];

export function bandOf(p: number): 'pendiente' | 'progreso' | 'completo' {
  return p === 0 ? 'pendiente' : p === 100 ? 'completo' : 'progreso';
}

// Fecha de fin calculada de una fase del roadmap (inicio + duración).
export function phaseEndDate(phase: Pick<ProjectPhase, 'startDate' | 'durationDays'> | undefined | null): string | null {
  if (!phase?.startDate) return null;
  const d = new Date(phase.startDate + 'T00:00:00');
  d.setDate(d.getDate() + phase.durationDays);
  return d.toISOString().slice(0, 10);
}

// Diferencia en días entre dos fechas ISO (b - a). Positivo si b es posterior a a.
export function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

export function computeItemStats(items: ChecklistItem[]): Stats {
  const total = items.length;
  const done = items.filter((i) => i.percent === 100).length;
  const prog = items.filter((i) => i.percent > 0 && i.percent < 100).length;
  const pend = items.filter((i) => i.percent === 0).length;
  const pct = total ? Math.round(items.reduce((a, i) => a + i.percent, 0) / total) : 0;
  return { total, done, prog, pend, pct };
}

export function computeProjectStats(project: Pick<Project, 'sections'>): Stats {
  const allItems = project.sections.flatMap((s) => s.items);
  return computeItemStats(allItems);
}
