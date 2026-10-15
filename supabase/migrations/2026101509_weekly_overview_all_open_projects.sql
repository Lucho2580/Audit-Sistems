-- El Informe semanal mostraba solo los proyectos DENTRO de su rango de fechas
-- (start_date..deadline_date, regla de 2026100710): los 13 proyectos abiertos
-- con el plazo de entrega ya vencido desaparecían del informe, justo los que
-- más hay que vigilar. Ahora list_weekly_progress_overview devuelve todos los
-- proyectos visibles con su rango y una marca in_window; el filtro de fechas
-- queda solo para el aviso obligatorio (WeeklyProgressGate), que sigue
-- pidiendo el reporte únicamente dentro del plazo del proyecto.

drop function if exists public.list_weekly_progress_overview();
create or replace function public.list_weekly_progress_overview()
returns table (
  project_id uuid, code text, name text, status text, responsable_nombre text, indicator numeric,
  current_week_start date, current_week_submitted boolean, current_week_deadline timestamptz,
  week_milestones_total integer, week_milestones_done integer, overdue_count integer,
  undated_count integer, next_due_date date, next_due_code text,
  start_date date, deadline_date date, in_window boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_week_end   date := date_trunc('week', v_today)::date + 6;
  v_deadline   timestamptz := (date_trunc('week', v_today)::date + 5 + time '12:00') at time zone 'America/Bogota';
begin
  return query
    select
      p.id, p.code, p.name, p.status::text, p.responsable_nombre,
      public.compute_weekly_indicator(p.id, v_today),
      v_week_start,
      exists (
        select 1 from public.project_weekly_progress pwp
        where pwp.project_id = p.id and pwp.week_start = v_week_start
      ),
      v_deadline,
      (select count(*)::int from public.project_milestones(p.id) pm where pm.due_date between v_week_start and v_week_end),
      (select count(*)::int from public.project_milestones(p.id) pm
        where pm.due_date between v_week_start and v_week_end
          and (pm.percent >= 100 or public.milestone_pending_qa(pm.item_id))),
      (select count(*)::int from public.project_milestones(p.id) pm
        where pm.due_date < v_week_start and pm.percent < 100 and not public.milestone_pending_qa(pm.item_id)),
      (select count(*)::int from public.project_milestones(p.id) pm where pm.due_date is null and pm.percent < 100),
      (select min(pm.due_date) from public.project_milestones(p.id) pm where pm.due_date > v_week_end and pm.percent < 100),
      (select pm.code from public.project_milestones(p.id) pm
        where pm.due_date > v_week_end and pm.percent < 100 order by pm.due_date, pm.sort_key limit 1),
      p.start_date,
      p.deadline_date,
      (p.start_date is null or v_today >= p.start_date) and (p.deadline_date is null or v_today <= p.deadline_date)
    from public.projects p
    where public.can_manage_project(p.id)
    order by p.created_at desc;
end;
$$;

revoke all on function public.list_weekly_progress_overview() from public, anon;
grant execute on function public.list_weekly_progress_overview() to authenticated;
