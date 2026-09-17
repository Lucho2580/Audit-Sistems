-- Corrige un bug real: get_weekly_progress_detail() recalculaba el indicador
-- por su cuenta, redondeando la penalización por semana ANTES de multiplicar
-- (round(100.0/v_weeks_left, 2) * v_weeks_missed), mientras que
-- compute_weekly_indicator() (la que respalda la insignia de
-- WeeklyProgressPanel/WeeklyProgressDashboard vía get_weekly_indicator) hace
-- la multiplicación con el número SIN redondear y solo redondea el resultado
-- final. Con semanas perdidas > 0, esto podía mostrar dos porcentajes
-- distintos para el mismo proyecto en el mismo instante (una insignia decía
-- 23.5%, el detalle decía 23.6%).
--
-- Arreglo: get_weekly_progress_detail() ya NO recalcula el indicador -- llama
-- a compute_weekly_indicator() para ese número, así solo hay una fórmula.
create or replace function public.get_weekly_progress_detail(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today          date := (now() at time zone 'America/Bogota')::date;
  v_responsable    uuid;
  v_assigned_at    timestamptz;
  v_created_at     timestamptz;
  v_start          date;
  v_year_end       date;
  v_weeks_left     numeric;
  v_penalty        numeric;
  v_weeks          jsonb;
  v_weeks_tracked  integer;
  v_weeks_reported integer;
  v_weeks_missed   integer;
  v_frozen         numeric;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select responsable_id, responsable_asignado_at, created_at, weekly_indicator_frozen
    into v_responsable, v_assigned_at, v_created_at, v_frozen
  from public.projects where id = p_project_id;

  if v_responsable is null then
    return jsonb_build_object(
      'indicator', 100, 'weeksTracked', 0, 'weeksReported', 0, 'weeksMissed', 0,
      'penaltyPerWeek', 0, 'weeksRemainingYear', 0, 'frozen', false, 'weeks', '[]'::jsonb
    );
  end if;

  v_start := coalesce(v_assigned_at::date, v_created_at::date);

  v_year_end := make_date(extract(year from v_today)::int, 12, 31);
  v_weeks_left := greatest(1, (v_year_end - v_today) / 7.0);
  -- Solo para MOSTRAR "cada semana perdida resta X puntos" en el texto de
  -- explicación -- el indicador real sale de compute_weekly_indicator(), no
  -- de este cálculo redondeado.
  v_penalty := round(100.0 / v_weeks_left, 2);

  with weeks as (
    select gs::date as week_start
    from generate_series(
      date_trunc('week', v_start)::timestamp,
      date_trunc('week', v_today)::timestamp,
      interval '7 days'
    ) as gs
  ),
  joined as (
    select
      w.week_start,
      pwp.percent_avanzado,
      pwp.note,
      (w.week_start = date_trunc('week', v_today)::date) as is_current,
      (pwp.id is not null) as reported
    from weeks w
    left join public.project_weekly_progress pwp
      on pwp.project_id = p_project_id and pwp.week_start = w.week_start
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'weekStart', week_start,
      'status', case when reported then 'reportado' when is_current then 'en_curso' else 'perdida' end,
      'percentAvanzado', percent_avanzado,
      'note', note
    ) order by week_start), '[]'::jsonb),
    count(*) filter (where not is_current),
    count(*) filter (where reported and not is_current),
    count(*) filter (where not reported and not is_current)
  into v_weeks, v_weeks_tracked, v_weeks_reported, v_weeks_missed
  from joined;

  return jsonb_build_object(
    'indicator', public.compute_weekly_indicator(p_project_id, v_today),
    'weeksTracked', v_weeks_tracked,
    'weeksReported', v_weeks_reported,
    'weeksMissed', v_weeks_missed,
    'penaltyPerWeek', v_penalty,
    'weeksRemainingYear', round(v_weeks_left, 1),
    'frozen', v_frozen is not null,
    'weeks', v_weeks
  );
end;
$$;
