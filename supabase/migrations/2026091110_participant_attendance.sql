-- El acta siempre mostraba "Sí" para todos los participantes en la columna
-- "Asistió" -- no había forma de marcar que alguien no asistió. Se agrega
-- attended (default true, para no cambiar el comportamiento de reuniones ya
-- registradas) y una función dedicada para cambiarlo -- participants no
-- tiene política de update (la firma se actualiza vía sign_participant(),
-- que no pasa por RLS), así que se sigue el mismo patrón en vez de abrir un
-- update genérico sobre toda la fila.
alter table public.participants add column if not exists attended boolean not null default true;

create or replace function public.set_participant_attendance(p_participant_id uuid, p_attended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select m.project_id into v_project_id
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  where p.id = p_participant_id;

  if v_project_id is null or not public.can_manage_project(v_project_id) then
    raise exception 'No autorizado para editar la asistencia de este participante.';
  end if;

  update public.participants set attended = p_attended where id = p_participant_id;
end;
$$;

revoke all on function public.set_participant_attendance(uuid, boolean) from public, anon;
grant execute on function public.set_participant_attendance(uuid, boolean) to authenticated;
