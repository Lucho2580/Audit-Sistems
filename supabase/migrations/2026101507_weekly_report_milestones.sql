-- Reporte semanal ligado a los hitos del proyecto.
--
-- Antes: la persona asignada elegía a mano "¿cuánto avanzaste?" (un %) y
-- escribía una nota, sin relación con el plan. Ahora cada semana se mide
-- contra los HITOS -- checklist_items con due_date -- que vencen en ella:
--   * Por cada hito de la semana (y cada hito atrasado de semanas
--     anteriores) la persona marca cumplido / en_curso / sin_avance;
--     en_curso y sin_avance exigen comentario.
--   * "cumplido" crea un seguimiento (item_logs) pendiente de aprobación de
--     QA -- el mismo flujo de approve_item_log/reject_item_log. Si QA lo
--     rechaza, el hito vuelve a quedar pendiente.
--   * percent_avanzado deja de elegirse: = hitos de la semana cumplidos
--     (aprobados por QA o reportados cumplidos y pendientes de QA) / hitos
--     que vencen esa semana. Solo cuentan los cumplidos ("en curso" no suma).
--   * Un hito atrasado cuenta en la semana en que vencía; en las siguientes
--     solo aparece como atrasado hasta cerrarse, no infla el total.
--   * Una semana sin hitos con fecha no penaliza: se pide el reporte (con
--     comentario general) y milestones_total queda en 0.
-- El indicador de "reportes a tiempo" (compute_weekly_indicator) no cambia.

alter table public.project_weekly_progress
  add column if not exists milestones_total integer not null default 0,
  add column if not exists milestones_done integer not null default 0;

create table if not exists public.project_weekly_milestones (
  id           uuid primary key default gen_random_uuid(),
  progress_id  uuid not null references public.project_weekly_progress(id) on delete cascade,
  item_id      uuid not null references public.checklist_items(id) on delete cascade,
  status       text not null check (status in ('cumplido', 'en_curso', 'sin_avance')),
  note         text,
  item_log_id  uuid references public.item_logs(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (progress_id, item_id)
);

create index if not exists project_weekly_milestones_item_idx on public.project_weekly_milestones(item_id);

alter table public.project_weekly_milestones enable row level security;
revoke all on public.project_weekly_milestones from anon;
revoke insert, update, delete on public.project_weekly_milestones from authenticated;

drop policy if exists select_weekly_milestones on public.project_weekly_milestones;
create policy select_weekly_milestones on public.project_weekly_milestones for select using (
  exists (
    select 1 from public.project_weekly_progress pwp
    where pwp.id = project_weekly_milestones.progress_id and public.can_manage_project(pwp.project_id)
  )
);

-- Hito "cumplido" ya reportado y esperando a QA (ni aprobado ni rechazado):
-- no se vuelve a pedir como atrasado mientras QA no decida.
create or replace function public.milestone_pending_qa(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_weekly_milestones m
    join public.item_logs l on l.id = m.item_log_id
    where m.item_id = p_item_id and m.status = 'cumplido'
      and not l.qa_approved and l.qa_rejected_at is null
  );
$$;

-- Hitos del proyecto con su código (FT-2) y orden, base de todo lo demás.
create or replace function public.project_milestones(p_project_id uuid)
returns table (item_id uuid, code text, title text, due_date date, percent integer, sort_key text)
language sql
stable
security definer
set search_path = public
as $$
  select ci.id, s.code || '-' || ci.n, ci.text, ci.due_date, ci.percent,
         lpad(s.order_index::text, 4, '0') || lpad(ci.n::text, 4, '0')
  from public.checklist_items ci
  join public.sections s on s.id = ci.section_id
  where s.project_id = p_project_id;
$$;

-- Formulario del reporte de la semana en curso.
create or replace function public.get_weekly_report_form(p_project_id uuid)
returns jsonb
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
  v_progress   public.project_weekly_progress;
  v_week_items jsonb;
  v_overdue    jsonb;
  v_next       jsonb;
  v_undated    integer;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;

  select * into v_progress from public.project_weekly_progress
  where project_id = p_project_id and week_start = v_week_start;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', pm.item_id, 'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
      'approved', pm.percent >= 100,
      'pendingQa', public.milestone_pending_qa(pm.item_id) and coalesce(m.status, '') <> 'cumplido',
      'status', m.status, 'note', m.note
    ) order by pm.due_date, pm.sort_key), '[]'::jsonb)
  into v_week_items
  from public.project_milestones(p_project_id) pm
  left join public.project_weekly_milestones m on m.progress_id = v_progress.id and m.item_id = pm.item_id
  where pm.due_date between v_week_start and v_week_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', pm.item_id, 'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
      'daysLate', v_today - pm.due_date,
      'status', m.status, 'note', m.note
    ) order by pm.due_date, pm.sort_key), '[]'::jsonb)
  into v_overdue
  from public.project_milestones(p_project_id) pm
  left join public.project_weekly_milestones m on m.progress_id = v_progress.id and m.item_id = pm.item_id
  where pm.due_date < v_week_start
    and pm.percent < 100
    and (not public.milestone_pending_qa(pm.item_id) or m.status = 'cumplido');

  select coalesce(jsonb_agg(x order by (x->>'dueDate')), '[]'::jsonb) into v_next
  from (
    select jsonb_build_object('code', pm.code, 'title', pm.title, 'dueDate', pm.due_date) as x
    from public.project_milestones(p_project_id) pm
    where pm.due_date > v_week_end and pm.percent < 100
    order by pm.due_date, pm.sort_key
    limit 5
  ) n;

  select count(*) into v_undated
  from public.project_milestones(p_project_id) pm
  where pm.due_date is null and pm.percent < 100;

  return jsonb_build_object(
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'deadline', v_deadline,
    'isOpen', now() <= v_deadline,
    'submittedAt', v_progress.submitted_at,
    'note', coalesce(v_progress.note, ''),
    'weekItems', v_week_items,
    'overdueItems', v_overdue,
    'nextItems', v_next,
    'undatedCount', v_undated
  );
