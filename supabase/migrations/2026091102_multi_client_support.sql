-- Un proyecto puede tener VARIOS clientes (no solo uno) -- projects.cliente_id
-- era un actor singular igual que jefe/responsable, pero un proyecto real
-- suele tener más de una persona del lado del cliente que necesita ver y
-- firmar las actas. Se reemplaza por una tabla de relación N:M.
--
-- De paso corrige otro hallazgo de la misma auditoría de permisos que ya
-- había arreglado set_project_delivery/set_project_phase: set_project_actors
-- seguía con EXECUTE otorgado a "anon" -- cualquiera sin sesión podía
-- reasignar jefe/responsable/proveedor de cualquier proyecto llamando la
-- función directo por API.

create table if not exists public.project_clients (
  project_id    uuid not null references public.projects(id) on delete cascade,
  cliente_id    uuid not null references public.profiles(id) on delete cascade,
  cliente_nombre text not null,
  created_at    timestamptz not null default now(),
  primary key (project_id, cliente_id)
);

alter table public.project_clients enable row level security;

drop policy if exists select_project_clients on public.project_clients;
create policy select_project_clients on public.project_clients for select using (
  public.is_staff() or cliente_id = auth.uid()
);
-- Sin políticas de insert/update/delete: toda escritura pasa por
-- add_project_client()/remove_project_client() (security definer), igual
-- que el resto de los actores del proyecto.

insert into public.project_clients (project_id, cliente_id, cliente_nombre)
select id, cliente_id, cliente_nombre
from public.projects
where cliente_id is not null and cliente_nombre is not null
on conflict (project_id, cliente_id) do nothing;

-- can_view_project(): un cliente ve el proyecto si aparece en project_clients
-- (antes comparaba contra la columna única projects.cliente_id).
create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff() or exists (
    select 1 from public.project_clients
    where project_id = p_project_id and cliente_id = auth.uid()
  );
$$;

-- get_my_sign_link(): mismo cambio, valida contra project_clients en vez de
-- projects.cliente_id.
create or replace function public.get_my_sign_link(p_meeting_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_token text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  if v_email is null then
    raise exception 'No autorizado.';
  end if;

  select p.sign_token into v_token
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  join public.project_clients pc on pc.project_id = m.project_id and pc.cliente_id = auth.uid()
  where p.meeting_id = p_meeting_id
    and p.email = v_email;

  if v_token is null then
    raise exception 'No tienes un enlace de firma para esta reunión.';
  end if;

  return v_token;
end;
$$;

-- tg_profiles_clear_invalid_assignments(): si a alguien le quitan el rol
-- 'cliente', se le quita de project_clients (antes limpiaba la única
-- columna projects.cliente_id).
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
      delete from public.project_clients where cliente_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

-- tg_projects_validate_actor_roles(): ya no valida cliente_id (la columna se
-- elimina más abajo; esa validación ahora vive en add_project_client()).
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

  return new;
end;
$$;

-- projects.cliente_id/cliente_nombre quedan reemplazadas por project_clients.
alter table public.projects drop column if exists cliente_id;
alter table public.projects drop column if exists cliente_nombre;

-- set_project_actors() pierde el parámetro p_cliente_id (los clientes ahora
-- se manejan aparte con add/remove_project_client). Se dropea la versión de
-- 5 parámetros porque Postgres trata cada aridad como un overload distinto.
drop function if exists public.set_project_actors(uuid, uuid, uuid, uuid, uuid);

create or replace function public.set_project_actors(
  p_project_id uuid, p_jefe_id uuid, p_responsable_id uuid, p_proveedor_id uuid
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
begin
  if not (
    public.is_admin()
    or exists (select 1 from public.projects where id = p_project_id and jefe_id = auth.uid())
  ) then
    raise exception 'No autorizado para asignar los actores de este proyecto.';
  end if;

  select jsonb_build_object(
    'jefe_id', jefe_id, 'responsable_id', responsable_id, 'proveedor_id', proveedor_id
  ) into v_before
  from public.projects where id = p_project_id;

  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  select coalesce(full_name, email) into v_jefe_nombre from public.profiles where id = p_jefe_id;
  select coalesce(full_name, email) into v_resp_nombre from public.profiles where id = p_responsable_id;
  select name into v_prov_nombre from public.providers where id = p_proveedor_id;

  update public.projects
     set jefe_id = p_jefe_id, jefe_nombre = v_jefe_nombre,
         responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre,
         proveedor_id = p_proveedor_id, proveedor = v_prov_nombre
   where id = p_project_id;

  v_after := jsonb_build_object(
    'jefe_id', p_jefe_id, 'responsable_id', p_responsable_id, 'proveedor_id', p_proveedor_id
  );

  if v_before is distinct from v_after then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before, v_after,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.set_project_actors(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.set_project_actors(uuid, uuid, uuid, uuid) to authenticated;

-- add_project_client(): agrega un cliente al proyecto. Además de crear la
-- fila en project_clients, "reengancha" al cliente en las reuniones que ya
-- existían antes de agregarlo -- si no, alguien agregado como cliente
-- después de que una reunión ya se registró no tendría fila de participante
-- (ni enlace de firma) para esa reunión, aunque por RLS ya pueda ver el
-- proyecto.
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
    or exists (select 1 from public.projects where id = p_project_id and jefe_id = auth.uid())
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

revoke all on function public.add_project_client(uuid, uuid) from public, anon;
grant execute on function public.add_project_client(uuid, uuid) to authenticated;

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
    or exists (select 1 from public.projects where id = p_project_id and jefe_id = auth.uid())
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

revoke all on function public.remove_project_client(uuid, uuid) from public, anon;
grant execute on function public.remove_project_client(uuid, uuid) to authenticated;
