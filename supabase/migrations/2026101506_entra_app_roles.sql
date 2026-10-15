-- Roles desde Entra ID: el alta y el rol de cada cuenta se administran en
-- Entra ID (App Registration "Sistema de Auditoría" -> Roles de aplicación;
-- Aplicaciones empresariales -> Usuarios y grupos para asignarlos), no desde
-- la app. La pantalla Usuarios queda de solo lectura.
--
-- El rol llega en el ID token como el claim "roles" (arreglo), que Supabase
-- Auth guarda en raw_user_meta_data -> 'custom_claims' -> 'roles'. Valores
-- de rol de aplicación esperados en Entra (columna "Valor"):
--   Superadmin | JefeProyecto | QA | PersonaAsignada | Cliente
-- Si alguien tiene más de uno, gana el de más permisos, en ese orden.
--
-- Sin claim de rol no se toca nada: las cuentas que ya existen conservan su
-- rol actual hasta que se les asigne uno en Entra, y pending_invites sigue
-- sirviendo como respaldo (invitación por SQL).

create or replace function public.role_from_entra_claims(p_meta jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  with r as (
    select lower(value) as v
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_meta -> 'custom_claims' -> 'roles') = 'array' then p_meta -> 'custom_claims' -> 'roles'
        when jsonb_typeof(p_meta -> 'roles') = 'array' then p_meta -> 'roles'
        else '[]'::jsonb
      end
    )
  )
  select case
    when exists (select 1 from r where v = 'superadmin') then 'superadmin'
    when exists (select 1 from r where v = 'jefeproyecto') then 'admin'
    when exists (select 1 from r where v = 'qa') then 'qa'
    when exists (select 1 from r where v = 'personaasignada') then 'desarrollador'
    when exists (select 1 from r where v = 'cliente') then 'cliente'
    else null
  end;
$$;

-- 1) Alta: además de una invitación o un perfil existente, ahora también
--    basta con tener un rol asignado en Entra ID.
create or replace function public.reject_unauthorized_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.role_from_entra_claims(new.raw_user_meta_data) is not null then
    return new;
  end if;
  if exists (select 1 from public.pending_invites where email = lower(new.email)) then
    return new;
  end if;
  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then
    return new;
  end if;
  raise exception 'Esta cuenta no está autorizada en el Sistema de Auditoría. Pide que Dirección de Sistemas te asigne un rol en Entra ID.';
end;
$$;

-- 2) Primer login: crea el perfil con el rol de Entra (o, sin él, con el de
--    la invitación). Sigue pisando la fila 'cliente' que crea antes
--    handle_new_user (on_auth_user_created).
create or replace function public.provision_profile_from_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite     public.pending_invites;
  v_entra_role text := public.role_from_entra_claims(new.raw_user_meta_data);
  v_name       text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'name', ''),
    new.email
  );
begin
  select * into v_invite from public.pending_invites where email = lower(new.email);

  if v_invite.email is not null or v_entra_role is not null then
    insert into public.profiles (id, email, full_name, role, must_change_password)
    values (
      new.id,
      lower(new.email),
      coalesce(v_invite.full_name, v_name),
      coalesce(v_entra_role, v_invite.role)::public.user_role,
      false
    )
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = excluded.role,
          must_change_password = false;
    if v_invite.email is not null then
      delete from public.pending_invites where email = v_invite.email;
    end if;
  end if;
  return new;
end;
$$;

-- 3) Logins siguientes: Supabase Auth reescribe raw_user_meta_data con los
--    claims del token en cada inicio de sesión con Microsoft, así que un
--    cambio de rol en Entra se refleja en el próximo login. Sin claim de rol
--    no se cambia nada.
create or replace function public.sync_profile_role_from_entra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.role_from_entra_claims(new.raw_user_meta_data);
begin
  if v_role is not null then
    update public.profiles
       set role = v_role::public.user_role
     where id = new.id
       and role is distinct from v_role::public.user_role;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_profile_role_from_entra on auth.users;
create trigger sync_profile_role_from_entra
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_role_from_entra();
