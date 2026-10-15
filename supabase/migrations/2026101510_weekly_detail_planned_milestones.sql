-- Detalle semana a semana: cada semana lista TODOS los hitos que vencían en
-- ella (no solo los que la persona reportó), con su estado reportado si lo
-- hay -- antes una semana sin reporte mostraba "0 de 1" sin decir cuál era el
-- hito. Se suman los atrasados que se reportaron esa semana, y a nivel de
-- proyecto cuántos hitos no tienen fecha y cuáles son los próximos.

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
  v_undated        integer;
  v_next           jsonb;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select responsable_id, responsable_asignado_at, created_at, weekly_indicator_frozen
    into v_responsable, v_assigned_at, v_created_at, v_frozen
  from public.projects where id = p_project_id;

  select count(*) into v_undated
  from public.project_milestones(p_project_id) pm
  where pm.due_date is null and pm.percent < 100;

  select coalesce(jsonb_agg(x order by (x->>'dueDate')), '[]'::jsonb) into v_next
  from (
    select jsonb_build_object('code', pm.code, 'title', pm.title, 'dueDate', pm.due_date) as x
    from public.project_milestones(p_project_id) pm
    where pm.due_date > date_trunc('week', v_today)::date + 6 and pm.percent < 100
    order by pm.due_date, pm.sort_key
    limit 3
  ) n;

  if v_responsable is null then
    return jsonb_build_object(
      'indicator', 100, 'weeksTracked', 0, 'weeksReported', 0, 'weeksMissed', 0,
      'penaltyPerWeek', 0, 'weeksRemainingYear', 0, 'frozen', false, 'weeks', '[]'::jsonb,
      'undatedCount', v_undated, 'nextItems', v_next
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
      pwp.id as progress_id,
      pwp.percent_avanzado,
      pwp.note,
      pwp.submitted_at,
      (w.week_start = date_trunc('week', v_today)::date) as is_current,
      (pwp.id is not null) as reported
    from weeks w
    left join public.project_weekly_progress pwp
      on pwp.project_id = p_project_id and pwp.week_start = w.week_start
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'weekStart', j.week_start,
      'status', case when j.reported then 'reportado' when j.is_current then 'en_curso' else 'perdida' end,
      'percentAvanzado', j.percent_avanzado,
      'note', j.note,
      'submittedAt', j.submitted_at,
      'milestonesTotal', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6),
      'milestonesDone', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6
                            and (pm.percent >= 100 or exists (
                              select 1 from public.project_weekly_milestones m
                              join public.item_logs l on l.id = m.item_log_id
                              where m.item_id = pm.item_id and m.status = 'cumplido' and l.qa_rejected_at is null))),
      'milestonesApproved', (select count(*) from public.project_milestones(p_project_id) pm
                          where pm.due_date between j.week_start and j.week_start + 6 and pm.percent >= 100),
      'items', coalesce((
        select jsonb_agg(q.x order by (q.x->>'late')::boolean desc, q.x->>'dueDate', q.x->>'code')
        from (
          -- Hitos que vencían esta semana, reportados o no.
          select jsonb_build_object(
            'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
            'status', m.status, 'note', m.note, 'late', false,
            'approved', pm.percent >= 100,
            'qa', case
                    when l.qa_approved then 'aprobado'
                    when l.qa_rejected_at is not null then 'rechazado'
                    when l.id is not null then 'pendiente'
                    else null
                  end,
            'qaReason', l.qa_rejection_reason
          ) as x
          from public.project_milestones(p_project_id) pm
          left join public.project_weekly_milestones m on m.progress_id = j.progress_id and m.item_id = pm.item_id
          left join public.item_logs l on l.id = m.item_log_id
          where pm.due_date between j.week_start and j.week_start + 6
          union all
          -- Atrasados (de semanas anteriores) que se reportaron esta semana.
          select jsonb_build_object(
            'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
            'status', m.status, 'note', m.note, 'late', true,
            'approved', pm.percent >= 100,
            'qa', case
                    when l.qa_approved then 'aprobado'
                    when l.qa_rejected_at is not null then 'rechazado'
                    when l.id is not null then 'pendiente'
                    else null
                  end,
            'qaReason', l.qa_rejection_reason
          )
          from public.project_weekly_milestones m
          join public.project_milestones(p_project_id) pm on pm.item_id = m.item_id
          left join public.item_logs l on l.id = m.item_log_id
          where m.progress_id = j.progress_id and pm.due_date < j.week_start
        ) q
      ), '[]'::jsonb)
    ) order by j.week_start), '[]'::jsonb),
    count(*) filter (where not j.is_current),
    count(*) filter (where j.reported and not j.is_current),
    count(*) filter (where not j.reported and not j.is_current)
  into v_weeks, v_weeks_tracked, v_weeks_reported, v_weeks_missed
  from joined j;

  return jsonb_build_object(
    'indicator', public.compute_weekly_indicator(p_project_id, v_today),
    'weeksTracked', v_weeks_tracked,
    'weeksReported', v_weeks_reported,
    'weeksMissed', v_weeks_missed,
    'penaltyPerWeek', v_penalty,
    'weeksRemainingYear', round(v_weeks_left, 1),
    'frozen', v_frozen is not null,
    'weeks', v_weeks,
    'undatedCount', v_undated,
    'nextItems', v_next
  );
end;
$$;
