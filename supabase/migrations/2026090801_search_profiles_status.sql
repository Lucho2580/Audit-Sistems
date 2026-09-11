-- search_profiles_by_role() no exponía must_change_password, así que la
-- pantalla "Personas asignadas"/"Proveedores" no podía mostrar si una cuenta
-- sigue "pendiente por confirmar" (primer login sin cambiar la contraseña
-- temporal) o ya "confirmada" (must_change_password = false).

drop function if exists public.search_profiles_by_role(text, text, int);

create function public.search_profiles_by_role(p_role text, p_q text default '', p_limit int default 20)
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
