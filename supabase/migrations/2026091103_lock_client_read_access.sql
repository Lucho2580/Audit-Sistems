-- Auditoría solicitada: el cliente solo debe poder ver los documentos
-- (actas) de sus proyectos -- nada más, y no puede crear nada. La ruta y la
-- navegación ya estaban bien cerradas (App.tsx redirige /projects/:id,
-- /timeline y /tools a "/" para role='cliente', y el portal es de solo
-- lectura), pero dos políticas de SELECT quedaron abiertas a CUALQUIER
-- usuario autenticado (qual = true, sin pasar por can_view_project ni
-- is_staff()):
--
-- 1) project_phases: cualquier cuenta con sesión (incluido un cliente)
--    podía leer el roadmap/fechas de TODOS los proyectos del sistema
--    llamando la tabla directo con supabase-js, sin pasar por la UI.
-- 2) providers: mismo problema, cualquiera veía el catálogo completo de
--    proveedores.
--
-- Ninguna de las dos tenía política de insert/update/delete (solo se
-- escriben vía set_project_phase()/creación manual de providers, ya
-- restringidas a is_admin()/is_staff()), así que el único hueco era lectura.

drop policy if exists phases_select_authenticated on public.project_phases;
create policy select_project_phases on public.project_phases for select using (
  public.is_staff()
);

drop policy if exists providers_select_authenticated on public.providers;
create policy select_providers on public.providers for select using (
  public.is_staff()
);

-- Mismo hallazgo de permisos que ya se venía corrigiendo (set_project_delivery,
-- set_project_phase, set_project_actors): estas 3 seguían con EXECUTE para
-- "anon"/"PUBLIC" -- ya validan el rol adentro (is_staff()), así que no
-- alcanzaban a crear/editar nada sin sesión, pero no había razón para dejar
-- esa puerta abierta a quien ni siquiera inició sesión.
revoke all on function public.create_meeting(uuid, date, text, text, jsonb, text) from public, anon;
grant execute on function public.create_meeting(uuid, date, text, text, jsonb, text) to authenticated;

revoke all on function public.create_project(text, text) from public, anon;
grant execute on function public.create_project(text, text) to authenticated;

revoke all on function public.set_item_percent(uuid, integer, text) from public, anon;
grant execute on function public.set_item_percent(uuid, integer, text) to authenticated;
