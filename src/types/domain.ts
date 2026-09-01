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
