-- Estructura estándar de TODOS los proyectos: 3 fases y 13 hitos, cada uno
-- con su evidencia de cierre y si exige documento adjunto (definida por
-- Dirección de Sistemas). Solo cambian los hitos: el % de avance de cada
-- proyecto se conserva (ver paso 4) y el resto de su información (datos,
-- responsables, reuniones, actas, notas, reportes semanales) no se toca.
-- Reemplaza:
--   * el checklist anterior (Ficha técnica / Flujo de procesos / Manual de
--     usuario, 18 checkpoints por proyecto) y sus seguimientos;
--   * las 6 fases fijas del cronograma y sus tareas (sin fechas).
-- Las fases del cronograma (project_phases) y las secciones del checklist
-- (sections) usan la misma clave: levantamiento / gestion / entrega.
--
-- Respaldo: antes de borrar, todo lo anterior se copia al esquema "archivo"
-- (no expuesto por la API). Cuando ya no haga falta: drop schema archivo cascade.

-- 0) Respaldo -----------------------------------------------------------
create schema if not exists archivo;
revoke all on schema archivo from public, anon, authenticated;

create table if not exists archivo.sections_20261015 as select * from public.sections;
create table if not exists archivo.checklist_items_20261015 as select * from public.checklist_items;
create table if not exists archivo.item_logs_20261015 as select * from public.item_logs;
create table if not exists archivo.project_phases_20261015 as select * from public.project_phases;
create table if not exists archivo.phase_tasks_20261015 as select * from public.phase_tasks;
create table if not exists archivo.project_weekly_milestones_20261015 as select * from public.project_weekly_milestones;

-- 1) Plantilla de hitos ---------------------------------------------------
create table if not exists public.milestone_templates (
  phase_key         text not null,
  phase_code        text not null,
  phase_label       text not null,
  phase_order       integer not null,
  phase_days        integer not null,
  n                 integer not null,
  title             text not null,
  evidence          text not null,
  requires_document boolean not null default false,
  primary key (phase_key, n)
);

alter table public.milestone_templates enable row level security;
drop policy if exists select_milestone_templates on public.milestone_templates;
create policy select_milestone_templates on public.milestone_templates for select using (public.is_staff());
revoke insert, update, delete on public.milestone_templates from authenticated, anon;

delete from public.milestone_templates;
insert into public.milestone_templates (phase_key, phase_code, phase_label, phase_order, phase_days, n, title, evidence, requires_document) values
  ('levantamiento', 'LEV', 'Levantamiento', 1, 10, 1, 'Reunión inicial', 'Reunión realizada', false),
  ('levantamiento', 'LEV', 'Levantamiento', 1, 10, 2, 'Documentación del levantamiento', 'Documento entregado', true),
  ('levantamiento', 'LEV', 'Levantamiento', 1, 10, 3, 'Aprobación del documento', 'Documento firmado', false),
  ('levantamiento', 'LEV', 'Levantamiento', 1, 10, 4, 'Estimación', 'Cotización enviada', true),
  ('levantamiento', 'LEV', 'Levantamiento', 1, 10, 5, 'Aprobación de la cotización', 'Cotización aprobada', false),
  ('gestion', 'GES', 'Gestión', 2, 20, 1, 'Cronograma', 'Cronograma entregado', true),
  ('gestion', 'GES', 'Gestión', 2, 20, 2, 'Etapa de desarrollo', 'Requerimiento desarrollado', false),
  ('gestion', 'GES', 'Gestión', 2, 20, 3, 'Reunión de entrega', 'Acta de entrega a TI', true),
  ('gestion', 'GES', 'Gestión', 2, 20, 4, 'Testing', 'Acta de testing aprobada', true),
  ('entrega', 'ENT', 'Entrega', 3, 10, 1, 'Entrega a solicitante', 'Reunión de entrega a cliente', false),
  ('entrega', 'ENT', 'Entrega', 3, 10, 2, 'Testing del cliente', 'Acta de testing aprobada', true),
  ('entrega', 'ENT', 'Entrega', 3, 10, 3, 'Implementación', 'Socialización e implementación', false),
  ('entrega', 'ENT', 'Entrega', 3, 10, 4, 'Cierre', 'Acta de cierre', true);

-- 2) Columnas nuevas -------------------------------------------------------
alter table public.checklist_items
  add column if not exists evidence text,
  add column if not exists requires_document boolean not null default false;

