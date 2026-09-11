-- Hasta ahora is_staff() (admin/desarrollador/superadmin) daba acceso PARIDO
-- a los 3 roles sobre TODOS los proyectos -- un desarrollador (persona
-- asignada) veía y podía tocar cualquier proyecto del sistema, no solo
-- aquellos donde es responsable_id. Se introduce can_manage_project(), que
-- documenta esa distinción: admin/superadmin siguen sin restricción (así ya
-- funcionaba "Panel administrativo"), pero un desarrollador solo pasa si es
-- el responsable de ESE proyecto puntual. can_view_project() se redefine en
-- términos de can_manage_project() (agregando la membresía de cliente
-- encima), así que projects/meetings/participants y el bucket de Storage
-- "actas" (que ya usan can_view_project) quedan corregidos automáticamente.
--
-- El resto de tablas de un proyecto (sections/checklist_items/item_logs/
-- daily_notes/project_phases/audit_log) usaban is_staff() DIRECTO, sin pasar
-- por can_view_project -- es decir, ni siquiera estaban cubiertas por el
-- primer intento de scoping por proyecto. Quedan reescritas para exigir
-- can_manage_project() en vez de is_staff() a secas.
--
-- Las acciones que en el frontend ya eran exclusivas de canEdit (jefe/admin)
-- -- crear/borrar proyectos, agregar o borrar checkpoints, notas de sección,
-- borrar reuniones/participantes/notas de seguimiento -- se aprovechan para
-- cerrarlas también a nivel de base de datos con is_admin(), en vez de
-- dejarlas abiertas a is_staff() (cualquier desarrollador, de cualquier
-- proyecto) como estaban.

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.projects where id = p_project_id and responsable_id = auth.uid()
  );
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_project(p_project_id) or exists (
    select 1 from public.project_clients where project_id = p_project_id and cliente_id = auth.uid()
  );
$$;

-- projects: crear/editar/borrar proyectos sigue siendo cosa de jefe/admin
-- (coincide con canCreate/canEdit en el frontend), no de cualquier staff.
drop policy if exists staff_insert_projects on public.projects;
create policy staff_insert_projects on public.projects for insert with check (public.is_admin());
drop policy if exists staff_update_projects on public.projects;
create policy staff_update_projects on public.projects for update using (public.is_admin());
drop policy if exists staff_delete_projects on public.projects;
create policy staff_delete_projects on public.projects for delete using (public.is_admin());

-- sections: solo se crean al crear el proyecto (admin) y sus notas/alta/baja
-- son canEdit=admin en el frontend.
drop policy if exists select_sections on public.sections;
create policy select_sections on public.sections for select using (public.can_manage_project(project_id));
drop policy if exists staff_insert_sections on public.sections;
create policy staff_insert_sections on public.sections for insert with check (public.is_admin());
drop policy if exists staff_update_sections on public.sections;
create policy staff_update_sections on public.sections for update using (public.is_admin());
drop policy if exists staff_delete_sections on public.sections;
create policy staff_delete_sections on public.sections for delete using (public.is_admin());

-- checklist_items: agregar/quitar checkpoints es canEdit=admin; actualizar
-- avance (percent) es canEditPercent=admin O la persona asignada al
-- proyecto de ese checkpoint.
drop policy if exists select_items on public.checklist_items;
create policy select_items on public.checklist_items for select using (
  exists (select 1 from public.sections s where s.id = checklist_items.section_id and public.can_manage_project(s.project_id))
);
drop policy if exists staff_insert_items on public.checklist_items;
create policy staff_insert_items on public.checklist_items for insert with check (
  exists (select 1 from public.sections s where s.id = checklist_items.section_id and public.is_admin())
);
drop policy if exists staff_update_items on public.checklist_items;
create policy staff_update_items on public.checklist_items for update using (
  exists (select 1 from public.sections s where s.id = checklist_items.section_id and public.can_manage_project(s.project_id))
);
drop policy if exists staff_delete_items on public.checklist_items;
create policy staff_delete_items on public.checklist_items for delete using (
  exists (select 1 from public.sections s where s.id = checklist_items.section_id and public.is_admin())
);

