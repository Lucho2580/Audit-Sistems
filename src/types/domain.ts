export type UserRole = 'superadmin' | 'admin' | 'desarrollador' | 'cliente' | 'qa';
export type ProjectStatus = 'levantamiento' | 'desarrollo' | 'validacion' | 'cerrado';
export type MeetingState = 'programada' | 'reprogramada' | 'realizada' | 'no_realizada';

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  mustChangePassword?: boolean;
}

// Versión ligera de un profile, usada por los pickers de asignación de
// actores (jefe/responsable/proveedor) y por la administración de usuarios.
export interface ProfileLite {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  mustChangePassword?: boolean;
}

// Cuenta invitada por un admin que todavía no ha iniciado sesión con
// Microsoft ni una sola vez -- ver pending_invites/provision_profile_from_invite.
export interface PendingInvite {
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
}

// Forma compartida por los actores del proyecto que pueden ser varios
// (jefes, clientes) -- a diferencia de responsable/proveedor, que son un
// solo actor.
export interface ProjectPerson {
  id: string;
  nombre: string;
}

export const ACTOR_ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Jefe de proyecto',
  desarrollador: 'Persona asignada',
  cliente: 'Cliente',
  qa: 'QA',
};

export interface ItemLog {
  id: string;
  text: string;
  authorEmail?: string;
  createdAt: string;
  qaApproved: boolean;
  qaApprovedByNombre: string | null;
  qaApprovedAt: string | null;
  qaRejectedAt: string | null;
  qaRejectedByNombre: string | null;
  qaRejectionReason: string | null;
}