-- Documento de evidencia adjunto a un seguimiento (bucket "evidencias").
alter table public.item_logs
  add column if not exists document_path text,
  add column if not exists document_name text;

-- 3) Siembra de la estructura de un proyecto ------------------------------
create or replace function public.seed_project_structure(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start      date;
  v_deadline   date;
  v_total_days integer;
  v_span       integer;
  v_cursor     date;
  v_phase      record;
  v_days       integer;
  v_section_id uuid;
begin
  select start_date, deadline_date into v_start, v_deadline from public.projects where id = p_project_id;
  select sum(distinct_days) into v_total_days
  from (select distinct phase_key, phase_days as distinct_days from public.milestone_templates) d;

  -- Fases del cronograma, escaladas al rango del proyecto si lo tiene.
  if v_start is not null and v_deadline is not null and v_deadline > v_start then
    v_span := greatest(3, v_deadline - v_start);
    v_cursor := v_start;
  end if;

  for v_phase in
    select distinct phase_key, phase_code, phase_label, phase_order, phase_days
    from public.milestone_templates order by phase_order
  loop
    v_days := case when v_span is null then v_phase.phase_days
                   else greatest(1, round(v_phase.phase_days::numeric * v_span / v_total_days)::integer) end;
    insert into public.project_phases (project_id, key, label, order_index, start_date, duration_days)
    values (p_project_id, v_phase.phase_key, v_phase.phase_label, v_phase.phase_order, v_cursor, v_days);
    if v_cursor is not null then
      v_cursor := v_cursor + v_days;
    end if;

    insert into public.sections (key, code, title, order_index, project_id)
    values (v_phase.phase_key, v_phase.phase_code, v_phase.phase_label, v_phase.phase_order - 1, p_project_id)
    returning id into v_section_id;

    insert into public.checklist_items (n, text, evidence, requires_document, section_id)
    select t.n, t.title, t.evidence, t.requires_document, v_section_id
    from public.milestone_templates t
    where t.phase_key = v_phase.phase_key
    order by t.n;
  end loop;
end;
$$;

revoke all on function public.seed_project_structure(uuid) from public, anon, authenticated;

-- Proyecto nuevo: la estructura estándar la siembra el trigger (también para
-- los importados desde Excel, que pasan por create_project).
create or replace function public.seed_project_phases()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_project_structure(new.id);
  return new;
end;
$$;

-- create_project ya no siembra el checklist viejo (lo hace el trigger).
create or replace function public.create_project(p_name text, p_proveedor text)
returns public.projects
language plpgsql
as $$
declare
  v_project public.projects;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para crear proyectos';
  end if;
  v_code := 'DEV-' || lpad(nextval('public.project_code_seq')::text, 3, '0');
  insert into public.projects (code, name, proveedor, deadline_date)
  values (v_code, p_name, p_proveedor, (now() + interval '3 months')::date)
  returning * into v_project;
  return v_project;
end;
$$;

create or replace function public.create_project(p_name text, p_proveedor text, p_start_date date default null, p_deadline_date date default null)
returns public.projects
language plpgsql
as $$
declare
  v_project public.projects;
  v_code text;
  v_start date;
  v_deadline date;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para crear proyectos';
  end if;
  v_start := coalesce(p_start_date, current_date);
  v_deadline := coalesce(p_deadline_date, v_start + interval '3 months');
  if v_deadline <= v_start then
    raise exception 'La fecha de entrega esperada debe ser posterior a la fecha de inicio.';
  end if;
  v_code := 'DEV-' || lpad(nextval('public.project_code_seq')::text, 3, '0');
  insert into public.projects (code, name, proveedor, start_date, deadline_date)
  values (v_code, p_name, p_proveedor, v_start, v_deadline)
  returning * into v_project;
  return v_project;
end;
$$;

-- 4) Reemplazo en todos los proyectos ---------------------------------------
-- Sin auditoría fila por fila (serían miles de registros); queda una entrada
-- resumen por proyecto al final.
alter table public.sections disable trigger trg_audit_sections;
alter table public.checklist_items disable trigger trg_audit_items;
alter table public.item_logs disable trigger trg_audit_item_logs;

