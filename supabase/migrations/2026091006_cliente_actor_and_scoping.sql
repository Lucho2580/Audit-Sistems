-- "Cliente" pasa a ser el 4to actor de un proyecto (jefe/responsable/
-- proveedor/cliente), con cuenta real (role='cliente', ya existía en el
-- enum y en admin-manage-user pero sin uso). El cliente debe poder ver SUS
-- documentos (actas) sin ver el resto del sistema -- hoy NINGUNA tabla tiene
-- scoping por proyecto (todo es "cualquier autenticado ve todo"), así que
-- esta migración introduce ese aislamiento por primera vez.

alter table public.projects
  add column if not exists cliente_id     uuid references public.profiles(id) on delete set null,
  add column if not exists cliente_nombre text;

create index if not exists projects_cliente_id_idx on public.projects(cliente_id);

-- ---------- Validación de rol del cliente (igual que jefe/responsable) ----------
create or replace function public.tg_projects_validate_actor_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.jefe_id is not null then
    select role into v_role from public.profiles where id = new.jefe_id;
    if v_role is distinct from 'admin' then
      raise exception 'El jefe del proyecto debe ser un usuario con rol admin (recibido: %).', coalesce(v_role, 'perfil inexistente');
    end if;
  end if;

  if new.responsable_id is not null then
    select role into v_role from public.profiles where id = new.responsable_id;
    if v_role is distinct from 'desarrollador' then
      raise exception 'La persona asignada debe ser un usuario con rol desarrollador (recibido: %).', coalesce(v_role, 'perfil inexistente');
    end if;
  end if;

  if new.proveedor_id is not null then
    if not exists (select 1 from public.providers where id = new.proveedor_id) then
      raise exception 'El proveedor debe ser un registro existente en providers (recibido: proveedor inexistente).';
    end if;
  end if;

  if new.cliente_id is not null then
    select role into v_role from public.profiles where id = new.cliente_id;
    if v_role is distinct from 'cliente' then
      raise exception 'El cliente debe ser un usuario con rol cliente (recibido: %).', coalesce(v_role, 'perfil inexistente');
    end if;
  end if;

  return new;
end;
$$;

-- ---------- Limpieza si a alguien le cambian el rol (igual patrón) ----------
create or replace function public.tg_profiles_clear_invalid_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if new.role <> 'admin' then
      update public.projects set jefe_id = null, jefe_nombre = null where jefe_id = new.id;
    end if;
    if new.role <> 'desarrollador' then
      update public.projects set responsable_id = null, responsable_nombre = null where responsable_id = new.id;
    end if;
    if new.role <> 'cliente' then
      update public.projects set cliente_id = null, cliente_nombre = null where cliente_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- ---------- set_project_actors: ahora recibe también p_cliente_id ----------
drop function if exists public.set_project_actors(uuid, uuid, uuid, uuid);

create function public.set_project_actors(
  p_project_id     uuid,
  p_jefe_id        uuid,
  p_responsable_id uuid,
  p_proveedor_id   uuid,
  p_cliente_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before      jsonb;
  v_after       jsonb;
  v_jefe_nombre text;
  v_resp_nombre text;
  v_prov_nombre text;
  v_cli_nombre  text;
begin
  if not (
    public.is_admin()
    or exists (select 1 from public.projects where id = p_project_id and jefe_id = auth.uid())
  ) then
    raise exception 'No autorizado para asignar los actores de este proyecto.';
  end if;

  select jsonb_build_object(
    'jefe_id', jefe_id, 'responsable_id', responsable_id,
    'proveedor_id', proveedor_id, 'cliente_id', cliente_id
  ) into v_before
  from public.projects where id = p_project_id;

  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  select coalesce(full_name, email) into v_jefe_nombre from public.profiles where id = p_jefe_id;
  select coalesce(full_name, email) into v_resp_nombre from public.profiles where id = p_responsable_id;
  select name into v_prov_nombre from public.providers where id = p_proveedor_id;
  select coalesce(full_name, email) into v_cli_nombre from public.profiles where id = p_cliente_id;

  update public.projects
     set jefe_id = p_jefe_id, jefe_nombre = v_jefe_nombre,
         responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre,
         proveedor_id = p_proveedor_id, proveedor = v_prov_nombre,
         cliente_id = p_cliente_id, cliente_nombre = v_cli_nombre
   where id = p_project_id;

  v_after := jsonb_build_object(
    'jefe_id', p_jefe_id, 'responsable_id', p_responsable_id,
    'proveedor_id', p_proveedor_id, 'cliente_id', p_cliente_id
  );

  if v_before is distinct from v_after then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before, v_after,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.set_project_actors(uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function public.set_project_actors(uuid, uuid, uuid, uuid, uuid) to authenticated;

-- ---------- Aislamiento por proyecto (nunca existió hasta ahora) ----------
-- Staff (admin/desarrollador/superadmin) sigue viendo todo, como siempre.
-- Un cliente solo ve el/los proyecto(s) donde es cliente_id.
create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff() or exists (
    select 1 from public.projects where id = p_project_id and cliente_id = auth.uid()
  );
$$;

grant execute on function public.can_view_project(uuid) to authenticated;

drop policy if exists select_projects on public.projects;
create policy select_projects on public.projects for select using (public.can_view_project(id));

drop policy if exists select_meetings on public.meetings;
create policy select_meetings on public.meetings for select using (public.can_view_project(project_id));

drop policy if exists select_participants on public.participants;
create policy select_participants on public.participants for select using (
  public.is_staff() or exists (
    select 1 from public.meetings m where m.id = participants.meeting_id and public.can_view_project(m.project_id)
  )
);

-- sections/checklist_items/item_logs/daily_notes: el cliente no tiene
-- ninguna razón para ver ni tocar ficha técnica/checklist/notas -- se
-- restringen a solo staff (antes eran legibles y ESCRIBIBLES por cualquier
-- autenticado; ningún usuario legítimo pierde acceso porque admin/
-- desarrollador/superadmin ya están cubiertos por is_staff()).
drop policy if exists select_sections on public.sections;
create policy select_sections on public.sections for select using (public.is_staff());
drop policy if exists auth_update_sections on public.sections;
create policy staff_update_sections on public.sections for update using (public.is_staff());

drop policy if exists select_items on public.checklist_items;
create policy select_items on public.checklist_items for select using (public.is_staff());
drop policy if exists auth_update_items on public.checklist_items;
create policy staff_update_items on public.checklist_items for update using (public.is_staff());

drop policy if exists select_item_logs on public.item_logs;
create policy select_item_logs on public.item_logs for select using (public.is_staff());
drop policy if exists auth_insert_item_logs on public.item_logs;
create policy staff_insert_item_logs on public.item_logs for insert with check (public.is_staff());
drop policy if exists auth_delete_item_logs on public.item_logs;
create policy staff_delete_item_logs on public.item_logs for delete using (public.is_staff());

drop policy if exists select_daily_notes on public.daily_notes;
create policy select_daily_notes on public.daily_notes for select using (public.is_staff());
drop policy if exists auth_insert_daily_notes on public.daily_notes;
create policy staff_insert_daily_notes on public.daily_notes for insert with check (public.is_staff());
drop policy if exists auth_delete_daily_notes on public.daily_notes;
create policy staff_delete_daily_notes on public.daily_notes for delete using (public.is_staff());

drop policy if exists select_audit_log on public.audit_log;
create policy select_audit_log on public.audit_log for select using (public.is_staff());
