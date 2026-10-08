-- 1) Todas las tareas de un proyecto (checkpoints y tareas de fase) quedan
-- SIEMPRE asignadas a la persona asignada (responsable) del proyecto -- ya
-- no hay selector individual por ítem. Se sincroniza en 3 momentos:
--   a) al crear un checkpoint/tarea (toma el responsable actual del proyecto),
--   b) cuando el jefe reasigna el responsable del proyecto (se propaga a
--      todos los checkpoints/tareas existentes),
--   c) backfill one-off para lo que ya existe.
create or replace function public.tg_checklist_items_set_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.responsable_id into new.assigned_to
  from sections s join projects p on p.id = s.project_id
  where s.id = new.section_id;
  return new;
end;
$$;

drop trigger if exists trg_checklist_items_set_assignee on public.checklist_items;
create trigger trg_checklist_items_set_assignee
before insert on public.checklist_items
for each row execute function public.tg_checklist_items_set_assignee();

create or replace function public.tg_phase_tasks_set_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select responsable_id into new.assigned_to from public.projects where id = new.project_id;
  return new;
end;
$$;

drop trigger if exists trg_phase_tasks_set_assignee on public.phase_tasks;
create trigger trg_phase_tasks_set_assignee
before insert on public.phase_tasks
for each row execute function public.tg_phase_tasks_set_assignee();

create or replace function public.tg_projects_sync_task_assignees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.checklist_items ci
  set assigned_to = new.responsable_id
  from public.sections s
  where s.id = ci.section_id and s.project_id = new.id;

  update public.phase_tasks
  set assigned_to = new.responsable_id
  where project_id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_projects_sync_task_assignees on public.projects;
create trigger trg_projects_sync_task_assignees
after update of responsable_id on public.projects
for each row execute function public.tg_projects_sync_task_assignees();

-- enforce_item_update() bloquea cambios a assigned_to de quien no sea
-- is_staff(), que depende de auth.uid() -- en este backfill sin sesión
-- autenticada siempre da false, así que se desactiva solo para esta
-- sentencia (en runtime normal, quien reasigna el responsable sí es staff,
-- así que el trigger no estorba).
alter table public.checklist_items disable trigger trg_enforce_item_update;
update public.checklist_items ci
set assigned_to = p.responsable_id
from public.sections s join public.projects p on p.id = s.project_id
where s.id = ci.section_id and p.responsable_id is not null and ci.assigned_to is distinct from p.responsable_id;
alter table public.checklist_items enable trigger trg_enforce_item_update;

update public.phase_tasks pt
set assigned_to = p.responsable_id
from public.projects p
where p.id = pt.project_id and p.responsable_id is not null and pt.assigned_to is distinct from p.responsable_id;

-- 2) El % de cada hito (checkpoint) ya no se elige a mano -- se calcula solo
-- a partir de sus reportes de seguimiento: 0% sin nada registrado, 50% con
-- al menos un reporte (pendiente de aprobación QA), 100% con al menos un
-- reporte ya aprobado.
create or replace function public.tg_recompute_item_percent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid := coalesce(new.item_id, old.item_id);
begin
  update public.checklist_items
  set percent = case
    when exists (select 1 from public.item_logs where item_id = v_item_id and qa_approved) then 100
    when exists (select 1 from public.item_logs where item_id = v_item_id) then 50
    else 0
  end
  where id = v_item_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_item_logs_recompute_percent on public.item_logs;
create trigger trg_item_logs_recompute_percent
after insert or update of qa_approved or delete on public.item_logs
for each row execute function public.tg_recompute_item_percent();

-- Migración de avance heredado: los checkpoints que ya traían un % (del
-- import del Excel, o de ediciones manuales previas al modelo automático)
-- se traducen a un seguimiento real para que el cálculo automático no los
-- borre a 0% de golpe -- 100% => seguimiento ya aprobado; cualquier otro
-- valor > 0% => seguimiento pendiente de aprobación QA. El propio trigger de
-- arriba recalcula el % justo después de insertar este seguimiento.
insert into public.item_logs (text, item_id, qa_approved, qa_approved_at)
select
  case when ci.percent >= 100 then 'Avance importado (migración): checkpoint completo.'
       else 'Avance importado (migración): ' || ci.percent || '% reportado previamente.' end,
  ci.id,
  ci.percent >= 100,
  case when ci.percent >= 100 then now() else null end
from public.checklist_items ci
where ci.percent > 0
  and not exists (select 1 from public.item_logs where item_id = ci.id);

-- 3) set_item_percent() queda obsoleta -- el % ya no se fija a mano.
drop function if exists public.set_item_percent(uuid, integer, text);