-- item_logs: la nota al reabrir un checkpoint la agrega quien tenga
-- canEditPercent para ese proyecto (set_item_percent no es security definer,
-- así que su insert en item_logs pasa por esta misma política).
drop policy if exists select_item_logs on public.item_logs;
create policy select_item_logs on public.item_logs for select using (
  exists (
    select 1 from public.checklist_items ci join public.sections s on s.id = ci.section_id
    where ci.id = item_logs.item_id and public.can_manage_project(s.project_id)
  )
);
drop policy if exists staff_insert_item_logs on public.item_logs;
create policy staff_insert_item_logs on public.item_logs for insert with check (
  exists (
    select 1 from public.checklist_items ci join public.sections s on s.id = ci.section_id
    where ci.id = item_logs.item_id and public.can_manage_project(s.project_id)
  )
);
drop policy if exists staff_delete_item_logs on public.item_logs;
create policy staff_delete_item_logs on public.item_logs for delete using (
  exists (
    select 1 from public.checklist_items ci join public.sections s on s.id = ci.section_id
    where ci.id = item_logs.item_id and public.is_admin()
  )
);

-- daily_notes: registrar una nota de seguimiento es canRegisterMeeting=admin
-- O la persona asignada; borrarla sigue siendo canEdit=admin.
drop policy if exists select_daily_notes on public.daily_notes;
create policy select_daily_notes on public.daily_notes for select using (public.can_manage_project(project_id));
drop policy if exists staff_insert_daily_notes on public.daily_notes;
create policy staff_insert_daily_notes on public.daily_notes for insert with check (public.can_manage_project(project_id));
drop policy if exists staff_delete_daily_notes on public.daily_notes;
create policy staff_delete_daily_notes on public.daily_notes for delete using (public.is_admin());

-- meetings: agendar (canEdit) y registrar manualmente (canRegisterMeeting)
-- crean/actualizan una reunión -- ambos casos deben quedar cubiertos, así
-- que insert/update usan can_manage_project(); borrar reuniones sigue
-- siendo exclusivo de canEdit=admin.
drop policy if exists staff_insert_meetings on public.meetings;
create policy staff_insert_meetings on public.meetings for insert with check (public.can_manage_project(project_id));
drop policy if exists staff_update_meetings on public.meetings;
create policy staff_update_meetings on public.meetings for update using (public.can_manage_project(project_id));
drop policy if exists staff_delete_meetings on public.meetings;
create policy staff_delete_meetings on public.meetings for delete using (public.is_admin());

-- participants: agregar (create_meeting y "+ agregar participante") sigue
-- al mismo criterio que crear/editar la reunión; quitar participantes sigue
-- siendo exclusivo de canEdit=admin.
drop policy if exists staff_insert_participants on public.participants;
create policy staff_insert_participants on public.participants for insert with check (
  exists (select 1 from public.meetings m where m.id = participants.meeting_id and public.can_manage_project(m.project_id))
);
drop policy if exists staff_delete_participants on public.participants;
create policy staff_delete_participants on public.participants for delete using (
  exists (select 1 from public.meetings m where m.id = participants.meeting_id and public.is_admin())
);

-- project_phases: se lee (roadmap) desde el mismo panel de proyecto que
-- puede ver la persona asignada -- se restringe a can_manage_project() en
-- vez del is_staff() a secas que quedó en la corrección anterior.
drop policy if exists select_project_phases on public.project_phases;
create policy select_project_phases on public.project_phases for select using (public.can_manage_project(project_id));

-- audit_log: el historial que se muestra en AuditHistoryPanel ya es por
-- proyecto (AuditApi.byProject) -- que solo muestre lo de proyectos que esa
-- persona puede gestionar.
drop policy if exists select_audit_log on public.audit_log;
create policy select_audit_log on public.audit_log for select using (
  project_id is not null and public.can_manage_project(project_id)
);

