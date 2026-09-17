-- Informe semanal de avance por proyecto + indicador de cumplimiento.
--
-- Modelo confirmado con el negocio:
--  - Cada semana (lunes a sábado 12:00pm, hora de Bogotá) la persona asignada
--    reporta lo AVANZADO ESA SEMANA (no el acumulado del proyecto) -- puede
--    ser 0% con una nota de "no avancé nada". Reportar 0% a tiempo NO
--    penaliza; solo penaliza NO REPORTAR NADA antes del plazo.
--  - No se puede reportar la semana anterior ni la próxima: solo la semana en
--    curso, y solo hasta el sábado 12:00pm de esa misma semana. Después de esa
--    hora, se puede volver a reportar hasta el lunes siguiente (cuando abre la
--    ventana de la semana nueva).
--  - Indicador: empieza en 100. Por cada semana YA CERRADA sin reporte, se le
--    resta 100 / (semanas que quedan del año 2026 desde HOY hasta el 31 de
--    diciembre). Ese denominador se recalcula cada vez que se consulta (no
--    queda fijo), así que la misma semana perdida "pesa más" entre más cerca
--    esté el fin de año. Nunca baja de 0.
--  - Cuando el proyecto pasa a status='cerrado', el indicador se CONGELA (se
--    guarda el valor de ese momento) y deja de pedirse el reporte semanal. El
--    frontend además deja de pedirlo si el avance de checklist ya está al
--    100%, sin esperar a que se marque 'cerrado'.
--
-- OJO -- asumo zona horaria America/Bogota (Colombia, UTC-5 fijo, sin horario
-- de verano) para "sábado 12:00pm". Si la operación real está en otro huso
-- horario, es el único literal que hay que cambiar en este archivo.

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas en projects
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists responsable_asignado_at timestamptz,
  add column if not exists weekly_indicator_frozen numeric;

comment on column public.projects.responsable_asignado_at is
  'Desde cuándo hay persona asignada vigente -- marca el inicio del conteo de semanas para el indicador. Se actualiza sola vía trigger cuando cambia responsable_id.';
comment on column public.projects.weekly_indicator_frozen is
  'Valor congelado del indicador semanal, guardado la primera vez que el proyecto pasa a status=cerrado. Si no es null, get_weekly_indicator() devuelve esto siempre, sin recalcular.';

-- Se actualiza sola al asignar/reasignar responsable -- no depende de tocar
-- set_project_actors() (cuyo cuerpo actual no tenemos a la vista) porque es un
-- trigger independiente sobre la misma columna.
create or replace function public.tg_projects_track_responsable_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.responsable_id is not null and (old.responsable_id is distinct from new.responsable_id) then
    new.responsable_asignado_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_track_responsable_assignment on public.projects;
create trigger projects_track_responsable_assignment
  before update of responsable_id on public.projects
  for each row execute function public.tg_projects_track_responsable_assignment();

-- ---------------------------------------------------------------------------
-- 2) Tabla de reportes semanales
-- ---------------------------------------------------------------------------
create table if not exists public.project_weekly_progress (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  week_start       date not null,                     -- lunes de esa semana (Bogotá)
  percent_avanzado integer not null check (percent_avanzado between 0 and 100),
  note             text not null check (btrim(note) <> ''),
  submitted_by     uuid references public.profiles(id) on delete set null,
  submitted_at     timestamptz not null default now(),
  unique (project_id, week_start)
);

create index if not exists project_weekly_progress_project_idx
  on public.project_weekly_progress(project_id, week_start desc);

alter table public.project_weekly_progress enable row level security;

-- Mismo criterio que el resto del proyecto: solo quien puede GESTIONAR el
-- proyecto (admin/superadmin, o la persona asignada de ESE proyecto) ve sus
-- reportes semanales -- el cliente no participa de este flujo en absoluto.
create policy select_weekly_progress on public.project_weekly_progress
  for select to authenticated
  using (public.can_manage_project(project_id));

