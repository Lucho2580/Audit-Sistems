-- Hoy el acta se genera 100% en el navegador (HTML -> html2canvas -> jsPDF)
-- y jsPDF.save() dispara una descarga local -- no queda guardada en ningún
-- lado del lado del servidor. Se agrega un bucket de Storage ("actas") para
-- que, al generar el acta, además de descargarla quede subida ahí, y así:
--   - el cliente pueda descargar el PDF real desde su portal (no solo ver
--     los campos de texto), sin depender de que alguien se la reenvíe;
--   - quede un respaldo persistente de cada acta generada.
--
-- Un objeto se guarda con el path "{project_id}/{meeting_id}.pdf", así que
-- las políticas pueden reusar can_view_project() sobre el primer segmento
-- del path sin necesidad de otra tabla ni join con meetings.

insert into storage.buckets (id, name, public)
values ('actas', 'actas', false)
on conflict (id) do nothing;

drop policy if exists actas_select on storage.objects;
create policy actas_select on storage.objects for select using (
  bucket_id = 'actas' and public.can_view_project(split_part(name, '/', 1)::uuid)
);

drop policy if exists actas_insert on storage.objects;
create policy actas_insert on storage.objects for insert with check (
  bucket_id = 'actas' and public.is_staff()
);

drop policy if exists actas_update on storage.objects;
create policy actas_update on storage.objects for update using (
  bucket_id = 'actas' and public.is_staff()
);

drop policy if exists actas_delete on storage.objects;
create policy actas_delete on storage.objects for delete using (
  bucket_id = 'actas' and public.is_staff()
);