-- Avance actual de cada proyecto (promedio del % de sus checkpoints, igual
-- que computeProjectStats en la app), para trasladarlo a los hitos nuevos.
create temporary table _avance_anterior on commit drop as
select s.project_id, sum(ci.percent)::numeric as suma, count(*)::numeric as total
from public.sections s
join public.checklist_items ci on ci.section_id = s.id
group by s.project_id;

delete from public.sections;        -- en cascada: checkpoints, seguimientos, líneas de reportes semanales
delete from public.project_phases;  -- en cascada: tareas de fase

select public.seed_project_structure(p.id) from public.projects p;

-- Traslado del avance: con P = avance anterior, los 13 hitos deben sumar
-- P*13. En orden (LEV-1, LEV-2, ...): los primeros k quedan cumplidos y
-- aprobados (100%, con un seguimiento de migración), el siguiente queda con
-- el resto y los demás en 0%. El promedio vuelve a dar P.
with avance as (
  select p.id as project_id,
         coalesce(a.suma / nullif(a.total, 0), 0) * 13 as objetivo
  from public.projects p
  left join _avance_anterior a on a.project_id = p.id
),
hitos as (
  select pm.item_id, pm.project_id_ref as project_id,
         row_number() over (partition by pm.project_id_ref order by pm.sort_key) as pos
  from (
    select ci.id as item_id, s.project_id as project_id_ref,
           lpad(s.order_index::text, 4, '0') || lpad(ci.n::text, 4, '0') as sort_key
    from public.checklist_items ci
    join public.sections s on s.id = ci.section_id
  ) pm
)
insert into public.item_logs (text, item_id, qa_approved, qa_approved_at)
select 'Avance trasladado desde la estructura anterior de checkpoints (migración a los hitos estándar).',
       h.item_id, true, now()
from hitos h
join avance a on a.project_id = h.project_id
where h.pos <= floor(a.objetivo / 100);

with avance as (
  select p.id as project_id,
         coalesce(a.suma / nullif(a.total, 0), 0) * 13 as objetivo
  from public.projects p
  left join _avance_anterior a on a.project_id = p.id
),
hitos as (
  select ci.id as item_id, s.project_id,
         row_number() over (partition by s.project_id order by s.order_index, ci.n) as pos
  from public.checklist_items ci
  join public.sections s on s.id = ci.section_id
)
update public.checklist_items ci
   set percent = round(a.objetivo - 100 * floor(a.objetivo / 100))::int
  from hitos h
  join avance a on a.project_id = h.project_id
 where ci.id = h.item_id
   and h.pos = floor(a.objetivo / 100) + 1
   and round(a.objetivo - 100 * floor(a.objetivo / 100)) > 0;

alter table public.sections enable trigger trg_audit_sections;
alter table public.checklist_items enable trigger trg_audit_items;
alter table public.item_logs enable trigger trg_audit_item_logs;

insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
select 'project', p.id, 'update', null,
       jsonb_build_object('estructura', '3 fases y 13 hitos estándar', 'respaldo', 'archivo.*_20261015'),
       'migracion@sistema', p.id
from public.projects p;

