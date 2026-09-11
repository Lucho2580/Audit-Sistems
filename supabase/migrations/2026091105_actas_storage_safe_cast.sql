-- actas_select castea el primer segmento del path a uuid para poder llamar
-- can_view_project(). Postgres NO garantiza evaluar el "and" de una política
-- RLS en orden (el planner puede reordenar), así que un objeto con un path
-- mal formado podría hacer que el cast a uuid lance una excepción y tumbe la
-- consulta completa para cualquiera, no solo para ese objeto. Se envuelve el
-- cast en una función que atrapa la excepción y devuelve null en vez de
-- fallar, y de paso se exige el formato correcto también al subir (insert).
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists actas_select on storage.objects;
create policy actas_select on storage.objects for select using (
  bucket_id = 'actas' and public.can_view_project(public.safe_uuid(split_part(name, '/', 1)))
);

drop policy if exists actas_insert on storage.objects;
create policy actas_insert on storage.objects for insert with check (
  bucket_id = 'actas'
  and public.is_staff()
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
);
