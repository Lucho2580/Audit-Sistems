-- Corrige provision_profile_from_invite (migración 2026101401), que dejaba
-- fallar o mal configurado el primer login con Microsoft de todo invitado:
--
--   1) Insertaba v_invite.role (text) en profiles.role (enum user_role) sin
--      cast -> "column role is of type user_role but expression is of type
--      text". Como es un trigger AFTER INSERT sobre auth.users, el error
--      abortaba el alta entera y Supabase Auth devolvía "Database error
--      saving new user" (que el login muestra como "cuenta no autorizada").
--
--   2) El trigger previo on_auth_user_created (handle_new_user, de
--      001_profiles.sql) corre ANTES -- los triggers del mismo evento se
--      disparan en orden alfabético -- y ya crea el profile con rol
--      'cliente'. El "on conflict (id) do nothing" de aquí entonces no
--      hacía nada: un desarrollador/admin/QA invitado quedaba como cliente.
--      Ahora la invitación manda: pisa rol, nombre y correo de esa fila.

create or replace function public.provision_profile_from_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.pending_invites;
begin
  select * into v_invite from public.pending_invites where email = lower(new.email);
  if v_invite.email is not null then
    insert into public.profiles (id, email, full_name, role, must_change_password)
    values (new.id, v_invite.email, v_invite.full_name, v_invite.role::public.user_role, false)
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = excluded.role,
          must_change_password = false;
    delete from public.pending_invites where email = v_invite.email;
  end if;
  return new;
end;
$$;
