import { supabase } from './supabase';
import { computeProjectStats } from '../types/domain';
import type {
  Project, Meeting, AuditLogEntry, ItemResponsible, ProjectStatus, MeetingState,
} from '../types/domain';

const PROJECT_SELECT = `
  id, code, name, proveedor, status, createdAt:created_at,
  sections (
    id, key, code, title, notes, orderIndex:order_index,
    items:checklist_items (
      id, n, text, resp, percent,
      log:item_logs ( id, text, authorEmail:author_email, createdAt:created_at )
    )
  )
`;

const MEETING_SELECT = `
  id, date, time, title, state, topics, agreements, risks, nextSteps:next_steps, projectId:project_id,
  teamsJoinUrl:teams_join_url,
  participants ( id, label, email, signature, signedAt:signed_at, signToken:sign_token )
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

  async updateStatus(id: string, status: ProjectStatus) {
    const res = await supabase.from('projects').update({ status }).eq('id', id);
    throwIfError(res as any);
  },

  async deleteProject(id: string) {
    const res = await supabase.from('projects').delete().eq('id', id);
    throwIfError(res as any);
  },

  async addSection(projectId: string, payload: { key: string; code: string; title: string }) {
    const res = await supabase.from('sections').insert({ ...payload, project_id: projectId }).select().single();
    return throwIfError(res as any);
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
    },
  ): Promise<{ id: string }> {
    const res = await supabase.rpc('create_meeting', {
      p_project_id: projectId, p_date: payload.date, p_time: payload.time,
      p_title: payload.title, p_participants: payload.participants,
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
    payload: Partial<{ topics: string; agreements: string; risks: string; nextSteps: string }>,
  ) {
    const res = await supabase
      .from('meetings')
      .update({
        topics: payload.topics, agreements: payload.agreements,
        risks: payload.risks, next_steps: payload.nextSteps,
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

  async getSignStatus(signToken: string): Promise<{ label: string; alreadySigned: boolean } | null> {
    const res = await supabase.rpc('get_sign_status', { p_token: signToken });
    const rows = throwIfError<{ label: string; already_signed: boolean }[]>(res as any);
    const row = rows?.[0];
    return row ? { label: row.label, alreadySigned: row.already_signed } : null;
  },

  async addParticipant(meetingId: string, label: string, email: string) {
    const res = await supabase.from('participants').insert({ label, email, meeting_id: meetingId });
    throwIfError(res as any);
  },

  async removeParticipant(participantId: string) {
    const res = await supabase.from('participants').delete().eq('id', participantId);
    throwIfError(res as any);
  },

  async deleteMeeting(meetingId: string) {
    const res = await supabase.from('meetings').delete().eq('id', meetingId);
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
};
