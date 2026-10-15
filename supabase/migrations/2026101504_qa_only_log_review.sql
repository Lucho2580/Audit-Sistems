-- Revisión de reportes de seguimiento (item_logs): SOLO el rol QA (más las
-- cuentas puntuales de item_log_reviewers, hoy soporte.ti) aprueba o
-- rechaza, y todo rechazo lleva su motivo.
--
-- Antes (2026100707): admin/superadmin también podían aprobar, lo que
-- agregaba un admin se autoaprobaba al insertarse, y la policy
-- staff_update_item_logs dejaba a admin/QA hacer UPDATE directo sobre
-- item_logs saltándose approve_item_log(). Tampoco existía el rechazo.
--
-- Estados (derivados de las columnas, sin enum aparte):
--   aprobado  -> qa_approved = true
--   rechazado -> qa_rejected_at is not null (y qa_approved = false)
--   pendiente -> ninguno de los dos
-- Aprobar limpia un rechazo previo y rechazar anula una aprobación previa:
-- QA puede cambiar de decisión, pero siempre queda quién y cuándo.

alter table public.item_logs
  add column if not exists qa_rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists qa_rejected_at timestamptz,
  add column if not exists qa_rejection_reason text;

-- 0) Quién puede revisar: rol QA, o una cuenta listada en item_log_reviewers.
--    Es una tabla aparte y no una columna de profiles a propósito: la policy
--    "Los admins actualizan roles" deja a cualquier admin hacer UPDATE de
--    cualquier columna de profiles, así que un flag ahí se lo podría poner
--    cualquier admin a sí mismo. Esta tabla no tiene policies -- solo se
--    toca con SQL directo en la base.
create table if not exists public.item_log_reviewers (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now()
);

comment on table public.item_log_reviewers is
  'Cuentas que, sin tener rol QA, pueden aprobar/rechazar reportes de seguimiento. Solo se administra con SQL directo.';

alter table public.item_log_reviewers enable row level security;
revoke all on public.item_log_reviewers from authenticated, anon;

insert into public.item_log_reviewers (user_id)
select id from public.profiles where lower(email) = 'soporte.ti@lavianda.co'
on conflict (user_id) do nothing;

create or replace function public.can_review_item_logs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
      or exists (select 1 from public.item_log_reviewers where user_id = auth.uid());
$$;

revoke all on function public.can_review_item_logs() from public, anon;
grant execute on function public.can_review_item_logs() to authenticated;

-- 1) Autoaprobación al insertar: solo cuando quien escribe el reporte puede
--    revisarlos (ya tiene la autoridad para aprobarlo). Lo que escribe un admin o
--    superadmin queda pendiente de QA como el de cualquiera.
create or replace function public.tg_item_logs_auto_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_review_item_logs() then
    NEW.qa_approved := true;
    NEW.qa_approved_by := auth.uid();
    NEW.qa_approved_at := now();
  end if;
  return NEW;
end;
$$;

-- 2) Sin UPDATE directo: el estado de revisión solo cambia vía los dos RPC
--    de abajo (security definer, con su propio chequeo de rol).
drop policy if exists staff_update_item_logs on public.item_logs;

create or replace function public.approve_item_log(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_item_logs() then
    raise exception 'Solo QA puede aprobar reportes de seguimiento.';
  end if;
  update public.item_logs
     set qa_approved = true, qa_approved_by = auth.uid(), qa_approved_at = now(),
         qa_rejected_by = null, qa_rejected_at = null, qa_rejection_reason = null
   where id = p_log_id;
  if not found then
    raise exception 'El reporte de seguimiento no existe.';
  end if;
end;
$$;

revoke all on function public.approve_item_log(uuid) from public, anon;
grant execute on function public.approve_item_log(uuid) to authenticated;

create or replace function public.reject_item_log(p_log_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_review_item_logs() then
    raise exception 'Solo QA puede rechazar reportes de seguimiento.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica el motivo del rechazo (mínimo 5 caracteres).';
  end if;
  update public.item_logs
     set qa_approved = false, qa_approved_by = null, qa_approved_at = null,
         qa_rejected_by = auth.uid(), qa_rejected_at = now(), qa_rejection_reason = btrim(p_reason)
   where id = p_log_id;
  if not found then
    raise exception 'El reporte de seguimiento no existe.';
  end if;
end;
$$;

revoke all on function public.reject_item_log(uuid, text) from public, anon;
grant execute on function public.reject_item_log(uuid, text) to authenticated;

-- 3) % automático del checkpoint: un reporte rechazado no cuenta como
--    avance. 100% con al menos uno aprobado, 50% con al menos uno pendiente
--    (ni aprobado ni rechazado), 0% si no hay ninguno o todos se rechazaron.
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
    when exists (select 1 from public.item_logs where item_id = v_item_id and qa_rejected_at is null) then 50
    else 0
  end
  where id = v_item_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_item_logs_recompute_percent on public.item_logs;
create trigger trg_item_logs_recompute_percent
after insert or delete or update of qa_approved, qa_rejected_at on public.item_logs
for each row execute function public.tg_recompute_item_percent();