-- create_project(): mensaje de error acorde (RLS ya lo exige con is_admin()
-- más arriba; el chequeo interno solo evita el error genérico de RLS).
create or replace function public.create_project(p_name text, p_proveedor text)
returns projects
language plpgsql
as $function$
declare
  v_project public.projects;
  v_section_id uuid;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para crear proyectos';
  end if;

  v_code := 'DEV-' || lpad(nextval('public.project_code_seq')::text, 3, '0');

  insert into public.projects (code, name, proveedor)
  values (v_code, p_name, p_proveedor)
  returning * into v_project;

  insert into public.sections (key, code, title, order_index, project_id)
  values ('ficha', 'FT', 'Ficha técnica', 0, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, resp, section_id) values
    (1, 'Objetivo y alcance del desarrollo definidos', 'cliente', v_section_id),
    (2, 'Requerimientos funcionales documentados', 'desarrollador', v_section_id),
    (3, 'Requerimientos no funcionales (seguridad, rendimiento) documentados', 'desarrollador', v_section_id),
    (4, 'Reglas de negocio identificadas', 'cliente', v_section_id),
    (5, 'Modelo de datos definido', 'desarrollador', v_section_id),
    (6, 'Criterios de aceptación acordados', 'cliente', v_section_id),
    (7, 'Validación y firma (sign-off) de la ficha técnica', 'cliente', v_section_id);

  insert into public.sections (key, code, title, order_index, project_id)
  values ('flujo', 'FP', 'Flujo de procesos', 1, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, resp, section_id) values
    (1, 'Mapeo del proceso actual (as-is)', 'cliente', v_section_id),
    (2, 'Mapeo del proceso propuesto (to-be)', 'desarrollador', v_section_id),
    (3, 'Diagramas de flujo / BPMN elaborados', 'desarrollador', v_section_id),
    (4, 'Casos de uso documentados', 'desarrollador', v_section_id),
    (5, 'Puntos de integración con otros sistemas identificados', 'cliente', v_section_id),
    (6, 'Manejo de excepciones y errores definido', 'desarrollador', v_section_id);

  insert into public.sections (key, code, title, order_index, project_id)
  values ('manual', 'MU', 'Manual de usuario', 2, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, resp, section_id) values
    (1, 'Guía de uso paso a paso redactada', 'desarrollador', v_section_id),
    (2, 'Capturas de pantalla incluidas', 'desarrollador', v_section_id),
    (3, 'Roles y permisos documentados', 'desarrollador', v_section_id),
    (4, 'Preguntas frecuentes incluidas', 'desarrollador', v_section_id),
    (5, 'Canales de soporte especificados', 'cliente', v_section_id);

  return v_project;
end;
$function$;

-- create_meeting(): tampoco es security definer -- pasa por
-- staff_insert_meetings/staff_insert_participants de arriba, pero el mensaje
-- de error interno se actualiza para reflejar el chequeo real.
create or replace function public.create_meeting(
  p_project_id uuid, p_date date, p_time text, p_title text,
  p_participants jsonb default '[]'::jsonb, p_modalidad text default 'Microsoft Teams'::text
)
returns meetings
language plpgsql
as $function$
declare
  v_meeting public.meetings;
  v_participant jsonb;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No tienes permisos para agendar reuniones en este proyecto';
  end if;

  insert into public.meetings (project_id, date, time, title, modalidad)
  values (p_project_id, p_date, p_time, coalesce(p_title, ''), coalesce(nullif(btrim(p_modalidad), ''), 'Microsoft Teams'))
  returning * into v_meeting;

  for v_participant in select * from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    insert into public.participants (label, email, meeting_id)
    values (v_participant->>'label', nullif(v_participant->>'email', ''), v_meeting.id);
  end loop;

  return v_meeting;
end;
$function$;

-- get_sign_link(): copiar el enlace de firma de un participante era
-- cualquier is_staff() sobre cualquier proyecto -- ahora exige
-- can_manage_project() del proyecto real de ese participante (cubre tanto
-- "copiar enlace" de un jefe/admin como el botón "Firmar" de la propia
-- persona asignada sobre su propia fila).
create or replace function public.get_sign_link(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_token text;
begin
  select m.project_id into v_project_id
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  where p.id = p_participant_id;

  if v_project_id is null or not public.can_manage_project(v_project_id) then
    raise exception 'No autorizado para obtener el enlace de firma.';
  end if;

  select sign_token into v_token from public.participants where id = p_participant_id;
  if v_token is null then
    raise exception 'Participante no encontrado.';
  end if;

  return v_token;
end;
$$;
