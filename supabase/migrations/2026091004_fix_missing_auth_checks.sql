-- Hallazgos de auditoría de permisos:
--
-- 1) set_project_delivery() y set_project_phase() eran SECURITY DEFINER SIN
--    ningún chequeo de rol adentro, y encima tenían EXECUTE otorgado a
--    "anon" y "PUBLIC" -- cualquiera, ni siquiera autenticado, podía llamarlas
--    directo por API y modificar la fecha de entrega o el roadmap de
--    CUALQUIER proyecto. El frontend (ProjectDetail.tsx) solo deja editar
--    esto a admin/superadmin (canEdit), así que la función debe exigir lo
--    mismo.
--
-- 2) get_sign_link() exigía role in ('admin','desarrollador'), sin incluir
--    'superadmin' -- mismo patrón de brecha ya corregido en is_admin()/
--    is_staff()/_shared/staff.ts.

create or replace function public.set_project_delivery(
  p_project_id uuid, p_delivery_date date, p_final_delivery_date date,
  p_delay_days integer, p_final_observation text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para editar la entrega de este proyecto.';
  end if;

  update projects
  set delivery_date = p_delivery_date,
      final_delivery_date = p_final_delivery_date,
      delay_days = coalesce(p_delay_days, 0),
      final_observation = p_final_observation
  where id = p_project_id;
end;
$$;

revoke all on function public.set_project_delivery(uuid, date, date, integer, text) from public, anon;
grant execute on function public.set_project_delivery(uuid, date, date, integer, text) to authenticated;

create or replace function public.set_project_phase(
  p_phase_id uuid, p_start_date date, p_duration_days integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado para editar el roadmap de este proyecto.';
  end if;

  update project_phases
  set start_date = p_start_date,
      duration_days = coalesce(p_duration_days, duration_days)
  where id = p_phase_id;
end;
$$;

revoke all on function public.set_project_phase(uuid, date, integer) from public, anon;
grant execute on function public.set_project_phase(uuid, date, integer) to authenticated;

create or replace function public.get_sign_link(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_token text;
begin
  select role into v_role from public.profiles where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'desarrollador', 'superadmin') then
    raise exception 'No autorizado para obtener el enlace de firma.';
  end if;

  select sign_token into v_token from public.participants where id = p_participant_id;

  if v_token is null then
    raise exception 'Participante no encontrado.';
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_sign_link(uuid) from public, anon;
grant execute on function public.get_sign_link(uuid) to authenticated;
