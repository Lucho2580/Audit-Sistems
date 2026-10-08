-- "Plazo" objetivo del proyecto (ítem 3b, vuelta 2): antes el avance
-- esperado dependía de que cada tarea de fase tuviera sus propias fechas
-- asignadas -- en un proyecto recién creado, sin tareas con fechas, siempre
-- daba 0% esperado. Ahora cada proyecto tiene su propia fecha límite
-- objetivo (independiente de las fechas de delivery/cierre real, que ya
-- existían y se llenan solo al entregar), para calcular el esperado de forma
-- automática desde el día de creación.
alter table public.projects add column if not exists deadline_date date;

-- Todos los proyectos existentes arrancan con un plazo por defecto de 3
-- meses desde su creación -- el jefe de proyecto lo puede ajustar después
-- desde "Editar".
update public.projects
set deadline_date = (created_at + interval '3 months')::date
where deadline_date is null;

create or replace function public.create_project(p_name text, p_proveedor text)
returns projects
language plpgsql
as $function$
declare
  v_project public.projects;
  v_section_id uuid;
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'No tienes permisos para crear proyectos';
  end if;

  v_code := 'DEV-' || lpad(nextval('public.project_code_seq')::text, 3, '0');

  insert into public.projects (code, name, proveedor, deadline_date)
  values (v_code, p_name, p_proveedor, (now() + interval '3 months')::date)
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