-- 5) Enviar una fase a QA: sus hitos (no las tareas viejas) deben estar al 100%.
create or replace function public.submit_phase_for_qa(p_phase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_key        text;
  v_pending    integer;
begin
  select project_id, key into v_project_id, v_key from public.project_phases where id = p_phase_id;
  if v_project_id is null then
    raise exception 'Fase no encontrada.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'No autorizado para enviar esta fase a revisión.';
  end if;

  select count(*) into v_pending
  from public.checklist_items ci
  join public.sections s on s.id = ci.section_id
  where s.project_id = v_project_id and s.key = v_key and ci.percent < 100;
  if v_pending > 0 then
    raise exception 'Hay % hito(s) de esta fase sin aprobar -- deben estar cumplidos y aprobados por QA antes de enviar la fase.', v_pending;
  end if;

  update public.project_phases
     set qa_status = 'en_revision', qa_submitted_at = now(), qa_approved_by = null, qa_approved_at = null
   where id = p_phase_id;
end;
$$;

-- 6) Aprobar un seguimiento de un hito que exige documento: debe traerlo.
create or replace function public.approve_item_log(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
  v_doc  text;
begin
  if not public.can_review_item_logs() then
    raise exception 'Solo QA puede aprobar reportes de seguimiento.';
  end if;
  select item_id, document_path into v_item, v_doc from public.item_logs where id = p_log_id;
  if v_item is null then
    raise exception 'El reporte de seguimiento no existe.';
  end if;
  if public.is_responsable_of_item(v_item) then
    raise exception 'No puedes aprobar seguimientos de un proyecto del que eres responsable: lo revisa otra persona de QA.';
  end if;
  if v_doc is null and exists (select 1 from public.checklist_items where id = v_item and requires_document) then
    raise exception 'Este hito exige documento: el seguimiento no trae el archivo adjunto. Recházalo para que lo adjunten.';
  end if;
  update public.item_logs
     set qa_approved = true, qa_approved_by = auth.uid(), qa_approved_at = now(),
         qa_rejected_by = null, qa_rejected_at = null, qa_rejection_reason = null
   where id = p_log_id;
end;
$$;

-- Autoaprobación: tampoco si el hito exige documento y no lo trae.
create or replace function public.tg_item_logs_auto_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_review_item_logs()
     and not public.is_responsable_of_item(NEW.item_id)
     and (NEW.document_path is not null
          or not exists (select 1 from public.checklist_items where id = NEW.item_id and requires_document)) then
    NEW.qa_approved := true;
    NEW.qa_approved_by := auth.uid();
    NEW.qa_approved_at := now();
  end if;
  return NEW;
end;
$$;

-- 7) Almacenamiento de evidencias: <proyecto>/<hito>/<archivo>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidencias', 'evidencias', false, 20971520)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists evidencias_select on storage.objects;
create policy evidencias_select on storage.objects for select using (
  bucket_id = 'evidencias' and public.can_view_project(public.safe_uuid(split_part(name, '/', 1)))
);

drop policy if exists evidencias_insert on storage.objects;
create policy evidencias_insert on storage.objects for insert with check (
  bucket_id = 'evidencias'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
  and public.can_manage_project(public.safe_uuid(split_part(name, '/', 1)))
);

-- 8) Reporte semanal: el formulario y el detalle traen evidencia, si exige
--    documento y el documento adjunto; el envío lo exige en los "cumplido".
create or replace function public.get_weekly_report_form(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_week_end   date := date_trunc('week', v_today)::date + 6;
  v_deadline   timestamptz := (date_trunc('week', v_today)::date + 5 + time '12:00') at time zone 'America/Bogota';
  v_progress   public.project_weekly_progress;
  v_week_items jsonb;
  v_overdue    jsonb;
  v_next       jsonb;
  v_undated    integer;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select * into v_progress from public.project_weekly_progress
  where project_id = p_project_id and week_start = v_week_start;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', pm.item_id, 'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
      'evidence', ci.evidence, 'requiresDocument', ci.requires_document,
      'approved', pm.percent >= 100,
      'pendingQa', public.milestone_pending_qa(pm.item_id) and coalesce(m.status, '') <> 'cumplido',
      'status', m.status, 'note', m.note,
      'documentPath', l.document_path, 'documentName', l.document_name
    ) order by pm.due_date, pm.sort_key), '[]'::jsonb)
  into v_week_items
  from public.project_milestones(p_project_id) pm
  join public.checklist_items ci on ci.id = pm.item_id
  left join public.project_weekly_milestones m on m.progress_id = v_progress.id and m.item_id = pm.item_id
  left join public.item_logs l on l.id = m.item_log_id
  where pm.due_date between v_week_start and v_week_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', pm.item_id, 'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
      'evidence', ci.evidence, 'requiresDocument', ci.requires_document,
      'daysLate', v_today - pm.due_date,
      'status', m.status, 'note', m.note,
      'documentPath', l.document_path, 'documentName', l.document_name
    ) order by pm.due_date, pm.sort_key), '[]'::jsonb)
  into v_overdue
  from public.project_milestones(p_project_id) pm
  join public.checklist_items ci on ci.id = pm.item_id
  left join public.project_weekly_milestones m on m.progress_id = v_progress.id and m.item_id = pm.item_id
  left join public.item_logs l on l.id = m.item_log_id
  where pm.due_date < v_week_start
    and pm.percent < 100
    and (not public.milestone_pending_qa(pm.item_id) or m.status = 'cumplido');

  select coalesce(jsonb_agg(x order by (x->>'dueDate')), '[]'::jsonb) into v_next
  from (
    select jsonb_build_object('code', pm.code, 'title', pm.title, 'dueDate', pm.due_date) as x
    from public.project_milestones(p_project_id) pm
    where pm.due_date > v_week_end and pm.percent < 100
    order by pm.due_date, pm.sort_key
    limit 5
  ) n;

  select count(*) into v_undated
  from public.project_milestones(p_project_id) pm
  where pm.due_date is null and pm.percent < 100;

  return jsonb_build_object(
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'deadline', v_deadline,
    'isOpen', now() <= v_deadline,
    'submittedAt', v_progress.submitted_at,
    'note', coalesce(v_progress.note, ''),
    'weekItems', v_week_items,
    'overdueItems', v_overdue,
    'nextItems', v_next,
    'undatedCount', v_undated
  );
