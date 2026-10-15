-- Login por correo corporativo (SSO Microsoft Entra ID) -- Etapa A.
--
-- Hasta hoy una cuenta nueva se crea con admin.auth.admin.createUser() desde
-- admin-manage-user (contraseña temporal generada en el servidor). Con SSO,
-- esa fila de auth.users ya no la crea el admin -- la crea Supabase Auth la
-- primera vez que la persona entra de verdad con su cuenta de Microsoft. El
-- admin ahora solo registra una "invitación pendiente" (correo + nombre +
-- rol), y dos triggers sobre auth.users hacen el resto en el momento exacto
-- de ese primer login:
--   1) BEFORE INSERT rechaza cualquier alta sin invitación pendiente --
--      defensa en profundidad. La primera línea de defensa es restringir el
--      App Registration de Azure a un solo tenant (@lavianda.co); esta es la
--      segunda, independiente de que esa configuración esté bien hecha.
--   2) AFTER INSERT busca la invitación por correo y crea la fila real en
--      profiles con el id que Supabase Auth acaba de asignar, tal como antes
--      lo hacía admin-manage-user a mano.
--
-- Esto NO toca profiles.id = auth.users.id para nadie que ya tenga cuenta:
-- las cuentas existentes (creadas con contraseña) se vinculan aparte, desde
-- el propio cliente, con supabase.auth.linkIdentity() -- ese método no
-- inserta en auth.users (solo en auth.identities), así que no pasa por estos
-- triggers ni les importa si hay o no una invitación pendiente.

create table if not exists public.pending_invites (
  email       text primary key,
  full_name   text not null,
  role        text not null check (role in ('admin', 'desarrollador', 'cliente', 'qa')),
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.pending_invites is
  'Cuentas invitadas por un admin que todavía no han iniciado sesión con Microsoft ni una sola vez. La fila se borra en cuanto esa persona entra por primera vez (ver provision_profile_from_invite).';

alter table public.pending_invites enable row level security;
-- Sin policies para authenticated/anon a propósito: solo se toca desde la
-- Edge Function admin-manage-user (service role, bypassa RLS) y desde los
-- dos RPC de abajo (security definer, con su propio chequeo de rol).
revoke all on public.pending_invites from authenticated, anon;

-- Mismo criterio de permiso que ya usa admin-manage-user: admin o superadmin.
create or replace function public.list_pending_invites()
returns setof public.pending_invites
language sql
stable
security definer
set search_path = public
as $$
  select * from public.pending_invites
  where exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'superadmin')
  )
  order by created_at desc;
$$;

revoke all on function public.list_pending_invites() from public;
grant execute on function public.list_pending_invites() to authenticated;

create or replace function public.cancel_invite(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'superadmin')) then
    raise exception 'Solo un administrador puede cancelar invitaciones.';
  end if;
  delete from public.pending_invites where email = lower(p_email);
end;
$$;

revoke all on function public.cancel_invite(text) from public;
grant execute on function public.cancel_invite(text) to authenticated;

-- 1) Rechaza cualquier alta de auth.users sin invitación pendiente.
--
-- La rama "ya existe un profiles con ese correo" es puramente defensiva y en
-- la práctica no debería dispararse nunca: auth.users.email es único, así
-- que un intento de entrar con un correo que ya tiene cuenta de contraseña
-- jamás llega a un INSERT (Supabase Auth lo resuelve antes, vinculando la
-- identidad a la fila existente si el vínculo manual ya se hizo, o
-- rechazándolo con "ya registrado" si no). Se deja la rama igual por si
-- algún día cambia ese comportamiento interno, para no bloquear por error a
-- alguien que de hecho ya es parte del sistema.
create or replace function public.reject_unauthorized_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.pending_invites where email = lower(new.email)) then
    return new;
  end if;
  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then
    return new;
  end if;
  raise exception 'Esta cuenta no está autorizada en el Sistema de Auditoría. Pide que Dirección de Sistemas te invite primero.';
end;
$$;

drop trigger if exists reject_unauthorized_signup on auth.users;
create trigger reject_unauthorized_signup
  before insert on auth.users
  for each row execute function public.reject_unauthorized_signup();

-- 2) Aprovisiona el perfil real en cuanto la fila de auth.users ya existe
--    (no se puede antes: profiles.id referencia auth.users(id)).
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
    values (new.id, v_invite.email, v_invite.full_name, v_invite.role, false)
    on conflict (id) do nothing;
    delete from public.pending_invites where email = v_invite.email;
  end if;
  return new;
end;
$$;

drop trigger if exists provision_profile_from_invite on auth.users;
create trigger provision_profile_from_invite
  after insert on auth.users
  for each row execute function public.provision_profile_from_invite();
