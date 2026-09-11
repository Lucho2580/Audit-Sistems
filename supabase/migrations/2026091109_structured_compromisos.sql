-- meetings.next_steps era una sola línea de texto libre ("Próximos pasos")
-- pero la tabla "Compromisos" del acta (lib/acta.ts) tiene columnas de
-- Responsable y Fecha límite que siempre salían en "—" porque esa
-- información nunca se capturaba en ningún lado. Se reemplaza por una
-- columna jsonb con un compromiso por elemento ({text, responsable,
-- fechaLimite}), migrando el texto existente (una línea = un compromiso,
-- sin responsable/fecha porque esos datos no existían antes).

alter table public.meetings add column if not exists compromisos jsonb not null default '[]'::jsonb;

update public.meetings
set compromisos = (
  select coalesce(
    jsonb_agg(jsonb_build_object('text', btrim(line), 'responsable', null, 'fechaLimite', null)),
    '[]'::jsonb
  )
  from unnest(string_to_array(coalesce(next_steps, ''), E'\n')) as line
  where btrim(line) <> ''
)
where compromisos = '[]'::jsonb;

alter table public.meetings drop column if exists next_steps;

-- get_sign_status(): next_steps text -> compromisos jsonb (cambia el tipo de
-- retorno, hay que dropear la versión vieja antes de recrear).
drop function if exists public.get_sign_status(uuid);

create function public.get_sign_status(p_token uuid)
returns table(
  label text, already_signed boolean, expired boolean,
  project_name text, project_code text,
  meeting_title text, meeting_date date,
  topics text, agreements text, risks text, compromisos jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.label,
    (p.signature is not null) as already_signed,
    (p.signature is null and m.date < (current_date - interval '30 days')) as expired,
    pr.name, pr.code,
    m.title, m.date,
    m.topics, m.agreements, m.risks, m.compromisos
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  join public.projects pr on pr.id = m.project_id
  where p.sign_token = p_token;
$$;

revoke all on function public.get_sign_status(uuid) from public, anon;
grant execute on function public.get_sign_status(uuid) to authenticated, anon;
