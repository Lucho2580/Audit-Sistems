-- Detalle por proyecto del informe semanal, para la vista de admin/superadmin:
-- no solo el número del indicador, sino la descomposición semana a semana que
-- explica por qué tiene ese valor (cuántas semanas se rastrearon, cuántas se
-- reportaron, cuántas se perdieron, y la penalización vigente).
create or replace function public.get_weekly_progress_detail(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'America/Bogota')::date;
  v_start        date;
  v_frozen       numeric;
  v_year_end     date;
  v_weeks_left   numeric;
  v_penalty      numeric;
  v_weeks        jsonb;
  v_weeks_tracked integer;
  v_weeks_reported integer;
  v_weeks_missed integer;
  v_indicator    numeric;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select weekly_indicator_frozen, coalesce(responsable_asignado_at::date, created_at::date)
    into v_frozen, v_start
  from public.projects where id = p_project_id;

  if v_start is null then
    return jsonb_build_object(
      'indicator', 100, 'weeksTracked', 0, 'weeksReported', 0, 'weeksMissed', 0,
      'penaltyPerWeek', 0, 'weeksRemainingYear', 0, 'frozen', false, 'weeks', '[]'::jsonb
    );
  end if;

  v_year_end := make_date(extract(year from v_today)::int, 12, 31);
  v_weeks_left := greatest(1, (v_year_end - v_today) / 7.0);
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
      'status', case when is_current then 'en_curso' when reported then 'reportado' else 'perdida' end,
      'percentAvanzado', percent_avanzado,
      'note', note
    ) order by week_start), '[]'::jsonb),
    count(*) filter (where not is_current),
    count(*) filter (where reported and not is_current),
    count(*) filter (where not reported and not is_current)
  into v_weeks, v_weeks_tracked, v_weeks_reported, v_weeks_missed
  from joined;

  v_indicator := coalesce(v_frozen, greatest(0, round(100 - v_weeks_missed * v_penalty, 1)));

  return jsonb_build_object(
    'indicator', v_indicator,
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

revoke all on function public.get_weekly_progress_detail(uuid) from public;
grant execute on function public.get_weekly_progress_detail(uuid) to authenticated;
