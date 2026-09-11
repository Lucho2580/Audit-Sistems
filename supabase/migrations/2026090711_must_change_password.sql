-- Marca si una cuenta debe cambiar su contraseña temporal antes de usar el
-- resto de la app (ver PrivateRoute/ForceChangePassword en el frontend). Se
-- pone en true al crear la cuenta o restablecer la contraseña (admin-manage-user);
-- se limpia a false cuando el usuario cambia su contraseña con éxito.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set must_change_password = false where id = auth.uid();
end;
$$;

grant execute on function public.clear_must_change_password() to authenticated;
