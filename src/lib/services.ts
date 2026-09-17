import { supabase } from './supabase';
import { SITE_URL } from './site';
import { computeProjectStats } from '../types/domain';
import type {
  Project, Meeting, AuditLogEntry, ItemResponsible, ProjectStatus, MeetingState,
  Provider, ProjectPhase, DailyNote, ProfileLite, UserRole, Compromiso,
  WeeklyProgressEntry, WeeklyProgressOverviewRow, WeeklyProgressDetail,
} from '../types/domain';

const PROJECT_SELECT = `
  id, code, name, proveedor, status, createdAt:created_at,
  deliveryDate:delivery_date, finalDeliveryDate:final_delivery_date,
  delayDays:delay_days, finalObservation:final_observation,
  jefes:project_jefes ( id:jefe_id, nombre:jefe_nombre ),
  responsableId:responsable_id, responsableNombre:responsable_nombre,
  proveedorId:proveedor_id,
  clientes:project_clients ( id:cliente_id, nombre:cliente_nombre ),
  sections (
    id, key, code, title, notes, orderIndex:order_index,
    items:checklist_items (
      id, n, text, resp, percent,
      log:item_logs ( id, text, authorEmail:author_email, createdAt:created_at )
    )
  )
`;

// OJO: sign_token es la credencial de firma pública de cada participante (quien la
// tenga puede firmar en su nombre vía /sign/:token). Por eso NO se incluye aquí, en la
// consulta general que ve cualquiera con acceso a la reunión — se obtiene aparte, uno
// por uno y solo bajo demanda, con MeetingsApi.getSignLink().
const MEETING_SELECT = `
  id, date, time, title, state, topics, agreements, risks, compromisos, projectId:project_id,
  teamsJoinUrl:teams_join_url, modalidad,
  participants ( id, label, email, signature, signedAt:signed_at, attended )
`;

function normalizeProject(project: Project): Project {
  const sections = [...project.sections]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => ({ ...s, items: [...s.items].sort((a, b) => a.n - b.n) }));
  return { ...project, sections, stats: computeProjectStats({ sections }) };
}

function throwIfError<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// supabase.functions.invoke() da un error genérico ("Edge Function returned
// a non-2xx status code"); el mensaje real que mandó nuestra función viene
// en el body JSON de la respuesta (error.context), como { error: "..." }.
async function extractFunctionErrorMessage(ctx: Response): Promise<string | null> {
  try {
    const body = await ctx.clone().json();
    const msg = body?.error ?? body?.message ?? body?.msg;
    if (msg) return `[${ctx.status}] ${msg}`;
  } catch {
    // el body no era JSON
  }
  try {
    const text = await ctx.clone().text();
    if (text) return `[${ctx.status}] ${text}`;
  } catch {
    // tampoco se pudo leer como texto
  }
  return null;
}

async function throwFunctionError(error: unknown): Promise<never> {
  const ctx = (error as { context?: Response }).context;
  const detail = ctx && typeof ctx.clone === 'function' ? await extractFunctionErrorMessage(ctx) : null;
  throw new Error(detail ?? (error as Error)?.message ?? 'Error desconocido llamando a la función.');
}

