-- 1) Fecha de inicio explícita del proyecto -- antes solo existía
-- deadline_date ("plazo"); created_at es el instante real de inserción y no
-- siempre coincide con el inicio planeado del trabajo.
alter table public.projects add column if not exists start_date date;
update public.projects set start_date = created_at::date where start_date is null;

-- 2) create_project(): acepta fecha de inicio y fecha de entrega esperada
-- opcionales -- si no se dan, hoy / hoy + 3 meses, igual que el default que
-- ya existía solo para deadline_date.
create or replace function public.create_project(
  p_name text, p_proveedor text,
  p_start_date date default null, p_deadline_date date default null
)
returns projects
language plpgsql
as $function$
declare
  v_project public.projects;
  v_section_id uuid;
  v_code text;
  v_start date;
  v_deadline date;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para crear proyectos';
  end if;

  v_start := coalesce(p_start_date, current_date);
  v_deadline := coalesce(p_deadline_date, v_start + interval '3 months');
  if v_deadline <= v_start then
    raise exception 'La fecha de entrega esperada debe ser posterior a la fecha de inicio.';
  end if;

  v_code := 'DEV-' || lpad(nextval('public.project_code_seq')::text, 3, '0');

  insert into public.projects (code, name, proveedor, start_date, deadline_date)
  values (v_code, p_name, p_proveedor, v_start, v_deadline)
  returning * into v_project;

  insert into public.sections (key, code, title, order_index, project_id)
  values ('ficha', 'FT', 'Ficha técnica', 0, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, section_id) values
    (1, 'Objetivo y alcance del desarrollo definidos', v_section_id),
    (2, 'Requerimientos funcionales documentados', v_section_id),
    (3, 'Requerimientos no funcionales (seguridad, rendimiento) documentados', v_section_id),
    (4, 'Reglas de negocio identificadas', v_section_id),
    (5, 'Modelo de datos definido', v_section_id),
    (6, 'Criterios de aceptación acordados', v_section_id),
    (7, 'Validación y firma (sign-off) de la ficha técnica', v_section_id);

  insert into public.sections (key, code, title, order_index, project_id)
  values ('flujo', 'FP', 'Flujo de procesos', 1, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, section_id) values
    (1, 'Mapeo del proceso actual (as-is)', v_section_id),
    (2, 'Mapeo del proceso propuesto (to-be)', v_section_id),
    (3, 'Diagramas de flujo / BPMN elaborados', v_section_id),
    (4, 'Casos de uso documentados', v_section_id),
    (5, 'Puntos de integración con otros sistemas identificados', v_section_id),
    (6, 'Manejo de excepciones y errores definido', v_section_id);

  insert into public.sections (key, code, title, order_index, project_id)
  values ('manual', 'MU', 'Manual de usuario', 2, v_project.id) returning id into v_section_id;
  insert into public.checklist_items (n, text, section_id) values
    (1, 'Guía de uso paso a paso redactada', v_section_id),
    (2, 'Capturas de pantalla incluidas', v_section_id),
    (3, 'Roles y permisos documentados', v_section_id),
    (4, 'Preguntas frecuentes incluidas', v_section_id),
    (5, 'Canales de soporte especificados', v_section_id);

  return v_project;
end;
$function$;

-- 3) seed_project_phases(): reparte las 6 fases dentro de [start_date,
-- deadline_date] del proyecto recién creado, en vez de dejarlas sin fecha --
-- así todos los hitos nacen ya dentro del rango declarado, proporcional a la
-- duración por defecto de cada fase (5+5+10+5+3+1 = 29 días de referencia).
create or replace function public.seed_project_phases()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_phase record;
  v_span_days integer;
  v_default_total constant integer := 29;
  v_cursor date;
  v_scaled integer;
begin
  insert into project_phases (project_id, key, label, order_index, duration_days) values
    (new.id, 'levantamiento', 'Levantamiento', 1, 5),
    (new.id, 'diseno', 'Diseño', 2, 5),
    (new.id, 'implementacion', 'Implementación', 3, 10),
    (new.id, 'testing', 'Testing', 4, 5),
    (new.id, 'entrega', 'Entrega', 5, 3),
    (new.id, 'fin', 'Fin', 6, 1);

  if new.start_date is not null and new.deadline_date is not null and new.deadline_date > new.start_date then
    v_span_days := greatest(6, new.deadline_date - new.start_date);
    v_cursor := new.start_date;
    for v_phase in select id, duration_days from project_phases where project_id = new.id order by order_index loop
      v_scaled := greatest(1, round(v_phase.duration_days::numeric * v_span_days / v_default_total)::integer);
      update project_phases set start_date = v_cursor, duration_days = v_scaled where id = v_phase.id;
      v_cursor := v_cursor + v_scaled;
    end loop;
  end if;

  for v_phase in select id, key from project_phases where project_id = new.id loop
    insert into phase_tasks (phase_id, project_id, text)
    select v_phase.id, new.id, t.text
    from phase_task_templates t
    where t.phase_key = v_phase.key
    order by t.order_index;
  end loop;

  return new;
end;
$function$;
