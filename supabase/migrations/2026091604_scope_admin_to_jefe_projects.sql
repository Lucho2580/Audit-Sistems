-- Hasta ahora is_admin() (role in 'admin','superadmin') se trataba igual en
-- TODA la app: cualquier admin veía/gestionaba TODOS los proyectos, igual que
-- superadmin. Esto separa los dos:
--
--   - superadmin -> sigue viendo/gestionando TODOS los proyectos, sin excepción.
--   - admin      -> SOLO los proyectos donde figura como Jefe (project_jefes).
--   - desarrollador -> sin cambios: solo el proyecto donde es responsable_id.
--   - cliente       -> sin cambios: solo donde está en project_clients (solo lectura).
--
-- OJO -- periodo de gracia: un proyecto que TODAVÍA no tiene ningún jefe
-- asignado sigue siendo visible para cualquier admin (no solo superadmin).
-- Sin esto, en cuanto se aplique esta migración, cualquier proyecto del
-- backlog que nunca tuvo un jefe asignado en project_jefes quedaría invisible
-- para todos los admins de golpe -- y ni siquiera podrían entrar a asignarle
-- uno. En cuanto un proyecto tenga al menos un jefe, deja de aplicar la
-- gracia y solo lo ven sus jefes + superadmin.
--
-- No toco los RPC de un solo propósito (add_project_jefe, remove_project_jefe,
-- set_project_actors, create_project, etc.): esos siguen gateados por
-- is_admin() como hoy, así que cualquier admin todavía puede REALIZAR esas
-- acciones sobre cualquier proyecto si conoce su id -- este cambio es
-- específicamente sobre qué proyectos VE/gestiona el contenido (secciones,
-- checklist, reuniones, seguimientos, fases) en el día a día. Si quieres que
-- esas acciones puntuales también se restrinjan a "solo si soy jefe de ESE
-- proyecto", dilo y lo ajusto aparte.

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_profile_role();
begin
  if v_role = 'superadmin' then
    return true;
  end if;

  if v_role = 'admin' then
    return
      exists (select 1 from public.project_jefes where project_id = p_project_id and jefe_id = auth.uid())
      or not exists (select 1 from public.project_jefes where project_id = p_project_id);
  end if;

  if v_role = 'desarrollador' then
    return exists (select 1 from public.projects where id = p_project_id and responsable_id = auth.uid());
  end if;

  return false;
end;
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_project(p_project_id)
      or exists (
           select 1 from public.project_clients
           where project_id = p_project_id and cliente_id = auth.uid()
         );
$$;
