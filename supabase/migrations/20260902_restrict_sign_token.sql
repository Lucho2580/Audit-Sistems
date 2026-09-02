-- Corrige el hallazgo de seguridad: el token de firma (participants.sign_token)
-- viajaba en cualquier consulta normal de "participants", visible para cualquier
-- usuario autenticado con acceso de lectura a esa fila (incluido rol "cliente").
-- Quien lo leyera podía llamar directamente rpc('sign_participant', {p_token,...})
-- y firmar en nombre de otro participante.
--
-- OJO: este archivo asume los nombres de tabla/columna vistos en el código
-- (src/lib/services.ts, src/types/domain.ts): participants(id, sign_token) y
-- profiles(id, role) con role en ('admin','desarrollador','cliente'). Revisa que
-- coincidan con tu esquema real antes de ejecutar esto en el SQL editor de Supabase
-- (Dashboard → SQL Editor) o con `supabase db push`.

-- 1) Quita el privilegio de SELECT sobre la columna sign_token para los roles que
--    usa PostgREST. Así, aunque el select del cliente la pida, la consulta falla
--    en vez de devolver el valor. (Ajusta si tu policy de RLS ya cubre esto de
--    otra forma; REVOKE a nivel de columna es un refuerzo adicional a RLS.)
revoke select (sign_token) on public.participants from authenticated, anon;

-- 2) Función que entrega el sign_token de UN participante, solo si quien llama
--    es admin/desarrollador. SECURITY DEFINER para poder leer la columna aunque
--    el rol de la sesión no tenga el privilegio directo (revocado arriba).
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

  if v_role is null or v_role not in ('admin', 'desarrollador') then
    raise exception 'No autorizado para obtener el enlace de firma.';
  end if;

  select sign_token into v_token from public.participants where id = p_participant_id;

  if v_token is null then
    raise exception 'Participante no encontrado.';
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_sign_link(uuid) from public;
grant execute on function public.get_sign_link(uuid) to authenticated;