end;
$$;

revoke all on function public.get_weekly_report_form(uuid) from public, anon;
grant execute on function public.get_weekly_report_form(uuid) to authenticated;

-- Envío del reporte. p_items: [{"itemId": uuid, "status": "...", "note": "..."}]
-- con todos los hitos accionables (de la semana y atrasados).
create or replace function public.submit_weekly_report(p_project_id uuid, p_note text, p_items jsonb)
returns public.project_weekly_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_week_end   date := date_trunc('week', v_today)::date + 6;
  v_deadline   timestamptz := (date_trunc('week', v_today)::date + 5 + time '12:00') at time zone 'America/Bogota';
  v_email      text := (select email from public.profiles where id = auth.uid());
  v_row        public.project_weekly_progress;
  v_el         jsonb;
  v_item       uuid;
  v_status     text;
  v_note       text;
  v_code       text;
  v_old        public.project_weekly_milestones;
  v_log_id     uuid;
  v_missing    text;
  v_total      integer;
  v_done       integer;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado para reportar el avance de este proyecto.';
  end if;
  if now() > v_deadline then
    raise exception 'Ya pasó el plazo para reportar el avance de esta semana (sábado 12:00 pm hora Colombia). Podrás reportar de nuevo el lunes.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de hitos inválido.';
  end if;

  -- Cada elemento: hito del proyecto, estado válido, comentario si no se cumplió.
  for v_el in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (v_el->>'itemId')::uuid;
    v_status := v_el->>'status';
    v_note := nullif(btrim(coalesce(v_el->>'note', '')), '');
    select code into v_code from public.project_milestones(p_project_id) where item_id = v_item;
    if v_code is null then
      raise exception 'Uno de los hitos no pertenece a este proyecto.';
    end if;
    if v_status not in ('cumplido', 'en_curso', 'sin_avance') then
      raise exception 'Estado inválido para el hito %.', v_code;
    end if;
    if v_status <> 'cumplido' and (v_note is null or length(v_note) < 3) then
      raise exception 'Falta el comentario del hito % (qué falta o por qué no hubo avance).', v_code;
    end if;
  end loop;

  -- Todos los hitos accionables deben venir reportados.
  select string_agg(pm.code, ', ' order by pm.due_date, pm.sort_key) into v_missing
  from public.project_milestones(p_project_id) pm
  where pm.percent < 100
    and pm.due_date <= v_week_end
    and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where (e->>'itemId')::uuid = pm.item_id)
    and not public.milestone_pending_qa(pm.item_id);
  if v_missing is not null then
    raise exception 'Falta reportar el estado de: %.', v_missing;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'No hay hitos esta semana: describe en el comentario qué se hizo (o que no hubo avance).';
  end if;

  insert into public.project_weekly_progress (project_id, week_start, percent_avanzado, note, submitted_by, submitted_at)
  values (p_project_id, v_week_start, 0, btrim(coalesce(p_note, '')), auth.uid(), now())
  on conflict (project_id, week_start) do update
    set note = excluded.note, submitted_by = excluded.submitted_by, submitted_at = now()
  returning * into v_row;

  -- Hitos que estaban en una versión anterior de este reporte y ya no vienen:
  -- se quita la línea y, si su seguimiento sigue pendiente de QA, también.
  for v_old in
    select * from public.project_weekly_milestones m
    where m.progress_id = v_row.id
      and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where (e->>'itemId')::uuid = m.item_id)
  loop
    if v_old.item_log_id is not null then
      delete from public.item_logs where id = v_old.item_log_id and not qa_approved;
    end if;
    delete from public.project_weekly_milestones where id = v_old.id;
  end loop;

  for v_el in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (v_el->>'itemId')::uuid;
    v_status := v_el->>'status';
    v_note := nullif(btrim(coalesce(v_el->>'note', '')), '');
    -- Subconsulta (no SELECT INTO) para que un hito sin línea previa quede en
    -- null y no herede el valor del hito anterior del ciclo.
    v_log_id := (select m.item_log_id from public.project_weekly_milestones m
                 where m.progress_id = v_row.id and m.item_id = v_item);

    if v_status = 'cumplido' then
      -- Reusa el seguimiento si ya existía y QA no lo rechazó; si no, crea uno.
      if v_log_id is null or not exists (
        select 1 from public.item_logs where id = v_log_id and qa_rejected_at is null
      ) then
        insert into public.item_logs (text, item_id, author_id, author_email)
        values (
          'Hito cumplido (reporte semanal del ' || to_char(v_week_start, 'DD/MM/YYYY') || ')'
            || coalesce(': ' || v_note, '.'),
          v_item, auth.uid(), v_email
        )
        returning id into v_log_id;
      end if;
    elsif v_log_id is not null then
      delete from public.item_logs where id = v_log_id and not qa_approved;
      v_log_id := null;
    end if;

    insert into public.project_weekly_milestones (progress_id, item_id, status, note, item_log_id)
    values (v_row.id, v_item, v_status, v_note, v_log_id)
    on conflict (progress_id, item_id) do update
      set status = excluded.status, note = excluded.note, item_log_id = excluded.item_log_id;
  end loop;

  -- Avance de la semana = cumplidos / hitos que vencen esta semana.
  select count(*),
         count(*) filter (
           where pm.percent >= 100
              or public.milestone_pending_qa(pm.item_id)
              or exists (select 1 from public.project_weekly_milestones m
                         where m.progress_id = v_row.id and m.item_id = pm.item_id and m.status = 'cumplido')
         )
    into v_total, v_done
  from public.project_milestones(p_project_id) pm
  where pm.due_date between v_week_start and v_week_end;

  update public.project_weekly_progress
     set milestones_total = v_total,
         milestones_done = v_done,
         percent_avanzado = case when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end
   where id = v_row.id
  returning * into v_row;

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values ('project_weekly_progress', v_row.id, 'update', null,
          jsonb_build_object('week_start', v_week_start, 'milestones_total', v_total, 'milestones_done', v_done),
          v_email, p_project_id);

  return v_row;
