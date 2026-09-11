-- providers_write_admin y phases_write_admin_dev comparaban profiles.role
-- directo contra 'admin'/'desarrollador' en vez de usar is_admin()/is_staff(),
-- así que un superadmin quedaba bloqueado para gestionar proveedores y fases
-- de proyecto (mismo tipo de brecha que _shared/staff.ts en las Edge
-- Functions, ya corregido aparte).

drop policy if exists providers_write_admin on public.providers;
create policy providers_write_admin
  on public.providers
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists phases_write_admin_dev on public.project_phases;
create policy phases_write_admin_dev
  on public.project_phases
  for all
  using (public.is_staff())
  with check (public.is_staff());
