-- Un proyecto puede tener más de un jefe de proyecto (mismo caso que ya se
-- resolvió para clientes en 2026091102_multi_client_support.sql): jefe_id
-- era un actor singular, se reemplaza por una tabla de relación N:M.
--
-- jefe_id nunca se usó para nada de permisos por sí solo (cualquier admin ya
-- podía gestionar cualquier proyecto vía is_admin(), sin importar quién
-- fuera el jefe_id puntual) -- así que este cambio es más simple que el de
-- clientes: no hay que tocar can_view_project()/can_manage_project(), solo
-- las funciones que comparaban directo contra projects.jefe_id como forma
-- alternativa (redundante) de decir "sos jefe de este proyecto".

create table if not exists public.project_jefes (
  project_id  uuid not null references public.projects(id) on delete cascade,
  jefe_id     uuid not null references public.profiles(id) on delete cascade,
  jefe_nombre text not null,
  created_at  timestamptz not null default now(),
  primary key (project_id, jefe_id)
);

alter table public.project_jefes enable row level security;

drop policy if exists select_project_jefes on public.project_jefes;
create policy select_project_jefes on public.project_jefes for select using (
  public.can_view_project(project_id)
);
-- Sin políticas de insert/update/delete: toda escritura pasa por
-- add_project_jefe()/remove_project_jefe() (security definer).

insert into public.project_jefes (project_id, jefe_id, jefe_nombre)
select id, jefe_id, jefe_nombre
from public.projects
where jefe_id is not null and jefe_nombre is not null
on conflict (project_id, jefe_id) do nothing;

-- tg_profiles_clear_invalid_assignments(): si a alguien le quitan el rol
-- 'admin', se le quita de project_jefes (antes limpiaba la columna única
-- projects.jefe_id).
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
    if new.role <> 'desarrollador' then
      update public.projects set responsable_id = null, responsable_nombre = null where responsable_id = new.id;
    end if;
    if new.role <> 'cliente' then
      delete from public.project_clients where cliente_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- tg_projects_validate_actor_roles(): ya no valida jefe_id (la columna se
-- elimina más abajo; esa validación ahora vive en add_project_jefe()).
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
    if v_role is distinct from 'desarrollador' then
      raise exception 'La persona asignada debe ser un usuario con rol desarrollador (recibido: %).', coalesce(v_role, 'perfil inexistente');
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

-- El trigger quedó definido como "UPDATE OF jefe_id, responsable_id,
-- proveedor_id", así que Postgres no deja soltar jefe_id sin antes
-- recrearlo sin esa columna en la lista.
drop trigger if exists projects_validate_actor_roles on public.projects;
create trigger projects_validate_actor_roles
  before insert or update of responsable_id, proveedor_id on public.projects
  for each row execute function public.tg_projects_validate_actor_roles();

alter table public.projects drop column if exists jefe_id;
alter table public.projects drop column if exists jefe_nombre;

-- set_project_actors() pierde el parámetro p_jefe_id (los jefes ahora se
-- manejan aparte con add/remove_project_jefe, igual que los clientes). Se
-- dropea la versión de 4 parámetros porque Postgres trata cada aridad como
-- un overload distinto.
drop function if exists public.set_project_actors(uuid, uuid, uuid, uuid);

