-- Resuelve una lista de correos a profiles reales, filtrando por rol -- lo usa
-- la importación masiva de proyectos desde Excel para validar cada celda
-- (Jefe/Persona asignada/Cliente) contra cuentas que de verdad existen, en un
-- solo viaje por columna en vez de uno por celda. Los correos que no
-- encuentren coincidencia simplemente no aparecen en el resultado -- el
-- frontend los reporta como "no encontrado".
create or replace function public.find_profiles_by_email(p_emails text[], p_role text)
returns table (email text, id uuid, full_name text)
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
    select p.email, p.id, p.full_name
    from public.profiles p
    where p.role = p_role
      and lower(p.email) = any (select lower(e) from unnest(p_emails) as e);
end;
$$;

revoke all on function public.find_profiles_by_email(text[], text) from public;
grant execute on function public.find_profiles_by_email(text[], text) to authenticated;
