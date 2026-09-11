-- Helpers de rol reutilizados por los RPC de actores y por RLS.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.current_profile_role() = 'admin', false);
$$;