-- Sin policies de insert/update/delete a propósito: la única vía de escritura
-- es submit_weekly_progress(), que valida la ventana de tiempo en el servidor.
revoke insert, update, delete on public.project_weekly_progress from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3) Cálculo del indicador
-- ---------------------------------------------------------------------------
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
  v_start         date;
  v_weeks_missed  integer;
  v_year_end      date;
  v_weeks_left    numeric;
begin
  select weekly_indicator_frozen, coalesce(responsable_asignado_at::date, created_at::date)
    into v_frozen, v_start
  from public.projects where id = p_project_id;

  if v_frozen is not null then
    return v_frozen;
  end if;
  if v_start is null then
    return 100;
  end if;

  -- Semanas YA CERRADAS (su lunes es anterior al lunes de la semana de
  -- v_as_of -- la semana en curso nunca cuenta como perdida todavía) desde el
  -- inicio del seguimiento que no tienen una fila en project_weekly_progress.
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

revoke all on function public.compute_weekly_indicator(uuid, date) from public;

-- Envoltorio con permiso: quien consulta desde el frontend pasa por acá, nunca
-- directo por compute_weekly_indicator (que cualquier otra función interna
-- puede llamar sin chequeo, como el trigger de congelado más abajo).
create or replace function public.get_weekly_indicator(p_project_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado.';
  end if;
  return public.compute_weekly_indicator(p_project_id);
end;
$$;

revoke all on function public.get_weekly_indicator(uuid) from public;
grant execute on function public.get_weekly_indicator(uuid) to authenticated;

-- Congela el indicador la primera vez que el proyecto se marca 'cerrado' --
-- después de eso deja de recalcularse (y el frontend deja de pedir el reporte).
create or replace function public.tg_projects_freeze_weekly_indicator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cerrado' and (old.status is distinct from 'cerrado') and new.weekly_indicator_frozen is null then
    new.weekly_indicator_frozen := public.compute_weekly_indicator(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_freeze_weekly_indicator on public.projects;
create trigger projects_freeze_weekly_indicator
  before update of status on public.projects
  for each row execute function public.tg_projects_freeze_weekly_indicator();

-- ---------------------------------------------------------------------------
-- 4) Enviar el reporte de la semana en curso
-- ---------------------------------------------------------------------------
create or replace function public.submit_weekly_progress(
  p_project_id uuid,
  p_percent    integer,
  p_note       text
)
returns public.project_weekly_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Bogota')::date;
  v_week_start date := date_trunc('week', v_today)::date;
  v_deadline   timestamptz := (v_week_start + 5 + time '12:00') at time zone 'America/Bogota';
  v_row        public.project_weekly_progress;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'No autorizado para reportar el avance de este proyecto.';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'El porcentaje debe estar entre 0 y 100.';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Describe qué se avanzó esta semana (o que no hubo avance).';
  end if;
  if now() > v_deadline then
    raise exception 'Ya pasó el plazo para reportar el avance de esta semana (sábado 12:00 pm hora Colombia). Podrás reportar de nuevo el lunes.';
  end if;

  insert into public.project_weekly_progress (project_id, week_start, percent_avanzado, note, submitted_by, submitted_at)
  values (p_project_id, v_week_start, p_percent, btrim(p_note), auth.uid(), now())
  on conflict (project_id, week_start) do update
    set percent_avanzado = excluded.percent_avanzado,
        note = excluded.note,
        submitted_by = excluded.submitted_by,
        submitted_at = now()
  returning * into v_row;

  insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
  values (
    'project_weekly_progress', v_row.id, 'update', null,
    jsonb_build_object('week_start', v_week_start, 'percent_avanzado', p_percent),
    (select email from public.profiles where id = auth.uid()), p_project_id
  );

  return v_row;
end;
$$;

revoke all on function public.submit_weekly_progress(uuid, integer, text) from public;
grant execute on function public.submit_weekly_progress(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Vista consolidada para el panel de admin/superadmin (todos los proyectos
--    con su indicador y el estado del reporte de esta semana, en una sola
--    llamada en vez de N+1).
-- ---------------------------------------------------------------------------
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
    order by p.created_at desc;
end;
$$;

revoke all on function public.list_weekly_progress_overview() from public;
grant execute on function public.list_weekly_progress_overview() to authenticated;