export const ProjectsApi = {
  async list(): Promise<Project[]> {
    const res = await supabase
      .from('projects')
      .select(PROJECT_SELECT)
      .order('created_at', { ascending: false });
    const data = throwIfError<Project[]>(res as any);
    return data.map(normalizeProject);
  },

  async get(id: string): Promise<Project> {
    const res = await supabase
      .from('projects')
      .select(PROJECT_SELECT)
      .eq('id', id)
      .single();
    const data = throwIfError<Project>(res as any);
    return normalizeProject(data);
  },

  async create(payload: { name: string; proveedor: string }): Promise<{ id: string }> {
    const res = await supabase.rpc('create_project', {
      p_name: payload.name, p_proveedor: payload.proveedor,
    });
    return throwIfError<{ id: string }>(res as any);
  },

  // Asigna/reasigna responsable/proveedor. Se llama justo después de
  // create() -- mismo patrón de dos pasos que ya usa MeetingsApi.create() ->
  // createTeamsMeeting(). Jefes y clientes (puede haber varios de cada uno)
  // se manejan aparte con add/removeJefe() y add/removeClient().
  async setActors(
    projectId: string,
    payload: { responsableId: string; proveedorId: string },
  ): Promise<void> {
    const res = await supabase.rpc('set_project_actors', {
      p_project_id: projectId,
      p_responsable_id: payload.responsableId,
      p_proveedor_id: payload.proveedorId,
    });
    throwIfError(res as any);
  },

  async addJefe(projectId: string, jefeId: string): Promise<void> {
    const res = await supabase.rpc('add_project_jefe', { p_project_id: projectId, p_jefe_id: jefeId });
    throwIfError(res as any);
  },

  async removeJefe(projectId: string, jefeId: string): Promise<void> {
    const res = await supabase.rpc('remove_project_jefe', { p_project_id: projectId, p_jefe_id: jefeId });
    throwIfError(res as any);
  },

  async addClient(projectId: string, clienteId: string): Promise<void> {
    const res = await supabase.rpc('add_project_client', { p_project_id: projectId, p_cliente_id: clienteId });
    throwIfError(res as any);
  },

  async removeClient(projectId: string, clienteId: string): Promise<void> {
    const res = await supabase.rpc('remove_project_client', { p_project_id: projectId, p_cliente_id: clienteId });
    throwIfError(res as any);
  },

  async updateStatus(id: string, status: ProjectStatus) {
    const res = await supabase.from('projects').update({ status }).eq('id', id);
    throwIfError(res as any);
  },

  async deleteProject(id: string) {
    const res = await supabase.from('projects').delete().eq('id', id);
    throwIfError(res as any);
  },

  async updateDelivery(
    id: string,
    payload: {
      deliveryDate: string | null;
      finalDeliveryDate: string | null;
      delayDays: number;
      finalObservation: string | null;
    },
  ) {
    const res = await supabase.rpc('set_project_delivery', {
      p_project_id: id,
      p_delivery_date: payload.deliveryDate,
      p_final_delivery_date: payload.finalDeliveryDate,
      p_delay_days: payload.delayDays,
      p_final_observation: payload.finalObservation,
    });
    throwIfError(res as any);
  },

  async updateSectionNotes(sectionId: string, notes: string) {
    const res = await supabase.from('sections').update({ notes }).eq('id', sectionId);
    throwIfError(res as any);
  },

  async addItem(sectionId: string, payload: { text: string; resp: ItemResponsible }) {
    const res = await supabase
      .from('checklist_items')
      .insert({ text: payload.text, resp: payload.resp, section_id: sectionId })
      .select()
      .single();
    return throwIfError(res as any);
  },

  async updateItemPercent(itemId: string, percent: number, note?: string) {
    const res = await supabase.rpc('set_item_percent', {
      p_item_id: itemId, p_new_percent: percent, p_note: note ?? null,
    });
    return throwIfError(res as any);
  },

  async toggleResp(itemId: string, current: ItemResponsible) {
    const next: ItemResponsible = current === 'cliente' ? 'desarrollador' : 'cliente';
    const res = await supabase.from('checklist_items').update({ resp: next }).eq('id', itemId);
    throwIfError(res as any);
    return next;
  },

  async deleteItem(itemId: string) {
    const res = await supabase.from('checklist_items').delete().eq('id', itemId);
    throwIfError(res as any);
  },

  async addItemLog(itemId: string, text: string) {
    const res = await supabase.from('item_logs').insert({ text, item_id: itemId });
    throwIfError(res as any);
  },

  async deleteItemLog(logId: string) {
    const res = await supabase.from('item_logs').delete().eq('id', logId);
    throwIfError(res as any);
  },
};

export interface SignStatus {
  label: string;
  alreadySigned: boolean;
  expired: boolean;
  projectName: string;
  projectCode: string;
  meetingTitle: string;
  meetingDate: string;
  topics: string;
  agreements: string;
  risks: string;
  compromisos: Compromiso[];
}

