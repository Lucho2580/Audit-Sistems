-- Bug real encontrado en producción: proyectos creados ANTES de que existiera
-- esta función (con responsable_id ya puesto desde el INSERT, no desde un
-- UPDATE posterior) nunca dispararon tg_projects_track_responsable_assignment
-- (solo corre "before update of responsable_id"), así que su
-- responsable_asignado_at quedó en null. compute_weekly_indicator()/
-- get_weekly_progress_detail() entonces caían al fallback de created_at, que
-- para estos proyectos es de ANTES de que el reporte semanal existiera --
-- resultado: semanas marcadas "PERDIDA" que nadie pudo haber reportado porque
-- la función todavía no existía.
--
-- Arreglo de una sola vez: cualquier proyecto con responsable ya asignado pero
-- responsable_asignado_at todavía en null (es decir, nunca pasó por el
-- trigger) arranca su conteo HOY, no en su created_at histórico.
update public.projects
set responsable_asignado_at = now()
where responsable_id is not null
  and responsable_asignado_at is null;