export interface ChecklistItem {
  id: string;
  n: number;
  text: string;
  assignedTo: string | null;
  assignedToNombre: string | null;
  dueDate: string | null;
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
  // Resumen liviano del % de avance de cada una de las 6 fases -- para
  // mostrar el desglose por fase en el listado general de proyectos sin
  // tener que entrar al detalle de cada uno.
  phases: ProjectPhaseSummary[];
  createdAt: string;
  startDate: string | null;
  deadlineDate: string | null;
  deliveryDate?: string | null;
  finalDeliveryDate?: string | null;
  delayDays?: number;
  finalObservation?: string | null;
  jefes: ProjectPerson[];
  responsableId: string | null;
  responsableNombre: string | null;
  proveedorId: string | null;
  clientes: ProjectPerson[];
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

export type QaStatus = 'pendiente' | 'en_revision' | 'aprobada';

export const QA_STATUS_META: Record<QaStatus, string> = {
  pendiente: 'Pendiente de aprobación',
  en_revision: 'En revisión de QA',
  aprobada: 'Aprobada por QA',
};

export interface ProjectPhase {
  id: string;
  projectId: string;
  key: PhaseKey;
  label: string;
  orderIndex: number;
  startDate: string | null;
  durationDays: number;
  percent: number;
  qaStatus: QaStatus;
  qaSubmittedAt: string | null;
  qaApprovedBy: string | null;
  qaApprovedAt: string | null;
}

export interface ProjectPhaseSummary {
  key: PhaseKey;
  label: string;
  orderIndex: number;
  percent: number;
}

// Cada tarea de una fase tiene su propio responsable (persona puntual, no
// el "cliente"/"desarrollador" binario de los checklist_items), fechas y
// avance -- es lo que llena la tabla por hito (fase) del punto 2, y lo que
// alimenta el cálculo de atraso (punto 4).
export interface PhaseTask {
  id: string;
  phaseId: string;
  projectId: string;
  text: string;
  assignedTo: string | null;
  assignedToNombre: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  percent: number;
  observaciones: string | null;
}

// Tres estados de plazo: completada, a tiempo o atrasada (ya no hay un
// "en riesgo" intermedio).
export type DelayStatus = 'completado' | 'en_tiempo' | 'atrasado';

export const DELAY_STATUS_META: Record<DelayStatus, string> = {
  completado: 'Completada',
  en_tiempo: 'A tiempo',
  atrasado: 'Atrasada',
};

// Avance esperado = cuánto debería llevar según el tiempo ya transcurrido de
// la duración planeada. Sin fechas, o antes de la fecha de inicio, no hay
// brecha que calcular todavía (queda en 0).
export function taskExpectedPct(
  task: Pick<PhaseTask, 'startDate' | 'plannedEndDate'>,
  today: Date = new Date(),
): number | null {
  if (!task.startDate || !task.plannedEndDate) return null;
  const todayStr = today.toISOString().slice(0, 10);
  if (todayStr < task.startDate) return 0;
  const totalDays = Math.max(1, daysBetween(task.startDate, task.plannedEndDate));
  const elapsedDays = Math.max(0, daysBetween(task.startDate, todayStr));
  return Math.min(100, (elapsedDays / totalDays) * 100);
}

// Brecha = esperado - real, con 5 puntos de tolerancia: hasta 5 por debajo
// de lo esperado sigue "a tiempo"; más que eso, "atrasada". Sin fechas, no
// hay forma de calcular atraso (queda "en_tiempo" por defecto).
export function taskDelayStatus(
  task: Pick<PhaseTask, 'percent' | 'startDate' | 'plannedEndDate'>,
  today: Date = new Date(),
): DelayStatus {
  if (task.percent >= 100) return 'completado';
  const expectedPct = taskExpectedPct(task, today);
  if (expectedPct === null) return 'en_tiempo';
  const gap = expectedPct - task.percent;
  return gap <= 5 ? 'en_tiempo' : 'atrasado';
}

export function worstDelayStatus(statuses: DelayStatus[]): DelayStatus {
  if (statuses.some((s) => s === 'atrasado')) return 'atrasado';
  if (statuses.length > 0 && statuses.every((s) => s === 'completado')) return 'completado';
  return 'en_tiempo';
}

export interface Participant {
  id: string;
  label: string;
  email: string | null;
  signature: string | null;
  signedAt: string | null;
  attended: boolean;
}

// Cada compromiso trae su propio responsable y fecha límite -- así la tabla
// de "Compromisos" del acta los muestra de verdad, en vez de "—" (antes era
// una sola línea de texto libre, sin esos dos datos).
export interface Compromiso {
  text: string;
  responsable: string | null;
  fechaLimite: string | null;
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
  compromisos: Compromiso[];
  participants: Participant[];
  projectId: string;
  teamsJoinUrl: string | null;
  modalidad: string;
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

export const PERCENT_OPTIONS = [0, 10, 25, 40, 50, 60, 75, 90, 100];

export function bandOf(p: number): 'pendiente' | 'progreso' | 'completo' {
  return p === 0 ? 'pendiente' : p === 100 ? 'completo' : 'progreso';
}

export function phaseEndDate(phase: Pick<ProjectPhase, 'startDate' | 'durationDays'> | undefined | null): string | null {
  if (!phase?.startDate) return null;
  const d = new Date(phase.startDate + 'T00:00:00');
  d.setDate(d.getDate() + phase.durationDays);
  return d.toISOString().slice(0, 10);
}

// Positivo si b es posterior a a (resta b - a, no a - b).
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

// Avance de cada sección del proyecto (Ficha técnica, Flujo de procesos...),
// con el mismo criterio que computeProjectStats -- promedio del % de sus
// checkpoints, que a su vez sale de los reportes aprobados por QA -- para
// que el desglose y el "avance real" del proyecto nunca muestren cifras
// que no cuadran entre sí.
export interface SectionProgress {
  id: string;
  code: string;
  title: string;
  pct: number;
  total: number;
  done: number;
}

export function computeSectionProgress(sections: Section[]): SectionProgress[] {
  return sections
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => {
      const st = computeItemStats(s.items);
      return { id: s.id, code: s.code, title: s.title, pct: st.pct, total: st.total, done: st.done };
    });
}

// ---- Informe semanal de avance ---------------------------------------------

export interface WeeklyProgressEntry {
  id: string;
  projectId: string;
  weekStart: string; // fecha ISO del lunes de esa semana
  percentAvanzado: number;
  note: string;
  submittedAt: string;
}

export type MilestoneReportStatus = 'cumplido' | 'en_curso' | 'sin_avance';

// Línea de un reporte semanal: un hito (checkpoint con fecha) y lo que la
// persona asignada reportó de él esa semana.
export interface WeeklyMilestoneLine {
  code: string;
  title: string;
  dueDate: string;
  status: MilestoneReportStatus;
  note: string | null;
  late: boolean; // venció en una semana anterior (se reportó como atrasado)
  qa: 'aprobado' | 'rechazado' | 'pendiente' | null;
  qaReason: string | null;
}

export interface WeeklyProgressWeek {
  weekStart: string;
  status: 'reportado' | 'perdida' | 'en_curso';
  percentAvanzado: number | null;
  note: string | null;
  submittedAt: string | null;
  milestonesTotal: number;
  milestonesDone: number;
  milestonesApproved: number;
  items: WeeklyMilestoneLine[];
}

// Formulario del reporte de la semana en curso (get_weekly_report_form).
export interface WeeklyReportFormItem {
  itemId: string;
  code: string;
  title: string;
  dueDate: string;
  approved?: boolean; // ya aprobado por QA: no se pide de nuevo
  pendingQa?: boolean; // reportado cumplido en otro reporte, esperando a QA
  daysLate?: number;
  status: MilestoneReportStatus | null;
  note: string | null;
}

export interface WeeklyReportForm {
  weekStart: string;
  weekEnd: string;
  deadline: string;
  isOpen: boolean;
  submittedAt: string | null;
  note: string;
  weekItems: WeeklyReportFormItem[];
  overdueItems: WeeklyReportFormItem[];
  nextItems: { code: string; title: string; dueDate: string }[];
  undatedCount: number;
}

export interface WeeklyProgressDetail {
  indicator: number;
  weeksTracked: number;
  weeksReported: number;
  weeksMissed: number;
  penaltyPerWeek: number;
  weeksRemainingYear: number;
  frozen: boolean;
  weeks: WeeklyProgressWeek[];
}

export interface WeeklyProgressOverviewRow {
  projectId: string;
  code: string;
  name: string;
  status: ProjectStatus;
  responsableNombre: string | null;
  indicator: number;
  currentWeekStart: string;
  currentWeekSubmitted: boolean;
  currentWeekDeadline: string;
  weekMilestonesTotal: number;
  weekMilestonesDone: number;
  overdueCount: number;
  undatedCount: number;
  nextDueDate: string | null;
  nextDueCode: string | null;
}

const BOGOTA_OFFSET_MS = 5 * 3600000; // Colombia: UTC-5 todo el año, sin horario de verano.

// Ventana de la semana en curso (lunes a sábado 12:00pm, hora Bogotá), para
// mostrar el estado en pantalla. La validación real de la ventana siempre la
// hace el servidor (submit_weekly_progress) -- esto es solo para la UI.
export function currentWeekWindow(now: Date = new Date()): { weekStart: string; deadline: Date; isOpen: boolean } {
  const bogotaNow = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const dayOfWeek = bogotaNow.getUTCDay(); // 0=domingo … 6=sábado
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const mondayBogotaMidnightUTC = Date.UTC(
    bogotaNow.getUTCFullYear(), bogotaNow.getUTCMonth(), bogotaNow.getUTCDate() - daysSinceMonday,
  );
  const weekStart = new Date(mondayBogotaMidnightUTC).toISOString().slice(0, 10);
  // Sábado 12:00pm hora Bogotá = lunes + 5 días + 12h, reconvertido a UTC real.
  const deadline = new Date(mondayBogotaMidnightUTC + 5 * 86400000 + 12 * 3600000 + BOGOTA_OFFSET_MS);
  return { weekStart, deadline, isOpen: now.getTime() <= deadline.getTime() };
}
