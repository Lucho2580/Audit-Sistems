-- 1) Fecha límite por checkpoint ("hito") -- el jefe/QA la fija, la persona
-- asignada solo reporta avance (consistente con "QA suma, jefe conserva").
alter table public.checklist_items add column if not exists due_date date;

create or replace function public.enforce_item_update()
returns trigger
language plpgsql
as $function$
begin
  if not public.is_staff() then
    if NEW.text is distinct from OLD.text
       or NEW.assigned_to is distinct from OLD.assigned_to
       or NEW.due_date is distinct from OLD.due_date
       or NEW.n is distinct from OLD.n
       or NEW.section_id is distinct from OLD.section_id then
      raise exception 'No tienes permisos para modificar ese campo del checkpoint';
    end if;
  end if;
  return NEW;
end;
$function$;

-- 2) Los reportes de seguimiento (item_logs) de la persona asignada quedan
-- pendientes hasta que QA (o el jefe) los apruebe -- lo que agrega el propio
-- jefe/QA se marca aprobado de una vez, porque no tiene sentido que se
-- autoapruebe un tercero distinto de quien ya tiene esa autoridad.
alter table public.item_logs add column if not exists qa_approved boolean not null default false;
alter table public.item_logs add column if not exists qa_approved_by uuid references public.profiles(id) on delete set null;
alter table public.item_logs add column if not exists qa_approved_at timestamptz;

create or replace function public.tg_item_logs_auto_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa') then
    NEW.qa_approved := true;
    NEW.qa_approved_by := auth.uid();
    NEW.qa_approved_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_item_logs_auto_approve on public.item_logs;
create trigger trg_item_logs_auto_approve
before insert on public.item_logs
for each row execute function public.tg_item_logs_auto_approve();

-- QA necesita VER los seguimientos para poder aprobarlos -- antes
-- select_item_logs solo dejaba ver a quien gestiona el proyecto
-- (can_manage_project, que deliberadamente no incluye qa).
drop policy if exists select_item_logs on public.item_logs;
create policy select_item_logs on public.item_logs for select using (
  exists (
    select 1 from public.checklist_items ci join public.sections s on s.id = ci.section_id
    where ci.id = item_logs.item_id
      and (public.can_manage_project(s.project_id) or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa'))
  )
);

-- Nueva policy de update: antes no existía ninguna (los logs eran
-- inmutables salvo borrado) -- ahora admin o QA pueden tocar el estado de
-- aprobación a través de approve_item_log().
drop policy if exists staff_update_item_logs on public.item_logs;
create policy staff_update_item_logs on public.item_logs for update using (
  public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
);

create or replace function public.approve_item_log(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')) then
    raise exception 'No autorizado para aprobar observaciones de seguimiento.';
  end if;
  update public.item_logs
  set qa_approved = true, qa_approved_by = auth.uid(), qa_approved_at = now()
  where id = p_log_id;
end;
$$;
