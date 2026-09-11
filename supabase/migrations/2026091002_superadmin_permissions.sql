-- superadmin tiene todas las capacidades de admin, más la exclusiva de crear
-- otras cuentas admin ("Jefe de proyecto") -- eso lo gatea admin-manage-user
-- con is_superadmin(), no esta migración. Aquí solo se amplían los checks
-- de permiso existentes para que superadmin no quede con MENOS acceso que
-- un admin normal, y se promueve la primera cuenta superadmin.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.current_profile_role() in ('admin', 'superadmin'), false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'desarrollador', 'superadmin')
  );
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.current_profile_role() = 'superadmin', false);
$$;

update public.profiles set role = 'superadmin' where email = 'a.sistemas@lavianda.co';
