-- Asigna/reasigna los tres actores de un proyecto en una sola operación,
-- sincroniza el texto denormalizado (proveedor, jefe_nombre, responsable_nombre)
-- y deja rastro en audit_log. Permiso: admin global, o el jefe ACTUAL de ese
-- proyecto (para que un jefe pueda reorganizar su propio equipo sin depender
-- de un admin cada vez).
create or replace function public.set_project_actors(
  p_project_id     uuid,
  p_jefe_id        uuid,
  p_responsable_id uuid,
  p_proveedor_id   uuid
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

  select jsonb_build_object('jefe_id', jefe_id, 'responsable_id', responsable_id, 'proveedor_id', proveedor_id)
    into v_before
  from public.projects where id = p_project_id;

  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  select coalesce(full_name, email) into v_jefe_nombre from public.profiles where id = p_jefe_id;
  select coalesce(full_name, email) into v_resp_nombre from public.profiles where id = p_responsable_id;
  select coalesce(full_name, email) into v_prov_nombre from public.profiles where id = p_proveedor_id;

  update public.projects
     set jefe_id = p_jefe_id, jefe_nombre = v_jefe_nombre,
         responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre,
         proveedor_id = p_proveedor_id, proveedor = v_prov_nombre
   where id = p_project_id;

  v_after := jsonb_build_object('jefe_id', p_jefe_id, 'responsable_id', p_responsable_id, 'proveedor_id', p_proveedor_id);

  if v_before is distinct from v_after then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before, v_after,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.set_project_actors(uuid, uuid, uuid, uuid) from public;
grant execute on function public.set_project_actors(uuid, uuid, uuid, uuid) to authenticated;

-- Selector de personas para los pickers de asignación (jefe/responsable/
-- proveedor). Devuelve profiles reales de esta app -- no confundir con la
-- Edge Function entra-search-users, que busca en el directorio externo de
-- Microsoft para participantes de reuniones.
--
-- Solo admin puede llamarlo: hoy solo un admin crea proyectos y solo un admin
-- (o el jefe de un proyecto, que también es admin) reasigna actores, así que
-- restringir aquí ya alcanza y evita exponer el directorio de correos a
-- cualquier autenticado.
create or replace function public.search_profiles_by_role(p_role text, p_q text default '', p_limit int default 20)
returns table (id uuid, email text, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para buscar usuarios.';
  end if;
  if p_role not in ('admin', 'desarrollador', 'cliente') then
    raise exception 'Rol inválido: %', p_role;
  end if;

  return query
    select p.id, p.email, p.full_name
    from public.profiles p
    where p.role = p_role
      and (
        p_q is null or btrim(p_q) = ''
        or p.full_name ilike '%' || p_q || '%'
        or p.email ilike '%' || p_q || '%'
      )
    order by coalesce(p.full_name, p.email)
    limit greatest(1, coalesce(p_limit, 20));
end;
$$;

revoke all on function public.search_profiles_by_role(text, text, int) from public;
grant execute on function public.search_profiles_by_role(text, text, int) to authenticated;

-- Hidrata varios profiles por id de una sola vez (chips ya asignados, etc.).
-- Mismo criterio de permiso que search_profiles_by_role.
create or replace function public.get_profiles(p_ids uuid[])
returns table (id uuid, email text, full_name text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para consultar usuarios.';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role
    from public.profiles p
    where p.id = any(p_ids);
end;
$$;

revoke all on function public.get_profiles(uuid[]) from public;
grant execute on function public.get_profiles(uuid[]) to authenticated;
