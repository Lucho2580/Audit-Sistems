-- Una cuenta con rol QA también puede ser la persona asignada (responsable)
-- de un proyecto, sin perder su rol de QA en los demás.
--
-- Separación de funciones: en un proyecto del que es responsable, un QA no
-- revisa su propio trabajo -- lo que reporta no se autoaprueba y no puede
-- aprobar ni rechazar seguimientos de ese proyecto (lo hace otro revisor).

-- 1) Validación del responsable: desarrollador o QA.
create or replace function public.tg_projects_validate_actor_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.responsable_id is not null then
    select role into v_role from public.profiles where id = new.responsable_id;
    if v_role is null or v_role not in ('desarrollador', 'qa') then
      raise exception 'La persona asignada debe ser un usuario con rol desarrollador o QA (recibido: %).', coalesce(v_role, 'perfil inexistente');
    end if;
  end if;

  if new.proveedor_id is not null then
    if not exists (select 1 from public.providers where id = new.proveedor_id) then
      raise exception 'El proveedor debe ser un registro existente en providers (recibido: proveedor inexistente).';
    end if;
  end if;

  return new;
end;
$$;

-- 2) Al cambiar de rol solo se le quitan los proyectos si deja de ser
--    desarrollador o QA.
create or replace function public.tg_profiles_clear_invalid_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if new.role <> 'admin' then
      delete from public.project_jefes where jefe_id = new.id;
    end if;
    if new.role not in ('desarrollador', 'qa') then
      update public.projects set responsable_id = null, responsable_nombre = null where responsable_id = new.id;
    end if;
    if new.role <> 'cliente' then
      delete from public.project_clients where cliente_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- 3) Gestionar el proyecto (reportes semanales, seguimientos): el QA, igual
--    que el desarrollador, en los proyectos de los que es responsable.
create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_profile_role();
begin
  if v_role = 'superadmin' then
    return true;
  end if;

  if v_role = 'admin' then
    return
      exists (select 1 from public.project_jefes where project_id = p_project_id and jefe_id = auth.uid())
      or not exists (select 1 from public.project_jefes where project_id = p_project_id);
  end if;

  if v_role in ('desarrollador', 'qa') then
    return exists (select 1 from public.projects where id = p_project_id and responsable_id = auth.uid());
  end if;

  return false;
end;
$$;

-- 4) ¿Quien llama es el responsable del proyecto de este checkpoint?
create or replace function public.is_responsable_of_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.checklist_items ci
    join public.sections s on s.id = ci.section_id
    join public.projects p on p.id = s.project_id
    where ci.id = p_item_id and p.responsable_id = auth.uid()
  );
$$;

-- 5) Autoaprobación: no si quien escribe es el responsable del proyecto.
create or replace function public.tg_item_logs_auto_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_review_item_logs() and not public.is_responsable_of_item(NEW.item_id) then
    NEW.qa_approved := true;
    NEW.qa_approved_by := auth.uid();
    NEW.qa_approved_at := now();
  end if;
  return NEW;
end;
$$;

-- 6) Aprobar / rechazar: un revisor no decide sobre su propio proyecto.
create or replace function public.approve_item_log(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
begin
  if not public.can_review_item_logs() then
    raise exception 'Solo QA puede aprobar reportes de seguimiento.';
  end if;
  select item_id into v_item from public.item_logs where id = p_log_id;
  if v_item is null then
    raise exception 'El reporte de seguimiento no existe.';
  end if;
  if public.is_responsable_of_item(v_item) then
    raise exception 'No puedes aprobar seguimientos de un proyecto del que eres responsable: lo revisa otra persona de QA.';
  end if;
  update public.item_logs
     set qa_approved = true, qa_approved_by = auth.uid(), qa_approved_at = now(),
         qa_rejected_by = null, qa_rejected_at = null, qa_rejection_reason = null
   where id = p_log_id;
end;
$$;

create or replace function public.reject_item_log(p_log_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
begin
  if not public.can_review_item_logs() then
    raise exception 'Solo QA puede rechazar reportes de seguimiento.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica el motivo del rechazo (mínimo 5 caracteres).';
  end if;
  select item_id into v_item from public.item_logs where id = p_log_id;
  if v_item is null then
    raise exception 'El reporte de seguimiento no existe.';
  end if;
  if public.is_responsable_of_item(v_item) then
    raise exception 'No puedes rechazar seguimientos de un proyecto del que eres responsable: lo revisa otra persona de QA.';
  end if;
  update public.item_logs
     set qa_approved = false, qa_approved_by = null, qa_approved_at = null,
         qa_rejected_by = auth.uid(), qa_rejected_at = now(), qa_rejection_reason = btrim(p_reason)
   where id = p_log_id;
end;
$$;
