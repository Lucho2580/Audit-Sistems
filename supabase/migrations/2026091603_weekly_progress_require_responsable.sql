-- Corrige un caso real: si un proyecto todavía NO tiene persona asignada
-- (responsable_id es null), el indicador no debe rastrear nada -- no hay a
-- quién pedirle el reporte semanal. Antes de esta migración, si además
-- responsable_asignado_at estaba vacío, el cálculo caía de respaldo a
-- created_at del proyecto y empezaba a contar semanas perdidas en silencio
-- desde la creación, aunque nadie estuviera asignado todavía.
--
-- La regla correcta:
--   - responsable_id es null              -> no se rastrea nada (indicador 100,
--                                             cero semanas). Punto.
--   - responsable_id existe y hay
--     responsable_asignado_at             -> se rastrea desde esa fecha (caso normal).
--   - responsable_id existe pero
--     responsable_asignado_at es null     -> dato heredado de antes de que
--                                             existiera esta columna; se usa
--                                             created_at como aproximación
--                                             razonable, ya que sí hay alguien
--                                             asignado, solo no sabemos desde cuándo.

create or replace function public.compute_weekly_indicator(p_project_id uuid, p_as_of date default null)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of         date := coalesce(p_as_of, (now() at time zone 'America/Bogota')::date);
  v_frozen        numeric;
  v_responsable   uuid;
  v_assigned_at   timestamptz;
  v_created_at    timestamptz;
  v_start         date;
  v_weeks_missed  integer;
  v_year_end      date;
  v_weeks_left    numeric;
begin
  select weekly_indicator_frozen, responsable_id, responsable_asignado_at, created_at
    into v_frozen, v_responsable, v_assigned_at, v_created_at
  from public.projects where id = p_project_id;

  if v_frozen is not null then
    return v_frozen;
  end if;
  if v_responsable is null then
    return 100;
  end if;

  v_start := coalesce(v_assigned_at::date, v_created_at::date);

  select count(*) into v_weeks_missed
  from generate_series(
    date_trunc('week', v_start)::timestamp,
    (date_trunc('week', v_as_of)::date - 7)::timestamp,
    interval '7 days'
  ) as gs(week_start)
  where not exists (
    select 1 from public.project_weekly_progress pwp
    where pwp.project_id = p_project_id and pwp.week_start = gs.week_start::date
  );

  v_year_end := make_date(extract(year from v_as_of)::int, 12, 31);
  v_weeks_left := greatest(1, (v_year_end - v_as_of) / 7.0);

  return greatest(0, round(100 - v_weeks_missed * (100.0 / v_weeks_left), 1));
end;
$$;

create or replace function public.get_weekly_progress_detail(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today          date := (now() at time zone 'America/Bogota')::date;
  v_frozen         numeric;
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
  v_indicator      numeric;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select weekly_indicator_frozen, responsable_id, responsable_asignado_at, created_at
    into v_frozen, v_responsable, v_assigned_at, v_created_at
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
