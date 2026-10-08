-- 1) checklist_items gana un responsable INDIVIDUAL (assigned_to), igual
--    que phase_tasks -- reemplaza el "resp" binario (cliente/desarrollador),
--    que nunca controlaba acceso (cualquier admin/responsable del proyecto
--    ya podía editar cualquier ítem sin importar su resp), solo era una
--    etiqueta. Ahora la etiqueta es el nombre real de la persona.
alter table public.checklist_items add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

-- enforce_item_update(): mismo guard de columnas de siempre, reemplazando
-- "resp" por "assigned_to" en la lista protegida (solo is_staff() -- que ya
-- incluye 'qa' desde la migración anterior -- puede reasignar/editar texto;
-- el resto solo puede tocar "percent", que es justamente lo que entra por
-- "reportar seguimiento").
create or replace function public.enforce_item_update()
returns trigger
language plpgsql
as $function$
begin
  if not public.is_staff() then
    if NEW.text is distinct from OLD.text
       or NEW.assigned_to is distinct from OLD.assigned_to
       or NEW.n is distinct from OLD.n
       or NEW.section_id is distinct from OLD.section_id then
      raise exception 'No tienes permisos para modificar ese campo del checkpoint';
    end if;
  end if;
  return NEW;
end;
$function$;

alter table public.checklist_items drop column if exists resp;

-- 2) QA suma (no reemplaza) la capacidad de gestionar checkpoints/notas de
-- sección que ya tenía el jefe de proyecto -- confirmado con el usuario.
drop policy if exists staff_insert_items on public.checklist_items;
create policy staff_insert_items on public.checklist_items for insert with check (
  exists (
    select 1 from public.sections s
    where s.id = checklist_items.section_id
      and (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa'))
  )
);

drop policy if exists staff_delete_items on public.checklist_items;
create policy staff_delete_items on public.checklist_items for delete using (
  exists (
    select 1 from public.sections s
    where s.id = checklist_items.section_id
      and (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa'))
  )
);

drop policy if exists staff_update_items on public.checklist_items;
create policy staff_update_items on public.checklist_items for update using (
  exists (
    select 1 from public.sections s
    where s.id = checklist_items.section_id
      and (
        public.can_manage_project(s.project_id)
        or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
      )
  )
);

drop policy if exists staff_update_sections on public.sections;
create policy staff_update_sections on public.sections for update using (
  public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')
);

-- 3) QA también puede ver y ajustar el cronograma de fases (fechas) de
-- cualquier proyecto -- antes solo podía leerlo (select_project_phases, ya
-- agregado) pero no moverlo.
create or replace function public.set_project_phase(
  p_phase_id uuid, p_start_date date, p_duration_days integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')) then
    raise exception 'No autorizado para editar el roadmap de este proyecto.';
  end if;

  update project_phases
  set start_date = p_start_date,
      duration_days = coalesce(p_duration_days, duration_days)
  where id = p_phase_id;
end;
$$;

-- 4) phase_tasks.assigned_to quedó sin "on delete set null" -- si se borra
-- la cuenta de quien tiene una tarea asignada, la FK bloqueaba el borrado
-- en vez de simplemente dejar la tarea sin asignar.
alter table public.phase_tasks drop constraint if exists phase_tasks_assigned_to_fkey;
alter table public.phase_tasks add constraint phase_tasks_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

-- 5) create_project(): ya no siembra "resp" (columna eliminada) -- los
-- checkpoints quedan sin asignar hasta que alguien les ponga una persona
-- (igual que las tareas de fase, que tampoco tienen asignado al crearse).
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

  insert into public.projects (code, name, proveedor)
  values (v_code, p_name, p_proveedor)
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
