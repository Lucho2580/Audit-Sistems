-- Una cuenta con rol 'qa' necesita poder ABRIR la página del proyecto y ver
-- sus fases para poder aprobar una -- sin esto, can_view_project() (select
-- de projects/meetings/participants) y la política de select de
-- project_phases la dejaban completamente afuera.
--
-- OJO: a propósito NO se toca can_manage_project() -- esa función también
-- gatea políticas de ESCRITURA (crear/editar reuniones, notas diarias,
-- avance de checklist_items), y QA no debe poder tocar nada de eso, solo
-- leer y aprobar fases (ya tiene su propio RPC approve_phase_qa() que valida
-- el rol aparte). Por eso el carve-out de 'qa' se agrega directo en
-- can_view_project() (solo-lectura) y en select_project_phases (solo-
-- lectura), no en can_manage_project().
create or replace function public.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_project(p_project_id)
    or exists (select 1 from public.project_clients where project_id = p_project_id and cliente_id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa');
$$;

drop policy if exists select_project_phases on public.project_phases;
create policy select_project_phases on public.project_phases for select using (
  public.can_manage_project(project_id)
  or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
);