export const MeetingsApi = {
  async listByProject(projectId: string): Promise<Meeting[]> {
    const res = await supabase
      .from('meetings')
      .select(MEETING_SELECT)
      .eq('project_id', projectId)
      .order('date', { ascending: true })
      .order('time', { ascending: true });
    return throwIfError<Meeting[]>(res as any);
  },

  async create(
    projectId: string,
    payload: {
      date: string; time: string; title: string;
      participants: { label: string; email: string }[];
      modalidad?: string;
    },
  ): Promise<{ id: string }> {
    const res = await supabase.rpc('create_meeting', {
      p_project_id: projectId, p_date: payload.date, p_time: payload.time,
      p_title: payload.title, p_participants: payload.participants,
      p_modalidad: payload.modalidad ?? 'Microsoft Teams',
    });
    return throwIfError<{ id: string }>(res as any);
  },

  // Se llama después de create() para generar la reunión de Teams (Microsoft
  // Graph) e invitar a los mismos participantes; guarda el join link en la
  // reunión.
  async createTeamsMeeting(meetingId: string): Promise<{ joinUrl: string | null }> {
    const { data, error } = await supabase.functions.invoke<{ joinUrl: string | null }>(
      'create-teams-meeting',
      { body: { meetingId } },
    );
    if (error) await throwFunctionError(error);
    return data!;
  },

  async updateDoc(
    meetingId: string,
    payload: Partial<{ topics: string; agreements: string; risks: string; compromisos: Compromiso[] }>,
  ) {
    const res = await supabase
      .from('meetings')
      .update({
        topics: payload.topics, agreements: payload.agreements,
        risks: payload.risks, compromisos: payload.compromisos,
      })
      .eq('id', meetingId)
      .select(MEETING_SELECT)
      .single();
    return throwIfError<Meeting>(res as any);
  },

  async updateState(meetingId: string, state: MeetingState) {
    const res = await supabase.from('meetings').update({ state }).eq('id', meetingId);
    throwIfError(res as any);
  },

  // Se llama después de updateState(meetingId, 'realizada') para mandar por
  // correo (Microsoft Graph) el enlace de firma a cada participante.
  async notifySignatures(meetingId: string): Promise<{ sent: number; skipped: number; failed: string[] }> {
    const { data, error } = await supabase.functions.invoke('send-signature-links', {
      body: { meetingId },
    });
    if (error) await throwFunctionError(error);
    return data;
  },

  async signByToken(signToken: string, signature: string) {
    const res = await supabase.rpc('sign_participant', { p_token: signToken, p_signature: signature });
    return throwIfError(res as any);
  },

  // Avisa a la persona asignada del proyecto que alguien ya firmó -- se
  // llama justo después de signByToken() desde SignPage.tsx. Es una función
  // pública (identifica al firmante por el mismo token de firma, no por
  // sesión), así que un fallo no debe romper la confirmación de firma que ya
  // ves en pantalla.
  async notifySignatureCompleted(signToken: string): Promise<void> {
    await supabase.functions.invoke('notify-signature', { body: { token: signToken } });
  },

  // El token trae el contenido del acta (no solo label/already_signed) para
  // que quien va a firmar pueda leer el documento antes de hacerlo, en vez
  // de un formulario ciego.
  async getSignStatus(signToken: string): Promise<SignStatus | null> {
    const res = await supabase.rpc('get_sign_status', { p_token: signToken });
    const rows = throwIfError<{
      label: string; already_signed: boolean; expired: boolean;
      project_name: string; project_code: string;
      meeting_title: string; meeting_date: string;
      topics: string; agreements: string; risks: string; compromisos: Compromiso[] | null;
    }[]>(res as any);
    const row = rows?.[0];
    if (!row) return null;
    return {
      label: row.label, alreadySigned: row.already_signed, expired: row.expired,
      projectName: row.project_name, projectCode: row.project_code,
      meetingTitle: row.meeting_title, meetingDate: row.meeting_date,
      topics: row.topics, agreements: row.agreements, risks: row.risks, compromisos: row.compromisos ?? [],
    };
  },

  // Trae el sign_token de un solo participante bajo demanda (para el botón "copiar
  // enlace"), en vez de traer los de todos los participantes en cada carga de la
  // reunión. La función RPC debe validar en el servidor que quien llama tiene permiso
  // (admin/desarrollador) sobre el proyecto de esa reunión antes de devolver el token.
  async getSignLink(participantId: string): Promise<string> {
    const res = await supabase.rpc('get_sign_link', { p_participant_id: participantId });
    const token = throwIfError<string>(res as any);
    return `${SITE_URL}/sign/${token}`;
  },

  // Para el portal de clientes: el propio cliente autenticado obtiene su
  // enlace de firma por email (sin depender de get_sign_link, exclusiva de
  // staff), validado en el servidor contra el proyecto del que es cliente.
  async getMySignLink(meetingId: string): Promise<string> {
    const res = await supabase.rpc('get_my_sign_link', { p_meeting_id: meetingId });
    const token = throwIfError<string>(res as any);
    return `${SITE_URL}/sign/${token}`;
  },

  async addParticipant(meetingId: string, label: string, email: string) {
    const res = await supabase.from('participants').insert({ label, email, meeting_id: meetingId });
    throwIfError(res as any);
  },

  async removeParticipant(participantId: string) {
    const res = await supabase.from('participants').delete().eq('id', participantId);
    throwIfError(res as any);
  },

  async setAttendance(participantId: string, attended: boolean) {
    const res = await supabase.rpc('set_participant_attendance', {
      p_participant_id: participantId, p_attended: attended,
    });
    throwIfError(res as any);
  },

  async deleteMeeting(meetingId: string) {
    const res = await supabase.from('meetings').delete().eq('id', meetingId);
    throwIfError(res as any);
  },
};

