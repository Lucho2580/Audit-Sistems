-- add_project_jefe() no reenganchaba al nuevo jefe en las reuniones que ya
-- existían antes de agregarlo -- por eso no aparecía como opción de
-- "Responsable" (que sale de mt.participants) en reuniones previas. Mismo
-- fix que ya tiene add_project_client(): al agregar el actor, se inserta su
-- fila de participante (con enlace de firma) en toda reunión del proyecto
-- que todavía no lo tenga.
create or replace function public.add_project_jefe(p_project_id uuid, p_jefe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_nombre text;
  v_email  text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para asignar jefes a este proyecto.';
  end if;

  select role, coalesce(full_name, email), email into v_role, v_nombre, v_email
  from public.profiles where id = p_jefe_id;

  if v_role is distinct from 'admin' then
    raise exception 'El jefe de proyecto debe ser un usuario con rol admin (recibido: %).', coalesce(v_role, 'perfil inexistente');
  end if;

  insert into public.project_jefes (project_id, jefe_id, jefe_nombre)
  values (p_project_id, p_jefe_id, v_nombre)
  on conflict (project_id, jefe_id) do update set jefe_nombre = excluded.jefe_nombre;

  insert into public.participants (meeting_id, label, email)
  select m.id, v_nombre, v_email
  from public.meetings m
  where m.project_id = p_project_id
    and not exists (
      select 1 from public.participants pt where pt.meeting_id = m.id and pt.label = v_nombre
    );

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values ('project', p_project_id, 'update', null,
          jsonb_build_object('jefe_agregado', v_nombre),
          (select email from public.profiles where id = auth.uid()), p_project_id);
end;
$$;