end;
$$;

-- p_items: [{"itemId", "status", "note", "documentPath", "documentName"}]
create or replace function public.submit_weekly_report(p_project_id uuid, p_note text, p_items jsonb)
returns public.project_weekly_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_week_end   date := date_trunc('week', v_today)::date + 6;
  v_deadline   timestamptz := (date_trunc('week', v_today)::date + 5 + time '12:00') at time zone 'America/Bogota';
  v_email      text := (select email from public.profiles where id = auth.uid());
  v_row        public.project_weekly_progress;
  v_el         jsonb;
  v_item       uuid;
  v_status     text;
  v_note       text;
  v_doc_path   text;
  v_doc_name   text;
  v_code       text;
  v_req_doc    boolean;
  v_old        public.project_weekly_milestones;
  v_log_id     uuid;
  v_missing    text;
  v_total      integer;
  v_done       integer;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado para reportar el avance de este proyecto.';
  end if;
  if now() > v_deadline then
    raise exception 'Ya pasó el plazo para reportar el avance de esta semana (sábado 12:00 pm hora Colombia). Podrás reportar de nuevo el lunes.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de hitos inválido.';
  end if;

  for v_el in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (v_el->>'itemId')::uuid;
    v_status := v_el->>'status';
    v_note := nullif(btrim(coalesce(v_el->>'note', '')), '');
    v_doc_path := nullif(btrim(coalesce(v_el->>'documentPath', '')), '');
    select pm.code, ci.requires_document into v_code, v_req_doc
    from public.project_milestones(p_project_id) pm
    join public.checklist_items ci on ci.id = pm.item_id
    where pm.item_id = v_item;
    if v_code is null then
      raise exception 'Uno de los hitos no pertenece a este proyecto.';
    end if;
    if v_status not in ('cumplido', 'en_curso', 'sin_avance') then
      raise exception 'Estado inválido para el hito %.', v_code;
    end if;
    if v_status <> 'cumplido' and (v_note is null or length(v_note) < 3) then
      raise exception 'Falta el comentario del hito % (qué falta o por qué no hubo avance).', v_code;
    end if;
    if v_doc_path is not null and v_doc_path !~ ('^' || p_project_id::text || '/' || v_item::text || '/[^/]+$') then
      raise exception 'El documento del hito % no corresponde a este hito.', v_code;
    end if;
    if v_status = 'cumplido' and v_req_doc and v_doc_path is null then
      raise exception 'El hito % exige documento: adjunta el archivo de evidencia para marcarlo como cumplido.', v_code;
    end if;
    v_code := null;
  end loop;

  select string_agg(pm.code, ', ' order by pm.due_date, pm.sort_key) into v_missing
  from public.project_milestones(p_project_id) pm
  where pm.percent < 100
    and pm.due_date <= v_week_end
    and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where (e->>'itemId')::uuid = pm.item_id)
    and not public.milestone_pending_qa(pm.item_id);
  if v_missing is not null then
    raise exception 'Falta reportar el estado de: %.', v_missing;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'No hay hitos esta semana: describe en el comentario qué se hizo (o que no hubo avance).';
  end if;

  insert into public.project_weekly_progress (project_id, week_start, percent_avanzado, note, submitted_by, submitted_at)
  values (p_project_id, v_week_start, 0, btrim(coalesce(p_note, '')), auth.uid(), now())
  on conflict (project_id, week_start) do update
    set note = excluded.note, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into v_row;

  for v_old in
    select * from public.project_weekly_milestones m
    where m.progress_id = v_row.id
      and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where (e->>'itemId')::uuid = m.item_id)
  loop
    if v_old.item_log_id is not null then
      delete from public.item_logs where id = v_old.item_log_id and not qa_approved;
    end if;
    delete from public.project_weekly_milestones where id = v_old.id;
  end loop;

  for v_el in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (v_el->>'itemId')::uuid;
    v_status := v_el->>'status';
    v_note := nullif(btrim(coalesce(v_el->>'note', '')), '');
    v_doc_path := nullif(btrim(coalesce(v_el->>'documentPath', '')), '');
    v_doc_name := nullif(btrim(coalesce(v_el->>'documentName', '')), '');
    v_log_id := (select m.item_log_id from public.project_weekly_milestones m
                 where m.progress_id = v_row.id and m.item_id = v_item);

    if v_status = 'cumplido' then
      if v_log_id is null or not exists (
        select 1 from public.item_logs where id = v_log_id and qa_rejected_at is null
      ) then
        insert into public.item_logs (text, item_id, author_id, author_email, document_path, document_name)
        values (
          'Hito cumplido (reporte semanal del ' || to_char(v_week_start, 'DD/MM/YYYY') || ')'
            || coalesce(': ' || v_note, '.'),
          v_item, auth.uid(), v_email, v_doc_path, v_doc_name
        )
        returning id into v_log_id;
      elsif v_doc_path is not null then
        update public.item_logs set document_path = v_doc_path, document_name = v_doc_name
         where id = v_log_id and not qa_approved;
      end if;
    elsif v_log_id is not null then
      delete from public.item_logs where id = v_log_id and not qa_approved;
      v_log_id := null;
    end if;

    insert into public.project_weekly_milestones (progress_id, item_id, status, note, item_log_id)
    values (v_row.id, v_item, v_status, v_note, v_log_id)
    on conflict (progress_id, item_id) do update
      set status = excluded.status, note = excluded.note, item_log_id = excluded.item_log_id;
  end loop;

  select count(*),
         count(*) filter (
           where pm.percent >= 100
              or public.milestone_pending_qa(pm.item_id)
              or exists (select 1 from public.project_weekly_milestones m
                         where m.progress_id = v_row.id and m.item_id = pm.item_id and m.status = 'cumplido')
         )
    into v_total, v_done
  from public.project_milestones(p_project_id) pm
  where pm.due_date between v_week_start and v_week_end;

  update public.project_weekly_progress
     set milestones_total = v_total,
         milestones_done = v_done,
         percent_avanzado = case when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end
   where id = v_row.id
  returning * into v_row;

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values ('project_weekly_progress', v_row.id, 'update', null,
          jsonb_build_object('week_start', v_week_start, 'milestones_total', v_total, 'milestones_done', v_done),
          v_email, p_project_id);

  return v_row;
