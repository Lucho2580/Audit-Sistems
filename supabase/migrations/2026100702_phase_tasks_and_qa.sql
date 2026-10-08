-- Tareas por fase (con responsable individual, fechas y avance), plantillas
-- estándar por fase, y flujo de aprobación de QA por fase. Ver resumen en
-- el plan de esta sesión.

-- is_staff(): el rol 'qa' necesita poder leer proyectos/fases para revisar,
-- igual que admin/desarrollador/superadmin.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'desarrollador', 'superadmin', 'qa')
  );
$$;

-- project_phases: estado del gate de QA.
alter table public.project_phases
  add column if not exists qa_status text not null default 'pendiente'
    check (qa_status in ('pendiente', 'en_revision', 'aprobada')),
  add column if not exists qa_submitted_at timestamptz,
  add column if not exists qa_approved_by uuid references public.profiles(id),
  add column if not exists qa_approved_at timestamptz;

-- phase_tasks: la tabla de tareas (ítem 2) que vive DENTRO de cada fase.
create table if not exists public.phase_tasks (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.project_phases(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  text text not null,
  assigned_to uuid references public.profiles(id),
  start_date date,
  planned_end_date date,
  percent integer not null default 0 check (percent between 0 and 100),
  observaciones text,
  created_at timestamptz not null default now()
);

create index if not exists phase_tasks_phase_id_idx on public.phase_tasks(phase_id);
create index if not exists phase_tasks_project_id_idx on public.phase_tasks(project_id);

alter table public.phase_tasks enable row level security;

drop policy if exists select_phase_tasks on public.phase_tasks;
create policy select_phase_tasks on public.phase_tasks for select using (
  public.can_manage_project(project_id)
  or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
);

drop policy if exists admin_insert_phase_tasks on public.phase_tasks;
create policy admin_insert_phase_tasks on public.phase_tasks for insert with check (public.is_admin());

-- Update directo por tabla: solo admin (puede tocar cualquier columna --
-- texto, asignado, fechas, avance). Quien tiene la tarea asignada SOLO
-- puede tocar avance/observaciones, y lo hace vía set_phase_task_progress()
-- más abajo (RPC, no esta política).
drop policy if exists admin_update_phase_tasks on public.phase_tasks;
create policy admin_update_phase_tasks on public.phase_tasks for update using (public.is_admin());

drop policy if exists admin_delete_phase_tasks on public.phase_tasks;
create policy admin_delete_phase_tasks on public.phase_tasks for delete using (public.is_admin());

-- phase_task_templates: plantilla editable de tareas estándar por fase
-- (ítem 9) -- se usa para poblar phase_tasks automáticamente al crear una
-- fase/proyecto nuevo.
create table if not exists public.phase_task_templates (
  id uuid primary key default gen_random_uuid(),
  phase_key text not null,
  text text not null,
  order_index integer not null default 0
);

alter table public.phase_task_templates enable row level security;

drop policy if exists select_phase_task_templates on public.phase_task_templates;
create policy select_phase_task_templates on public.phase_task_templates for select using (public.is_staff());

drop policy if exists admin_write_phase_task_templates on public.phase_task_templates;
create policy admin_write_phase_task_templates on public.phase_task_templates for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.phase_task_templates (phase_key, text, order_index) values
  ('levantamiento', 'Reunión de levantamiento de requerimientos', 1),
  ('levantamiento', 'Documentar alcance y criterios de aceptación', 2),
  ('diseno', 'Diseño de modelo de datos', 1),
  ('diseno', 'Diseño de flujos y pantallas', 2),
  ('implementacion', 'Desarrollo del backend', 1),
  ('implementacion', 'Desarrollo del frontend', 2),
  ('implementacion', 'Integración de módulos', 3),
  ('testing', 'Pruebas funcionales', 1),
  ('testing', 'Corrección de hallazgos', 2),
  ('entrega', 'Preparación de manual de usuario', 1),
  ('entrega', 'Capacitación al cliente', 2),
  ('fin', 'Cierre y firma del acta final', 1)
on conflict do nothing;

-- seed_project_phases(): además de crear las 6 fases, les crea sus tareas
-- estándar según la plantilla de cada phase_key.
create or replace function public.seed_project_phases()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_phase record;
begin
  insert into project_phases (project_id, key, label, order_index, duration_days) values
    (new.id, 'levantamiento', 'Levantamiento', 1, 5),
    (new.id, 'diseno', 'Diseño', 2, 5),
    (new.id, 'implementacion', 'Implementación', 3, 10),
    (new.id, 'testing', 'Testing', 4, 5),
    (new.id, 'entrega', 'Entrega', 5, 3),
    (new.id, 'fin', 'Fin', 6, 1);

  for v_phase in select id, key from project_phases where project_id = new.id loop
    insert into phase_tasks (phase_id, project_id, text)
    select v_phase.id, new.id, t.text
    from phase_task_templates t
    where t.phase_key = v_phase.key
    order by t.order_index;
  end loop;

  return new;
end;
$function$;

-- Backfill: proyectos que ya existían antes de este cambio, cuyas fases
-- todavía no tienen ninguna tarea.
insert into public.phase_tasks (phase_id, project_id, text)
select ph.id, ph.project_id, t.text
from public.project_phases ph
join public.phase_task_templates t on t.phase_key = ph.key
where not exists (select 1 from public.phase_tasks pt where pt.phase_id = ph.id)
order by ph.id, t.order_index;

-- set_phase_task_progress(): quien tiene la tarea asignada actualiza SU
-- avance/observaciones (ítem 6: "cada persona solo actualiza las tareas que
-- tiene asignadas") -- admin también puede, por si hay que corregir algo.
create or replace function public.set_phase_task_progress(p_task_id uuid, p_percent integer, p_observaciones text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned_to uuid;
  v_project_id uuid;
begin
  select assigned_to, project_id into v_assigned_to, v_project_id
  from public.phase_tasks where id = p_task_id;

  if v_project_id is null then
    raise exception 'Tarea no encontrada.';
  end if;

  if not (public.is_admin() or auth.uid() = v_assigned_to) then
    raise exception 'No autorizado para actualizar esta tarea.';
  end if;

  if p_percent < 0 or p_percent > 100 then
    raise exception 'El avance debe estar entre 0 y 100.';
  end if;

  update public.phase_tasks
     set percent = p_percent, observaciones = p_observaciones
   where id = p_task_id;
end;
$$;

revoke all on function public.set_phase_task_progress(uuid, integer, text) from public, anon;
grant execute on function public.set_phase_task_progress(uuid, integer, text) to authenticated;

-- submit_phase_for_qa(): el jefe/admin del proyecto manda la fase a
-- revisión -- exige que todas las tareas estén al 100%.
create or replace function public.submit_phase_for_qa(p_phase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_pending integer;
begin
  select project_id into v_project_id from public.project_phases where id = p_phase_id;
  if v_project_id is null then
    raise exception 'Fase no encontrada.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception 'No autorizado para enviar esta fase a revisión.';
  end if;

  select count(*) into v_pending from public.phase_tasks where phase_id = p_phase_id and percent < 100;
  if v_pending > 0 then
    raise exception 'Hay % tarea(s) sin completar al 100%% -- termínalas antes de enviar a QA.', v_pending;
  end if;

  update public.project_phases
     set qa_status = 'en_revision', qa_submitted_at = now(), qa_approved_by = null, qa_approved_at = null
   where id = p_phase_id;
end;
$$;

revoke all on function public.submit_phase_for_qa(uuid) from public, anon;
grant execute on function public.submit_phase_for_qa(uuid) to authenticated;

-- approve_phase_qa(): solo una cuenta con rol 'qa' puede dar el OK.
create or replace function public.approve_phase_qa(p_phase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'qa' then
    raise exception 'Solo una cuenta con rol QA puede aprobar esta fase.';
  end if;

  update public.project_phases
     set qa_status = 'aprobada', qa_approved_by = auth.uid(), qa_approved_at = now()
   where id = p_phase_id;
end;
$$;

revoke all on function public.approve_phase_qa(uuid) from public, anon;
grant execute on function public.approve_phase_qa(uuid) to authenticated;

-- Yefree Segovia ya tiene cuenta (admin) y hoy no es jefe de ningún
-- proyecto -- se le cambia el rol a 'qa' sin que eso le quite nada.
update public.profiles
   set role = 'qa'
 where full_name ilike '%yefre%segovia%'
   and role <> 'qa';
