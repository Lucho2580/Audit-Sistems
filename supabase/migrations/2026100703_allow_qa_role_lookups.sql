-- search_profiles_by_role()/find_profiles_by_email() tenían un allowlist de
-- roles hardcodeado que no incluía 'qa' -- el picker de cuentas en
-- Herramientas (ToolsPage) y UsersAdminApi.list/create() dependen de la
-- primera para poder crear/buscar cuentas QA.
create or replace function public.search_profiles_by_role(p_role text, p_q text default ''::text, p_limit integer default 20)
returns table(id uuid, email text, full_name text, must_change_password boolean)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para buscar usuarios.';
  end if;
  if p_role not in ('admin', 'desarrollador', 'cliente', 'qa') then
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
$function$;

create or replace function public.find_profiles_by_email(p_emails text[], p_role text)
returns table(email text, id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para buscar usuarios.';
  end if;
  if p_role not in ('admin', 'desarrollador', 'cliente', 'qa') then
    raise exception 'Rol inválido: %', p_role;
  end if;

  return query
    select p.email, p.id, p.full_name
    from public.profiles p
    where p.role = p_role
      and lower(p.email) = any (select lower(e) from unnest(p_emails) as e);
end;
$function$;
