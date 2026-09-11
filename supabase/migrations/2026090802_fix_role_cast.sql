-- search_profiles_by_role() comparaba p.role (enum user_role) contra
-- p_role (text) sin cast explícito -> "operator does not exist: user_role =
-- text". Por eso "Personas asignadas"/"Proveedores" siempre fallaban al
-- cargar la lista (el error quedaba silenciado en el frontend hasta que se
-- agregó manejo de errores en ToolsPage.load()).

create or replace function public.search_profiles_by_role(p_role text, p_q text default '', p_limit int default 20)
returns table (id uuid, email text, full_name text, must_change_password boolean)
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
    select p.id, p.email, p.full_name, p.must_change_password
    from public.profiles p
    where p.role = p_role::public.user_role
      and (
        p_q is null or btrim(p_q) = ''
        or p.full_name ilike '%' || p_q || '%'
        or p.email ilike '%' || p_q || '%'
      )
    order by coalesce(p.full_name, p.email)
    limit greatest(1, coalesce(p_limit, 20));
end;
$$;
