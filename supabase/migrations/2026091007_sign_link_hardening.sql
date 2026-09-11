-- Endurece el link de firma público (/sign/:token, sin sesión):
--   1) Caduca 30 días después de la fecha de la reunión -- hoy no expiraba
--      nunca. sign_participant() lo revisa antes de aceptar la firma, y
--      get_sign_status() lo expone para que la página pueda avisar en vez
--      de mostrar un error genérico.
--   2) get_sign_status() ahora trae el contenido del acta (proyecto,
--      reunión, temas/acuerdos/riesgos/próximos pasos) para que quien firma
--      pueda leer el documento antes de firmar, no solo un formulario ciego.
--   3) get_my_sign_link(): permite que un cliente autenticado (rol cliente,
--      dueño del proyecto) obtenga su propio link de firma sin depender de
--      get_sign_link() (que es exclusiva de staff) ni de tener el correo
--      a la mano -- para el portal de clientes.

drop function if exists public.get_sign_status(uuid);

create function public.get_sign_status(p_token uuid)
returns table (
  label text, already_signed boolean, expired boolean,
  project_name text, project_code text,
  meeting_title text, meeting_date date,
  topics text, agreements text, risks text, next_steps text
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
    m.topics, m.agreements, m.risks, m.next_steps
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  join public.projects pr on pr.id = m.project_id
  where p.sign_token = p_token;
$$;

grant execute on function public.get_sign_status(uuid) to anon, authenticated;

create or replace function public.sign_participant(p_token uuid, p_signature text)
returns public.participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant public.participants;
  v_meeting public.meetings;
begin
  if p_signature is null or btrim(p_signature) = '' then
    raise exception 'La firma no puede estar vacía';
  end if;

  select * into v_participant from public.participants where sign_token = p_token;
  if not found then
    raise exception 'Enlace de firma inválido';
  end if;

  if v_participant.signature is not null then
    raise exception 'Este documento ya fue firmado. No es necesario firmar de nuevo.';
  end if;

  select * into v_meeting from public.meetings where id = v_participant.meeting_id;
  if v_meeting.date < (current_date - interval '30 days') then
    raise exception 'Este enlace de firma ya caducó (30 días desde la reunión). Pide que te reenvíen uno nuevo.';
  end if;

  update public.participants
    set signature = p_signature, signed_at = now()
    where id = v_participant.id
    returning * into v_participant;

  insert into public.audit_log (entity_type, entity_id, project_id, action, after, actor_id, actor_email)
  values ('participant', v_participant.id, v_meeting.project_id, 'sign',
    jsonb_build_object('label', v_participant.label), auth.uid(), public.actor_email());

  return v_participant;
end;
$$;

create or replace function public.get_my_sign_link(p_meeting_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_token text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  if v_email is null then
    raise exception 'No autorizado.';
  end if;

  select p.sign_token into v_token
  from public.participants p
  join public.meetings m on m.id = p.meeting_id
  join public.projects pr on pr.id = m.project_id
  where p.meeting_id = p_meeting_id
    and p.email = v_email
    and pr.cliente_id = auth.uid();

  if v_token is null then
    raise exception 'No tienes un enlace de firma para esta reunión.';
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_my_sign_link(uuid) from public, anon;
grant execute on function public.get_my_sign_link(uuid) to authenticated;