// Bucket privado "actas" (Storage): el PDF queda guardado en
// "{projectId}/{meetingId}.pdf" cada vez que se genera desde
// MeetingsCalendar -- así el cliente puede descargar el documento real
// desde su portal en vez de solo ver los campos de texto. RLS en
// storage.objects reusa can_view_project() sobre el primer segmento del
// path (ver migración 2026091104_actas_storage.sql).
export const ActasApi = {
  async upload(projectId: string, meetingId: string, file: Blob): Promise<void> {
    const path = `${projectId}/${meetingId}.pdf`;
    const { error } = await supabase.storage
      .from('actas')
      .upload(path, file, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(error.message);
  },

  // null si el acta todavía no se ha generado para esa reunión (o si no
  // tienes acceso) -- no es un error, solo "no hay nada que descargar".
  async getUrl(projectId: string, meetingId: string): Promise<string | null> {
    const path = `${projectId}/${meetingId}.pdf`;
    const { data, error } = await supabase.storage.from('actas').createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },
};

export const DailyNotesApi = {
  async listByProject(projectId: string): Promise<DailyNote[]> {
    const res = await supabase
      .from('daily_notes')
      .select('id, date, note, authorEmail:author_email, createdAt:created_at, projectId:project_id')
      .eq('project_id', projectId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    return throwIfError<DailyNote[]>(res as any);
  },

  async create(projectId: string, date: string, note: string) {
    const res = await supabase.from('daily_notes').insert({ project_id: projectId, date, note });
    throwIfError(res as any);
  },

  async remove(id: string) {
    const res = await supabase.from('daily_notes').delete().eq('id', id);
    throwIfError(res as any);
  },
};

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
}

export const DirectoryApi = {
  async search(query: string): Promise<DirectoryUser[]> {
    const { data, error } = await supabase.functions.invoke<{ users: DirectoryUser[] }>(
      'entra-search-users',
      { body: { q: query } },
    );
    if (error) await throwFunctionError(error);
    return data?.users ?? [];
  },
};

export const AuditApi = {
  async byProject(projectId: string): Promise<AuditLogEntry[]> {
    const res = await supabase
      .from('audit_log')
      .select('id, entityType:entity_type, entityId:entity_id, action, before, after, actorEmail:actor_email, createdAt:created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    return throwIfError<AuditLogEntry[]>(res as any);
  },

  // Historial global (todos los proyectos) para la vista de Timeline.
  // Trae también el nombre/código del proyecto para poder agrupar por día.
  async all(limit = 500): Promise<(AuditLogEntry & { projectId: string | null; projectName: string | null })[]> {
    const res = await supabase
      .from('audit_log')
      .select(
        'id, entityType:entity_type, entityId:entity_id, action, before, after, ' +
          'actorEmail:actor_email, createdAt:created_at, projectId:project_id, ' +
          'project:projects(name)',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    const rows = throwIfError<any[]>(res as any);
    return rows.map((r) => ({ ...r, projectName: r.project?.name ?? null }));
  },
};

// MyOffice queda como el único proveedor interno (sin cuenta, sin selector
// en la UI) -- este API solo se usa para resolver su id automáticamente al
// crear/editar un proyecto (ver ProjectsList.tsx).
export const ProvidersApi = {
  async list(): Promise<Provider[]> {
    const res = await supabase.from('providers').select('id, name').order('name', { ascending: true });
    return throwIfError<Provider[]>(res as any);
  },
};

// Directorio interno de esta app (profiles reales), usado por los pickers de
// asignación de actores y por la administración de usuarios. NO confundir con
// DirectoryApi, que busca en el directorio externo de Microsoft Entra ID para
// participantes de reuniones.
export const ProfilesApi = {
  async searchByRole(role: UserRole, query: string, limit = 20): Promise<ProfileLite[]> {
    const res = await supabase.rpc('search_profiles_by_role', {
      p_role: role, p_q: query, p_limit: limit,
    });
    const rows = throwIfError<{ id: string; email: string; full_name: string | null; must_change_password: boolean }[]>(res as any);
    return rows.map((r) => ({
      id: r.id, email: r.email, fullName: r.full_name, role, mustChangePassword: r.must_change_password,
    }));
  },

  async getMany(ids: string[]): Promise<ProfileLite[]> {
    if (!ids.length) return [];
    const res = await supabase.rpc('get_profiles', { p_ids: ids });
    const rows = throwIfError<{ id: string; email: string; full_name: string | null; role: UserRole }[]>(res as any);
    return rows.map((r) => ({ id: r.id, email: r.email, fullName: r.full_name, role: r.role }));
  },

  // Resuelve varios correos de una sola vez contra cuentas reales de un rol
  // dado -- lo usa la importación masiva de proyectos para validar cada
  // columna (jefes/persona asignada/clientes) sin un viaje por celda.
  async findByEmail(emails: string[], role: UserRole): Promise<ProfileLite[]> {
    if (!emails.length) return [];
    const res = await supabase.rpc('find_profiles_by_email', { p_emails: emails, p_role: role });
    const rows = throwIfError<{ email: string; id: string; full_name: string | null }[]>(res as any);
    return rows.map((r) => ({ id: r.id, email: r.email, fullName: r.full_name, role }));
  },
};

export interface AdminCreatedUser {
  id: string;
  email: string;
  tempPassword: string;
  emailSent: boolean;
  emailError?: string;
}

// Crea/edita/borra cuentas de "Persona asignada" (desarrollador) y, si quien
// llama es superadmin, también cuentas admin ("Jefe de proyecto") -- sin
// pasar por el signUp público (que exige confirmar por correo). Llama a la
// Edge Function admin-manage-user, que usa la Admin API de Supabase Auth con
// la service_role key -- por eso no se puede hacer desde aquí directo con el
// cliente normal. Esa función debe validar aparte que solo superadmin puede
// crear role:'admin'.
export const UsersAdminApi = {
  async list(role: 'admin' | 'desarrollador' | 'cliente'): Promise<ProfileLite[]> {
    return ProfilesApi.searchByRole(role, '', 200);
  },

  async create(payload: { email: string; fullName: string; role: 'admin' | 'desarrollador' | 'cliente' }): Promise<AdminCreatedUser> {
    const { data, error } = await supabase.functions.invoke<AdminCreatedUser>('admin-manage-user', {
      body: { action: 'create', email: payload.email, fullName: payload.fullName, role: payload.role },
    });
    if (error) await throwFunctionError(error);
    return data as AdminCreatedUser;
  },

  async update(id: string, payload: { fullName: string }): Promise<void> {
    const { error } = await supabase.functions.invoke('admin-manage-user', {
      body: { action: 'update', id, fullName: payload.fullName },
    });
    if (error) await throwFunctionError(error);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.functions.invoke('admin-manage-user', {
      body: { action: 'delete', id },
    });
    if (error) await throwFunctionError(error);
  },

  async resetPassword(id: string): Promise<{ tempPassword: string; emailSent: boolean; emailError?: string }> {
    const { data, error } = await supabase.functions.invoke<{ tempPassword: string; emailSent: boolean; emailError?: string }>(
      'admin-manage-user',
      { body: { action: 'reset_password', id } },
    );
    if (error) await throwFunctionError(error);
    return data as { tempPassword: string; emailSent: boolean; emailError?: string };
  },
};

export const AuthApi = {
  // Se llama justo después de que el usuario cambia su contraseña con éxito,
  // para levantar el bloqueo de "debes cambiar tu contraseña".
  async clearMustChangePassword(): Promise<void> {
    const res = await supabase.rpc('clear_must_change_password');
    throwIfError(res as any);
  },
};

// Informe semanal de avance por proyecto + indicador de cumplimiento. Solo
// admin/superadmin/persona-asignada tienen acceso (RLS vía can_manage_project);
// el cliente no participa de este flujo.
export const WeeklyProgressApi = {
  async listForProject(projectId: string): Promise<WeeklyProgressEntry[]> {
    const res = await supabase
      .from('project_weekly_progress')
      .select(
        'id, projectId:project_id, weekStart:week_start, percentAvanzado:percent_avanzado, ' +
          'note, submittedAt:submitted_at',
      )
      .eq('project_id', projectId)
      .order('week_start', { ascending: false });
    return throwIfError<WeeklyProgressEntry[]>(res as any);
  },

  // Reporta lo avanzado en la semana EN CURSO (no un acumulado). El servidor
  // rechaza el envío si ya pasó el plazo (sábado 12:00pm hora Colombia) o si
  // quien llama no puede gestionar el proyecto.
  async submit(projectId: string, percent: number, note: string): Promise<void> {
    const res = await supabase.rpc('submit_weekly_progress', {
      p_project_id: projectId, p_percent: percent, p_note: note,
    });
    throwIfError(res as any);
  },

  async getIndicator(projectId: string): Promise<number> {
    const res = await supabase.rpc('get_weekly_indicator', { p_project_id: projectId });
    return Number(throwIfError<number>(res as any));
  },

  // Desglose semana a semana (para el panel de detalle del admin: explica por
  // qué el indicador quedó en ese valor, no solo el número).
  async getDetail(projectId: string): Promise<WeeklyProgressDetail> {
    const res = await supabase.rpc('get_weekly_progress_detail', { p_project_id: projectId });
    const data = throwIfError<WeeklyProgressDetail>(res as any);
    return data;
  },

  // Para el panel de admin/superadmin: todos los proyectos visibles con su
  // indicador y si ya se reportó la semana en curso, en una sola llamada.
  async listOverview(): Promise<WeeklyProgressOverviewRow[]> {
    const res = await supabase.rpc('list_weekly_progress_overview');
    const rows = throwIfError<{
      project_id: string; code: string; name: string; status: ProjectStatus;
      responsable_nombre: string | null; indicator: number;
      current_week_start: string; current_week_submitted: boolean; current_week_deadline: string;
    }[]>(res as any);
    return rows.map((r) => ({
      projectId: r.project_id, code: r.code, name: r.name, status: r.status,
      responsableNombre: r.responsable_nombre, indicator: Number(r.indicator),
      currentWeekStart: r.current_week_start, currentWeekSubmitted: r.current_week_submitted,
      currentWeekDeadline: r.current_week_deadline,
    }));
  },
};

export const PhasesApi = {
  async listByProject(projectId: string): Promise<ProjectPhase[]> {
    const res = await supabase
      .from('project_phases')
      .select('id, projectId:project_id, key, label, orderIndex:order_index, startDate:start_date, durationDays:duration_days')
      .eq('project_id', projectId)
      .order('order_index', { ascending: true });
    return throwIfError<ProjectPhase[]>(res as any);
  },

  async update(phaseId: string, payload: { startDate: string | null; durationDays: number }) {
    const res = await supabase.rpc('set_project_phase', {
      p_phase_id: phaseId,
      p_start_date: payload.startDate,
      p_duration_days: payload.durationDays,
    });
    throwIfError(res as any);
  },
};