end;
$$;

-- Detalle semana a semana: cada línea trae el documento de evidencia adjunto.
create or replace function public.get_weekly_progress_detail(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today          date := (now() at time zone 'America/Bogota')::date;
  v_responsable    uuid;
  v_assigned_at    timestamptz;
  v_created_at     timestamptz;
  v_start          date;
  v_year_end       date;
  v_weeks_left     numeric;
  v_penalty        numeric;
  v_weeks          jsonb;
  v_weeks_tracked  integer;
  v_weeks_reported integer;
  v_weeks_missed   integer;
  v_frozen         numeric;
  v_undated        integer;
  v_next           jsonb;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select responsable_id, responsable_asignado_at, created_at, weekly_indicator_frozen
    into v_responsable, v_assigned_at, v_created_at, v_frozen
  from public.projects where id = p_project_id;

  select count(*) into v_undated
  from public.project_milestones(p_project_id) pm
  where pm.due_date is null and pm.percent < 100;

  select coalesce(jsonb_agg(x order by (x->>'dueDate')), '[]'::jsonb) into v_next
  from (
    select jsonb_build_object('code', pm.code, 'title', pm.title, 'dueDate', pm.due_date) as x
    from public.project_milestones(p_project_id) pm
    where pm.due_date > date_trunc('week', v_today)::date + 6 and pm.percent < 100
    order by pm.due_date, pm.sort_key
    limit 3
  ) n;

  if v_responsable is null then
    return jsonb_build_object(
      'indicator', 100, 'weeksTracked', 0, 'weeksReported', 0, 'weeksMissed', 0,
      'penaltyPerWeek', 0, 'weeksRemainingYear', 0, 'frozen', false, 'weeks', '[]'::jsonb,
      'undatedCount', v_undated, 'nextItems', v_next
    );
  end if;

  v_start := coalesce(v_assigned_at::date, v_created_at::date);
  v_year_end := make_date(extract(year from v_today)::int, 12, 31);
  v_weeks_left := greatest(1, (v_year_end - v_today) / 7.0);
  v_penalty := round(100.0 / v_weeks_left, 2);

  with weeks as (
    select gs::date as week_start
    from generate_series(
      date_trunc('week', v_start)::timestamp,
      date_trunc('week', v_today)::timestamp,
      interval '7 days'
    ) as gs
  ),
  joined as (
    select
      w.week_start,
      pwp.id as progress_id,
      pwp.percent_avanzado,
      pwp.note,
      pwp.submitted_at,
      (w.week_start = date_trunc('week', v_today)::date) as is_current,
      (pwp.id is not null) as reported
    from weeks w
    left join public.project_weekly_progress pwp
      on pwp.project_id = p_project_id and pwp.week_start = w.week_start
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'weekStart', j.week_start,
      'status', case when j.reported then 'reportado' when j.is_current then 'en_curso' else 'perdida' end,
      'percentAvanzado', j.percent_avanzado,
      'note', j.note,
      'submittedAt', j.submitted_at,
      'milestonesTotal', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6),
      'milestonesDone', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6
                            and (pm.percent >= 100 or exists (
                              select 1 from public.project_weekly_milestones m
                              join public.item_logs l on l.id = m.item_log_id
                              where m.item_id = pm.item_id and m.status = 'cumplido' and l.qa_rejected_at is null))),
      'milestonesApproved', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6 and pm.percent >= 100),
      'items', coalesce((
        select jsonb_agg(q.x order by (q.x->>'late')::boolean desc, q.x->>'dueDate', q.x->>'code')
        from (
          -- Hitos que vencían esta semana, reportados o no.
          select jsonb_build_object(
            'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
            'status', m.status, 'note', m.note, 'late', false,
            'approved', pm.percent >= 100,
            'qa', case
                    when l.qa_approved then 'aprobado'
                    when l.qa_rejected_at is not null then 'rechazado'
                    when l.id is not null then 'pendiente'
                    else null
                  end,
            'qaReason', l.qa_rejection_reason,
            'documentPath', l.document_path, 'documentName', l.document_name
          ) as x
          from public.project_milestones(p_project_id) pm
          left join public.project_weekly_milestones m on m.progress_id = j.progress_id and m.item_id = pm.item_id
          left join public.item_logs l on l.id = m.item_log_id
          where pm.due_date between j.week_start and j.week_start + 6
          union all
          -- Atrasados (de semanas anteriores) que se reportaron esta semana.
          select jsonb_build_object(
            'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
            'status', m.status, 'note', m.note, 'late', true,
            'approved', pm.percent >= 100,
            'qa', case
                    when l.qa_approved then 'aprobado'
                    when l.qa_rejected_at is not null then 'rechazado'
                    when l.id is not null then 'pendiente'
                    else null
                  end,
            'qaReason', l.qa_rejection_reason,
            'documentPath', l.document_path, 'documentName', l.document_name
          )
          from public.project_weekly_milestones m
          join public.project_milestones(p_project_id) pm on pm.item_id = m.item_id
          left join public.item_logs l on l.id = m.item_log_id
          where m.progress_id = j.progress_id and pm.due_date < j.week_start
        ) q
      ), '[]'::jsonb)
    ) order by j.week_start), '[]'::jsonb),
    count(*) filter (where not j.is_current),
    count(*) filter (where j.reported and not j.is_current),
    count(*) filter (where not j.reported and not j.is_current)
  into v_weeks, v_weeks_tracked, v_weeks_reported, v_weeks_missed
  from joined j;

  return jsonb_build_object(
    'indicator', public.compute_weekly_indicator(p_project_id, v_today),
    'weeksTracked', v_weeks_tracked,
    'weeksReported', v_weeks_reported,
    'weeksMissed', v_weeks_missed,
    'penaltyPerWeek', v_penalty,
    'weeksRemainingYear', round(v_weeks_left, 1),
    'frozen', v_frozen is not null,
    'weeks', v_weeks,
    'undatedCount', v_undated,
    'nextItems', v_next
  );
end;
$$;
