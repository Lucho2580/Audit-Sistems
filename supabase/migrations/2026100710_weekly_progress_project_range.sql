-- El informe semanal ahora queda ligado al rango de fechas propio del
-- proyecto (fecha de inicio -> fecha de entrega esperada): fuera de ese
-- rango no se pide/forza el reporte de la semana (ni en el modal bloqueante
-- ni en el panel del proyecto), aunque el proyecto siga abierto. No se toca
-- el cálculo del indicador de cumplimiento (compute_weekly_indicator) --
-- sigue igual, esto solo cambia CUÁNDO se marca la semana como "pendiente".
create or replace function public.list_weekly_progress_overview()
returns table (
  project_id             uuid,
  code                   text,
  name                   text,
  status                 text,
  responsable_nombre     text,
  indicator              numeric,
  current_week_start     date,
  current_week_submitted boolean,
  current_week_deadline  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_deadline   timestamptz := (v_week_start + 5 + time '12:00') at time zone 'America/Bogota';
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
      v_deadline
    from public.projects p
    where public.can_manage_project(p.id)
      and (p.start_date is null or v_today >= p.start_date)
      and (p.deadline_date is null or v_today <= p.deadline_date)
    order by p.created_at desc;
end;
$$;
