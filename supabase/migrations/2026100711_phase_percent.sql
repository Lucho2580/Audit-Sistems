-- El % general del proyecto (ítem "avance real" en Proyectos) pasa a
-- calcularse desde el avance por fase, no desde el checklist de documentos
-- (ficha técnica/flujo/manual, que sigue existiendo como métrica aparte de
-- avance documental). Cada fase necesita entonces su propio % editable --
-- antes solo se mostraba el promedio de sus tareas, que ya no se puede
-- tocar desde que se quitó el panel "Fases y tareas".
alter table public.project_phases add column if not exists percent integer not null default 0 check (percent between 0 and 100);

-- Mismo criterio de permisos que set_project_phase: admin suma qa (QA
-- suma la capacidad, el jefe la conserva).
create or replace function public.set_phase_percent(p_phase_id uuid, p_percent integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'qa')) then
    raise exception 'No autorizado para editar el avance de esta fase.';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'El porcentaje debe estar entre 0 y 100.';
  end if;
  update public.project_phases set percent = p_percent where id = p_phase_id;
end;
$$;
