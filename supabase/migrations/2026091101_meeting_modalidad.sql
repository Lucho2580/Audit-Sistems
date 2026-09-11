-- La modalidad de la reunión (Microsoft Teams / Presencial / Otra) se
-- adivinaba por si la reunión tenía teams_join_url -- pero una reunión
-- registrada manualmente (sin pasar por la integración de Teams) también
-- puede haberse hecho por Teams igual. Se vuelve un campo explícito en vez
-- de una inferencia.

alter table public.meetings add column if not exists modalidad text not null default 'Microsoft Teams';

drop function if exists public.create_meeting(uuid, date, text, text, jsonb);

create function public.create_meeting(
  p_project_id uuid, p_date date, p_time text, p_title text, p_participants jsonb default '[]',
  p_modalidad text default 'Microsoft Teams'
)
returns public.meetings
language plpgsql
security invoker
as $$
declare
  v_meeting public.meetings;
  v_participant jsonb;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para agendar reuniones';
  end if;

  insert into public.meetings (project_id, date, time, title, modalidad)
  values (p_project_id, p_date, p_time, coalesce(p_title, ''), coalesce(nullif(btrim(p_modalidad), ''), 'Microsoft Teams'))
  returning * into v_meeting;

  for v_participant in select * from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb))
  loop
    insert into public.participants (label, email, meeting_id)
    values (v_participant->>'label', nullif(v_participant->>'email', ''), v_meeting.id);
  end loop;

  return v_meeting;
end;
$$;

grant execute on function public.create_meeting(uuid, date, text, text, jsonb, text) to authenticated;