end;
$$;

revoke all on function public.submit_weekly_report(uuid, text, jsonb) from public, anon;
grant execute on function public.submit_weekly_report(uuid, text, jsonb) to authenticated;

-- Resumen del Informe semanal: suma los indicadores de hitos.
drop function if exists public.list_weekly_progress_overview();
create or replace function public.list_weekly_progress_overview()
returns table (
  project_id uuid, code text, name text, status text, responsable_nombre text, indicator numeric,
  current_week_start date, current_week_submitted boolean, current_week_deadline timestamptz,
  week_milestones_total integer, week_milestones_done integer, overdue_count integer,
  undated_count integer, next_due_date date, next_due_code text
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
        where pm.due_date > v_week_end and pm.percent < 100 order by pm.due_date, pm.sort_key limit 1)
    from public.projects p
    where public.can_manage_project(p.id)
      and (p.start_date is null or v_today >= p.start_date)
      and (p.deadline_date is null or v_today <= p.deadline_date)
    order by p.created_at desc;
end;
$$;

revoke all on function public.list_weekly_progress_overview() from public, anon;
grant execute on function public.list_weekly_progress_overview() to authenticated;

-- Detalle semana a semana: cada semana suma sus hitos (planeados, cumplidos,
-- aprobados por QA) y las líneas del reporte de esa semana.
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
        select jsonb_agg(jsonb_build_object(
          'code', pm.code, 'title', pm.title, 'dueDate', pm.due_date,
          'status', m.status, 'note', m.note,
          'late', pm.due_date < j.week_start,
          'qa', case
                  when l.qa_approved then 'aprobado'
                  when l.qa_rejected_at is not null then 'rechazado'
                  when l.id is not null then 'pendiente'
                  else null
                end,
          'qaReason', l.qa_rejection_reason
        ) order by pm.due_date, pm.sort_key)
        from public.project_weekly_milestones m
        join public.project_milestones(p_project_id) pm on pm.item_id = m.item_id
        left join public.item_logs l on l.id = m.item_log_id
        where m.progress_id = j.progress_id
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
    'weeks', v_weeks
  );
end;
$$;