create or replace function public.set_project_actors(
  p_project_id uuid, p_responsable_id uuid, p_proveedor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before      jsonb;
  v_after       jsonb;
  v_resp_nombre text;
  v_prov_nombre text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para asignar los actores de este proyecto.';
  end if;

  select jsonb_build_object(
    'responsable_id', responsable_id, 'proveedor_id', proveedor_id
  ) into v_before
  from public.projects where id = p_project_id;

  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  select coalesce(full_name, email) into v_resp_nombre from public.profiles where id = p_responsable_id;
  select name into v_prov_nombre from public.providers where id = p_proveedor_id;

  update public.projects
     set responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre,
         proveedor_id = p_proveedor_id, proveedor = v_prov_nombre
   where id = p_project_id;

  v_after := jsonb_build_object(
    'responsable_id', p_responsable_id, 'proveedor_id', p_proveedor_id
  );

  if v_before is distinct from v_after then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before, v_after,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.set_project_actors(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_project_actors(uuid, uuid, uuid) to authenticated;

-- add_project_jefe()/remove_project_jefe(): mismo patrón que
-- add_project_client()/remove_project_client(), pero validando rol 'admin'.
-- A diferencia de clientes, aquí SOLO is_admin() puede gestionar jefes (ya
-- no existe projects.jefe_id para el chequeo "sos jefe de este proyecto" --
-- y de cualquier forma ese chequeo era redundante con is_admin(), como se
-- explica arriba).
create or replace function public.add_project_jefe(p_project_id uuid, p_jefe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_nombre text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para asignar jefes a este proyecto.';
  end if;

  select role, coalesce(full_name, email) into v_role, v_nombre
  from public.profiles where id = p_jefe_id;

  if v_role is distinct from 'admin' then
    raise exception 'El jefe de proyecto debe ser un usuario con rol admin (recibido: %).', coalesce(v_role, 'perfil inexistente');
  end if;

  insert into public.project_jefes (project_id, jefe_id, jefe_nombre)
  values (p_project_id, p_jefe_id, v_nombre)
  on conflict (project_id, jefe_id) do update set jefe_nombre = excluded.jefe_nombre;

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values ('project', p_project_id, 'update', null,
          jsonb_build_object('jefe_agregado', v_nombre),
          (select email from public.profiles where id = auth.uid()), p_project_id);
end;
$$;

revoke all on function public.add_project_jefe(uuid, uuid) from public, anon;
grant execute on function public.add_project_jefe(uuid, uuid) to authenticated;

create or replace function public.remove_project_jefe(p_project_id uuid, p_jefe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para quitar jefes de este proyecto.';
  end if;

  select jefe_nombre into v_nombre
  from public.project_jefes where project_id = p_project_id and jefe_id = p_jefe_id;

  delete from public.project_jefes where project_id = p_project_id and jefe_id = p_jefe_id;

  if v_nombre is not null then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update',
            jsonb_build_object('jefe_quitado', v_nombre), null,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.remove_project_jefe(uuid, uuid) from public, anon;
grant execute on function public.remove_project_jefe(uuid, uuid) to authenticated;

-- add/remove_project_client() ya no pueden comparar contra projects.jefe_id
-- (columna eliminada) para su chequeo alternativo "sos jefe de este
-- proyecto" -- se reemplaza por membresía en project_jefes.
create or replace function public.add_project_client(p_project_id uuid, p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_nombre text;
  v_email  text;
begin
  if not (
    public.is_admin()
    or exists (select 1 from public.project_jefes where project_id = p_project_id and jefe_id = auth.uid())
  ) then
    raise exception 'No autorizado para asignar clientes a este proyecto.';
  end if;

  select role, coalesce(full_name, email), email into v_role, v_nombre, v_email
  from public.profiles where id = p_cliente_id;

  if v_role is distinct from 'cliente' then
    raise exception 'El cliente debe ser un usuario con rol cliente (recibido: %).', coalesce(v_role, 'perfil inexistente');
  end if;

  insert into public.project_clients (project_id, cliente_id, cliente_nombre)
  values (p_project_id, p_cliente_id, v_nombre)
  on conflict (project_id, cliente_id) do update set cliente_nombre = excluded.cliente_nombre;

  insert into public.participants (meeting_id, label, email)
  select m.id, v_nombre, v_email
  from public.meetings m
  where m.project_id = p_project_id
    and not exists (
      select 1 from public.participants pt where pt.meeting_id = m.id and pt.label = v_nombre
    );

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values ('project', p_project_id, 'update', null,
          jsonb_build_object('cliente_agregado', v_nombre),
          (select email from public.profiles where id = auth.uid()), p_project_id);
end;
$$;

create or replace function public.remove_project_client(p_project_id uuid, p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  if not (
    public.is_admin()
    or exists (select 1 from public.project_jefes where project_id = p_project_id and jefe_id = auth.uid())
  ) then
    raise exception 'No autorizado para quitar clientes de este proyecto.';
  end if;

  select cliente_nombre into v_nombre
  from public.project_clients where project_id = p_project_id and cliente_id = p_cliente_id;

  delete from public.project_clients where project_id = p_project_id and cliente_id = p_cliente_id;

  if v_nombre is not null then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update',
            jsonb_build_object('cliente_quitado', v_nombre), null,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;
