-- Dos políticas se me habían quedado por fuera del scoping por proyecto de
-- la migración anterior porque no aparecían en el listado de políticas de
-- escritura (ambas usan "for all"/"or", que no calzan con el filtro que
-- usé para inventariar insert/update/delete uno por uno):
--
-- 1) project_phases tenía "phases_write_admin_dev" (for all, using
--    is_staff()) -- al ser "for all" también cubre el select, así que
--    aunque la migración anterior dejó select_project_phases en
--    can_manage_project(), esta política de más atrás la volvía a abrir a
--    is_staff() a secas (cualquier desarrollador veía y podía escribir el
--    roadmap de CUALQUIER proyecto). Se reemplaza por insert/update/delete
--    exclusivos de is_admin() (coincide con canEdit=admin en RoadmapPhases y
--    con el chequeo interno de set_project_phase()), sin volver a cubrir el
--    select.
--
-- 2) select_participants tenía "is_staff() OR (...can_view_project...)" --
--    el primer término (is_staff() a secas) también anulaba el scoping por
--    proyecto para el select de participantes. Se deja solo el término que
--    ya pasa por can_view_project().

drop policy if exists phases_write_admin_dev on public.project_phases;
create policy staff_insert_phases on public.project_phases for insert with check (public.is_admin());
create policy staff_update_phases on public.project_phases for update using (public.is_admin());
create policy staff_delete_phases on public.project_phases for delete using (public.is_admin());

drop policy if exists select_participants on public.participants;
create policy select_participants on public.participants for select using (
  exists (select 1 from public.meetings m where m.id = participants.meeting_id and public.can_view_project(m.project_id))
);

-- Mismo problema en otras dos: is_staff() a secas, sin pasar por
-- can_manage_project()/can_view_project(), en tablas que sí son por
-- proyecto.
drop policy if exists select_project_clients on public.project_clients;
create policy select_project_clients on public.project_clients for select using (
  public.can_manage_project(project_id) or cliente_id = auth.uid()
);

drop policy if exists actas_insert on storage.objects;
create policy actas_insert on storage.objects for insert with check (
  bucket_id = 'actas'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
  and public.can_manage_project(public.safe_uuid(split_part(name, '/', 1)))
);

drop policy if exists actas_update on storage.objects;
create policy actas_update on storage.objects for update using (
  bucket_id = 'actas' and public.can_manage_project(public.safe_uuid(split_part(name, '/', 1)))
);

drop policy if exists actas_delete on storage.objects;
create policy actas_delete on storage.objects for delete using (
  bucket_id = 'actas' and public.can_manage_project(public.safe_uuid(split_part(name, '/', 1)))
);
