-- Tres actores por proyecto, cada uno una fila real de profiles con un rol fijo:
--   jefe_id        -> profiles.role = 'admin'         ("Jefe de proyecto")
--   responsable_id -> profiles.role = 'desarrollador' ("Persona asignada")
--   proveedor_id   -> profiles.role = 'cliente'        ("Proveedor")
--
-- proveedor_id reemplaza en la práctica al texto libre projects.proveedor, pero
-- la columna vieja se CONSERVA como texto denormalizado: set_project_actors la
-- sincroniza con el nombre del profile elegido, así los sitios que ya leen
-- project.proveedor como string (PDF, CSV, dashboard) siguen funcionando sin
-- cambios. Lo mismo se hace con jefe_nombre/responsable_nombre, para no
-- depender de joins embebidos de PostgREST (frágiles ante nombres de FK y RLS
-- de profiles que no conocemos todavía).
--
-- NO CONFUNDIR con checklist_items.resp ('cliente'|'desarrollador'), que es un
-- toggle sin persona detrás — un concepto totalmente distinto.

alter table public.projects
  add column if not exists jefe_id            uuid references public.profiles(id) on delete set null,
  add column if not exists jefe_nombre        text,
  add column if not exists responsable_id     uuid references public.profiles(id) on delete set null,
  add column if not exists responsable_nombre text,
  add column if not exists proveedor_id       uuid references public.profiles(id) on delete set null;

comment on column public.projects.proveedor is
  'Nombre del proveedor, denormalizado y sincronizado por set_project_actors() desde proveedor_id. No editar directo.';

create index if not exists projects_jefe_id_idx        on public.projects(jefe_id);
create index if not exists projects_responsable_id_idx on public.projects(responsable_id);
create index if not exists projects_proveedor_id_idx   on public.projects(proveedor_id);

-- Valida que cada uuid asignado tenga el rol correcto en profiles. No se puede
-- expresar con un CHECK (necesita subconsulta), así que va por trigger.
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
    select role into v_role from public.profiles where id = new.proveedor_id;
    if v_role is distinct from 'cliente' then
      raise exception 'El proveedor debe ser un usuario con rol cliente (recibido: %).', coalesce(v_role, 'perfil inexistente');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_validate_actor_roles on public.projects;
create trigger projects_validate_actor_roles
  before insert or update of jefe_id, responsable_id, proveedor_id on public.projects
  for each row execute function public.tg_projects_validate_actor_roles();

-- Si a alguien ya asignado le cambian el rol global, se limpia (set null) la
-- asignación que dejó de ser válida, en vez de bloquear el cambio de rol.
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
      update public.projects set proveedor_id = null, proveedor = null where proveedor_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_invalid_assignments on public.profiles;
create trigger profiles_clear_invalid_assignments
  after update of role on public.profiles
  for each row execute function public.tg_profiles_clear_invalid_assignments();

-- Bloquea la escritura directa de las columnas de actor: la única vía debe ser
-- el RPC set_project_actors (deja auditoría); así nadie se salta el rastro con
-- un update directo desde el cliente.
revoke update (jefe_id, jefe_nombre, responsable_id, responsable_nombre, proveedor_id) on public.projects from authenticated, anon;
